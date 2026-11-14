/**
 * @file        [[path]].js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS license source protection
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-14
 * @updated     2026-11-14
 *
 * @description Prevents internal signer files from being served as site assets.
 */

export function onRequest() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
