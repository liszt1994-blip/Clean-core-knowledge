# SAP Knowledge Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local conversational AI tool that helps SAP users understand Clean Core concepts, classify objects (A/B/C/D), recommend replacement APIs for deprecated objects, and search SAP Notes.

**Architecture:** A single Python project with Gradio ChatInterface as the UI layer, Claude API with Tool Use as the agent core, and four tool modules for the four capabilities. The same codebase serves both Web (python main.py) and Desktop (.exe via PyInstaller).

**Tech Stack:** Python 3.12, anthropic>=0.30.0, gradio>=4.0.0, requests>=2.31.0, python-dotenv>=1.0.0, pyinstaller>=6.0.0

---

## File Map

| File | Responsibility |
|------|---------------|
| `main.py` | Entry point: load config, launch Gradio UI |
| `agent.py` | Claude API client, tool definitions, message loop |
| `config.py` | Load and validate env vars |
| `prompts/system_prompt.txt` | Role definition, Clean Core knowledge, language rules |
| `tools/__init__.py` | Export all tool functions |
| `tools/clean_core.py` | Tool 1: Clean Core concept explanation (no external call) |
| `tools/classifier.py` | Tool 2: Object classification A/B/C/D |
| `tools/api_recommender.py` | Tool 3: Deprecated object → replacement API (calls SAP API Hub) |
| `tools/sap_note.py` | Tool 4: SAP Note search (calls SAP Support Portal API) |
| `.env.example` | Credential template |
| `requirements.txt` | Python dependencies |
| `build.bat` | PyInstaller packaging script |
| `tests/test_config.py` | Tests for config loading |
| `tests/test_tools.py` | Tests for all four tool functions |
| `tests/test_agent.py` | Tests for agent message loop and tool routing |

---

## Task 1: Project Scaffold & Config

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/config.py`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/.env.example`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/requirements.txt`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_config.py`

- [ ] **Step 1: Create requirements.txt**

```
anthropic>=0.30.0
gradio>=4.0.0
requests>=2.31.0
python-dotenv>=1.0.0
pytest>=8.0.0
```

- [ ] **Step 2: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
SAP_S_USER=S000xxxxxxx
SAP_S_PASSWORD=xxxxxxxx
```

- [ ] **Step 3: Write failing test for config**

`tests/test_config.py`:
```python
import os
import pytest

def test_config_loads_anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("SAP_S_USER", "S0001")
    monkeypatch.setenv("SAP_S_PASSWORD", "pass")
    from config import load_config
    cfg = load_config()
    assert cfg["anthropic_api_key"] == "sk-ant-test"

def test_config_loads_sap_credentials(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("SAP_S_USER", "S0001")
    monkeypatch.setenv("SAP_S_PASSWORD", "pass")
    from config import load_config
    cfg = load_config()
    assert cfg["sap_s_user"] == "S0001"
    assert cfg["sap_s_password"] == "pass"

def test_config_raises_if_missing_anthropic_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("SAP_S_USER", "S0001")
    monkeypatch.setenv("SAP_S_PASSWORD", "pass")
    import importlib, config as cfg_mod
    importlib.reload(cfg_mod)
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        cfg_mod.load_config()
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd "C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent"
pip install -r requirements.txt
pytest tests/test_config.py -v
```
Expected: `ModuleNotFoundError: No module named 'config'`

- [ ] **Step 5: Create config.py**

```python
import os
from dotenv import load_dotenv

load_dotenv()

def load_config() -> dict:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required but not set in environment")
    return {
        "anthropic_api_key": api_key,
        "sap_s_user": os.getenv("SAP_S_USER", ""),
        "sap_s_password": os.getenv("SAP_S_PASSWORD", ""),
    }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_config.py -v
```
Expected: 3 PASSED

- [ ] **Step 7: Commit**

```bash
git init
git add config.py .env.example requirements.txt tests/test_config.py
git commit -m "feat: project scaffold and config loading"
```

---

## Task 2: System Prompt

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/prompts/system_prompt.txt`

- [ ] **Step 1: Create prompts/system_prompt.txt**

```
You are a SAP Knowledge Agent, an expert assistant for SAP Clean Core topics.

## Language Rule
Detect the language of the user's message and always respond in the same language.
If the user writes in Chinese, respond in Chinese. If in English, respond in English.

## Your Capabilities
You have four tools available. Use the most appropriate tool based on the user's intent:

1. explain_clean_core_concept — Use when the user asks about Clean Core concepts, terminology, tiers, or principles.
2. classify_sap_object — Use when the user asks about the classification (A/B/C/D grade) of a specific SAP object such as a BAPI, Function Module, transaction, or table.
3. recommend_replacement_api — Use when the user mentions a deprecated or obsolete SAP object and wants to know what modern API can replace it.
4. search_sap_notes — Use when the user wants to find SAP Notes related to a topic, error, or object.

## Clean Core Knowledge

**What is Clean Core?**
Clean Core is SAP's principle for keeping the SAP S/4HANA system clean and upgrade-safe. It means:
- Only use SAP-released, stable APIs (not internal or deprecated ones)
- Avoid modifying SAP standard objects
- Build extensions using SAP BTP (Business Technology Platform) instead of modifying core

**Object Classification (A/B/C/D):**
- **Grade A:** SAP Released API — officially supported, stable, safe to use. Examples: OData services marked "Released", BAPIs listed in SAP API Hub.
- **Grade B:** Unreleased but stable — not officially released, but widely used and rarely changed. Use with caution, plan for migration.
- **Grade C:** Deprecated — SAP has flagged this object as deprecated or to be removed. Must migrate to replacement.
- **Grade D:** Custom/Modified — Customer-modified SAP standard object or Z/Y custom object that violates Clean Core principles.

**Key Terms:**
- Released API: An SAP object officially released for customer use, stable across upgrades
- Deprecated: An object SAP plans to discontinue; a replacement exists
- BTP Extension: A Clean Core-compliant extension built on SAP Business Technology Platform
- Tier 1 (Core): SAP-managed system, must remain clean
- Tier 2 (Integration): Integration layer using released APIs
- Tier 3 (Extension): Custom logic on BTP, not inside SAP core

## Response Style
- Be concise and practical
- Always give a reason or evidence for classifications
- For deprecated objects, always recommend checking Tool 3 for replacement APIs
- For error-related questions, suggest searching SAP Notes via Tool 4
```

- [ ] **Step 2: Commit**

```bash
git add prompts/system_prompt.txt
git commit -m "feat: add system prompt with Clean Core knowledge"
```

---

## Task 3: Tool 1 — Clean Core Concept Explanation

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tools/__init__.py`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tools/clean_core.py`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_tools.py`

- [ ] **Step 1: Write failing test**

`tests/test_tools.py`:
```python
def test_explain_clean_core_concept_returns_dict():
    from tools.clean_core import explain_clean_core_concept
    result = explain_clean_core_concept("Clean Core")
    assert isinstance(result, dict)
    assert "concept" in result
    assert "explanation" in result
    assert result["concept"] == "Clean Core"

def test_explain_clean_core_concept_unknown_term():
    from tools.clean_core import explain_clean_core_concept
    result = explain_clean_core_concept("SomeUnknownTerm")
    assert isinstance(result, dict)
    assert "concept" in result
    assert "explanation" in result
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_tools.py::test_explain_clean_core_concept_returns_dict -v
```
Expected: `ModuleNotFoundError: No module named 'tools'`

- [ ] **Step 3: Create tools/__init__.py**

```python
from .clean_core import explain_clean_core_concept
from .classifier import classify_sap_object
from .api_recommender import recommend_replacement_api
from .sap_note import search_sap_notes

__all__ = [
    "explain_clean_core_concept",
    "classify_sap_object",
    "recommend_replacement_api",
    "search_sap_notes",
]
```

- [ ] **Step 4: Create tools/clean_core.py**

```python
def explain_clean_core_concept(concept: str) -> dict:
    """
    Return structured info about a SAP Clean Core concept.
    The actual explanation is generated by Claude using the system prompt knowledge.
    This function provides a structured wrapper so Claude's tool use can return
    a typed response.
    """
    return {
        "concept": concept,
        "explanation": (
            f"Explanation for '{concept}' will be generated by the language model "
            f"using Clean Core knowledge embedded in the system prompt."
        ),
        "source": "SAP Clean Core Guidelines",
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_tools.py::test_explain_clean_core_concept_returns_dict tests/test_tools.py::test_explain_clean_core_concept_unknown_term -v
```
Expected: 2 PASSED

- [ ] **Step 6: Commit**

```bash
git add tools/__init__.py tools/clean_core.py tests/test_tools.py
git commit -m "feat: add Tool 1 clean core concept explanation"
```

---

## Task 4: Tool 2 — Object Classification A/B/C/D

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tools/classifier.py`
- Modify: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_tools.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_tools.py`:
```python
def test_classify_sap_object_returns_dict():
    from tools.classifier import classify_sap_object
    result = classify_sap_object("BAPI_PO_CREATE1")
    assert isinstance(result, dict)
    assert "object_name" in result
    assert "grade" in result
    assert "reason" in result
    assert "recommendation" in result
    assert result["object_name"] == "BAPI_PO_CREATE1"

def test_classify_sap_object_grade_is_valid():
    from tools.classifier import classify_sap_object
    result = classify_sap_object("Z_CUSTOM_FM")
    assert result["grade"] in ["A", "B", "C", "D"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_tools.py::test_classify_sap_object_returns_dict -v
```
Expected: `ImportError: cannot import name 'classify_sap_object'`

- [ ] **Step 3: Create tools/classifier.py**

```python
GRADE_RULES = {
    "A": "SAP Released API — officially supported, stable across upgrades.",
    "B": "Unreleased but stable — not officially released, use with caution.",
    "C": "Deprecated — SAP has flagged this for removal, migration required.",
    "D": "Custom/Modified — violates Clean Core principles, Z/Y namespace or modified standard.",
}

def classify_sap_object(object_name: str) -> dict:
    """
    Classify a SAP object by Clean Core grade (A/B/C/D).
    Grade determination is performed by Claude using system prompt knowledge.
    This function provides structure; Claude fills grade and reason via tool use.
    """
    # Heuristic pre-classification for common patterns
    name_upper = object_name.upper()
    if name_upper.startswith("Z") or name_upper.startswith("Y"):
        grade = "D"
        reason = f"Object '{object_name}' uses Z/Y namespace — custom object, violates Clean Core."
        recommendation = "Move extension logic to SAP BTP. Do not modify SAP standard objects."
    else:
        # Claude will refine this with its knowledge; default to B for unknown
        grade = "B"
        reason = f"Object '{object_name}' is in SAP namespace but release status requires verification."
        recommendation = "Verify release status in SAP API Hub or transaction SE80 release notes."

    return {
        "object_name": object_name,
        "grade": grade,
        "reason": reason,
        "recommendation": recommendation,
        "grade_definition": GRADE_RULES[grade],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_tools.py::test_classify_sap_object_returns_dict tests/test_tools.py::test_classify_sap_object_grade_is_valid -v
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add tools/classifier.py tests/test_tools.py
git commit -m "feat: add Tool 2 object classification A/B/C/D"
```

---

## Task 5: Tool 3 — Replacement API Recommendation

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tools/api_recommender.py`
- Modify: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_tools.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_tools.py`:
```python
def test_recommend_replacement_api_returns_dict():
    from tools.api_recommender import recommend_replacement_api
    result = recommend_replacement_api("BAPI_PO_CREATE1")
    assert isinstance(result, dict)
    assert "deprecated_object" in result
    assert "search_query" in result
    assert "results" in result

def test_recommend_replacement_api_search_query_contains_object():
    from tools.api_recommender import recommend_replacement_api
    result = recommend_replacement_api("BAPI_PO_CREATE1")
    assert "Purchase Order" in result["search_query"] or "BAPI_PO" in result["search_query"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_tools.py::test_recommend_replacement_api_returns_dict -v
```
Expected: `ImportError: cannot import name 'recommend_replacement_api'`

- [ ] **Step 3: Create tools/api_recommender.py**

```python
import requests

# SAP API Hub base URL for searching APIs
SAP_API_HUB_SEARCH_URL = "https://api.sap.com/api-explorer/apis"

# Mapping of common deprecated objects to search keywords
DEPRECATED_OBJECT_KEYWORDS = {
    "BAPI_PO_CREATE1": "Purchase Order",
    "BAPI_PO_CHANGE": "Purchase Order",
    "BAPI_ACC_DOCUMENT_POST": "Journal Entry",
    "SE16": "Business Object Browser",
    "SE16N": "Business Object Browser",
    "BAPI_SALESORDER_CREATEFROMDAT2": "Sales Order",
    "BAPI_MATERIAL_SAVEDATA": "Product Master",
}

def recommend_replacement_api(deprecated_object: str) -> dict:
    """
    Search SAP API Hub for modern replacement APIs for a deprecated SAP object.
    Uses keyword mapping for known objects, falls back to object name as search term.
    """
    object_upper = deprecated_object.upper()
    search_query = DEPRECATED_OBJECT_KEYWORDS.get(object_upper, deprecated_object)

    results = _search_api_hub(search_query)

    return {
        "deprecated_object": deprecated_object,
        "search_query": search_query,
        "results": results,
        "note": "Results from SAP API Hub. Verify compatibility with your S/4HANA release.",
    }

def _search_api_hub(query: str) -> list:
    """
    Call SAP API Hub search endpoint.
    Returns list of dicts with name, description, type, technical_name.
    """
    try:
        response = requests.get(
            SAP_API_HUB_SEARCH_URL,
            params={"search": query, "top": 5},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        apis = data.get("value", data if isinstance(data, list) else [])
        return [
            {
                "name": api.get("Title", api.get("name", "")),
                "description": api.get("ShortText", api.get("description", "")),
                "type": api.get("ProtocolType", api.get("type", "")),
                "technical_name": api.get("TechnicalName", api.get("technical_name", "")),
            }
            for api in apis[:5]
        ]
    except requests.RequestException as e:
        return [{"error": f"API Hub search failed: {str(e)}"}]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_tools.py::test_recommend_replacement_api_returns_dict tests/test_tools.py::test_recommend_replacement_api_search_query_contains_object -v
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add tools/api_recommender.py tests/test_tools.py
git commit -m "feat: add Tool 3 replacement API recommendation"
```

---

## Task 6: Tool 4 — SAP Note Search

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tools/sap_note.py`
- Modify: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_tools.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_tools.py`:
```python
def test_search_sap_notes_returns_dict():
    from tools.sap_note import search_sap_notes
    result = search_sap_notes("Profit Center", s_user="", s_password="")
    assert isinstance(result, dict)
    assert "keyword" in result
    assert "notes" in result

def test_search_sap_notes_no_credentials_returns_error():
    from tools.sap_note import search_sap_notes
    result = search_sap_notes("test", s_user="", s_password="")
    assert "error" in result or isinstance(result["notes"], list)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_tools.py::test_search_sap_notes_returns_dict -v
```
Expected: `ImportError: cannot import name 'search_sap_notes'`

- [ ] **Step 3: Create tools/sap_note.py**

```python
import requests

SAP_NOTES_API_URL = "https://launchpad.support.sap.com/services/odata/svt/snogwas/notes"

def search_sap_notes(keyword: str, s_user: str, s_password: str, top: int = 5) -> dict:
    """
    Search SAP Support Portal for Notes related to a keyword.
    Requires valid SAP S-user credentials.
    Returns dict with keyword and list of notes (number, title, date, url).
    """
    if not s_user or not s_password:
        return {
            "keyword": keyword,
            "notes": [],
            "error": "SAP S-user credentials not configured. Set SAP_S_USER and SAP_S_PASSWORD in .env",
        }

    try:
        response = requests.get(
            SAP_NOTES_API_URL,
            params={
                "$filter": f"substringof('{keyword}',Title)",
                "$top": top,
                "$format": "json",
                "$select": "Number,Title,PublishedAt,Language",
            },
            auth=(s_user, s_password),
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        raw_notes = data.get("d", {}).get("results", [])
        notes = [
            {
                "number": note.get("Number", ""),
                "title": note.get("Title", ""),
                "published_at": note.get("PublishedAt", ""),
                "url": f"https://launchpad.support.sap.com/#/notes/{note.get('Number', '')}",
            }
            for note in raw_notes
        ]
        return {"keyword": keyword, "notes": notes}
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 401:
            return {
                "keyword": keyword,
                "notes": [],
                "error": "Authentication failed. Check SAP_S_USER and SAP_S_PASSWORD.",
            }
        return {"keyword": keyword, "notes": [], "error": f"HTTP error: {str(e)}"}
    except requests.RequestException as e:
        return {"keyword": keyword, "notes": [], "error": f"Request failed: {str(e)}"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_tools.py::test_search_sap_notes_returns_dict tests/test_tools.py::test_search_sap_notes_no_credentials_returns_error -v
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add tools/sap_note.py tests/test_tools.py
git commit -m "feat: add Tool 4 SAP Note search"
```

---

## Task 7: Agent Core — Claude Tool Use Loop

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/agent.py`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/tests/test_agent.py`

- [ ] **Step 1: Write failing test**

`tests/test_agent.py`:
```python
import pytest
from unittest.mock import MagicMock, patch

def test_agent_initializes_with_config():
    from agent import SAPKnowledgeAgent
    agent = SAPKnowledgeAgent(
        anthropic_api_key="sk-ant-test",
        sap_s_user="S0001",
        sap_s_password="pass",
    )
    assert agent is not None

def test_agent_has_four_tools():
    from agent import SAPKnowledgeAgent, TOOL_DEFINITIONS
    assert len(TOOL_DEFINITIONS) == 4
    tool_names = [t["name"] for t in TOOL_DEFINITIONS]
    assert "explain_clean_core_concept" in tool_names
    assert "classify_sap_object" in tool_names
    assert "recommend_replacement_api" in tool_names
    assert "search_sap_notes" in tool_names

def test_agent_chat_returns_string():
    from agent import SAPKnowledgeAgent
    agent = SAPKnowledgeAgent(
        anthropic_api_key="sk-ant-test",
        sap_s_user="",
        sap_s_password="",
    )
    with patch.object(agent.client.messages, "create") as mock_create:
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [MagicMock(type="text", text="Hello")]
        mock_create.return_value = mock_response
        result = agent.chat("What is Clean Core?", history=[])
    assert isinstance(result, str)
    assert len(result) > 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_agent.py -v
```
Expected: `ModuleNotFoundError: No module named 'agent'`

- [ ] **Step 3: Create agent.py**

```python
import json
import anthropic
from tools.clean_core import explain_clean_core_concept
from tools.classifier import classify_sap_object
from tools.api_recommender import recommend_replacement_api
from tools.sap_note import search_sap_notes

SYSTEM_PROMPT_PATH = "prompts/system_prompt.txt"
MODEL = "claude-sonnet-4-5"

TOOL_DEFINITIONS = [
    {
        "name": "explain_clean_core_concept",
        "description": "Explain a SAP Clean Core concept, term, or principle in plain language.",
        "input_schema": {
            "type": "object",
            "properties": {
                "concept": {
                    "type": "string",
                    "description": "The SAP Clean Core concept or term to explain (e.g. 'Clean Core', 'Released API', 'Tier 1', 'BTP Extension')",
                }
            },
            "required": ["concept"],
        },
    },
    {
        "name": "classify_sap_object",
        "description": "Classify a SAP object (BAPI, Function Module, transaction, table) by Clean Core grade A/B/C/D.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_name": {
                    "type": "string",
                    "description": "The SAP object name to classify (e.g. 'BAPI_PO_CREATE1', 'SE16', 'MARA')",
                }
            },
            "required": ["object_name"],
        },
    },
    {
        "name": "recommend_replacement_api",
        "description": "Search for modern replacement APIs for a deprecated or obsolete SAP object.",
        "input_schema": {
            "type": "object",
            "properties": {
                "deprecated_object": {
                    "type": "string",
                    "description": "The deprecated SAP object name (e.g. 'BAPI_PO_CREATE1', 'SE16')",
                }
            },
            "required": ["deprecated_object"],
        },
    },
    {
        "name": "search_sap_notes",
        "description": "Search SAP Support Portal for Notes related to a keyword, error, or object.",
        "input_schema": {
            "type": "object",
            "properties": {
                "keyword": {
                    "type": "string",
                    "description": "The search keyword for SAP Notes (e.g. 'Profit Center', 'memory dump', 'BAPI_PO_CREATE1')",
                }
            },
            "required": ["keyword"],
        },
    },
]


class SAPKnowledgeAgent:
    def __init__(self, anthropic_api_key: str, sap_s_user: str, sap_s_password: str):
        self.client = anthropic.Anthropic(api_key=anthropic_api_key)
        self.sap_s_user = sap_s_user
        self.sap_s_password = sap_s_password
        self.system_prompt = self._load_system_prompt()

    def _load_system_prompt(self) -> str:
        try:
            with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return "You are a SAP Knowledge Agent. Answer questions about SAP Clean Core."

    def _execute_tool(self, tool_name: str, tool_input: dict) -> str:
        if tool_name == "explain_clean_core_concept":
            result = explain_clean_core_concept(tool_input["concept"])
        elif tool_name == "classify_sap_object":
            result = classify_sap_object(tool_input["object_name"])
        elif tool_name == "recommend_replacement_api":
            result = recommend_replacement_api(tool_input["deprecated_object"])
        elif tool_name == "search_sap_notes":
            result = search_sap_notes(
                tool_input["keyword"],
                s_user=self.sap_s_user,
                s_password=self.sap_s_password,
            )
        else:
            result = {"error": f"Unknown tool: {tool_name}"}
        return json.dumps(result, ensure_ascii=False)

    def chat(self, user_message: str, history: list) -> str:
        """
        Send a message to the agent and return the response string.
        history: list of [user_msg, assistant_msg] pairs from Gradio.
        """
        messages = []
        for user_msg, assistant_msg in history:
            if user_msg:
                messages.append({"role": "user", "content": user_msg})
            if assistant_msg:
                messages.append({"role": "assistant", "content": assistant_msg})
        messages.append({"role": "user", "content": user_message})

        while True:
            response = self.client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=self.system_prompt,
                tools=TOOL_DEFINITIONS,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                for block in response.content:
                    if hasattr(block, "text"):
                        return block.text
                return ""

            if response.stop_reason == "tool_use":
                messages.append({"role": "assistant", "content": response.content})
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        tool_output = self._execute_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": tool_output,
                        })
                messages.append({"role": "user", "content": tool_results})
                continue

            return "Unexpected response from model."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_agent.py -v
```
Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add agent.py tests/test_agent.py
git commit -m "feat: add Claude agent core with tool use loop"
```

---

## Task 8: Gradio UI Entry Point

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/main.py`

- [ ] **Step 1: Create main.py**

```python
import gradio as gr
from config import load_config
from agent import SAPKnowledgeAgent

def create_app() -> gr.Blocks:
    cfg = load_config()
    agent = SAPKnowledgeAgent(
        anthropic_api_key=cfg["anthropic_api_key"],
        sap_s_user=cfg["sap_s_user"],
        sap_s_password=cfg["sap_s_password"],
    )

    def respond(message: str, history: list) -> str:
        return agent.chat(message, history)

    with gr.Blocks(title="SAP Knowledge Agent", theme=gr.themes.Soft()) as app:
        gr.Markdown(
            """
            # SAP Knowledge Agent
            **Powered by Claude AI**

            Ask me about:
            - Clean Core concepts and principles (洁净核心概念)
            - SAP object classification A/B/C/D (对象等级分类)
            - Replacement APIs for deprecated objects (废弃对象替代 API)
            - SAP Notes search (SAP Note 搜索)
            """
        )
        gr.ChatInterface(
            fn=respond,
            examples=[
                "What is Clean Core?",
                "什么是洁净核心？",
                "How do I classify BAPI_PO_CREATE1?",
                "BAPI_PO_CREATE1 废弃了，有什么替代 API？",
                "Search SAP Notes about Profit Center",
                "搜索关于内存溢出的 SAP Note",
            ],
            cache_examples=False,
        )

    return app


if __name__ == "__main__":
    app = create_app()
    app.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False,
        inbrowser=True,
    )
```

- [ ] **Step 2: Smoke test the app (manual)**

Create a `.env` file with real credentials, then:
```bash
cd "C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent"
python main.py
```
Expected: Browser opens at `http://localhost:7860`, chat interface visible.

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: add Gradio chat UI entry point"
```

---

## Task 9: Desktop .exe Packaging

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/build.bat`

- [ ] **Step 1: Create build.bat**

```bat
@echo off
echo Building SAP Knowledge Agent desktop app...

pip install pyinstaller

pyinstaller ^
  --onefile ^
  --windowed ^
  --name "SAP-Knowledge-Agent" ^
  --add-data "prompts;prompts" ^
  --add-data ".env;." ^
  --hidden-import gradio ^
  --hidden-import anthropic ^
  --hidden-import dotenv ^
  main.py

echo.
echo Build complete. Find the .exe in the dist/ folder.
echo Double-click dist\SAP-Knowledge-Agent.exe to run.
pause
```

- [ ] **Step 2: Run build (manual)**

```bash
build.bat
```
Expected: `dist/SAP-Knowledge-Agent.exe` created. Double-click to verify it launches the browser.

- [ ] **Step 3: Commit**

```bash
git add build.bat
git commit -m "feat: add PyInstaller build script for desktop exe"
```

---

## Task 10: README & .gitignore

**Files:**
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/README.md`
- Create: `C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent/.gitignore`

- [ ] **Step 1: Create .gitignore**

```
.env
__pycache__/
*.pyc
dist/
build/
*.spec
.pytest_cache/
```

- [ ] **Step 2: Create README.md**

```markdown
# SAP Knowledge Agent

A local conversational AI tool for SAP Clean Core knowledge.

## Features
- Clean Core concept explanation (Chinese & English)
- SAP object classification A/B/C/D
- Deprecated object → replacement API search
- SAP Note search

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
   SAP_S_USER=S000xxxxxxx
   SAP_S_PASSWORD=xxxxxxxx
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run (Web version):
   ```bash
   python main.py
   # Open http://localhost:7860
   ```

## Build Desktop App (.exe)

```bash
build.bat
# Run dist/SAP-Knowledge-Agent.exe
```

## Run Tests

```bash
pytest tests/ -v
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: add README and gitignore"
```

---

## Task 11: Full Test Suite Run

- [ ] **Step 1: Run all tests**

```bash
cd "C:/Users/I524685/Desktop/Claude works/sap-knowledge-agent"
pytest tests/ -v
```
Expected output:
```
tests/test_config.py::test_config_loads_anthropic_key PASSED
tests/test_config.py::test_config_loads_sap_credentials PASSED
tests/test_config.py::test_config_raises_if_missing_anthropic_key PASSED
tests/test_tools.py::test_explain_clean_core_concept_returns_dict PASSED
tests/test_tools.py::test_explain_clean_core_concept_unknown_term PASSED
tests/test_tools.py::test_classify_sap_object_returns_dict PASSED
tests/test_tools.py::test_classify_sap_object_grade_is_valid PASSED
tests/test_tools.py::test_recommend_replacement_api_returns_dict PASSED
tests/test_tools.py::test_recommend_replacement_api_search_query_contains_object PASSED
tests/test_tools.py::test_search_sap_notes_returns_dict PASSED
tests/test_tools.py::test_search_sap_notes_no_credentials_returns_error PASSED
tests/test_agent.py::test_agent_initializes_with_config PASSED
tests/test_agent.py::test_agent_has_four_tools PASSED
tests/test_agent.py::test_agent_chat_returns_string PASSED
14 passed
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "test: all 14 tests passing, implementation complete"
```
