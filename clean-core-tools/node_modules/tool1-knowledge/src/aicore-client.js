// tool1-knowledge/src/aicore-client.js
// Mirrors Python AICoreClient from Agent-main/atc-agent/tools/aicore.py
const axios = require('axios');

const CLEAN_CORE_SYSTEM_PROMPT =
  'You are an SAP Clean Core expert assistant. Your job is to help SAP developers ' +
  'understand and apply Clean Core principles.\n\n' +
  '## SAP Clean Core Overview\n' +
  'SAP Clean Core means keeping the SAP S/4HANA system close to standard by avoiding or ' +
  'minimizing custom modifications to the core system. This ensures easier upgrades, ' +
  'cloud readiness, and lower total cost of ownership.\n\n' +
  '## SAP Extensibility Tiers\n' +
  '- **Tier 1 (On-Stack, Key User):** No-code/low-code extensions using SAP-provided tools ' +
  '(Custom Fields, Custom Logic via BAdIs in UI). Fully upgrade-safe.\n' +
  '- **Tier 2 (On-Stack, Developer):** ABAP Cloud development using only Released APIs ' +
  '(C1-released objects). Extensions stay in a separate namespace.\n' +
  '- **Tier 3 (Side-by-Side):** Extensions deployed outside S/4HANA on SAP BTP. ' +
  'Communicate via stable APIs (OData, Events). Fully decoupled from the core.\n\n' +
  '## SAP Object Classification (Clean Core Tiers A/B/C/D)\n' +
  '- **A — Fully Compliant:** Released API (C1), safe to use in cloud/upgrade scenarios.\n' +
  '- **B — Conditionally Compliant:** Not officially released but low modification risk.\n' +
  '- **C — Non-Compliant (Legacy):** Must be migrated to Clean Core alternatives.\n' +
  '- **D — Deprecated / Forbidden:** Explicitly deprecated or forbidden for cloud use.\n\n' +
  'Always respond in Chinese (简体中文) by default, unless the user explicitly writes in another language. Be concise but precise.';


class AICoreClient {
  constructor() {
    const vcapRaw = process.env.VCAP_SERVICES;
    if (!vcapRaw) {
      throw new Error('VCAP_SERVICES environment variable is required for SAP AI Core');
    }
    const vcap = JSON.parse(vcapRaw);
    this._creds = vcap.aicore[0].credentials;
    this.deploymentId = process.env.AICORE_DEPLOYMENT_ID || 'd6efeabe29c1a3f6';
    this.model = process.env.AICORE_MODEL || 'anthropic--claude-4.6-sonnet';
    this.resourceGroup = process.env.AICORE_RESOURCE_GROUP || 'docgrp';
    this._tokenCache = null;
    this._tokenExpiry = 0;
  }

  async _getToken() {
    const now = Date.now();
    if (this._tokenCache && now < this._tokenExpiry) return this._tokenCache;

    const { url, clientid, clientsecret } = this._creds;
    const resp = await axios.post(
      `${url}/oauth/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientid,
        client_secret: clientsecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
    const { access_token, expires_in } = resp.data;
    this._tokenCache = access_token;
    this._tokenExpiry = now + (expires_in - 60) * 1000; // refresh 60s before expiry
    return access_token;
  }

  get _baseUrl() {
    const aiUrl = this._creds.serviceurls.AI_API_URL.replace(/\/$/, '');
    return `${aiUrl}/v2/inference/deployments/${this.deploymentId}`;
  }

  /**
   * Call AI Core Orchestration /completion endpoint.
   * messages: array of { role: 'system'|'user'|'assistant', content: string }
   * Returns: string (model reply)
   */
  async chat(messages, maxTokens = 2048) {
    const token = await this._getToken();
    const resp = await axios.post(
      `${this._baseUrl}/completion`,
      {
        orchestration_config: {
          module_configurations: {
            llm_module_config: {
              model_name: this.model,
              model_params: { max_tokens: maxTokens, temperature: 0 },
            },
            templating_module_config: { template: messages },
          },
        },
        input_params: {},
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'AI-Resource-Group': this.resourceGroup,
        },
        timeout: 120000,
      }
    );
    return resp.data.orchestration_result.choices[0].message.content;
  }

  /**
   * Convenience wrapper: systemPrompt + userContent → reply string.
   */
  async complete(systemPrompt, userContent, maxTokens = 2048) {
    return this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      maxTokens
    );
  }
}

module.exports = { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT };
