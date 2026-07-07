service PlannerService {
  // Import ATC data: either raw XML string or tool2 JSON (agentResults object)
  action importAtcData(
    xmlContent        : String,
    tool2Json         : String
  ) returns { sessionId : String; programCount : Integer };

  // Generate sprint plan from team config
  action generatePlan(
    sessionId   : String,
    teamConfig  : String
  ) returns { planJson : String };

  // Update sprint plan after drag-drop adjustments
  action updatePlan(
    sessionId : String,
    planJson  : String
  ) returns { status : String };
}
