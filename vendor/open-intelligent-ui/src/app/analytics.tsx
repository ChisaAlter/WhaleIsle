"use client";

import { useEffect } from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const isProduction = process.env.NODE_ENV === "production";

export function Analytics() {
  useEffect(() => {
    if (!isProduction || !POSTHOG_KEY) return;

    void import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(POSTHOG_KEY, {
          ...(POSTHOG_HOST ? { api_host: POSTHOG_HOST } : {}),
          capture_pageview: "history_change",
          disable_session_recording: false,
          session_recording: { sampleRate: 0.3 },
          disable_surveys: true,
        });
      })
      .catch(() => {
        // Analytics must never break the demo.
      });
  }, []);

  return null;
}
