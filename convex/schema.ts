import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  queueTickets: defineTable({
    enqueuedAt: v.number(),
    heartbeatAt: v.number(),
    status: v.union(v.literal("waiting"), v.literal("active")),
  }).index("by_status_enqueued", ["status", "enqueuedAt"]),
});
