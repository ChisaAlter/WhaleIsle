import { createContext, createElement, useContext, type MouseEvent, type ReactNode } from 'react'
import css from './GenuiBlock.module.css'

/** The embedding host binds this opener to the document's owning session. */
export type GenuiFileOpener = (path: string, line?: number) => void | Promise<unknown>
export const GenuiFileLinkContext = createContext<GenuiFileOpener | undefined>(undefined)

export function FileLink({ path, line, label, children }: { path: string; line?: number; label: string; children?: ReactNode }) {
  const open = useContext(GenuiFileLinkContext)
  if (open === undefined) return createElement('span', { title: path }, children)
  return createElement('button', {
    type: 'button', className: css.inlineFileLink, title: path, 'aria-label': `${label} (${path})`,
    onClick: (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); void open(path, line) },
  }, children)
}
