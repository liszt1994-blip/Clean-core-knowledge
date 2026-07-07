import re
import requests


def search_sap_notes(keyword: str, s_user: str = "", s_password: str = "", top: int = 5) -> dict:
    """
    Search for SAP Notes related to a keyword or a specific Note number.

    - Pure number  → return direct Note link + ask user to paste content
    - Keyword text → return search link + known Notes from Claude knowledge
    """
    keyword = keyword.strip()

    # --- Pure Note number ---
    if re.fullmatch(r"\d+", keyword):
        direct_url = f"https://me.sap.com/notes/{keyword}"
        return {
            "keyword": keyword,
            "note_number": keyword,
            "direct_url": direct_url,
            "needs_user_content": True,
            "instruction": (
                f"The user is asking about SAP Note {keyword}. "
                f"You cannot access SAP Support Portal directly. Follow these steps:\n"
                f"1. Share what you know about Note {keyword} from your training knowledge "
                f"(title, purpose, affected components) — but clearly label it as 'Based on my knowledge'.\n"
                f"2. Then tell the user: since your knowledge may be outdated, invite them to paste "
                f"the Note content so you can give a precise answer based on the official text.\n"
                f"3. Format the direct link prominently: {direct_url}\n"
                f"4. If the user later pastes the Note content into the chat, analyse it thoroughly "
                f"and answer based on that real content instead."
            ),
        }

    # --- Keyword search ---
    search_url = f"https://me.sap.com/notes/search?q={requests.utils.quote(keyword)}"
    return {
        "keyword": keyword,
        "search_url": search_url,
        "needs_user_content": False,
        "instruction": (
            f"The user is searching SAP Notes about '{keyword}'. "
            f"Answer using your SAP knowledge: list relevant Note numbers you know, "
            f"each formatted as https://me.sap.com/notes/<number>. "
            f"Be clear that these are from your training data and may not be exhaustive. "
            f"End with: 'For the full official list, search here: {search_url}' — "
            f"and invite the user to paste any specific Note content for a deeper analysis."
        ),
    }
