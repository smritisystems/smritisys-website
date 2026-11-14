---
title: "Signed License Control Plane Architecture"
module: "01_ARCHITECTURE"
category: "SECURITY-DESIGN"
document_type: "SPECIFICATION"
product: "PrathamOne EduOS"
edition: "Coaching Institute Edition"
version: "1.0.0"
doc_version: "1.4"
created_date: "2026-11-14"
updated_date: "2026-11-15"
author: "Jawahar R Mallah"
organization: "AITDL — AI Technology & Development Lab"
status: "In Progress"
tags: ["licensing", "Ed25519", "activation", "entitlements", "security"]
entities: ["License", "Activation", "Entitlement", "LicenseEvent", "LicenseCode"]
api_routes: ["/api/license/activate", "/api/licenses", "/api/licenses/batches", "/api/products"]
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
- `license_code_inventory`: unassigned serial/key inventory; stores only SHA-256 activation-key hashes and claim bindings, never plaintext activation keys.
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

Direct customer license issuance is restricted to super admins. It creates the canonical customer, inactive portal account, organization, and active customer membership within the same D1 batch as the license, edition, entitlements, license event, and audit records. The inactive customer account has a random undisclosed password hash and cannot be used for portal sign-in; the customer receives only the activation credentials. Existing-organization issuance continues to use `license.create`.

## Activation and idempotency

Activation requires an installation ID, activation identifier, and an exact non-empty `company.binding` text entitlement. An unbound or mismatched company is rejected before signing. Entitlement keys must be unique within a license. The pair `(license_id, activation_identifier)` is unique. Repeating an activation updates `last_seen_at` and does not create duplicate activation or history rows.

Existing licenses without a company binding require an authorized customer-to-product mapping before their next activation; the system does not invent a binding during migration. New batch codes are generated unassigned, linked to one product/edition and commercial term, and have a default one-seat limit. On first claim, the customer supplies the institution name, contact name, email and phone; address and tax ID are optional. The licensing authority reuses the canonical customer only when the contact email and organization match, otherwise it rejects conflicting identity data.

Claiming creates the customer, organization membership, license, edition, entitlements, audit event and code-to-installation binding transactionally. A code can be retried only by the same installation, activation identifier and company binding. Activation keys are shown only in the batch-creation response and are not stored; lost exports cannot be recovered. The batch API returns aggregate inventory status without key hashes.

DRAFT license keys are not returned to customer list responses, and the authority rejects DRAFT activation before artifact signing. PrathamOne also treats DRAFT, suspended, or cancelled signed states as non-active, including perpetual and one-time models.

## Signed artifact boundary

- The Pages API builds the versioned license payload and calls the `LICENSE_SIGNER` service binding. The private signing key must remain inside that isolated signer boundary; the web application and products contain only public verification keys.
- Artifacts are Ed25519-signed, installation- and company-bound snapshots. The product verifies signature, key ID, product, company, installation, status, model, date bounds, and entitlements before applying its server-side policy.
- Each activation registers an installation-generated Ed25519 refresh public key. The matching private key remains encrypted at rest in PrathamOne using its application `SECRET_KEY`; it is never sent to SMRITISYS. The product signs a short-lived request containing the product, company binding, installation, activation, timestamp, and one-time nonce.
- `POST /api/license/refresh` verifies the installation signature, enforces timestamp and nonce replay protection, checks the current license and activation status, and returns a newly signed artifact. It uses the same artifact builder as initial activation and does not require the reusable license key.
- PrathamOne checks status hourly while the application is in use and contacts the authority only when the last signed snapshot is at least 24 hours old. Failed attempts are throttled to once per hour. Batch-code licenses carry a signed 90-day offline-validity window; legacy and directly issued licenses retain the seven-day default. After the signed window, the product applies its existing Evaluation Mode policy, including for perpetual licenses. A suspension or revocation is reflected on the next successful check-in, not pushed immediately.
- Activations created before refresh-key support must be manually reactivated once with the issued license key to register their installation public key.
- Configure a concrete signer backed by the selected protected KMS/HSM before enabling real issuance. No vendor or key has been selected, and no signing infrastructure is provisioned by this source change.
- Offline activation uses a PrathamOne-generated request file containing the serial number, registration details, installation IDs and public refresh key, but no activation key or private key. The customer uploads the request and enters the activation key on `/offline-activation.html`, downloads the signed response, and imports it into the same installation. The authority still performs the claim online; only the product installation can import the resulting artifact because it is signed and bound to that installation.

## Internal administrator workspace

The authenticated super-admin workspace can issue licenses for active organizations and product editions, generate batches of 1-200 unassigned activation-code pairs, review batch counts without retrieving keys, configure edition Evaluation Mode/grace/rollout policy, inspect entitlements, activations, signed-artifact metadata, and lifecycle events, renew or suspend licenses, and revoke activations. Batch codes use nine-digit numeric serials and 16-character uppercase alphanumeric activation keys. A batch can be revoked only while none of its codes are claimed or being claimed; revocations are audited.

`POST /api/licenses` returns a stable `SMR-LIC-########` serial number and the direct-issue key once. `POST /api/licenses/batches` returns generated serial/key pairs once; the keys are hash-only at rest and absent from all list, audit and batch-summary responses. `POST /api/licenses/batches/:batch_id/revoke` revokes all unclaimed codes in one batch and records an audit event. The admin workspace offers a CSV download from the current response and clears the in-memory key list on sign-out. License creation and customer registration are audited without including activation keys. Existing-organization issuance remains available.

Private signing material and signed artifact payload/signature bytes are not rendered in the workspace.

## API

- `GET /api/products`
- `POST /api/products` (admin permission)
- `GET /api/products/:id`
- `GET /api/products/:id/editions`
- `POST /api/products/:id/editions` (admin permission)
- `GET /api/licenses`
- `POST /api/licenses` (license creation permission for an existing organization; super admin for direct customer registration)
- `GET /api/licenses/batches` (super admin; summary only)
- `POST /api/licenses/batches` (super admin; returns key pairs once)
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
- `POST /api/v1/license/offline-request` (authorized PrathamOne admin; creates the request file)
- `POST /api/v1/license/offline-import` (authorized PrathamOne admin; verifies and imports a signed response)

Every privileged mutation writes both a license event where applicable and a security audit event.

## Validation and remaining work

The control-plane tests cover company-binding rejection, signed-artifact verification, direct activation-only customer registration, one-time batch generation, hash-only key storage, claim idempotency, installation binding, registration reuse, audit redaction, and the existing staging contracts. The PrathamOne tests cover signed response verification and the per-artifact offline-validity boundary. The isolated signing service still needs a provider selection, operational provisioning and key lifecycle procedures. Before production rollout, complete integration testing against the chosen signer, product-specific entitlement review, code-revocation procedures, signed release verification, and customer migration/recovery rehearsal. Migration `0019_license_code_inventory.sql` is source only; it has not been applied to production. No deployment or production license issuance has been performed.
