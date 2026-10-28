import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedList, reconcileChildren, rowSignature } from './keyed-list.js';

/** Minimal sibling-linked parent: enough DOM surface for reconcileChildren. */
function fakeParent(initial = []) {
  const children = [...initial];
  const moves = [];
  const link = (node) => {
    Object.defineProperty(node, 'nextSibling', {
      configurable: true,
      get: () => children[children.indexOf(node) + 1] || null,
    });
  };
  initial.forEach(link);
  return {
    children,
    moves,
    get firstChild() { return children[0] || null; },
    insertBefore(node, ref) {
      const at = children.indexOf(node);
      if (at >= 0) children.splice(at, 1);
      const index = ref ? children.indexOf(ref) : children.length;
      children.splice(index, 0, node);
      link(node);
      moves.push(node.id);
    },
    removeChild(node) {
      children.splice(children.indexOf(node), 1);
    },
  };
}

test('unchanged rows keep their node; changed rows rebuild', () => {
  const list = createKeyedList();
  let builds = 0;
  const build = (row) => ({ id: row.id, text: row.text, build: ++builds });
  const first = list.nodes([{ id: 'a', text: '1' }, { id: 'b', text: '2' }], { key: (row) => row.id, build });
  const second = list.nodes([{ id: 'a', text: '1' }, { id: 'b', text: '2+' }, { id: 'c', text: '3' }], { key: (row) => row.id, build });
  assert.equal(second[0], first[0]);
  assert.notEqual(second[1], first[1]);
  assert.equal(builds, 4);
});

test('duplicate keys never share one node', () => {
  const list = createKeyedList();
  const nodes = list.nodes([{ id: 'x' }, { id: 'x' }], { key: (row) => row.id, build: (row) => ({ ...row }) });
  assert.notEqual(nodes[0], nodes[1]);
});

test('reconcileChildren appends a tail without moving earlier rows', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  const parent = fakeParent([a, b]);
  reconcileChildren(parent, [a, b, c]);
  assert.deepEqual(parent.children.map((node) => node.id), ['a', 'b', 'c']);
  assert.deepEqual(parent.moves, ['c']);
});

test('reconcileChildren replaces, reorders and drops stale nodes', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  const d = { id: 'd' };
  const parent = fakeParent([a, b, c]);
  reconcileChildren(parent, [d, a, c]);
  assert.deepEqual(parent.children.map((node) => node.id), ['d', 'a', 'c']);
});

test('rowSignature collapses inline image payloads', () => {
  const big = 'A'.repeat(5000);
  assert.ok(rowSignature({ images: [{ data: big }] }).length < 200);
  assert.notEqual(rowSignature({ images: [{ data: `${big}B` }] }), rowSignature({ images: [{ data: `${big}C` }] }));
});
