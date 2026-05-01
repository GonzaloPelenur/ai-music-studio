import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { env } from "./env.js";

let _client: ConvexHttpClient | null = null;

function client(): ConvexHttpClient {
  if (!_client) _client = new ConvexHttpClient(env.convexUrl);
  return _client;
}

export type TicketId = Id<"queueTickets">;

export async function enqueue(): Promise<TicketId> {
  return await client().mutation(api.queue.enqueue, { now: Date.now() });
}

export async function tryAcquire(
  ticketId: TicketId,
): Promise<{ acquired: boolean; position?: number }> {
  return await client().mutation(api.queue.tryAcquire, {
    ticketId,
    now: Date.now(),
  });
}

export async function heartbeat(ticketId: TicketId): Promise<void> {
  await client().mutation(api.queue.heartbeat, {
    ticketId,
    now: Date.now(),
  });
}

export async function release(ticketId: TicketId): Promise<void> {
  await client().mutation(api.queue.release, { ticketId });
}
