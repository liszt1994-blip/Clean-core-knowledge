sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageBox',
  'sap/m/VBox',
  'sap/m/HBox',
  'sap/m/Text',
  'sap/m/FormattedText',
  'sap/m/Title',
  'sap/m/Button',
  'sap/m/Panel',
  'sap/m/ObjectStatus',
  'sap/m/MessageStrip',
  'sap/m/Link',
  'sap/ui/core/HTML'
], function (
  Controller, JSONModel, MessageBox,
  VBox, HBox, Text, FormattedText, Title, Button, Panel, ObjectStatus, MessageStrip, Link, HTML
) {
  'use strict';

  // Tier -> ObjectStatus state mapping
  var TIER_STATE = { A: 'Success', B: 'Warning', C: 'Error', D: 'Error' };

  return Controller.extend('knowledge.controller.App', {

    onInit: function () {
      var model = new JSONModel({
        messages: [],
        inputMode: 'auto',
        inputText: '',
        busy: false
      });
      this.getView().setModel(model);
      this._addWelcomeMessage();
    },

    _addWelcomeMessage: function () {
      var container = this.byId('chatHistory');
      var welcomeBox = new VBox({
        width: '100%',
        items: [
          new MessageStrip({
            text: '你好！我可以帮你：\n• 分析 ABAP 代码中的 Clean Core 违规\n• 解读 ATC check 报错并给出修复方案\n• 查询对象分级和替代 API\n• 解释 Clean Core 概念',
            type: 'Information',
            showIcon: true
          })
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
      container.addItem(welcomeBox);
    },

    onModeChange: function (oEvent) {
      var key = oEvent.getParameter('item').getKey();
      this.getView().getModel().setProperty('/inputMode', key);
      var placeholders = {
        auto:     '输入问题，或粘贴 ABAP 代码 / ATC 报错...',
        code:     '粘贴 ABAP 代码片段，Agent 将识别所有不合规对象...',
        atc:      '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...',
        question: '输入 Clean Core 或 ATC 相关问题...'
      };
      this.byId('chatInput').setPlaceholder(placeholders[key] || placeholders.auto);
    },

    onSend: function () {
      var input = this.byId('chatInput');
      var message = input.getValue().trim();
      if (!message) return;

      var model = this.getView().getModel();
      var mode = model.getProperty('/inputMode') || 'auto';

      var history = (model.getProperty('/messages') || [])
        .slice(-6)
        .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

      this._addUserBubble(message, mode);
      input.setValue('');
      model.setProperty('/busy', true);

      var that = this;

      if (mode === 'question') {
        that._streamExplain(message);
        return;
      }

      fetch('/odata/v4/knowledge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, mode: mode, history: history })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          model.setProperty('/busy', false);
          var reply = data.value || data;
          // CDS flattened return: violations and notes are JSON strings
          try { reply.violations = JSON.parse(reply.violations || '[]'); } catch (e) { reply.violations = []; }
          try { reply.notes = JSON.parse(reply.notes || '[]'); } catch (e) { reply.notes = []; }
          // Build rewrite object from flat fields
          if (reply.rewriteRewritten) {
            reply.rewrite = { original: reply.rewriteOriginal || '', rewritten: reply.rewriteRewritten };
          } else {
            reply.rewrite = null;
          }
          that._addAgentBubble(reply);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          MessageBox.error('请求失败：' + err.message);
        });
    },

    _streamExplain: function (term) {
      var model = this.getView().getModel();
      var that = this;
      var bubbleText = new FormattedText({ htmlText: '', width: '100%' });
      var bubbleBox = that._buildAgentShell([bubbleText]);
      that.byId('chatHistory').addItem(bubbleBox);

      var accumulated = '';
      var evtSource = new EventSource('/stream/explain?term=' + encodeURIComponent(term));

      evtSource.onmessage = function (e) {
        if (e.data === '[DONE]') {
          evtSource.close();
          model.setProperty('/busy', false);
          var msgs = model.getProperty('/messages') || [];
          msgs.push({ role: 'agent', replyType: 'explain', text: accumulated, textSummary: accumulated.slice(0, 120) });
          model.setProperty('/messages', msgs);
          return;
        }
        try {
          var chunk = JSON.parse(e.data);
          if (chunk.error) { evtSource.close(); model.setProperty('/busy', false); return; }
          accumulated += chunk.text;
          bubbleText.setHtmlText(accumulated.replace(/\n/g, '<br>'));
        } catch (err) { /* ignore partial parse errors */ }
      };

      evtSource.onerror = function () {
        evtSource.close();
        model.setProperty('/busy', false);
      };
    },

    _addUserBubble: function (message, mode) {
      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      msgs.push({ role: 'user', mode: mode, text: message, textSummary: message.slice(0, 120) });
      model.setProperty('/messages', msgs);

      var isCode = mode === 'code' || /CALL FUNCTION|SELECT\s+\*|CLASS\s+/i.test(message);
      var content = isCode
        ? new HTML({ content: '<pre style="background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:4px;overflow:auto;font-size:12px;white-space:pre-wrap">' + this._escapeHtml(message) + '</pre>' })
        : new Text({ text: message, wrapping: true });

      var bubble = new HBox({
        justifyContent: 'End',
        width: '100%',
        items: [
          new VBox({
            items: [content],
            width: '75%'
          }).addStyleClass('sapUiSmallPadding').addStyleClass('cleanCoreUserBubble')
        ]
      }).addStyleClass('sapUiSmallMarginBottom');

      this.byId('chatHistory').addItem(bubble);
      this._scrollToBottom();
    },

    _addAgentBubble: function (reply) {
      var items = [];
      var replyType = reply.replyType || 'general';

      if (reply.text) {
        items.push(new FormattedText({
          htmlText: reply.text.replace(/\n/g, '<br>'),
          width: '100%'
        }).addStyleClass('sapUiSmallMarginBottom'));
      }

      if (Array.isArray(reply.violations) && reply.violations.length > 0) {
        reply.violations.forEach(function (v) {
          items.push(this._buildViolationCard(v));
        }.bind(this));
      }

      if (reply.rewrite && reply.rewrite.rewritten) {
        var diffPanel = this._buildCodeDiffPanel(reply.rewrite);
        var toggleBtn = new Button({
          text: '查看改写代码',
          type: 'Transparent',
          press: function () {
            var expanded = diffPanel.getExpanded();
            diffPanel.setExpanded(!expanded);
            toggleBtn.setText(expanded ? '查看改写代码' : '收起改写代码');
          }
        }).addStyleClass('sapUiSmallMarginTop');
        items.push(toggleBtn);
        items.push(diffPanel);
      }

      if (Array.isArray(reply.notes) && reply.notes.length > 0) {
        var notesBox = new VBox({ items: [] }).addStyleClass('sapUiSmallMarginTop');
        notesBox.addItem(new Text({ text: '相关 SAP Note：' }).addStyleClass('sapUiSmallMarginBottom'));
        reply.notes.forEach(function (n) {
          notesBox.addItem(new Link({
            text: (n.noteNumber ? 'Note ' + n.noteNumber + ': ' : '') + n.title,
            href: n.url,
            target: '_blank'
          }));
        });
        items.push(notesBox);
      }

      var bubbleBox = this._buildAgentShell(items);
      this.byId('chatHistory').addItem(bubbleBox);

      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      msgs.push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });
      model.setProperty('/messages', msgs);

      this._scrollToBottom();
    },

    _buildAgentShell: function (items) {
      return new HBox({
        width: '100%',
        items: [
          new VBox({ items: items, width: '90%' })
            .addStyleClass('sapUiSmallPadding')
            .addStyleClass('cleanCoreAgentBubble')
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    _buildViolationCard: function (v) {
      var state = TIER_STATE[v.tier] || 'None';
      var headerBox = new HBox({
        alignItems: 'Center',
        items: [
          new ObjectStatus({ text: 'Tier ' + v.tier, state: state }).addStyleClass('sapUiSmallMarginEnd'),
          new Title({ text: v.objectName, level: 'H5' }).addStyleClass('sapUiSmallMarginEnd'),
          v.line ? new Text({ text: '第 ' + v.line + ' 行' }).addStyleClass('sapUiTinyMarginEnd') : new Text({ text: '' })
        ]
      });

      var details = [];
      if (v.state) details.push(new Text({ text: '状态：' + v.state, wrapping: true }));
      if (v.replacement) details.push(new Text({ text: '建议替换：' + (v.replacementType ? v.replacementType + ' ' : '') + v.replacement, wrapping: true }));
      if (v.note) details.push(new Text({ text: v.note, wrapping: true }).addStyleClass('sapUiSmallMarginTop'));

      return new Panel({
        expandable: true,
        expanded: false,
        headerToolbar: new sap.m.Toolbar({ content: [headerBox] }),
        content: [new VBox({ items: details }).addStyleClass('sapUiSmallMargin')]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    _buildCodeDiffPanel: function (rewrite) {
      var that = this;
      var copyBtn = new Button({
        text: '复制代码',
        type: 'Transparent',
        press: function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(rewrite.rewritten).catch(function () {});
          }
        }
      });

      var diffBox = new HBox({
        width: '100%',
        items: [
          new VBox({
            width: '50%',
            items: [
              new Title({ text: '原代码', level: 'H6' }),
              new HTML({ content: '<pre style="background:#1e1e1e;color:#f44747;padding:8px;border-radius:4px;font-size:11px;overflow:auto;white-space:pre-wrap">' + that._escapeHtml(rewrite.original || '') + '</pre>' })
            ]
          }).addStyleClass('sapUiSmallMarginEnd'),
          new VBox({
            width: '50%',
            items: [
              new Title({ text: '改写后', level: 'H6' }),
              new HTML({ content: '<pre style="background:#1e1e1e;color:#4ec9b0;padding:8px;border-radius:4px;font-size:11px;overflow:auto;white-space:pre-wrap">' + that._escapeHtml(rewrite.rewritten || '') + '</pre>' })
            ]
          })
        ]
      });

      return new Panel({
        expandable: true,
        expanded: false,
        headerText: '代码对比',
        content: [
          new VBox({ items: [diffBox, copyBtn] }).addStyleClass('sapUiSmallMargin')
        ]
      });
    },

    onClearChat: function () {
      var container = this.byId('chatHistory');
      container.destroyItems();
      this.getView().getModel().setProperty('/messages', []);
      this._addWelcomeMessage();
    },

    _scrollToBottom: function () {
      var page = this.byId('mainPage');
      if (page && page.scrollTo) {
        setTimeout(function () { page.scrollTo(0, 99999); }, 100);
      }
    },

    _escapeHtml: function (str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

  });
});
