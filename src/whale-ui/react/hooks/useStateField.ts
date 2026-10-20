import { isReactiveAssign, resolveStateField, type InferStateFieldValue, type StateField } from "../../language";
import { useEffect } from "react";
import { useComponentIdentity, useFormName, useOpenUI } from "../context";

export function useStateField<T = unknown>(name: string, value?: T): StateField<InferStateFieldValue<T>> {
  const ctx = useOpenUI();
  const formName = useFormName();
  const identity = useComponentIdentity();
  const fieldKey = `${identity}/${name}`;
  const target = isReactiveAssign(value) ? value.target : undefined;
  useEffect(() => ctx.registerField(formName, identity, name, target, value), [ctx.registerField, formName, identity, name, target, value]);
  return resolveStateField<InferStateFieldValue<T>>(
    fieldKey, value, ctx.store, ctx.evaluationContext,
    (key) => {
      const scoped = ctx.getFieldValue(formName, key);
      if (scoped !== undefined) return scoped;
      // Historical form fields used their declared name. Boundary migration explicitly marks
      // those records; never infer wrappers from a business object's `value` property.
      const container = formName ? ctx.store.get(formName) : ctx.store.getSnapshot();
      const historical = container && typeof container === "object" ? (container as Record<string, unknown>)[name] : undefined;
      if (historical && typeof historical === "object" && (historical as { __whaleField?: number }).__whaleField === 1) return ctx.getFieldValue(formName, name);
      return undefined;
    },
    (key, next) => ctx.setFieldValue(formName, undefined, key, next),
  );
}
