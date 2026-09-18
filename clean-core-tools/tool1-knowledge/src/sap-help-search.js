// tool1-knowledge/src/sap-help-search.js
// Calls the SAP Help Portal internal search API.
// Endpoint: POST https://help.sap.com/api-gateway-direct/search/api/search
// No authentication required for public content.

const axios = require('axios');

const HELP_SEARCH_URL = 'https://help.sap.com/api-gateway-direct/search/api/search';
const HELP_BASE_URL   = 'https://help.sap.com';
const DEFAULT_TOP = 8;

// Fraction of CJK characters above which a string is considered "Chinese".
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;

function cjkRatio(text) {
  if (!text) return 0;
  return (text.match(CJK_RE) || []).length / text.length;
}

// Map the UI target language to the Help Portal `language` request field.
function helpLanguageFor(lang) {
  return String(lang || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

// A result belongs to the target language when its human-readable text
// (title + summary) is in that language. We key on CJK content specifically
// (not all non-ASCII), so English rows containing ™, ®, é, — are still kept.
// - en UI: drop rows whose title OR summary is predominantly CJK.
// - zh UI: keep rows whose title or summary actually contains CJK, dropping
//   pure-English rows so the zh UI never shows English-only descriptions.
function matchesLanguage(item, lang) {
  const isZh = String(lang || '').toLowerCase().startsWith('zh');
  if (isZh) {
    return cjkRatio(item.title) > 0.1 || cjkRatio(item.summary) > 0.1;
  }
  return cjkRatio(item.title) <= 0.1 && cjkRatio(item.summary) <= 0.1;
}

/**
 * Search SAP Help Portal.
 * Returns array of { title, url, summary, product, date }, filtered so every
 * field is in the target language (lang: 'en' | 'zh').
 */
async function searchHelpPortal(query, top = DEFAULT_TOP, lang = 'en') {
  const resp = await axios.post(
    HELP_SEARCH_URL,
    {
      query:      query,
      searchType: 'STANDARD',
      language:   helpLanguageFor(lang),
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
    .filter(item => matchesLanguage(item, lang))
    .sort((a, b) => b.score - a.score);
}

module.exports = { searchHelpPortal };
