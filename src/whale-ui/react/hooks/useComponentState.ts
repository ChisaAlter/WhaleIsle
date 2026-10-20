import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useComponentIdentity, useOpenUI } from "../context";
import { COMPONENT_STATE_KEY } from "../field-state";

/** Durable visual state, isolated by component identity and omitted from form submissions. */
export function useComponentState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { store } = useOpenUI();
  const identity = useComponentIdentity();
  const key = `${identity}/${name}`;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const states = store.get(COMPONENT_STATE_KEY) as Record<string, unknown> | undefined;
  const value = states && Object.prototype.hasOwnProperty.call(states, key) ? states[key] as T : initial;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const currentStates = (store.get(COMPONENT_STATE_KEY) ?? {}) as Record<string, unknown>;
    const previous = Object.prototype.hasOwnProperty.call(currentStates, key) ? currentStates[key] as T : initialRef.current;
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(previous) : next;
    if (Object.is(previous, resolved) && Object.prototype.hasOwnProperty.call(currentStates, key)) return;
    store.set(COMPONENT_STATE_KEY, { ...currentStates, [key]: resolved });
  }, [store, key]);
  return [value, setValue];
}
