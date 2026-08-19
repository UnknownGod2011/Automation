import type { HumanResumeExecutionLease } from "./human-resume-lease.js";

export type HumanResumeLeaseRenewal = (
  lease: HumanResumeExecutionLease,
) => Promise<HumanResumeExecutionLease>;

/**
 * Keeps a human-resume execution lease alive while one worker owns browser/model
 * execution. Renewals are serialized so timer-driven and boundary-driven renewals
 * cannot race and regress the in-memory lease. Once any renewal is uncertain or
 * rejected, ownership is permanently considered lost for this worker instance.
 */
export class HumanResumeLeaseHeartbeat {
  private lease: HumanResumeExecutionLease;
  private renewalInFlight: Promise<HumanResumeExecutionLease> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ownershipLost = false;

  constructor(
    initialLease: HumanResumeExecutionLease,
    private readonly renew: HumanResumeLeaseRenewal,
    private readonly intervalMs: number,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new Error("human resume lease heartbeat interval must be a positive safe integer");
    }
    this.lease = initialLease;
  }

  start(): void {
    this.assertOwned();
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.renewalInFlight) {
      try {
        await this.renewalInFlight;
      } catch {
        // Ownership loss is retained and surfaced by assertOwned/renewNow.
      }
    }
  }

  currentLease(): HumanResumeExecutionLease {
    return this.lease;
  }

  assertOwned(): void {
    if (this.ownershipLost) {
      throw new Error("human resume execution lease heartbeat lost ownership");
    }
  }

  async renewNow(): Promise<HumanResumeExecutionLease> {
    this.assertOwned();
    if (this.renewalInFlight) return this.renewalInFlight;

    const operation = this.renew(this.lease)
      .then((next) => {
        this.lease = next;
        return next;
      })
      .catch(() => {
        this.ownershipLost = true;
        throw new Error("human resume execution lease heartbeat lost ownership");
      })
      .finally(() => {
        this.renewalInFlight = null;
      });

    this.renewalInFlight = operation;
    return operation;
  }

  async runFenced<T>(operation: () => Promise<T>): Promise<T> {
    await this.renewNow();
    try {
      const result = await operation();
      this.assertOwned();
      return result;
    } catch (error) {
      this.assertOwned();
      throw error;
    }
  }

  private schedule(): void {
    if (!this.running || this.ownershipLost || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ownershipLost) return;
    try {
      await this.renewNow();
    } catch {
      return;
    }
    this.schedule();
  }
}
