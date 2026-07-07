sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox'
], function (Controller, JSONModel, MessageToast, MessageBox) {
  'use strict';

  return Controller.extend('atc.controller.App', {

    onInit: function () {
      this._model = new JSONModel({
        fileSelected: false,
        uploadValid: false,
        analysisComplete: false,
        confirmValid: false,
        pipelineComplete: false,
        programs: [],
        agentLog: '',
        writebackLog: '',
        writebackResults: [],
        transportRequest: '',
        analysisStatusMsg: '等待分析启动...',
        writebackStatusMsg: '',
        finalMessage: '',
        uploadMessage: '',
        uploadMsgType: 'Information'
      });
      this.getView().setModel(this._model);
      this._jobId = null;
      this._sse = null;
      this._xmlContent = null;
    },

    // ─── Phase 1: Upload ───────────────────────────────────────────────────

    onFileSelected: function (oEvent) {
      const file = oEvent.getParameter('files')[0];
      if (!file) { return; }
      this._model.setProperty('/fileSelected', true);
      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        this._xmlContent = e.target.result;
      };
      reader.readAsText(file);
    },

    onFileTypeMismatch: function () {
      MessageToast.show('请选择 .xml 文件');
    },

    onUpload: function () {
      if (!this._xmlContent) {
        MessageToast.show('请先选择 XML 文件');
        return;
      }

      this.byId('uploadBusy').setVisible(true);
      this._model.setProperty('/uploadMessage', '');
      this._model.setProperty('/fileSelected', false);

      fetch('/odata/v4/atc/uploadAtc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xmlContent: this._xmlContent })
      })
        .then(r => r.json())
        .then(data => {
          this.byId('uploadBusy').setVisible(false);
          if (data.error || data['error']) {
            const msg = data.error?.message || data.message || '上传失败';
            this._showUploadMsg(msg, 'Error');
            this._model.setProperty('/fileSelected', true);
            return;
          }
          this._jobId = data.jobId;
          this._model.setProperty('/uploadValid', true);
          this._goToStep('analysisStep');
          this._startAnalysisSSE();
        })
        .catch(err => {
          this.byId('uploadBusy').setVisible(false);
          this._showUploadMsg('网络错误：' + err.message, 'Error');
          this._model.setProperty('/fileSelected', true);
        });
    },

    _showUploadMsg: function (text, type) {
      this._model.setProperty('/uploadMessage', text);
      this._model.setProperty('/uploadMsgType', type || 'Information');
      this.byId('uploadMsg').setVisible(true);
    },

    // ─── Phase 2: Analysis SSE ─────────────────────────────────────────────

    _startAnalysisSSE: function () {
      if (this._sse) { this._sse.close(); }
      this._model.setProperty('/analysisStatusMsg', '代理分析进行中，请稍候...');
      this._model.setProperty('/agentLog', '');

      this._sse = new EventSource('/stream/atc/' + this._jobId);

      this._sse.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          this._handleSSEEvent(event);
        } catch { /* ignore parse errors */ }
      };

      this._sse.onerror = () => {
        // SSE connection closed after job completes — this is normal
        if (this._sse.readyState === EventSource.CLOSED) { return; }
        this._sse.close();
        this._model.setProperty('/analysisStatusMsg', 'SSE 连接中断');
      };
    },

    _handleSSEEvent: function (event) {
      const programs = this._model.getProperty('/programs');

      switch (event.type) {
        case 'state': {
          // Initial state snapshot on SSE connect
          const job = event.job;
          if (!job) { return; }
          if (job.violations) {
            this._initPrograms(Object.keys(job.violations), job.violations);
          }
          if (job.status === 'awaiting_confirmation') {
            this._onAnalysisComplete(job.agentResults, programs);
          }
          break;
        }

        case 'analysis_started': {
          this._initPrograms(event.programs, null);
          this._appendLog('/agentLog', '=== 分析启动，共 ' + event.programs.length + ' 个程序 ===\n');
          break;
        }

        case 'agent_started': {
          this._setProgramStatus(event.program, { analyzing: true, statusText: '分析中...' });
          this._appendLog('/agentLog', '[' + event.program + '] 代理启动\n');
          break;
        }

        case 'agent_step': {
          const step = event.step;
          const stepText = step.type === 'llm_response'
            ? '[LLM] ' + (step.stop_reason || '')
            : step.type === 'tool_call'
              ? '[工具] ' + step.tool + '(' + JSON.stringify(step.input).substring(0, 60) + ')'
              : '[结果] ' + String(step.result || '').substring(0, 80);
          this._appendLog('/agentLog', '[' + event.program + '] ' + stepText + '\n');
          break;
        }

        case 'agent_done': {
          const result = event.result || {};
          const hasCode = !!(result.replacementCode && result.replacementCode.trim());
          this._setProgramStatus(event.program, {
            analyzing: false,
            done: true,
            hasCode: hasCode,
            resultSummary: hasCode ? '已生成修复方案' : '无法自动修复',
            explanation: result.explanation || '',
            replacementCode: result.replacementCode || ''
          });
          this._appendLog('/agentLog', '[' + event.program + '] 完成 — ' + (hasCode ? '有修复方案' : '无法修复') + '\n');
          break;
        }

        case 'analysis_complete': {
          this._sse.close();
          const updatedPrograms = this._model.getProperty('/programs');
          this._onAnalysisComplete(event.agentResults, updatedPrograms);
          break;
        }

        case 'write_started': {
          this._setWritebackStatus(event.program, { inProgress: true, writeStatus: '写入中...' });
          this._appendLog('/writebackLog', '[' + event.program + '] 开始写回\n');
          break;
        }

        case 'write_done': {
          const wr = event.result || {};
          this._setWritebackStatus(event.program, {
            inProgress: false,
            writeStatus: wr.status || 'UNKNOWN',
            writeDetail: wr.detail || ''
          });
          this._appendLog('/writebackLog', '[' + event.program + '] 写回: ' + wr.status + '\n');
          break;
        }

        case 'activation_started': {
          this._setWritebackStatus(event.program, { inProgress: true, activationStatus: '激活中...' });
          this._appendLog('/writebackLog', '[' + event.program + '] 开始激活\n');
          break;
        }

        case 'activation_attempt': {
          this._appendLog('/writebackLog', '[' + event.program + '] 激活尝试 #' + event.attempt + '\n');
          break;
        }

        case 'activation_done': {
          const ar = event.result || {};
          this._setWritebackStatus(event.program, {
            inProgress: false,
            activationStatus: ar.status + (ar.attempts > 1 ? '（第' + ar.attempts + '次）' : '')
          });
          this._appendLog('/writebackLog', '[' + event.program + '] 激活: ' + ar.status + '\n');
          break;
        }

        case 'pipeline_complete': {
          if (this._sse) { this._sse.close(); }
          const results = event.activationResults || {};
          const successCount = Object.values(results).filter(r => r && r.status === 'SUCCESS').length;
          this._model.setProperty('/pipelineComplete', true);
          this._model.setProperty('/finalMessage',
            '流程完成！共激活成功 ' + successCount + '/' + Object.keys(results).length + ' 个程序。');
          this._model.setProperty('/writebackStatusMsg', '所有操作完成');
          break;
        }
      }
    },

    _initPrograms: function (programNames, violations) {
      const existing = this._model.getProperty('/programs');
      if (existing.length > 0) { return; } // already initialized
      const programs = programNames.map(name => ({
        name: name,
        analyzing: false,
        done: false,
        hasCode: false,
        selected: false,
        statusText: '等待中',
        resultSummary: '',
        explanation: '',
        replacementCode: '',
        violationCount: violations ? (violations[name] || []).length : 0
      }));
      this._model.setProperty('/programs', programs);
    },

    _setProgramStatus: function (programName, updates) {
      const programs = this._model.getProperty('/programs');
      const idx = programs.findIndex(p => p.name === programName);
      if (idx === -1) {
        programs.push(Object.assign({ name: programName, analyzing: false, done: false, hasCode: false, selected: false }, updates));
      } else {
        Object.assign(programs[idx], updates);
      }
      this._model.setProperty('/programs', programs);
    },

    _appendLog: function (path, text) {
      const current = this._model.getProperty(path) || '';
      this._model.setProperty(path, current + text);
    },

    _onAnalysisComplete: function (agentResults, programs) {
      // Merge agentResults into programs model
      if (agentResults) {
        const updatedPrograms = this._model.getProperty('/programs');
        updatedPrograms.forEach(p => {
          const result = agentResults[p.name];
          if (result) {
            p.analyzing = false;
            p.done = true;
            p.hasCode = !!(result.replacementCode && result.replacementCode.trim());
            p.explanation = result.explanation || '';
            p.replacementCode = result.replacementCode || '';
            p.resultSummary = p.hasCode ? '已生成修复方案' : '无法自动修复';
          }
        });
        this._model.setProperty('/programs', updatedPrograms);
      }

      this._model.setProperty('/analysisComplete', true);
      this._model.setProperty('/analysisStatusMsg', '分析完成，共 ' + programs.length + ' 个程序');
      this._goToStep('confirmStep');
    },

    // ─── Phase 3: Confirm ──────────────────────────────────────────────────

    onTransportChange: function () {
      this._updateConfirmValid();
    },

    onCheckboxChange: function () {
      this._updateConfirmValid();
    },

    onProgramSelectionChange: function () {
      // Table MultiSelect mode fires this; sync selected state
      const table = this.byId('confirmTable');
      const items = table.getItems();
      const programs = this._model.getProperty('/programs');
      items.forEach((item, idx) => {
        if (programs[idx]) {
          programs[idx].selected = item.isSelected();
        }
      });
      this._model.setProperty('/programs', programs);
      this._updateConfirmValid();
    },

    _updateConfirmValid: function () {
      const transport = (this._model.getProperty('/transportRequest') || '').trim();
      const programs = this._model.getProperty('/programs');
      const anySelected = programs.some(p => p.selected && p.hasCode);
      this._model.setProperty('/confirmValid', !!(transport && anySelected));
    },

    onShowDiff: function (oEvent) {
      const ctx = oEvent.getSource().getBindingContext();
      const prog = ctx.getObject();
      if (!prog.hasCode) {
        MessageToast.show('该程序没有可用的修复方案');
        return;
      }
      this.byId('diffProgTitle').setText(prog.name);
      this.byId('diffExplanation').setText(prog.explanation || '无说明');
      this.byId('diffCode').setValue(prog.replacementCode || '');
      this.byId('diffDialog').open();
    },

    onCloseDiff: function () {
      this.byId('diffDialog').close();
    },

    onConfirmFixes: function () {
      const transport = (this._model.getProperty('/transportRequest') || '').trim();
      if (!transport) {
        MessageToast.show('请输入 Transport Request');
        return;
      }
      const programs = this._model.getProperty('/programs');
      const confirmedPrograms = programs
        .filter(p => p.selected && p.hasCode)
        .map(p => p.name);

      if (confirmedPrograms.length === 0) {
        MessageToast.show('请至少选择一个有修复方案的程序');
        return;
      }

      // Initialize writeback results list
      const writebackResults = confirmedPrograms.map(p => ({
        program: p,
        inProgress: false,
        writeStatus: '等待中',
        activationStatus: '等待中'
      }));
      this._model.setProperty('/writebackResults', writebackResults);
      this._model.setProperty('/writebackStatusMsg', '写回进行中...');

      fetch('/odata/v4/atc/confirmFixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: this._jobId,
          transportRequest: transport,
          confirmedPrograms: confirmedPrograms
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.error || (data['@Core.ContentID'] && data.error)) {
            MessageBox.error('确认失败：' + (data.message || JSON.stringify(data)));
            return;
          }
          // Move to step 4 and start SSE for writeback events
          this._model.setProperty('/confirmValid', true);
          this._goToStep('writebackStep');
          this._startWritebackSSE();
        })
        .catch(err => {
          MessageBox.error('网络错误：' + err.message);
        });
    },

    // ─── Phase 4: Write-back SSE ───────────────────────────────────────────

    _startWritebackSSE: function () {
      if (this._sse) { this._sse.close(); }
      this._sse = new EventSource('/stream/atc/' + this._jobId);

      this._sse.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          this._handleSSEEvent(event);
        } catch { /* ignore */ }
      };

      this._sse.onerror = () => {
        if (this._sse.readyState === EventSource.CLOSED) { return; }
        this._sse.close();
      };
    },

    _setWritebackStatus: function (programName, updates) {
      const results = this._model.getProperty('/writebackResults');
      const idx = results.findIndex(r => r.program === programName);
      if (idx >= 0) {
        Object.assign(results[idx], updates);
        this._model.setProperty('/writebackResults', results);
      }
    },

    // ─── Helpers ───────────────────────────────────────────────────────────

    _goToStep: function (stepId) {
      const wizard = this.byId('atcWizard');
      const step = this.byId(stepId);
      if (wizard && step) {
        wizard.goToStep(step, true);
      }
    },

    onReset: function () {
      if (this._sse) { this._sse.close(); this._sse = null; }
      this._jobId = null;
      this._xmlContent = null;
      this._model.setData({
        fileSelected: false,
        uploadValid: false,
        analysisComplete: false,
        confirmValid: false,
        pipelineComplete: false,
        programs: [],
        agentLog: '',
        writebackLog: '',
        writebackResults: [],
        transportRequest: '',
        analysisStatusMsg: '等待分析启动...',
        writebackStatusMsg: '',
        finalMessage: '',
        uploadMessage: '',
        uploadMsgType: 'Information'
      });
      this.byId('xmlFileUploader').clear();
      this._goToStep('uploadStep');
    }

  });
});
