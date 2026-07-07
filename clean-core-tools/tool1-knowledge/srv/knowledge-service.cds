service KnowledgeService {

  // Tab 1: Concept explanation (streaming via SSE)
  action explain(term : String) returns String;

  // Tab 2: Object classification
  action classify(objects : array of String) returns array of {
    objectName       : String;
    tier             : String;  // A, B, C, or D
    state            : String;  // released | deprecated | notToBeReleased | classicAPI | noAPI | unknown
    explanation      : String;
    recommendation   : String;
    replacement      : String;
    replacementType  : String;
    allSuccessors    : array of {
      name : String;
      type : String;
    };
    note             : String;
    objectType       : String;
    softwareComponent: String;
    appComponent     : String;
    source           : String;  // official-json | ai-inference | ai-inference-failed | error
  };

  // Tab 3: Replacement API recommendation
  action recommend(deprecatedObject : String) returns array of {
    replacementName : String;
    type            : String;  // OData API, RAP BO, CDS View, Released BAdI, Key User Extension, Side-by-Side BTP
    migrationNote   : String;
    source          : String;  // official-json+ai-note | ai-inference
  };

  // Tab 4: SAP Note search — real results from SAP Help Portal
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
    englishQuery     : String;  // AI-translated English search term, same value on all rows
  };
}
