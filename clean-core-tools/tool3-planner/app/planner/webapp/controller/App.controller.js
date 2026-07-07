sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox'
], function (Controller, JSONModel, MessageToast, MessageBox) {
  'use strict';

  return Controller.extend('planner.controller.App', {

    onInit: function () {
      this._model = new JSONModel({
        canImport: false,
        importValid: false,
        planGenerated: false,
        importMessage: '',
        importMsgType: 'Information',
        importSummary: '',
        generateMessage: '',
        generateMsgType: 'Information',
        sourceMode: 'xml',   // 'xml' or 'json'
        teamConfig: {
          teamSize: 3,
          sprintDuration: 10,
          velocityPerDev: 8
        },
        plan: null,
        developerList: [],
        moveTarget: null
      });
      this.getView().setModel(this._model);
      this._sessionId = null;
      this._xmlContent = null;
    },

    // ─── Step 1: Import ────────────────────────────────────────────────────

    onSourceChange: function (oEvent) {
      const idx = oEvent.getParameter('selectedIndex');
      const mode = idx === 0 ? 'xml' : 'json';
      this._model.setProperty('/sourceMode', mode);
      this.byId('xmlPanel').setVisible(mode === 'xml');
      this.byId('jsonPanel').setVisible(mode === 'json');
      this._model.setProperty('/canImport', mode === 'json'
        ? !!(this.byId('jsonInput').getValue().trim())
        : !!(this._xmlContent)
      );
    },

    onXmlFileSelected: function (oEvent) {
      const file = oEvent.getParameter('files')[0];
      if (!file) { return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        this._xmlContent = e.target.result;
        this._model.setProperty('/canImport', true);
      };
      reader.readAsText(file);
    },

    onJsonInputChange: function () {
      const val = this.byId('jsonInput').getValue().trim();
      this._model.setProperty('/canImport', !!val);
    },

    onImport: function () {
      const mode = this._model.getProperty('/sourceMode');
      const xmlContent = mode === 'xml' ? (this._xmlContent || '') : '';
      const tool2Json = mode === 'json' ? (this.byId('jsonInput').getValue().trim()) : '';

      this.byId('importBusy').setVisible(true);
      this._model.setProperty('/canImport', false);

      fetch('/odata/v4/planner/importAtcData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xmlContent, tool2Json })
      })
        .then(r => r.json())
        .then(data => {
          this.byId('importBusy').setVisible(false);
          if (data.error || !data.sessionId) {
            const msg = data.message || '导入失败';
            this._showImportMsg(msg, 'Error');
            this._model.setProperty('/canImport', true);
            return;
          }
          this._sessionId = data.sessionId;
          this._model.setProperty('/importValid', true);
          this._model.setProperty('/importSummary',
            '已导入 ' + data.programCount + ' 个程序，Session: ' + data.sessionId.substring(0, 8) + '...');
          this._goToStep('teamStep');
        })
        .catch(err => {
          this.byId('importBusy').setVisible(false);
          this._showImportMsg('网络错误：' + err.message, 'Error');
          this._model.setProperty('/canImport', true);
        });
    },

    _showImportMsg: function (text, type) {
      this._model.setProperty('/importMessage', text);
      this._model.setProperty('/importMsgType', type || 'Information');
      this.byId('importMsg').setVisible(true);
    },

    // ─── Step 2: Generate Plan ─────────────────────────────────────────────

    onGeneratePlan: function () {
      if (!this._sessionId) {
        MessageToast.show('请先导入数据');
        return;
      }

      const teamConfig = this._model.getProperty('/teamConfig');

      this.byId('generateBusy').setVisible(true);
      this._model.setProperty('/generateMessage', '');

      fetch('/odata/v4/planner/generatePlan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this._sessionId,
          teamConfig: JSON.stringify(teamConfig)
        })
      })
        .then(r => r.json())
        .then(data => {
          this.byId('generateBusy').setVisible(false);
          if (data.error || !data.planJson) {
            this._showGenerateMsg(data.message || '生成失败', 'Error');
            return;
          }
          const plan = JSON.parse(data.planJson);
          this._model.setProperty('/plan', plan);

          // Build developer list for dropdowns
          const devCount = teamConfig.teamSize || 2;
          const devList = [];
          for (let i = 1; i <= devCount; i++) {
            devList.push({ dev: 'Dev ' + i });
          }
          this._model.setProperty('/developerList', devList);

          this._model.setProperty('/planGenerated', true);
          this._goToStep('planStep');
        })
        .catch(err => {
          this.byId('generateBusy').setVisible(false);
          this._showGenerateMsg('网络错误：' + err.message, 'Error');
        });
    },

    _showGenerateMsg: function (text, type) {
      this._model.setProperty('/generateMessage', text);
      this._model.setProperty('/generateMsgType', type || 'Information');
      this.byId('generateMsg').setVisible(true);
    },

    // ─── Step 3: Plan Adjustment + Export ─────────────────────────────────

    onAssigneeChange: function () {
      // Plan is modified in the model via binding; persist via updatePlan
      this._savePlan();
    },

    onMoveItem: function (oEvent) {
      const ctx = oEvent.getSource().getBindingContext();
      const item = ctx.getObject();
      this._model.setProperty('/moveTarget', Object.assign({}, item, {
        _sourcePath: ctx.getPath()
      }));
      this.byId('moveDialog').open();
    },

    onConfirmMove: function () {
      const target = this._model.getProperty('/moveTarget');
      if (!target) { return; }

      const targetSprintNum = parseInt(this.byId('targetSprintSelect').getSelectedKey(), 10);
      const plan = this._model.getProperty('/plan');
      const sprints = plan.sprints;

      // Find source sprint and remove item
      let movedItem = null;
      for (const sprint of sprints) {
        const idx = sprint.items.findIndex(i => i.program === target.program);
        if (idx >= 0) {
          movedItem = sprint.items.splice(idx, 1)[0];
          break;
        }
      }

      if (!movedItem) {
        this.byId('moveDialog').close();
        return;
      }

      // Add to target sprint
      const targetSprint = sprints.find(s => s.sprintNumber === targetSprintNum);
      if (targetSprint) {
        targetSprint.items.push(movedItem);
      }

      // Remove empty sprints and renumber
      const nonEmpty = sprints.filter(s => s.items.length > 0);
      nonEmpty.forEach((s, i) => { s.sprintNumber = i + 1; });
      plan.sprints = nonEmpty;
      plan.summary.totalSprints = nonEmpty.length;

      this._model.setProperty('/plan', plan);
      this._savePlan();
      this.byId('moveDialog').close();
      MessageToast.show('已移动 ' + movedItem.program);
    },

    onCancelMove: function () {
      this.byId('moveDialog').close();
    },

    _savePlan: function () {
      if (!this._sessionId) { return; }
      const plan = this._model.getProperty('/plan');
      fetch('/odata/v4/planner/updatePlan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this._sessionId,
          planJson: JSON.stringify(plan)
        })
      }).catch(() => { /* silent */ });
    },

    onExportExcel: function () {
      if (!this._sessionId) { return; }
      // Save latest plan before export
      this._savePlan();
      window.location.href = '/export/excel/' + this._sessionId;
    },

    onExportPdf: function () {
      if (!this._sessionId) { return; }
      this._savePlan();
      window.location.href = '/export/pdf/' + this._sessionId;
    },

    onRegenerate: function () {
      this._model.setProperty('/planGenerated', false);
      this._model.setProperty('/generateMessage', '');
      this.byId('generateMsg').setVisible(false);
      this._goToStep('teamStep');
    },

    // ─── Helpers ───────────────────────────────────────────────────────────

    _goToStep: function (stepId) {
      const wizard = this.byId('plannerWizard');
      const step = this.byId(stepId);
      if (wizard && step) {
        wizard.goToStep(step, true);
      }
    }

  });
});
