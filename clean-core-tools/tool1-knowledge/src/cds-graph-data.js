'use strict';

const MOCK_DATA = {
  'I_SalesOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_SalesOrderItem',         relation: 'association' },
      { target: 'I_BusinessPartner',         relation: 'association' },
      { target: 'I_SalesOrganization',       relation: 'join' },
    ]
  },
  'I_SalesOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',                relation: 'association' },
      { target: 'I_SalesOrderScheduleLine',  relation: 'association' },
    ]
  },
  'I_BusinessPartner': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_BusinessPartnerAddress',  relation: 'association' },
    ]
  },
  'I_SalesOrganization': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_Material': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_MaterialText',            relation: 'association' },
    ]
  },
  'I_SalesOrderScheduleLine': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_BusinessPartnerAddress': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C2',
    associations: []
  },
  'I_MaterialText': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'C_SalesOrderTP': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_SalesOrder',             relation: 'association' },
      { target: 'VBAK',                     relation: 'join' },
    ]
  },
  'VBAK': {
    type: 'Database Table', releaseState: 'Internal', cleanCore: false, classification: 'Not Classified',
    associations: []
  },
  'I_PurchaseOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_PurchaseOrderItem',       relation: 'association' },
      { target: 'I_Supplier',               relation: 'association' },
    ]
  },
  'I_PurchaseOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',               relation: 'association' },
    ]
  },
  'I_Supplier': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_JournalEntry': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_JournalEntryItem',       relation: 'association' },
      { target: 'I_CompanyCode',            relation: 'join' },
    ]
  },
  'I_JournalEntryItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_GLAccount',              relation: 'association' },
    ]
  },
  'I_CompanyCode': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_GLAccount': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
};

/**
 * BFS 递归展开 CDS View 关系图
 * @param {string} viewName - 根节点名称
 * @param {number} maxDepth - 最大展开层数（默认 2）
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
function buildGraph(viewName, maxDepth = 2) {
  if (!MOCK_DATA[viewName]) return null;

  const nodes = new Map(); // id → node（保证唯一，取最小 depth）
  const edges = [];
  const visited = new Set(); // 已展开过关联关系的节点
  const queue = [{ id: viewName, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift();

    // 节点去重：已存在且 depth 更小则跳过
    if (nodes.has(id) && nodes.get(id).depth <= depth) continue;

    const data = MOCK_DATA[id];
    nodes.set(id, {
      id,
      type:           data ? data.type           : 'Unknown',
      releaseState:   data ? data.releaseState    : 'Unknown',
      cleanCore:      data ? data.cleanCore       : null,
      classification: data ? data.classification  : 'Not Classified',
      depth,
    });

    // 只有未展开过的节点才添加其子关联（防止 edges 重复）
    if (!data || depth >= maxDepth || visited.has(id)) continue;
    visited.add(id);

    for (const assoc of data.associations) {
      edges.push({ source: id, target: assoc.target, relation: assoc.relation });
      queue.push({ id: assoc.target, depth: depth + 1 });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
}

module.exports = { buildGraph };
