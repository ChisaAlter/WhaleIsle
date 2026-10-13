import * as React from 'react'
import { Button, Checkbox, Input, Modal, SettingsSelect, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { remoteApi } from './api.js'
import { MachineForm } from './MachineForm.jsx'

const EMPTY_FORWARD = { direction: 'local', listenPort: '', targetHost: '127.0.0.1', targetPort: '', autoStart: false }

/**
 * The「远程工作区」settings section: machine registry CRUD, connection state,
 * SSH-config import, port forwards, and the audit tail — all riding the
 * /api/dsh-remote routes the vendored host mounts.
 */
export function RemoteSettingsSection({ t }) {
  const [status, setStatus] = React.useState(null)
  const [machines, setMachines] = React.useState([])
  const [currentId, setCurrentId] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [loadError, setLoadError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const loadGeneration = React.useRef(0)
  const [msg, setMsg] = React.useState('')
  const [busyId, setBusyId] = React.useState('')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [sshEntries, setSshEntries] = React.useState(null)
  const [forwards, setForwards] = React.useState([])
  const [fwdForm, setFwdForm] = React.useState(EMPTY_FORWARD)
  const [audit, setAudit] = React.useState(null)
  const [confirmDel, setConfirmDel] = React.useState(null) // machine row pending delete

  const refresh = React.useCallback(() => {
    const generation = ++loadGeneration.current
    setLoading(true); setLoadError('')
    return Promise.all([remoteApi.machines(), remoteApi.status(), remoteApi.forwards()])
      .then(([r, s, f]) => {
        if (generation !== loadGeneration.current) return
        setMachines(r.machines || []); setCurrentId(r.currentId || null)
        setStatus(s); setForwards(f.forwards || [])
      })
      .catch((e) => { if (generation === loadGeneration.current) setLoadError(String((e && e.message) || e)) })
      .finally(() => { if (generation === loadGeneration.current) setLoading(false) })
  }, [])

  React.useEffect(() => { refresh(); return () => { loadGeneration.current++ } }, [refresh])

  const run = (fn, okMsg) => {
    setErr(''); setMsg('')
    return fn()
      .then(() => { if (okMsg) setMsg(okMsg); refresh() })
      .catch((e) => setErr(String((e && e.message) || e)))
  }

  const setCurrent = (id) => {
    setBusyId(id || 'clear')
    run(() => remoteApi.setCurrent(id), id ? '' : t('settings.cleared'))
      .finally(() => setBusyId(''))
  }

  const testMachine = (m) => {
    setBusyId('test:' + m.id); setErr(''); setMsg('')
    remoteApi.testConnect({
      machineId: m.id,
      host: m.host, port: m.port, username: m.username,
      privateKeyPath: m.privateKeyPath, passphrase: m.passphrase,
      hostKeyMode: m.hostKeyMode || undefined,
      useAgent: m.useAgent, keyboardInteractive: m.keyboardInteractive,
      proxy: m.proxy && m.proxy.host ? m.proxy : undefined,
    })
      .then((r) => {
        if (r && r.ok) setMsg(t('form.testOk', { ms: String(r.latencyMs ?? '?'), platform: r.platform || '?' }))
        else setErr(t('form.testFail', { error: (r && r.error) || '?' }))
        refresh()
      })
      .catch((e) => setErr(t('form.testFail', { error: String((e && e.message) || e) })))
      .finally(() => setBusyId(''))
  }

  const removeMachine = (m) => {
    setConfirmDel(m)
  }

  const importable = sshEntries || []
  React.useEffect(() => {
    remoteApi.sshConfig()
      .then((r) => setSshEntries((r && r.entries) || []))
      .catch(() => setSshEntries([]))
  }, [])

  const addForward = () => {
    const listen = Number(fwdForm.listenPort) || 0
    const target = Number(fwdForm.targetPort) || listen
    if (!listen) return
    run(() => remoteApi.forwardAction({
      action: 'define', direction: fwdForm.direction,
      listenPort: listen, targetHost: fwdForm.targetHost || '127.0.0.1',
      targetPort: target, autoStart: fwdForm.autoStart,
    })).then(() => setFwdForm(EMPTY_FORWARD))
  }

  const current = machines.find((m) => m.id === currentId) || null

  return (
    <div className="dshr-page">
      <div className="dshr-caption">{t('settings.summary')}</div>

      {loading ? <div role="status" className="dshr-caption">{t('settings.loading')}</div> : null}
      {loadError ? <div role="alert" className="dshr-error">
        <p>{t('settings.loadFailed', { error: loadError })}</p>
        <Button size="sm" variant="ghost" onClick={refresh}>{t('settings.retry')}</Button>
      </div> : null}

      {err ? <div className="dshr-error">{err}</div> : null}
      {msg ? <div className="dshr-ok">{msg}</div> : null}

      <div className="dshr-card">
        <div className="dshr-cardTitle">
          <StateDot state={status && status.connected ? 'done' : 'idle'} />
          {t('settings.active')}
          <span className="dshr-muted dshr-ellipsis">{current ? (current.name || current.host) : t('settings.none')}</span>
        </div>
        {status ? (
          <div className="dshr-col">
            <div className="dshr-row dshr-secondary" style={{ fontSize: 12 }}>
              <span>{status.connected ? t('settings.connected') : t('settings.disconnected')}</span>
              {status.host ? <span className="dshr-mono">{status.username}@{status.host}:{status.port}</span> : null}
              {status.connected ? (status.hostKeyKnown ? <span>{t('settings.hostKeyKnown')}</span> : <span>{t('settings.hostKeyNew')}</span>) : null}
            </div>
            {status.workspace ? (
              <div className="dshr-col" style={{ fontSize: 12 }}>
                <span className="dshr-muted">{t('settings.workspace')}: <span className="dshr-mono">{status.workspace}</span></span>
                {status.localMirror ? <span className="dshr-muted">{t('settings.mirror')}: <span className="dshr-mono">{status.localMirror}</span></span> : null}
              </div>
            ) : null}
            {currentId ? (
              <div className="dshr-row">
                <Button variant="ghost" size="sm" onClick={() => setCurrent('')} disabled={busyId === 'clear'}>
                  {t('settings.clearCurrent')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => run(() => remoteApi.forgetKey())}>
                  {t('settings.forgetKey')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="dshr-card">
        <div className="dshr-rowBetween">
          <div className="dshr-cardTitle">{t('machines.title')}</div>
          <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setFormOpen((v) => !v) }}>
            {t('machines.add')}
          </Button>
        </div>
        {formOpen || editing ? (
          <MachineForm
            t={t}
            machine={editing}
            onSaved={() => { setFormOpen(false); setEditing(null); refresh() }}
            onCancel={() => { setFormOpen(false); setEditing(null) }}
          />
        ) : null}
        {!loading && !loadError && !formOpen && !editing && machines.length === 0 ? (
          <div className="dshr-emptyState">
            <span>{t('machines.empty')}</span>
            <span className="dshr-caption">{t('machines.emptyHint')}</span>
          </div>
        ) : null}
        <div className="dshr-machineList">
          {machines.map((m) => (
            <div key={m.id} className="dshr-machine" data-current={m.id === currentId}>
              <div className="dshr-machineMeta">
                <div className="dshr-row">
                  <span className="dshr-machineName dshr-ellipsis">{m.name || m.host}</span>
                  {m.id === currentId ? <Tag tone="outline">{t('machines.current')}</Tag> : null}
                  {m.passwordSet ? <span className="dshr-caption">{t('machines.passwordSet')}</span> : null}
                </div>
                <div className="dshr-machineSub">
                  <span className="dshr-mono">{m.username}@{m.host}:{m.port}</span>
                  {m.workspace ? <span className="dshr-mono dshr-ellipsis">{m.workspace}</span> : null}
                  {m.latencyMs ? <span>{t('settings.latency', { ms: String(m.latencyMs) })}</span> : null}
                  {m.lastConnectedAt ? <span>{t('settings.lastConnected', { time: String(m.lastConnectedAt).replace('T', ' ').slice(0, 16) })}</span> : null}
                </div>
              </div>
              <div className="dshr-row" style={{ flexShrink: 0 }}>
                {m.id !== currentId ? (
                  <Button variant="ghost" size="sm" onClick={() => setCurrent(m.id)} disabled={busyId === m.id}>
                    {t('machines.setCurrent')}
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => testMachine(m)} disabled={busyId === 'test:' + m.id}>
                  {busyId === 'test:' + m.id ? t('machines.testing') : t('machines.test')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(m); setFormOpen(false) }}>
                  {t('machines.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => removeMachine(m)} disabled={busyId === 'del:' + m.id}>
                  {t('machines.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {importable.length > 0 ? (
        <div className="dshr-card">
          <div className="dshr-cardTitle">{t('sshconfig.title')}</div>
          <div className="dshr-caption">{t('sshconfig.hint', { count: String(importable.length) })}</div>
          <div className="dshr-machineList">
            {importable.map((e, i) => (
              <div key={i} className="dshr-rowBetween">
                <span className="dshr-mono dshr-secondary" style={{ fontSize: 12 }}>{e.host}{e.user ? ` (${e.user}@${e.hostName || e.host}${e.port && e.port !== 22 ? ':' + e.port : ''})` : ''}</span>
                <Button variant="ghost" size="sm" onClick={() => {
                  setEditing({
                    name: e.host, host: e.hostName || e.host, port: e.port || 22,
                    username: e.user || 'root', privateKeyPath: e.identityFile || '',
                    proxy: e.proxyJump ? { host: e.proxyJump } : undefined,
                  })
                  setFormOpen(false)
                }}>{t('sshconfig.import')}</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dshr-card">
        <div className="dshr-cardTitle">{t('forwards.title')}</div>
        {!currentId ? <div className="dshr-caption">{t('forwards.needsMachine')}</div> : (
          <React.Fragment>
            {forwards.length === 0 ? <div className="dshr-caption">{t('forwards.empty')}</div> : (
              <div className="dshr-machineList">
                {forwards.map((f) => (
                  <div key={f.id} className="dshr-rowBetween">
                    <span className="dshr-mono dshr-secondary" style={{ fontSize: 12 }}>
                      {f.direction === 'reverse' ? 'R' : 'L'} :{f.listenPort} → {f.targetHost}:{f.targetPort}
                    </span>
                    <div className="dshr-row">
                      <Tag tone="outline">{f.running ? t('forwards.running') : t('forwards.stopped')}</Tag>
                      <Button variant="ghost" size="sm" onClick={() => run(() => remoteApi.forwardAction({ action: f.running ? 'stop' : 'start', id: f.id }))}>
                        {f.running ? t('forwards.stop') : t('forwards.start')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => run(() => remoteApi.forwardAction({ action: 'remove', id: f.id }))}>
                        {t('forwards.remove')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="dshr-row" style={{ flexWrap: 'wrap' }}>
              <SettingsSelect
                variant="inline" value={fwdForm.direction}
                options={[
                  { id: 'local', label: t('forwards.directionLocal') },
                  { id: 'reverse', label: t('forwards.directionReverse') },
                ]}
                onChange={(id) => setFwdForm((f) => ({ ...f, direction: id }))}
                aria-label={t('forwards.title')}
              />
              <Input value={fwdForm.listenPort} onChange={(e) => setFwdForm((f) => ({ ...f, listenPort: e.target.value }))}
                placeholder={t('forwards.listenPort')} inputMode="numeric" style={{ width: 90 }} />
              <Input value={fwdForm.targetHost} onChange={(e) => setFwdForm((f) => ({ ...f, targetHost: e.target.value }))}
                placeholder={t('forwards.targetHost')} style={{ width: 130 }} />
              <Input value={fwdForm.targetPort} onChange={(e) => setFwdForm((f) => ({ ...f, targetPort: e.target.value }))}
                placeholder={t('forwards.targetPort')} inputMode="numeric" style={{ width: 90 }} />
              <Checkbox checked={fwdForm.autoStart} onChange={(v) => setFwdForm((f) => ({ ...f, autoStart: v }))} label={t('forwards.autoStart')} />
              <Button variant="ghost" size="sm" onClick={addForward} disabled={!fwdForm.listenPort}>
                {t('forwards.add')}
              </Button>
            </div>
          </React.Fragment>
        )}
      </div>

      <div className="dshr-card">
        <div className="dshr-rowBetween">
          <div className="dshr-cardTitle">{t('audit.title')}</div>
          <Button variant="ghost" size="sm" onClick={() => {
            if (audit) { setAudit(null); return }
            remoteApi.audit(100)
              .then((r) => setAudit(r))
              .catch((e) => setErr(String((e && e.message) || e)))
          }}>
            {audit ? t('audit.hide') : t('audit.show')}
          </Button>
        </div>
        {audit ? (
          audit.auditEnabled === false
            ? <div className="dshr-caption">{t('audit.disabled')}</div>
            : (audit.lines && audit.lines.length
                ? <div className="dshr-audit">{audit.lines.join('\n')}</div>
                : <div className="dshr-caption">{t('audit.empty')}</div>)
        ) : null}
      </div>
    </div>
  )
}
