/**
 * Evaluate-tree: entry point for evaluating ElementNode prop trees.
 *
 * Delegates to the evaluator's schema-aware evaluation when schema context
 * is available. This ensures reactive schemas, ActionPlan preservation,
 * Each loop variable substitution, and ternary resolution all happen in
 * a single unified pass.
 */

import { assertValueBudget, createBudget, DEFAULT_LIMITS, RuntimeBudgetError, type Budget } from "./budget";
import { compileSchema } from "../parser/parser";
import { INVALID, resolveInvalidValue, validateSchemaValue } from "../parser/validation";
import { isActionPlan, isReactiveAssign } from "./evaluator";
import { isReactiveSchema } from "../reactive";
import type { Library } from "../library";
import {
  isElementNode,
  type ElementNode,
  type OpenUIError,
  type ParseResult,
} from "../parser/types";
import { evaluatePropCore } from "./evaluate-prop";
import { evaluate, type EvaluationContext, type SchemaContext } from "./evaluator";
import type { Store } from "./store";

/** Context passed through the evaluation chain — no module-level state. */
export interface EvalContext {
  /** AST evaluation context (getState, resolveRef) */
  ctx: EvaluationContext;
  /** Component library for reactive schema lookup */
  library: Library;
  /** Reactive binding store (null in v1 mode) */
  store: Store | null;
  /** Runtime errors collected during prop evaluation (optional — populated by evaluateElementProps). */
  errors?: OpenUIError[];
  renderBudget?: Budget;
}

/**
 * Evaluate all AST nodes in an ElementNode tree's props.
 * Returns a new ElementNode with all props resolved to concrete values.
 *
 * Uses the unified evaluator with schema context for reactive-aware evaluation.
 */
export function evaluateElementProps(el: ElementNode, evalCtx: EvalContext): ElementNode {
  const leave = evalCtx.renderBudget?.enter(el.statementId ?? el.typeName);
  try { return evaluateElementBody(el, evalCtx); } finally { leave?.(); }
}

const compiled = new WeakMap<object, ReturnType<typeof compileSchema>>();
function evaluateElementBody(el: ElementNode, evalCtx: EvalContext): ElementNode {
  if (el.hasDynamicProps === false) return el;

  const schemaCtx: SchemaContext = { library: evalCtx.library };
  const def = evalCtx.library.components[el.typeName];
  const evaluated: Record<string, unknown> = {};

  let key = "";
  const report = (msg: string) => {
    evalCtx.errors?.push({
      source: "runtime",
      code: "runtime-error",
      component: el.typeName,
      statementId: el.statementId,
      message: `Evaluating prop "${key}" on ${el.typeName} failed: ${msg}`,
      hint: `Check the expression used for prop "${key}"`,
    });
  };
  // Library function calls and actions that fail report why here
  const propCtx =
    evalCtx.ctx.functions || evalCtx.ctx.actions
      ? { ...evalCtx, ctx: { ...evalCtx.ctx, reportError: report } }
      : evalCtx;

  for (const [propKey, value] of Object.entries(el.props)) {
    key = propKey;
    const propSchema = def?.props?.shape?.[key];
    try {
      evaluated[key] = evaluatePropValue(value, propCtx, schemaCtx, propSchema);
    } catch (e) {
      if (e instanceof RuntimeBudgetError) throw e;
      evaluated[key] = undefined;
      report(e instanceof Error ? e.message : String(e));
    }
  }

  let cat = compiled.get(evalCtx.library);
  if (!cat) { cat = compileSchema(evalCtx.library.toJSONSchema()); compiled.set(evalCtx.library, cat); }
  const validation = { cat, errors: [], partial: false, currentStatementId: el.statementId } as unknown as import("../parser/types").MaterializeCtx;
  for (const param of cat.get(el.typeName)?.params ?? []) {
    const value = evaluated[param.name];
    const propSchema = def?.props?.shape?.[param.name];
    // A reactive binding is a runtime descriptor; validate its current value against the schema.
    const checkedValue = isReactiveAssign(value) && isReactiveSchema(propSchema) ? evalCtx.ctx.getState(value.target) : value;
    if (isActionPlan(value)) continue;
    // A present binding may hold null while the user clears a field; @Default handles it.
    if (isReactiveAssign(value) && isReactiveSchema(propSchema) && checkedValue == null) continue;
    if (checkedValue == null) {
      const allowsNull = (schema: unknown): boolean => {
        if (!schema || typeof schema !== "object") return true;
        const s = schema as Record<string, unknown>;
        if (s.type === "null" || (Array.isArray(s.type) && s.type.includes("null"))) return true;
        if (Array.isArray(s.anyOf)) return s.anyOf.some(allowsNull);
        if (Array.isArray(s.oneOf)) return s.oneOf.some(allowsNull);
        return !s.type && !s.$ref && !s.enum && !("const" in s);
      };
      if (checkedValue === null && allowsNull(param.schema)) continue;
      if (param.required && param.defaultValue === undefined) validation.errors.push({ code: "missing-required", component: el.typeName, path: `/${param.name}`, statementId: el.statementId, message: `Required prop ${param.name} evaluated to ${String(checkedValue)}` });
      continue;
    }
    const next = validateSchemaValue(checkedValue, param.schema, el.typeName, `/${param.name}`, validation);
    if (next === INVALID) {
      const fallback = resolveInvalidValue(param.required, param.defaultValue);
      evaluated[param.name] = fallback === INVALID ? undefined : fallback;
    } else if (!isReactiveAssign(value)) evaluated[param.name] = next;
  }
  for (const error of validation.errors) evalCtx.errors?.push({ ...error, source: "runtime" });
  return { ...el, props: evaluated };
}

/** Evaluate `root`, or the component a runtime entry (`rootExpression`) picks; null if none. */
export function evaluateRoot(
  result: Pick<ParseResult, "root" | "rootExpression">,
  evalCtx: EvalContext,
): ElementNode | null {
  const bounded = { ...evalCtx, renderBudget: createBudget("render", DEFAULT_LIMITS.renderNodes), ctx: { ...evalCtx.ctx, budget: createBudget("evaluation", DEFAULT_LIMITS.evaluationSteps) } };
  const root = evaluateRootInternal(result, bounded);
  assertValueBudget(root, "render output", DEFAULT_LIMITS.sourceChars * 4);
  const pending: unknown[] = [root]; let count = 0;
  while (pending.length) {
    const value = pending.pop();
    if (isElementNode(value) && ++count > DEFAULT_LIMITS.renderNodes) throw new RuntimeBudgetError("render nodes", DEFAULT_LIMITS.renderNodes);
    if (Array.isArray(value)) pending.push(...value);
    else if (value && typeof value === "object") pending.push(...Object.values(value));
  }
  return root;
}

function evaluateRootInternal(result: Pick<ParseResult, "root" | "rootExpression">, evalCtx: EvalContext): ElementNode | null {
  if (result.root) return evaluateElementProps(result.root, evalCtx);
  if (!result.rootExpression) return null;
  const value = evaluate(result.rootExpression, evalCtx.ctx, { library: evalCtx.library });
  if (isElementNode(value)) return evaluateElementProps(value, evalCtx);
  evalCtx.errors?.push({
    source: "runtime",
    code: "no-root",
    statementId: "root",
    message: "root does not evaluate to a component",
  });
  return null;
}

/**
 * Evaluate a single prop value with schema awareness.
 * Delegates to shared evaluatePropCore with evaluate-tree-specific recursion callbacks.
 */
function evaluatePropValue(
  value: unknown,
  evalCtx: EvalContext,
  schemaCtx: SchemaContext,
  reactiveSchema?: unknown,
): unknown {
  return evaluatePropCore(value, evalCtx.ctx, schemaCtx, reactiveSchema, {
    recurseElement: (el) => evaluateElementProps(el, evalCtx),
    recurse: (v, rs) => evaluatePropValue(v, evalCtx, schemaCtx, rs),
  });
}
