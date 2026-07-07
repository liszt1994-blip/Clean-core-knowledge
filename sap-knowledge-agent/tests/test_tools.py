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
