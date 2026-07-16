export function fairFamilyQueue<T extends { family_id: string }>(items: T[], limit: number) {
  const queues = new Map<string, T[]>();
  for (const item of items) queues.set(item.family_id, [...(queues.get(item.family_id) ?? []), item]);
  const result: T[] = [];
  while (result.length < limit && queues.size) {
    for (const [familyId, queue] of queues) {
      const item = queue.shift();
      if (item) result.push(item);
      if (!queue.length) queues.delete(familyId);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export async function runBounded<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const bounded = Math.max(1, Math.min(8, Math.floor(concurrency)));
  let cursor = 0;
  const runners = Array.from({ length: Math.min(bounded, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}
