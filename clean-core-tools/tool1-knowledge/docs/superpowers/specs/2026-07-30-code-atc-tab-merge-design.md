# 代码分析 + ATC Check Tab 合并设计文档

**日期：** 2026-07-30
**状态：** 已确认，待实现

---

## 概述

将现有的"代码分析"和"ATC Check"两个独立 Tab 合并为一个"代码分析" Tab，内部通过 SegmentedButton（子模式切换）区分两种输入模式。外层 IconTabBar 从 4 个 Tab 减少为 3 个。

---

## 变更范围

仅修改前端 `app/knowledge/webapp/controller/App.controller.js`。后端 `knowledge-service.js`、CDS 定义、prompts 均不需要改动。

---

## Tab 结构变化

### 合并前（4 个）
```
概念 & 分级 | 代码分析 | ATC Check | SAP 搜索
```

### 合并后（3 个）
```
概念 & 分级 | 代码分析 | SAP 搜索
```

---

## "代码分析" Tab 内部设计

### 子模式切换控件

在消息区上方放置一个 SegmentedButton 样式的切换条：

```
[ 📝 代码输入 ]  [ ⚠️ ATC 输出 ]
```

- 默认激活：**代码输入**
- 实现方式：两个并排 `Button`，通过 CSS 高亮激活态，模拟 SegmentedButton 外观（与现有 UI 风格一致）

### 对话历史隔离

- `_TAB_KEYS` 从 `['concept', 'code', 'atc', 'search']` 改为 `['concept', 'codeanalysis', 'search']`
- 新增子模式状态：`_codeSubMode`，取值 `'code'` 或 `'atc'`，默认 `'code'`
- `_chatHistories` 和 `_messages` 各自维护 `codeanalysis` 键的历史，子模式切换不清空、不混用
- 子模式各自独立的欢迎语在初始化时一次性写入同一个 `_chatHistories['codeanalysis']` 容器，切换时通过 DOM `display` 控制显示哪一段

> 注：子模式的历史区域使用两个独立的内嵌 `<div>` 容器（`ccCodeSub_code` / `ccCodeSub_atc`），通过 display 切换，避免重建 UI5 控件。

### Placeholder 切换

切换子模式时同步更新 `_chatInput.setPlaceholder()`：
- 代码模式：`'粘贴 ABAP 代码片段...'`
- ATC 模式：`'粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...'`

### 欢迎语切换

切换子模式时同步更新输入框上方的欢迎语 MessageStrip（或直接通过 DOM 显示/隐藏两条独立欢迎语）：
- 代码模式：`'请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。'`
- ATC 模式：`'请粘贴 ATC check 报错内容，我会解析违规并给出修复建议。'`

---

## 后端交互（不变）

`onSend` 发送时根据 `_codeSubMode` 决定 `mode` 参数：

```javascript
// 合并前
var TAB_MODE = { concept: 'auto', code: 'code', atc: 'atc' };
var mode = TAB_MODE[this._currentTab] || 'auto';

// 合并后
var TAB_MODE = { concept: 'auto', codeanalysis: null, search: null };
var mode;
if (this._currentTab === 'codeanalysis') {
  mode = this._codeSubMode; // 'code' 或 'atc'
} else {
  mode = TAB_MODE[this._currentTab] || 'auto';
}
```

后端 `chat` action 接收的 `mode` 值（`'code'` / `'atc'`）完全不变。

---

## 历史记录（`_inputHistory`）

历史记录中的 `modeLabel` 对应调整：
- `code` 模式 → `'代码分析'`
- `atc` 模式 → `'ATC 分析'`

---

## 实现约束

- 不引入新的 UI5 控件依赖（已有 `Button`、`HBox` 足够实现子模式切换条）
- 子模式切换使用 DOM `display` 切换，不销毁/重建历史 UI5 控件（与现有代码示例 Panel 的处理方式一致）
- Tab key `'codeanalysis'` 替代原来的 `'code'` 和 `'atc'`，`_TAB_CONFIG` 中合并为一条记录

---

## 测试要点

1. 切换子模式后，Placeholder 和欢迎语正确更新
2. 代码模式发送消息，ATC 模式历史不受影响（反之亦然）
3. 发送请求时，`mode` 参数正确传递（`'code'` 或 `'atc'`）
4. 外层 Tab 切换（概念 ↔ 代码分析 ↔ SAP 搜索）正常工作
5. 历史记录（Popover）中 modeLabel 显示正确
