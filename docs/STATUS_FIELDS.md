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

### 4. `cars.inventory_lifecycle_status` (legacy)

- **Type**: constrained text; allowed values (from migrations) include:
  - `IN_STOCK`
  - `INCOMING`
  - `IN_TRANSIT`
  - `AT_PORT`
  - `ARRIVED`
  - `READY_TO_SHIP`
  - `DELIVERED`
- **Owner**: legacy inventory / PO flows; **automatically synced** from `lifecycle_status` on each lifecycle write (RPC `update_car_lifecycle_with_audit` and bulk PO/inventory lifecycle updates).
- **Meaning**: older physical lifecycle bucket for PO and reporting; mirrors canonical lifecycle via **`lifecycle_status_to_inventory_lifecycle()`** in Postgres (see mapping below).
- **Used in**:
  - PO flows (`app/api/purchase-orders/*`, `app/purchase-orders/[id]/page.tsx`).
  - Inventory list (PO badge: `PO: … · {inventory_lifecycle_status || "IN_TRANSIT"}`).

### 5. `cars.lifecycle_status` (canonical physical lifecycle)

- **Type**: text, NOT NULL, default `'ORDERED'`.
- **Enum values** (canonical order: `CAR_LIFECYCLE_STATUSES` + `lifecycle_status_to_inventory_lifecycle()` in `lib/cars/carLifecycleStatus.ts` / migration):

  | Value | Meaning |
  | :--- | :--- |
  | `ORDERED` | Supplier order placed; not yet in production |
  | `IN_PRODUCTION` | Being manufactured or sourced |
  | `READY_FOR_EXPORT` | Ready for export (e.g. Dubai hub) |
  | `AT_POL` | At Port of Loading (origin) |
  | `LOADED` | Loaded onto vessel |
  | `IN_TRANSIT` | Sailing |
  | `AT_POD` | At Port of Discharge (Algeria) |
  | `CLEARED` | Cleared Algerian customs (Axira agent) |
  | `DELIVERED` | Handed to customer at Axira Auto |

- **Owner**: lifecycle feature (Owner/Manager via dropdown on inventory car and PO-linked cars).
- **Meaning**: **single source of truth** for “where is the car physically?”.
- **Used in**:
  - Inventory and PO dropdowns (`CAR_LIFECYCLE_STATUSES`).
  - **Sales list tabs** (`app/api/sales-list/route.ts`): cars are grouped by **`salesBucketFor(lifecycle_status)`** in `lib/cars/carLifecycleStatus.ts`:
    - **`coming_soon`**: `ORDERED`, `IN_PRODUCTION`
    - **`ready_for_export`**: `READY_FOR_EXPORT`, `AT_POL`
    - **`in_transit`**: `LOADED`, `IN_TRANSIT`
    - **`available_now`**: `AT_POD`, `CLEARED`
    - **`null`** (excluded from inventory tabs): **`DELIVERED`** only
  - Car audit (`car_audit_log`).
- **Canonical → legacy inventory column** (`lifecycle_status_to_inventory_lifecycle()`):

  | Canonical | Legacy `inventory_lifecycle_status` |
  | :--- | :--- |
  | `ORDERED` | `INCOMING` |
  | `IN_PRODUCTION` | `INCOMING` |
  | `READY_FOR_EXPORT` | `IN_STOCK` |
  | `AT_POL` | `IN_TRANSIT` |
  | `LOADED` | `IN_TRANSIT` |
  | `IN_TRANSIT` | `IN_TRANSIT` |
  | `AT_POD` | `IN_STOCK` |
  | `CLEARED` | `IN_STOCK` |
  | `DELIVERED` | `DELIVERED` |

- **Sales list exclusion**: **`DELIVERED`** cars are never returned in `/api/sales-list` inventory buckets (same as before for “sold/delivered” behavior).
- **Backfill rule for legacy rows** (historical docs; not re-run automatically):
  - if `status` is `available` or `in_stock` → commonly mapped to **`CLEARED`**
  - if `status` is `sold` or `delivered` → **`DELIVERED`**
  - otherwise → **`ORDERED`**

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
- **Notes**: this is **deal-level** lifecycle, not canonical car **`lifecycle_status`**.

### 7. How they relate (high level)

- **Sales status (availability)**:
  - Primary: `cars.status`
  - Overrides: `cars.status_override`, `cars.display_status`
  - UI: `DisplayStatusBadge` in inventory; sales list eligibility still respects sales rules in the API route.

- **Legacy inventory lifecycle**:
  - `cars.inventory_lifecycle_status`
  - Kept for PO/reporting parity; synced from **`cars.lifecycle_status`** on lifecycle RPC updates.

- **Canonical physical lifecycle**:
  - `cars.lifecycle_status`
  - Drives location suggestions (`suggestedLocationForLifecycle` in `lib/cars/carLocations.ts`) and sales-list bucket tabs.

- **Deal lifecycle**:
  - `deals.lifecycle_status`
  - Represents the customer’s journey from pre-order to closed/cancelled.
