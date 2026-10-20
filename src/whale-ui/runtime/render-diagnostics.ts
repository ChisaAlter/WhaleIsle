import { createContext } from 'react';
import type { Diagnostic } from '../viewer/protocol.ts';

/** Renderers report active asynchronous faults to their current document source. */
export type RenderDiagnosticsOwner = {
  sourceId: string;
  report(owner: string, sourceId: string, diagnostics: Diagnostic[]): void;
};
export const RenderDiagnosticsContext = createContext<RenderDiagnosticsOwner | null>(null);
