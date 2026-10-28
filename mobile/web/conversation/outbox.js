// Messages the phone has sent but the host has not yet echoed back. They show
// as pending bubbles at the end of the log so a send is visible immediately,
// and leave once history (or the queue projection) carries the same message.

/** RFC 4122 v4 id without crypto.randomUUID (LAN pages are not a secure context). */
function mintRequestId(cryptoImpl = globalThis.crypto) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function imagesKey(images) {
  return (images || []).map((image) => `${image.mediaType}:${String(image.data || '').length}:${String(image.data || '').slice(-24)}`).join('|');
}

/**
 * A retry of the same content keeps the same request id, so a lost
 * acknowledgement cannot turn into a duplicate message on the host.
 */
function promptIdentity(previous, { sessionId, text, images, mode }) {
  const key = `${sessionId}\u0000${mode}\u0000${text}\u0000${imagesKey(images)}`;
  if (previous?.key === key) return previous;
  return { key, requestId: mintRequestId() };
}

function userRowIds(rows) {
  return new Set((rows || []).filter((row) => row.role === 'user').map((row) => row.id));
}

/**
 * Drop entries the host has echoed: a user row that was not there when the
 * entry was sent, with the same text, or a queued inbox item with that text.
 * Each echoed row or queue item settles at most one entry.
 */
function settleOutbox(outbox, rows, queued = []) {
  if (!outbox.length) return outbox;
  const fresh = (rows || []).filter((row) => row.role === 'user');
  const used = new Set();
  const usedQueue = new Set();
  return outbox.filter((entry) => {
    const text = entry.text.trim();
    const row = fresh.find((candidate) => !entry.baseline.has(candidate.id) && !used.has(candidate.id)
      && String(candidate.text || '').trim() === text && (candidate.images?.length || 0) === entry.images.length);
    if (row) {
      used.add(row.id);
      return false;
    }
    const item = entry.status === 'sent'
      ? queued.find((candidate) => !usedQueue.has(candidate.id) && candidate.text.trim() === text)
      : null;
    if (item) {
      usedQueue.add(item.id);
      return false;
    }
    return true;
  });
}

export { mintRequestId, promptIdentity, settleOutbox, userRowIds };
