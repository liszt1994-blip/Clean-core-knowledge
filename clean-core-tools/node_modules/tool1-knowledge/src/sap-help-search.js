// tool1-knowledge/src/sap-help-search.js
// Calls the SAP Help Portal internal search API.
// Endpoint: POST https://help.sap.com/api-gateway-direct/search/api/search
// No authentication required for public content.

const axios = require('axios');

const HELP_SEARCH_URL = 'https://help.sap.com/api-gateway-direct/search/api/search';
const HELP_BASE_URL   = 'https://help.sap.com';
const DEFAULT_TOP = 8;

/**
 * Returns true if the string is predominantly English (ASCII + common punctuation).
 * Rejects titles where more than 10% of characters are non-ASCII (CJK, Cyrillic, etc.).
 */
function isEnglish(text) {
  if (!text) return false;
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return nonAscii / text.length <= 0.1;
}

/**
 * Search SAP Help Portal.
 * Returns array of { title, url, summary, product, date }
 */
async function searchHelpPortal(query, top = DEFAULT_TOP) {
  const resp = await axios.post(
    HELP_SEARCH_URL,
    {
      query:      query,
      searchType: 'STANDARD',
      language:   'en-US',
      state:      'PRODUCTION',
      top:        top,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      timeout: 12000,
      decompress: true,
    }
  );

  const results = resp.data.results || [];

  return results
    .map(item => {
      const rawUrl = item.url || '';
      const url = rawUrl.startsWith('http') ? rawUrl : HELP_BASE_URL + rawUrl;
      return {
        title:   item.title   || '',
        url:     url,
        summary: item.snippet || item.description || '',
        product: item.deliverableTitle || item.product || '',
        date:    item.date    || '',
        score:   parseFloat(item.score) || 0,
      };
    })
    .filter(item => item.title && item.url)
    .filter(item => isEnglish(item.title))
    .sort((a, b) => b.score - a.score);
}

module.exports = { searchHelpPortal };
