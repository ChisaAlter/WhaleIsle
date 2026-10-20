import {
  createLibrary as coreCreateLibrary,
  defineComponent as coreDefineComponent,
  type DefinedComponent as CoreDefinedComponent,
  type Library as CoreLibrary,
  type LibraryDefinition as CoreLibraryDefinition,
  type LibraryExtension as CoreLibraryExtension,
  type ComponentRenderProps as CoreRenderProps,
  type DefinedAction,
} from "../language";
import type { ReactNode } from "react";
import type { z } from "zod/v4";
import type { $ZodObject } from "zod/v4/core";

// Re-export framework-agnostic types unchanged
export type {
  ComponentGroup,
  LibraryJSONSchema,
  PromptOptions,
  SubComponentOf,
  ToolDescriptor,
} from "../language";

// ─── React-specific types ───────────────────────────────────────────────────

export interface ComponentRenderProps<P = Record<string, unknown>> extends CoreRenderProps<
  P,
  ReactNode
> {}

export type ComponentRenderer<P = Record<string, unknown>> = React.FC<ComponentRenderProps<P>>;

export type DefinedComponent<T extends $ZodObject = $ZodObject> = CoreDefinedComponent<
  T,
  ComponentRenderer<z.infer<T>>
>;

type AnyAction = DefinedAction<any, string>;

export type Library<A extends AnyAction = AnyAction> = CoreLibrary<ComponentRenderer<any>, A>;

export type LibraryDefinition<A extends AnyAction = AnyAction> = CoreLibraryDefinition<
  ComponentRenderer<any>,
  A
>;

export type LibraryExtension<A extends AnyAction = AnyAction> = CoreLibraryExtension<
  ComponentRenderer<any>,
  A
>;

// ─── defineComponent (React) ────────────────────────────────────────────────

export function defineComponent<T extends $ZodObject>(config: {
  name: string;
  props: T;
  description: string;
  component: ComponentRenderer<z.infer<T>>;
}): DefinedComponent<T> {
  return coreDefineComponent<T, ComponentRenderer<z.infer<T>>>(config);
}

// ─── createLibrary (React) ──────────────────────────────────────────────────

export function createLibrary<A extends AnyAction = never>(
  input: LibraryDefinition<A>,
): Required<Library<A>> {
  return coreCreateLibrary<ComponentRenderer<any>, A>(input);
}
