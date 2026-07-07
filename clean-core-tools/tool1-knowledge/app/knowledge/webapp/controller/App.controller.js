sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox',
  'sap/m/Panel',
  'sap/m/VBox',
  'sap/m/HBox',
  'sap/m/Text',
  'sap/m/Title',
  'sap/m/ObjectStatus',
  'sap/m/Toolbar'
], function (Controller, JSONModel, MessageToast, MessageBox, Panel, VBox, HBox, Text, Title, ObjectStatus, Toolbar) {
  'use strict';

  return Controller.extend('knowledge.controller.App', {

    onInit: function () {
      this.getView().setModel(new JSONModel({}));
      this._ssoConfirmed = false;
      this._lastNoteQuery = '';
      this._lastNoteQueryEN = '';
    },

    // Tab 1: Stream explanation via SSE
    onExplain: function (oEvent) {
      const term = oEvent.getParameter('query') || oEvent.getSource().getValue();
      if (!term.trim()) { return; }

      const resultControl = this.byId('explainResult');
      const busyIndicator = this.byId('explainBusy');

      resultControl.setHtmlText('');
      busyIndicator.setVisible(true);

      let accumulated = '';
      const evtSource = new EventSource('/stream/explain?term=' + encodeURIComponent(term));

      evtSource.onmessage = function (e) {
        if (e.data === '[DONE]') {
          evtSource.close();
          busyIndicator.setVisible(false);
          return;
        }
        try {
          const chunk = JSON.parse(e.data);
          if (chunk.error) {
            MessageBox.error(chunk.error);
            evtSource.close();
            busyIndicator.setVisible(false);
            return;
          }
          accumulated += chunk.text;
          resultControl.setHtmlText(accumulated.replace(/\n/g, '<br>'));
        } catch (err) { /* ignore parse errors on partial chunks */ }
      };

      evtSource.onerror = function () {
        evtSource.close();
        busyIndicator.setVisible(false);
        MessageBox.error('连接失败，请重试');
      };
    },

    // Tab 2: Classify objects
    onClassify: function () {
      const input = this.byId('classifyInput').getValue().trim();
      if (!input) { MessageToast.show('请输入至少一个对象名'); return; }

      const objects = input.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      const model = this.getView().getModel();
      const busyIndicator = this.byId('classifyBusy');

      busyIndicator.setVisible(true);
      model.setProperty('/classifyResults', []);

      fetch('/odata/v4/knowledge/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects: objects })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          model.setProperty('/classifyResults', data.value || data);
          busyIndicator.setVisible(false);
        })
        .catch(function (err) {
          busyIndicator.setVisible(false);
          MessageBox.error('分级失败：' + err.message);
        });
    },

    // Tab 3: Recommend replacements — rendered as expandable Panels
    onRecommend: function (oEvent) {
      const deprecatedObject = oEvent.getParameter('query') || oEvent.getSource().getValue();
      if (!deprecatedObject.trim()) { return; }

      const busyIndicator = this.byId('recommendBusy');
      const container = this.byId('recommendResults');

      busyIndicator.setVisible(true);
      // Clear previous results
      container.destroyItems ? container.destroyItems() : container.removeAllItems();

      fetch('/odata/v4/knowledge/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deprecatedObject: deprecatedObject })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          busyIndicator.setVisible(false);
          const results = data.value || data;
          if (!Array.isArray(results) || results.length === 0) {
            container.addItem(new Text({ text: '未找到替代方案，请换一个对象名重试。' }).addStyleClass('sapUiSmallMargin'));
            return;
          }
          results.forEach(function (item, idx) {
            // Type badge color
            var stateMap = {
              'OData API': 'Success',
              'RAP BO': 'Success',
              'CDS View': 'Information',
              'Released BAdI': 'Information',
              'Key User Extension': 'Warning',
              'Side-by-Side BTP': 'Warning'
            };
            var badgeState = stateMap[item.type] || 'None';

            // Panel header: name + type badge
            var headerBox = new HBox({
              alignItems: 'Center',
              items: [
                new Title({ text: (idx + 1) + '. ' + (item.replacementName || '未知') }).addStyleClass('sapUiSmallMarginEnd'),
                new ObjectStatus({ text: item.type || '', state: badgeState })
              ]
            }).addStyleClass('sapUiSmallMarginBegin');

            // Panel content: migration note
            var contentBox = new VBox({
              items: [
                new Text({ text: item.migrationNote || '暂无说明', wrapping: true }).addStyleClass('sapUiSmallMargin')
              ]
            });

            var panel = new Panel({
              expandable: true,
              expanded: idx === 0,
              headerToolbar: new Toolbar({
                content: [headerBox]
              }),
              content: [contentBox]
            }).addStyleClass('sapUiSmallMarginBottom');

            container.addItem(panel);
          });
        })
        .catch(function (err) {
          busyIndicator.setVisible(false);
          MessageBox.error('推荐失败：' + err.message);
        });
    },

    // Tab 4: SAP Note Search
    onSearchNote: function (oEvent) {
      const query = oEvent.getParameter('query') || oEvent.getSource().getValue();
      if (!query.trim()) { return; }

      this._lastNoteQuery = query.trim();
      const that = this;

      const model = this.getView().getModel();
      const busyIndicator = this.byId('noteBusy');
      const loginHint = this.byId('noteLoginHint');
      const portalBtn = this.byId('notePortalBtn');

      busyIndicator.setVisible(true);
      loginHint.setVisible(false);
      portalBtn.setVisible(false);
      this.byId('noteCopyHint').setVisible(false);
      model.setProperty('/noteResults', []);

      fetch('/odata/v4/knowledge/searchNote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          const results = (data.value || data).filter(function (r) {
            return r.contentSource !== 'portal-link';
          });
          model.setProperty('/noteResults', results);
          busyIndicator.setVisible(false);
          loginHint.setVisible(results.length > 0);
          portalBtn.setVisible(true);
          // Store the English translation for use in portal jump and clipboard copy
          if (results.length > 0 && results[0].englishQuery) {
            that._lastNoteQueryEN = results[0].englishQuery;
          } else {
            that._lastNoteQueryEN = that._lastNoteQuery;
          }
        })
        .catch(function (err) {
          busyIndicator.setVisible(false);
          MessageBox.error('SAP Note 搜索失败：' + err.message);
        });
    },

    // Open SAP Support Portal Note search in browser
    onOpenNotePortal: function () {
      const queryEN = this._lastNoteQueryEN || this._lastNoteQuery || '';
      const queryCN = this._lastNoteQuery || queryEN;
      const url = 'https://me.sap.com/notes/search?q=' + encodeURIComponent(queryEN);
      const copyHint = this.byId('noteCopyHint');

      // Copy English query to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(queryEN).catch(function () { /* ignore */ });
      }

      // Show persistent hint strip on current page
      var hintText = queryEN !== queryCN
        ? '英文搜索词已复制到剪贴板：' + queryEN + '\n（原始输入：' + queryCN + '）\n请在 SAP Support Portal 搜索框中按 Ctrl+V 粘贴，然后点击搜索。'
        : '搜索词已复制到剪贴板：' + queryEN + '\n请在 SAP Support Portal 搜索框中按 Ctrl+V 粘贴，然后点击搜索。';
      copyHint.setText(hintText);
      copyHint.setVisible(true);

      // Open portal directly — no confirm dialog
      window.open(url, '_blank');
    },

    // Open SAP Note URL — only prompts SSO confirmation once per session
    onNotePress: function (oEvent) {
      const ctx = oEvent.getSource().getBindingContext();
      const url = ctx && ctx.getProperty('url');
      if (!url) { return; }

      if (this._ssoConfirmed) {
        window.open(url, '_blank');
        return;
      }

      const that = this;
      MessageBox.confirm(
        '查看完整 SAP Note 内容需要 SSO 登录 SAP Support Portal。\n点击确认将跳转到登录页面，请完成授权后即可查看。\n（本次确认后，后续链接将直接跳转）',
        {
          title: '需要 SSO 登录',
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          emphasizedAction: MessageBox.Action.OK,
          onClose: function (sAction) {
            if (sAction === MessageBox.Action.OK) {
              that._ssoConfirmed = true;
              window.open(url, '_blank');
            }
          }
        }
      );
    }
  });
});
