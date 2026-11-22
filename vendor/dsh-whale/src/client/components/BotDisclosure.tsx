// Smooth CSS-Grid (0fr <-> 1fr) disclosure track, presence lifecycle, and rotating chevron
// matching WhaleIsle's motion tokens and Sidebar Rows disclosure pattern.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronRight } from './Icons';

function prefersInstantMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return true;
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return true;
  }
  if (typeof document !== 'undefined' && document.documentElement?.hasAttribute?.('data-dsh-minimal')) {
    return true;
  }
  return false;
}

export function useBotsPresence(
  open: boolean,
  exitMs = 220,
): { present: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(open);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  useEffect(() => {
    const instant = prefersInstantMotion();

    if (open) {
      if (instant) {
        setMounted(true);
        setEntered(true);
        return undefined;
      }
      setMounted(true);
      let raf2 = 0;
      const raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          setEntered(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(raf1);
        if (raf2) window.cancelAnimationFrame(raf2);
      };
    }

    setEntered(false);
    if (!mountedRef.current) {
      return undefined;
    }
    if (instant) {
      setMounted(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, exitMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [exitMs, open]);

  return {
    present: mounted,
    state: open && entered ? 'open' : 'closed',
  };
}

export interface BotDisclosureProps {
  open: boolean;
  className?: string;
  exitMs?: number;
  onPresenceChange?: (present: boolean) => void;
  children: ReactNode;
}

export function BotDisclosure({
  open,
  className,
  exitMs = 220,
  onPresenceChange,
  children,
}: BotDisclosureProps) {
  const { present, state } = useBotsPresence(open, exitMs);

  useEffect(() => {
    onPresenceChange?.(present);
  }, [onPresenceChange, present]);

  if (!present) {
    return null;
  }

  return (
    <div
      className={className ? `dsh-bots-disclosure ${className}` : 'dsh-bots-disclosure'}
      data-state={state}
      aria-hidden={open ? undefined : true}
    >
      <div className="dsh-bots-disclosure-inner">
        {children}
      </div>
    </div>
  );
}

export interface BotChevronProps {
  open: boolean;
  size?: number;
  className?: string;
}

export function BotChevron({ open, size = 14, className }: BotChevronProps) {
  return (
    <span
      className={className ? `dsh-bots-chevron ${className}` : 'dsh-bots-chevron'}
      data-open={open ? 'true' : 'false'}
      aria-hidden="true"
    >
      <IconChevronRight size={size} />
    </span>
  );
}
