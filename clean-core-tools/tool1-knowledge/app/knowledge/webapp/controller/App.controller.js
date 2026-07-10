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
  'sap/m/TextArea',
  'sap/m/Input',
  'sap/m/BusyIndicator',
  'sap/m/Toolbar',
  'sap/m/Popover',
  'sap/m/List',
  'sap/m/StandardListItem',
  'sap/m/IconTabBar',
  'sap/m/IconTabFilter',
  'sap/m/Table',
  'sap/m/Column',
  'sap/m/ColumnListItem',
  'sap/ui/core/HTML'
], function (
  Controller, JSONModel, MessageBox,
  VBox, HBox, Text, FormattedText, Title, Button, Panel, ObjectStatus, MessageStrip, Link,
  TextArea, Input, BusyIndicator, Toolbar,
  Popover, List, StandardListItem,
  IconTabBar, IconTabFilter, Table, Column, ColumnListItem,
  HTML
) {
  'use strict';

  var TIER_STATE = { A: 'Success', B: 'Warning', C: 'Error', D: 'Error' };

  return Controller.extend('knowledge.controller.App', {

    onInit: function () {
      var model = new JSONModel({
        messages: [],
        inputText: '',
        busy: false
      });
      this.getView().setModel(model);
      this._inputHistory = [];

      // Tab 独立历史
      this._TAB_KEYS = ['concept', 'code', 'atc', 'search'];
      this._currentTab = 'concept';
      this._chatHistories = {};
      this._messages = { concept: [], code: [], atc: [], search: [] };

      var TAB_CONFIG = {
        concept: { icon: 'sap-icon://hint',        text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                          welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
        code:    { icon: 'sap-icon://source-code',  text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                          welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        atc:     { icon: 'sap-icon://alert',         text: 'ATC Check',  placeholder: '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...',  welcome: '请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。' },
        search:  { icon: 'sap-icon://search',        text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                       welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' }
      };
      this._TAB_CONFIG = TAB_CONFIG;

      var that = this;
      var oView = this.getView();

      // Busy indicator（所有 Tab 共用）
      this._busyIndicator = new BusyIndicator({ visible: false })
        .addStyleClass('sapUiSmallMarginBegin sapUiSmallMarginBottom');

      // Chat input（Tab 1/2/3 共用）
      this._chatInput = new TextArea({
        placeholder: TAB_CONFIG['concept'].placeholder,
        rows: 3,
        growing: false,
        width: '100%'
      });

      // Send button（Tab 1/2/3 共用）
      this._sendBtn = new Button({
        text: '发送',
        type: 'Emphasized',
        press: [this.onSend, this]
      });

      // Tab 4 搜索控件
      this._noteSearchInput = new TextArea({
        placeholder: '搜索 SAP Note 或文档...',
        rows: 3,
        growing: false,
        width: '100%'
      });
      this._noteSearchBtn = new Button({
        text: '发送',
        type: 'Emphasized',
        press: [this.onSearchNote, this]
      });

      // 各 Tab 独立 VBox 消息容器
      this._TAB_KEYS.forEach(function (key) {
        that._chatHistories[key] = new VBox({ width: '100%' })
          .addStyleClass('sapUiSmallMarginBeginEnd sapUiSmallMarginTop');
      });

      // IconTabBar
      this._tabBar = new IconTabBar({
        expandable: false,
        stretchContentHeight: false,
        select: [this.onTabSelect, this]
      });
      this._TAB_KEYS.forEach(function (key) {
        var cfg = TAB_CONFIG[key];
        that._tabBar.addItem(new IconTabFilter({
          key: key,
          icon: cfg.icon,
          text: cfg.text
        }));
      });

      oView.addEventDelegate({
        onAfterRendering: function () {
          var wrap = document.getElementById('ccMainWrap');
          if (!wrap || wrap.dataset.initialized) return;
          wrap.dataset.initialized = 'true';

          // ── Tab Bar 区域 ──────────────────────────────────────────
          var tabBarWrap = document.createElement('div');
          tabBarWrap.id = 'ccTabBarWrap';
          tabBarWrap.style.cssText = 'flex-shrink:0;';
          wrap.appendChild(tabBarWrap);
          that._tabBar.placeAt('ccTabBarWrap');

          // ── 消息滚动区 ────────────────────────────────────────────
          var scrollDiv = document.createElement('div');
          scrollDiv.id = 'ccScrollArea';
          scrollDiv.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;position:relative;';
          wrap.appendChild(scrollDiv);

          // 各 Tab 的 VBox 放入同一滚动区，通过 display 切换
          that._TAB_KEYS.forEach(function (key) {
            var containerId = 'ccChat_' + key;
            var containerDiv = document.createElement('div');
            containerDiv.id = containerId;
            containerDiv.style.cssText = key === 'concept' ? 'display:block' : 'display:none';
            scrollDiv.appendChild(containerDiv);
            that._chatHistories[key].placeAt(containerId);
          });

          // Tab 4 搜索结果表格容器
          var searchResultDiv = document.createElement('div');
          searchResultDiv.id = 'ccSearchResult';
          searchResultDiv.style.cssText = 'display:none;padding:8px 16px;';
          scrollDiv.appendChild(searchResultDiv);

          // ── Busy 行 ───────────────────────────────────────────────
          var busyDiv = document.createElement('div');
          busyDiv.id = 'ccBusyRow';
          wrap.appendChild(busyDiv);
          that._busyIndicator.placeAt('ccBusyRow');

          // ── 对话输入区（Tab 1/2/3 共用） ──────────────────────────
          var inputDiv = document.createElement('div');
          inputDiv.id = 'ccInputArea';
          inputDiv.style.cssText = 'flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(inputDiv);

          var inputSendRow = document.createElement('div');
          inputSendRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;';
          inputDiv.appendChild(inputSendRow);

          var textAreaWrap = document.createElement('div');
          textAreaWrap.style.cssText = 'flex:1;min-width:0;';
          inputSendRow.appendChild(textAreaWrap);

          var sendWrap = document.createElement('div');
          sendWrap.style.cssText = 'flex-shrink:0;';
          inputSendRow.appendChild(sendWrap);

          that._chatInput.placeAt(textAreaWrap);
          that._sendBtn.placeAt(sendWrap);

          // ── Tab 4 搜索输入区 ───────────────────────────────────────
          var searchInputDiv = document.createElement('div');
          searchInputDiv.id = 'ccSearchInputArea';
          searchInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(searchInputDiv);

          var searchRow = document.createElement('div');
          searchRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;';
          searchInputDiv.appendChild(searchRow);

          var noteInputWrap = document.createElement('div');
          noteInputWrap.style.cssText = 'flex:1;min-width:0;';
          searchRow.appendChild(noteInputWrap);

          var noteBtnWrap = document.createElement('div');
          noteBtnWrap.style.cssText = 'flex-shrink:0;';
          searchRow.appendChild(noteBtnWrap);

          that._noteSearchInput.placeAt(noteInputWrap);
          that._noteSearchBtn.placeAt(noteBtnWrap);

          // TextArea 没有 attachSubmit，监听 DOM keydown 触发搜索（Shift+Enter 换行，Enter 搜索）
          that._noteSearchInput.addEventDelegate({
            onkeydown: function (oEvent) {
              if (oEvent.key === 'Enter' && !oEvent.shiftKey) {
                oEvent.preventDefault();
                that.onSearchNote();
              }
            }
          });

          // 各 Tab 添加欢迎语
          that._TAB_KEYS.forEach(function (key) {
            that._addWelcomeMessage(key);
          });
        }
      });
    },

    // ── Tab 切换 ─────────────────────────────────────────────────────────────
    onTabSelect: function (oEvent) {
      var key = oEvent.getParameter('key');
      this._currentTab = key;

      var that = this;
      this._TAB_KEYS.forEach(function (k) {
        var el = document.getElementById('ccChat_' + k);
        if (el) el.style.display = k === key ? 'block' : 'none';
      });

      var inputArea = document.getElementById('ccInputArea');
      var searchInputArea = document.getElementById('ccSearchInputArea');
      var searchResult = document.getElementById('ccSearchResult');
      if (key === 'search') {
        if (inputArea) inputArea.style.display = 'none';
        if (searchInputArea) searchInputArea.style.display = 'block';
        if (searchResult) searchResult.style.display = 'block';
      } else {
        if (inputArea) inputArea.style.display = 'block';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult) searchResult.style.display = 'none';
        this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
      }

      this._scrollToBottom();
    },

    // ── 欢迎语 ───────────────────────────────────────────────────────────────
    _addWelcomeMessage: function (tabKey) {
      var key = tabKey || this._currentTab;
      var welcomeText = this._TAB_CONFIG[key].welcome;
      if (!welcomeText) return;

      var welcomeBox = new VBox({
        width: '100%',
        items: [
          new MessageStrip({
            text: welcomeText,
            type: 'Information',
            showIcon: true
          })
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
      this._chatHistories[key].addItem(welcomeBox);
    },

    // ── SAP Note 搜索 ────────────────────────────────────────────────────────
    onSearchNote: function () {
      var query = this._noteSearchInput.getValue();
      if (!query || !query.trim()) return;

      var model = this.getView().getModel();
      if (model.getProperty('/busy')) return;
      model.setProperty('/busy', true);
      this._busyIndicator.setVisible(true);
      this._noteSearchBtn.setEnabled(false);
      var that = this;

      fetch('/odata/v4/knowledge/searchNote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._noteSearchBtn.setEnabled(true);
          var results = data.value || data;
          var arr = Array.isArray(results) ? results : [];
          // Save the translated English query returned by backend for clipboard copy
          that._lastEnglishQuery = (arr.length > 0 && arr[0].englishQuery) ? arr[0].englishQuery : query.trim();
          // Record into input history
          that._inputHistory.unshift({ mode: 'search', modeLabel: that._TAB_CONFIG['search'].text, text: query.trim() });
          if (that._inputHistory.length > 50) that._inputHistory.pop();
          that._renderSearchResults(arr);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._noteSearchBtn.setEnabled(true);
          MessageBox.error('Note 搜索失败：' + err.message);
        });
    },

    _renderSearchResults: function (results) {
      var resultDiv = document.getElementById('ccSearchResult');
      if (!resultDiv) return;

      if (this._searchTable) {
        this._searchTable.destroy();
        this._searchTable = null;
      }
      if (this._searchPortalBtn) {
        this._searchPortalBtn.destroy();
        this._searchPortalBtn = null;
      }

      if (results.length === 0) {
        resultDiv.innerHTML = '<p style="color:#888;padding:16px;font-size:13px">未找到相关结果，请换个关键词再试。</p>';
        return;
      }
      resultDiv.innerHTML = '';

      var that = this;

      // ── "在 SAP Support Portal 中搜索" 按钮（表格上方）─────────────────────
      var q = this._lastEnglishQuery || '';
      var payload = JSON.stringify({ q: q, tab: 'All' });
      var portalUrl = 'https://me.sap.com/knowledge/search/' + encodeURIComponent(payload);
      this._searchPortalBtn = new Button({
        text: '搜索相关Note',
        type: 'Ghost',
        icon: 'sap-icon://search',
        press: function () { window.open(portalUrl, '_blank'); }
      }).addStyleClass('sapUiSmallMarginBottom');
      this._searchPortalBtn.placeAt(resultDiv);

      // ── 结果表格 ────────────────────────────────────────────────────────────
      this._searchTable = new Table({
        columns: [
          new Column({ width: '40%', header: new Text({ text: '标题' }) }),
          new Column({ header: new Text({ text: '摘要' }) })
        ]
      });

      results.forEach(function (n) {
        var titleCell = new Link({ text: n.title || '', href: n.url || '#', target: '_blank', wrapping: true });
        var summaryCell = new FormattedText({ htmlText: n.summary || '', width: '100%' });

        that._searchTable.addItem(new ColumnListItem({
          cells: [titleCell, summaryCell]
        }));
      });

      this._searchTable.placeAt(resultDiv);
    },

    // ── 发送消息 ─────────────────────────────────────────────────────────────
    onSend: function () {
      var message = this._chatInput.getValue().trim();
      if (!message) return;

      var model = this.getView().getModel();
      if (model.getProperty('/busy')) return;

      var TAB_MODE = { concept: 'auto', code: 'code', atc: 'atc' };
      var mode = TAB_MODE[this._currentTab] || 'auto';

      var history = (this._messages[this._currentTab] || [])
        .slice(-6)
        .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

      this._addUserBubble(message, this._currentTab);
      this._chatInput.setValue('');

      this._inputHistory.unshift({ mode: mode, modeLabel: this._TAB_CONFIG[this._currentTab].text, text: message });
      if (this._inputHistory.length > 50) this._inputHistory.pop();

      model.setProperty('/busy', true);
      this._busyIndicator.setVisible(true);
      this._sendBtn.setEnabled(false);

      var that = this;
      var tabKey = this._currentTab;

      fetch('/odata/v4/knowledge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, mode: mode, history: history })
      })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._sendBtn.setEnabled(true);
          var reply = data.value || data;
          try { reply.violations = JSON.parse(reply.violations || '[]'); } catch (e) { reply.violations = []; }
          try { reply.notes = JSON.parse(reply.notes || '[]'); } catch (e) { reply.notes = []; }
          if (reply.rewriteRewritten) {
            reply.rewrite = { original: reply.rewriteOriginal || '', rewritten: reply.rewriteRewritten };
          } else {
            reply.rewrite = null;
          }
          that._addAgentBubble(reply, tabKey);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._sendBtn.setEnabled(true);
          MessageBox.error('请求失败：' + err.message);
        });
    },

    // ── 气泡渲染 ─────────────────────────────────────────────────────────────
    _addUserBubble: function (message, tabKey) {
      var key = tabKey || this._currentTab;
      this._messages[key].push({ role: 'user', text: message, textSummary: message.slice(0, 120) });

      var isCode = /CALL FUNCTION|SELECT\s+\*|CLASS\s+|FUNCTION\s+|METHOD\s+|ENDMETHOD|ENDCLASS/i.test(message);
      var content = isCode
        ? new HTML({ content: '<pre style="background:#0f2744;color:#a8d4ff;padding:8px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap;margin:0">' + this._escapeHtml(message) + '</pre>' })
        : new HTML({ content: '<span style="font-size:14px;color:#fff;line-height:1.5;white-space:pre-wrap;word-break:break-word">' + this._escapeHtml(message) + '</span>' });

      var bubble = new HBox({
        justifyContent: 'Start',
        alignItems: 'Start',
        width: '100%',
        items: [
          new VBox({
            items: [content]
          }).addStyleClass('cleanCoreUserBubble')
        ]
      }).addStyleClass('sapUiSmallMarginBottom');

      var vbox = bubble.getItems()[0];
      vbox.addEventDelegate({
        onAfterRendering: function () {
          var dom = vbox.getDomRef();
          if (dom) {
            dom.style.background = '#0a6ed1';
            dom.style.borderRadius = '2px 12px 12px 12px';
            dom.style.maxWidth = '72%';
            dom.style.wordBreak = 'break-word';
            dom.style.padding = '10px 14px';
          }
        }
      });

      this._chatHistories[key].addItem(bubble);
      this._scrollToBottom();
    },

    _addAgentBubble: function (reply, tabKey) {
      var key = tabKey || this._currentTab;
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
        items.push(this._buildCodeDiffPanel(reply.rewrite));
      }

      if (Array.isArray(reply.notes) && reply.notes.length > 0) {
        var notesBox = new VBox({ items: [] }).addStyleClass('sapUiSmallMarginTop');
        notesBox.addItem(new Text({ text: '相关 SAP Note：' }).addStyleClass('sapUiSmallMarginBottom'));
        reply.notes.forEach(function (n) {
          var noteRow = new HBox({
            alignItems: 'Center',
            items: []
          }).addStyleClass('sapUiTinyMarginBottom');

          noteRow.addItem(new Link({
            text: (n.noteNumber ? 'Note ' + n.noteNumber + ': ' : '') + (n.title || ''),
            href: n.url,
            target: '_blank'
          }).addStyleClass('sapUiSmallMarginEnd'));

          if (n.noteNumber) {
            noteRow.addItem(new Button({
              text: 'SSO 登录查看',
              type: 'Transparent',
              icon: 'sap-icon://log',
              press: (function (num) {
                return function () { window.open('https://me.sap.com/notes/' + num, '_blank'); };
              })(n.noteNumber)
            }));
          } else {
            noteRow.addItem(new Button({
              text: '搜索 SAP Note',
              type: 'Transparent',
              icon: 'sap-icon://search',
              press: (function (title) {
                return function () { window.open('https://me.sap.com/notes?q=' + encodeURIComponent(title), '_blank'); };
              })(n.title || '')
            }));
          }

          notesBox.addItem(noteRow);

          if (n.summary) {
            notesBox.addItem(new FormattedText({
              htmlText: n.summary,
              width: '100%'
            }).addStyleClass('sapUiTinyMarginBottom'));
          }
        });
        items.push(notesBox);
      }

      var bubbleBox = this._buildAgentShell(items);
      this._chatHistories[key].addItem(bubbleBox);

      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      this._messages[key].push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });

      this._scrollToBottom();
    },

    _buildAgentShell: function (items) {
      var vbox = new VBox({ items: items })
        .addStyleClass('sapUiSmallPadding')
        .addStyleClass('cleanCoreAgentBubble');

      vbox.addEventDelegate({
        onAfterRendering: function () {
          var dom = vbox.getDomRef();
          if (dom) {
            dom.style.background = '#f5f5f5';
            dom.style.borderRadius = '2px 12px 12px 12px';
            dom.style.maxWidth = '88%';
            dom.style.border = '1px solid #e8e8e8';
          }
        }
      });

      return new HBox({
        width: '100%',
        alignItems: 'Start',
        items: [vbox]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    _buildViolationCard: function (v) {
      var state = TIER_STATE[v.tier] || 'None';
      var headerBox = new HBox({
        alignItems: 'Center',
        items: [
          new ObjectStatus({ text: 'Tier ' + (v.tier || '?'), state: state }).addStyleClass('sapUiSmallMarginEnd'),
          new Title({ text: v.objectName, level: 'H5' }).addStyleClass('sapUiSmallMarginEnd'),
          v.line ? new Text({ text: '第 ' + v.line + ' 行' }).addStyleClass('sapUiTinyMarginEnd') : new Text({ text: '' })
        ]
      });

      var details = [];
      if (v.state) details.push(new Text({ text: '状态：' + v.state, wrapping: true }));

      if (v.replacement) {
        // Each comma-separated replacement gets its own highlighted chip
        var replacements = v.replacement.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var replBox = new VBox({ items: [] }).addStyleClass('sapUiSmallMarginTop');
        var labelRow = new HBox({ alignItems: 'Center', items: [
          new Text({ text: '建议替换：' }).addStyleClass('sapUiSmallMarginEnd')
        ]});
        replBox.addItem(labelRow);
        var chipsRow = new HBox({ wrap: 'Wrap', items: [] }).addStyleClass('sapUiTinyMarginTop');
        replacements.forEach(function (r) {
          var typePrefix = v.replacementType ? v.replacementType + ' ' : '';
          chipsRow.addItem(new HTML({
            content: '<span style="display:inline-block;background:#e8f4ff;border:1px solid #0a6ed1;color:#0a6ed1;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:bold;margin:2px 4px 2px 0;white-space:nowrap">' +
              (typePrefix ? '<span style="opacity:0.7;font-weight:normal;font-size:11px">' + typePrefix + '</span>' : '') + r +
              '</span>'
          }));
        });
        replBox.addItem(chipsRow);
        details.push(replBox);
      }

      if (v.note) details.push(new Text({ text: v.note, wrapping: true }).addStyleClass('sapUiSmallMarginTop'));

      return new Panel({
        expandable: true,
        expanded: false,
        headerToolbar: new Toolbar({ content: [headerBox] }),
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

    // ── 历史记录 ─────────────────────────────────────────────────────────────
    onShowHistory: function () {
      if (!this._historyPopover) {
        this._historyList = new List({ noDataText: '暂无历史记录' });
        this._historyPopover = new Popover({
          title: '历史输入记录',
          placement: 'Bottom',
          contentWidth: '420px',
          content: [this._historyList]
        });
        this.getView().addDependent(this._historyPopover);
      }

      this._historyList.destroyItems();
      var that = this;
      this._inputHistory.forEach(function (h) {
        var desc = h.text.length > 80 ? h.text.slice(0, 80) + '...' : h.text;
        that._historyList.addItem(new StandardListItem({
          title: h.modeLabel,
          description: desc,
          type: 'Active',
          press: (function (record) {
            return function () {
              that._applyHistory(record);
              that._historyPopover.close();
            };
          })(h)
        }));
      });

      this._historyPopover.openBy(this.byId('historyBtn'));
    },

    _applyHistory: function (h) {
      if (h.mode === 'search') {
        // Switch to search tab first
        this._tabBar.setSelectedKey('search');
        this.onTabSelect({ getParameter: function () { return 'search'; } });
        this._noteSearchInput.setValue(h.text);
        this._noteSearchInput.focus();
      } else {
        this._chatInput.setValue(h.text);
        this._chatInput.focus();
      }
    },

    onClearChat: function () {
      var key = this._currentTab;
      this._chatHistories[key].destroyItems();
      this._messages[key] = [];
      this._addWelcomeMessage(key);
    },

    _scrollToBottom: function () {
      var scrollArea = document.getElementById('ccScrollArea');
      if (scrollArea) {
        setTimeout(function () { scrollArea.scrollTop = scrollArea.scrollHeight; }, 100);
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
