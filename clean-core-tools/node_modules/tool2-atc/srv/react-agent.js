const { ClaudeClient } = require('@clean-core/shared/claude-client');
const { AdtClient } = require('./adt-client');
const { buildTools, executeTool } = require('./agent-tools');

const MAX_STEPS = 8;

const AGENT_SYSTEM_PROMPT = `You are an ABAP Clean Core migration expert agent. Your job is to analyze ATC violations and produce replacement ABAP code that complies with SAP Clean Core guidelines.

You have access to tools to fetch source code, look up DDIC definitions, query Clean Core knowledge, and generate replacement code. Use them systematically.

When you have enough information, respond with ONLY a JSON object (no markdown fences) with these fields:
- replacementCode: the complete replacement ABAP code snippet
- explanation: a clear explanation of what was changed and why`;

async function runReActAgent({ program, violations, adtConfig, onStep }) {
  const claude = new ClaudeClient();
  const adt = new AdtClient(adtConfig);
  const tools = buildTools();

  const violationSummary = violations
    .map(v => `Line ${v.line}: ${v.description}`)
    .join('\n');

  const messages = [
    {
      role: 'user',
      content: `Analyze and fix these ATC violations in program ${program}:\n\n${violationSummary}\n\nUse the available tools to gather context, then produce the replacement code.`,
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await claude.client.messages.create({
      model: claude.model,
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools,
      messages,
    });

    onStep({ step, type: 'llm_response', stopReason: response.stop_reason, content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock) {
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return { replacementCode: textBlock.text, explanation: 'Agent completed analysis.' };
        }
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        onStep({ step, type: 'tool_call', tool: block.name, input: block.input });
        let result;
        try {
          result = await executeTool(block.name, block.input, adt, claude);
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        onStep({ step, type: 'tool_result', tool: block.name, result: String(result).slice(0, 500) });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  return { replacementCode: '', explanation: 'Agent reached max steps without producing output.' };
}

module.exports = { runReActAgent };
