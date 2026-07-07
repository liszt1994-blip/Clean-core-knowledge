const { ClaudeClient } = require('./index');

describe('ClaudeClient', () => {
  test('constructor throws if ANTHROPIC_API_KEY is missing', () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new ClaudeClient()).toThrow('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_API_KEY = orig;
  });

  test('buildMessages returns correct structure', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const client = new ClaudeClient();
    const msgs = client.buildMessages('Hello');
    expect(msgs).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});
