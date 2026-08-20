# SMRITISYS — Business Portal + Corporate Website

SMRITISYS is the relationship, licensing, support, partner, commercial, and control plane. **SMRITI Retail OS is a separate operational application** for POS, billing, inventory, purchases, sales, CRM, accounting, GST, and reports.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the product boundary and experience map.

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
smritisys.com             Corporate website and control plane
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
| POST | `/api/signup` | `{ type: "user"\|"customer", email, password, name }` |
| POST | `/api/login` | `{ email, password }` → token; account type is detected automatically. Optional `type` remains supported. |
| GET | `/api/me` | Current user (Bearer token) |
| GET | `/api/profile` | Current customer profile (Bearer token) |
| PUT | `/api/profile` | Update customer profile (Bearer token) |
| GET | `/api/tickets` | List customer support tickets (Bearer token) |
| POST | `/api/tickets` | Create support ticket (Bearer token) |
| GET | `/api/accounting/accounts` | List company accounts (Bearer token) |
| POST | `/api/accounting/accounts` | Create an account type (Bearer token) |
| GET/POST | `/api/accounting/contacts` | List or create customers and suppliers (Bearer token) |
| GET | `/api/accounting/invoices` | List sales invoices (Bearer token) |
| POST | `/api/accounting/invoices` | Create a simple invoice with one or more items (Bearer token) |
| GET | `/api/accounting/purchases` | List purchase bills (Bearer token) |
| POST | `/api/accounting/purchases` | Record a purchase with one or more items (Bearer token) |
| GET/POST | `/api/accounting/receipts` | List or record customer receipts (Bearer token) |
| GET/POST | `/api/accounting/payments` | List or record supplier payments (Bearer token) |
| GET/POST | `/api/accounting/notes` | List or create debit/credit notes (Bearer token) |
| GET | `/api/accounting/ledger` | List double-entry ledger postings (Bearer token) |
| GET | `/api/demos` | List demos (staff token only) |
| GET | `/api/admin/users` | List staff users (super admin token only) |
| PATCH | `/api/admin/users/:id` | Update user role, status, or name (super admin token only) |

`super_admin` is the full-control administrative role. Administrative endpoints must
call the super-admin guard; ordinary `staff` accounts cannot manage users or demos.

## Create first staff user

After deploy:

```bash
curl -X POST https://YOUR_PROJECT.pages.dev/api/signup \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"user\",\"email\":\"admin@smritisys.com\",\"password\":\"change-me\",\"name\":\"Admin\"}"
```

## Free tier
- Pages: unlimited bandwidth, 500 builds/month
- D1: 5M reads/day, 100k writes/day, 5GB storage
- Enough for demos + user/customer accounts
