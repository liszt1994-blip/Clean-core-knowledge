# SAP Clean Core Tools — 设计规范

**日期：** 2026-06-22  
**状态：** 已确认  
**技术栈：** SAP UI5 + SAP CAP + Claude API  
**部署方式：** 三个独立应用，Monorepo 管理

---

## 整体架构

三个工具放在同一个 Git 仓库（Monorepo），共享公共模块，各自独立部署。

```
clean-core-tools/
├── shared/                  ← 公共模块
│   ├── adt-client/          ← ADT REST API 客户端
│   ├── claude-client/       ← Claude API 客户端
│   └── atc-xml-parser/      ← ATC XML 解析器
├── tool1-knowledge/         ← 独立 CAP 应用
├── tool2-atc/               ← 独立 CAP 应用
└── tool3-planner/           ← 独立 CAP 应用
```

**共享模块说明：**
- `adt-client`：封装所有 ADT REST API 调用（读源码、写源码、锁定、激活、语法检查）
- `claude-client`：封装 Claude API 调用，支持流式输出（SSE）
- `atc-xml-parser`：解析 ATC 导出的 XML，返回统一的违规对象数组，供工具 2 和工具 3 复用

---

## 工具 1：知识学习

### 目标用户
全体用户

### 功能概述
通俗解读 Clean Core 概念、按 A/B/C/D 分级对象、为废弃对象推荐替代 API。知识库完全由 Claude 生成，后端内嵌 Clean Core 知识框架作为 System Prompt。

### 架构

```
UI5 前端（单页，Tab 切换）
├── Tab 1: 概念解读
├── Tab 2: 对象分级
└── Tab 3: 替代 API 推荐

CAP 后端 /api/knowledge
├── POST /explain       ← 概念解读
├── POST /classify      ← 对象分级
└── POST /recommend     ← 替代 API 推荐
```

### 各功能设计

**Tab 1 — 概念解读**
- 输入：任意 Clean Core 相关词汇（如 "RAP"、"Tier 1"、"Stable API"）
- 处理：后端构造含 Clean Core 上下文的 System Prompt，调用 Claude
- 输出：通俗语言解释，支持 SSE 流式输出，逐字显示

**Tab 2 — 对象分级**
- 输入：一个或多个 SAP 对象名（如 `BAPI_MATERIAL_SAVEDATA`、`SE16`）
- 处理：Claude 按 SAP Clean Core A/B/C/D 分级标准逐一判断
- 输出：表格展示（对象名 | 等级 | 说明 | 建议行动）

**Tab 3 — 替代 API 推荐**
- 输入：废弃对象名
- 处理：Claude 推荐现代替代方案
- 输出：替代方案列表（OData API / RAP BO / CDS View），含迁移方向说明

### System Prompt 策略
三个功能共享一个基础 System Prompt，内嵌 Clean Core 核心知识框架：
- A/B/C/D 分级定义
- 典型废弃对象模式
- 替代方向（传统 BAPI → OData API，SE16 → Custom CDS View，等）

---

## 工具 2：ATC 分析+修复器

### 目标用户
开发者

### 架构

```
UI5 前端
├── Phase 1: 上传 XML → 实时显示 Agent 思考过程（SSE）
├── Phase 2: Diff 展示 → 用户确认/跳过
├── Phase 3: 写回进度展示
└── Phase 4: 激活结果 + 自动修复循环展示

CAP 后端
├── POST /upload-atc        ← 解析 XML，返回违规分组
├── GET  /analyze/:jobId    ← SSE 流，推送 Agent 思考过程
├── POST /confirm           ← 用户确认，触发写回流程
└── GET  /activate/:jobId   ← SSE 流，推送激活+修复进度
```

### Phase 1：智能分析（ReAct Agent）

**并发控制：** XML 解析后按 Program 分组，每组启动一个独立 ReAct Agent，最多并发 8 个，超出排队。每个 Agent 最多 8 步。

**Agent 工具集：**

| 工具 | 作用 |
|------|------|
| `get_source_code` | 通过 ADT API 取 ABAP 源码 |
| `get_ddic_definition` | 查结构/数据元素定义 |
| `query_clean_core_knowledge` | 查 Clean Core 知识（调 Claude） |
| `generate_replacement_code` | 生成替换代码 |

**SSE 推送内容：** Agent 每步的思考过程、工具调用、工具结果，实时推送到前端。前端按 Program 分栏展示各 Agent 的推理过程。

**输出：** 每条违规 → 替换代码 + 修改说明。

### Phase 2：用户确认

展示三栏 Diff：
- 左：原始代码（高亮违规行）
- 右：替换代码（高亮修改行）
- 下：修改说明（Agent 生成）

用户操作：
1. 输入预建好的 Transport Request 号
2. 逐条选择「确认实施」或「跳过」（支持全选/全跳过）

### Phase 3：写回 S/4HANA（严格顺序）

每条违规独立执行，任一步失败立即中止该条，不影响其他条：

```
① 检查锁定（ADT lock check）
   └─ 有锁 → 显示锁定人员，标记"需人工协调"，跳过该条
② 语法预检（ADT syntax check）
   └─ 有错 → 显示错误详情，标记"预检失败"，跳过该条
③ Lock 对象（ADT lock）
④ 写入新源码（ADT put source）
⑤ Unlock 对象（ADT unlock）
```

### Phase 4：激活 + 自动修复循环

写回完成后批量触发 ADT 激活。失败时进入自动修复循环：

```
激活失败
└─ 解析错误行号 + 错误信息
   └─ Claude 生成修复代码
      └─ 重走 Phase 3 写回流程
         └─ 重新激活
            ├─ 成功 → ✓ 完成
            └─ 第 5 次仍失败 → 标记"需人工处理"，保留最后错误信息
```

最大自动修复次数：5 次。

---

## 工具 3：整改规划器

### 目标用户
项目经理 / 架构师

### 架构

```
UI5 前端（向导式，4 步）
├── Step 1: 数据导入
├── Step 2: 团队配置
├── Step 3: 规划视图（核心）
└── Step 4: 导出

CAP 后端
├── POST /import-atc        ← 解析 XML 或工具 2 JSON
├── POST /analyze-deps      ← Claude 分析对象依赖关系
├── POST /generate-plan     ← Claude 生成迭代计划
└── POST /export            ← 生成 Excel / PDF
```

### Step 1：数据导入

两种入口并列展示：
- **上传 ATC XML**：复用 shared/atc-xml-parser 模块
- **导入工具 2 结果**：上传工具 2 导出的 JSON，跳过重复分析

导入后展示违规汇总：总数、按 Program 分布、按违规类型分布。

### Step 2：团队配置

| 配置项 | 说明 |
|--------|------|
| 团队成员 | 姓名 + 角色（开发/架构师/PM） |
| 每日可用工时 | 每人单独设置，默认 6h |
| 项目截止日期 | 硬截止，超出时规划器警告 |
| Sprint 长度 | 默认 2 周 |
| 优先级权重 | A 级违规优先 / 依赖关系优先 / 工作量均衡（三选一） |

### Step 3：规划视图（核心）

**第一步 — 依赖分析（Claude）**
分析所有开发对象间的依赖关系（共用对象、修改顺序约束），输出依赖图。前端用有向图可视化：节点为对象，边为依赖方向。

**第二步 — 迭代计划生成（Claude）**
基于依赖关系 + 团队配置，生成分 Sprint 的任务分配表：

```
Sprint 1（第 1-2 周）
├── 开发者A：Program X（预估 3 天）、Program Y（预估 2 天）
├── 开发者B：Program Z（预估 4 天）
└── 里程碑：完成所有 A 级违规修复
```

每条任务显示：违规数量、预估工时、分配人员、所属 Sprint、前置依赖任务。

**拖拽调整：** 支持拖动任务到不同 Sprint 或不同人员，工时自动重新计算，超出截止日期时高亮警告。

### Step 4：导出

| 格式 | 内容 |
|------|------|
| Excel | 每个 Sprint 一个 Sheet，包含任务清单、工时、人员分工 |
| PDF | 项目计划摘要，适合管理层汇报 |

---

## 关键技术决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 仓库结构 | Monorepo | ADT 客户端和 ATC 解析器被多个工具复用 |
| 前端 | SAP UI5 | 与 SAP 系统视觉一致，企业内部工具标准 |
| 后端 | SAP CAP | 原生 SAP 生态，OData 支持开箱即用 |
| AI | Claude API | 当前团队已在使用 |
| S/4HANA 接入 | ADT REST API | SAP 标准接口，支持读写源码、激活、锁定 |
| 知识库 | Claude 内嵌 System Prompt | 无需维护外部知识库，Claude 本身具备足够的 Clean Core 知识 |
| Agent 并发 | 最多 8 个 ReAct Agent | 平衡性能与 API 调用成本 |
| 写回顺序 | 严格串行，不可并发 | 避免锁定冲突，保证数据一致性 |
