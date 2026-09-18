// tool1-knowledge/src/mcp-client.js
// Client for the public MCP SAP Docs endpoint (JSON-RPC 2.0 over HTTPS)
// Endpoint: https://mcp-sap-docs.marianzeis.de/mcp
const axios = require('axios');

const MCP_URL = process.env.MCP_SAP_DOCS_URL || 'https://mcp-sap-docs.marianzeis.de/mcp';
let _rpcId = 1;

async function callTool(toolName, args) {
  const resp = await axios.post(
    MCP_URL,
    {
      jsonrpc: '2.0',
      id: _rpcId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      timeout: 15000,
      responseType: 'text',
    }
  );

  // MCP Streamable HTTP returns SSE: parse "data: {...}" lines
  let payload = resp.data;
  if (typeof payload === 'string') {
    // Extract JSON from SSE data lines
    const lines = payload.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          // SSE may wrap result inside event envelope
          payload = parsed.result || parsed;
          break;
        } catch { /* continue to next line */ }
      }
    }
  }

  const result = payload.result || payload;
  if (!result) throw new Error(`MCP tool ${toolName} returned no result`);

  // MCP returns content as array of { type, text } blocks
  const text = Array.isArray(result.content)
    ? result.content.map(c => c.text || '').join('')
    : (result.content || '');

  try {
    return JSON.parse(text);
  } catch (_e) {
    // Endpoint returned non-JSON (error page, empty body, or plain text).
    // Surface a clear error so BTP-tab callers can degrade gracefully instead
    // of propagating an opaque "Unexpected token" SyntaxError.
    throw new Error(`MCP tool ${toolName} returned non-JSON content`);
  }
}

/**
 * Search SAP Discovery Center service catalog.
 * Returns services[] with { id, name, description, category, licenseModelType }
 */
async function searchDiscoveryCenter(query, top = 10, category = null) {
  const args = { query, top };
  if (category) args.category = category;
  const data = await callTool('sap_discovery_center_search', args);
  return data.services || [];
}

/**
 * Get full details for a BTP service: pricing, roadmap, docs, headlines.
 */
async function getServiceDetails(serviceId, currency = 'USD') {
  const data = await callTool('sap_discovery_center_service', {
    serviceId,
    currency,
    include_roadmap: true,
    include_pricing: true,
  });
  return data;
}

/**
 * Search SAP documentation via MCP (BTP/CAP/UI5/AI sources).
 * Returns results[] with { id, title, url, snippet }
 */
async function searchSapDocs(query, k = 5) {
  const data = await callTool('search', {
    query,
    k,
    includeOnline: false,
    includeSamples: false,
    sources: ['btp-cloud-platform', 'sap-artificial-intelligence', 'cap', 'ui5'],
  });
  return data || [];
}

module.exports = { searchDiscoveryCenter, getServiceDetails, searchSapDocs };
