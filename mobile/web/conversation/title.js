function projectionTitle(row) {
  const title = row?.projections?.values?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : '';
}

function isUntitledBlank(session) {
  return session?.blank === true && !projectionTitle(session);
}

function sessionTitle(row) {
  const titled = projectionTitle(row);
  if (titled) return titled;
  if (row?.blank) return '新会话';
  const id = String(row?.sessionId || '');
  return id.slice(0, 7) || '会话';
}

export { isUntitledBlank, sessionTitle };
