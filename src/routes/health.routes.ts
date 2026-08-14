import { Router } from "express";
import { pool } from "../db/pool";
import { redis } from "../db/redis";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const checks = { postgres: false, redis: false };

  try {
    await pool.query("SELECT 1");
    checks.postgres = true;
  } catch {
    checks.postgres = false;
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  const healthy = checks.postgres && checks.redis;
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});
