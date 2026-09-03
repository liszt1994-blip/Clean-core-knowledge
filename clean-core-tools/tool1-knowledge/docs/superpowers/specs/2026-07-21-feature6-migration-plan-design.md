# Feature 6 — 迁移路径规划 设计文档

**日期：** 2026-07-21  
**状态：** 已确认，待实现

---

## 概述

在对象分类 Tab 的每个结果卡片上新增"迁移规划"功能，用户点击按钮后获取针对单个 SAP 对象的完整迁移计划，包括替代方案、分步迁移说明、风险评估、工作量预估、按需展开的代码示例，以及导出 PDF 功能。

---

## 架构

### 后端

**新增 CDS action（`srv/knowledge-service.cds`）：**

```cds
action plan(objectName : String) returns {
  objectName      : String;
  replacement     : String;
  replacementType : String;
  riskLevel       : String;   // "低" | "中" | "高"
  effortEstimate  : String;   // 如 "3-5 天"
  steps           : String;   // JSON 字符串，分步说明数组 [{step, description}]
  codeExample     : String;   // ABAP 代码示例（按需展开）
  summary         : String;   // 一句话摘要，用于 PDF 导出
};
```

**新增 prompt 函数（`srv/prompts.js`）：**

`buildPlanPrompt(objectName)` — 要求 AI 返回包含以下字段的 JSON：
- `replacement` / `replacementType`：替代方案名称和类型
- `riskLevel`："低" | "中" | "高"
- `effortEstimate`：工作量预估字符串
- `steps`：分步迁移说明数组，每步包含 `step`（序号）和 `description`（说明）
- `codeExample`：ABAP 代码示例，展示旧 API → 新 API 的改写
- `summary`：一句话迁移摘要

**新增 handler（`srv/knowledge-service.js`）：**

`srv.on('plan', ...)` — 调用 `aiComplete()` 生成迁移计划，解析 JSON 后返回。输入为空时返回 400。

---

## 前端 UI

**触发方式：** 分类结果卡片底部新增"迁移规划"按钮，点击后调用 `POST /odata/v4/knowledge/plan`，显示 BusyIndicator 等待响应。

**展示结构：**

```
┌─────────────────────────────────────────┐
│ 迁移规划：{objectName}                   │
├─────────────────────────────────────────┤
│ 替代方案：{replacement} ({replacementType}) │
│ 风险等级：{riskLevel}  │  预估工作量：{effortEstimate} │
├─────────────────────────────────────────┤
│ 迁移步骤：                               │
│  1. {step 1 description}                │
│  2. {step 2 description}                │
│  ...                                    │
├─────────────────────────────────────────┤
│ [查看代码示例 ▼]        [导出 PDF]       │
└─────────────────────────────────────────┘
```

- 迁移规划 Panel 默认收起，点击"迁移规划"按钮后展开并填充数据
- "查看代码示例"使用 UI5 Panel 折叠，默认收起，展开后显示 `<pre>` 代码块
- 每个分类卡片独立维护自己的迁移规划面板状态

---

## 导出 PDF

使用浏览器原生 `window.print()` 实现，无第三方依赖：

1. 点击"导出 PDF"后动态创建隐藏 `<iframe>`
2. 向 iframe 写入格式化 HTML（对象名、替代方案、风险等级、工作量、迁移步骤、代码示例）
3. 调用 `iframe.contentWindow.print()`，浏览器弹出打印对话框
4. 用户选择"另存为 PDF"保存
5. 打印完成后移除 iframe

---

## 错误处理

- `objectName` 为空 → 返回 400
- AI 返回非 JSON 格式 → 捕获解析错误，返回 500 并记录日志
- 网络超时 → 前端显示错误提示 Toast

---

## 测试

在 `knowledge-service.test.js` 新增：
- `POST /odata/v4/knowledge/plan` 返回正确结构（含 `riskLevel`、`steps`、`codeExample`）
- 无 `objectName` 时返回 400
