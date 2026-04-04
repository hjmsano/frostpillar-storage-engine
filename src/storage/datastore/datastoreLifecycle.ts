import { ClosedDatastoreError } from '../../errors/index.js';

export class DatastoreLifecycle {
  private closed: boolean;
  private closing: boolean;
  private closeInFlight: Promise<void> | null;
  private activeOperationCount: number;
  private activeOperationsDrained: Promise<void> | null;
  private resolveActiveOperationsDrained: (() => void) | null;

  public constructor() {
    this.closed = false;
    this.closing = false;
    this.closeInFlight = null;
    this.activeOperationCount = 0;
    this.activeOperationsDrained = null;
    this.resolveActiveOperationsDrained = null;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public markClosing(): void {
    this.closing = true;
  }

  public markClosed(): void {
    this.closed = true;
    this.closing = false;
  }

  public getCloseInFlight(): Promise<void> | null {
    return this.closeInFlight;
  }

  public setCloseInFlight(closeInFlight: Promise<void> | null): void {
    this.closeInFlight = closeInFlight;
  }

  public ensureOpen(): void {
    if (this.closed || this.closing) {
      throw new ClosedDatastoreError('Datastore has been closed.');
    }
  }

  public beginOperation(): void {
    this.ensureOpen();
    this.activeOperationCount += 1;
  }

  public endOperation(): void {
    this.activeOperationCount -= 1;
    if (
      this.activeOperationCount === 0 &&
      this.resolveActiveOperationsDrained !== null
    ) {
      const resolve = this.resolveActiveOperationsDrained;
      this.resolveActiveOperationsDrained = null;
      this.activeOperationsDrained = null;
      resolve();
    }
  }

  public waitForActiveOperationsToDrain(): Promise<void> {
    if (this.activeOperationCount === 0) {
      return Promise.resolve();
    }
    if (this.activeOperationsDrained === null) {
      this.activeOperationsDrained = new Promise<void>((resolve): void => {
        this.resolveActiveOperationsDrained = resolve;
      });
    }
    return this.activeOperationsDrained;
  }
}
