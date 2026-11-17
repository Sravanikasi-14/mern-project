import { connectCentralDB } from "../config/db.js";
import { getRateLimitHitModel } from "../models/RateLimitHit.js";

function shouldFailClosed() {
  if (process.env.RATE_LIMIT_FAIL_CLOSED === "false") return false;
  if (process.env.RATE_LIMIT_FAIL_CLOSED === "true") return true;
  return process.env.NODE_ENV === "production";
}

function failClosedResponse(windowMs) {
  return {
    totalHits: Number.MAX_SAFE_INTEGER,
    resetTime: new Date(Date.now() + Math.max(1000, windowMs || 60_000)),
  };
}

/**
 * express-rate-limit Store backed by central MongoDB.
 * Atomic $inc upserts keep counters consistent across Vercel instances.
 *
 * Production: store failures fail closed (treat as over-limit), never MemoryStore.
 * Each limiter must receive its own store instance (unique prefix).
 *
 * @param {{ prefix: string }} options
 */
export function createMongoRateLimitStore({ prefix }) {
  if (!prefix || typeof prefix !== "string") {
    throw new Error("createMongoRateLimitStore requires a non-empty prefix");
  }

  return {
    prefix,
    localKeys: false,
    windowMs: 60_000,

    init(options) {
      if (options?.windowMs) {
        this.windowMs = options.windowMs;
      }
    },

    async _docId(key) {
      const windowMs = this.windowMs || 60_000;
      const bucket = Math.floor(Date.now() / windowMs);
      return `${this.prefix}${key}:${bucket}`;
    },

    async increment(key) {
      const windowMs = this.windowMs || 60_000;
      try {
        await connectCentralDB();
        const Model = getRateLimitHitModel();
        const id = await this._docId(key);
        const bucket = Math.floor(Date.now() / windowMs);
        const resetTime = new Date((bucket + 1) * windowMs);

        const doc = await Model.findOneAndUpdate(
          { _id: id },
          {
            $inc: { hits: 1 },
            $setOnInsert: { expiresAt: resetTime },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );

        return {
          totalHits: Number(doc?.hits) || 1,
          resetTime: doc?.expiresAt ? new Date(doc.expiresAt) : resetTime,
        };
      } catch (error) {
        console.error(
          `[rate-limit] Mongo store increment failed (${this.prefix}):`,
          error?.message || error
        );
        if (shouldFailClosed()) {
          return failClosedResponse(windowMs);
        }
        throw error;
      }
    },

    async decrement(key) {
      const windowMs = this.windowMs || 60_000;
      try {
        await connectCentralDB();
        const Model = getRateLimitHitModel();
        const id = await this._docId(key);
        await Model.findOneAndUpdate(
          { _id: id, hits: { $gt: 0 } },
          { $inc: { hits: -1 } }
        );
      } catch (error) {
        console.error(
          `[rate-limit] Mongo store decrement failed (${this.prefix}):`,
          error?.message || error
        );
        if (shouldFailClosed()) return;
        throw error;
      }
    },

    async resetKey(key) {
      try {
        await connectCentralDB();
        const Model = getRateLimitHitModel();
        const windowMs = this.windowMs || 60_000;
        const bucket = Math.floor(Date.now() / windowMs);
        const id = `${this.prefix}${key}:${bucket}`;
        await Model.deleteOne({ _id: id });
      } catch (error) {
        console.error(
          `[rate-limit] Mongo store resetKey failed (${this.prefix}):`,
          error?.message || error
        );
        if (shouldFailClosed()) return;
        throw error;
      }
    },

    async resetAll() {
      try {
        await connectCentralDB();
        const Model = getRateLimitHitModel();
        await Model.deleteMany({ _id: { $regex: `^${escapeRegex(this.prefix)}` } });
      } catch (error) {
        console.error(
          `[rate-limit] Mongo store resetAll failed (${this.prefix}):`,
          error?.message || error
        );
        if (shouldFailClosed()) return;
        throw error;
      }
    },
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
