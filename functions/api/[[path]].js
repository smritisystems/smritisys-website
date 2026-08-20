/**
 * SMRITISYS Pages Functions
 * Handles account, profile, support ticket, and demo APIs.
 * Auto-deploys with Cloudflare Pages on every GitHub push
 */

function isTrustedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowedOrigins = (env.ALLOWED_ORIGINS || "https://smritisys.com,http://localhost:8788,http://127.0.0.1:8788")
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

async function requireSuperAdmin(request, env) {
  const session = await requirePermission(request, env, "admin.system");
  if (!session || session.account_type !== "user" || session.member_role !== "super_admin") return null;
  return session;
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
  const { name, phone, company, gst_number, website, bio, timezone } = body;
  if (!name || !company) {
    return json({ ok: false, error: "Name and company are required" }, 400);
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE customers SET name = ?, phone = ?, company = ? WHERE id = ?`
    ).bind(name, phone || null, company, session.account_id),
    env.DB.prepare(
      `INSERT INTO customer_profiles
       (customer_id, gst_number, website, bio, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(customer_id) DO UPDATE SET
         gst_number = excluded.gst_number,
         website = excluded.website,
         bio = excluded.bio,
         timezone = excluded.timezone,
         updated_at = datetime('now')`
    ).bind(session.account_id, gst_number || null, website || null, bio || null, timezone || "Asia/Kolkata"),
  ]);

  return json({ ok: true, message: "Profile updated" });
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

async function handleTickets(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const ticketPermission = request.method === "POST" ? "support.create" : "support.view";
  if (!(await hasPermission(env, session, ticketPermission))) {
    return json({ ok: false, error: "Support access required" }, 403);
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, subject, description, priority, status, created_at, updated_at
       FROM support_tickets WHERE customer_id = ? ORDER BY created_at DESC`
    )
      .bind(session.account_id)
      .all();
    return json({ ok: true, tickets: results });
  }

  const body = await request.json();
  const { subject, description, priority } = body;
  if (!subject || !description) {
    return json({ ok: false, error: "Subject and description are required" }, 400);
  }
  const allowedPriorities = ["low", "normal", "high", "urgent"];
  const ticketPriority = allowedPriorities.includes(priority) ? priority : "normal";

  const result = await env.DB.prepare(
    `INSERT INTO support_tickets (customer_id, subject, description, priority)
     VALUES (?, ?, ?, ?)`
  )
    .bind(session.account_id, subject, description, ticketPriority)
    .run();

  return json({ ok: true, ticket_id: result.meta.last_row_id }, 201);
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
    if (path === "me" && request.method === "GET") return await handleMe(request, env);
    if (path === "profile" && ["GET", "PUT"].includes(request.method)) return await handleProfile(request, env);
    if (path === "tickets" && ["GET", "POST"].includes(request.method)) return await handleTickets(request, env);
    if (path === "accounting/accounts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "accounts");
    if (path === "accounting/contacts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "contacts");
    if (path === "accounting/invoices" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "invoices");
    if (path === "accounting/purchases" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "purchases");
    if (path === "accounting/receipts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "receipts");
    if (path === "accounting/payments" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "payments");
    if (path === "accounting/notes" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "notes");
    if (path === "accounting/ledger" && request.method === "GET") return await handleAccounting(request, env, "ledger");
    if (path === "demos" && request.method === "GET") return await handleListDemos(request, env);
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
