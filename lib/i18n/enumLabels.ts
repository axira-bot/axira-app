import { CAR_LOCATION, type CarLocation } from "@/lib/cars/carLocations";
import type { TranslateFn } from "@/lib/context/I18nContext";

function enumKey(
  t: TranslateFn,
  prefix: string,
  code: string | null | undefined,
  fallback?: string
): string {
  const c = String(code ?? "").trim();
  if (!c) return fallback ?? "";
  const key = `${prefix}.${c}`;
  const translated = t(key);
  return translated === key ? (fallback ?? c) : translated;
}

export function carLifecycleLabel(t: TranslateFn, status: string | null | undefined): string {
  return enumKey(t, "enums.carLifecycle", status, String(status ?? "").replace(/_/g, " "));
}

export function carLocationLabel(t: TranslateFn, location: string | null | undefined): string {
  if (location == null || String(location).trim() === "") return "";
  const v = String(location).trim();
  const entry = Object.entries(CAR_LOCATION).find(([, val]) => val === v);
  if (entry) {
    const key = `enums.carLocation.${entry[0]}`;
    const translated = t(key);
    return translated === key ? v : translated;
  }
  return v;
}

/** Map DB CarLocation value to message key suffix (e.g. chinaPort) for dropdown labels. */
export function carLocationKeyForValue(value: CarLocation): keyof typeof CAR_LOCATION | null {
  const e = Object.entries(CAR_LOCATION).find(([, val]) => val === value);
  return e ? (e[0] as keyof typeof CAR_LOCATION) : null;
}

export function carLocationOptionLabel(t: TranslateFn, value: CarLocation): string {
  const k = carLocationKeyForValue(value);
  if (!k) return value;
  return t(`enums.carLocation.${k}`);
}

export function dealStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  return enumKey(t, "enums.dealStatus", status?.toLowerCase(), status ?? "");
}

export function inventoryLifecycleLabel(t: TranslateFn, status: string | null | undefined): string {
  return enumKey(t, "enums.inventoryLifecycle", status?.toUpperCase(), status ?? "");
}

export function dealLifecycleLabel(t: TranslateFn, status: string | null | undefined): string {
  return enumKey(t, "enums.dealLifecycle", status?.toUpperCase(), status ?? "");
}

export function poStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  return enumKey(t, "enums.poStatus", status?.toLowerCase(), status ?? "");
}

export function containerStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  const c = String(status ?? "").trim();
  if (!c) return "";
  const normalized = c.replace(/\s+/g, "");
  const key = `enums.containerStatus.${normalized}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

export function movementTypeLabel(t: TranslateFn, type: string | null | undefined): string {
  const c = String(type ?? "").trim();
  if (!c) return "";
  const key = `enums.movementType.${c}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

export function movementCategoryLabel(t: TranslateFn, category: string | null | undefined): string {
  const c = String(category ?? "").trim();
  if (!c) return "";
  const normalized = c.replace(/\s+/g, "");
  const key = `enums.movementCategory.${normalized}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

/** Cash pocket label for select options (DB value stays e.g. `"Dubai Cash"`). */
export function pocketDetailLabel(t: TranslateFn, pocket: string | null | undefined): string {
  const c = String(pocket ?? "").trim();
  if (!c) return "";
  const normalized = c.replace(/\s+/g, "");
  const key = `movements.pocketsDetail.${normalized}`;
  const translated = t(key);
  return translated === key ? c : translated;
}

export function userRoleLabel(t: TranslateFn, role: string | null | undefined): string {
  const raw = String(role ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return enumKey(t, "enums.userRole", raw, role ?? "");
}

/** Labels for `activity_log.entity` filter dropdown and chips. */
export function activityEntityLabel(t: TranslateFn, entity: string | null | undefined): string {
  const raw = String(entity ?? "").trim();
  if (!raw) return "—";
  const e = raw.toLowerCase();
  const key = `activityLog.entities.${e}`;
  const translated = t(key);
  return translated === key ? raw.charAt(0).toUpperCase() + raw.slice(1) : translated;
}

export function debtStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) return "";
  return enumKey(t, "enums.debtStatus", raw, status ?? "");
}

export function investorReturnStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) return "";
  return enumKey(t, "enums.investorReturnStatus", raw, status ?? "");
}

export function employeeRoleLabel(t: TranslateFn, role: string | null | undefined): string {
  const raw = String(role ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return enumKey(t, "enums.employeeRole", raw, role ?? "");
}

export function employeeStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) return "";
  return enumKey(t, "enums.employeeStatus", raw, status ?? "");
}

export function customsStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) return "";
  return enumKey(t, "enums.customsStatus", raw, status ?? "");
}
