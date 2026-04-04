export class AsyncMutex {
  private queue: (() => void)[] = [];
  private head = 0;
  private locked = false;

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.createRelease());
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(this.createRelease()));
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.head < this.queue.length) {
        const next = this.queue[this.head];
        this.queue[this.head] = undefined!; // allow GC
        this.head += 1;
        // Compact when more than half the array is dead entries and above threshold
        if (this.head > 1024 && this.head > (this.queue.length >>> 1)) {
          this.queue = this.queue.slice(this.head);
          this.head = 0;
        }
        next();
      } else {
        this.queue.length = 0;
        this.head = 0;
        this.locked = false;
      }
    };
  }
}
