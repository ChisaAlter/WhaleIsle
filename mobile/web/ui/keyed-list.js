// Keyed DOM reuse for long, frequently repainted lists (the conversation log).
// A row keeps its node while its content signature is unchanged, so a live
// tick rebuilds only the rows that changed; expanded disclosures, loaded
// images and text selection inside untouched rows survive the repaint.

/** Content signature; inline base64 payloads collapse to length + tail. */
function rowSignature(row) {
  return JSON.stringify(row, (key, value) => (
    key === 'data' && typeof value === 'string' && value.length > 64
      ? `#${value.length}:${value.slice(-16)}`
      : value
  ));
}

function createKeyedList() {
  let cache = new Map();
  return {
    /**
     * @template T
     * @param {T[]} items
     * @param {{ key: (item: T) => string, signature?: (item: T) => string, build: (item: T) => Node }} options
     * @returns {Node[]}
     */
    nodes(items, { key, signature = rowSignature, build }) {
      const next = new Map();
      const out = [];
      for (const item of items) {
        let id = String(key(item));
        // Duplicate ids must not share one node.
        while (next.has(id)) id = `${id}\u0000`;
        const sig = signature(item);
        const hit = cache.get(id);
        const node = hit && hit.sig === sig ? hit.node : build(item);
        next.set(id, { sig, node });
        out.push(node);
      }
      cache = next;
      return out;
    },
    reset() {
      cache = new Map();
    },
  };
}

/** Make `parent`'s children exactly `nodes`, moving only nodes out of place. */
function reconcileChildren(parent, nodes) {
  let cursor = parent.firstChild;
  for (const node of nodes) {
    if (node === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(node, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
}

export { createKeyedList, reconcileChildren, rowSignature };
