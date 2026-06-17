export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  available(): number;
}

export function createSemaphore(max: number): Semaphore {
  let current = 0;
  const queue: Array<() => void> = [];

  return {
    acquire(): Promise<void> {
      if (current < max) {
        current++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        queue.push(() => {
          current++;
          resolve();
        });
      });
    },

    release(): void {
      current--;
      const next = queue.shift();
      if (next) next();
    },

    available(): number {
      return max - current;
    },
  };
}
