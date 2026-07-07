// tool1-knowledge/src/destination-client.js
// Fetches SAP Note content via BTP Destination Service proxy.
//
// Prerequisites (configure once in BTP Cockpit):
//   1. Create a Destination named "SAP_SUPPORT_PORTAL" (or set DEST_SAP_SUPPORT env var):
//      Type: HTTP
//      URL:  https://me.sap.com
//      Authentication: OAuth2SAMLBearerAssertion  (or NoAuthentication for public pages)
//      ProxyType: Internet
//
//   2. The VCAP_SERVICES must contain the "destination" service binding credentials.

const axios = require('axios');

const DEST_NAME = process.env.DEST_SAP_SUPPORT || 'SAP_SUPPORT_PORTAL';

class DestinationClient {
  constructor() {
    const vcapRaw = process.env.VCAP_SERVICES;
    if (!vcapRaw) throw new Error('VCAP_SERVICES is required');
    const vcap = JSON.parse(vcapRaw);
    const destBinding = vcap.destination && vcap.destination[0];
    if (!destBinding) throw new Error('No "destination" service binding found in VCAP_SERVICES');
    this._creds = destBinding.credentials;
    this._tokenCache = null;
    this._tokenExpiry = 0;
  }

  // ── Step 1: Get Destination Service XSUAA token ────────────────────────────
  async _getDestToken() {
    const now = Date.now();
    if (this._tokenCache && now < this._tokenExpiry) return this._tokenCache;

    const { url: authUrl, clientid, clientsecret } = this._creds;
    const resp = await axios.post(
      `${authUrl}/oauth/token`,
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

  // ── Step 2: Retrieve destination config from Destination Service ───────────
  async _getDestination(destName) {
    const token = await this._getDestToken();
    const baseUri = this._creds.uri.replace(/\/$/, '');
    const resp = await axios.get(
      `${baseUri}/destination-configuration/v1/destinations/${destName}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );
    return resp.data; // { destinationConfiguration: {...}, authTokens: [...] }
  }

  // ── Step 3: Fetch a URL via the configured destination ──────────────────────
  // Returns raw HTML string or throws.
  async fetchViaDestination(path, destName = DEST_NAME) {
    let dest;
    try {
      dest = await this._getDestination(destName);
    } catch (err) {
      throw new Error(`Destination lookup failed for "${destName}": ${err.message}`);
    }

    const config = dest.destinationConfiguration || dest;
    const authTokens = dest.authTokens || [];

    // Build target URL
    const baseUrl = (config.URL || config.url || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error(`Destination "${destName}" has no URL configured`);
    const targetUrl = baseUrl + path;

    // Build auth header
    let authHeader;
    if (authTokens.length > 0 && authTokens[0].value) {
      // Destination Service pre-fetched token
      authHeader = `${authTokens[0].http_header?.key?.split(' ')[0] || 'Bearer'} ${authTokens[0].value}`;
    } else if (config.Authentication === 'BasicAuthentication') {
      const b64 = Buffer.from(`${config.User}:${config.Password}`).toString('base64');
      authHeader = `Basic ${b64}`;
    } else {
      // NoAuthentication or unhandled — attempt unauthenticated
      authHeader = null;
    }

    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; SAP-CleanCore-Bot/1.0)',
    };
    if (authHeader) headers['Authorization'] = authHeader;

    const resp = await axios.get(targetUrl, {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Authentication failed (${resp.status}) — check Destination configuration for "${destName}"`);
    }
    if (resp.status === 404) {
      throw new Error(`Note not found (404) at ${targetUrl}`);
    }

    return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  }

  // ── High-level: Fetch SAP Note page and extract text content ───────────────
  async fetchNoteContent(noteNumber) {
    const html = await this.fetchViaDestination(`/notes/${noteNumber}`);
    return extractNoteText(html, noteNumber);
  }
}

// ── HTML text extractor ────────────────────────────────────────────────────────
// Strips HTML tags and extracts meaningful text from a SAP Note page.
function extractNoteText(html, noteNumber) {
  if (!html) return '';

  // Remove scripts, styles, nav, header, footer
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Convert <br>, <p>, <li>, block elements to newlines
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse whitespace
  text = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');

  // Limit to first 3000 characters to keep AI prompt manageable
  if (text.length > 3000) {
    text = text.slice(0, 3000) + '\n...[truncated]';
  }

  return text;
}

module.exports = { DestinationClient };
