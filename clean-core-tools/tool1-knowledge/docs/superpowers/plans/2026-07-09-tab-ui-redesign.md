# Tab UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前单页对话式 UI 重构为 4 个独立 Tab（概念&分级、代码分析、ATC Check、SAP 搜索），每个 Tab 有独立历史和专属输入区，消除功能混淆。

**Architecture:** 顶部 `sap.m.IconTabBar` 做 Tab 导航；切换 Tab 时隐藏/显示对应的 `VBox` 消息容器，并更新 `TextArea` placeholder 和发送逻辑的 mode；Tab 4 SAP 搜索改用表格展示结果，搜索框移到 Tab 内容区顶部；后端接口不变。

**Tech Stack:** SAPUI5 1.120，`sap.m.IconTabBar`，`sap.m.IconTabFilter`，`sap.m.Table`，`sap.m.Column`，`sap.m.ColumnListItem`，`sap.m.Link`，现有 CAP OData v4 后端不变。

---

## 文件变更总览

- **修改** `app/knowledge/webapp/view/App.view.xml` — 加入 `IconTabBar`，移除底部 Note 搜索 HTML
- **修改** `app/knowledge/webapp/controller/App.controller.js` — Tab 切换逻辑、独立历史、Tab 4 表格渲染、代码对比默认展开、移除底部搜索栏相关控件

---

### Task 1: 更新 View — 加入 IconTabBar，移除底部搜索 HTML

**Files:**
- Modify: `app/knowledge/webapp/view/App.view.xml`

背景：当前 view 只有一个 `<Page>`，content 里是一个占位 `<core:HTML>` div（`ccMainWrap`），底部没有搜索栏（搜索栏是在 controller 的 `onAfterRendering` 里动态注入的 DOM）。我们需要在 view 里加入 `IconTabBar`，让 Tab 结构在 XML 里声明。

- [ ] **Step 1: 用以下内容完整替换 App.view.xml**

```xml
<mvc:View
  controllerName="knowledge.controller.App"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:core="sap.ui.core"
  displayBlock="true">

  <Page id="mainPage"
    showHeader="true"
    enableScrolling="false">

    <customHeader>
      <Bar>
        <contentLeft>
          <Title text="Clean Core Agent" level="H4" />
        </contentLeft>
        <contentRight>
          <Button id="historyBtn" icon="sap-icon://history" tooltip="历史记录" press=".onShowHistory" type="Transparent" />
          <Button text="清空对话" icon="sap-icon://delete" press=".onClearChat" type="Transparent" />
        </contentRight>
      </Bar>
    </customHeader>

    <content>
      <core:HTML content="&lt;div id='ccMainWrap' style='position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;'&gt;&lt;/div&gt;" />
    </content>

  </Page>
</mvc:View>
```

注意：View 本身不变，Tab 结构全部在 controller 里用 `IconTabBar` 动态构建（与现有 `placeAt` 模式一致）。

- [ ] **Step 2: 验证 view 文件语法正确**

在浏览器打开 `http://localhost:4004/knowledge/webapp/index.html`，页面应正常加载，标题栏和历史/清空按钮可见，无 JS 报错。

- [ ] **Step 3: Commit**

```bash
git add app/knowledge/webapp/view/App.view.xml
git commit -m "chore: view unchanged, ready for tab controller refactor"
```

---

### Task 2: Controller — 替换 require 列表，初始化 Tab 数据结构

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` (lines 1-43)

- [ ] **Step 1: 用以下内容替换文件顶部的 sap.ui.define 块（第 1-28 行）**

```javascript
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
```

- [ ] **Step 2: 用以下内容替换 onInit 方法中的数据模型初始化和实例变量（第 35-43 行）**

将：
```javascript
    onInit: function () {
      var model = new JSONModel({
        messages: [],
        inputText: '',
        busy: false
      });
      this.getView().setModel(model);
      this._inputHistory = [];
```

替换为：
```javascript
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
      this._chatHistories = {};   // { concept: VBox, code: VBox, atc: VBox, search: VBox }
      this._messages = { concept: [], code: [], atc: [], search: [] };

      var TAB_CONFIG = {
        concept: { icon: 'sap-icon://hint',       text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',         welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
        code:    { icon: 'sap-icon://source-code', text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                        welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        atc:     { icon: 'sap-icon://alert',       text: 'ATC Check',  placeholder: '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...', welcome: '请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。' },
        search:  { icon: 'sap-icon://search',      text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...', welcome: '' }
      };
      this._TAB_CONFIG = TAB_CONFIG;
```

- [ ] **Step 3: 验证页面仍能正常加载（无语法错误）**

刷新浏览器，无红色报错。

---

### Task 3: Controller — 构建 IconTabBar 和各 Tab 的 VBox 容器

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `onInit` 的控件构建部分

- [ ] **Step 1: 替换 onInit 中构建 _chatHistory / _busyIndicator / _chatInput / _sendBtn / _noteSearchInput / _noteSearchBtn 的代码（当前第 48-80 行），改为构建 IconTabBar**

将这一整段：
```javascript
      // chatHistory VBox
      this._chatHistory = new VBox({ width: '100%' })
        .addStyleClass('sapUiSmallMarginBeginEnd sapUiSmallMarginTop');

      // Busy indicator
      this._busyIndicator = new BusyIndicator({ visible: false })
        .addStyleClass('sapUiSmallMarginBegin sapUiSmallMarginBottom');

      // Chat input (主输入框)
      this._chatInput = new TextArea({
        placeholder: '输入问题，或粘贴 ABAP 代码 / ATC 报错...',
        rows: 3,
        growing: false,
        width: '100%'
      });

      // Send button
      this._sendBtn = new Button({
        text: '发送',
        type: 'Emphasized',
        press: [this.onSend, this]
      });

      // SAP Note 搜索框（底部独立区域）
      this._noteSearchInput = new Input({
        placeholder: '搜索 SAP Note...',
        width: '100%'
      });
      this._noteSearchBtn = new Button({
        icon: 'sap-icon://search',
        type: 'Transparent',
        tooltip: '搜索',
        press: [this.onSearchNote, this]
      });
```

替换为：
```javascript
      // Busy indicator（所有 Tab 共用）
      this._busyIndicator = new BusyIndicator({ visible: false })
        .addStyleClass('sapUiSmallMarginBegin sapUiSmallMarginBottom');

      // Chat input（所有对话 Tab 共用，Tab 4 搜索 Tab 单独有 Input）
      this._chatInput = new TextArea({
        placeholder: this._TAB_CONFIG['concept'].placeholder,
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
      this._noteSearchInput = new Input({
        placeholder: '搜索 SAP Note 或文档...',
        width: '100%'
      });
      this._noteSearchBtn = new Button({
        icon: 'sap-icon://search',
        type: 'Transparent',
        tooltip: '搜索',
        press: [this.onSearchNote, this]
      });

      // 各 Tab 独立 VBox 消息容器
      var that = this;
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
        var cfg = that._TAB_CONFIG[key];
        that._tabBar.addItem(new IconTabFilter({
          key: key,
          icon: cfg.icon,
          text: cfg.text
        }));
      });
```

- [ ] **Step 2: 验证页面仍能正常加载**

刷新浏览器，无报错。此时页面可能空白（DOM 尚未挂载），但不应有 JS 错误。

---

### Task 4: Controller — onAfterRendering：挂载 TabBar 和各区域到 DOM

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `onAfterRendering` 回调

- [ ] **Step 1: 将 onAfterRendering 回调替换为以下内容**

找到：
```javascript
      oView.addEventDelegate({
        onAfterRendering: function () {
          var wrap = document.getElementById('ccMainWrap');
          if (!wrap || wrap.dataset.initialized) return;
          wrap.dataset.initialized = 'true';
          // ... 整段 DOM 操作 ...
        }
      });
```

替换为：
```javascript
      var oView = this.getView();
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

          // ── Tab 4 搜索输入区（Tab 4 激活时显示） ─────────────────
          var searchInputDiv = document.createElement('div');
          searchInputDiv.id = 'ccSearchInputArea';
          searchInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(searchInputDiv);

          var searchRow = document.createElement('div');
          searchRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
          searchInputDiv.appendChild(searchRow);

          var noteInputWrap = document.createElement('div');
          noteInputWrap.style.cssText = 'flex:1;min-width:0;';
          searchRow.appendChild(noteInputWrap);

          var noteBtnWrap = document.createElement('div');
          noteBtnWrap.style.cssText = 'flex-shrink:0;';
          searchRow.appendChild(noteBtnWrap);

          that._noteSearchInput.placeAt(noteInputWrap);
          that._noteSearchBtn.placeAt(noteBtnWrap);

          that._noteSearchInput.attachSubmit
            ? that._noteSearchInput.attachSubmit(function () { that.onSearchNote(); })
            : that._noteSearchInput.attachChange(function () { that.onSearchNote(); });

          // 各 Tab 添加欢迎语
          that._TAB_KEYS.forEach(function (key) {
            that._addWelcomeMessage(key);
          });
        }
      });
```

- [ ] **Step 2: 删除 oView / that 的重复声明**

`onInit` 中原本有 `var that = this; var oView = this.getView();`，确保这两行仍在 onAfterRendering 回调之前（在 Task 2 Step 2 修改后的 onInit 中，`var that = this;` 已存在）。如果 `oView` 在 Task 2 之后被删掉了，补回：在 `onInit` 里 `this._TAB_CONFIG = TAB_CONFIG;` 之后加：
```javascript
      var that = this;
      var oView = this.getView();
```

- [ ] **Step 3: 验证 4 个 Tab 和输入区正常渲染**

刷新浏览器，页面应显示：
- 顶部 4 个 Tab（概念&分级、代码分析、ATC Check、SAP 搜索）
- Tab 1 激活，显示欢迎语气泡
- 底部有输入框和发送按钮
- 无 JS 报错

---

### Task 5: Controller — onTabSelect：切换 Tab 时更新显示

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 在 onInit 之后添加 onTabSelect 方法**

```javascript
    onTabSelect: function (oEvent) {
      var key = oEvent.getParameter('key');
      this._currentTab = key;

      // 切换 VBox 容器显示
      var that = this;
      this._TAB_KEYS.forEach(function (k) {
        var el = document.getElementById('ccChat_' + k);
        if (el) el.style.display = k === key ? 'block' : 'none';
      });

      // Tab 4 切换搜索结果区 / 对话输入区
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
        // 更新 placeholder
        this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
      }

      this._scrollToBottom();
    },
```

- [ ] **Step 2: 验证 Tab 切换正常**

刷新浏览器，点击各 Tab：
- Tab 1/2/3：底部输入框可见，placeholder 随 Tab 变化
- Tab 4：输入框隐藏，显示搜索输入区（当前为空）
- 各 Tab 的欢迎语独立，互不影响

---

### Task 6: Controller — onSend：按当前 Tab 路由 mode，写入对应历史

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `onSend` 方法

- [ ] **Step 1: 替换 onSend 方法**

将当前 onSend 方法完整替换为：

```javascript
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
      var tabKey = this._currentTab;  // 捕获发送时的 Tab，防止切换后写错历史

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
```

- [ ] **Step 2: 验证 Tab 1 发送正常**

在 Tab 1 输入 `READ_TEXT`，点发送，等待回复气泡出现在 Tab 1 的消息区。切换到 Tab 2，Tab 1 的消息不可见。切换回 Tab 1，消息仍在。

---

### Task 7: Controller — _addUserBubble / _addAgentBubble：写入指定 Tab 历史

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 修改 _addUserBubble，接受 tabKey 参数**

将：
```javascript
    _addUserBubble: function (message, mode) {
      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      msgs.push({ role: 'user', mode: mode, text: message, textSummary: message.slice(0, 120) });
      model.setProperty('/messages', msgs);
      // ... bubble 构建 ...
      this._chatHistory.addItem(bubble);
      this._scrollToBottom();
    },
```

替换为：
```javascript
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
```

- [ ] **Step 2: 修改 _addAgentBubble，接受 tabKey 参数**

将方法签名和最后写入历史的部分：
```javascript
    _addAgentBubble: function (reply) {
      // ...
      var bubbleBox = this._buildAgentShell(items);
      this._chatHistory.addItem(bubbleBox);

      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      msgs.push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });
      model.setProperty('/messages', msgs);

      this._scrollToBottom();
    },
```

改为：
```javascript
    _addAgentBubble: function (reply, tabKey) {
      var key = tabKey || this._currentTab;
      // ... （中间的 items 构建逻辑不变） ...
      var bubbleBox = this._buildAgentShell(items);
      this._chatHistories[key].addItem(bubbleBox);

      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      this._messages[key].push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });

      this._scrollToBottom();
    },
```

- [ ] **Step 3: 验证 Tab 1/2/3 消息独立**

在 Tab 1 发送一条消息，切到 Tab 2 发送另一条，两个 Tab 的历史互不影响。

---

### Task 8: Controller — _addWelcomeMessage 支持 tabKey 参数

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 修改 _addWelcomeMessage 方法，接受 tabKey**

将：
```javascript
    _addWelcomeMessage: function () {
      var welcomeBox = new VBox({
        width: '100%',
        items: [
          new MessageStrip({
            text: '你好！我可以帮你：\n• 解释 Clean Core 概念\n• 查询对象分级和替代 API\n• 分析 ABAP 代码中的 Clean Core 违规\n• 解读 ATC check 报错并给出修复方案\n• SAP 搜索和 Note 查询',
            type: 'Information',
            showIcon: true
          })
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
      this._chatHistory.addItem(welcomeBox);
    },
```

替换为：
```javascript
    _addWelcomeMessage: function (tabKey) {
      var key = tabKey || this._currentTab;
      var welcomeText = this._TAB_CONFIG[key].welcome;
      if (!welcomeText) return;  // Tab 4 无欢迎语

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
```

- [ ] **Step 2: 修改 onClearChat，只清当前 Tab**

将：
```javascript
    onClearChat: function () {
      this._chatHistory.destroyItems();
      this.getView().getModel().setProperty('/messages', []);
      this._addWelcomeMessage();
    },
```

替换为：
```javascript
    onClearChat: function () {
      var key = this._currentTab;
      this._chatHistories[key].destroyItems();
      this._messages[key] = [];
      this._addWelcomeMessage(key);
    },
```

- [ ] **Step 3: 验证欢迎语和清空**

刷新页面，4 个 Tab 各自有欢迎语（Tab 4 无）。在 Tab 1 发几条消息后点"清空对话"，只清 Tab 1，Tab 2 的历史不受影响。

---

### Task 9: Controller — Tab 4 搜索结果改为表格渲染

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `onSearchNote` 方法

- [ ] **Step 1: 替换 onSearchNote 方法**

```javascript
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
          that._renderSearchResults(Array.isArray(results) ? results : []);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          that._busyIndicator.setVisible(false);
          that._noteSearchBtn.setEnabled(true);
          MessageBox.error('Note 搜索失败：' + err.message);
        });
    },
```

- [ ] **Step 2: 添加 _renderSearchResults 方法**

在 onSearchNote 之后添加：

```javascript
    _renderSearchResults: function (results) {
      var resultDiv = document.getElementById('ccSearchResult');
      if (!resultDiv) return;

      // 清空旧结果（销毁旧 Table 防止内存泄漏）
      if (this._searchTable) {
        this._searchTable.destroy();
        this._searchTable = null;
      }

      if (results.length === 0) {
        resultDiv.innerHTML = '<p style="color:#888;padding:16px;font-size:13px">未找到相关结果，请换个关键词再试。</p>';
        return;
      }
      resultDiv.innerHTML = '';

      var that = this;
      this._searchTable = new Table({
        columns: [
          new Column({ width: '80px', header: new Text({ text: 'Note' }) }),
          new Column({ width: '35%', header: new Text({ text: '标题' }) }),
          new Column({ header: new Text({ text: '摘要' }) }),
          new Column({ width: '90px', header: new Text({ text: '操作' }) })
        ]
      });

      results.forEach(function (n) {
        var noteNumCell = n.noteNumber
          ? new Link({ text: n.noteNumber, href: 'https://me.sap.com/notes/' + n.noteNumber, target: '_blank' })
          : new Text({ text: '—' });

        var titleCell = new Link({ text: n.title || '', href: n.url || '#', target: '_blank', wrapping: true });

        var summaryCell = new FormattedText({ htmlText: n.summary || '', width: '100%' });

        var actionBtn = n.noteNumber
          ? new Button({ text: 'SSO 查看', type: 'Transparent', icon: 'sap-icon://log',
              press: (function (num) { return function () { window.open('https://me.sap.com/notes/' + num, '_blank'); }; })(n.noteNumber) })
          : new Button({ text: '搜索 Note', type: 'Transparent', icon: 'sap-icon://search',
              press: (function (title) { return function () { window.open('https://me.sap.com/notes?q=' + encodeURIComponent(title), '_blank'); }; })(n.title || '') });

        that._searchTable.addItem(new ColumnListItem({
          cells: [noteNumCell, titleCell, summaryCell, actionBtn]
        }));
      });

      this._searchTable.placeAt(resultDiv);
    },
```

- [ ] **Step 3: 验证 Tab 4 搜索结果以表格展示**

切换到 Tab 4，在搜索框输入 `READ_TEXT`，点击搜索按钮，等待结果出现为表格形式（Note 编号列、标题列、摘要列、操作列）。

---

### Task 10: Controller — 代码对比面板默认展开

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `_addAgentBubble` 和 `_buildCodeDiffPanel`

- [ ] **Step 1: 修改 _addAgentBubble 中代码对比部分，移除折叠按钮，直接展开**

找到 `_addAgentBubble` 中以下代码段：
```javascript
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
```

替换为：
```javascript
      if (reply.rewrite && reply.rewrite.rewritten) {
        items.push(this._buildCodeDiffPanel(reply.rewrite));
      }
```

- [ ] **Step 2: 修改 _buildCodeDiffPanel，默认 expanded: true**

找到：
```javascript
      return new Panel({
        expandable: true,
        expanded: false,
        headerText: '代码对比',
```

替换为：
```javascript
      return new Panel({
        expandable: true,
        expanded: true,
        headerText: '代码对比',
```

- [ ] **Step 3: 验证代码对比直接展开**

在 Tab 2 粘贴含 `CALL FUNCTION 'READ_TEXT'` 的 ABAP 代码发送，等待回复，代码对比面板应直接展开（不需要点击按钮）。

---

### Task 11: Controller — 修复 onShowHistory，适配多 Tab 消息结构

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `onShowHistory`、`_applyHistory`

当前 `onShowHistory` 用 `this.byId('historyBtn')` 打开 Popover，无需修改。`_applyHistory` 只填输入框，也无需修改。但历史记录的 `modeLabel` 现在来自 Tab config 文字，已在 Task 6 中正确设置。

- [ ] **Step 1: 确认 onShowHistory 和 _applyHistory 无需修改**

检查这两个方法，确认：
- `onShowHistory` 仍从 `this._inputHistory` 读取，渲染到 Popover，不涉及 Tab 特定逻辑 ✓
- `_applyHistory` 仍只调用 `this._chatInput.setValue(h.text)` ✓

如果两个方法与原来完全一致，此 Task 直接跳到 Commit。

- [ ] **Step 2: Commit 全部改动**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: refactor UI to 4-tab layout with independent history"
```

---

### Task 12: 端到端验证

- [ ] **Step 1: 验证 Tab 1 — 概念解析**

输入 `什么是 Clean Core`，发送，收到解释回复。

- [ ] **Step 2: 验证 Tab 1 — 分级查询**

输入 `READ_TEXT 的分级和替代`，发送，收到 Tier + 替代 API 违规卡片。

- [ ] **Step 3: 验证 Tab 2 — 代码分析**

粘贴以下代码，发送：
```abap
REPORT ztest.
DATA: lt_text TYPE TABLE OF tline.
CALL FUNCTION 'READ_TEXT'
  EXPORTING
    client   = sy-mandt
    id       = 'ST'
    language = sy-langu
    name     = 'TEST'
    object   = 'TEXT'
  TABLES
    lines    = lt_text.
```
预期：违规卡片（READ_TEXT Tier C）+ 代码对比面板直接展开。

- [ ] **Step 4: 验证 Tab 3 — ATC Check**

粘贴以下内容，发送：
```
Check variant: ZCLEAN_CORE_CHECK
Object: Program ZTEST_PROGRAM
Finding: SLIN_OBSOLETE in line 5
  Use of obsolete function module READ_TEXT
  Severity: Error
```
预期：ATC 违规卡片，显示检查码 SLIN_OBSOLETE、对象 READ_TEXT、建议替换。

- [ ] **Step 5: 验证 Tab 4 — SAP 搜索**

输入 `READ_TEXT migration`，点搜索，预期结果以表格展示。

- [ ] **Step 6: 验证 Tab 独立历史**

在 Tab 1 发一条消息，切到 Tab 2，Tab 1 的消息不可见。切回 Tab 1，消息仍在。

- [ ] **Step 7: 验证清空只清当前 Tab**

在 Tab 1 和 Tab 2 各发一条消息，在 Tab 1 点"清空对话"，仅 Tab 1 被清空，Tab 2 历史保留。
