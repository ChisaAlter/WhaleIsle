import { assertValueBudget, createBudget, DEFAULT_LIMITS, type Budget } from "./budget";
// ─────────────────────────────────────────────────────────────────────────────
// AST evaluator — resolves AST nodes to runtime values.
// Framework-agnostic. No React imports.
// ─────────────────────────────────────────────────────────────────────────────

import type { ASTNode } from "../parser/ast";
import { isASTNode, toLiteralAST } from "../parser/ast";
import {
  ACTION_STEPS,
  BUILTIN_CALLS,
  BUILTIN_STEPS,
  BUILTINS,
  isStep,
  toNumber,
} from "../parser/builtins";
import { nameArgs } from "../parser/materialize";
import type {
  ActionPlan,
  ActionStep,
  ElementNode,
  FunctionSchema,
  JSONSchemaDef,
  MaterializeCtx,
  ParamDef,
} from "../parser/types";
import { isElementNode } from "../parser/types";
import { getSchemaDefaultValue, INVALID, validateSchemaValue } from "../parser/validation";
import { isReactiveSchema } from "../reactive";
import { evaluatePropCore } from "./evaluate-prop";

const evaluationPass = Symbol("evaluationPass");
interface ExpressionInfo { pure: boolean; refs: ReadonlySet<string> }
interface EvaluationPass {
  values: WeakMap<ASTNode, unknown>;
  info: WeakMap<ASTNode, ExpressionInfo>;
  data: WeakMap<object, boolean>;
  errors: number;
  suspended: number;
}

/** Optional schema context for reactive-aware evaluation. */
export interface SchemaContext {
  /** Component library — used to look up reactive schemas per prop. */
  library: { components: Record<string, { props: { shape?: Record<string, unknown> } }> };
}

export interface EvaluationContext {
  budget?: Budget;
  /** Internal, never attached to the caller's context or carried by deferred actions. */
  [evaluationPass]?: EvaluationPass;
  /** Read $variable from the store */
  getState(name: string): unknown;
  /** Resolve a reference to another declaration's evaluated value */
  resolveRef(name: string): unknown;
  /** Extra scope for $value injection during reactive prop evaluation */
  extraScope?: Record<string, unknown>;
  /** Library functions: `library.toJSONSchema().functions` entries plus each `fn`. */
  functions?: Record<string, RuntimeFunction>;
  /** Custom actions: the `library.toJSONSchema().actions` entries. */
  actions?: Record<string, FunctionSchema>;
  /** Reports a runtime error, such as a library function call that evaluated to null. */
  reportError?: (message: string) => void;
}

/** A library function as the evaluator runs it. */
export interface RuntimeFunction extends FunctionSchema {
  fn: (args: any) => unknown;
}

export interface ReactiveAssign {
  __reactive: "assign";
  target: string;
  expr: ASTNode;
}

export function isReactiveAssign(value: unknown): value is ReactiveAssign {
  return typeof value === "object" && value !== null && (value as any).__reactive === "assign";
}

/**
 * Evaluate an AST node to a runtime value.
 */
export function evaluate(
  node: ASTNode,
  context: EvaluationContext,
  schemaCtx?: SchemaContext,
): unknown {
  const bounded = context[evaluationPass] ? context : createEvaluationPass(context);
  const pass = bounded[evaluationPass]!;
  const leave = bounded.budget!.enter(node.k);
  try {
    const info = expressionInfo(node, bounded);
    const reusable = pass.suspended === 0 && info.pure && info.refs.size === 0;
    if (reusable && pass.values.has(node)) return pass.values.get(node);
    const errorsBefore = pass.errors;
    const value = evaluateInternal(node, bounded, schemaCtx);
    if (reusable && pass.errors === errorsBefore && isDataValue(value, pass)) pass.values.set(node, value);
    return value;
  } finally { leave(); }
}

/** One synchronous root/expression pass; callers and later action steps never inherit its values. */
export function createEvaluationPass(context: EvaluationContext): EvaluationContext {
  return {
    ...context,
    budget: context.budget ?? createBudget("evaluation", DEFAULT_LIMITS.evaluationSteps),
    [evaluationPass]: { values: new WeakMap(), info: new WeakMap(), data: new WeakMap(), errors: 0, suspended: 0 },
  };
}

function eachVariable(node: Extract<ASTNode, { k: "Comp" }>): string | null {
  const arg = node.args[1];
  return arg?.k === "Ref" ? arg.n : arg?.k === "Str" ? arg.v : null;
}

/** Free lexical refs also tell Each exactly which branches need item substitution. */
function expressionInfo(node: ASTNode, context: EvaluationContext): ExpressionInfo {
  const cache = context[evaluationPass]!.info;
  const cached = cache.get(node);
  if (cached) return cached;
  let pure = true;
  const refs = new Set<string>();
  const include = (child: ASTNode, bound?: string | null) => {
    const info = expressionInfo(child, context);
    pure = pure && info.pure;
    for (const ref of info.refs) if (ref !== bound) refs.add(ref);
  };
  switch (node.k) {
    case "Ref": refs.add(node.n); break;
    case "Ph": case "RuntimeRef": case "Assign": pure = false; if (node.k === "Assign") include(node.value); break;
    case "Arr": node.els.forEach(child => include(child)); break;
    case "Obj": node.entries.forEach(([, child]) => include(child)); break;
    case "Member": include(node.obj); break;
    case "Index": include(node.obj); include(node.index); break;
    case "BinOp": include(node.left); include(node.right); break;
    case "UnaryOp": include(node.operand); break;
    case "Ternary": include(node.cond); include(node.then); include(node.else); break;
    case "Comp": {
      pure = !!BUILTINS[node.name] || context.functions?.[node.name]?.pure === true;
      if (node.name === "Each" && BUILTINS.Each && node.args.length >= 3) {
        include(node.args[0]);
        include(node.args[2], eachVariable(node));
      } else {
        for (const child of Object.values(node.mappedProps ?? node.args)) include(child);
      }
      break;
    }
  }
  const info = { pure, refs };
  cache.set(node, info);
  return info;
}

/** Even an opted-in function or a state value cannot make shared component/action instances. */
function isDataValue(value: unknown, pass: EvaluationPass): boolean {
  if (!value || typeof value !== "object") return typeof value !== "function";
  const cached = pass.data.get(value);
  if (cached !== undefined) return cached;
  pass.data.set(value, false);
  const data = !isElementNode(value) && !isActionPlan(value) && !isReactiveAssign(value) && !isASTNode(value)
    && Object.values(value).every(child => isDataValue(child, pass));
  pass.data.set(value, data);
  return data;
}

function reportError(context: EvaluationContext, message: string): void {
  const pass = context[evaluationPass];
  if (pass) pass.errors++;
  context.reportError?.(message);
}

function evaluateInternal(node: ASTNode, context: EvaluationContext, schemaCtx?: SchemaContext): unknown {
  switch (node.k) {
    // ── Literals ──────────────────────────────────────────────────────────
    case "Str":
      return node.v;
    case "Num":
      return node.v;
    case "Bool":
      return node.v;
    case "Null":
      return null;
    case "Ph":
      return null;

    // ── State references ──────────────────────────────────────────────────
    case "StateRef":
      return context.extraScope && Object.prototype.hasOwnProperty.call(context.extraScope, node.n)
        ? context.extraScope[node.n] : context.getState(node.n);

    // ── References ────────────────────────────────────────────────────────
    case "Ref":
    case "RuntimeRef":
      return context.resolveRef(node.n);

    // ── Collections ───────────────────────────────────────────────────────
    case "Arr":
      return node.els.map((el) => evaluate(el, context));
    case "Obj":
      return Object.fromEntries(node.entries.map(([k, v]) => [k, evaluate(v, context)]));

    // ── Component ─────────────────────────────────────────────────────────
    case "Comp": {
      // Built-ins coerce their args, so they skip validation. Lazy ones get them unevaluated.
      const builtin = BUILTINS[node.name];
      if (builtin) {
        if (builtin.lazy) return evaluateLazyBuiltin(node.name, node.args, context, schemaCtx);
        return builtin.fn!(evaluateArgs(node, context));
      }
      // Built-in steps and Action([...]) → an ActionPlan
      if (isStep(node.name)) return evaluateActionCall(node, context);
      const fns = context.functions;
      if (fns && Object.prototype.hasOwnProperty.call(fns, node.name)) {
        return callFunction(node.name, fns[node.name]!, node, context);
      }
      // Custom actions: a one-step plan; any invalid arg gives an empty plan, a no-op,
      // even an optional one with a default: @ExportFile("r", "xlsx") must not export csv
      const acts = context.actions;
      if (acts && Object.prototype.hasOwnProperty.call(acts, node.name)) {
        return deferAction(node);
      }
      // If parser already mapped args→props (via materializeExpr), use named props.
      // With schema context: emit ReactiveAssign for StateRef on reactive props.
      // Without schema context: preserve StateRef as AST for evaluate-tree to handle.
      if (node.mappedProps) {
        const def = schemaCtx?.library.components[node.name];
        const props: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.mappedProps)) {
          const propSchema = def?.props?.shape?.[key];
          if (val.k === "StateRef" && propSchema && isReactiveSchema(propSchema)) {
            // Reactive schema + StateRef → emit ReactiveAssign marker
            props[key] = {
              __reactive: "assign" as const,
              target: val.n,
              expr: { k: "StateRef" as const, n: "$value" },
            };
          } else if (val.k === "StateRef") {
            // Non-reactive StateRef or no schema context → preserve for evaluate-tree
            props[key] = schemaCtx ? context.getState(val.n) : val;
          } else {
            props[key] = evaluate(val, context, schemaCtx);
          }
        }
        const result: ElementNode = {
          type: "element",
          typeName: node.name,
          sourceKey: node.sourceKey,
          props,
          partial: false,
          hasDynamicProps: true,
        };
        // If we have schema context, recursively evaluate nested ElementNodes in props
        if (schemaCtx) {
          for (const [key, val] of Object.entries(props)) {
            if (isElementNode(val)) {
              props[key] = evaluateElementInline(val, context, schemaCtx);
            } else if (Array.isArray(val)) {
              props[key] = val.map((item) =>
                isElementNode(item) ? evaluateElementInline(item, context, schemaCtx) : item,
              );
            }
          }
        }
        return result;
      }
      // After materializeValue, all catalog/unknown components are lowered to
      // ElementNode at parse time. Only builtins and mappedProps Comp nodes
      // reach here. If we somehow get an unmapped Comp, warn and return null.
      console.warn(`[openui] Unexpected unmapped Comp node: ${node.name}`);
      return null;
    }

    // ── Binary operators ──────────────────────────────────────────────────
    case "BinOp": {
      // Short-circuit operators evaluate lazily
      if (node.op === "&&") {
        const left = evaluate(node.left, context);
        return left ? evaluate(node.right, context) : left;
      }
      if (node.op === "||") {
        const left = evaluate(node.left, context);
        return left ? left : evaluate(node.right, context);
      }

      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);

      switch (node.op) {
        case "+":
          if (typeof left === "string" || typeof right === "string") {
            // Treat null/undefined as "" for string concat to avoid "textnull"
            return String(left ?? "") + String(right ?? "");
          }
          return toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/":
          // DSL design choice: division by zero returns 0 instead of JavaScript's Infinity/NaN.
          return toNumber(right) === 0 ? 0 : toNumber(left) / toNumber(right);
        case "%":
          return toNumber(right) === 0 ? 0 : toNumber(left) % toNumber(right);
        case "==":
          // Use loose equality so that e.g. 5 == "5" is true,
          // consistent with the toNumber coercion used by comparison operators.
          return left == right;
        case "!=":
          return left != right;
        case ">":
          return toNumber(left) > toNumber(right);
        case "<":
          return toNumber(left) < toNumber(right);
        case ">=":
          return toNumber(left) >= toNumber(right);
        case "<=":
          return toNumber(left) <= toNumber(right);
        default:
          return null;
      }
    }

    // ── Unary operators ───────────────────────────────────────────────────
    case "UnaryOp":
      if (node.op === "!") {
        return !evaluate(node.operand, context);
      }
      if (node.op === "-") {
        return -toNumber(evaluate(node.operand, context));
      }
      return null;

    // ── Ternary ───────────────────────────────────────────────────────────
    case "Ternary": {
      const cond = evaluate(node.cond, context);
      return cond ? evaluate(node.then, context) : evaluate(node.else, context);
    }

    // ── Member access ─────────────────────────────────────────────────────
    case "Member": {
      const obj = evaluate(node.obj, context) as any;
      if (obj == null) return null;
      // Array pluck: if obj is an array, extract field from every element
      if (Array.isArray(obj)) {
        if (node.field === "length") return obj.length;
        return obj.map((item: any) => item?.[node.field] ?? null);
      }
      return Object.prototype.hasOwnProperty.call(obj, node.field) ? obj[node.field] : null;
    }

    // ── Index access ──────────────────────────────────────────────────────
    case "Index": {
      const obj = evaluate(node.obj, context) as any;
      const idx = evaluate(node.index, context);
      if (obj == null || idx == null) return null;
      if (Array.isArray(obj)) {
        return obj[toNumber(idx)];
      }
      return Object.prototype.hasOwnProperty.call(obj, String(idx)) ? obj[String(idx)] : null;
    }

    // ── Assignment ────────────────────────────────────────────────────────
    case "Assign":
      return {
        __reactive: "assign" as const,
        target: node.target,
        expr: node.value,
      };
  }
}

/**
 * Strip a ReactiveAssign to its current value in a non-reactive context.
 * When transport args or non-reactive props contain a ReactiveAssign, this
 * resolves it to the current state value (or null if getState is unavailable).
 */
export function stripReactiveAssign(value: unknown, context: EvaluationContext): unknown {
  if (!isReactiveAssign(value)) return value;
  return context.getState(value.target) ?? null;
}

/**
 * Evaluate an ElementNode's props with schema awareness. Used by evaluate()
 * when schema context is available and a Comp produces an ElementNode that
 * needs its own props evaluated with reactive schema detection.
 */
function evaluateElementInline(
  el: ElementNode,
  context: EvaluationContext,
  schemaCtx: SchemaContext,
): ElementNode {
  if (el.hasDynamicProps === false) return el;
  const def = schemaCtx.library.components[el.typeName];
  const evaluated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(el.props)) {
    const propSchema = def?.props?.shape?.[key];
    evaluated[key] = evaluatePropInline(value, context, schemaCtx, propSchema);
  }
  return { ...el, props: evaluated };
}

/**
 * Evaluate a single prop value with schema awareness.
 * Delegates to shared evaluatePropCore with inline-specific recursion callbacks.
 */
function evaluatePropInline(
  value: unknown,
  context: EvaluationContext,
  schemaCtx: SchemaContext,
  reactiveSchema?: unknown,
): unknown {
  return evaluatePropCore(value, context, schemaCtx, reactiveSchema, {
    recurseElement: (el) => evaluateElementInline(el, context, schemaCtx),
    recurse: (v, rs) => evaluatePropInline(v, context, schemaCtx, rs),
  });
}

// @Percent(done, 10) with done = 3 -> {part: 3, total: 10}
function evaluateArgs(
  node: ASTNode & { k: "Comp" },
  context: EvaluationContext,
  params: ParamDef[] = BUILTIN_CALLS.get(node.name)?.params ?? [],
): Record<string, unknown> {
  // The parser names args in mappedProps; an AST from parseExpression() alone is named here
  const named = node.mappedProps ?? nameArgs(node.args, params);
  const args: Record<string, unknown> = {};
  for (const key in named) args[key] = evaluate(named[key]!, context);
  return args;
}

/** A library function's or action's args; an explicit null for an optional param is omitted, so its default applies. */
function callArgs(
  node: ASTNode & { k: "Comp" },
  context: EvaluationContext,
  params: JSONSchemaDef,
): Record<string, unknown> {
  const names = Object.keys(params.properties ?? {});
  const args = evaluateArgs(
    node,
    context,
    names.map((name) => ({ name, required: false })),
  );
  for (const key in args) {
    if (args[key] === null && !params.required?.includes(key)) delete args[key];
  }
  return args;
}

// returns z.string() but fn gives 5 -> reports "@Percent: ... expects string but got number".
// strict: any reported error gives INVALID instead of falling back to a default.
function checkValue(
  value: unknown,
  schema: unknown,
  name: string,
  path: string,
  context: EvaluationContext,
  strict = false,
): unknown {
  const ctx = { errors: [], partial: false } as unknown as MaterializeCtx;
  const checked = validateSchemaValue(value, schema, name, path, ctx);
  for (const e of ctx.errors) reportError(context, `@${name}: ${e.message}`);
  return strict && ctx.errors.length > 0 ? INVALID : checked;
}

// @Percent($p) with $p unset -> null, no error
function missesRequired(args: Record<string, unknown>, params: RuntimeFunction["params"]): boolean {
  return !!params.required?.some(
    (key) => args[key] == null && getSchemaDefaultValue(params.properties?.[key]) === undefined,
  );
}

// @Percent(1, 0) where fn throws -> null, reports "@Percent threw: ..."
function callFunction(
  name: string,
  def: RuntimeFunction,
  node: ASTNode & { k: "Comp" },
  context: EvaluationContext,
): unknown {
  const pass = context[evaluationPass]!;
  if (def.pure === true) return callFunctionBody(name, def, node, context);
  // An extension without the pure contract can mutate arguments or external state.
  // Its arguments must be fresh, and values read before the call cannot outlive it.
  pass.suspended++;
  pass.values = new WeakMap();
  pass.data = new WeakMap();
  try { return callFunctionBody(name, def, node, context); }
  finally { pass.suspended--; pass.values = new WeakMap(); pass.data = new WeakMap(); }
}

function callFunctionBody(
  name: string,
  def: RuntimeFunction,
  node: ASTNode & { k: "Comp" },
  context: EvaluationContext,
): unknown {
  const raw = callArgs(node, context, def.params);
  if (missesRequired(raw, def.params)) return null;
  const args = checkValue(raw, def.params, name, "", context);
  if (args === INVALID) return null;
  let result: unknown;
  try {
    result = def.fn(args);
  } catch (e) {
    reportError(context, `@${name} threw: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  assertValueBudget(result, `function @${name}`);
  if (!def.returns) return result;
  const checked = checkValue(result, def.returns, name, "/returns", context);
  return checked === INVALID ? null : (checked ?? null);
}

/** True for an evaluated action plan (`{ steps: [...] }`). */
export function isActionPlan(value: unknown): value is ActionPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { steps?: unknown }).steps)
  );
}

/** Flatten plans (and stray step objects) into one plan; other values are dropped. */
function flattenPlans(values: unknown[]): ActionPlan {
  return ownSteps({
    steps: values.flatMap((v): ActionStep[] => {
      if (isActionPlan(v)) return v.steps;
      return v != null && typeof v === "object" && "type" in v ? [v as ActionStep] : [];
    }),
  });
}

/** The custom steps made by real calls; a custom step read from data is not among them. */
const customSteps = new WeakSet<ActionStep>();
const deferredSteps = new WeakSet<ActionStep>();

function deferAction(call: Extract<ASTNode, { k: "Comp" }>): ActionPlan {
  const step: ActionStep = { type: "deferred_action", call };
  deferredSteps.add(step);
  return { steps: [step] };
}

/** Drops the custom steps no real call made, so data cannot pose as a custom action. */
export function ownSteps(plan: ActionPlan): ActionPlan {
  const own = (s: ActionStep | null) => s?.type === "deferred_action" ? deferredSteps.has(s) : s?.type !== "custom_action" || customSteps.has(s);
  return plan.steps.every(own) ? plan : { ...plan, steps: plan.steps.filter(own) };
}

/** A step call is a one-step plan, an invalid step an empty plan; Action([...]) flattens. */
function evaluateActionCall(node: ASTNode & { k: "Comp" }, context: EvaluationContext): ActionPlan {
  const { name, args } = node;
  if (name === "Action") {
    const list = args.length > 0 ? evaluate(args[0], context) : [];
    return flattenPlans(Array.isArray(list) ? list : []);
  }
  return deferAction(node);
}

/** Resolve one genuine call immediately before executing it, after prior acknowledgements. */
export function resolveActionStep(step: ActionStep, context: EvaluationContext): ActionStep | null {
  if (step.type !== "deferred_action") return step.type === "custom_action" && !customSteps.has(step) ? null : step;
  if (!deferredSteps.has(step)) return null;
  const node = step.call;
  const builtin = BUILTIN_STEPS[node.name];
  if (builtin) return builtin.step ? builtin.step(evaluateArgs(node, context)) : evaluateLazyStep(node.name, node.args);
  const def = context.actions?.[node.name];
  if (!def) return null;
  const args = callArgs(node, context, def.params);
  if (missesRequired(args, def.params)) throw new Error(`@${node.name} is missing required action arguments`);
  const params = checkValue(args, def.params, node.name, "", context, true);
  if (params === INVALID) throw new Error(`@${node.name} action arguments are invalid`);
  const resolved: ActionStep = { type: "custom_action", name: node.name, params: params as Record<string, unknown> };
  customSteps.add(resolved);
  return resolved;
}

/** The steps whose args are refs, read as AST. */
function evaluateLazyStep(name: string, args: ASTNode[]): ActionStep | null {
  switch (name) {
    case "Run": {
      // Run(runtimeRef); an unresolved Ref is invalid
      const refNode = args[0];
      if (refNode?.k !== "RuntimeRef") return null;
      return { type: ACTION_STEPS.Run, statementId: refNode.n, refType: refNode.refType };
    }
    case "Set": {
      // Set($varName, value). valueAST is evaluated at click time by triggerAction;
      // loop variables (e.g. t.id from Each) are pre-resolved by Each's substituteRef.
      if (args.length < 2 || args[0].k !== "StateRef") return null;
      return { type: ACTION_STEPS.Set, target: args[0].n, valueAST: args[1] };
    }
    case "Reset": {
      // Reset($var1, $var2, ...) restores declared defaults at runtime.
      const targets = args
        .filter((a): a is ASTNode & { k: "StateRef" } => a.k === "StateRef")
        .map((a) => a.n);
      if (targets.length === 0) return null;
      return { type: ACTION_STEPS.Reset, targets };
    }
    default:
      return null;
  }
}

/**
 * Substitute all Ref(varName) nodes in an AST tree with a literal value.
 * This pre-resolves loop variables so deferred expressions (like Action steps)
 * don't lose scope when evaluated later at click time.
 */
function substituteRef(node: ASTNode, varName: string, value: unknown, context: EvaluationContext): ASTNode {
  // Keep loop-independent declaration subgraphs shared instead of copying them for every item.
  if (!expressionInfo(node, context).refs.has(varName)) return node;
  const substitute = (child: ASTNode) => substituteRef(child, varName, value, context);
  switch (node.k) {
    case "Ref":
      return node.n === varName ? toLiteralAST(value) : node;
    case "Member": {
      // Member access on the loop var: t.id → resolve t, then access .id
      if (isASTNode(node.obj)) {
        const subObj = substitute(node.obj as ASTNode);
        // If obj resolved to a literal, we can inline the member access result
        if (subObj.k === "Obj") {
          const entry = subObj.entries.find(([k]) => k === node.field);
          if (entry) return entry[1];
        }
        return { ...node, obj: subObj };
      }
      return node;
    }
    case "Index":
      return {
        ...node,
        obj: isASTNode(node.obj) ? substitute(node.obj as ASTNode) : node.obj,
        index: isASTNode(node.index)
          ? substitute(node.index as ASTNode)
          : node.index,
      };
    case "BinOp":
      return {
        ...node,
        left: substitute(node.left),
        right: substitute(node.right),
      };
    case "UnaryOp":
      return { ...node, operand: substitute(node.operand) };
    case "Ternary":
      return {
        ...node,
        cond: substitute(node.cond),
        then: substitute(node.then),
        else: substitute(node.else),
      };
    case "Arr":
      return { ...node, els: node.els.map((e) => substitute(e)) };
    case "Obj":
      return {
        ...node,
        entries: node.entries.map(
          ([k, v]) => [k, substitute(v)] as [string, ASTNode],
        ),
      };
    case "Comp": {
      // A nested Each binds only its template; its array still sees the outer item.
      const shadowed = node.name === "Each" && eachVariable(node) === varName;
      const result = { ...node, args: node.args.map((arg, index) => shadowed && index > 0 ? arg : substitute(arg)) };
      if (node.mappedProps) result.mappedProps = mapValues(node.mappedProps, substitute);
      return result;
    }
    case "Assign":
      return { ...node, value: substitute(node.value) };
    default:
      return node;
  }
}

function mapValues(
  record: Record<string, ASTNode>,
  fn: (node: ASTNode) => ASTNode,
): Record<string, ASTNode> {
  const out: Record<string, ASTNode> = {};
  for (const key in record) out[key] = fn(record[key]!);
  return out;
}

/**
 * Each(array, varName, template) — evaluate template once per array item.
 * varName is user-defined (e.g. `issue`, `ticket`) — no $ prefix collision.
 *
 * Before evaluation, substitutes all Ref(varName) in the template with the
 * current item's literal value. This ensures deferred expressions (like
 * Action/Set steps) capture concrete values instead of dangling loop refs.
 */
function evaluateLazyBuiltin(
  name: string,
  args: ASTNode[],
  context: EvaluationContext,
  schemaCtx?: SchemaContext,
): unknown {
  if (name === "Each") {
    if (args.length < 3) return [];
    const arr = evaluate(args[0], context);
    if (!Array.isArray(arr)) return [];

    const varName =
      args[1].k === "Ref" ? args[1].n : args[1].k === "Str" ? (args[1] as any).v : null;
    if (!varName) return [];
    const template = args[2];

    return arr.map((item, _idx) => {
      // Pre-substitute loop variable refs with concrete values in the template AST.
      // This captures the item for deferred expressions (Action steps evaluated at click time).
      const substituted = substituteRef(template, varName, item, context);
      const childCtx: EvaluationContext = {
        ...context,
        resolveRef: (refName: string) => {
          if (refName === varName) return item;
          return context.resolveRef(refName);
        },
      };
      const result = evaluate(substituted, childCtx, schemaCtx);
      if (isElementNode(result)) {
        const identity = item && typeof item === "object" ? ((item as any).id ?? (item as any).key ?? _idx) : _idx;
        result.instanceKey = `${varName}:${String(identity)}`;
      }
      // If schema context is available and result is an ElementNode, evaluate its props
      if (schemaCtx && isElementNode(result)) {
        return evaluateElementInline(result as ElementNode, childCtx, schemaCtx);
      }
      return result;
    });
  }
  return null;
}
