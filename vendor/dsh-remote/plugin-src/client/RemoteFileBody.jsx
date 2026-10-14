import * as React from 'react'
import { Button, FileTypeIcon, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { remoteApi, remoteFileTarget } from './api.js'
import { RemoteFeedback } from './Feedback.jsx'

const MAX_BYTES = 256 * 1024

/**
 * The remote file tab claimed for `dsh-resource://dsh-remote/**` addresses:
 * preview (bounded), in-place edit with an mtime optimistic lock (a 409 means
 * the remote changed under the draft — never overwrite it), and download into
 * the session mirror so the local workspace carries the file.
 */
export function RemoteFileBody({ useTabInfo, t }) {
  const info = useTabInfo()
  const target = React.useMemo(() => {
    try { return remoteFileTarget(info.tab.navigation.address) } catch { return { sessionId: '', path: '' } }
  }, [info.tab.navigation.address])
  const { sessionId, path } = target
  const [data, setData] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [edit, setEdit] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)

  const originalText = (data && data.content != null ? String(data.content) : '').replace(/\n…\[truncated:.*$/, '')
  const dirty = edit && draft !== originalText

  const load = React.useCallback(() => {
    if (!path) { setLoading(false); return undefined }
    let cancelled = false
    setLoading(true); setErr(''); setNotice(''); setData(null); setEdit(false)
    remoteApi.read(path, MAX_BYTES, sessionId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setErr(t('file.readFail', { msg: String((e && e.message) || e) })); setLoading(false) } })
    return () => { cancelled = true }
  }, [path, sessionId, t])

  React.useEffect(load, [load])

  const startEdit = () => {
    if (!data || data.binary) return
    setDraft(originalText); setEdit(true); setErr('')
  }

  const save = () => {
    if (saving) return
    setSaving(true); setErr('')
    remoteApi.write(path, draft, data && data.mtime, sessionId)
      .then((r) => {
        if (r.status === 409) {
          setErr((r.data && r.data.error) || t('file.conflict'))
          return
        }
        if (r.status >= 400) throw new Error((r.data && (r.data.error || r.data.message)) || 'HTTP ' + r.status)
        setEdit(false)
        load()
      })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setSaving(false))
  }

  const download = () => {
    if (downloading) return
    setDownloading(true); setErr(''); setNotice('')
    remoteApi.fs('download', { path }, sessionId)
      .then((r) => setNotice(t('file.downloaded', { path: (r && r.local) ? t('file.downloadedAt', { path: r.local }) : '' })))
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setDownloading(false))
  }

  const baseName = path.split(/[\\/]/).pop() || path
  return (
    <div className="dshr-editor">
      <div className="dshr-editorHead">
        <FileTypeIcon path={baseName} size={14} />
        <span className="dshr-mono dshr-ellipsis dshr-secondary" title={path}>{path}</span>
        {dirty ? <Tag tone="outline">{t('file.dirty')}</Tag> : null}
        <span className="dshr-caption" style={{ flexShrink: 0 }}>{edit ? t('file.editing') : t('file.readonly')}</span>
        {edit ? (
          <React.Fragment>
            <Button variant="primary" size="sm" onClick={save} disabled={saving || !dirty} loading={saving} title={t('file.saveHint')}>
              {t('file.saveToRemote')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEdit(false); setErr('') }} disabled={saving}>{t('file.cancel')}</Button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <Button variant="ghost" size="sm" onClick={startEdit} disabled={downloading || !data || !!data.binary}>{t('file.edit')}</Button>
            <Button variant="ghost" size="sm" onClick={download} disabled={downloading} loading={downloading}>{t('file.download')}</Button>
          </React.Fragment>
        )}
      </div>
      <div className="dshr-editorBody">
        <RemoteFeedback error={err} message={notice} onClearMessage={() => setNotice('')} t={t} actions={!data && !edit ? [{ label: t('explorer.retry'), onClick: load }] : undefined} />
        {loading ? <div className="dshr-muted" style={{ padding: 12, fontSize: 13 }}>{t('file.loading')}</div> : (
          data && data.binary ? (
            <div className="dshr-muted" style={{ padding: 12, fontSize: 13 }}>
              {t('file.binary', { size: data.size != null ? `${data.size} bytes` : t('file.unknownSize') })}
            </div>
          ) : edit ? (
            <textarea
              className="dshr-editorText"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!saving && dirty) save() }
                if (e.key === 'Escape' && !saving) { e.preventDefault(); setEdit(false); setErr('') }
              }}
              spellCheck={false}
            />
          ) : (
            <div className="dshr-editorView">
              {data && data.content != null ? data.content : data ? t('file.empty') : null}
              {data && data.truncated ? <div className="dshr-caption dshr-warn" style={{ marginTop: 8 }}>{t('file.truncated')}</div> : null}
            </div>
          )
        )}
      </div>
    </div>
  )
}
