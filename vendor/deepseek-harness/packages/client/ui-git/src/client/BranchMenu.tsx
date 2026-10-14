/**
 * Titlebar branch picker: the same Menu atom as the commit/push chevron,
 * with the Menu filter and a create footer.
 * @module @deepseek-ai/dsh-client-ui-git/client/BranchMenu
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  FlipText,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconPlusOutline16,
  Menu,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { GitResult } from './git-logic.ts'
import {
  dedupeRemoteBranchesWithLocalMatches,
  orderBranchRefs,
  shouldIncludeBranchPickerItem,
  type BranchRef,
} from './branches.ts'
import { CreateBranchDialog } from './CreateBranchDialog.tsx'
import css from './BranchMenu.module.css'

/** Branch methods the picker needs from the desktop shell. */
export interface BranchMenuOps {
  gitBranchList: (cwd: string) => Promise<{ ok: boolean; message?: string; branches?: BranchRef[] }>
  gitSwitchBranch: (cwd: string, ref: string) => Promise<GitResult & { refName?: string }>
  gitCreateBranch: (cwd: string, name: string) => Promise<GitResult & { refName?: string }>
}

/** Full props of the branch picker. */
export interface BranchMenuProps extends BranchMenuOps {
  /** Workspace directory the titlebar Git cluster resolved. */
  cwd: string | undefined
  /** Current ref name from the status snapshot, for the trigger label. */
  currentRef: string | null
  /** Locale function from the git namespace. */
  t: PropsLocale<typeof NS>['t']
  /** Notify the parent to refresh status after a switch/create. */
  onChanged: () => void
  /** Surface switch/create/list failures on the Git progress toast. */
  onError: (message: string, title: string) => void
  /** True while a stacked Git action holds the titlebar. */
  disabled?: boolean
  /** Hide the ref name; keep the branch icon and chevron. */
  compact?: boolean
}

const CREATE_ID = '__create__'

/**
 * Render the branch trigger and the shared Menu (filter + branch rows + create).
 * @param props - shell ops, cwd, current ref, copy, and change callback.
 * @returns the picker, or nothing outside a repository.
 */
export function BranchMenu({ cwd, currentRef, t, onChanged, onError, disabled = false, compact = false, gitBranchList, gitSwitchBranch, gitCreateBranch }: BranchMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [refs, setRefs] = useState<BranchRef[] | null>(null)
  /** Last list failure detail; `null` means the list loaded (or is loading). */
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [listing, setListing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setCreateOpen(false)
    }
  }, [disabled])

  // A workspace change invalidates the cached rows; the next open must not
  // flash the previous repository's branches.
  useEffect(() => {
    setRefs(null)
    setListError(null)
  }, [cwd])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setListing(false)
      return
    }
    let cancelled = false
    if (cwd === undefined) return
    setListError(null)
    setListing(true)
    void gitBranchList(cwd).then((result) => {
      if (cancelled) return
      setListing(false)
      if (result.ok) {
        setRefs(result.branches ?? [])
        return
      }
      setRefs(null)
      setListError(result.message?.trim() ?? '')
      onError(result.message?.trim() || t('branch.listFailed'), t('branch.listFailed'))
    }).catch((error: unknown) => {
      if (cancelled) return
      setRefs(null)
      setListError(error instanceof Error ? error.message.trim() : '')
      setListing(false)
      onError(error instanceof Error && error.message.trim() !== '' ? error.message : t('branch.listFailed'), t('branch.listFailed'))
    })
    return () => { cancelled = true }
  }, [open, cwd, gitBranchList])

  const normalizedQuery = query.trim().toLowerCase()
  const trimmedQuery = query.trim()
  const localNames = new Set((refs ?? []).filter(ref => !ref.isRemote).map(ref => ref.name))
  const canCreate = trimmedQuery.length > 0 && !localNames.has(trimmedQuery)
  const createValue = canCreate ? `${CREATE_ID}:${trimmedQuery}` : null

  const rows = orderBranchRefs(dedupeRemoteBranchesWithLocalMatches(refs ?? []))
    .filter(ref => shouldIncludeBranchPickerItem({
      itemValue: ref.name,
      normalizedQuery,
      createBranchItemValue: createValue,
    }))

  const runAction = (failTitle: string, action: () => Promise<void>): void => {
    if (disabled || busy || cwd === undefined) return
    setBusy(true)
    void action().catch((error: unknown) => {
      // A rejected switch/create IPC promise surfaces on the Git toast like
      // an ok:false result instead of dying as an unhandled rejection.
      onError(error instanceof Error && error.message.trim() !== '' ? error.message : t('branch.error'), failTitle)
    }).finally(() => {
      setBusy(false)
      onChanged()
    })
  }

  const onSwitch = (name: string): void => {
    if (cwd === undefined) return
    runAction(t('branch.switchFailed'), async () => {
      const result = await gitSwitchBranch(cwd, name)
      if (!result.ok) onError(result.message ?? t('branch.error'), t('branch.switchFailed'))
    })
  }

  const onCreate = (name: string): void => {
    const trimmed = name.trim()
    if (cwd === undefined || trimmed.length === 0 || localNames.has(trimmed)) return
    setCreateOpen(false)
    setCreateName('')
    runAction(t('branch.createFailed'), async () => {
      const result = await gitCreateBranch(cwd, trimmed)
      if (!result.ok) onError(result.message ?? t('branch.error'), t('branch.createFailed'))
    })
  }

  const label = currentRef ?? t('branch.select')
  // A failed list reports through the progress toast and never masquerades
  // as the "no matching branches" empty state.
  const items = listError !== null
    ? []
    : rows.length === 0 && refs !== null
      ? [{ type: 'label' as const, id: 'empty', text: t('branch.empty') }]
      : rows.map(ref => ({
        id: ref.name,
        label: ref.name,
        disabled: disabled || busy || ref.isCurrent || ref.switchable === false,
        // Desktop-unsupported name: the row stays listed (the branch exists)
        // but cannot be switched to, and the hint says why.
        ...(ref.switchable === false ? { hint: t('branch.unsupportedName') } : {}),
      }))

  return (
    <>
      <Menu
        open={open}
        portal
        selectedId={currentRef ?? undefined}
        filter={{
          value: query,
          placeholder: t('branch.search'),
          label: t('branch.search'),
          onChange: setQuery,
        }}
        items={items}
        footer={[{
          id: CREATE_ID,
          label: canCreate ? t('branch.createNamed', { name: trimmedQuery }) : t('branch.createHint'),
          icon: <IconPlusOutline16 size={16} />,
          disabled: disabled || busy || (trimmedQuery.length > 0 && !canCreate),
        }]}
        onSelect={(id) => {
          if (disabled) return
          if (id === CREATE_ID) {
            setOpen(false)
            setCreateName(trimmedQuery)
            setCreateOpen(true)
            return
          }
          setOpen(false)
          onSwitch(id)
        }}
        onClose={() => { setOpen(false) }}
        anchor={(
          <button
            type="button"
            className={clsx(css.trigger, compact && css.triggerCompact)}
            aria-label={t('branch.open')}
            aria-expanded={open}
            disabled={disabled || busy || cwd === undefined}
            aria-busy={busy || listing}
            onClick={() => { setOpen(next => !next) }}
          >
            {busy || listing ? <StateDot state="ongoing" size={14} /> : <IconBranchOutline16 size={14} />}
            {compact ? null : <FlipText text={label} className={css.name} />}
            <IconChevronDownOutline14 size={14} />
          </button>
        )}
      />

      <CreateBranchDialog
        open={createOpen}
        name={createName}
        taken={localNames.has(createName.trim())}
        t={t}
        onClose={() => { setCreateOpen(false) }}
        onName={setCreateName}
        onSubmit={() => { onCreate(createName) }}
      />
    </>
  )
}
