# Public Product Truth - Website V1.1

This audit governs public wording for the warehouse, wholesale, distribution and barcode expansion. It does not change runtime availability.

| Capability | Evidence | Website wording | Status |
|---|---|---|---|
| POS and billing | Existing public product story and product boundary | Designed for checkout, barcode-led workflows and returns; scope varies by deployment | DEPLOYMENT DEPENDENT |
| Inventory and stock | Existing product positioning and stock workflow language | Designed around item identity, stock decisions and store context | DEPLOYMENT DEPENDENT |
| Warehouse / godown operations | V1.1 public workflow definition | Designed for receiving, placement, dispatch, transfers and warehouse visibility | DEPLOYMENT DEPENDENT |
| Bulk dispatch | V1.1 public workflow definition | Consolidated or retailer/order-wise dispatch tracking | DEPLOYMENT DEPENDENT |
| Central-to-branch transfers | Existing branch/transfer positioning plus V1.1 scope | Designed for transfer status and movement context | DEPLOYMENT DEPENDENT |
| In-transit stock | V1.1 public workflow definition | Designed for shipped, in-transit, received and pending quantity visibility | DEPLOYMENT DEPENDENT |
| Receipt discrepancy context | V1.1 public workflow definition | Designed for short, excess, damage and receiving discrepancy context | DEPLOYMENT DEPENDENT |
| Physical stock take | Existing public capability language plus V1.1 scope | Count sheets, barcode-assisted counting, variance review and adjustment workflow | DEPLOYMENT DEPENDENT |
| Wholesale orders and B2B sales | Existing Wholesale & Trade page plus V1.1 scope | Retailer orders, wholesale sales and allocation context | DEPLOYMENT DEPENDENT |
| Credit management | Existing Wholesale & Trade page | Customer credit limits, payment terms, exposure and outstanding context | DEPLOYMENT DEPENDENT |
| B2B returns | V1.1 public workflow definition | Returns against original invoice or standalone return context | DEPLOYMENT DEPENDENT |
| Purchase planning | V1.1 public workflow definition | Store/retailer indents, consolidation and supplier planning | DEPLOYMENT DEPENDENT |
| Distribution reporting | V1.1 public workflow definition | Sales, stock, dispatch, receipt and transfer context | DEPLOYMENT DEPENDENT |
| Offline operations | Existing product page marks offline synchronization as planned | Local capture, queueing and synchronization are planned | PLANNED |
| Barcode generation | Existing barcode-led workflow positioning; no runtime contract verified here | Designed for item-linked generation, custom codes where configured and duplicate validation | DEPLOYMENT DEPENDENT |
| Barcode printing | Existing barcode and label direction; no runtime contract verified here | Designed for print sources, templates and bulk/range printing | DEPLOYMENT DEPENDENT |
| Print history and failure tracking | Public product design direction only | Planned/deployment-dependent traceability for job, requested, printed and failed quantities | PLANNED / DEPLOYMENT DEPENDENT |
| Stationery consumption | Public product design direction only | Planned/deployment-dependent stationery tracking | PLANNED / DEPLOYMENT DEPENDENT |
| Marketplace synchronization | No universal runtime evidence | Kept deployment-dependent and not used as a guaranteed claim | NOT VERIFIED |
| Guaranteed offline synchronization | No universal runtime evidence | Not advertised as generally available | NOT VERIFIED |
| Universal multi-company operations | Public roadmap language only | Kept planned or deployment-dependent | PLANNED |
| AI capabilities | Public roadmap language only | Kept planned and not advertised as available | PLANNED |

## Release Boundary

This document and the V1.1 public pages are website-only. Control Plane backend, D1, authentication, portals, APIs, migrations, Retail OS runtime and Cloudflare configuration remain outside this release.
