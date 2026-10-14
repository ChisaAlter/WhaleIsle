/** The fork action: one `sidebar.workspaces.session.menu.item` row. */
import { IconBranchOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ForkSessionInjected, SessionMenuItemProps } from '../contract/slots.ts'

/**
 * Menu row (order 300): fork at the Session's last completed turn; the child
 * arrives through the Host list beside its source.
 * @param props - owner share, menu open state, and the fork share.
 * @returns the row.
 */
export function ForkSessionMenuItem({
  sessionId, useMenuOpenState, useShortcuts, useSessions, forkSession, t,
}: SessionMenuItemProps<ForkSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'session.fork'))
  const owned = useSessions(list => list.byId[sessionId]?.presentation?.owner === 'project')
  if (owned) return null
  return (
    <MenuItemButton
      shortcut={shortcut}
      icon={<IconBranchOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        forkSession(sessionId)
      }}
    >
      {t('menu.fork')}
    </MenuItemButton>
  )
}
