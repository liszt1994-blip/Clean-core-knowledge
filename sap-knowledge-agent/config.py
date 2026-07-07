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
