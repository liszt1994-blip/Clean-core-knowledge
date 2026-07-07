# SAP Knowledge Agent — 设计文档

**日期：** 2026-06-25
**版本：** v1.0
**状态：** 待审阅

---

## 1. 项目概述

### 目标
构建一个本地部署的对话式 AI 工具，帮助 SAP 用户学习和查询 Clean Core 相关知识，支持对象分级、废弃 API 替代推荐、SAP Note 搜索。

### 使用人员
全体 SAP 系统用户（非技术背景友好）

### 交互语言
中英文自动识别，用户用什么语言提问就用什么语言回答

---

## 2. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| LLM | Claude API（claude-sonnet-4-5） | 效果好，支持 Tool Use |
| Web UI | Gradio ChatInterface | 原生支持聊天界面，一套代码兼容 Web 和桌面 |
| 桌面版 | PyInstaller 打包 .exe | 无需额外开发，双击运行 |
| API Hub 搜索 | SAP API Hub MCP 工具 | 已集成，直接调用 |
| SAP Note 搜索 | SAP Support Portal API（S-user 认证） | 实时查询官方 Note |
| 语言 | Python 3.12 | 生态完善，与所有组件兼容 |

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    用户界面层                         │
│         Gradio ChatInterface（Web / .exe）           │
└─────────────────────┬───────────────────────────────┘
                       │ 用户输入 + 对话历史
┌─────────────────────▼───────────────────────────────┐
│                   Agent 核心层                        │
│   Claude API + Tool Use                              │
│   - 理解用户意图                                      │
│   - 路由到对应工具                                    │
│   - 中英文自动识别                                    │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
┌──▼──┐  ┌───▼───┐  ┌───▼───┐  ┌───▼───────────────┐
│Tool1│  │Tool2  │  │Tool3  │  │Tool4              │
│概念  │  │对象分级│  │API推荐 │  │SAP Note 搜索      │
│解释  │  │A/B/C/D│  │废弃→新 │  │SAP Support API   │
└─────┘  └───────┘  └───┬───┘  └───────────────────┘
                         │
                  ┌──────▼──────┐
                  │ SAP API Hub │
                  │  MCP 工具   │
                  └─────────────┘
```

---

## 4. 四个核心工具（Tool Use）

### Tool 1：Clean Core 概念解释
- **触发示例：** "什么是 Clean Core？" / "解释一下 Tier 1 是什么意思"
- **实现：** Claude 内置知识 + 系统提示注入 SAP Clean Core 标准定义和术语表
- **输出：** 通俗易懂的中英文解释，附带官方定义参考

### Tool 2：对象分级（A/B/C/D）
- **触发示例：** "BAPI_PO_CREATE1 是几级？" / "这个 Function Module 怎么分类？"
- **实现：** 基于 SAP 官方 Clean Core 分级标准（Released API / Deprecated / Custom Extension 等维度），由 Claude 判断并给出分级依据
- **分级规则：**
  - **A 级：** SAP Released API，官方认证可安全使用
  - **B 级：** 未发布但相对稳定，需谨慎使用
  - **C 级：** 已废弃或不推荐，建议迁移
  - **D 级：** 自定义/修改对象，不符合 Clean Core 原则
- **输出：** 级别 + 判断依据 + 建议

### Tool 3：废弃对象 → 替代 API 推荐
- **触发示例：** "BAPI_PO_CREATE1 废弃了，用什么替代？" / "有没有替代 SE16 的 API？"
- **实现：** 提取对象名称 → 调用 `apihub_search_api` / `apihub_get_details` MCP 工具 → 返回推荐结果
- **输出：** 替代 API 名称、描述、类型（OData/REST）、技术名称

### Tool 4：SAP Note 搜索
- **触发示例：** "有没有关于 Profit Center 的 SAP Note？" / "搜索 Note 关于内存溢出问题"
- **实现：** 提取关键词 → 调用 SAP Support Portal API（Basic Auth：S-user + 密码）
- **API 端点：** `https://launchpad.support.sap.com/services/odata/svt/snogwas/notes`
- **输出：** Note 编号、标题、发布日期、摘要、链接

---

## 5. 数据流

```
用户输入
  │
  ▼
Claude 分析意图（system prompt 定义4种工具及触发条件）
  │
  ├─► 意图=概念解释 → Tool1 → 直接生成解释文本 → 返回用户
  │
  ├─► 意图=对象分级 → Tool2 → 提取对象名 → 判断级别+依据 → 返回用户
  │
  ├─► 意图=废弃替代 → Tool3 → 提取对象名 → 调用 API Hub MCP → 格式化结果 → 返回用户
  │
  └─► 意图=Note搜索 → Tool4 → 提取关键词 → 调用 SAP Support API → 格式化列表 → 返回用户
```

**对话历史：** Gradio ChatInterface 自动维护，每轮对话将完整历史传入 Claude API messages，支持追问和上下文理解。

---

## 6. 项目结构

```
sap-knowledge-agent/
├── main.py                 # 入口：启动 Gradio UI，加载配置
├── agent.py                # Claude Agent 核心：Tool Use 定义、消息循环
├── tools/
│   ├── __init__.py
│   ├── clean_core.py       # Tool 1: Clean Core 概念解释
│   ├── classifier.py       # Tool 2: 对象分级 A/B/C/D
│   ├── api_recommender.py  # Tool 3: 废弃对象 → 替代 API（调用 API Hub）
│   └── sap_note.py         # Tool 4: SAP Note 搜索（调用 Support Portal API）
├── prompts/
│   └── system_prompt.txt   # 角色定义、Clean Core 知识注入、语言规则
├── config.py               # 读取环境变量：API Key、SAP S-user 配置
├── .env                    # 本地凭证（不提交 git）
├── .env.example            # 凭证模板（提交 git）
├── requirements.txt        # 依赖列表
├── build.bat               # 一键 PyInstaller 打包 .exe
└── README.md               # 安装和使用说明
```

---

## 7. 配置管理

`.env` 文件（本地保存，不入 git）：

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
SAP_S_USER=S000xxxxxxx
SAP_S_PASSWORD=xxxxxxxx
```

---

## 8. 部署方式

### Web 版
```bash
pip install -r requirements.txt
python main.py
# 浏览器访问 http://localhost:7860
```

### 桌面版（.exe）
```bash
build.bat
# 生成 dist/SAP-Knowledge-Agent.exe
# 双击运行，自动打开浏览器
```

---

## 9. 依赖列表（requirements.txt）

```
anthropic>=0.30.0
gradio>=4.0.0
requests>=2.31.0
python-dotenv>=1.0.0
pyinstaller>=6.0.0  # 仅打包时需要
```

---

## 10. 约束与边界

- SAP Note 搜索依赖 SAP Support Portal 网络访问，需要企业内网或 VPN
- API Hub MCP 工具已集成，无需额外配置
- 对象分级基于 LLM 判断，非实时查询 SAP 系统，结果仅供参考
- 不存储用户对话历史到本地（每次启动对话重置）
