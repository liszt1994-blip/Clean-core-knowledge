import os
import pytest


def test_config_loads_anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("SAP_S_USER", "S0001")
    monkeypatch.setenv("SAP_S_PASSWORD", "pass")
    from config import load_config
    cfg = load_config()
    assert cfg["anthropic_api_key"] == "sk-ant-test"
    assert cfg["sap_s_user"] == "S0001"
    assert cfg["sap_s_password"] == "pass"


def test_config_raises_if_missing_anthropic_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("SAP_S_USER", "S0001")
    monkeypatch.setenv("SAP_S_PASSWORD", "pass")
    from config import load_config
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        load_config()
