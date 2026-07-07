// tool1-knowledge/src/classification-client.js
// Mirrors Python ClassificationClient from Agent-main/atc-agent/tools/classification.py
const fs = require('fs');
const path = require('path');

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

// Human-readable state descriptions
const STATE_DESCRIPTION = {
  released:         'Released API (C1) — safe to use in ABAP Cloud',
  deprecated:       'Deprecated — official successor exists, migration required',
  notToBeReleased:  'Not to be released — use official successor or side-by-side extension',
  classicAPI:       'Classic API — not released for ABAP Cloud, migration required',
  noAPI:            'No API available — direct table/object access forbidden in cloud',
};


class ClassificationClient {
  constructor() {
    this._releaseIndex = null;
    this._classifications = null;
  }

  _loadReleaseIndex() {
    if (this._releaseIndex) return this._releaseIndex;
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
    const filePath = path.join(DOCS_DIR, 'objectClassifications_SAP.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw) ? raw : (raw.objectClassifications || []);
    this._classifications = {};
    for (const item of items) {
      if (item.objectKey) this._classifications[item.objectKey] = item;
    }
    return this._classifications;
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
  lookup(deprecatedName, oldType = '') {
    const index = this._loadReleaseIndex();
    const classes = this._loadClassifications();

    const item = index[deprecatedName];
    const classification = classes[deprecatedName] || null;

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
    const tierDescription = STATE_DESCRIPTION[effectiveState] || `State: ${effectiveState}`;

    // Merge metadata from both sources (release file takes priority)
    const sourceItem = item || classification;

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
      note:              item?.successorClassification || '',
      softwareComponent: sourceItem.softwareComponent || '',
      appComponent:      sourceItem.applicationComponent || '',
    };
  }
}

module.exports = { ClassificationClient };
