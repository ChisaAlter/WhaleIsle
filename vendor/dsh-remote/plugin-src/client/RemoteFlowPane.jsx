import * as React from 'react'
import { Button, FileTypeIcon, IconChevronUpOutline14, IconFolderClose16, IconPlusOutline16, IconRefreshOutline16, Input, Modal, SettingsSelect, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { parentRemotePath, remoteApi, remoteCrumbs } from './api.js'
import { RemoteFeedback } from './Feedback.jsx'

/**
 * The「远程」tab of the workspace picker. The owner (ui-directory-picker-browse)
 * keeps this mounted after the first visit and only flips `active`, so machine
 * selection, connection state, and the browse position survive tab switches.
 * Picking a directory asks the host for the local mirror and hands THAT path
 * to `onPicked` — the owner's workspace adoption stays remote-agnostic.
 */
export function RemoteFlowPane({ open, active, busy, onPicked, onCancel, onError, t }) {
  const [machines, setMachines] = React.useState(null)
  const [machineId, setMachineId] = React.useState('')
  const [connected, setConnected] = React.useState(false)
  const [path, setPath] = React.useState('')
  const [items, setItems] = React.useState(null) // null = not loaded
  const [platform, setPlatform] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [loadingMachines, setLoadingMachines] = React.useState(false)
  const [choosing, setChoosing] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [mkdirOpen, setMkdirOpen] = React.useState(false)
  const [mkdirName, setMkdirName] = React.useState('')
  const [creatingDir, setCreatingDir] = React.useState(false)
  const [mkdirError, setMkdirError] = React.useState('')
  const loadedOnce = React.useRef(false)

  const list = React.useCallback((dir) => {
    setLoading(true); setErr('')
    remoteApi.ls(dir)
      .then((res) => {
        setPlatform(res && res.platform === 'windows' ? 'windows' : 'posix')
        setPath(res && res.path !== undefined && res.path !== '' ? res.path : dir)
        const entries = Array.isArray(res && res.items) ? res.items : []
        entries.sort((a, b) => {
          const ad = (a.type === 'dir' || a.drive) ? 0 : 1
          const bd = (b.type === 'dir' || b.drive) ? 0 : 1
          return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name))
        })
        setItems(entries)
        setConnected(true)
      })
      .catch((e) => { setConnected(false); setItems(null); setErr(t('picker.listFail', { error: String((e && e.message) || e) })) })
      .finally(() => setLoading(false))
  }, [t])

  const loadMachines = React.useCallback(() => {
    setLoadingMachines(true); setErr('')
    remoteApi.machines()
      .then((r) => {
        const list0 = r.machines || []
        setMachines(list0)
        const initial = r.currentId || (list0[0] && list0[0].id) || ''
        setMachineId(initial)
        if (initial) {
          setLoading(true)
          return remoteApi.setCurrent(initial).then(() => list(''))
        }
      })
      .catch((e) => { setLoading(false); setErr(t('picker.loadFail', { error: String((e && e.message) || e) })) })
      .finally(() => setLoadingMachines(false))
  }, [list, t])

  // The keep-alive pane fetches once; failures remain explicitly retryable.
  React.useEffect(() => {
    if (!open || !active || loadedOnce.current) return
    loadedOnce.current = true
    loadMachines()
  }, [open, active, loadMachines])

  const selectMachine = (id) => {
    if (!id || id === machineId && items !== null) return
    setMachineId(id)
    setItems(null); setPath(''); setErr(''); setConnected(false); setLoading(true)
    remoteApi.setCurrent(id)
      .then(() => list(''))
      .catch((e) => { setLoading(false); setErr(t('picker.listFail', { error: String((e && e.message) || e) })) })
  }

  const enterDir = (it) => {
    if (busy || loading) return
    list(it.path)
  }

  const goUp = () => {
    if (loading) return
    const parent = parentRemotePath(path)
    list(parent || '')
  }

  const goHome = () => {
    if (loading) return
    setLoading(true); setErr('')
    remoteApi.remoteHome()
      .then((r) => {
        if (r && r.home) list(r.home)
        else { setErr((r && (r.hint || r.error)) || ''); setLoading(false) }
      })
      .catch((e) => { setErr(String((e && e.message) || e)); setLoading(false) })
  }

  const choose = () => {
    const target = String(path || '').trim()
    if (!target || busy || choosing) return
    setChoosing(true); setErr('')
    remoteApi.pickWorkspace(target)
      .then((res) => {
        if (res && res.localMirror) onPicked(res.localMirror)
        else { setErr((res && res.error) || ''); setChoosing(false) }
      })
      .catch((e) => {
        const text = String((e && e.message) || e)
        setErr(text)
        if (typeof onError === 'function') onError(text)
        setChoosing(false)
      })
  }

  const confirmMkdir = () => {
    const name = mkdirName.trim()
    if (!name || creatingDir) return
    const base = path || '/'
    const sep = base.includes('\\') ? '\\' : '/'
    const full = base === '/' ? '/' + name : base.replace(/[\\/]+$/, '') + sep + name
    setCreatingDir(true); setMkdirError('')
    remoteApi.fs('mkdir', { path: full })
      .then(() => { setMkdirOpen(false); setMkdirName(''); list(base) })
      .catch((e) => setMkdirError(String((e && e.message) || e)))
      .finally(() => setCreatingDir(false))
  }

  const crumbs = remoteCrumbs(path)
  const machineOptions = (machines || []).map((m) => ({ id: m.id, label: `${m.name || m.host} (${m.username}@${m.host}:${m.port})` }))
  const rootLabel = platform === 'windows' ? t('picker.rootPc') : '/'
  const pending = busy || loading || loadingMachines || choosing || creatingDir
  const unavailable = pending || !machineId

  return (
    <div className="dshr-flow">
      <RemoteFeedback error={err} t={t} actions={err && items === null ? [{ label: t('explorer.retry'), disabled: pending, onClick: () => { if (!pending) { if (machines === null) loadMachines(); else if (machineId) selectMachine(machineId) } } }] : undefined} />
      <div className="dshr-flowContent">
      {machines === null ? (
        <div className="dshr-flowStatus">
          {err ? <Button variant="outline" onClick={loadMachines} disabled={pending} loading={loadingMachines}>{t('explorer.retry')}</Button> : <div className="dshr-caption" role="status">{t('picker.loading')}</div>}
        </div>
      ) : machines.length === 0 ? (
        <div className="dshr-emptyState">
          <span>{t('picker.machineEmpty')}</span>
          <span className="dshr-caption">{t('picker.machineEmptyHint')}</span>
        </div>
      ) : <>
      <div className="dshr-row">
        <span className="dshr-formLabel" style={{ textAlign: 'left' }}>{t('picker.machine')}</span>
        <SettingsSelect
          variant="block" className="dshr-grow"
          value={machineId} options={machineOptions}
          onChange={selectMachine} disabled={pending}
          loading={loadingMachines || loading && items === null}
          aria-label={t('picker.machine')}
        />
        <StateDot state={connected ? 'done' : (loading ? 'ongoing' : 'idle')} />
      </div>

      <div className="dshr-row">
        <Input
          value={path} onChange={(e) => { setPath(e.target.value); setErr('') }}
          placeholder={t('picker.pathPlaceholder')}
          disabled={unavailable}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); list(path) } }}
          className="dshr-grow dshr-mono"
          aria-label={t('picker.pathPlaceholder')}
        />
        <button type="button" className="dshr-iconBtn" title={t('picker.home')} aria-label={t('picker.home')} onClick={goHome} disabled={unavailable}>~</button>
        <button type="button" className="dshr-iconBtn" title={t('picker.up')} aria-label={t('picker.up')} onClick={goUp} disabled={unavailable || !path}><IconChevronUpOutline14 /></button>
        <Button variant="ghost" size="sm" className="dshr-iconBtn" title={t('picker.refresh')} aria-label={t('picker.refresh')} onClick={() => list(path)} disabled={unavailable} loading={loading}><IconRefreshOutline16 /></Button>
      </div>

      {path ? (
        <div className="dshr-crumbs">
          <button type="button" className="dshr-crumb" disabled={unavailable} onClick={() => list('')}>{rootLabel}</button>
          {crumbs.parts && crumbs.parts.map((c, i) => (
            <React.Fragment key={c.path}>
              <span>{crumbs.sep === '\\' ? '\\' : '›'}</span>
              <button type="button" disabled={unavailable} className={'dshr-crumb' + (i === crumbs.parts.length - 1 ? ' dshr-crumbLast' : '')} onClick={() => list(c.path)}>{c.name}</button>
            </React.Fragment>
          ))}
        </div>
      ) : null}

      <div className="dshr-list">
        {loading && items === null ? <div className="dshr-listEmpty">{t('picker.loading')}</div> : null}
        {!loading && items === null && err ? <div className="dshr-flowStatus"><Button variant="outline" onClick={() => selectMachine(machineId)} disabled={unavailable}>{t('explorer.retry')}</Button></div> : null}
        {items !== null && items.length === 0 ? <div className="dshr-listEmpty">{t('picker.noDirs')}</div> : null}
        {(items || []).map((it) => {
          const isDir = it.type === 'dir' || !!it.drive
          return (
            <button
              key={it.path || it.name} type="button" className="dshr-listItem"
              data-kind={isDir ? 'dir' : 'file'}
              onClick={() => { if (isDir) enterDir(it) }}
              disabled={!isDir || unavailable}
              title={it.path || it.name}
            >
              {isDir ? <IconFolderClose16 size={14} /> : <FileTypeIcon path={it.name} size={14} />}
              <span className="dshr-treeName">{it.name}</span>
            </button>
          )
        })}
      </div>

      <div className="dshr-caption">{t('picker.mirrorHint')}</div>
      </>}
      </div>

      <div className="dshr-flowFooter">
        <Button variant="outline" icon={<IconPlusOutline16 size={14} />} onClick={() => { setMkdirName(''); setMkdirError(''); setMkdirOpen(true) }} disabled={unavailable || !path || !connected}>
          {t('picker.mkdir')}
        </Button>
        <div className="dshr-flowActions">
        <Button variant="outline" onClick={onCancel} disabled={busy || choosing}>{t('form.cancel')}</Button>
        <Button variant="primary" onClick={choose} disabled={unavailable || !path || !connected} loading={choosing}>
          {t('picker.choose')}
        </Button>
        </div>
      </div>

      <Modal
        open={open && active && mkdirOpen} onClose={() => { if (!creatingDir) setMkdirOpen(false) }}
        title={t('picker.mkdir')} closeLabel={t('common.close')}
        footer={(
          <React.Fragment>
            <Button variant="ghost" size="sm" onClick={() => setMkdirOpen(false)} disabled={creatingDir}>{t('form.cancel')}</Button>
            <Button variant="primary" size="sm" onClick={confirmMkdir} disabled={creatingDir || !mkdirName.trim()} loading={creatingDir}>{t('picker.mkdir')}</Button>
          </React.Fragment>
        )}
      >
        <RemoteFeedback error={mkdirError} t={t} actions={[{ label: t('explorer.retry'), disabled: creatingDir || !mkdirName.trim(), onClick: confirmMkdir }]} />
        <Input
          value={mkdirName} onChange={(e) => setMkdirName(e.target.value)}
          placeholder={t('picker.mkdirName')} disabled={creatingDir} data-modal-autofocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmMkdir() } }}
        />
      </Modal>
    </div>
  )
}
