/**
 * Generate a Sprint plan from a dependency graph and team configuration.
 *
 * teamConfig: {
 *   teamSize: number,         // number of developers
 *   sprintDuration: number,   // days per sprint (default 10)
 *   hoursPerDay: number,      // developer hours per day (default 6)
 *   velocityPerDev: number    // story points per developer per sprint (default 8)
 * }
 *
 * Returns: SprintPlan {
 *   sprints: Sprint[],
 *   summary: { totalPrograms, totalSprints, estimatedWeeks }
 * }
 *
 * Sprint: {
 *   sprintNumber: number,
 *   items: SprintItem[]
 * }
 *
 * SprintItem: {
 *   program: string,
 *   assignee: string,           // "Dev 1", "Dev 2", ...
 *   storyPoints: number,
 *   violationCount: number,
 *   dependencies: string[],
 *   explanation: string
 * }
 */
async function generateSprintPlan(graph, violations, agentResults, teamConfig, claude) {
  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    return {
      sprints: [],
      summary: { totalPrograms: 0, totalSprints: 0, estimatedWeeks: 0 }
    };
  }

  const teamSize = teamConfig.teamSize || 2;
  const sprintDuration = teamConfig.sprintDuration || 10;
  const velocityPerDev = teamConfig.velocityPerDev || 8;
  const totalVelocity = teamSize * velocityPerDev;

  // Build summary for each program
  const programSummaries = nodes.map(prog => {
    const viols = violations[prog] || [];
    const agent = agentResults ? agentResults[prog] : null;
    const deps = edges.filter(([a]) => a !== prog && edges.some(([x, y]) => y === prog && x === a))
      .map(([a]) => a);
    const actualDeps = edges.filter(([, b]) => b === prog).map(([a]) => a);
    return {
      program: prog,
      violationCount: viols.length,
      hasCode: !!(agent && agent.replacementCode),
      explanation: agent ? agent.explanation : '',
      dependencies: actualDeps
    };
  });

  const prompt = `You are a SAP Clean Core project manager creating a Sprint plan.

Team configuration:
- Team size: ${teamSize} developers
- Sprint duration: ${sprintDuration} working days
- Velocity per developer: ${velocityPerDev} story points per sprint
- Total sprint capacity: ${totalVelocity} story points

Programs to remediate (${nodes.length} total):
${programSummaries.map(p =>
    `- ${p.program}: ${p.violationCount} violations, ${p.hasCode ? 'fix available' : 'needs manual work'}, dependencies: [${p.dependencies.join(', ') || 'none'}]`
  ).join('\n')}

Dependency edges (A must be done before B):
${edges.map(([a, b]) => `${a} → ${b}`).join('\n') || 'None'}

Task: Create a Sprint plan. Rules:
1. Respect dependencies — a program cannot be scheduled before its dependencies are complete
2. Programs with fixes available (hasCode=true) cost 3 story points each
3. Programs needing manual work cost 5 story points each
4. Assign developers as "Dev 1", "Dev 2", etc. (up to ${teamSize})
5. Fill each sprint to near capacity (within 2 SP of ${totalVelocity})
6. Group related programs when possible

Return ONLY a JSON object in this exact format:
{
  "sprints": [
    {
      "sprintNumber": 1,
      "items": [
        {
          "program": "ZPROG_A",
          "assignee": "Dev 1",
          "storyPoints": 3,
          "violationCount": 5,
          "dependencies": [],
          "explanation": "brief note"
        }
      ]
    }
  ]
}`;

  let planJson;
  try {
    const response = await claude.complete(prompt);
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) { throw new Error('No JSON in response'); }
    planJson = JSON.parse(match[0]);
  } catch (e) {
    // Fallback: generate a simple plan without AI
    planJson = generateFallbackPlan(programSummaries, totalVelocity, teamSize);
  }

  const sprints = planJson.sprints || [];
  return {
    sprints,
    summary: {
      totalPrograms: nodes.length,
      totalSprints: sprints.length,
      estimatedWeeks: Math.ceil((sprints.length * sprintDuration) / 5)
    }
  };
}

function generateFallbackPlan(programs, totalVelocity, teamSize) {
  // Topological sort respecting dependencies
  const sorted = topologicalSort(programs);
  const sprints = [];
  let currentSprint = { sprintNumber: 1, items: [] };
  let currentPoints = 0;
  let devIndex = 0;

  for (const prog of sorted) {
    const sp = prog.hasCode ? 3 : 5;
    if (currentPoints + sp > totalVelocity && currentSprint.items.length > 0) {
      sprints.push(currentSprint);
      currentSprint = { sprintNumber: sprints.length + 1, items: [] };
      currentPoints = 0;
    }
    currentSprint.items.push({
      program: prog.program,
      assignee: 'Dev ' + ((devIndex % teamSize) + 1),
      storyPoints: sp,
      violationCount: prog.violationCount,
      dependencies: prog.dependencies,
      explanation: prog.explanation || ''
    });
    currentPoints += sp;
    devIndex++;
  }

  if (currentSprint.items.length > 0) {
    sprints.push(currentSprint);
  }

  return { sprints };
}

function topologicalSort(programs) {
  // Kahn's algorithm
  const inDegree = {};
  const adjList = {};
  programs.forEach(p => {
    inDegree[p.program] = p.dependencies.length;
    adjList[p.program] = [];
  });
  programs.forEach(p => {
    p.dependencies.forEach(dep => {
      if (adjList[dep]) { adjList[dep].push(p.program); }
    });
  });

  const queue = programs.filter(p => inDegree[p.program] === 0).map(p => p.program);
  const result = [];
  const progMap = Object.fromEntries(programs.map(p => [p.program, p]));

  while (queue.length > 0) {
    const prog = queue.shift();
    result.push(progMap[prog]);
    (adjList[prog] || []).forEach(next => {
      inDegree[next]--;
      if (inDegree[next] === 0) { queue.push(next); }
    });
  }

  // Add any remaining (cyclic deps) at the end
  programs.filter(p => !result.includes(p)).forEach(p => result.push(p));
  return result;
}

module.exports = { generateSprintPlan };
