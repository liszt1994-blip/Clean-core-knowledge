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
      this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub', 'graph'];
      this._currentTab = 'concept';
      this._codeSubMode = 'code'; // 'code' | 'atc'
      this._chatHistories = {};
      this._messages = { concept: [], codeanalysis: [], search: [], apihub: [], graph: [] };

      var TAB_CONFIG = {
        concept:      { icon: 'sap-icon://hint',       text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                         welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
        codeanalysis: { icon: 'sap-icon://source-code', text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        search:       { icon: 'sap-icon://search',      text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                      welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' },
        apihub:       { icon: 'sap-icon://product',       text: 'API Hub',    placeholder: '',                                                              welcome: '浏览 SAP S/4HANA PCE 官方 API 列表。输入关键词搜索，或点击模块按钮按业务范围浏览。' },
        graph:        { icon: 'sap-icon://org-chart',     text: '关系图谱',    placeholder: '',                                                              welcome: '' }
      };
      this._TAB_CONFIG = TAB_CONFIG;
      // 子模式独立配置（代码分析 Tab 内部）
      var CODE_SUB_CONFIG = {
        code: { placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        atc:  { placeholder: '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...', welcome: '请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。' }
      };
      this._CODE_SUB_CONFIG = CODE_SUB_CONFIG;

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

      // Tab 5（API Hub）专用控件
      this._apiHubInput = new TextArea({
        placeholder: '输入 API 关键词，例如 Purchase Order...',
        rows: 2,
        growing: false,
        width: '100%'
      });
      this._apiHubSearchBtn = new Button({
        text: '搜索',
        type: 'Emphasized',
        press: [this.onSearchApiHub, this]
      });

      // Tab 5（关系图谱）专用控件
      this._graphInput = new TextArea({
        placeholder: '输入 CDS View 名称，例如 I_SalesOrder...',
        rows: 1,
        growing: false,
        width: '100%'
      });
      this._graphAnalyzeBtn = new Button({
        text: '分析',
        type: 'Emphasized',
        press: [this.onAnalyzeCds, this]
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

      // ATC 子模式独立历史容器（DOM 挂载在 onAfterRendering 中完成）
      that._atcChatHistory = new VBox({ width: '100%' })
        .addStyleClass('sapUiSmallMarginBeginEnd sapUiSmallMarginTop');
      that._messages['atc_sub'] = []; // ATC 子模式独立消息历史

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

            if (key === 'codeanalysis') {
              // ── 子模式切换条 ────────────────────────────────────────────
              var subToggleDiv = document.createElement('div');
              subToggleDiv.id = 'ccCodeSubToggle';
              subToggleDiv.style.cssText = 'display:flex;gap:0;margin:8px 16px 4px;border:1.5px solid #0a6ed1;border-radius:6px;overflow:hidden;width:fit-content;';
              containerDiv.appendChild(subToggleDiv);

              var btnCode = document.createElement('button');
              btnCode.id = 'ccSubBtn_code';
              btnCode.textContent = '📝 代码输入';
              btnCode.style.cssText = 'background:#0a6ed1;color:#fff;padding:5px 16px;font-size:13px;border:none;cursor:pointer;font-weight:bold;';
              btnCode.onclick = function () { that._onCodeSubModeChange('code'); };
              subToggleDiv.appendChild(btnCode);

              var btnAtc = document.createElement('button');
              btnAtc.id = 'ccSubBtn_atc';
              btnAtc.textContent = '⚠️ ATC 输出';
              btnAtc.style.cssText = 'background:#fff;color:#0a6ed1;padding:5px 16px;font-size:13px;border:none;border-left:1.5px solid #0a6ed1;cursor:pointer;';
              btnAtc.onclick = function () { that._onCodeSubModeChange('atc'); };
              subToggleDiv.appendChild(btnAtc);

              // ── 两个子模式历史容器 ────────────────────────────────────────
              var subCode = document.createElement('div');
              subCode.id = 'ccCodeSub_code';
              subCode.style.cssText = 'display:block;';
              containerDiv.appendChild(subCode);
              that._chatHistories['codeanalysis'].placeAt(subCode);
              that._addCodeSubWelcome('code'); // 初始欢迎语（代码模式）

              var subAtc = document.createElement('div');
              subAtc.id = 'ccCodeSub_atc';
              subAtc.style.cssText = 'display:none;';
              containerDiv.appendChild(subAtc);
              // ATC 历史容器先空着，_onCodeSubModeChange 里懒挂载
            } else {
              that._chatHistories[key].placeAt(containerId);
            }
          });

          // API Hub 结果容器
          var apiHubResultDiv = document.createElement('div');
          apiHubResultDiv.id = 'ccApiHubResult';
          apiHubResultDiv.style.cssText = 'display:none;padding:8px 16px;';
          scrollDiv.appendChild(apiHubResultDiv);

          // 关系图谱画布容器
          var graphCanvasDiv = document.createElement('div');
          graphCanvasDiv.id = 'ccGraphCanvas';
          graphCanvasDiv.style.cssText = 'display:none;flex:1;background:#1a1a2e;min-height:600px;position:relative;';
          scrollDiv.appendChild(graphCanvasDiv);

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

          // ── API Hub 输入区 ───────────────────────────────────────────
          var apiHubInputDiv = document.createElement('div');
          apiHubInputDiv.id = 'ccApiHubInputArea';
          apiHubInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(apiHubInputDiv);

          // 搜索行：输入框 + 搜索按钮
          var apiHubRow = document.createElement('div');
          apiHubRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:8px;';
          apiHubInputDiv.appendChild(apiHubRow);

          var apiHubTextWrap = document.createElement('div');
          apiHubTextWrap.style.cssText = 'flex:1;min-width:0;';
          apiHubRow.appendChild(apiHubTextWrap);

          var apiHubBtnWrap = document.createElement('div');
          apiHubBtnWrap.style.cssText = 'flex-shrink:0;';
          apiHubRow.appendChild(apiHubBtnWrap);

          that._apiHubInput.placeAt(apiHubTextWrap);
          that._apiHubSearchBtn.placeAt(apiHubBtnWrap);

          // 模块按钮组
          var moduleRow = document.createElement('div');
          moduleRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
          apiHubInputDiv.appendChild(moduleRow);

          ['FI', 'MM', 'SD', 'PP', 'HR', 'PM'].forEach(function (mod) {
            var modLabels = { FI: '财务 FI', MM: '物料 MM', SD: '销售 SD', PP: '生产 PP', HR: '人力 HR', PM: '工厂 PM' };
            var modBtn = document.createElement('button');
            modBtn.textContent = modLabels[mod];
            modBtn.dataset.mod = mod;
            modBtn.style.cssText = 'background:#f5f5f5;color:#0a6ed1;border:1px solid #0a6ed1;border-radius:4px;padding:4px 12px;font-size:12px;cursor:pointer;';
            modBtn.onmouseover = function () { this.style.background = '#e8f4ff'; };
            modBtn.onmouseout  = function () { this.style.background = '#f5f5f5'; };
            modBtn.onclick = function () { that.onApiHubModuleSelect(this.dataset.mod); };
            moduleRow.appendChild(modBtn);
          });

          // Enter 键触发搜索
          that._apiHubInput.addEventDelegate({
            onkeydown: function (oEvent) {
              if (oEvent.key === 'Enter' && !oEvent.shiftKey) {
                oEvent.preventDefault();
                that.onSearchApiHub();
              }
            }
          });

          // ── 关系图谱输入区 ────────────────────────────────────────────
          var graphInputDiv = document.createElement('div');
          graphInputDiv.id = 'ccGraphInputArea';
          graphInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(graphInputDiv);

          var graphRow = document.createElement('div');
          graphRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:4px;';
          graphInputDiv.appendChild(graphRow);

          var graphTextWrap = document.createElement('div');
          graphTextWrap.style.cssText = 'flex:1;min-width:0;';
          graphRow.appendChild(graphTextWrap);

          var graphBtnWrap = document.createElement('div');
          graphBtnWrap.style.cssText = 'flex-shrink:0;';
          graphRow.appendChild(graphBtnWrap);

          that._graphInput.placeAt(graphTextWrap);
          that._graphAnalyzeBtn.placeAt(graphBtnWrap);

          var graphHint = document.createElement('p');
          graphHint.style.cssText = 'font-size:11px;color:#999;margin:2px 0 0;';
          graphHint.textContent = '示例：I_SalesOrder · I_PurchaseOrder · I_JournalEntry · C_SalesOrderTP';
          graphInputDiv.appendChild(graphHint);

          // Enter 键触发分析
          that._graphInput.addEventDelegate({
            onkeydown: function (oEvent) {
              if (oEvent.key === 'Enter' && !oEvent.shiftKey) {
                oEvent.preventDefault();
                that.onAnalyzeCds();
              }
            }
          });

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

    // ── 代码分析子模式切换 ────────────────────────────────────────────
    _onCodeSubModeChange: function (subMode) {
      if (this._codeSubMode === subMode) return;
      this._codeSubMode = subMode;

      // 切换历史容器显示
      var subCodeDiv = document.getElementById('ccCodeSub_code');
      var subAtcDiv  = document.getElementById('ccCodeSub_atc');
      if (subCodeDiv) subCodeDiv.style.display = subMode === 'code' ? 'block' : 'none';
      if (subAtcDiv)  subAtcDiv.style.display  = subMode === 'atc'  ? 'block' : 'none';

      // 懒挂载 ATC 历史 VBox（首次切换到 ATC 时挂载）
      if (subMode === 'atc' && subAtcDiv && !subAtcDiv.dataset.mounted) {
        this._atcChatHistory.placeAt(subAtcDiv);
        subAtcDiv.dataset.mounted = 'true';
        this._addCodeSubWelcome('atc');
      }

      // 切换按钮样式
      var btnCode = document.getElementById('ccSubBtn_code');
      var btnAtc  = document.getElementById('ccSubBtn_atc');
      if (btnCode) {
        btnCode.style.background = subMode === 'code' ? '#0a6ed1' : '#fff';
        btnCode.style.color      = subMode === 'code' ? '#fff'    : '#0a6ed1';
        btnCode.style.fontWeight = subMode === 'code' ? 'bold'    : 'normal';
      }
      if (btnAtc) {
        btnAtc.style.background = subMode === 'atc' ? '#0a6ed1' : '#fff';
        btnAtc.style.color      = subMode === 'atc' ? '#fff'    : '#0a6ed1';
        btnAtc.style.fontWeight = subMode === 'atc' ? 'bold'    : 'normal';
      }

      // 更新输入框 Placeholder
      var cfg = this._CODE_SUB_CONFIG[subMode];
      if (cfg) this._chatInput.setPlaceholder(cfg.placeholder);

      this._scrollToBottom();
    },

    // 为代码子模式添加欢迎语（懒初始化，避免重复添加）
    _addCodeSubWelcome: function (subMode) {
      var cfg = this._CODE_SUB_CONFIG[subMode];
      if (!cfg) return;
      var history = subMode === 'code' ? this._chatHistories['codeanalysis'] : this._atcChatHistory;
      history.addItem(
        new VBox({
          width: '100%',
          items: [new MessageStrip({ text: cfg.welcome, type: 'Information', showIcon: true })]
        }).addStyleClass('sapUiSmallMarginBottom')
      );
    },

    // ── API Hub 搜索 ─────────────────────────────────────────────────────────
    onSearchApiHub: function () {
      var query = this._apiHubInput.getValue().trim();
      if (!query) return;
      this._doApiHubSearch({ query: query, module: '' });
    },

    onApiHubModuleSelect: function (mod) {
      this._doApiHubSearch({ query: '', module: mod });
    },

    _doApiHubSearch: function (params) {
      var model = this.getView().getModel();
      if (model.getProperty('/busy')) return;

      model.setProperty('/busy', true);
      this._apiHubSearchBtn.setEnabled(false);
      this._busyIndicator.setVisible(true);

      var that = this;
      fetch('/odata/v4/knowledge/searchApiHub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          model.setProperty('/busy', false);
          that._apiHubSearchBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          var results = json.value || [];
          that._renderApiHubResults(results, params.module || params.query);
        })
        .catch(function () {
          model.setProperty('/busy', false);
          that._apiHubSearchBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          var resultDiv = document.getElementById('ccApiHubResult');
          if (resultDiv) resultDiv.innerHTML = '<p style="color:#c00;padding:16px;font-size:13px">请求失败，请检查网络或 API Key 配置。</p>';
        });
    },

    _renderApiHubResults: function (results, label) {
      var resultDiv = document.getElementById('ccApiHubResult');
      if (!resultDiv) return;

      if (this._apiHubList) {
        this._apiHubList.destroy();
        this._apiHubList = null;
      }
      resultDiv.innerHTML = '';

      if (results.length === 0) {
        resultDiv.innerHTML = '<p style="color:#888;padding:16px;font-size:13px">未找到相关 API，请换个关键词或选择其他模块。</p>';
        return;
      }

      var countText = document.createElement('p');
      countText.style.cssText = 'font-size:12px;color:#666;margin:8px 0 4px;';
      countText.textContent = '找到 ' + results.length + ' 个 API（' + label + '）';
      resultDiv.appendChild(countText);

      var that = this;
      var expandedIndex = -1;

      this._apiHubList = new List({ mode: 'None' });

      results.forEach(function (item, idx) {
        var typeTag = item.apiType ? '[' + item.apiType + '] ' : '';

        // 主行：类型标签 + 显示名，第二行：技术名（小字）
        var titleVBox = new VBox({
          items: [
            new HBox({
              alignItems: 'Center',
              items: [
                new Text({ text: typeTag, wrapping: false }).addStyleClass('sapUiTinyMarginEnd'),
                new Text({ text: item.displayName || '', wrapping: true })
              ]
            }),
            new Text({ text: item.name || '', wrapping: false }).addStyleClass('sapUiTinyMarginTop')
          ]
        });

        // 详情区（初始隐藏）
        var detailVBox = new VBox({
          visible: false,
          items: [
            new Text({ text: '描述：' + (item.description || '（暂无描述）') })
          ]
        }).addStyleClass('sapUiSmallMarginTop sapUiSmallMarginBegin');

        var itemVBox = new VBox({ items: [titleVBox, detailVBox] });

        var listItem = new sap.m.CustomListItem({
          content: [itemVBox],
          press: function () {
            var isOpen = detailVBox.getVisible();
            // 收起上一条展开的
            if (expandedIndex >= 0 && expandedIndex !== idx) {
              var prevItem = that._apiHubList.getItems()[expandedIndex];
              if (prevItem) {
                var prevDetail = prevItem.getContent()[0].getItems()[1];
                if (prevDetail) prevDetail.setVisible(false);
              }
            }
            detailVBox.setVisible(!isOpen);
            expandedIndex = isOpen ? -1 : idx;
          }
        });

        that._apiHubList.addItem(listItem);
      });

      this._apiHubList.placeAt(resultDiv);
      this._scrollToBottom();
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

      var inputArea       = document.getElementById('ccInputArea');
      var searchInputArea = document.getElementById('ccSearchInputArea');
      var searchResult    = document.getElementById('ccSearchResult');
      var apiHubInputArea = document.getElementById('ccApiHubInputArea');
      var apiHubResult    = document.getElementById('ccApiHubResult');

      if (key === 'search') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'block';
        if (searchResult)    searchResult.style.display    = 'block';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
      } else if (key === 'apihub') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'block';
        if (apiHubResult)    apiHubResult.style.display    = 'block';
      } else {
        if (inputArea)       inputArea.style.display       = 'block';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
        if (key === 'codeanalysis') {
          this._chatInput.setPlaceholder(this._CODE_SUB_CONFIG[this._codeSubMode].placeholder);
        } else {
          this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
        }
      }

      this._scrollToBottom();
    },

    // ── 欢迎语 ───────────────────────────────────────────────────────────────
    _addWelcomeMessage: function (tabKey) {
      var key = tabKey || this._currentTab;
      var welcomeText = this._TAB_CONFIG[key].welcome;
      if (!welcomeText) return;
      if (key === 'codeanalysis') return; // 由子模式懒初始化欢迎语

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

      var mode;
      var tabKey = this._currentTab;
      var subMode = this._codeSubMode; // 冻结子模式，防止异步回调竞态
      if (tabKey === 'codeanalysis') {
        mode = subMode; // 'code' 或 'atc'
      } else {
        var TAB_MODE = { concept: 'auto' };
        mode = TAB_MODE[tabKey] || 'auto';
      }

      var msgKey = this._getMsgKey(tabKey, subMode);

      var history = (this._messages[msgKey] || [])
        .slice(-6)
        .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

      this._addUserBubble(message, tabKey, subMode);
      this._chatInput.setValue('');

      var modeLabel = tabKey === 'codeanalysis'
        ? (subMode === 'code' ? '代码分析' : 'ATC 分析')
        : this._TAB_CONFIG[tabKey].text;
      this._inputHistory.unshift({ mode: mode, modeLabel: modeLabel, text: message });
      if (this._inputHistory.length > 50) this._inputHistory.pop();

      model.setProperty('/busy', true);
      this._busyIndicator.setVisible(true);
      this._sendBtn.setEnabled(false);

      var that = this;

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
          console.log('[rewrite] rewriteRewritten length:', reply.rewriteRewritten ? reply.rewriteRewritten.length : 0);
          if (reply.rewriteRewritten) {
            reply.rewrite = { original: reply.rewriteOriginal || message, rewritten: reply.rewriteRewritten };
          } else {
            reply.rewrite = null;
          }
          that._addAgentBubble(reply, tabKey, subMode);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._sendBtn.setEnabled(true);
          MessageBox.error('请求失败：' + err.message);
        });
    },

    // ── 气泡渲染 ─────────────────────────────────────────────────────────────
    _getHistoryVBox: function (tabKey) {
      if (tabKey === 'codeanalysis' && this._codeSubMode === 'atc') {
        return this._atcChatHistory;
      }
      return this._chatHistories[tabKey];
    },

    _getMsgKey: function (tabKey, subMode) {
      var key = tabKey || this._currentTab;
      var mode = subMode !== undefined ? subMode : this._codeSubMode;
      return (key === 'codeanalysis' && mode === 'atc') ? 'atc_sub' : key;
    },

    _addUserBubble: function (message, tabKey, subMode) {
      var key = tabKey || this._currentTab;
      var msgKey = this._getMsgKey(key, subMode);
      this._messages[msgKey].push({ role: 'user', text: message, textSummary: message.slice(0, 120) });

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

      this._getHistoryVBox(key).addItem(bubble);
      this._scrollToBottom();
    },

    _addAgentBubble: function (reply, tabKey, subMode) {
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
      var histVBox = this._getHistoryVBox(key);
      histVBox.addItem(bubbleBox);

      // 代码对比 Panel 放在气泡外部，加入 VBox
      if (reply.rewrite && reply.rewrite.rewritten) {
        var diffPanel = this._buildCodeDiffPanel(reply.rewrite);
        diffPanel.addStyleClass('sapUiSmallMarginBottom');
        histVBox.addItem(diffPanel);
      }

      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      var msgKey2 = this._getMsgKey(key, subMode);
      this._messages[msgKey2].push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });

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
          new ObjectStatus({ text: (v.tier || '?') + ' 类', state: state }).addStyleClass('sapUiSmallMarginEnd'),
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

      var that = this;
      var planBtn = new sap.m.Button({
        text: '迁移规划',
        type: 'Transparent',
        icon: 'sap-icon://map',
        press: function (evt) {
          that._onPlanPress(v.objectName, evt.getSource());
        }
      }).addStyleClass('sapUiTinyMarginTop');
      details.push(planBtn);

      return new Panel({
        expandable: true,
        expanded: false,
        headerToolbar: new Toolbar({ content: [headerBox] }),
        content: [new VBox({ items: details }).addStyleClass('sapUiSmallMargin')]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    _buildCodeDiffPanel: function (rewrite) {
      var originalCode = rewrite.original || '';
      var rewrittenCode = rewrite.rewritten || '';

      var uid = 'ccDiff_' + Date.now();
      var uidOrig = uid + '_orig';
      var uidRew  = uid + '_rew';

      var shellHtml = new HTML({
        content: [
          '<div style="display:flex;gap:12px;">',
            '<div style="flex:1;min-width:0;">',
              '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;color:#333">原代码</div>',
              '<textarea id="' + uidOrig + '" readonly',
                ' style="width:100%;height:300px;background:#1e1e1e;color:#f44747;',
                'font-family:Consolas,Monaco,monospace;font-size:12px;padding:10px;border:none;',
                'border-radius:4px;resize:vertical;box-sizing:border-box;overflow:auto;white-space:pre-wrap;word-break:break-all;"></textarea>',
            '</div>',
            '<div style="flex:1;min-width:0;">',
              '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;color:#333">改写后</div>',
              '<textarea id="' + uidRew + '" readonly',
                ' style="width:100%;height:300px;background:#1e1e1e;color:#4ec9b0;',
                'font-family:Consolas,Monaco,monospace;font-size:12px;padding:10px;border:none;',
                'border-radius:4px;resize:vertical;box-sizing:border-box;overflow:auto;white-space:pre-wrap;word-break:break-all;"></textarea>',
            '</div>',
          '</div>'
        ].join('')
      });

      shellHtml.addEventDelegate({
        onAfterRendering: function () {
          var elOrig = document.getElementById(uidOrig);
          var elRew  = document.getElementById(uidRew);
          if (elOrig) elOrig.value = originalCode;
          if (elRew)  elRew.value  = rewrittenCode;

          // Clamp the Panel DOM width to the scroll area width
          var scrollArea = document.getElementById('ccScrollArea');
          if (scrollArea && elOrig) {
            var availW = scrollArea.clientWidth - 48; // subtract padding
            var panelEl = elOrig.closest('.sapMPanel');
            if (panelEl) {
              panelEl.style.maxWidth = availW + 'px';
              panelEl.style.width = availW + 'px';
            }
          }
        }
      });

      var copyBtn = new Button({
        text: '复制改写后代码',
        type: 'Transparent',
        press: function () {
          var el = document.getElementById(uidRew);
          var text = el ? el.value : rewrittenCode;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(function () {});
          }
        }
      }).addStyleClass('sapUiSmallMarginTop');

      return new Panel({
        expandable: true,
        expanded: false,
        headerText: '代码对比',
        width: '100%',
        content: [
          new VBox({ items: [shellHtml, copyBtn] }).addStyleClass('sapUiSmallMargin')
        ]
      });
    },

    // ── Feature 6: Migration Path Planning ───────────────────────────────────
    _onPlanPress: function (objectName, triggerBtn) {
      var panelId = 'planPanel_' + objectName.replace(/[^a-zA-Z0-9]/g, '_');
      var existing = sap.ui.getCore().byId(panelId);
      if (existing) {
        existing.setVisible(!existing.getVisible());
        return;
      }

      var planPanel = new Panel(panelId, {
        headerText: '迁移规划：' + objectName,
        expandable: false,
        visible: true
      }).addStyleClass('sapUiSmallMarginTop');

      planPanel.addContent(new sap.m.BusyIndicator({ size: '1rem' }));

      var parentVBox = triggerBtn.getParent();
      parentVBox.addItem(planPanel);

      var that = this;
      fetch('/odata/v4/knowledge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectName: objectName })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || 'HTTP ' + r.status); });
          return r.json();
        })
        .then(function (data) {
          var result = data.value || data;
          planPanel.removeAllContent();
          planPanel.addContent(that._buildPlanContent(result));
        })
        .catch(function (err) {
          planPanel.removeAllContent();
          planPanel.addContent(new Text({ text: '获取迁移规划失败：' + err.message }));
        });
    },

    _buildPlanContent: function (plan) {
      var vbox = new VBox({ renderType: 'Bare' });

      vbox.addItem(new Text({
        text: '替代方案：' + (plan.replacement || '') + ' (' + (plan.replacementType || '') + ')'
      }).addStyleClass('sapUiTinyMarginBottom'));

      var metaBox = new HBox({ renderType: 'Bare' });
      metaBox.addItem(new Text({ text: '风险等级：' + (plan.riskLevel || '') }));
      metaBox.addItem(new Text({ text: '　预估工作量：' + (plan.effortEstimate || '') }));
      vbox.addItem(metaBox);

      vbox.addItem(new sap.m.Title({ text: '迁移步骤', level: 'H6' }).addStyleClass('sapUiTinyMarginTop'));
      var steps = [];
      try { steps = JSON.parse(plan.steps || '[]'); } catch (e) { steps = []; }
      steps.forEach(function (s) {
        vbox.addItem(new Text({ text: s.step + '. ' + s.description, wrapping: true }));
      });

      if (plan.codeExample) {
        // AI may return literal \n strings — convert them to real newlines before display
        var codeText = plan.codeExample.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        // Escape HTML special chars so the code renders as-is inside <pre>
        var codeHtmlEscaped = codeText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        var codeHtmlCtrl = new HTML({
          content: '<pre style="font-family:monospace;font-size:0.8rem;background:#f5f5f5;'
            + 'line-height:1.6;padding:0.5rem;white-space:pre-wrap;word-break:break-all;margin:0;">'
            + codeHtmlEscaped + '</pre>',
          sanitizeContent: false
        });
        var codePanel = new Panel({
          headerText: '代码示例',
          expandable: true,
          expanded: false,
          content: [codeHtmlCtrl]
        }).addStyleClass('sapUiTinyMarginTop');
        vbox.addItem(codePanel);
      }

      var that = this;
      vbox.addItem(new HBox({ items: [
        new Button({
          text: '导出 PDF',
          icon: 'sap-icon://pdf-attachment',
          type: 'Transparent',
          press: function () { that._exportPlanPDF(plan); }
        })
      ] }).addStyleClass('sapUiTinyMarginTop'));

      return vbox;
    },

    _exportPlanPDF: function (plan) {
      var steps = [];
      try { steps = JSON.parse(plan.steps || '[]'); } catch (e) { steps = []; }

      var stepsHtml = steps.map(function (s) {
        return '<li><strong>' + s.step + '.</strong> ' + s.description + '</li>';
      }).join('');

      var codeHtml = plan.codeExample
        ? '<h3>代码示例</h3><pre style="background:#f5f5f5;padding:1rem;font-size:0.85rem;white-space:pre-wrap;">'
          + plan.codeExample.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          + '</pre>'
        : '';

      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>迁移规划 - ' + plan.objectName + '</title>'
        + '<style>body{font-family:Arial,sans-serif;margin:2rem;color:#333}'
        + 'h1{color:#0a6ed1;border-bottom:2px solid #0a6ed1;padding-bottom:.5rem}'
        + 'h2{color:#0a6ed1;margin-top:1.5rem}'
        + '.meta{display:flex;gap:2rem;margin:1rem 0}'
        + '.meta span{background:#f0f4ff;padding:.3rem .8rem;border-radius:4px}'
        + 'ol{padding-left:1.5rem;line-height:2}'
        + 'pre{background:#f5f5f5;padding:1rem;font-size:.85rem;white-space:pre-wrap}'
        + '.summary{background:#e8f4e8;padding:.8rem;border-left:4px solid #4CAF50;margin:1rem 0}'
        + '</style></head><body>'
        + '<h1>迁移规划：' + plan.objectName + '</h1>'
        + '<div class="summary">' + (plan.summary || '') + '</div>'
        + '<h2>替代方案</h2><p>' + (plan.replacement || '') + ' (' + (plan.replacementType || '') + ')</p>'
        + '<div class="meta"><span>风险等级：' + (plan.riskLevel || '') + '</span>'
        + '<span>预估工作量：' + (plan.effortEstimate || '') + '</span></div>'
        + '<h2>迁移步骤</h2><ol>' + stepsHtml + '</ol>'
        + codeHtml
        + '</body></html>';

      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0;';
      document.body.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
      iframe.onload = function () {
        iframe.contentWindow.print();
        setTimeout(function () { document.body.removeChild(iframe); }, 2000);
      };
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
      } else if (h.mode === 'code' || h.mode === 'atc') {
        this._tabBar.setSelectedKey('codeanalysis');
        this.onTabSelect({ getParameter: function () { return 'codeanalysis'; } });
        this._onCodeSubModeChange(h.mode);
        this._chatInput.setValue(h.text);
        this._chatInput.focus();
      } else {
        this._chatInput.setValue(h.text);
        this._chatInput.focus();
      }
    },

    onClearChat: function () {
      var key = this._currentTab;
      if (key === 'codeanalysis') {
        this._chatHistories['codeanalysis'].destroyItems();
        this._atcChatHistory.destroyItems();
        this._messages['codeanalysis'] = [];
        this._messages['atc_sub'] = [];
        this._addCodeSubWelcome('code');
        var atcDiv = document.getElementById('ccCodeSub_atc');
        if (atcDiv && atcDiv.dataset.mounted) {
          this._addCodeSubWelcome('atc');
        }
      } else {
        this._chatHistories[key].destroyItems();
        this._messages[key] = [];
        this._addWelcomeMessage(key);
      }
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
