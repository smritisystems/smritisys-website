# SMRITISYS — Business Portal + Corporate Website

SMRITISYS is the relationship, licensing, support, partner, commercial, and control plane. **SMRITI Retail OS is a separate operational application** for POS, billing, inventory, purchases, sales, CRM, accounting, GST, and reports.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the product boundary and experience map.
See [docs/LICENSE_ARCHITECTURE.md](docs/LICENSE_ARCHITECTURE.md) for the Phase 3 license model and state machine.

Cloudflare Pages Git integration deploys the `main` branch automatically. The
repository CI workflow runs tests, dependency checks, and the CSS build, but
GitHub branch protection must require that check before merge.

Production D1 migrations and the D1 operations Worker are separate. They run
only through an explicitly confirmed `workflow_dispatch`. Before using the
workflow, configure required reviewers on the GitHub `production` environment;
the workflow's environment declaration alone does not enforce approval.

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

## Local development

The root `wrangler.toml` points to a local-only D1 database named
`smritisys-local`. Initialize only the local database with the schema:

```bash
npx wrangler d1 execute smritisys-local --local --file=./schema.sql
```

Do not use `schema.sql` against an existing or production database; use
migrations through the approved production workflow.

## Cloudflare Pages deployment setup

### 1. Connect GitHub to Cloudflare Pages
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

### 2. Bind production D1 to the Pages project (important)
1. Open the Pages project → **Settings** → **Functions**
2. Scroll to **D1 database bindings**
3. Add binding:
   - Variable name: `DB`
   - D1 database: `smritisys-db`
4. Save

The Pages Git integration deploys pushes to `main`. Configure branch protection
so the `CI / test` check must pass before changes are merged.

## Daily use

```bash
git add .
git commit -m "update"
git push
```

Cloudflare Pages will automatically deploy. D1 migrations do not run as part of
that Pages deployment; use the separate protected production workflow only
after staging validation and approval.

The root `wrangler.toml` uses a local-only D1 database name and ID. Do not use
the production D1 operations configuration for local development. No staging
D1 target is currently configured in this repository; an authorized operator
must provision and verify the isolated database and signer settings first.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/demo` | Save demo request |
| POST | `/api/signup` | Customer signup; staff signup is one-time bootstrap only |
| POST | `/api/login` | `{ email, password }` → session; account type is detected automatically. Optional `type` remains supported. Organization access is not selected implicitly. |
| GET | `/api/organization-context` | List active organization memberships and the organization selected for the current session |
| POST | `/api/organization-context` | Select an active membership organization for the current server session |
| GET | `/api/me` | Current user and selected organization membership; requires session organization selection |
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
| GET | `/api/announcements` | List current customer notices for the authenticated organization and its licensed products |
| GET/POST | `/api/admin/announcements` | List or create announcements (super admin only) |
| PATCH | `/api/admin/announcements/:id` | Edit an announcement or transition its status (super admin only) |
| GET | `/api/partner/me` | Read the authenticated partner relationship (Bearer token) |
| GET | `/api/partner/customers` | List linked customer organizations (partner membership required) |
| GET/POST | `/api/partner/deals` | List or submit deal registrations scoped to the selected partner organization |
| PATCH | `/api/partner/deals/:id` | Respond to an information request on the partner's own registration |
| GET | `/api/partner/licenses` | Read licenses for linked customer organizations (partner license permission required) |
| GET | `/api/partner/releases` | Read releases for linked customer products (partner release permission required) |
| GET | `/api/admin/overview` | Internal super-admin metrics |
| GET | `/api/admin/organizations` | Internal organization inventory (super admin only) |
| GET | `/api/admin/partner-deals` | Review partner deal registrations (super admin only) |
| PATCH | `/api/admin/partner-deals/:id` | Update review status and notes (super admin only) |
| GET | `/api/admin/follow-ups` | Read the internal support/deal/invitation follow-up queue (super admin only) |
| GET/POST | `/api/admin/follow-up-tasks` | List or create manually managed internal tasks (super admin only) |
| PATCH | `/api/admin/follow-up-tasks/:id` | Update task status, owner, due date, or notes (super admin only) |
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

Browser logins receive an `HttpOnly`, `Secure`, `SameSite=Lax` `smritisys_session` cookie and the portal clients send same-origin credentials automatically. The API continues to accept `Authorization: Bearer <token>` for existing non-browser integrations during the migration period. Logout invalidates the server session and clears the browser cookie.

After login, a user must explicitly select an organization. That selection is stored on the individual server session, and organization-scoped API routes deny access until it is set. Changing an organization affects only that session; it does not change the user's memberships or other active sessions. Migration `0029_session_organization_context.sql` adds the nullable session column without backfilling existing sessions, so active users must select a context again after the migration.

Partner deal registrations are an internal-review workflow only. Partners can submit and view their own registrations and respond to requests for information; super admins can review them, and possible duplicate name/email matches are review hints rather than automatic decisions. Approval does not create deal protection, pricing, commissions, a customer organization, or a customer link. The follow-up workspace includes a paginated, read-only view of open support tickets, submitted/in-review deals, and unexpired invitations, plus manually managed tasks with optional owners and due dates. It does not enforce SLAs or send outbound messages. Migration `0030_partner_workflow_foundations.sql` was applied to production on 2026-11-22. No partner data was seeded.

`super_admin` is the full-control administrative role. Administrative endpoints must
call the super-admin guard; ordinary `staff` accounts cannot manage users or demos.

Staff signup is not public. The one-time bootstrap request must include the
`X-Staff-Bootstrap` header, match the `STAFF_BOOTSTRAP_TOKEN` Pages secret, and run
before the first staff user exists. Remove or rotate the secret after bootstrapping.

Set `ALLOWED_ORIGINS` as a comma-separated Pages environment variable for production
and local development. The API does not allow wildcard CORS. Cookie-authenticated
unsafe requests also require a same-origin or explicitly allowlisted Origin;
Bearer clients are unaffected.

## Production handoff checklist

Before a future production release:

1. Use an isolated non-production D1 database and signer configuration with synthetic data. Do not test activation, renewal, or recovery against production customer records.
2. Require the GitHub `CI / test` check before merging to `main`; CI runs `npm audit`, `npm test`, and `npm run build:css`.
3. Before any production migration, confirm a pre-change recovery point and migration plan. The scheduled D1 operations sampler stores capacity telemetry; it is not a backup.
4. Production migration `0031_identity_organization_scope.sql` was applied by the D1 workflow on 2026-11-22. The workflow reported it as pending and applied it successfully. Recheck the remote migration ledger before future work; do not replay `schema.sql` or manually rerun migrations.
5. Before using the D1 operations workflow, configure required reviewers on the GitHub `production` environment. Dispatch only from `main`, set `confirm_production` to true, and obtain environment approval. The workflow tests and builds before applying migrations and deploying the Worker.
6. Set production `ALLOWED_ORIGINS` explicitly and verify no local origins are included.
7. Verify customer, partner, and admin login, explicit organization selection, tenant isolation, logout invalidation, and the accounting boundary in staging before a production release.
8. Have an authorized operator confirm the license signer, key lifecycle, monitoring, D1 Time Travel retention, and isolated recovery target before inviting additional production users.

## Migration status

The production workflow applied migration `0031` on 2026-11-22 after reporting
it as the pending migration. This confirms that the prior migration files in
that run were already recorded as applied. Always check the production
migration ledger before a future change; the historical SQL examples below are
not instructions to replay migrations.

## Create first staff user

After deploy:

```bash
curl -X POST https://YOUR_PROJECT.pages.dev/api/signup \
  -H "Content-Type: application/json" \
  -H "X-Staff-Bootstrap: $STAFF_BOOTSTRAP_TOKEN" \
  -d "{\"type\":\"user\",\"email\":\"admin@smritisys.com\",\"password\":\"change-me\",\"name\":\"Admin\"}"
```

## Cloudflare plan

Cloudflare limits, recovery retention, and pricing depend on the account plan.
Verify them in the authorized Cloudflare account and current Cloudflare
documentation before capacity or recovery planning.
