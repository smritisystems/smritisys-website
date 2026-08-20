/**
 * SMRITISYS Pages Functions
 * Handles account, profile, support ticket, and demo APIs.
 * Auto-deploys with Cloudflare Pages on every GitHub push
 */

function isTrustedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configuredOrigins = typeof env.ALLOWED_ORIGINS === "string" ? env.ALLOWED_ORIGINS : "";
  if (!configuredOrigins.trim()) return null;
  const allowedOrigins = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : null;
}

function json(data, status = 200, origin = null) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function cors(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

async function hashLegacyPassword(password) {
  const data = new TextEncoder().encode(password + "smritisys-salt-v1");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const iterations = 120000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2-sha256$${iterations}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith("pbkdf2-sha256$")) {
    return (await hashLegacyPassword(password)) === storedHash;
  }

  const [, prefix, algorithm, iterationsText, saltHex, expectedHash] = storedHash.match(/^(pbkdf2)-(sha256)\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/) || [];
  if (!prefix || !algorithm || !iterationsText || !saltHex || !expectedHash) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((value) => parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterationsText), hash: "SHA-256" }, key, 256);
  const actualHash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return actualHash === expectedHash;
}

function makeToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCustomerSession(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal || principal.account_type !== "customer") return null;
  return principal;
}

async function getIdentitySession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;

  return await env.DB.prepare(
    `SELECT s.account_type, s.account_id, p.id AS person_id, p.email, p.name,
            p.status AS person_status, m.organization_id, m.member_role,
            m.status AS membership_status, o.status AS organization_status
     FROM sessions s
     JOIN people p ON p.source_type = s.account_type AND p.source_id = s.account_id
     JOIN organization_members m ON m.account_type = s.account_type AND m.account_id = s.account_id
     JOIN organizations o ON o.id = m.organization_id
     WHERE s.token = ? AND s.expires_at > datetime('now')
       AND p.status = 'active' AND m.status = 'active' AND o.status = 'active'
     ORDER BY m.id LIMIT 1`
  )
    .bind(token)
    .first();
}

async function hasPermission(env, principal, permission) {
  if (!principal) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM organization_members m
     JOIN roles r ON r.name = m.member_role
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.account_type = ? AND m.account_id = ?
       AND m.status = 'active' AND p.name = ?`
  )
    .bind(principal.organization_id, principal.account_type, principal.account_id, permission)
    .first();
  return Boolean(row);
}

async function getPartnerSession(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal) return null;
  const membership = await env.DB.prepare(
    `SELECT pm.partner_organization_id, pm.partner_role, pm.partner_type,
            o.name AS partner_name, o.status AS partner_status
     FROM partner_memberships pm
     JOIN organizations o ON o.id = pm.partner_organization_id AND o.status = 'active'
     WHERE pm.account_type = ? AND pm.account_id = ? AND pm.status = 'active'
     ORDER BY pm.id LIMIT 1`
  ).bind(principal.account_type, principal.account_id).first();
  if (!membership) return null;
  return { ...principal, ...membership };
}

async function hasPartnerPermission(env, principal, permission) {
  if (!principal) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM partner_memberships pm
     JOIN roles r ON r.name = pm.partner_role
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE pm.partner_organization_id = ? AND pm.account_type = ? AND pm.account_id = ?
       AND pm.status = 'active' AND p.name = ?`
  ).bind(principal.partner_organization_id, principal.account_type, principal.account_id, permission).first();
  return Boolean(row);
}

async function requirePermission(request, env, permission) {
  const principal = await getIdentitySession(request, env);
  if (!principal || !(await hasPermission(env, principal, permission))) return null;
  return principal;
}

async function writeAudit(env, request, principal, action, resourceType, resourceId, oldValue = null, newValue = null) {
  await env.DB.prepare(
    `INSERT INTO audit_logs
     (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      principal?.person_id || null,
      principal?.organization_id || null,
      action,
      resourceType || null,
      resourceId == null ? null : String(resourceId),
      oldValue == null ? null : JSON.stringify(oldValue),
      newValue == null ? null : JSON.stringify(newValue),
      request.headers.get("CF-Connecting-IP") || null,
    )
    .run();
}

const LICENSE_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED", "PENDING_RENEWAL"];
const LICENSE_TRANSITIONS = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "PENDING_RENEWAL", "EXPIRED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  PENDING_RENEWAL: ["ACTIVE", "EXPIRED"],
  EXPIRED: ["ACTIVE"],
  CANCELLED: [],
};

function numericId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function licenseValidity(status, startsAt, expiresAt) {
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = status === "EXPIRED" || (expiresAt && expiresAt < today);
  const isValid = status === "ACTIVE" && (!startsAt || startsAt <= today) && (!expiresAt || expiresAt >= today);
  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000))
    : null;
  return { is_valid: isValid, is_expired: Boolean(isExpired), days_remaining: daysRemaining };
}

function licenseResponse(record) {
  return {
    id: record.id,
    license_key: record.license_key,
    organization_id: record.organization_id,
    customer_id: record.customer_id,
    product: { id: record.product_id, code: record.product_code, name: record.product_name },
    edition: record.edition_id ? { id: record.edition_id, code: record.edition_code, name: record.edition_name } : null,
    status: record.status,
    start_date: record.starts_at,
    expiry_date: record.expires_at,
    validity: licenseValidity(record.status, record.starts_at, record.expires_at),
    created_at: record.created_at || null,
    updated_at: record.updated_at || record.created_at || null,
  };
}

async function getLicenseRecord(env, licenseId) {
  return await env.DB.prepare(
    `SELECT l.id, l.license_key, l.customer_id, l.product_id, l.status,
            l.starts_at, l.expires_at,
            p.slug AS product_code, p.name AS product_name,
            le.edition_id, pe.code AS edition_code, pe.name AS edition_name,
            om.organization_id
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     JOIN organization_members om ON om.account_type = 'customer'
       AND om.account_id = l.customer_id AND om.status = 'active'
     JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
     LEFT JOIN license_editions le ON le.license_id = l.id
     LEFT JOIN product_editions pe ON pe.id = le.edition_id
     WHERE l.id = ? ORDER BY om.id LIMIT 1`
  ).bind(licenseId).first();
}

async function requireLicenseAccess(request, env, licenseId, permission = "license.view") {
  const principal = await requirePermission(request, env, permission);
  if (!principal) return { error: json({ ok: false, error: "License permission required" }, 403) };
  const license = await getLicenseRecord(env, licenseId);
  if (!license) return { error: json({ ok: false, error: "License not found" }, 404) };
  if (principal.account_type === "customer" && license.organization_id !== principal.organization_id) {
    return { error: json({ ok: false, error: "License not found" }, 404) };
  }
  return { principal, license };
}

async function recordLicenseEvent(env, license, principal, eventType, previousStatus, newStatus, metadata = null) {
  await env.DB.prepare(
    `INSERT INTO license_events
     (license_id, organization_id, actor_person_id, event_type, previous_status, new_status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    license.id,
    license.organization_id,
    principal?.person_id || null,
    eventType,
    previousStatus || null,
    newStatus || null,
    metadata == null ? null : JSON.stringify(metadata),
  ).run();
}

function normalizeEntitlements(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const allowedTypes = ["number", "text", "boolean", "json"];
  const normalized = [];
  for (const item of value) {
    if (!item || typeof item.key !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(item.key) || !allowedTypes.includes(item.value_type)) return null;
    if (item.value_type === "number" && (!Number.isFinite(Number(item.value)) || Number(item.value) < 0)) return null;
    normalized.push({
      key: item.key,
      value_type: item.value_type,
      value_text: item.value_type === "number" ? null : item.value_type === "json" ? JSON.stringify(item.value) : String(item.value),
      value_number: item.value_type === "number" ? Number(item.value) : null,
    });
  }
  return normalized;
}

function parseEntitlement(row) {
  let value = row.value_text;
  if (row.value_type === "number") value = row.value_number;
  if (row.value_type === "boolean") value = row.value_text === "true";
  if (row.value_type === "json") {
    try { value = JSON.parse(row.value_text); } catch { value = null; }
  }
  return { key: row.entitlement_key, value_type: row.value_type, value };
}

async function requireSuperAdmin(request, env) {
  const session = await requirePermission(request, env, "admin.system");
  if (!session || session.account_type !== "user" || session.member_role !== "super_admin") return null;
  return session;
}

async function handleProducts(request, env, productId = null) {
  const permission = request.method === "GET" ? "license.view" : "license.create";
  const principal = await requirePermission(request, env, permission);
  if (!principal) return json({ ok: false, error: "Product permission required" }, 403);

  if (productId && request.method === "GET") {
    const product = await env.DB.prepare(
      `SELECT id, slug AS code, name, description, status, created_at
       FROM products WHERE id = ?`
    ).bind(productId).first();
    if (!product) return json({ ok: false, error: "Product not found" }, 404);
    const { results: editions } = await env.DB.prepare(
      `SELECT id, product_id, code, name, description, status, created_at, updated_at
       FROM product_editions WHERE product_id = ? ORDER BY code`
    ).bind(productId).all();
    return json({ ok: true, product: { ...product, editions } });
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, slug AS code, name, description, status, created_at FROM products ORDER BY name`
    ).all();
    return json({ ok: true, products: results });
  }

  const body = await request.json();
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(code) || !name || name.length > 120) {
    return json({ ok: false, error: "A valid product code and name are required" }, 400);
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO products (slug, name, description, price, billing_period, status)
       VALUES (?, ?, ?, 0, 'one_time', 'active')`
    ).bind(code, name, String(body.description || "").slice(0, 2000) || null).run();
    await writeAudit(env, request, principal, "PRODUCT_CREATED", "product", result.meta.last_row_id, null, { code, name });
    return json({ ok: true, product_id: result.meta.last_row_id }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Product code already exists" }, 409);
    throw error;
  }
}

async function handleEditions(request, env, productId) {
  const id = numericId(productId);
  if (!id) return json({ ok: false, error: "A valid product id is required" }, 400);
  const permission = request.method === "GET" ? "license.view" : "license.create";
  const principal = await requirePermission(request, env, permission);
  if (!principal) return json({ ok: false, error: "Edition permission required" }, 403);
  const product = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(id).first();
  if (!product) return json({ ok: false, error: "Product not found" }, 404);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, product_id, code, name, description, status, created_at, updated_at
       FROM product_editions WHERE product_id = ? ORDER BY code`
    ).bind(id).all();
    return json({ ok: true, editions: results });
  }
  const body = await request.json();
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(code) || !name || name.length > 120) {
    return json({ ok: false, error: "A valid edition code and name are required" }, 400);
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO product_editions (product_id, code, name, description)
       VALUES (?, ?, ?, ?)`
    ).bind(id, code, name, String(body.description || "").slice(0, 2000) || null).run();
    await writeAudit(env, request, principal, "EDITION_CREATED", "product_edition", result.meta.last_row_id, null, { product_id: id, code, name });
    return json({ ok: true, edition_id: result.meta.last_row_id }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Edition code already exists" }, 409);
    throw error;
  }
}

async function listLicenses(request, env) {
  const principal = await requirePermission(request, env, "license.view");
  if (!principal) return json({ ok: false, error: "License permission required" }, 403);
  const filter = principal.account_type === "customer" ? "AND om.organization_id = ?" : "";
  const bindings = principal.account_type === "customer" ? [principal.organization_id] : [];
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.license_key, l.customer_id, l.product_id, l.status, l.starts_at, l.expires_at,
            om.organization_id, p.slug AS product_code, p.name AS product_name,
            le.edition_id, pe.code AS edition_code, pe.name AS edition_name
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = l.customer_id AND om.status = 'active'
     JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
     LEFT JOIN license_editions le ON le.license_id = l.id
     LEFT JOIN product_editions pe ON pe.id = le.edition_id
    WHERE 1 = 1 ${filter} ORDER BY l.id DESC`
  ).bind(...bindings).all();
  return json({ ok: true, licenses: results.map(licenseResponse) });
}

async function createLicense(request, env) {
  const principal = await requirePermission(request, env, "license.create");
  if (!principal) return json({ ok: false, error: "License creation permission required" }, 403);
  const body = await request.json();
  const organizationId = numericId(body.organization_id);
  const productId = numericId(body.product_id);
  const editionId = numericId(body.edition_id);
  const status = body.status || "DRAFT";
  const startsAt = body.start_date || new Date().toISOString().slice(0, 10);
  const expiresAt = body.expiry_date || null;
  if (!organizationId || !productId || !editionId || !LICENSE_STATUSES.includes(status) || !["DRAFT", "ACTIVE"].includes(status)) {
    return json({ ok: false, error: "Organization, product, edition, and a valid initial status are required" }, 400);
  }
  if (expiresAt && expiresAt < startsAt) return json({ ok: false, error: "Expiry date must not precede start date" }, 400);
  const product = await env.DB.prepare(
    `SELECT p.id FROM products p JOIN product_editions e ON e.product_id = p.id
     WHERE p.id = ? AND e.id = ? AND p.status = 'active' AND e.status = 'active'`
  ).bind(productId, editionId).first();
  if (!product) return json({ ok: false, error: "Product and edition do not match or are inactive" }, 400);
  const customer = await env.DB.prepare(
    `SELECT account_id FROM organization_members
     WHERE organization_id = ? AND account_type = 'customer' AND status = 'active' ORDER BY id LIMIT 1`
  ).bind(organizationId).first();
  if (!customer) return json({ ok: false, error: "Organization has no active customer relationship" }, 400);
  const licenseKey = typeof body.license_key === "string" && body.license_key.trim()
    ? body.license_key.trim()
    : `LIC-${makeToken().slice(0, 24).toUpperCase()}`;
  const entitlements = normalizeEntitlements(body.entitlements || []);
  if (!entitlements) return json({ ok: false, error: "Invalid entitlement values" }, 400);
  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO licenses (customer_id, product_id, license_key, seats, starts_at, expires_at, status)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
      ).bind(customer.account_id, productId, licenseKey, startsAt, expiresAt, status),
      env.DB.prepare(
        `INSERT INTO license_editions (license_id, edition_id)
         SELECT id, ? FROM licenses WHERE license_key = ?`
      ).bind(editionId, licenseKey),
    ];
    for (const entitlement of entitlements) {
      statements.push(env.DB.prepare(
        `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number)
         SELECT id, ?, ?, ?, ? FROM licenses WHERE license_key = ?`
      ).bind(entitlement.key, entitlement.value_type, entitlement.value_text, entitlement.value_number, licenseKey));
    }
    statements.push(env.DB.prepare(
      `INSERT INTO license_events (license_id, organization_id, actor_person_id, event_type, new_status, metadata_json)
       SELECT id, ?, ?, 'LICENSE_CREATED', status, ? FROM licenses WHERE license_key = ?`
    ).bind(organizationId, principal.person_id, JSON.stringify({ product_id: productId, edition_id: editionId }), licenseKey));
    await env.DB.batch(statements);
    const license = await getLicenseRecord(env, (await env.DB.prepare("SELECT id FROM licenses WHERE license_key = ?").bind(licenseKey).first()).id);
    await writeAudit(env, request, principal, "LICENSE_CREATED", "license", license.id, null, licenseResponse(license));
    return json({ ok: true, license: licenseResponse(license) }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ ok: false, error: "License key already exists" }, 409);
    throw error;
  }
}

async function handleLicenseEntitlements(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, request.method === "GET" ? "license.view" : "license.manage_entitlements");
  if (access.error) return access.error;
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT entitlement_key, value_type, value_text, value_number, created_at, updated_at
       FROM license_entitlements WHERE license_id = ? ORDER BY entitlement_key`
    ).bind(access.license.id).all();
    return json({ ok: true, entitlements: results.map(parseEntitlement) });
  }
  const body = await request.json();
  const entitlements = normalizeEntitlements([body]);
  if (!entitlements) return json({ ok: false, error: "Invalid entitlement value" }, 400);
  const entitlement = entitlements[0];
  await env.DB.prepare(
    `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(license_id, entitlement_key) DO UPDATE SET
       value_type = excluded.value_type, value_text = excluded.value_text,
       value_number = excluded.value_number, updated_at = datetime('now')`
  ).bind(access.license.id, entitlement.key, entitlement.value_type, entitlement.value_text, entitlement.value_number).run();
  await recordLicenseEvent(env, access.license, access.principal, "ENTITLEMENT_CHANGED", access.license.status, access.license.status, entitlement);
  await writeAudit(env, request, access.principal, "ENTITLEMENT_CHANGED", "license", access.license.id, null, entitlement);
  return json({ ok: true, message: "Entitlement saved" });
}

async function handleLicenseActivations(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  const { results } = await env.DB.prepare(
    `SELECT id, license_id, installation_id, activation_identifier, status,
            activated_at, last_seen_at, deactivated_at, metadata_json
     FROM license_activations WHERE license_id = ? ORDER BY activated_at DESC`
  ).bind(access.license.id).all();
  return json({ ok: true, activations: results.map((activation) => ({
    ...activation,
    metadata: activation.metadata_json ? JSON.parse(activation.metadata_json) : null,
  })) });
}

async function handleLicenseEvents(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  const { results } = await env.DB.prepare(
    `SELECT id, license_id, organization_id, actor_person_id, event_type,
            previous_status, new_status, metadata_json, created_at
     FROM license_events WHERE license_id = ? ORDER BY created_at DESC, id DESC`
  ).bind(access.license.id).all();
  return json({ ok: true, events: results.map((event) => ({
    ...event,
    metadata: event.metadata_json ? JSON.parse(event.metadata_json) : null,
  })) });
}

async function handleLicenseRequest(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  if (access.principal.account_type !== "customer") return json({ ok: false, error: "Customer request required" }, 403);
  const body = await request.json();
  const allowedTypes = ["renewal", "upgrade", "additional_users", "additional_branches", "additional_modules"];
  if (!allowedTypes.includes(body.request_type)) return json({ ok: false, error: "Invalid license request" }, 400);
  await env.DB.prepare(
    `INSERT INTO license_requests (license_id, organization_id, requester_person_id, request_type)
     VALUES (?, ?, ?, ?)`
  ).bind(access.license.id, access.license.organization_id, access.principal.person_id, body.request_type).run();
  await writeAudit(env, request, access.principal, "LICENSE_REQUESTED", "license", access.license.id, null, { request_type: body.request_type });
  return json({ ok: true, message: "Your request has been sent to SMRITISYS." }, 201);
}

async function transitionLicense(request, env, licenseId, action) {
  const permissionByAction = { activate: "license.activate", suspend: "license.suspend", renew: "license.renew" };
  const access = await requireLicenseAccess(request, env, licenseId, permissionByAction[action]);
  if (access.error) return access.error;
  const body = await request.json();
  const currentStatus = access.license.status;
  let nextStatus;
  let eventType;
  let update = null;

  if (action === "activate") {
    if (!body.installation_id || !body.activation_identifier || !["DRAFT", "ACTIVE", "SUSPENDED", "PENDING_RENEWAL"].includes(currentStatus)) {
      return json({ ok: false, error: "A valid activation and transition are required" }, 400);
    }
    nextStatus = "ACTIVE";
    eventType = currentStatus === "DRAFT" ? "LICENSE_ACTIVATED" : currentStatus === "ACTIVE" ? null : "LICENSE_REACTIVATED";
    const metadataJson = body.metadata == null ? null : JSON.stringify(body.metadata);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO license_activations
         (license_id, installation_id, activation_identifier, metadata_json)
         VALUES (?, ?, ?, ?)`
      ).bind(access.license.id, String(body.installation_id).slice(0, 200), String(body.activation_identifier).slice(0, 200), metadataJson),
      env.DB.prepare(
        `UPDATE license_activations SET last_seen_at = datetime('now')
         WHERE license_id = ? AND activation_identifier = ? AND status = 'active'`
      ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)),
      ...(currentStatus === "ACTIVE" ? [] : [env.DB.prepare("UPDATE licenses SET status = ? WHERE id = ?").bind(nextStatus, access.license.id)]),
    ]);
    const activation = await env.DB.prepare(
      "SELECT id FROM license_activations WHERE license_id = ? AND activation_identifier = ?"
    ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)).first();
    const eventExists = await env.DB.prepare(
      `SELECT id FROM license_events WHERE license_id = ? AND event_type = 'ACTIVATION_CREATED'
       AND json_extract(metadata_json, '$.activation_identifier') = ? LIMIT 1`
    ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)).first();
    if (!eventExists) await recordLicenseEvent(env, access.license, access.principal, "ACTIVATION_CREATED", currentStatus, nextStatus, { activation_identifier: body.activation_identifier, activation_id: activation.id });
  } else if (action === "suspend") {
    if (currentStatus !== "ACTIVE") return json({ ok: false, error: "Only active licenses can be suspended" }, 409);
    nextStatus = "SUSPENDED";
    eventType = "LICENSE_SUSPENDED";
    update = {};
  } else {
    if (!["ACTIVE", "PENDING_RENEWAL", "EXPIRED"].includes(currentStatus)) return json({ ok: false, error: "License cannot be renewed from its current state" }, 409);
    const startsAt = body.start_date || new Date().toISOString().slice(0, 10);
    const expiresAt = body.expiry_date;
    if (!expiresAt || expiresAt < startsAt) return json({ ok: false, error: "A valid renewal expiry date is required" }, 400);
    nextStatus = "ACTIVE";
    eventType = "LICENSE_RENEWED";
    update = { startsAt, expiresAt };
  }

  if (action !== "activate") {
    const statements = [env.DB.prepare("UPDATE licenses SET status = ?, starts_at = COALESCE(?, starts_at), expires_at = COALESCE(?, expires_at) WHERE id = ?")
      .bind(nextStatus, update?.startsAt || null, update?.expiresAt || null, access.license.id)];
    await env.DB.batch(statements);
  }
  if (eventType) {
    await recordLicenseEvent(env, access.license, access.principal, eventType, currentStatus, nextStatus, update);
    await writeAudit(env, request, access.principal, eventType, "license", access.license.id, { status: currentStatus }, { status: nextStatus });
  } else if (action === "activate") {
    await writeAudit(env, request, access.principal, "ACTIVATION_CREATED", "license_activation", access.license.id, null, { activation_identifier: body.activation_identifier });
  }
  const license = await getLicenseRecord(env, access.license.id);
  return json({ ok: true, license: licenseResponse(license) });
}

async function patchLicense(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.update");
  if (access.error) return access.error;
  const body = await request.json();
  if (body.status) return json({ ok: false, error: "Use an explicit license transition endpoint" }, 400);
  const startsAt = body.start_date || null;
  const expiresAt = body.expiry_date || null;
  if (startsAt && expiresAt && expiresAt < startsAt) return json({ ok: false, error: "Expiry date must not precede start date" }, 400);
  let editionId = null;
  if (body.edition_id != null) {
    editionId = numericId(body.edition_id);
    const edition = await env.DB.prepare("SELECT id FROM product_editions WHERE id = ? AND product_id = ? AND status = 'active'").bind(editionId, access.license.product_id).first();
    if (!edition) return json({ ok: false, error: "Edition does not belong to this product" }, 400);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET starts_at = COALESCE(?, starts_at), expires_at = COALESCE(?, expires_at) WHERE id = ?").bind(startsAt, expiresAt, access.license.id),
    ...(editionId ? [env.DB.prepare("UPDATE license_editions SET edition_id = ?, updated_at = datetime('now') WHERE license_id = ?").bind(editionId, access.license.id)] : []),
  ]);
  await recordLicenseEvent(env, access.license, access.principal, "LICENSE_UPDATED", access.license.status, access.license.status, { start_date: startsAt, expiry_date: expiresAt, edition_id: editionId });
  await writeAudit(env, request, access.principal, "LICENSE_UPDATED", "license", access.license.id, licenseResponse(access.license), { start_date: startsAt, expiry_date: expiresAt, edition_id: editionId });
  const license = await getLicenseRecord(env, access.license.id);
  return json({ ok: true, license: licenseResponse(license) });
}

async function handleLicenses(request, env, segments) {
  if (!segments.length) return request.method === "GET" ? listLicenses(request, env) : createLicense(request, env);
  const licenseId = numericId(segments[0]);
  if (!licenseId) return json({ ok: false, error: "A valid license id is required" }, 400);
  const child = segments[1];
  if (child === "entitlements" && ["GET", "POST"].includes(request.method)) return handleLicenseEntitlements(request, env, licenseId);
  if (child === "activations" && request.method === "GET") return handleLicenseActivations(request, env, licenseId);
  if (child === "events" && request.method === "GET") return handleLicenseEvents(request, env, licenseId);
  if (child === "requests" && request.method === "POST") return handleLicenseRequest(request, env, licenseId);
  if (["activate", "suspend", "renew"].includes(child) && request.method === "POST") return transitionLicense(request, env, licenseId, child);
  if (!child && request.method === "GET") {
    const access = await requireLicenseAccess(request, env, licenseId, "license.view");
    if (access.error) return access.error;
    return json({ ok: true, license: licenseResponse(access.license) });
  }
  if (!child && request.method === "PATCH") return patchLicense(request, env, licenseId);
  return json({ ok: false, error: "Unsupported license operation" }, 405);
}

async function handleAdminUsers(request, env) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, status, created_at
       FROM users ORDER BY created_at DESC`
    ).all();
    return json({ ok: true, users: results });
  }

  const userId = Number(request.params?.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return json({ ok: false, error: "A valid user id is required" }, 400);
  }
  const body = await request.json();
  const allowedRoles = ["staff", "admin", "super_admin"];
  const allowedStatuses = ["active", "inactive"];
  if (body.role && !allowedRoles.includes(body.role)) {
    return json({ ok: false, error: "Invalid role" }, 400);
  }
  if (body.status && !allowedStatuses.includes(body.status)) {
    return json({ ok: false, error: "Invalid status" }, 400);
  }
  if (userId === session.account_id && body.status === "inactive") {
    return json({ ok: false, error: "You cannot deactivate your own account" }, 400);
  }
  if (userId === session.account_id && body.role && body.role !== "super_admin") {
    return json({ ok: false, error: "You cannot remove your own super admin role" }, 400);
  }

  const target = await env.DB.prepare("SELECT role, status FROM users WHERE id = ?").bind(userId).first();
  if (!target) return json({ ok: false, error: "User not found" }, 404);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET name = COALESCE(?, name), role = COALESCE(?, role), status = COALESCE(?, status)
       WHERE id = ?`
    ).bind(body.name || null, body.role || null, body.status || null, userId),
    env.DB.prepare(
      `UPDATE people SET name = COALESCE(?, name), status = COALESCE(?, status)
       WHERE source_type = 'user' AND source_id = ?`
    ).bind(body.name || null, body.status || null, userId),
    env.DB.prepare(
      `UPDATE organization_members
       SET member_role = COALESCE(?, member_role), status = COALESCE(?, status)
       WHERE account_type = 'user' AND account_id = ?`
    ).bind(body.role || null, body.status || null, userId),
  ]);
  await writeAudit(env, request, session, "MEMBER_ROLE_OR_STATUS_CHANGED", "user", userId, target, {
    role: body.role || target.role,
    status: body.status || target.status,
  });

  return json({ ok: true, message: "User updated" });
}

async function handleAdminControl(request, env, resource) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (resource === "overview") {
    const [users, customers, organizations, products, licenses] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customers").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM organizations").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'active'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM licenses").first(),
    ]);
    return json({ ok: true, metrics: { users: users.count, customers: customers.count, organizations: organizations.count, products: products.count, licenses: licenses.count } });
  }

  if (resource === "organizations") {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.name, o.legal_name, o.status, o.created_at,
              COUNT(DISTINCT m.id) AS member_count
       FROM organizations o
       LEFT JOIN organization_members m ON m.organization_id = o.id AND m.status = 'active'
       GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC`
    ).all();
    return json({ ok: true, organizations: results });
  }

  if (resource === "audit") {
    const { results } = await env.DB.prepare(
      `SELECT id, actor_person_id, organization_id, action, resource_type,
              resource_id, request_ip, created_at
       FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 200`
    ).all();
    return json({ ok: true, audit: results });
  }

  return json({ ok: false, error: "Unsupported admin operation" }, 405);
}

async function handleProfile(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "organization.view"))) {
    return json({ ok: false, error: "Organization access required" }, 403);
  }

  if (request.method === "GET") {
    const profile = await env.DB.prepare(
      `SELECT c.id, c.email, c.name, c.phone, c.company, c.status,
              p.gst_number, p.website, p.bio, p.timezone
       FROM customers c
       LEFT JOIN customer_profiles p ON p.customer_id = c.id
       WHERE c.id = ?`
    )
      .bind(session.account_id)
      .first();
    return json({ ok: true, profile });
  }

  const body = await request.json();
  const { name, phone } = body;
  if (!name) {
    return json({ ok: false, error: "Name is required" }, 400);
  }

  await env.DB.prepare(`UPDATE customers SET name = ?, phone = ? WHERE id = ?`).bind(name, phone || null, session.account_id).run();

  return json({ ok: true, message: "Profile updated" });
}

async function handleOrganization(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "organization.view"))) {
    return json({ ok: false, error: "Organization access required" }, 403);
  }
  const organization = await env.DB.prepare(
    `SELECT o.id, o.name, o.legal_name, o.gst_number, o.status, o.created_at,
            m.member_role AS current_role
     FROM organizations o
     JOIN organization_members m ON m.organization_id = o.id
       AND m.account_type = 'customer' AND m.account_id = ? AND m.status = 'active'
     WHERE o.id = ? AND o.status = 'active'`
  ).bind(session.account_id, session.organization_id).first();
  if (!organization) return json({ ok: false, error: "Organization not found" }, 404);
  const { results: members } = await env.DB.prepare(
    `SELECT p.id, p.name, p.email, m.member_role, m.status
     FROM people p
     JOIN organization_members m ON m.account_type = p.source_type AND m.account_id = p.source_id
     WHERE m.organization_id = ? AND m.status = 'active'
     ORDER BY p.name, p.email`
  ).bind(session.organization_id).all();
  return json({ ok: true, organization, members });
}

async function ensureDefaultAccounts(env, customerId) {
  const defaults = [
    ["1000", "Cash", "asset"],
    ["1100", "Accounts Receivable", "asset"],
    ["2000", "Accounts Payable", "liability"],
    ["4000", "Sales", "income"],
    ["5000", "Purchases", "expense"],
  ];
  const statements = defaults.map(([code, name, accountType]) => env.DB.prepare(
    `INSERT OR IGNORE INTO accounting_accounts (customer_id, code, name, account_type)
     VALUES (?, ?, ?, ?)`
  ).bind(customerId, code, name, accountType));
  await env.DB.batch(statements);
}

async function handleAccounting(request, env, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  return json({ ok: false, error: "Operational accounting belongs to SMRITI Retail OS" }, 403);
  const customerId = session.account_id;
  await ensureDefaultAccounts(env, customerId);

  if (resource === "accounts") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, code, name, account_type, opening_balance, status
         FROM accounting_accounts WHERE customer_id = ? ORDER BY code`
      ).bind(customerId).all();
      return json({ ok: true, accounts: results });
    }

    const body = await request.json();
    const allowedTypes = ["asset", "liability", "income", "expense", "equity"];
    if (!body.code || !body.name || !allowedTypes.includes(body.account_type)) {
      return json({ ok: false, error: "Code, name, and a valid account type are required" }, 400);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO accounting_accounts
         (customer_id, code, name, account_type, opening_balance)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(customerId, body.code, body.name, body.account_type, Number(body.opening_balance) || 0).run();
      return json({ ok: true, message: "Account created" }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Account code already exists" }, 409);
      throw error;
    }
  }

  if (resource === "contacts") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, contact_type, name, email, phone, gst_number, opening_balance, status
         FROM accounting_contacts WHERE customer_id = ? ORDER BY name`
      ).bind(customerId).all();
      return json({ ok: true, contacts: results });
    }
    const body = await request.json();
    if (!body.name || !["customer", "supplier"].includes(body.contact_type)) {
      return json({ ok: false, error: "Name and contact type are required" }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO accounting_contacts
       (customer_id, contact_type, name, email, phone, gst_number, opening_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(customerId, body.contact_type, body.name, body.email || null, body.phone || null, body.gst_number || null, Number(body.opening_balance) || 0).run();
    return json({ ok: true, message: `${body.contact_type === "customer" ? "Customer" : "Supplier"} created` }, 201);
  }

  const simpleDocuments = {
    receipts: { table: "accounting_receipts", number: "receipt_number", contact: "contact_id", reference: "invoice_reference", date: "receipt_date" },
    payments: { table: "accounting_supplier_payments", number: "payment_number", contact: "contact_id", reference: "bill_reference", date: "payment_date" },
    notes: { table: "accounting_notes", number: "note_number", contact: "contact_id", reference: "document_reference", date: "note_date" },
  };
  if (simpleDocuments[resource]) {
    const config = simpleDocuments[resource];
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${config.table} WHERE customer_id = ? ORDER BY ${config.date} DESC, id DESC`
      ).bind(customerId).all();
      return json({ ok: true, [resource]: results });
    }
    const body = await request.json();
    const required = resource === "notes"
      ? [config.number, "note_type", "party_type", config.date, "amount", "reason"]
      : [config.number, config.date, "amount", "payment_mode"];
    if (required.some((field) => !body[field])) {
      return json({ ok: false, error: "Complete the required document fields" }, 400);
    }
    if (resource === "notes" && (!["debit", "credit"].includes(body.note_type) || !["customer", "supplier"].includes(body.party_type))) {
      return json({ ok: false, error: "Invalid note or party type" }, 400);
    }
    try {
      const columns = ["customer_id", config.number, config.contact, config.reference, config.date, "amount"];
      const values = [customerId, body[config.number], body[config.contact] || null, body[config.reference] || null, body[config.date], Number(body.amount) || 0];
      if (resource === "notes") {
        columns.push("note_type", "party_type", "reason");
        values.push(body.note_type, body.party_type, body.reason);
      } else {
        columns.push("payment_mode", "notes");
        values.push(body.payment_mode, body.notes || null);
      }
      const placeholders = columns.map(() => "?").join(", ");
      await env.DB.prepare(`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
      return json({ ok: true, message: `${resource === "receipts" ? "Receipt" : resource === "payments" ? "Supplier payment" : "Note"} saved` }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Document number already exists" }, 409);
      throw error;
    }
  }

  if (resource === "invoices" || resource === "purchases") {
    if (request.method === "GET") {
      const table = resource === "invoices" ? "accounting_invoices" : "accounting_purchases";
      const orderField = resource === "invoices" ? "invoice_date" : "purchase_date";
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE customer_id = ? ORDER BY ${orderField} DESC, id DESC`
      ).bind(customerId).all();
      return json({ ok: true, [resource]: results });
    }

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const isInvoice = resource === "invoices";
    const number = isInvoice ? body.invoice_number : body.bill_number;
    const partyName = isInvoice ? body.buyer_name : body.supplier_name;
    const date = isInvoice ? body.invoice_date : body.purchase_date;
    if (!number || !partyName || !date || !items.length) {
      return json({ ok: false, error: "Document number, party name, date, and at least one item are required" }, 400);
    }

    const normalizedItems = items.map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;
      const taxRate = Number(item.tax_rate) || 0;
      const base = quantity * unitPrice;
      return { description: item.description, quantity, unitPrice, taxRate, lineTotal: base + (base * taxRate / 100) };
    });
    if (normalizedItems.some((item) => !item.description || item.quantity <= 0 || item.unitPrice < 0)) {
      return json({ ok: false, error: "Each item needs a description, positive quantity, and valid price" }, 400);
    }
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const tax = total - subtotal;
    const table = isInvoice ? "accounting_invoices" : "accounting_purchases";
    const numberColumn = isInvoice ? "invoice_number" : "bill_number";
    const partyColumn = isInvoice ? "buyer_name" : "supplier_name";
    const dateColumn = isInvoice ? "invoice_date" : "purchase_date";
    const itemTable = isInvoice ? "accounting_invoice_items" : "accounting_purchase_items";
    const parentColumn = isInvoice ? "invoice_id" : "purchase_id";
    try {
      const parent = await env.DB.prepare(
        `INSERT INTO ${table} (customer_id, ${numberColumn}, ${partyColumn}, ${isInvoice ? "buyer_email, " : ""}${dateColumn}, ${isInvoice ? "due_date, " : ""}subtotal, tax_amount, total_amount)
         VALUES (?, ?, ?, ${isInvoice ? "?, " : ""}?, ${isInvoice ? "?, " : ""}?, ?, ?)`
      ).bind(...(isInvoice
        ? [customerId, number, partyName, body.buyer_email || null, date, body.due_date || null, subtotal, tax, total]
        : [customerId, number, partyName, date, subtotal, tax, total])).run();
      const itemStatements = normalizedItems.map((item) => env.DB.prepare(
        `INSERT INTO ${itemTable} (${parentColumn}, description, quantity, unit_price, tax_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(parent.meta.last_row_id, item.description, item.quantity, item.unitPrice, item.taxRate, item.lineTotal));
      const accountTypes = isInvoice
        ? { debit: "asset", credit: "income" }
        : { debit: "expense", credit: "liability" };
      const accountRows = await env.DB.prepare(
        `SELECT id, account_type FROM accounting_accounts
         WHERE customer_id = ? AND account_type IN (?, ?)`
      ).bind(customerId, accountTypes.debit, accountTypes.credit).all();
      const accountIds = Object.fromEntries(accountRows.results.map((account) => [account.account_type, account.id]));
      itemStatements.push(
        env.DB.prepare(
          `INSERT INTO accounting_ledger_entries
           (customer_id, account_id, entry_date, reference_type, reference_id, description, debit, credit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(customerId, accountIds[accountTypes.debit], date, resource, parent.meta.last_row_id, `${number} total`, total, 0),
        env.DB.prepare(
          `INSERT INTO accounting_ledger_entries
           (customer_id, account_id, entry_date, reference_type, reference_id, description, debit, credit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(customerId, accountIds[accountTypes.credit], date, resource, parent.meta.last_row_id, `${number} total`, 0, total),
      );
      await env.DB.batch(itemStatements);
      return json({ ok: true, id: parent.meta.last_row_id, message: `${isInvoice ? "Invoice" : "Purchase"} recorded` }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Document number already exists" }, 409);
      throw error;
    }
  }

  if (resource === "ledger" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.entry_date, l.description, l.debit, l.credit,
              a.code, a.name, a.account_type
       FROM accounting_ledger_entries l
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.customer_id = ? ORDER BY l.entry_date DESC, l.id DESC LIMIT 200`
    ).bind(customerId).all();
    return json({ ok: true, ledger: results });
  }

  return json({ ok: false, error: "Unsupported accounting operation" }, 405);
}

async function handleCommercial(request, env, resource, recordId = null) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "commercial.view"))) return json({ ok: false, error: "Commercial access required" }, 403);

  if (resource === "summary") {
    const { results: orders } = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC`
    ).bind(session.account_id).all();
    const { results: amcContracts } = await env.DB.prepare(
      `SELECT id, contract_number, starts_at, expires_at, status
       FROM amc_contracts WHERE customer_id = ? ORDER BY expires_at DESC, id DESC`
    ).bind(session.account_id).all();
    return json({ ok: true, summary: { orders, amc_contracts: amcContracts } });
  }

  if (resource === "orders" && recordId) {
    const order = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE id = ? AND customer_id = ?`
    ).bind(recordId, session.account_id).first();
    if (!order) return json({ ok: false, error: "Order not found" }, 404);
    return json({ ok: true, order });
  }

  if (resource === "orders") {
    const { results } = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC`
    ).bind(session.account_id).all();
    return json({ ok: true, orders: results });
  }

  return json({ ok: false, error: "Unsupported commercial operation" }, 405);
}

async function handleTickets(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "POST" ? "support.create" : "support.view";
  if (!(await hasPermission(env, session, permission))) {
    return json({ ok: false, error: "Support access required" }, 403);
  }

  if (request.method === "POST") {
    const body = await request.json();
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const allowedPriorities = ["low", "normal", "high", "urgent"];
    if (!subject || subject.length > 200 || !description || description.length > 10000) {
      return json({ ok: false, error: "Subject and description are required" }, 400);
    }
    const priority = allowedPriorities.includes(body.priority) ? body.priority : "normal";
    const result = await env.DB.prepare(
      `INSERT INTO support_tickets (customer_id, subject, description, priority)
       VALUES (?, ?, ?, ?)`
    ).bind(session.account_id, subject, description, priority).run();
    return json({ ok: true, ticket_id: result.meta.last_row_id, message: "Support ticket created" }, 201);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, subject, description, priority, status, created_at, updated_at
     FROM support_tickets WHERE customer_id = ? ORDER BY created_at DESC`
  )
    .bind(session.account_id)
    .all();
  return json({ ok: true, tickets: results });
}

async function handleTicketResource(request, env, ticketId, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "GET" ? "support.view" : "support.create";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Support access required" }, 403);

  const ticket = await env.DB.prepare(
    `SELECT id, subject, description, priority, status, created_at, updated_at
     FROM support_tickets WHERE id = ? AND customer_id = ?`
  ).bind(ticketId, session.account_id).first();
  if (!ticket) return json({ ok: false, error: "Ticket not found" }, 404);

  if (resource === "messages" && request.method === "POST") {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 10000) return json({ ok: false, error: "Message is required" }, 400);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, message)
         VALUES (?, 'customer', ?, ?)`
      ).bind(ticket.id, session.account_id, message),
      env.DB.prepare("UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?").bind(ticket.id),
    ]);
    return json({ ok: true, message: "Reply added" }, 201);
  }

  if (resource || request.method !== "GET") return json({ ok: false, error: "Unsupported ticket operation" }, 405);
  const { results: messages } = await env.DB.prepare(
    `SELECT id, author_type, author_id, message, created_at
     FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(ticket.id).all();
  return json({ ok: true, ticket: { ...ticket, messages } });
}

async function handleRequirements(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "POST" ? "requirement.create" : "requirement.view";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Requirements access required" }, 403);

  if (request.method === "POST") {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const categories = ["general", "feature", "integration", "reporting", "workflow"];
    const priorities = ["low", "normal", "high", "urgent"];
    if (!title || title.length > 200 || !description || description.length > 10000) {
      return json({ ok: false, error: "Title and description are required" }, 400);
    }
    const category = categories.includes(body.category) ? body.category : "general";
    const priority = priorities.includes(body.priority) ? body.priority : "normal";
    const result = await env.DB.prepare(
      `INSERT INTO custom_requirements (customer_id, organization_id, title, description, category, priority)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(session.account_id, session.organization_id, title, description, category, priority).run();
    return json({ ok: true, requirement_id: result.meta.last_row_id, message: "Requirement submitted" }, 201);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, title, description, category, priority, status, created_at, updated_at
     FROM custom_requirements WHERE organization_id = ? ORDER BY created_at DESC, id DESC`
  ).bind(session.organization_id).all();
  return json({ ok: true, requirements: results });
}

async function handleRequirementResource(request, env, requirementId, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "GET" ? "requirement.view" : "requirement.create";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Requirements access required" }, 403);
  const requirement = await env.DB.prepare(
    `SELECT id, title, description, category, priority, status, created_at, updated_at
     FROM custom_requirements WHERE id = ? AND organization_id = ?`
  ).bind(requirementId, session.organization_id).first();
  if (!requirement) return json({ ok: false, error: "Requirement not found" }, 404);

  if (resource === "messages" && request.method === "POST") {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 10000) return json({ ok: false, error: "Message is required" }, 400);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO custom_requirement_messages (requirement_id, author_type, author_id, message)
         VALUES (?, 'customer', ?, ?)`
      ).bind(requirement.id, session.account_id, message),
      env.DB.prepare("UPDATE custom_requirements SET updated_at = datetime('now') WHERE id = ?").bind(requirement.id),
    ]);
    return json({ ok: true, message: "Reply added" }, 201);
  }

  if (resource || request.method !== "GET") return json({ ok: false, error: "Unsupported requirement operation" }, 405);
  const { results: messages } = await env.DB.prepare(
    `SELECT id, author_type, author_id, message, created_at
     FROM custom_requirement_messages WHERE requirement_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(requirement.id).all();
  return json({ ok: true, requirement: { ...requirement, messages } });
}

function releaseResponse(release, assets = []) {
  return {
    id: release.id,
    version: release.version,
    title: release.title,
    summary: release.summary,
    release_notes: release.release_notes,
    published_at: release.published_at,
    product: { id: release.product_id, code: release.product_code, name: release.product_name },
    assets,
  };
}

async function handleReleases(request, env, releaseId = null) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "release.view"))) return json({ ok: false, error: "Release access required" }, 403);

  const baseQuery = `SELECT DISTINCT r.id, r.product_id, r.version, r.title, r.summary,
           r.release_notes, r.published_at, p.slug AS product_code, p.name AS product_name
    FROM releases r
    JOIN products p ON p.id = r.product_id
    JOIN licenses l ON l.product_id = r.product_id AND l.status <> 'CANCELLED'
    JOIN organization_members om ON om.account_type = 'customer'
      AND om.account_id = l.customer_id AND om.organization_id = ? AND om.status = 'active'
    WHERE r.status = 'published' AND r.published_at IS NOT NULL`;

  if (releaseId) {
    const release = await env.DB.prepare(`${baseQuery} AND r.id = ? ORDER BY r.published_at DESC LIMIT 1`)
      .bind(session.organization_id, releaseId).first();
    if (!release) return json({ ok: false, error: "Release not found" }, 404);
    const { results: assets } = await env.DB.prepare(
      `SELECT id, name, platform, download_url, checksum FROM release_assets WHERE release_id = ? ORDER BY name`
    ).bind(release.id).all();
    return json({ ok: true, release: releaseResponse(release, assets) });
  }

  const { results } = await env.DB.prepare(`${baseQuery} ORDER BY r.published_at DESC, r.id DESC`).bind(session.organization_id).all();
  const releases = await Promise.all(results.map(async (release) => {
    const { results: assets } = await env.DB.prepare(
      `SELECT id, name, platform, download_url, checksum FROM release_assets WHERE release_id = ? ORDER BY name`
    ).bind(release.id).all();
    return releaseResponse(release, assets);
  }));
  return json({ ok: true, releases });
}

async function handlePartner(request, env, resource) {
  const session = await getPartnerSession(request, env);
  if (!session) return json({ ok: false, error: "Partner access required" }, 403);
  if (!(await hasPartnerPermission(env, session, "partner.view"))) return json({ ok: false, error: "Partner access required" }, 403);

  if (resource === "me") {
    const organization = await env.DB.prepare(
      `SELECT id, name, legal_name, gst_number, status, created_at FROM organizations WHERE id = ?`
    ).bind(session.partner_organization_id).first();
    return json({ ok: true, account_type: session.account_type, user: { id: session.account_id, name: session.name, email: session.email }, partner: { ...organization, partner_role: session.partner_role, partner_type: session.partner_type } });
  }

  if (resource === "customers") {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.name, o.legal_name, o.status, pcl.created_at
       FROM partner_customer_links pcl
       JOIN organizations o ON o.id = pcl.customer_organization_id
       WHERE pcl.partner_organization_id = ? AND pcl.status = 'active' AND o.status = 'active'
       ORDER BY o.name`
    ).bind(session.partner_organization_id).all();
    return json({ ok: true, customers: results });
  }

  if (resource === "licenses") {
    if (!(await hasPartnerPermission(env, session, "license.view"))) return json({ ok: false, error: "Partner license access required" }, 403);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.customer_id, l.product_id, l.status, l.starts_at, l.expires_at,
              om.organization_id, customer_org.name AS customer_organization_name,
              p.slug AS product_code, p.name AS product_name,
              le.edition_id, pe.code AS edition_code, pe.name AS edition_name
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = l.customer_id AND om.status = 'active'
       JOIN organizations customer_org ON customer_org.id = om.organization_id AND customer_org.status = 'active'
       JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
         AND pcl.partner_organization_id = ? AND pcl.status = 'active'
       LEFT JOIN license_editions le ON le.license_id = l.id
       LEFT JOIN product_editions pe ON pe.id = le.edition_id
       ORDER BY l.id DESC`
    ).bind(session.partner_organization_id).all();
    return json({ ok: true, licenses: results.map((license) => ({ ...licenseResponse(license), customer_organization_name: license.customer_organization_name })) });
  }

  if (resource === "releases") {
    if (!(await hasPartnerPermission(env, session, "release.view"))) return json({ ok: false, error: "Partner release access required" }, 403);
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT r.id, r.version, r.title, r.summary, r.release_notes, r.published_at,
              p.slug AS product_code, p.name AS product_name
       FROM releases r
       JOIN products p ON p.id = r.product_id
       JOIN licenses l ON l.product_id = r.product_id AND l.status <> 'CANCELLED'
       JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = l.customer_id AND om.status = 'active'
       JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
         AND pcl.partner_organization_id = ? AND pcl.status = 'active'
       WHERE r.status = 'published' AND r.published_at IS NOT NULL
       ORDER BY r.published_at DESC, r.id DESC`
    ).bind(session.partner_organization_id).all();
    return json({ ok: true, releases: results });
  }

  return json({ ok: false, error: "Unsupported partner operation" }, 405);
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

async function ensureIdentityForAccount(env, accountType, accountId, email, name, status, company = null, role = null) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO people (email, name, source_type, source_id, status)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(email, name || null, accountType, accountId, status || "active")
    .run();

  const organizationName = accountType === "customer"
    ? `${company || name || "Customer"} #${accountId}`
    : "SMRITISYS Internal";
  await env.DB.prepare(
    `INSERT INTO organizations (name, legal_name, status)
     SELECT ?, ?, 'active'
     WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE name = ?)`
  )
    .bind(organizationName, company || name || organizationName, organizationName)
    .run();
  const organization = await env.DB.prepare("SELECT id FROM organizations WHERE name = ? LIMIT 1").bind(organizationName).first();
  const memberRole = role || (accountType === "customer" ? "customer" : "staff");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO organization_members
     (organization_id, account_type, account_id, member_role, status)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(organization.id, accountType, accountId, memberRole, status === "inactive" ? "inactive" : "active")
    .run();
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

  if (type === "user") {
    const bootstrapToken = request.headers.get("X-Staff-Bootstrap");
    if (!env.STAFF_BOOTSTRAP_TOKEN || bootstrapToken !== env.STAFF_BOOTSTRAP_TOKEN) {
      return json({ ok: false, error: "Staff accounts require an authorized bootstrap" }, 403);
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
       VALUES ('staff_bootstrap_consumed', '0')`
    ).run();
  }

  const password_hash = await hashPassword(password);

  try {
    if (type === "user") {
      const [claim, result] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE system_settings SET setting_value = '1', updated_at = datetime('now')
           WHERE setting_key = 'staff_bootstrap_consumed' AND setting_value = '0'`
        ),
        env.DB.prepare(
          `INSERT INTO users (email, password_hash, name, role)
           SELECT ?, ?, ?, ? WHERE changes() = 1`
        ).bind(email.toLowerCase(), password_hash, name || null, "super_admin"),
      ]);
      if (claim.meta.changes !== 1 || result.meta.changes !== 1) {
        return json({ ok: false, error: "Staff bootstrap has already been consumed" }, 403);
      }
      await ensureIdentityForAccount(env, "user", result.meta.last_row_id, email.toLowerCase(), name, "active", null, "super_admin");
    } else {
      const result = await env.DB.prepare(
        `INSERT INTO customers (email, password_hash, name, phone, company) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(email.toLowerCase(), password_hash, name || null, phone || null, company || null)
        .run();
      await ensureIdentityForAccount(env, "customer", result.meta.last_row_id, email.toLowerCase(), name, "active", company, "customer");
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

  if (!email || !password) {
    return json({ ok: false, error: "email and password are required" }, 400);
  }
  if (type && !["user", "customer"].includes(type)) {
    return json({ ok: false, error: "type must be 'user' or 'customer'" }, 400);
  }

  let row = null;
  let accountType = type;

  if (!type || type === "user") {
    row = await env.DB.prepare(
      `SELECT id, email, password_hash, name, role, status FROM users WHERE email = ?`
    )
      .bind(email.toLowerCase())
      .first();
    if (row && !(await verifyPassword(password, row.password_hash))) row = null;
    if (row) accountType = "user";
  }
  if (!row && (!type || type === "customer")) {
    row = await env.DB.prepare(
      `SELECT id, email, password_hash, name, phone, company, status FROM customers WHERE email = ?`
    )
      .bind(email.toLowerCase())
      .first();
    if (row && !(await verifyPassword(password, row.password_hash))) row = null;
    if (row) accountType = "customer";
  }

  if (!row) return json({ ok: false, error: "Invalid email or password" }, 401);
  if (row.status !== "active" && row.status !== "trial") {
    return json({ ok: false, error: "Account is not active" }, 403);
  }

  if (!row.password_hash.startsWith("pbkdf2-sha256$")) {
    const upgradedHash = await hashPassword(password);
    const table = accountType === "user" ? "users" : "customers";
    await env.DB.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`).bind(upgradedHash, row.id).run();
  }

  const token = makeToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, accountType, row.id, expires)
    .run();

  const { password_hash: _passwordHash, ...safeRow } = row;
  return json({ ok: true, token, account_type: accountType, user: safeRow });
}

async function handleMe(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal) return json({ ok: false, error: "Invalid or expired session" }, 401);

  let account;
  if (principal.account_type === "user") {
    account = await env.DB.prepare(
      `SELECT id, email, name, role, status FROM users WHERE id = ?`
    )
      .bind(principal.account_id)
      .first();
  } else {
    account = await env.DB.prepare(
      `SELECT id, email, name, phone, company, status FROM customers WHERE id = ?`
    )
      .bind(principal.account_id)
      .first();
  }

  const { person_id: _personId, person_status: _personStatus, membership_status: _membershipStatus, organization_status: _organizationStatus, ...identity } = principal;
  return json({ ok: true, account_type: principal.account_type, user: account, identity });
}

async function handleLogout(request, env) {
  const token = (request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true, message: "Signed out" });
}

async function handlePasswordChange(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const body = await request.json();
  if (typeof body.current_password !== "string" || typeof body.new_password !== "string" || body.new_password.length < 8) {
    return json({ ok: false, error: "Current password and a new password of at least 8 characters are required" }, 400);
  }
  const customer = await env.DB.prepare("SELECT password_hash FROM customers WHERE id = ? AND status IN ('active', 'trial')").bind(session.account_id).first();
  if (!customer || !(await verifyPassword(body.current_password, customer.password_hash))) {
    return json({ ok: false, error: "Current password is incorrect" }, 403);
  }
  const passwordHash = await hashPassword(body.new_password);
  await env.DB.batch([
    env.DB.prepare("UPDATE customers SET password_hash = ? WHERE id = ?").bind(passwordHash, session.account_id),
    env.DB.prepare("DELETE FROM sessions WHERE account_type = 'customer' AND account_id = ?").bind(session.account_id),
  ]);
  return json({ ok: true, message: "Password changed. Please sign in again." });
}

async function handleListDemos(request, env) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, stores, status, created_at FROM demo_requests ORDER BY created_at DESC LIMIT 100`
  ).all();

  return json({ ok: true, demos: results });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "") || "";
  const origin = isTrustedOrigin(request, env);

  if (request.method === "OPTIONS") return cors(origin);

  try {
    if (path === "demo" && request.method === "POST") return await handleDemo(request, env);
    if (path === "signup" && request.method === "POST") return await handleSignup(request, env);
    if (path === "login" && request.method === "POST") return await handleLogin(request, env);
    if (path === "logout" && request.method === "POST") return await handleLogout(request, env);
    if (path === "me" && request.method === "GET") return await handleMe(request, env);
    if (path === "password" && request.method === "POST") return await handlePasswordChange(request, env);
    if (path === "profile" && ["GET", "PUT"].includes(request.method)) return await handleProfile(request, env);
    if (path === "organization" && request.method === "GET") return await handleOrganization(request, env);
    if (path === "tickets" && ["GET", "POST"].includes(request.method)) return await handleTickets(request, env);
    if (path.startsWith("tickets/") && ["GET", "POST"].includes(request.method)) {
      const segments = path.split("/");
      const ticketId = numericId(segments[1]);
      if (!ticketId) return json({ ok: false, error: "A valid ticket id is required" }, 400);
      return await handleTicketResource(request, env, ticketId, segments[2] || null);
    }
    if (path === "requirements" && ["GET", "POST"].includes(request.method)) return await handleRequirements(request, env);
    if (path.startsWith("requirements/") && ["GET", "POST"].includes(request.method)) {
      const segments = path.split("/");
      const requirementId = numericId(segments[1]);
      if (!requirementId) return json({ ok: false, error: "A valid requirement id is required" }, 400);
      return await handleRequirementResource(request, env, requirementId, segments[2] || null);
    }
    if (path === "releases" && request.method === "GET") return await handleReleases(request, env);
    if (path.startsWith("releases/") && request.method === "GET") {
      const releaseId = numericId(path.split("/")[1]);
      if (!releaseId) return json({ ok: false, error: "A valid release id is required" }, 400);
      return await handleReleases(request, env, releaseId);
    }
    if (path.startsWith("partner/") && path.split("/").length === 2 && request.method === "GET") {
      return await handlePartner(request, env, path.split("/")[1]);
    }
    if (path === "commercial/summary" && request.method === "GET") return await handleCommercial(request, env, "summary");
    if (path === "commercial/orders" && request.method === "GET") return await handleCommercial(request, env, "orders");
    if (path.startsWith("commercial/orders/") && request.method === "GET") {
      const orderId = numericId(path.split("/")[2]);
      if (!orderId) return json({ ok: false, error: "A valid order id is required" }, 400);
      return await handleCommercial(request, env, "orders", orderId);
    }
    if (path === "products" && ["GET", "POST"].includes(request.method)) return await handleProducts(request, env);
    if (path.startsWith("products/") && path.endsWith("/editions") && ["GET", "POST"].includes(request.method)) {
      return await handleEditions(request, env, path.split("/")[1]);
    }
    if (path.startsWith("products/") && request.method === "GET") {
      const productId = numericId(path.split("/")[1]);
      if (!productId) return json({ ok: false, error: "A valid product id is required" }, 400);
      return await handleProducts(request, env, productId);
    }
    if (path === "licenses" && ["GET", "POST"].includes(request.method)) return await handleLicenses(request, env, []);
    if (path.startsWith("licenses/") && ["GET", "POST", "PATCH"].includes(request.method)) {
      return await handleLicenses(request, env, path.split("/").slice(1));
    }
    if (path === "accounting/accounts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "accounts");
    if (path === "accounting/contacts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "contacts");
    if (path === "accounting/invoices" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "invoices");
    if (path === "accounting/purchases" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "purchases");
    if (path === "accounting/receipts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "receipts");
    if (path === "accounting/payments" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "payments");
    if (path === "accounting/notes" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "notes");
    if (path === "accounting/ledger" && request.method === "GET") return await handleAccounting(request, env, "ledger");
    if (path === "demos" && request.method === "GET") return await handleListDemos(request, env);
    if (path === "admin/overview" && request.method === "GET") return await handleAdminControl(request, env, "overview");
    if (path === "admin/organizations" && request.method === "GET") return await handleAdminControl(request, env, "organizations");
    if (path === "admin/audit" && request.method === "GET") return await handleAdminControl(request, env, "audit");
    if (path === "admin/users" && request.method === "GET") return await handleAdminUsers(request, env);
    if (path.startsWith("admin/users/") && request.method === "PATCH") {
      request.params = { id: path.split("/")[2] };
      return await handleAdminUsers(request, env);
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

export { LICENSE_TRANSITIONS, licenseValidity };
