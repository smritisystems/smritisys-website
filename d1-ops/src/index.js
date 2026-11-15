/**
 * @file        index.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS D1 operations
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-15
 * @updated     2026-11-15
 *
 * @description Samples the canonical D1 database for capacity monitoring.
 */
export async function sampleD1Database(env, scheduledTime) {
  const sampledAt = new Date(scheduledTime).toISOString();
  const result = await env.DB.prepare("SELECT 1 AS health_check").run();
  const sizeBytes = Number(result.meta?.size_after);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`D1 size metadata was unavailable for ${env.DATABASE_NAME}`);
  }

  await env.DB.prepare(
    `INSERT INTO d1_storage_snapshots (database_id, database_name, sampled_at, size_bytes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(database_id, sampled_at) DO UPDATE SET size_bytes = excluded.size_bytes`
  ).bind(env.DATABASE_ID, env.DATABASE_NAME, sampledAt, sizeBytes).run();
  const samples = [{ databaseName: env.DATABASE_NAME, sizeBytes }];
  console.log(JSON.stringify({ event: "d1_storage_sample_completed", sampledAt, samples }));
}

export default {
  scheduled(controller, env, ctx) {
    const sampling = sampleD1Database(env, controller.scheduledTime).catch((error) => {
      console.error(JSON.stringify({
        event: "d1_storage_sample_failed",
        cron: controller.cron,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    });
    ctx.waitUntil(sampling);
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
