# License Control Plane

Phase 3 establishes SMRITISYS as the authority for product editions, licenses, entitlements, activations, and license history. SMRITI Retail OS remains the authority for POS, sales, purchases, inventory, accounting, GST transactions, and operational reports.

## Reused model

The existing `products` table remains the product catalog. Its `slug` is the stable product code. The existing `licenses` table remains the legacy-compatible license record and continues to own `customer_id`, `product_id`, `license_key`, validity dates, and status.

Organizations are not accepted from the browser as ownership proof. License ownership is derived through the Phase 2 `organization_members` relationship for the license customer.

`product_editions` adds editions without duplicating products. `license_editions` associates one edition with an existing license.

## Domain tables

- `products`: product catalog; `slug` is the product code.
- `product_editions`: product-specific edition catalog.
- `licenses`: legacy-compatible license authority.
- `license_editions`: edition assignment for a license.
- `license_entitlements`: extensible key/value records such as `users`, `branches`, `devices`, `modules`, `industry_pack`, and `support_level`.
- `license_activations`: installation and activation identifiers with limited operational metadata.
- `license_events`: append-only license history.
- `audit_logs`: security/governance audit records, separate from business event history.

## Status transitions

```text
DRAFT            -> ACTIVE, CANCELLED
ACTIVE           -> SUSPENDED, PENDING_RENEWAL, EXPIRED, CANCELLED
SUSPENDED        -> ACTIVE, CANCELLED
PENDING_RENEWAL  -> ACTIVE, EXPIRED
EXPIRED          -> ACTIVE (explicit renewal)
CANCELLED        -> terminal
```

The API does not accept arbitrary status changes through `PATCH`. Status changes use explicit action routes. Expiry is calculated from status and dates when a license is read; viewing a license does not mutate its stored status.

## Authorization

Customers receive `license.view` only. Product and license mutations require the appropriate Phase 3 permissions:

- `license.create`
- `license.update`
- `license.suspend`
- `license.activate`
- `license.renew`
- `license.manage_entitlements`

The server derives the authenticated person, organization membership, and role from the session. A customer query is constrained to that membership's organization. Administrative queries require the permission but are not constrained to the internal administrator organization.

## Activation and idempotency

Activation requires an installation ID and activation identifier. The pair `(license_id, activation_identifier)` is unique. Repeating an activation updates `last_seen_at` and does not create duplicate activation or history rows.

No unnecessary device fingerprinting or personal data is collected. Optional diagnostic metadata is stored as JSON and should contain only operational information needed by Retail OS support.

## API

- `GET /api/products`
- `POST /api/products` (admin permission)
- `GET /api/products/:id`
- `GET /api/products/:id/editions`
- `POST /api/products/:id/editions` (admin permission)
- `GET /api/licenses`
- `POST /api/licenses` (admin permission)
- `GET /api/licenses/:id`
- `PATCH /api/licenses/:id` (metadata only)
- `GET /api/licenses/:id/entitlements`
- `POST /api/licenses/:id/entitlements` (admin permission)
- `GET /api/licenses/:id/activations`
- `GET /api/licenses/:id/events`
- `POST /api/licenses/:id/activate`
- `POST /api/licenses/:id/suspend`
- `POST /api/licenses/:id/renew`

Every privileged mutation writes both a license event where applicable and a security audit event.
