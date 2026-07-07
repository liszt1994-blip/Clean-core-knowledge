const { AdtClient } = require('./adt-client');
const { ClaudeClient } = require('@clean-core/shared/claude-client');

function buildTools() {
  return [
    {
      name: 'get_source_code',
      description: 'Retrieve the full ABAP source code of a program or class from S/4HANA via ADT.',
      input_schema: {
        type: 'object',
        properties: {
          program: { type: 'string', description: 'ABAP program/class name' },
          objectType: { type: 'string', description: 'PROG, CLAS, or FUGR' },
        },
        required: ['program', 'objectType'],
      },
    },
    {
      name: 'get_ddic_definition',
      description: 'Retrieve the DDIC structure or data element definition for a given SAP type name.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Structure or data element name' },
        },
        required: ['name'],
      },
    },
    {
      name: 'query_clean_core_knowledge',
      description: 'Ask a Clean Core question to get guidance on migration paths, tier classification, or replacement APIs.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The Clean Core question to answer' },
        },
        required: ['question'],
      },
    },
    {
      name: 'generate_replacement_code',
      description: 'Generate ABAP replacement code for a specific violation given its context.',
      input_schema: {
        type: 'object',
        properties: {
          violationDescription: { type: 'string' },
          originalCode: { type: 'string' },
          lineNumber: { type: 'string' },
        },
        required: ['violationDescription', 'originalCode'],
      },
    },
  ];
}

async function executeTool(toolName, toolInput, adtClient, claudeClient) {
  if (toolName === 'get_source_code') {
    return await adtClient.getSourceCode(toolInput.program, toolInput.objectType);
  }
  if (toolName === 'get_ddic_definition') {
    return await adtClient.getDdicDefinition(toolInput.name);
  }
  if (toolName === 'query_clean_core_knowledge') {
    const SYSTEM_PROMPT = require('../../tool1-knowledge/srv/prompts').SYSTEM_PROMPT;
    return await claudeClient.complete(SYSTEM_PROMPT, toolInput.question);
  }
  if (toolName === 'generate_replacement_code') {
    const prompt = `Generate ABAP replacement code for this violation:\n${toolInput.violationDescription}\n\nOriginal code:\n${toolInput.originalCode}\n\nReturn JSON with fields: replacementCode (string), explanation (string).`;
    return await claudeClient.complete('You are an ABAP Clean Core migration expert.', prompt);
  }
  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = { buildTools, executeTool };
