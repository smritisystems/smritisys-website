/**
 * SMRITISYS Pages Functions
 * Handles: /api/demo, /api/signup, /api/login, /api/me, /api/demos
 * Auto-deploys with Cloudflare Pages on every GitHub push
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + "smritisys-salt-v1");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleDemo(request, env) {
  const body = await request.json();
  const { name, email, phone, stores, message } = body;
  if (!name || !email) return json({ ok: false, error: "Name and email are required" }, 400);

  await env.DB.prepare(
    `INSERT INTO demo_requests (name, email, phone, stores, message) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(name, email, phone || null, stores || null, message || null)
    .run();

  return json({ ok: true, message: "Demo request received. We will contact you soon." });
}

async function handleSignup(request, env) {
  const body = await request.json();
  const { type, email, password, name, phone, company } = body;

  if (!email || !password || !type) {
    return json({ ok: false, error: "type, email and password are required" }, 400);
  }
  if (!["user", "customer"].includes(type)) {
    return json({ ok: false, error: "type must be 'user' or 'customer'" }, 400);
  }

  const password_hash = await hashPassword(password);

  try {
    if (type === "user") {
      await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)`
      )
        .bind(email.toLowerCase(), password_hash, name || null, "staff")
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO customers (email, password_hash, name, phone, company) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(email.toLowerCase(), password_hash, name || null, phone || null, company || null)
        .run();
    }
    return json({ ok: true, message: "Account created successfully" });
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return json({ ok: false, error: "Email already registered" }, 409);
    }
    return json({ ok: false, error: "Signup failed" }, 500);
  }
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { type, email, password } = body;

  if (!email || !password || !type) {
    return json({ ok: false, error: "type, email and password are required" }, 400);
  }

  const password_hash = await hashPassword(password);
  let row = null;

  if (type === "user") {
    row = await env.DB.prepare(
      `SELECT id, email, name, role, status FROM users WHERE email = ? AND password_hash = ?`
    )
      .bind(email.toLowerCase(), password_hash)
      .first();
  } else if (type === "customer") {
    row = await env.DB.prepare(
      `SELECT id, email, name, phone, company, status FROM customers WHERE email = ? AND password_hash = ?`
    )
      .bind(email.toLowerCase(), password_hash)
      .first();
  } else {
    return json({ ok: false, error: "type must be 'user' or 'customer'" }, 400);
  }

  if (!row) return json({ ok: false, error: "Invalid email or password" }, 401);
  if (row.status !== "active" && row.status !== "trial") {
    return json({ ok: false, error: "Account is not active" }, 403);
  }

  const token = makeToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, type, row.id, expires)
    .run();

  return json({ ok: true, token, account_type: type, user: row });
}

async function handleMe(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return json({ ok: false, error: "No token" }, 401);

  const session = await env.DB.prepare(
    `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  )
    .bind(token)
    .first();

  if (!session) return json({ ok: false, error: "Invalid or expired session" }, 401);

  let account = null;
  if (session.account_type === "user") {
    account = await env.DB.prepare(
      `SELECT id, email, name, role, status FROM users WHERE id = ?`
    )
      .bind(session.account_id)
      .first();
  } else {
    account = await env.DB.prepare(
      `SELECT id, email, name, phone, company, status FROM customers WHERE id = ?`
    )
      .bind(session.account_id)
      .first();
  }

  return json({ ok: true, account_type: session.account_type, user: account });
}

async function handleListDemos(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return json({ ok: false, error: "Login required" }, 401);

  const session = await env.DB.prepare(
    `SELECT * FROM sessions WHERE token = ? AND account_type = 'user' AND expires_at > datetime('now')`
  )
    .bind(token)
    .first();

  if (!session) return json({ ok: false, error: "Staff login required" }, 403);

  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, stores, status, created_at FROM demo_requests ORDER BY created_at DESC LIMIT 100`
  ).all();

  return json({ ok: true, demos: results });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "") || "";

  if (request.method === "OPTIONS") return cors();

  try {
    if (path === "demo" && request.method === "POST") return await handleDemo(request, env);
    if (path === "signup" && request.method === "POST") return await handleSignup(request, env);
    if (path === "login" && request.method === "POST") return await handleLogin(request, env);
    if (path === "me" && request.method === "GET") return await handleMe(request, env);
    if (path === "demos" && request.method === "GET") return await handleListDemos(request, env);
    return json({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Server error" }, 500);
  }
}
