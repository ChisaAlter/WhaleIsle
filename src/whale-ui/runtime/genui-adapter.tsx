import { useCallback, useContext, useEffect } from 'react';
import { z } from 'zod/v4';
import { defineComponent, useComponentIdentity, useComponentState, useIsStreaming, useTriggerAction } from '../react/index.ts';
import { ExportableGenuiBlock, COMPONENT_SCHEMAS, GENUI_NATIVE_TYPES, processGenuiSpec, resolveFence, type BlockInteractionState, type GenuiActionHandler, type GenuiSpec } from '../genui/embed.ts';
import type { Diagnostic, SourceLanguage } from '../viewer/protocol.ts';
import { specialized } from './genui-definitions.ts';
import { RenderDiagnosticsContext } from './render-diagnostics.ts';
import type { GenuiRenderDiagnosticsSnapshot } from '../genui/client/render-diagnostics.tsx';

const EMPTY_GENUI_STATE: BlockInteractionState = {};
function GenuiContent({ spec, identity }: { spec: GenuiSpec; identity: string }) {
  const [state, setState] = useComponentState<BlockInteractionState>(`genui:${identity}`, EMPTY_GENUI_STATE);
  const streaming = useIsStreaming();
  const owner = useContext(RenderDiagnosticsContext);
  const componentIdentity = useComponentIdentity();
  const onDiagnostics = useCallback((snapshot: GenuiRenderDiagnosticsSnapshot) => {
    owner?.report(componentIdentity, snapshot.sourceId, snapshot.diagnostics.map(diagnostic => ({ phase: 'render', code: diagnostic.code, path: diagnostic.path, message: diagnostic.message })));
  }, [owner, componentIdentity]);
  useEffect(() => () => owner?.report(componentIdentity, owner.sourceId, []), [owner, componentIdentity]);
  const trigger = useTriggerAction();
  const act = useCallback<GenuiActionHandler>(async (action, payload) => {
    try {
      await trigger(action, undefined, { type: 'continue_conversation', params: { context: { action, ...payload } } });
      return { status: 'queued' };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  }, [trigger]);
  const update = useCallback((value: BlockInteractionState) => { setState(value); }, [setState]);
  return <ExportableGenuiBlock spec={spec} stateKey={identity} animateEntrance={streaming} exportEnabled={!streaming}
    initialState={state} onStateChange={update} onAction={streaming ? undefined : act}
    diagnosticSourceId={owner?.sourceId ?? JSON.stringify(spec)} onRenderDiagnostics={onDiagnostics} />;
}

const specValue = z.record(z.string(), z.unknown());
const Genui = defineComponent({
  name: 'Genui',
  props: z.object({ spec: specValue }),
  description: 'Render an existing declarative GenUI specification with the shared Whale UI state and action host.',
  component: ({ props, statementId }) => {
    const result = processGenuiSpec(props.spec);
    if (!result.spec || result.errors.length) throw new Error(result.errors.join('\n') || 'The GenUI specification is invalid.');
    return <GenuiContent spec={result.spec} identity={statementId ?? 'genui'} />;
  },
});

/** Specialized families use the same component registry, store and awaited action executor. */
export const genuiComponents = [Genui, ...specialized.map(([name, type, description]) => defineComponent({
  name,
  props: z.object({ options: specValue }),
  description: `${description} Pass the options object from the ${type} component schema.`,
  component: ({ props, statementId }) => {
    const result = processGenuiSpec({ items: [{ ...props.options, type }] });
    if (!result.spec || result.errors.length) throw new Error(result.errors.join('\n') || `${name} options are invalid.`);
    return <GenuiContent spec={result.spec} identity={statementId ?? name} />;
  },
}))];

export type CompiledDocument = { program: string; diagnostics: Diagnostic[]; complete: boolean; panel?: { spec: GenuiSpec; append: boolean } };

/** Both historical JSON and the primary language enter one renderer and one state owner. */
export function compileDocument(program: string, language: SourceLanguage, streaming: boolean): CompiledDocument {
  if (language !== 'dsh-ui' && !(language === 'whale-ui' && program.trimStart().startsWith('{'))) return { program, diagnostics: [], complete: true };
  const result = resolveFence(program, { settled: !streaming });
  const diagnostics: Diagnostic[] = result.errors.map(message => ({ phase: 'parse', code: 'genui-invalid', message }));
  if (!result.spec) return { program: 'root = Col([])', diagnostics, complete: false };
  const spec = { ...result.spec, panel: undefined, append: undefined };
  return {
    program: `root = Col([genui])\ngenui = Genui(${JSON.stringify(spec)})`,
    diagnostics,
    complete: result.complete,
    ...(result.spec.panel === true ? { panel: { spec, append: result.spec.append === true } } : {}),
  };
}

/** The model guide and typed adapters read this same runtime metadata. */
export const genuiSchema = Object.fromEntries(Object.entries(COMPONENT_SCHEMAS).filter(([name]) => GENUI_NATIVE_TYPES.has(name)));
