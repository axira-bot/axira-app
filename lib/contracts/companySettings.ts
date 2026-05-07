import type { SupabaseClient } from "@supabase/supabase-js";

export type CompanySettings = {
  id: "default";
  fze_license_number: string;
  fze_address: string;
  fze_representative: string;
  fze_position: string;
  auto_license_number: string;
  auto_address: string;
  auto_representative: string;
  auto_position: string;
  fze_phone: string;
  fze_email: string;
  auto_phone: string;
  auto_email: string;
  updated_at: string;
  updated_by: string | null;
};

export const COMPANY_REQUIRED_FIELDS: Array<keyof CompanySettings> = [
  "fze_license_number",
  "fze_address",
  "fze_representative",
  "fze_position",
  "auto_license_number",
  "auto_address",
  "auto_representative",
  "auto_position",
  "fze_phone",
  "fze_email",
  "auto_phone",
  "auto_email",
];

export function companySettingsMissingFields(
  row: Partial<CompanySettings> | null | undefined
): string[] {
  if (!row) return [...COMPANY_REQUIRED_FIELDS];
  return COMPANY_REQUIRED_FIELDS.filter((k) => !String(row[k] ?? "").trim());
}

export async function loadCompanySettingsOrThrow(
  admin: SupabaseClient
): Promise<CompanySettings> {
  const { data, error } = await admin
    .from("company_settings")
    .select("*")
    .eq("id", "default")
    .single();
  if (error || !data) {
    throw new Error(
      "Company settings not configured. Please complete /settings/company before generating contracts."
    );
  }
  const missing = companySettingsMissingFields(data as Partial<CompanySettings>);
  if (missing.length > 0) {
    throw new Error(
      "Company settings not configured. Please complete /settings/company before generating contracts."
    );
  }
  return data as CompanySettings;
}
