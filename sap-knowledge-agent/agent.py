import json
from pathlib import Path
import anthropic
from tools.clean_core import explain_clean_core_concept
from tools.classifier import classify_sap_object
from tools.api_recommender import recommend_replacement_api
from tools.sap_note import search_sap_notes

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "system_prompt.txt"
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
        self.client = anthropic.Anthropic(
            api_key=anthropic_api_key,
            base_url="http://localhost:6655/anthropic",
        )
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
        for entry in history:
            # Gradio 6.x uses dict format: {"role": "user"/"assistant", "content": "..."}
            # Gradio 4.x uses tuple/list format: [user_msg, assistant_msg]
            if isinstance(entry, dict):
                role = entry.get("role", "")
                content = entry.get("content", "")
                if role and content:
                    messages.append({"role": role, "content": content})
            else:
                user_msg, assistant_msg = entry[0], entry[1]
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
