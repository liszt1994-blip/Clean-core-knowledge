// tool1-knowledge/src/classification-client.js
// Mirrors Python ClassificationClient from Agent-main/atc-agent/tools/classification.py
const fs = require('fs');
const path = require('path');
const https = require('https');

const REMOTE_RELEASE_URL      = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfoLatest.json';
const REMOTE_CLASSIFICATIONS_URL = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/refs/heads/main/src/objectClassifications_SAP.json';

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    // Guard against a stalled connection hanging ready() forever — if the
    // remote fetch stalls, abort so callers fall back to the bundled local JSON.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
    });
  });
}

const P2_STATES = new Set(['notToBeReleased', 'classicAPI', 'noAPI']);
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// Successor type priority: lower number = higher priority
const TYPE_PRIORITY = { CLAS: 1, BDEF: 2, SRVD: 3, CDS_STOB: 4 };

// Map raw state values to A/B/C/D tier labels for UI display
const STATE_TO_TIER = {
  released:         'A',
  deprecated:       'C',
  notToBeReleased:  'C',
  classicAPI:       'C',
  noAPI:            'D',
};

// Human-readable state descriptions (bilingual). isEn(lang) picks the language
// the same way the rest of the app does: any lang starting with 'en' → English.
function _isEn(lang) {
  return String(lang || '').toLowerCase().startsWith('en');
}
const STATE_DESCRIPTION = {
  released: {
    en: 'Released API (C1) — safe to use in ABAP Cloud',
    zh: '已发布 API（C1）——可安全用于 ABAP Cloud',
  },
  deprecated: {
    en: 'Deprecated — official successor exists, migration required',
    zh: '已废弃——存在官方后继对象，需迁移',
  },
  notToBeReleased: {
    en: 'Not to be released — use official successor or side-by-side extension',
    zh: '不会发布——请使用官方后继对象或旁路扩展',
  },
  classicAPI: {
    en: 'Classic API — not released for ABAP Cloud, migration required',
    zh: '经典 API——未面向 ABAP Cloud 发布，需迁移',
  },
  noAPI: {
    en: 'No API available — direct table/object access forbidden in cloud',
    zh: '无可用 API——云端禁止直接访问表/对象',
  },
};

// Human-readable descriptions for the raw successorClassification enum values
// found in objectReleaseInfoLatest.json (oneObject / multipleObjects / concept).
// Empty string means "no successor classification" and is left as-is.
const SUCCESSOR_CLASSIFICATION_DESCRIPTION = {
  oneObject: {
    en: 'A single official successor object is available',
    zh: '存在唯一官方后继对象',
  },
  multipleObjects: {
    en: 'Multiple official successor objects are available — choose the right one for your use case',
    zh: '存在多个官方后继对象——请根据场景选择合适的对象',
  },
  concept: {
    en: 'No direct object successor — a conceptual/architectural replacement applies',
    zh: '没有直接的对象后继——需采用概念性/架构性的替代方案',
  },
};


class ClassificationClient {
  constructor() {
    this._releaseIndex = null;
    this._classifications = null;
    this._remoteLoaded = false;
    // kick off remote fetch immediately; errors are caught internally
    this._remotePromise = this._loadRemote();
  }

  async _loadRemote() {
    try {
      const [releaseRaw, classRaw] = await Promise.all([
        fetchJson(REMOTE_RELEASE_URL),
        fetchJson(REMOTE_CLASSIFICATIONS_URL),
      ]);

      const releaseItems = Array.isArray(releaseRaw) ? releaseRaw : (releaseRaw.objectReleaseInfo || []);
      const remoteRelease = {};
      for (const item of releaseItems) {
        const key = item.objectKey || item.tadirObjName;
        if (key) remoteRelease[key] = item;
      }

      const classItems = Array.isArray(classRaw) ? classRaw : (classRaw.objectClassifications || []);
      const remoteClass = {};
      for (const item of classItems) {
        if (item.objectKey) remoteClass[item.objectKey] = item;
      }

      // Override local data with remote (remote is authoritative)
      this._releaseIndex = remoteRelease;
      this._classifications = remoteClass;
      this._remoteLoaded = true;
      console.log('[ClassificationClient] Remote JSON loaded:', Object.keys(remoteRelease).length, 'release entries,', Object.keys(remoteClass).length, 'classification entries');
    } catch (err) {
      console.warn('[ClassificationClient] Remote fetch failed, using local JSON:', err.message);
      // local JSON will be loaded lazily on first lookup()
    }
  }

  _loadReleaseIndex() {
    if (this._releaseIndex) return this._releaseIndex;
    // Remote not loaded yet — fall back to local JSON
    const filePath = path.join(DOCS_DIR, 'objectReleaseInfoLatest.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw) ? raw : (raw.objectReleaseInfo || []);
    this._releaseIndex = {};
    for (const item of items) {
      const key = item.objectKey || item.tadirObjName;
      if (key) this._releaseIndex[key] = item;
    }
    return this._releaseIndex;
  }

  _loadClassifications() {
    if (this._classifications) return this._classifications;
    // Remote not loaded yet — fall back to local JSON
    const filePath = path.join(DOCS_DIR, 'objectClassifications_SAP.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw) ? raw : (raw.objectClassifications || []);
    this._classifications = {};
    for (const item of items) {
      if (item.objectKey) this._classifications[item.objectKey] = item;
    }
    return this._classifications;
  }

  // Wait for remote data to be ready (call this before first lookup for best accuracy)
  async ready() {
    await this._remotePromise;
  }

  /**
   * Look up a SAP object in the local JSON data.
   * Returns null if the object is not found in either JSON file.
   *
   * Return shape (when found):
   * {
   *   deprecated:      string,    // object name queried
   *   objectType:      string,    // CLAS / FUNC / TABL / etc.
   *   state:           string,    // raw state from objectReleaseInfoLatest
   *   clsState:        string,    // raw state from objectClassifications
   *   isP2:            boolean,   // true if P2-level warning
   *   tier:            string,    // A / B / C / D (derived)
   *   tierDescription: string,    // human-readable state description
   *   replacement:     string|null,  // primary successor name
   *   replacementType: string|null,  // primary successor type
   *   allSuccessors:   [{name, type}],
   *   note:            string,    // successorClassification note
   *   softwareComponent: string,
   *   appComponent:    string,
   * }
   */
  lookup(deprecatedName, oldType = '', lang = 'zh') {
    const index = this._loadReleaseIndex();
    const classes = this._loadClassifications();

    const key = deprecatedName.toUpperCase();
    const item = index[key];
    const classification = classes[key] || null;

    // Return null only if the object is in neither JSON file
    if (!item && !classification) return null;

    // Build sorted successors list (only available in objectReleaseInfoLatest)
    const successors = (item?.successors || [])
      .filter(s => s.objectKey)
      .map(s => ({ name: s.objectKey, type: s.objectType || '' }));

    const oldTypeNorm = oldType.toUpperCase()
      .replace('FUGR/FF', 'FUNC')
      .replace('FUGR', 'FUNC');

    if (successors.length > 1) {
      successors.sort((a, b) => {
        const at = a.type.toUpperCase();
        const bt = b.type.toUpperCase();
        const ap = at === oldTypeNorm ? 0 : (TYPE_PRIORITY[at] ?? 5);
        const bp = bt === oldTypeNorm ? 0 : (TYPE_PRIORITY[bt] ?? 5);
        return ap - bp;
      });
    }

    const relState = item?.state || '';
    const clsState = classification?.state || '';
    const isP2 = P2_STATES.has(relState) || P2_STATES.has(clsState);

    // Prefer release state; fall back to classification state
    const effectiveState = relState || clsState;
    const tier = STATE_TO_TIER[effectiveState] || 'B';
    const descEntry = STATE_DESCRIPTION[effectiveState];
    const tierDescription = descEntry
      ? (_isEn(lang) ? descEntry.en : descEntry.zh)
      : (_isEn(lang) ? `State: ${effectiveState}` : `状态：${effectiveState}`);

    // Merge metadata from both sources (release file takes priority)
    const sourceItem = item || classification;

    // Convert the raw successorClassification enum into a human-readable
    // bilingual note (same pattern as tierDescription). Empty stays empty.
    const rawSuccClass = item?.successorClassification || '';
    const succEntry = SUCCESSOR_CLASSIFICATION_DESCRIPTION[rawSuccClass];
    const note = succEntry
      ? (_isEn(lang) ? succEntry.en : succEntry.zh)
      : (rawSuccClass ? (_isEn(lang) ? `Successor classification: ${rawSuccClass}` : `后继分类：${rawSuccClass}`) : '');

    return {
      deprecated:        deprecatedName,
      objectType:        sourceItem.objectType || '',
      state:             relState,
      clsState,
      isP2,
      tier,
      tierDescription,
      replacement:       successors[0]?.name ?? null,
      replacementType:   successors[0]?.type ?? null,
      allSuccessors:     successors,
      note,
      softwareComponent: sourceItem.softwareComponent || '',
      appComponent:      sourceItem.applicationComponent || '',
    };
  }
}

module.exports = { ClassificationClient };
