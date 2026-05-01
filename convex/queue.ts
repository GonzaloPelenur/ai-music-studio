import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const DEFAULT_STALE_MS = 120_000;

export const enqueue = mutation({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<Id<"queueTickets">> => {
    return await ctx.db.insert("queueTickets", {
      enqueuedAt: now,
      heartbeatAt: now,
      status: "waiting",
    });
  },
});

export const tryAcquire = mutation({
  args: {
    ticketId: v.id("queueTickets"),
    now: v.number(),
    staleMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { ticketId, now, staleMs = DEFAULT_STALE_MS },
  ): Promise<{ acquired: boolean; position?: number }> => {
    const cutoff = now - staleMs;

    // Sweep stale tickets so a crashed holder can't deadlock the queue.
    const allTickets = await ctx.db
      .query("queueTickets")
      .withIndex("by_status_enqueued")
      .collect();
    for (const t of allTickets) {
      if (t.heartbeatAt < cutoff) {
        await ctx.db.delete(t._id);
      }
    }

    const my = await ctx.db.get(ticketId);
    if (!my) {
      // We were swept (probably crashed). Re-insert to retry.
      throw new Error(
        "TICKET_SWEPT: ticket was removed (likely stale). Caller should re-enqueue.",
      );
    }

    if (my.status === "active") {
      return { acquired: true };
    }

    // Anyone else holding the slot?
    const fresh = await ctx.db
      .query("queueTickets")
      .withIndex("by_status_enqueued", (q) => q.eq("status", "active"))
      .collect();
    if (fresh.some((t) => t._id !== ticketId && t.heartbeatAt >= cutoff)) {
      const ahead = await ctx.db
        .query("queueTickets")
        .withIndex("by_status_enqueued", (q) => q.eq("status", "waiting"))
        .order("asc")
        .collect();
      const position = ahead.findIndex((t) => t._id === ticketId);
      return { acquired: false, position: position < 0 ? 0 : position };
    }

    // No active holder. Am I the oldest waiting?
    const waiters = await ctx.db
      .query("queueTickets")
      .withIndex("by_status_enqueued", (q) => q.eq("status", "waiting"))
      .order("asc")
      .collect();
    if (waiters.length === 0 || waiters[0]._id !== ticketId) {
      const position = waiters.findIndex((t) => t._id === ticketId);
      return { acquired: false, position: position < 0 ? 0 : position };
    }

    await ctx.db.patch(ticketId, { status: "active", heartbeatAt: now });
    return { acquired: true };
  },
});

export const heartbeat = mutation({
  args: { ticketId: v.id("queueTickets"), now: v.number() },
  handler: async (ctx, { ticketId, now }) => {
    const t = await ctx.db.get(ticketId);
    if (t) await ctx.db.patch(ticketId, { heartbeatAt: now });
  },
});

export const release = mutation({
  args: { ticketId: v.id("queueTickets") },
  handler: async (ctx, { ticketId }) => {
    const t = await ctx.db.get(ticketId);
    if (t) await ctx.db.delete(ticketId);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("queueTickets").collect();
    return {
      waiting: all.filter((t) => t.status === "waiting").length,
      active: all.filter((t) => t.status === "active").length,
    };
  },
});
