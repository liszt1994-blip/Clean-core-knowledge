service KnowledgeService {

  // Tab 1: Concept explanation (streaming via SSE)
  action explain(term : String) returns String;

  // Tab 2: Object classification
  action classify(objects : array of String) returns array of {
    objectName       : String;
    tier             : String;
    state            : String;
    explanation      : String;
    recommendation   : String;
    replacement      : String;
    replacementType  : String;
    allSuccessors    : array of { name : String; type : String; };
    note             : String;
    objectType       : String;
    softwareComponent: String;
    appComponent     : String;
    source           : String;
  };

  // Tab 3: Replacement API recommendation
  action recommend(deprecatedObject : String) returns array of {
    replacementName : String;
    type            : String;
    migrationNote   : String;
    source          : String;
  };

  // Tab 4: SAP Note search
  action searchNote(query : String) returns array of {
    noteNumber       : String;
    title            : String;
    summary          : String;
    releaseDate      : String;
    url              : String;
    requiresLogin    : Boolean;
    contentSource    : String;
    confidence       : String;
    confidenceReason : String;
    englishQuery     : String;
  };

  // ── Agent chat (unified entry point) ──────────────────────────────────────
  // violations / notes returned as JSON strings; rewrite fields inlined
  action chat(
    message  : String,
    mode     : String,
    history  : array of { role : String; text : String; }
  ) returns {
    replyType        : String;
    text             : String;
    violations       : String;
    rewriteOriginal  : String;
    rewriteRewritten : String;
    notes            : String;
  };

  // ── Internal helpers exposed for direct testing ───────────────────────────
  action analyzeCode(code : String) returns array of {
    objectName      : String;
    tier            : String;
    state           : String;
    line            : Integer;
    callType        : String;
    replacement     : String;
    replacementType : String;
    note            : String;
  };

  action analyzeAtc(atcOutput : String) returns array of {
    objectName      : String;
    tier            : String;
    state           : String;
    line            : Integer;
    errorCode       : String;
    replacement     : String;
    replacementType : String;
    note            : String;
  };

  action rewriteCode(
    code       : String,
    violations : array of {
      objectName      : String;
      replacement     : String;
      replacementType : String;
    }
  ) returns {
    original  : String;
    rewritten : String;
  };

  action plan(objectName : String) returns {
    objectName      : String;
    replacement     : String;
    replacementType : String;
    riskLevel       : String;
    effortEstimate  : String;
    steps           : String;
    codeExample     : String;
    summary         : String;
  };

  action searchApiHub(
    query  : String,
    module : String
  ) returns array of {
    name        : String;
    displayName : String;
    apiType     : String;
    description : String;
  };

  action analyzeCds(viewName : String) returns {
    nodes : array of {
      id             : String;
      type           : String;
      releaseState   : String;
      cleanCore      : Boolean;
      classification : String;
      depth          : Integer;
    };
    edges : array of {
      source   : String;
      target   : String;
      relation : String;
    };
  };
}
