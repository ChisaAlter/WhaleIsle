declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ReactNode } from 'react'

  export function Button(props: {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string
    loading?: boolean
    feedback?: string
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element

  export interface MenuItem {
    id: string
    label: ReactNode
    disabled?: boolean
  }

  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items: readonly MenuItem[]
    onSelect: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    portal?: boolean
  }): JSX.Element

  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: ReactNode
    closeLabel?: string
    description?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    headless?: boolean
  }): JSX.Element

  export function Switch(props: import('react').InputHTMLAttributes<HTMLInputElement>): JSX.Element

  export function Toast(props: {
    text: string
    icon?: ReactNode
    tone?: 'success'
    anchor?: HTMLElement | null
    holdMs?: number | null
    dismissLabel?: string
    actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
    onDone: () => void
  }): JSX.Element
}
