# 代码分析 + ATC Tab 合并实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端"代码分析"和"ATC Check"两个 Tab 合并为一个"代码分析" Tab，内部用 SegmentedButton 切换子模式。

**Architecture:** 仅修改 `App.controller.js`，后端完全不动。`_TAB_KEYS` 从 4 个缩减为 3 个，新增 `_codeSubMode` 状态管理子模式切换，子模式历史区域通过 DOM `display` 隔离。

**Tech Stack:** SAP UI5 (sap.m)，vanilla JS DOM 操作，无新依赖。

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| Modify | `app/knowledge/webapp/controller/App.controller.js` |

---

### Task 1: 更新 `_TAB_KEYS` 和 `_TAB_CONFIG`

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`（`onInit` 函数内，约第 52–63 行）

- [ ] **Step 1: 替换 `_TAB_KEYS` 定义**

将：
```javascript
this._TAB_KEYS = ['concept', 'code', 'atc', 'search'];
this._currentTab = 'concept';
this._chatHistories = {};
this._messages = { concept: [], code: [], atc: [], search: [] };
```
改为：
```javascript
this._TAB_KEYS = ['concept', 'codeanalysis', 'search'];
this._currentTab = 'concept';
this._codeSubMode = 'code'; // 'code' | 'atc'
this._chatHistories = {};
this._messages = { concept: [], codeanalysis: [], search: [] };
```

- [ ] **Step 2: 替换 `_TAB_CONFIG` 定义**

将：
```javascript
var TAB_CONFIG = {
  concept: { icon: 'sap-icon://hint',        text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                          welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
  code:    { icon: 'sap-icon://source-code',  text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                          welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
  atc:     { icon: 'sap-icon://alert',         text: 'ATC Check',  placeholder: '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...',  welcome: '请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。' },
  search:  { icon: 'sap-icon://search',        text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                       welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' }
};
```
改为：
```javascript
var TAB_CONFIG = {
  concept:      { icon: 'sap-icon://hint',       text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                         welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
  codeanalysis: { icon: 'sap-icon://source-code', text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
  search:       { icon: 'sap-icon://search',      text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                      welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' }
};
// 子模式独立配置（代码分析 Tab 内部）
var CODE_SUB_CONFIG = {
  code: { placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
  atc:  { placeholder: '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...', welcome: '请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。' }
};
this._CODE_SUB_CONFIG = CODE_SUB_CONFIG;
```

- [ ] **Step 3: 验证页面能正常启动（不崩溃）**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
# 在浏览器中刷新页面，确认无 JS 报错
```
预期：页面加载正常，控制台无报错（Tab 可能显示异常，后续步骤修复）

- [ ] **Step 4: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "refactor: merge code+atc tab keys and config"
```

---

### Task 2: 重建 DOM 结构——添加子模式切换条和双历史容器

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`（`onAfterRendering` 回调内，约第 140–150 行）

- [ ] **Step 1: 找到各 Tab VBox 放入 DOM 的循环**

当前代码（约第 140 行）：
```javascript
that._TAB_KEYS.forEach(function (key) {
  var containerId = 'ccChat_' + key;
  var containerDiv = document.createElement('div');
  containerDiv.id = containerId;
  containerDiv.style.cssText = key === 'concept' ? 'display:block' : 'display:none';
  scrollDiv.appendChild(containerDiv);
  that._chatHistories[key].placeAt(containerId);
});
```

将其替换为：
```javascript
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
    that._chatHistories['codeanalysis'].placeAt(subCode); // 代码模式历史先挂在 code 容器

    var subAtc = document.createElement('div');
    subAtc.id = 'ccCodeSub_atc';
    subAtc.style.cssText = 'display:none;';
    containerDiv.appendChild(subAtc);
    // ATC 历史容器先空着，onCodeSubModeChange 里按需初始化
  } else {
    that._chatHistories[key].placeAt(containerId);
  }
});
```

- [ ] **Step 2: 在 `onInit` 中，为 `codeanalysis` 额外添加一个 ATC 历史 VBox**

在 `onInit` 中，`_chatHistories` 初始化的循环下方添加：
```javascript
// ATC 子模式独立历史容器（DOM 挂载在 Task 2 DOM 构建时完成）
that._atcChatHistory = new VBox({ width: '100%' })
  .addStyleClass('sapUiSmallMarginBeginEnd sapUiSmallMarginTop');
that._messages['atc_sub'] = []; // ATC 子模式独立消息历史
```

- [ ] **Step 3: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "refactor: add sub-mode toggle bar and dual history containers"
```

---

### Task 3: 实现 `_onCodeSubModeChange` 方法

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`（在 `onTabSelect` 方法之前添加新方法）

- [ ] **Step 1: 添加 `_onCodeSubModeChange` 方法**

在 `onTabSelect` 方法定义之前，插入：
```javascript
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
    btnCode.style.background    = subMode === 'code' ? '#0a6ed1' : '#fff';
    btnCode.style.color         = subMode === 'code' ? '#fff'    : '#0a6ed1';
    btnCode.style.fontWeight    = subMode === 'code' ? 'bold'    : 'normal';
  }
  if (btnAtc) {
    btnAtc.style.background  = subMode === 'atc' ? '#0a6ed1' : '#fff';
    btnAtc.style.color       = subMode === 'atc' ? '#fff'    : '#0a6ed1';
    btnAtc.style.fontWeight  = subMode === 'atc' ? 'bold'    : 'normal';
  }

  // 更新输入框 Placeholder
  var cfg = this._CODE_SUB_CONFIG[subMode];
  if (cfg) this._chatInput.setPlaceholder(cfg.placeholder);

  this._scrollToBottom();
},

// 为代码子模式添加欢迎语（懒初始化）
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
```

- [ ] **Step 2: 修改 `_addWelcomeMessage`，跳过 `codeanalysis` Tab（由子模式自己管欢迎语）**

找到：
```javascript
_addWelcomeMessage: function (tabKey) {
  var key = tabKey || this._currentTab;
  var welcomeText = this._TAB_CONFIG[key].welcome;
  if (!welcomeText) return;
  ...
```

在 `if (!welcomeText) return;` 这行下方添加一行：
```javascript
if (key === 'codeanalysis') return; // 由子模式懒初始化欢迎语
```

- [ ] **Step 3: 在 `onAfterRendering` 中，代码历史挂载后立即添加代码模式欢迎语**

在 Task 2 Step 1 代码中，`that._chatHistories['codeanalysis'].placeAt(subCode);` 这行之后添加：
```javascript
that._addCodeSubWelcome('code'); // 初始欢迎语（代码模式）
```

- [ ] **Step 4: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: implement sub-mode toggle with welcome messages"
```

---

### Task 4: 修复 `onTabSelect`、`onSend`、历史记录，以及清空功能

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 更新 `onTabSelect` 的子 Tab 显示逻辑**

找到 `onTabSelect` 方法，其中：
```javascript
this._TAB_KEYS.forEach(function (k) {
  var el = document.getElementById('ccChat_' + k);
  if (el) el.style.display = k === key ? 'block' : 'none';
});
```
这段逻辑无需修改（`ccChat_codeanalysis` 已包含子模式切换条和子容器，整体显示/隐藏即可）。

需要修改的是切换到 `codeanalysis` 时的 Placeholder：
```javascript
// 原来
this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);

// 改为
if (key === 'codeanalysis') {
  this._chatInput.setPlaceholder(this._CODE_SUB_CONFIG[this._codeSubMode].placeholder);
} else {
  this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
}
```

- [ ] **Step 2: 更新 `onSend` 中的 `mode` 和 `history` 取值**

找到：
```javascript
var TAB_MODE = { concept: 'auto', code: 'code', atc: 'atc' };
var mode = TAB_MODE[this._currentTab] || 'auto';

var history = (this._messages[this._currentTab] || [])
  .slice(-6)
  .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

this._addUserBubble(message, this._currentTab);
```

替换为：
```javascript
var mode;
if (this._currentTab === 'codeanalysis') {
  mode = this._codeSubMode; // 'code' 或 'atc'
} else {
  var TAB_MODE = { concept: 'auto' };
  mode = TAB_MODE[this._currentTab] || 'auto';
}

var msgKey = this._currentTab === 'codeanalysis' && this._codeSubMode === 'atc'
  ? 'atc_sub'
  : this._currentTab;

var history = (this._messages[msgKey] || [])
  .slice(-6)
  .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

this._addUserBubble(message, this._currentTab);
```

- [ ] **Step 3: 更新 `_addUserBubble` 和 `_addAgentBubble` 以使用正确的历史容器**

找到 `_addUserBubble` 末尾的 `this._chatHistories[key].addItem(bubble);`，改为：
```javascript
var history = this._getHistoryVBox(key);
history.addItem(bubble);
```

找到 `_addAgentBubble` 末尾的两处 `this._chatHistories[key].addItem(...)` 和 `this._messages[key].push(...)`，分别改为：
```javascript
// addItem 部分
var histVBox = this._getHistoryVBox(key);
histVBox.addItem(bubbleBox);

if (reply.rewrite && reply.rewrite.rewritten) {
  var diffPanel = this._buildCodeDiffPanel(reply.rewrite);
  diffPanel.addStyleClass('sapUiSmallMarginBottom');
  histVBox.addItem(diffPanel);
}

// messages push 部分
var msgKey2 = key === 'codeanalysis' && this._codeSubMode === 'atc' ? 'atc_sub' : key;
this._messages[msgKey2].push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });
```

在 `_addUserBubble` 中的 `this._messages[key].push(...)` 同理：
```javascript
var msgKey = key === 'codeanalysis' && this._codeSubMode === 'atc' ? 'atc_sub' : key;
this._messages[msgKey].push({ role: 'user', text: message, textSummary: message.slice(0, 120) });
```

- [ ] **Step 4: 添加 `_getHistoryVBox` 辅助方法**

在 `_addUserBubble` 方法之前添加：
```javascript
_getHistoryVBox: function (tabKey) {
  if (tabKey === 'codeanalysis' && this._codeSubMode === 'atc') {
    return this._atcChatHistory;
  }
  return this._chatHistories[tabKey];
},
```

- [ ] **Step 5: 更新 `onSend` 中的 `modeLabel`（历史记录显示）**

找到：
```javascript
this._inputHistory.unshift({ mode: mode, modeLabel: this._TAB_CONFIG[this._currentTab].text, text: message });
```
改为：
```javascript
var modeLabel = this._currentTab === 'codeanalysis'
  ? (this._codeSubMode === 'code' ? '代码分析' : 'ATC 分析')
  : this._TAB_CONFIG[this._currentTab].text;
this._inputHistory.unshift({ mode: mode, modeLabel: modeLabel, text: message });
```

- [ ] **Step 6: 更新 `onClearChat` 方法**

找到：
```javascript
onClearChat: function () {
  var key = this._currentTab;
  this._chatHistories[key].destroyItems();
  this._messages[key] = [];
  this._addWelcomeMessage(key);
},
```
替换为：
```javascript
onClearChat: function () {
  var key = this._currentTab;
  if (key === 'codeanalysis') {
    this._chatHistories['codeanalysis'].destroyItems();
    this._atcChatHistory.destroyItems();
    this._messages['codeanalysis'] = [];
    this._messages['atc_sub'] = [];
    this._addCodeSubWelcome('code');
    if (document.getElementById('ccCodeSub_atc') &&
        document.getElementById('ccCodeSub_atc').dataset.mounted) {
      this._addCodeSubWelcome('atc');
    }
  } else {
    this._chatHistories[key].destroyItems();
    this._messages[key] = [];
    this._addWelcomeMessage(key);
  }
},
```

- [ ] **Step 7: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: wire up send/history/clear for merged codeanalysis tab"
```

---

### Task 5: 修复 `_applyHistory`（历史记录回填）

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 更新 `_applyHistory`**

找到：
```javascript
_applyHistory: function (h) {
  if (h.mode === 'search') {
    this._tabBar.setSelectedKey('search');
    this.onTabSelect({ getParameter: function () { return 'search'; } });
    this._noteSearchInput.setValue(h.text);
    this._noteSearchInput.focus();
  } else {
    this._chatInput.setValue(h.text);
    this._chatInput.focus();
  }
},
```
替换为：
```javascript
_applyHistory: function (h) {
  if (h.mode === 'search') {
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
```

- [ ] **Step 2: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "fix: restore history correctly for code/atc sub-modes"
```

---

### Task 6: 手动验证全流程

- [ ] **Step 1: 启动开发服务器**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

- [ ] **Step 2: 验证 Tab 结构**

打开浏览器，确认外层只有 3 个 Tab：概念 & 分级 / 代码分析 / SAP 搜索

- [ ] **Step 3: 验证子模式切换**

点击"代码分析" Tab，确认：
- 默认显示"代码输入"子模式按钮（蓝色高亮）
- Placeholder：`'粘贴 ABAP 代码片段...'`
- 欢迎语：`'请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。'`

点击"⚠️ ATC 输出"按钮，确认：
- 按钮高亮切换
- Placeholder：`'粘贴 ATC check 报错信息...'`
- 欢迎语：`'请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。'`

- [ ] **Step 4: 验证历史隔离**

在代码模式发送一条消息，切换到 ATC 模式，确认消息不出现在 ATC 历史中。

- [ ] **Step 5: 验证后端 mode 参数**

打开浏览器 DevTools → Network，发送请求，确认：
- 代码模式请求 body 包含 `"mode":"code"`
- ATC 模式请求 body 包含 `"mode":"atc"`

- [ ] **Step 6: 最终 commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: merge code+atc into single codeanalysis tab with sub-mode toggle"
```
