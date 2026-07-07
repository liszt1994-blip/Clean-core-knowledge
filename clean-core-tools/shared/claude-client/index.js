const Anthropic = require('@anthropic-ai/sdk');

class ClaudeClient {
  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = 'claude-sonnet-4-6';
  }

  buildMessages(userContent) {
    return [{ role: 'user', content: userContent }];
  }

  // Returns full text response
  async complete(systemPrompt, userContent) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: this.buildMessages(userContent),
    });
    return response.content[0].text;
  }

  // Yields text chunks for SSE streaming
  async *stream(systemPrompt, userContent) {
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: this.buildMessages(userContent),
    });
    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}

module.exports = { ClaudeClient };
