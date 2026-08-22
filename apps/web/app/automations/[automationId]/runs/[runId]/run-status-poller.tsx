"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RUN_STATUS_POLL_INTERVAL_MS,
  RUN_STATUS_POLL_MAX_ATTEMPTS,
} from "../../../../../lib/run-status-readiness";

export interface RunStatusPollerProps {
  enabled: boolean;
}

export function RunStatusPoller({ enabled }: RunStatusPollerProps) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setAttempts(0);
      return;
    }

    let currentAttempt = 0;
    const timer = window.setInterval(() => {
      currentAttempt += 1;
      setAttempts(currentAttempt);
      router.refresh();
      if (currentAttempt >= RUN_STATUS_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
      }
    }, RUN_STATUS_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, router]);

  if (!enabled) return null;

  return (
    <p className="muted" aria-live="polite">
      {attempts >= RUN_STATUS_POLL_MAX_ATTEMPTS
        ? "The run is still active. Automatic checks stopped after five minutes; refresh this page to check its latest durable state."
        : "This page checks the durable run state every five seconds and will stop automatically when the run finishes or pauses again."}
    </p>
  );
}
