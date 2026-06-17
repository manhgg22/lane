import { describe, it, expect } from "vitest";
import { createSemaphore } from "./semaphore.js";

describe("semaphore", () => {
  it("allows up to max concurrent acquires", async () => {
    const sem = createSemaphore(2);

    await sem.acquire();
    await sem.acquire();
    expect(sem.available()).toBe(0);

    sem.release();
    expect(sem.available()).toBe(1);

    sem.release();
    expect(sem.available()).toBe(2);
  });

  it("queues when full and releases in order", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];

    await sem.acquire();
    order.push(1);

    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release();
    await p2;

    sem.release();
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("handles concurrent tasks with max limit", async () => {
    const sem = createSemaphore(3);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      await sem.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      sem.release();
    };

    await Promise.all(Array.from({ length: 10 }, () => task()));

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(sem.available()).toBe(3);
  });
});
