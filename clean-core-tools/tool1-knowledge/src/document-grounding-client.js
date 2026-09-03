// tool1-knowledge/src/document-grounding-client.js
// SAP AI Core Document Grounding API client
// Docs: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/document-grounding
const axios = require('axios');

class DocumentGroundingClient {
  constructor() {
    const vcapRaw = process.env.VCAP_SERVICES;
    if (!vcapRaw) throw new Error('VCAP_SERVICES is required');
    const vcap = JSON.parse(vcapRaw);
    this._creds = vcap.aicore[0].credentials;
    this.resourceGroup = process.env.AICORE_GROUNDING_RESOURCE_GROUP || process.env.AICORE_RESOURCE_GROUP || 'docgrp';
    this._tokenCache = null;
    this._tokenExpiry = 0;
  }

  get _baseUrl() {
    return this._creds.serviceurls.AI_API_URL.replace(/\/$/, '') + '/v2/lm/document-grounding';
  }

  async _getToken() {
    const now = Date.now();
    if (this._tokenCache && now < this._tokenExpiry) return this._tokenCache;
    const { url, clientid, clientsecret } = this._creds;
    const resp = await axios.post(
      `${url}/oauth/token`,
      new URLSearchParams({ grant_type: 'client_credentials', client_id: clientid, client_secret: clientsecret }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    const { access_token, expires_in } = resp.data;
    this._tokenCache = access_token;
    this._tokenExpiry = now + (expires_in - 60) * 1000;
    return access_token;
  }

  async _headers() {
    return {
      Authorization: `Bearer ${await this._getToken()}`,
      'Content-Type': 'application/json',
      'AI-Resource-Group': this.resourceGroup,
    };
  }

  async listCollections() {
    const resp = await axios.get(`${this._baseUrl}/collections`, {
      headers: await this._headers(),
      timeout: 30000,
    });
    return resp.data.resources || resp.data || [];
  }

  async createCollection(title) {
    const resp = await axios.post(
      `${this._baseUrl}/collections`,
      { title, embeddingModel: 'text-embedding-ada-002' },
      { headers: await this._headers(), timeout: 30000 }
    );
    return resp.data.id || resp.data.collectionId;
  }

  // documents: array of { url, content, metadata: { source, title } }
  // API accepts up to 100 documents per request; caller should batch if needed
  async uploadDocuments(collectionId, documents) {
    const resp = await axios.post(
      `${this._baseUrl}/collections/${collectionId}/documents`,
      { documents },
      { headers: await this._headers(), timeout: 120000 }
    );
    return resp.data;
  }

  // Search for relevant chunks in a collection
  async search(collectionId, query, maxChunks = 5) {
    const resp = await axios.post(
      `${this._baseUrl}/vector/search`,
      {
        query,
        filters: [
          {
            id: '1',
            configuration: {},
            collectionIds: [collectionId],
            dataRepositoryType: 'vector',
            dataRepositoryMetadata: [],
            documentMetadata: [],
            chunkMetadata: [],
          }
        ],
        maxChunkCount: maxChunks,
      },
      {
        headers: await this._headers(),
        timeout: 30000,
      }
    );

    const chunks = [];
    for (const filterResult of resp.data.results || []) {
      for (const repoResult of filterResult.results || []) {
        for (const doc of (repoResult.documents || repoResult.dataRepository?.documents || [])) {
          for (const chunk of (doc.chunks || [])) {
            chunks.push(chunk);
            if (chunks.length >= maxChunks) return chunks;
          }
        }
      }
    }
    return chunks;
  }

  async deleteCollection(collectionId) {
    await axios.delete(`${this._baseUrl}/collections/${collectionId}`, {
      headers: await this._headers(),
      timeout: 30000,
    });
  }
}

module.exports = { DocumentGroundingClient };
