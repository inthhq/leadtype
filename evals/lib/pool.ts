/**
 * Run `worker` over `items` with at most `concurrency` in flight. Workers pull
 * from a shared cursor, so a slow item doesn't stall the others. Order of
 * completion is not preserved — callers that need ordered results should key
 * off the item, not the finish order. Used to parallelize the eval matrix
 * (each cell is an independent sandbox + model call), keeping wall-clock
 * reasonable for 500–1500 runs.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor++;
      if (index >= items.length) {
        return;
      }
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}
