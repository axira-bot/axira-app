"use client";

import { useAuth } from "@/lib/context/AuthContext";

export type AppRole = "owner" | "manager" | "staff" | "investor" | "accountant" | null;

export function useRole() {
  const auth = useAuth();
  const role = auth.role as AppRole;

  return {
    role,
    name: auth.profile?.name ?? null,
    loading: auth.loading,
    isOwner: auth.isOwner,
    isManager: auth.isManager,
    isStaff: auth.isStaff,
    isAccountant: auth.isAccountant,
    isInvestor: auth.isInvestor,
    employeeId: auth.profile?.employee_id ?? null,
  };
}
