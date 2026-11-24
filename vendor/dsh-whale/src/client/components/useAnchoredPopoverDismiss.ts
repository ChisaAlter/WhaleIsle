// Shared outside-press and Escape dismissal hook for portaled popovers/menus.
// Excludes the popover's own trigger element from outside-press dismissal so
// clicking the trigger again toggles closed instead of closing on pointerdown/mousedown
// and immediately reopening on click.

import { useEffect, useRef, type RefObject } from 'react';

export interface AnchoredPopoverDismissOptions {
  open: boolean;
  popoverRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  triggerEl?: HTMLElement | null;
  onClose: () => void;
  closeOnScroll?: boolean;
}

function isDomNode(value: EventTarget | null): value is Node {
  return value !== null && typeof value === 'object' && 'nodeType' in value;
}

export function useAnchoredPopoverDismiss({
  open,
  popoverRef,
  triggerRef,
  triggerEl,
  onClose,
  closeOnScroll = false,
}: AnchoredPopoverDismissOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    const isInside = (target: EventTarget | null): boolean => {
      if (!isDomNode(target)) {
        return false;
      }
      if (popoverRef.current?.contains(target)) {
        return true;
      }
      const trigger = triggerEl ?? triggerRef?.current ?? null;
      if (trigger?.contains(target)) {
        return true;
      }
      return false;
    };

    // Deduplicate a single outside press that fires `pointerdown` followed by `mousedown`
    // before React cleans up listeners, while still supporting `mousedown`-only environments.
    let suppressMouseDown = false;
    let suppressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSuppressTimer = () => {
      if (suppressTimer !== null) {
        clearTimeout(suppressTimer);
        suppressTimer = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (isInside(event.target)) {
        return;
      }
      suppressMouseDown = true;
      clearSuppressTimer();
      suppressTimer = setTimeout(() => {
        suppressMouseDown = false;
        suppressTimer = null;
      }, 0);
      onCloseRef.current();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (suppressMouseDown) {
        suppressMouseDown = false;
        clearSuppressTimer();
        return;
      }
      if (isInside(event.target)) {
        return;
      }
      onCloseRef.current();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement;
      const focusWasInside = Boolean(active && popoverRef.current?.contains(active));
      onCloseRef.current();
      if (focusWasInside) {
        (triggerEl ?? triggerRef?.current)?.focus();
      }
    };

    const handleScroll = () => {
      onCloseRef.current();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
    if (closeOnScroll && typeof window !== 'undefined') {
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      clearSuppressTimer();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (closeOnScroll && typeof window !== 'undefined') {
        window.removeEventListener('scroll', handleScroll, true);
      }
    };
  }, [open, popoverRef, triggerRef, triggerEl, closeOnScroll]);
}
