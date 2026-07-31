'use strict';

const { buildGraph } = require('./cds-graph-data');

test('buildGraph returns null for unknown view', () => {
  expect(buildGraph('UNKNOWN_VIEW')).toBeNull();
});

test('buildGraph returns root node for known view with depth=0', () => {
  const result = buildGraph('I_SalesOrder');
  expect(result).not.toBeNull();
  const root = result.nodes.find(n => n.id === 'I_SalesOrder');
  expect(root).toBeDefined();
  expect(root.depth).toBe(0);
  expect(root.cleanCore).toBe(true);
  expect(root.releaseState).toBe('Released');
});

test('buildGraph returns depth-1 neighbours', () => {
  const result = buildGraph('I_SalesOrder');
  const ids = result.nodes.map(n => n.id);
  expect(ids).toContain('I_SalesOrderItem');
  expect(ids).toContain('I_BusinessPartner');
  expect(ids).toContain('I_SalesOrganization');
});

test('buildGraph returns edges with correct relation type', () => {
  const result = buildGraph('I_SalesOrder');
  const assocEdge = result.edges.find(
    e => e.source === 'I_SalesOrder' && e.target === 'I_BusinessPartner'
  );
  expect(assocEdge).toBeDefined();
  expect(assocEdge.relation).toBe('association');

  const joinEdge = result.edges.find(
    e => e.source === 'I_SalesOrder' && e.target === 'I_SalesOrganization'
  );
  expect(joinEdge).toBeDefined();
  expect(joinEdge.relation).toBe('join');
});

test('buildGraph expands to depth 2 by default', () => {
  const result = buildGraph('I_SalesOrder');
  const depth2 = result.nodes.filter(n => n.depth === 2);
  expect(depth2.length).toBeGreaterThan(0);
  const material = result.nodes.find(n => n.id === 'I_Material');
  expect(material).toBeDefined();
  expect(material.depth).toBe(2);
});

test('buildGraph maxDepth=1 does not include depth-2 nodes', () => {
  const result = buildGraph('I_SalesOrder', 1);
  const depth2 = result.nodes.filter(n => n.depth === 2);
  expect(depth2.length).toBe(0);
});

test('buildGraph deduplicates nodes (same node reachable via multiple paths)', () => {
  const result = buildGraph('I_PurchaseOrder');
  const materials = result.nodes.filter(n => n.id === 'I_Material');
  expect(materials.length).toBe(1);
});

test('buildGraph includes non-cleanCore node (VBAK) from C_SalesOrderTP', () => {
  const result = buildGraph('C_SalesOrderTP');
  const vbak = result.nodes.find(n => n.id === 'VBAK');
  expect(vbak).toBeDefined();
  expect(vbak.cleanCore).toBe(false);
});
