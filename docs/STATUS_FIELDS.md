## Status Fields Overview

Axira currently has several different status-related fields. This file explains what each one means, who "owns" it, and where it is used.

### 1. `cars.status`

- **Type**: free-form text (e.g. `"available"`, `"sold"`, `"in_transit"`, `"delivered"`, `"in_stock"`).
- **Owner**: legacy sales / inventory flows.
- **Meaning**: high-level sales / availability state for the car.
- **Used in**:
  - Inventory list (`app/inventory/page.tsx`) via `getEffectiveStatus`.
  - Sales list filtering (`app/api/sales-list/route.ts`).
  - Deal creation / eligibility checks.
- **Notes**: this is the primary legacy sales-status field. Do not repurpose it for physical lifecycle.

### 2. `cars.display_status`

- **Type**: text (`"available"`, `"in_transit"`, `"sold"`).
- **Owner**: inventory UI.
- **Meaning**: UI override for how availability is displayed (e.g. force a car to show as sold).
- **Used in**:
  - `getEffectiveStatus` in `app/inventory/page.tsx`.
  - Deal and inventory flows that read the "effective" sales status.
- **Notes**: derived status for UI. If set, it wins over `cars.status` when computing the effective status badge.

### 3. `cars.status_override`

- **Type**: text or `null`.
- **Owner**: inventory UI (manager/owner).
- **Meaning**: manual override chosen in the inventory edit modal (`available` / `in_transit` / `sold`).
- **Used in**:
  - `getEffectiveStatus` in `app/inventory/page.tsx`.
- **Notes**: when present, this takes precedence over both `cars.display_status` and `cars.status`.

### 4. `cars.inventory_lifecycle_status`

- **Type**: constrained text; allowed values (from migrations) are:
  - `IN_STOCK`
  - `INCOMING`
  - `IN_TRANSIT`
  - `AT_PORT`
  - `ARRIVED`
  - `READY_TO_SHIP`
  - `DELIVERED`
- **Owner**: legacy inventory / PO flows.
- **Meaning**: older physical lifecycle field for stock managed via purchase orders.
- **Used in**:
  - PO flows (`app/api/purchase-orders/*`, `app/purchase-orders/[id]/page.tsx`).
  - Inventory list (PO badge: `PO: ... · {inventory_lifecycle_status || "IN_TRANSIT"}`).
  - Sales list segmentation (`app/api/sales-list/route.ts` and `app/sales-list/page.tsx`).
- **Notes**:
  - This field remains **untouched** by the new lifecycle feature.
  - A future "Sync to inventory_lifecycle_status" owner-only tool will allow manually copying the new lifecycle field into this legacy column when desired.

### 5. `cars.lifecycle_status` (NEW)

- **Type**: text, NOT NULL, default `'ORDERED'`.
- **Enum values (business-level)**:
  - `ORDERED` — supplier order placed, no production yet.
  - `IN_PRODUCTION` — being manufactured/sourced.
  - `AT_POL` — arrived at Port of Loading (origin port).
  - `LOADED` — loaded onto vessel.
  - `IN_TRANSIT` — sailing.
  - `AT_POD` — arrived at Port of Discharge (Algeria).
  - `CLEARED` — cleared through Algerian customs by Axira agent.
  - `DELIVERED` — handed to customer at Axira Auto premises.
- **Owner**: lifecycle feature (Owner/Manager can change via dedicated dropdown).
- **Meaning**: **canonical physical lifecycle** of the car, independent of sales status.
- **Used in** (after full feature rollout):
  - Inventory car detail (badge + dropdown).
  - Purchase order car views (read-only badge, possibly with quick access).
  - Deal view (read-only badge, to understand car’s physical state).
  - Car audit history (`car_audit_log`).
- **Backfill rule for existing rows**:
  - if `status` is `available` or `in_stock` → `CLEARED`
  - if `status` is `sold` or `delivered` → `DELIVERED`
  - otherwise → `ORDERED`

### 6. `deals.lifecycle_status`

- **Type**: text with existing check constraint; allowed values:
  - `PRE_ORDER`
  - `ORDERED`
  - `SHIPPED`
  - `ARRIVED`
  - `CLOSED`
  - `CANCELLED`
- **Owner**: pre-order / deal lifecycle feature.
- **Meaning**: customer-facing lifecycle of the deal itself (pre-order through closure).
- **Used in**:
  - Deal transition API (`app/api/deals/[id]/transition/route.ts`).
  - Pre-order UI (buttons for ORDERED/SHIPPED/ARRIVED/CLOSED/CANCELLED).
  - Side-effects into `cars.inventory_lifecycle_status` when a deal reaches ARRIVED/CLOSED.
- **Notes**: this is **deal-level** lifecycle, not car inventory lifecycle.

### 7. How they relate (high level)

- **Sales status (availability)**:
  - Primary: `cars.status`
  - Overrides: `cars.status_override`, `cars.display_status`
  - UI: `DisplayStatusBadge` in inventory; sales list filters.

- **Legacy inventory lifecycle**:
  - `cars.inventory_lifecycle_status`
  - Still used by PO and sales-list flows.
  - Not automatically synced from the new lifecycle field yet.

- **New physical lifecycle**:
  - `cars.lifecycle_status`
  - Single canonical source of truth for "where is the car physically?" going forward.
  - Editable via a dedicated dropdown (Owner/Manager), with audit logging.

- **Deal lifecycle**:
  - `deals.lifecycle_status`
  - Represents the customer’s journey from pre-order to closed/cancelled, and may update related car rows when appropriate.

