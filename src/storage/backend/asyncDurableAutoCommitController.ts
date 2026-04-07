import { createAggregateError, toErrorInstance } from '../../errors/index.js';
import type { FileAutoCommitState, IntervalTimerHandle } from './types.js';

type CommitRequestType = 'foreground' | 'background';

export abstract class AsyncDurableAutoCommitController {
  private readonly autoCommit: FileAutoCommitState;
  private readonly onAutoCommitError: (error: unknown) => void;
  private pendingAutoCommitBytes: number;
  private dirtyFromClear: boolean;
  private autoCommitTimer: IntervalTimerHandle | null;
  private commitInFlight: Promise<void> | null;
  private pendingForegroundCommitRequest: boolean;
  private pendingBackgroundCommitRequest: boolean;
  private closed: boolean;

  protected constructor(
    autoCommit: FileAutoCommitState,
    onAutoCommitError: (error: unknown) => void,
  ) {
    this.autoCommit = autoCommit;
    this.onAutoCommitError = onAutoCommitError;
    this.pendingAutoCommitBytes = 0;
    this.dirtyFromClear = false;
    this.autoCommitTimer = null;
    this.commitInFlight = null;
    this.pendingForegroundCommitRequest = false;
    this.pendingBackgroundCommitRequest = false;
    this.closed = false;
    this.startAutoCommitSchedule();
  }

  public handleRecordAppended(encodedBytes: number): Promise<void> {
    if (this.autoCommit.frequency === 'immediate') {
      return this.commitNow();
    }

    this.pendingAutoCommitBytes += encodedBytes;
    if (
      this.autoCommit.maxPendingBytes !== null &&
      this.pendingAutoCommitBytes >= this.autoCommit.maxPendingBytes
    ) {
      return this.queueCommitRequest('foreground');
    }

    return Promise.resolve();
  }

  public handleCleared(): Promise<void> {
    this.dirtyFromClear = true;
    if (this.autoCommit.frequency === 'immediate') {
      return this.commitNow();
    }
    return this.queueCommitRequest('background');
  }

  public commitNow(): Promise<void> {
    return this.queueCommitRequest('foreground');
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopAutoCommitSchedule();
    await this.waitForCommitSettlement();
    let flushError: Error | null = null;
    if (this.pendingAutoCommitBytes > 0 || this.dirtyFromClear) {
      try {
        await this.executeSingleCommit();
        this.pendingAutoCommitBytes = 0;
        this.dirtyFromClear = false;
      } catch (error) {
        flushError = toErrorInstance(
          error,
          'Final close-time flush commit failed with a non-Error value.',
        );
      }
    }
    let drainError: Error | null = null;
    try {
      await this.onCloseAfterDrain();
    } catch (error) {
      drainError = toErrorInstance(
        error,
        'onCloseAfterDrain failed with a non-Error value.',
      );
    }
    if (flushError !== null && drainError !== null) {
      throw createAggregateError(
        [flushError, drainError],
        'Close failed: both final flush and drain produced errors.',
      );
    }
    if (flushError !== null) {
      throw flushError;
    }
    if (drainError !== null) {
      throw drainError;
    }
  }

  protected getPendingAutoCommitBytes(): number {
    return this.pendingAutoCommitBytes;
  }

  protected abstract executeSingleCommit(): Promise<void>;

  protected onCloseAfterDrain(): Promise<void> {
    return Promise.resolve();
  }

  private waitForCommitSettlement(): Promise<void> {
    if (this.commitInFlight === null) {
      return Promise.resolve();
    }
    return this.commitInFlight
      .then((): void => undefined)
      .catch((): void => undefined);
  }

  private queueCommitRequest(requestType: CommitRequestType): Promise<void> {
    if (requestType === 'foreground') {
      this.pendingForegroundCommitRequest = true;
    } else {
      this.pendingBackgroundCommitRequest = true;
    }

    if (this.commitInFlight === null) {
      this.commitInFlight = this.runCommitLoop().finally((): void => {
        this.commitInFlight = null;
      });
    }

    if (requestType === 'background') {
      return Promise.resolve();
    }

    return this.commitInFlight;
  }

  private async runCommitLoop(): Promise<void> {
    let shouldContinue = true;
    while (shouldContinue) {
      const runForeground = this.pendingForegroundCommitRequest;
      const runBackground = this.pendingBackgroundCommitRequest;
      const runClear = this.dirtyFromClear;
      this.pendingForegroundCommitRequest = false;
      this.pendingBackgroundCommitRequest = false;
      this.dirtyFromClear = false;

      const shouldRunCommit =
        runForeground || (runBackground && (this.pendingAutoCommitBytes > 0 || runClear));
      if (!shouldRunCommit) {
        shouldContinue = false;
        continue;
      }

      try {
        const committedPendingBytes = this.pendingAutoCommitBytes;
        await this.executeSingleCommit();
        this.pendingAutoCommitBytes = Math.max(
          0,
          this.pendingAutoCommitBytes - committedPendingBytes,
        );
      } catch (error) {
        if (runClear) {
          this.dirtyFromClear = true;
        }
        if (runForeground) {
          throw toErrorInstance(
            error,
            'Foreground auto-commit failed with a non-Error value.',
          );
        }
        this.onAutoCommitError(error);
      }

      if (!this.pendingForegroundCommitRequest && !this.pendingBackgroundCommitRequest) {
        shouldContinue = false;
      }
    }
  }

  private startAutoCommitSchedule(): void {
    if (
      this.autoCommit.frequency !== 'scheduled' ||
      this.autoCommit.intervalMs === null
    ) {
      return;
    }

    this.autoCommitTimer = setInterval((): void => {
      this.handleAutoCommitTick();
    }, this.autoCommit.intervalMs);
    if (typeof this.autoCommitTimer === 'object' && this.autoCommitTimer !== null && 'unref' in this.autoCommitTimer) {
      (this.autoCommitTimer as { unref: () => void }).unref();
    }
  }

  private stopAutoCommitSchedule(): void {
    if (this.autoCommitTimer === null) {
      return;
    }
    clearInterval(this.autoCommitTimer);
    this.autoCommitTimer = null;
  }

  private handleAutoCommitTick(): void {
    if (this.closed) {
      return;
    }
    if (this.pendingAutoCommitBytes <= 0 && !this.dirtyFromClear) {
      return;
    }
    void this.queueCommitRequest('background');
  }
}
