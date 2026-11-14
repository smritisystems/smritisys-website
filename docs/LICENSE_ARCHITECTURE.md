---
title: "Signed License Control Plane Architecture"
module: "01_ARCHITECTURE"
category: "SECURITY-DESIGN"
document_type: "SPECIFICATION"
product: "PrathamOne EduOS"
edition: "Coaching Institute Edition"
version: "1.0.0"
doc_version: "1.1"
created_date: "2026-11-14"
updated_date: "2026-11-14"
author: "Jawahar R Mallah"
organization: "AITDL — AI Technology & Development Lab"
status: "In Progress"
tags: ["licensing", "Ed25519", "activation", "entitlements", "security"]
entities: ["License", "Activation", "Entitlement", "LicenseEvent"]
api_routes: ["/api/license/activate", "/api/licenses", "/api/products"]
related_modules: ["12_RBAC_SECURITY", "13_SYSADMIN_SETTINGS", "16_DATABASE_API"]
---

# License Control Plane

Phase 3 establishes SMRITISYS as the authority for product editions, licenses, entitlements, activations, and license history. SMRITI Retail OS remains the authority for POS, sales, purchases, inventory, accounting, GST transactions, and operational reports.

The current approved implementation scope is the SMRITISYS website and PrathamOne EduOS. No SMRITI Retail OS integration or deployment is included.

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
- `license_activations`: installation and activation identifiers, an installation refresh public key, and limited operational metadata.
- `license_refresh_nonces`: short-lived, single-use refresh nonces used to reject replayed signed requests.
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

Activation requires an installation ID, activation identifier, and an exact non-empty `company.binding` text entitlement. An unbound or mismatched company is rejected before signing. Entitlement keys must be unique within a license. The pair `(license_id, activation_identifier)` is unique. Repeating an activation updates `last_seen_at` and does not create duplicate activation or history rows.

Existing licenses without a company binding require an authorized customer-to-product mapping before their next activation; the system does not invent a binding during migration. No unnecessary device fingerprinting or personal data is collected. Optional diagnostic metadata is stored as JSON and should contain only operational information needed for support.

DRAFT license keys are not returned to customer list responses, and the authority rejects DRAFT activation before artifact signing. PrathamOne also treats DRAFT, suspended, or cancelled signed states as non-active, including perpetual and one-time models.

## Signed artifact boundary

- The Pages API builds the versioned license payload and calls the `LICENSE_SIGNER` service binding. The private signing key must remain inside that isolated signer boundary; the web application and products contain only public verification keys.
- Artifacts are Ed25519-signed, installation- and company-bound snapshots. The product verifies signature, key ID, product, company, installation, status, model, date bounds, and entitlements before applying its server-side policy.
- Each activation registers an installation-generated Ed25519 refresh public key. The matching private key remains encrypted at rest in PrathamOne using its application `SECRET_KEY`; it is never sent to SMRITISYS. The product signs a short-lived request containing the product, company binding, installation, activation, timestamp, and one-time nonce.
- `POST /api/license/refresh` verifies the installation signature, enforces timestamp and nonce replay protection, checks the current license and activation status, and returns a newly signed artifact. It uses the same artifact builder as initial activation and does not require the reusable license key.
- PrathamOne checks status hourly while the application is in use and contacts the authority only when the last signed snapshot is at least 24 hours old. Failed attempts are throttled to once per hour. The seven-day offline window is measured from the signed issue time; after it, the product applies its existing Evaluation Mode policy, including for perpetual licenses. A suspension or revocation is reflected on the next successful check-in, not pushed immediately.
- Activations created before refresh-key support must be manually reactivated once with the issued license key to register their installation public key.
- Configure a concrete signer backed by the selected protected KMS/HSM before enabling real issuance. No vendor or key has been selected, and no signing infrastructure is provisioned by this source change.
- Online activation is covered. A customer-operated offline-file exchange, recovery/transfer workflow, key-compromise runbook, and signed installer/update pipeline remain separate deployment and operations work.

## Internal administrator workspace

The authenticated super-admin workspace can issue licenses for active organizations and product editions, configure edition Evaluation Mode/grace/rollout policy, inspect entitlements, activations, signed-artifact metadata, and lifecycle events, renew or suspend licenses, and revoke activations. These actions use the existing permission-scoped APIs and append audit/event records. Activation revocation and suspension require explicit confirmation in the UI.

License keys are displayed after issuance and masked in the license list. Private signing material and signed artifact payload/signature bytes are not rendered in the workspace.

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
- `POST /api/licenses/:id/activations/:activationId/revoke`
- `GET|PUT /api/products/:productId/editions/:editionId/evaluation-policy`
- `POST /api/license/activate` (signed product activation)
- `POST /api/license/refresh` (installation-key-authenticated snapshot refresh)

Every privileged mutation writes both a license event where applicable and a security audit event.

## Validation and remaining work

The control-plane tests cover company-binding rejection, signed-artifact verification, license creation, and the existing staging contracts. The administrative workspace reuses the established product/license APIs. The isolated signing service still needs a provider selection, operational provisioning and key lifecycle procedures. Before production rollout, complete integration testing against the chosen signer, product-specific entitlement review, offline recovery and transfer workflows, signed release verification, and customer migration/recovery rehearsal. No deployment has been performed.
