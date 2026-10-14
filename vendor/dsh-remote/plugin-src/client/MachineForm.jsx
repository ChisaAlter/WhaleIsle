import * as React from 'react'
import { Button, Checkbox, Input, SettingsSelect, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { remoteApi } from './api.js'
import { RemoteFeedback } from './Feedback.jsx'

const EMPTY_FORM = {
  name: '', host: '', port: '22', username: 'root',
  password: '', privateKeyPath: '', passphrase: '',
  workspace: '', hostKeyMode: '', useAgent: false, keyboardInteractive: false,
  encryptPassword: false,
  proxyHost: '', proxyPort: '22', proxyUser: '', proxyPassword: '', proxyKey: '',
  id: '',
}

function formFromMachine(m) {
  return {
    ...EMPTY_FORM,
    id: m.id || '',
    name: m.name || '',
    host: m.host || '',
    port: String(m.port || 22),
    username: m.username || 'root',
    password: '',
    privateKeyPath: m.privateKeyPath || '',
    passphrase: m.passphrase || '',
    workspace: m.workspace || '',
    hostKeyMode: m.hostKeyMode || '',
    useAgent: !!m.useAgent,
    keyboardInteractive: !!m.keyboardInteractive,
    encryptPassword: m.credentialBackend && m.credentialBackend !== 'plain',
    proxyHost: (m.proxy && m.proxy.host) || '',
    proxyPort: String((m.proxy && m.proxy.port) || 22),
    proxyUser: (m.proxy && m.proxy.username) || '',
    proxyPassword: '',
    proxyKey: (m.proxy && m.proxy.privateKeyPath) || '',
  }
}

function payloadOf(f) {
  return {
    action: f.id ? 'update' : 'add',
    id: f.id || undefined,
    name: f.name, host: f.host.trim(), port: Number(f.port) || 22, username: f.username.trim() || 'root',
    password: f.password || undefined,
    privateKeyPath: f.privateKeyPath, passphrase: f.passphrase,
    workspace: f.workspace, hostKeyMode: f.hostKeyMode || undefined,
    useAgent: f.useAgent, keyboardInteractive: f.keyboardInteractive,
    encryptPassword: f.encryptPassword,
    proxy: f.proxyHost.trim() ? {
      host: f.proxyHost.trim(), port: Number(f.proxyPort) || 22,
      username: f.proxyUser, password: f.proxyPassword,
      privateKeyPath: f.proxyKey,
    } : undefined,
  }
}

function testPayloadOf(f) {
  return {
    machineId: f.id || undefined,
    host: f.host.trim(), port: Number(f.port) || 22, username: f.username.trim() || 'root',
    password: f.password, privateKeyPath: f.privateKeyPath, passphrase: f.passphrase,
    hostKeyMode: f.hostKeyMode || undefined,
    useAgent: f.useAgent, keyboardInteractive: f.keyboardInteractive,
    proxy: f.proxyHost.trim() ? {
      host: f.proxyHost.trim(), port: Number(f.proxyPort) || 22,
      username: f.proxyUser, password: f.proxyPassword, privateKeyPath: f.proxyKey,
    } : undefined,
  }
}

/**
 * Add/edit machine form used by the settings section. `machine` selects the
 * edit source (undefined = add); secrets never come back from the host, so
 * password fields stay blank and only overwrite when typed.
 */
export function MachineForm({ t, machine, onSaved, onCancel }) {
  const editing = machine || null
  const [form, setForm] = React.useState(() => editing ? formFromMachine(editing) : EMPTY_FORM)
  const [busy, setBusy] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [notice, setNotice] = React.useState(null) // { kind: 'ok'|'err', text }
  const set = (key) => (e) => {
    const value = e && e.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
  }

  const hostKeyOptions = [
    { id: '', label: t('form.hostKeyAcceptNew') },
    { id: 'verify', label: t('form.hostKeyVerify') },
    { id: 'off', label: t('form.hostKeyOff') },
  ]

  const save = () => {
    if (busy) return
    setBusy(true); setNotice(null)
    remoteApi.saveMachine(payloadOf(form))
      .then((r) => {
        onSaved && onSaved(r)
      })
      .catch((e) => setNotice({ kind: 'err', text: String((e && e.message) || e) }))
      .finally(() => setBusy(false))
  }

  const test = () => {
    if (testing) return
    setTesting(true); setNotice(null)
    remoteApi.testConnect(testPayloadOf(form))
      .then((r) => {
        if (r && r.ok) setNotice({ kind: 'ok', text: t('form.testOk', { ms: String(r.latencyMs ?? '?'), platform: r.platform || '?' }) })
        else setNotice({ kind: 'err', text: t('form.testFail', { error: (r && r.error) || '?' }) })
      })
      .catch((e) => setNotice({ kind: 'err', text: t('form.testFail', { error: String((e && e.message) || e) }) }))
      .finally(() => setTesting(false))
  }

  const field = (label, node) => (
    <React.Fragment>
      <div className="dshr-formLabel">{label}</div>
      <div className="dshr-row">{node}</div>
    </React.Fragment>
  )

  return (
    <div className="dshr-col">
      <div className="dshr-cardTitle">{editing ? t('form.titleEdit') : t('form.titleAdd')}</div>
      <div className="dshr-form">
        {field(t('form.name'), <Input value={form.name} onChange={set('name')} placeholder={t('form.namePlaceholder')} className="dshr-grow" />)}
        {field(t('form.host'), <Input value={form.host} onChange={set('host')} placeholder={t('form.hostPlaceholder')} className="dshr-grow" />)}
        {field(t('form.port'), <Input value={form.port} onChange={set('port')} inputMode="numeric" className="dshr-grow" />)}
        {field(t('form.username'), <Input value={form.username} onChange={set('username')} className="dshr-grow" />)}
        <div className="dshr-formFull dshr-cardTitle" style={{ marginTop: 4 }}>{t('form.auth')}</div>
        {field(t('form.password'), (
          <Input type="password" value={form.password} onChange={set('password')}
            placeholder={editing && editing.passwordSet ? t('form.passwordKeep') : t('form.passwordPlaceholder')}
            className="dshr-grow" />
        ))}
        {field(t('form.privateKeyPath'), <Input value={form.privateKeyPath} onChange={set('privateKeyPath')} placeholder={t('form.privateKeyPlaceholder')} className="dshr-grow" />)}
        {field(t('form.passphrase'), <Input type="password" value={form.passphrase} onChange={set('passphrase')} placeholder={t('form.passphrasePlaceholder')} className="dshr-grow" />)}
        {field(t('form.hostKeyMode'), (
          <SettingsSelect variant="block" value={form.hostKeyMode} options={hostKeyOptions}
            onChange={(id) => setForm((f) => ({ ...f, hostKeyMode: id }))} aria-label={t('form.hostKeyMode')} className="dshr-grow" />
        ))}
        {field(t('form.workspace'), <Input value={form.workspace} onChange={set('workspace')} placeholder={t('form.workspacePlaceholder')} className="dshr-grow" />)}
        <div className="dshr-formFull dshr-col">
          <div className="dshr-checkRow">
            <Checkbox checked={form.useAgent} onChange={(v) => setForm((f) => ({ ...f, useAgent: v }))} label={t('form.useAgent')} />
          </div>
          <div className="dshr-checkRow">
            <Checkbox checked={form.keyboardInteractive} onChange={(v) => setForm((f) => ({ ...f, keyboardInteractive: v }))} label={t('form.keyboardInteractive')} />
          </div>
          <div className="dshr-checkRow">
            <Switch checked={form.encryptPassword} onChange={(v) => setForm((f) => ({ ...f, encryptPassword: v }))} label={t('form.encryptPassword')} />
            <span>{t('form.encryptPassword')}</span>
          </div>
        </div>
        <div className="dshr-formFull">
          <div className="dshr-cardTitle">{t('form.proxy')}</div>
          <div className="dshr-form" style={{ marginTop: 8 }}>
            {field(t('form.proxyHost'), <Input value={form.proxyHost} onChange={set('proxyHost')} className="dshr-grow" />)}
            {field(t('form.proxyPort'), <Input value={form.proxyPort} onChange={set('proxyPort')} inputMode="numeric" className="dshr-grow" />)}
            {field(t('form.proxyUser'), <Input value={form.proxyUser} onChange={set('proxyUser')} className="dshr-grow" />)}
            {field(t('form.proxyPassword'), <Input type="password" value={form.proxyPassword} onChange={set('proxyPassword')} className="dshr-grow" />)}
            {field(t('form.proxyKey'), <Input value={form.proxyKey} onChange={set('proxyKey')} className="dshr-grow" />)}
          </div>
        </div>
      </div>
      <RemoteFeedback error={notice && notice.kind === 'err' ? notice.text : ''} message={notice && notice.kind === 'ok' ? notice.text : ''} onClearMessage={() => setNotice(null)} t={t} />
      <div className="dshr-row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onClick={test} disabled={busy || testing || !form.host.trim()} loading={testing}>
          {t('machines.test')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy || testing}>{t('form.cancel')}</Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy || testing || !form.host.trim()} loading={busy}>
          {t('form.save')}
        </Button>
      </div>
    </div>
  )
}
