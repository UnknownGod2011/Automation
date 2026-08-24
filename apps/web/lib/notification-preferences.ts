export interface NotificationPreferenceCopy {
  failure: string;
  success: string;
  attention: string;
}

/**
 * Product copy for notification preferences. Human-attention pauses are intentionally
 * mandatory because they require owner action; the failure preference controls only
 * terminal ordinary failures.
 */
export function notificationPreferenceCopy(): NotificationPreferenceCopy {
  return {
    failure: "Notify me when a run fails.",
    success: "Send a completion notification after successful runs.",
    attention: "Runs that pause for human attention always notify you so authentication or other required action is not missed.",
  };
}
