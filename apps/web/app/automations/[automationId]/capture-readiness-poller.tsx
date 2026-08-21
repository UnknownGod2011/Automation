"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPTURE_READINESS_POLL_INTERVAL_MS,
  CAPTURE_READINESS_POLL_MAX_ATTEMPTS,
} from "../../../lib/capture-readiness";

export interface CaptureReadinessPollerProps {
  enabled: boolean;
}

export function CaptureReadinessPoller({ enabled }: CaptureReadinessPollerProps) {
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
      if (currentAttempt >= CAPTURE_READINESS_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
      }
    }, CAPTURE_READINESS_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, router]);

  if (!enabled) {
    return null;
  }

  return (
    <p className="muted" aria-live="polite">
      {attempts >= CAPTURE_READINESS_POLL_MAX_ATTEMPTS
        ? "Capture is still finalizing. Automatic checks stopped after two minutes; use Refresh capture state to check again."
        : "Capture is finalizing. This page checks automatically every two seconds until Compile is ready."}
    </p>
  );
}
