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
    from agent import TOOL_DEFINITIONS
    assert len(TOOL_DEFINITIONS) == 4
    tool_names = [t["name"] for t in TOOL_DEFINITIONS]
    assert "explain_clean_core_concept" in tool_names
    assert "classify_sap_object" in tool_names
    assert "recommend_replacement_api" in tool_names
    assert "search_sap_notes" in tool_names


def test_agent_chat_returns_string():
    from agent import SAPKnowledgeAgent

    class FakeTextBlock:
        type = "text"
        text = "Hello from agent"

    agent = SAPKnowledgeAgent(
        anthropic_api_key="sk-ant-test",
        sap_s_user="",
        sap_s_password="",
    )
    with patch.object(agent.client.messages, "create") as mock_create:
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [FakeTextBlock()]
        mock_create.return_value = mock_response
        result = agent.chat("What is Clean Core?", history=[])
    assert isinstance(result, str)
    assert result == "Hello from agent"
