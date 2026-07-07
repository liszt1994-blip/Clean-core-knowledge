jest.mock('../adt-client', () => ({
  AdtClient: jest.fn().mockImplementation(() => ({
    getSourceCode: jest.fn().mockResolvedValue('REPORT zmyprog.\nSELECT * FROM mara INTO TABLE @lt_mara.'),
    getDdicDefinition: jest.fn().mockResolvedValue('<ddic>MARA definition</ddic>'),
  }))
}));

jest.mock('@clean-core/shared/claude-client', () => ({
  ClaudeClient: jest.fn().mockImplementation(() => ({
    model: 'claude-sonnet-4-6',
    client: {
      messages: {
        create: jest.fn()
          .mockResolvedValueOnce({
            stop_reason: 'tool_use',
            content: [{
              type: 'tool_use',
              id: 'tool_1',
              name: 'get_source_code',
              input: { program: 'ZMY_PROGRAM', objectType: 'PROG' }
            }]
          })
          .mockResolvedValueOnce({
            stop_reason: 'end_turn',
            content: [{
              type: 'text',
              text: JSON.stringify({
                replacementCode: 'SELECT matnr FROM mara INTO TABLE @lt_mara.',
                explanation: 'Use field list instead of SELECT *'
              })
            }]
          })
      }
    }
  }))
}));

const { runReActAgent } = require('../react-agent');

test('runReActAgent returns replacementCode and explanation', async () => {
  const violations = [{
    program: 'ZMY_PROGRAM', objectType: 'PROG', line: '5',
    description: 'SELECT * usage'
  }];

  const steps = [];
  const result = await runReActAgent({
    program: 'ZMY_PROGRAM',
    violations,
    adtConfig: { baseUrl: 'https://test', username: 'u', password: 'p' },
    onStep: (step) => steps.push(step),
  });

  expect(result.replacementCode).toBeTruthy();
  expect(result.explanation).toBeTruthy();
  expect(steps.length).toBeGreaterThan(0);
});

test('runReActAgent calls onStep for each agent step', async () => {
  const { ClaudeClient } = require('@clean-core/shared/claude-client');
  ClaudeClient.mockImplementation(() => ({
    model: 'claude-sonnet-4-6',
    client: {
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ replacementCode: 'REPORT z.', explanation: 'done' }) }]
        })
      }
    }
  }));

  const steps = [];
  await runReActAgent({
    program: 'Z_PROG',
    violations: [{ line: '1', description: 'test' }],
    adtConfig: { baseUrl: 'https://test', username: 'u', password: 'p' },
    onStep: (s) => steps.push(s),
  });
  expect(steps.some(s => s.type === 'llm_response')).toBe(true);
});
