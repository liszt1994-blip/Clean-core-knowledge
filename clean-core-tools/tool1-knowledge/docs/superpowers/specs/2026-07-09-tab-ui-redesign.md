# Tab UI Redesign — Design Spec

## Goal

将当前单页对话式 UI 重构为 4 个独立 Tab，每个 Tab 对应一种使用场景，消除功能混淆，让用户清楚知道在哪里做什么。

## Architecture

采用**方案 B**：顶部 `sap.m.IconTabBar` 做 Tab 导航，切换 Tab 时替换输入区内容（占位提示、发送逻辑），结果仍以气泡形式显示在各 Tab 独立的对话区（`VBox`）。每个 Tab 有自己独立的消息历史，切换 Tab 不会清空其他 Tab 的历史。

## Tech Stack

- SAPUI5 1.120，`sap.m.IconTabBar` + `sap.m.IconTabFilter`
- 每个 Tab 的对话区用独立 `VBox` 存储，通过 Tab key 索引切换显示/隐藏
- 后端 `/odata/v4/knowledge/chat` 接口不变，`mode` 参数对应各 Tab
- SAP 搜索仍调用 `/odata/v4/knowledge/searchNote`

## Tab 定义

### Tab 1：概念 & 分级（key: `concept`）
- **输入**：单个 `TextArea`，placeholder：`输入 Clean Core 概念或 SAP 对象名...`
- **发送逻辑**：`mode: 'auto'`，AI 自动判断 explain / classify 意图
- **结果**：气泡式，概念解释用 `FormattedText`，分级查询用违规卡片（含 Tier、替代 API）
- **欢迎语**：`你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。`

### Tab 2：代码分析（key: `code`）
- **输入**：`TextArea`，placeholder：`粘贴 ABAP 代码片段...`
- **发送逻辑**：`mode: 'code'`，跳过意图识别直接走 code 分支
- **结果**：气泡式，违规卡片列表 + 代码对比面板**直接展开**（不折叠），复制按钮在对比面板顶部
- **欢迎语**：`请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。`

### Tab 3：ATC Check（key: `atc`）
- **输入**：`TextArea`，placeholder：`粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...`
- **发送逻辑**：`mode: 'atc'`，跳过意图识别直接走 atc 分支
- **结果**：气泡式，每条违规卡片显示：Tier、对象名、行号、ATC 检查码、建议替换、原始错误信息
- **欢迎语**：`请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。`

### Tab 4：SAP 搜索（key: `search`）
- **输入**：页面顶部固定搜索框（`Input` + 搜索按钮），不在底部
- **发送逻辑**：调用 `searchNote` 接口
- **结果**：`sap.m.Table` 表格，列：Note 编号（可点击）、标题、摘要、操作（SSO 查看 / 搜索 Note）
- **无气泡**：搜索结果直接以表格替换上一次结果，不累积
- **欢迎语**：无，搜索框下方显示空表格占位

## UI 结构变化

### 移除
- 底部独立 SAP Note 搜索栏（`ccNoteArea` DOM 节点及相关控件）
- `this._noteSearchInput`、`this._noteSearchBtn`

### 新增
- `sap.m.IconTabBar`（`this._tabBar`）含 4 个 `IconTabFilter`
- 每个 Tab 的独立 `VBox` 消息容器：`this._chatHistories = { concept, code, atc, search }`
- 每个 Tab 的独立消息数组：`this._messages = { concept: [], code: [], atc: [], search: [] }`
- Tab 4 的搜索输入区（`Input` + `Button`）置于 Tab 4 内容区顶部
- Tab 4 的结果 `sap.m.Table`

### 保留
- `this._chatInput`（`TextArea`）—— 各 Tab 共用，切换时更新 placeholder
- `this._sendBtn`、`this._busyIndicator`
- `_buildViolationCard`、`_buildAgentShell`、`_buildCodeDiffPanel`、`_escapeHtml` 等辅助方法
- 标题栏历史记录按钮和清空按钮（清空只清当前 Tab）

## 后端变化

### `chat` 接口
- Tab 2 发送 `mode: 'code'`，Tab 3 发送 `mode: 'atc'`，跳过意图检测
- Tab 1 仍发送 `mode: 'auto'`

### Tab 2 代码对比
- 当前 `_addAgentBubble` 里 `reply.rewrite` 有值时显示 Panel（默认折叠）→ 改为**直接展开**，移除 toggleBtn

## 数据流

```
用户切换 Tab
  → onTabSelect(key)
  → 隐藏其他 Tab 的 VBox，显示当前 Tab 的 VBox
  → 更新 this._chatInput placeholder
  → 更新 this._currentTab = key

用户点击发送
  → onSend()
  → 读取 this._currentTab 决定 mode
  → 在 this._chatHistories[currentTab] 追加气泡
  → 在 this._messages[currentTab] 追加消息记录
```

## 文件变更

- **修改**：`app/knowledge/webapp/view/App.view.xml` — 加入 `IconTabBar`，移除底部 Note 搜索 HTML
- **修改**：`app/knowledge/webapp/controller/App.controller.js` — Tab 切换逻辑、独立历史、Tab 4 表格渲染、代码对比默认展开
- **不变**：`srv/knowledge-service.js`、`srv/prompts.js`（后端逻辑无需改动）
