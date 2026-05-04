/** Canonical cash pockets (aligned with movements page rules). */
export const CASH_POCKET_OPTIONS = [
  "Dubai Cash",
  "Dubai Bank",
  "Algeria Cash",
  "Algeria Bank",
  "Qatar",
  "EUR Cash",
  "USD Cash",
] as const;

export type CashPocket = (typeof CASH_POCKET_OPTIONS)[number];

export function isAllowedPocketName(pocket: string): pocket is CashPocket {
  return (CASH_POCKET_OPTIONS as readonly string[]).includes(pocket);
}

/** Returns an error message or null if valid. */
/** Pockets allowed for the given payment currency (for dropdowns). */
export function cashPocketOptionsForCurrency(currency: string): CashPocket[] {
  return CASH_POCKET_OPTIONS.filter((p) => validatePocketForCurrency(p, currency) === null);
}

export function validatePocketForCurrency(pocket: string, currency: string): string | null {
  const p = pocket.trim();
  const c = currency.toUpperCase();
  if (!p) return "Pocket is required.";
  if (!isAllowedPocketName(p)) return `Unknown pocket "${pocket}". Choose a standard cash pocket.`;
  if (c === "DZD" && !["Algeria Cash", "Algeria Bank"].includes(p)) {
    return "DZD payments must use Algeria Cash or Algeria Bank.";
  }
  if (c === "AED" && !["Dubai Cash", "Dubai Bank", "Qatar"].includes(p)) {
    return "AED payments must use Dubai Cash, Dubai Bank, or Qatar.";
  }
  if (c === "USD" && !["Dubai Cash", "USD Cash"].includes(p)) {
    return "USD payments must use Dubai Cash or USD Cash.";
  }
  if (c === "EUR" && p !== "EUR Cash") {
    return "EUR payments must use EUR Cash.";
  }
  return null;
}
