# SMRITISYS — Business Portal + Corporate Website

SMRITISYS is the relationship, licensing, support, partner, commercial, and control plane. **SMRITI Retail OS is a separate operational application** for POS, billing, inventory, purchases, sales, CRM, accounting, GST, and reports.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the product boundary and experience map.
See [docs/LICENSE_ARCHITECTURE.md](docs/LICENSE_ARCHITECTURE.md) for the Phase 3 license model and state machine.

Push to GitHub = automatic deploy. No manual `wrangler deploy`.

## Structure

```
smritisys-auto/
├── index.html              ← SMRITISYS public corporate website
├── portal.html             ← Customer relationship portal
├── partner.html            ← Partner portal entry surface
├── functions/api/[[path]].js  ← Control-plane API
├── schema.sql              ← Control-plane D1 tables
├── wrangler.toml           ← Local/dev config
└── README.md
```

Operational application boundary:

```text
https://smritisys.com      Corporate website and control plane
smritisys.com/portal.html Customer portal
smritisys.com/partner.html Partner portal
app.smritisys.com         SMRITI Retail OS operational application
```

## One-time setup (only once)

### 1. Create D1 database
1. Cloudflare Dashboard → **Workers & Pages** → **D1**
2. Create database → name: `smritisys-db`
3. Copy **database_id** (optional for local)

### 2. Create tables
In D1 console (or CLI):
```bash
npx wrangler d1 execute smritisys-db --file=./schema.sql
```
Or open D1 → Console → paste contents of `schema.sql` → Run.

### 3. Connect GitHub to Cloudflare Pages
1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Select repo: `smritisystems/smritisys-website`
3. Settings:

| Field | Value |
|-------|--------|
| Project name | `smritisys` |
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(leave empty)* |
| Build output directory | `/` |

4. **Save and Deploy**

### 4. Bind D1 to the Pages project (important)
1. Open the Pages project → **Settings** → **Functions**
2. Scroll to **D1 database bindings**
3. Add binding:
   - Variable name: `DB`
   - D1 database: `smritisys-db`
4. Save

After this, every push to `main` auto-deploys.

## Daily use

```bash
git add .
git commit -m "update"
git push
```

Cloudflare Pages will automatically build and deploy. No manual deploy command.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/demo` | Save demo request |
| POST | `/api/signup` | Customer signup; staff signup is one-time bootstrap only |
| POST | `/api/login` | `{ email, password }` → token; account type is detected automatically. Optional `type` remains supported. |
| GET | `/api/me` | Current user (Bearer token) |
| GET | `/api/profile` | Current customer profile (Bearer token) |
| PUT | `/api/profile` | Update customer profile (Bearer token) |
| GET | `/api/tickets` | List customer support tickets (Bearer token) |
| POST | `/api/tickets` | Create support ticket (Bearer token) |
| GET | `/api/tickets/:id` | Read one customer-owned ticket and replies (Bearer token) |
| POST | `/api/tickets/:id/messages` | Add a customer reply to a customer-owned ticket (Bearer token) |
| GET | `/api/requirements` | List requirements for the authenticated customer organization (Bearer token) |
| POST | `/api/requirements` | Submit a custom requirement request (Bearer token) |
| GET | `/api/requirements/:id` | Read one organization-owned requirement and replies (Bearer token) |
| POST | `/api/requirements/:id/messages` | Add a customer reply to an organization-owned requirement (Bearer token) |
| GET | `/api/partner/me` | Read the authenticated partner relationship (Bearer token) |
| GET | `/api/partner/customers` | List linked customer organizations (partner membership required) |
| GET | `/api/partner/licenses` | Read licenses for linked customer organizations (partner license permission required) |
| GET | `/api/partner/releases` | Read releases for linked customer products (partner release permission required) |
| GET | `/api/admin/overview` | Internal super-admin metrics |
| GET | `/api/admin/organizations` | Internal organization inventory (super admin only) |
| GET | `/api/admin/audit` | Internal audit activity (super admin only) |
| GET | `/api/products` | List products (Bearer token) |
| POST | `/api/products` | Create a product (license permission required) |
| GET | `/api/products/:id` | Read a product and its editions (Bearer token) |
| GET/POST | `/api/products/:id/editions` | Read or create product editions |
| GET | `/api/licenses` | List licenses visible to the authenticated organization |
| POST | `/api/licenses` | Create a draft or active license (admin permission required) |
| GET | `/api/licenses/:id` | Read a license with calculated validity |
| PATCH | `/api/licenses/:id` | Update license metadata, not status |
| GET/POST | `/api/licenses/:id/entitlements` | Read or manage structured entitlements |
| GET | `/api/licenses/:id/activations` | List license activations |
| GET | `/api/licenses/:id/events` | Read immutable license event history |
| POST | `/api/licenses/:id/activate` | Activate a license installation |
| POST | `/api/licenses/:id/suspend` | Suspend an active license |
| POST | `/api/licenses/:id/renew` | Explicitly renew a license |
| GET/POST | `/api/accounting/*` | Blocked from the portal; operational accounting belongs to SMRITI Retail OS |
| GET | `/api/demos` | List demos (staff token only) |
| GET | `/api/admin/users` | List staff users (super admin token only) |
| PATCH | `/api/admin/users/:id` | Update user role, status, or name (super admin token only) |

`super_admin` is the full-control administrative role. Administrative endpoints must
call the super-admin guard; ordinary `staff` accounts cannot manage users or demos.

Staff signup is not public. The one-time bootstrap request must include the
`X-Staff-Bootstrap` header, match the `STAFF_BOOTSTRAP_TOKEN` Pages secret, and run
before the first staff user exists. Remove or rotate the secret after bootstrapping.

Set `ALLOWED_ORIGINS` as a comma-separated Pages environment variable for production
and local development. The API does not allow wildcard CORS.

## Production handoff checklist

Before deploying the completed control plane:

1. Back up the remote D1 database.
2. Apply migrations `0002_identity_rbac.sql` through `0011_admin_staging_seed.sql` in order, excluding staging seed migrations `0005`, `0009`, and `0011` in production.
3. Apply only production-approved customer, partner, and admin seed records; never deploy the example credentials or demo download URLs.
4. Set production `ALLOWED_ORIGINS` explicitly and verify no local origins are included.
5. Create the first super-admin with `X-Staff-Bootstrap`, then rotate or remove `STAFF_BOOTSTRAP_TOKEN`.
6. Verify customer, partner, and admin login, tenant isolation, logout invalidation, and the accounting boundary after deployment.
7. Enable rate limiting, error monitoring, backups, and alerting before inviting production users.

## Phase 2 identity migration

Before deploying the Phase 2 API to an existing D1 database, run the repeatable
identity migration:

```bash
npx wrangler d1 execute smritisys-db --remote --file=./migrations/0002_identity_rbac.sql
npx wrangler d1 execute smritisys-db --remote --file=./migrations/0003_license_control_plane.sql
```

The migration preserves `users`, `customers`, sessions, and existing customer data.
It backfills `people`, deterministic organizations, memberships, roles, permissions,
and audit storage. Runtime authorization resolves the authenticated account through
organization membership and role permissions; browser-supplied organization or role
values are not trusted.

The license migration reuses the existing product and license tables and adds editions,
entitlements, activations, and immutable license events. It does not move operational
POS, sales, purchase, inventory, accounting, GST, or reporting data into SMRITISYS.

## Create first staff user

After deploy:

```bash
curl -X POST https://YOUR_PROJECT.pages.dev/api/signup \
  -H "Content-Type: application/json" \
  -H "X-Staff-Bootstrap: $STAFF_BOOTSTRAP_TOKEN" \
  -d "{\"type\":\"user\",\"email\":\"admin@smritisys.com\",\"password\":\"change-me\",\"name\":\"Admin\"}"
```

## Free tier
- Pages: unlimited bandwidth, 500 builds/month
- D1: 5M reads/day, 100k writes/day, 5GB storage
- Enough for demos + user/customer accounts
