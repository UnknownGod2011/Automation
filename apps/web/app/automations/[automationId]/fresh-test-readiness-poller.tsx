"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FRESH_TEST_POLL_INTERVAL_MS,
  FRESH_TEST_POLL_MAX_ATTEMPTS,
} from "../../../lib/fresh-test-readiness";

export interface FreshTestReadinessPollerProps {
  enabled: boolean;
}

export function FreshTestReadinessPoller({ enabled }: FreshTestReadinessPollerProps) {
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
      if (currentAttempt >= FRESH_TEST_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
      }
    }, FRESH_TEST_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, router]);

  if (!enabled) {
    return null;
  }

  return (
    <p className="muted" aria-live="polite">
      {attempts >= FRESH_TEST_POLL_MAX_ATTEMPTS
        ? "The fresh test is still running. Automatic checks stopped after five minutes; refresh this page or open run diagnostics to check again."
        : "The fresh test is running in cloud execution. This page checks durable run state every five seconds."}
    </p>
  );
}
