/** ISO-style VIN: 17 alphanumeric chars excluding I, O, Q */

const ISO_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase();
}

export function isValidIsoVin(raw: string): boolean {
  const v = normalizeVin(raw);
  return v.length === 17 && ISO_VIN.test(v);
}
