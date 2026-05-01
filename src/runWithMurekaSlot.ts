import type { AgentContext } from "@grexal/sdk";
import { enqueue, tryAcquire, heartbeat, release } from "./queue-client.js";

const POLL_MS = 2_000;
const HEARTBEAT_MS = 5_000;

/**
 * Acquires the global Mureka concurrency slot via the Convex FIFO queue,
 * runs `fn`, then releases.
 *
 * Mureka's trial plan permits 1 concurrent song-generation request. Without
 * this gate, two simultaneous Grexal runs would have the second one fail
 * with a "concurrent requests limit 1" error. With it, runs serialise.
 */
export async function runWithMurekaSlot<T>(
  ctx: AgentContext,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const ticketId = await enqueue();
  let lastLoggedPosition = -1;
  const hb = setInterval(() => {
    heartbeat(ticketId).catch(() => {});
  }, HEARTBEAT_MS);

  try {
    while (true) {
      const r = await tryAcquire(ticketId);
      if (r.acquired) break;
      const pos = r.position ?? 0;
      if (pos !== lastLoggedPosition) {
        await ctx.log(`${label}: waiting in Mureka queue (position ${pos})…`);
        lastLoggedPosition = pos;
      }
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
    await ctx.log(`${label}: acquired Mureka slot, calling API…`);
    return await fn();
  } finally {
    clearInterval(hb);
    await release(ticketId).catch(() => {});
  }
}
