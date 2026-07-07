const axios = require('axios');
const xml2js = require('xml2js');

class AdtClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.auth = { username, password };
  }

  _objectPath(name, type) {
    const n = name.toLowerCase();
    if (type === 'PROG') return `/sap/bc/adt/programs/programs/${n}/source/main`;
    if (type === 'CLAS') return `/sap/bc/adt/oo/classes/${n}/source/main`;
    if (type === 'FUGR') return `/sap/bc/adt/function_groups/${n}/source/main`;
    return `/sap/bc/adt/programs/programs/${n}/source/main`;
  }

  async getSourceCode(name, type) {
    const url = `${this.baseUrl}${this._objectPath(name, type)}`;
    const res = await axios.get(url, { auth: this.auth, headers: { Accept: 'text/plain' } });
    return res.data;
  }

  async getDdicDefinition(name) {
    const url = `${this.baseUrl}/sap/bc/adt/ddic/structures/${name.toLowerCase()}`;
    try {
      const res = await axios.get(url, { auth: this.auth, headers: { Accept: 'application/xml' } });
      return res.data;
    } catch {
      const url2 = `${this.baseUrl}/sap/bc/adt/ddic/dataelements/${name.toLowerCase()}`;
      const res2 = await axios.get(url2, { auth: this.auth, headers: { Accept: 'application/xml' } });
      return res2.data;
    }
  }

  async checkLock(name, type) {
    const url = `${this.baseUrl}${this._objectPath(name, type)}`;
    try {
      await axios.get(url, { auth: this.auth, headers: { 'X-sap-adt-lock-status': 'check' } });
      return { locked: false };
    } catch (err) {
      if (err.response?.status === 423) {
        return {
          locked: true,
          lockedBy: err.response.headers['x-sap-adt-lock-owner'] || 'UNKNOWN',
        };
      }
      return { locked: false };
    }
  }

  async syntaxCheck(name, type, sourceCode) {
    const url = `${this.baseUrl}/sap/bc/adt/abapsource/syntaxcheck`;
    const res = await axios.post(url, sourceCode, { auth: this.auth });
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
    const status = parsed?.checkReport?.status;
    if (status !== 'error') return { hasErrors: false, messages: [] };
    const msgs = parsed?.checkReport?.message;
    const list = Array.isArray(msgs) ? msgs : [msgs];
    return {
      hasErrors: true,
      messages: list.map(m => (typeof m === 'string' ? m : m?._ || JSON.stringify(m))),
    };
  }

  async lockObject(name, type) {
    const url = `${this.baseUrl}${this._objectPath(name, type)}`;
    const res = await axios.post(`${url}?_action=LOCK`, null, {
      auth: this.auth,
      headers: { 'X-sap-adt-sessiontype': 'stateful' },
    });
    return res.headers['x-sap-adt-lock-handle'];
  }

  async writeSourceCode(name, type, sourceCode, lockHandle, transportRequest) {
    const url = `${this.baseUrl}${this._objectPath(name, type)}`;
    await axios.put(url, sourceCode, {
      auth: this.auth,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-sap-adt-lock-handle': lockHandle,
        'X-sap-crm-transport-request': transportRequest,
      },
    });
  }

  async unlockObject(name, type, lockHandle) {
    const url = `${this.baseUrl}${this._objectPath(name, type)}`;
    await axios.post(`${url}?_action=UNLOCK&lockHandle=${lockHandle}`, null, {
      auth: this.auth,
    });
  }

  async activateObject(name, type) {
    const url = `${this.baseUrl}/sap/bc/adt/activation`;
    const body = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:name="${name}" adtcore:type="${type}"/>
</adtcore:objectReferences>`;
    const res = await axios.post(url, body, {
      auth: this.auth,
      headers: { 'Content-Type': 'application/xml' },
    });
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
    const status = parsed?.activationLog?.status || 'success';
    if (status === 'error') {
      const msgs = parsed?.activationLog?.message;
      const list = Array.isArray(msgs) ? msgs : [msgs];
      return {
        success: false,
        errors: list.map(m => ({
          line: m?.$?.line,
          text: m?._ || JSON.stringify(m),
        })),
      };
    }
    return { success: true, errors: [] };
  }
}

module.exports = { AdtClient };
