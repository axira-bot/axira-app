"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { FEATURE_KEYS, type FeaturePermissions } from "@/lib/auth/featureKeys";
import type { User } from "@supabase/supabase-js";

type UserProfile = {
  id: string;
  name: string;
  role: string;
  employee_id?: string;
  investor_id?: string;
};

type AuthContextType = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  role: string | null;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  isAccountant: boolean;
  isInvestor: boolean;
  permissions: FeaturePermissions;
};

const EMPTY_PERMISSIONS = FEATURE_KEYS.reduce((acc, key) => {
  acc[key] = false;
  return acc;
}, {} as FeaturePermissions);

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  role: null,
  isOwner: false,
  isManager: false,
  isStaff: false,
  isAccountant: false,
  isInvestor: false,
  permissions: EMPTY_PERMISSIONS,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<FeaturePermissions>(EMPTY_PERMISSIONS);
  const isLoadingUserRef = useRef(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    async function loadUser() {
      if (isLoadingUserRef.current) return;
      isLoadingUserRef.current = true;
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (authUser) {
          setUser(authUser);
          const { data: profileRow, error: profileError } = await supabase
            .from("user_profiles")
            .select("id, name, role, employee_id, investor_id")
            .eq("id", authUser.id)
            .maybeSingle();
          if (profileError) {
            // Non-blocking fallback: keep session usable even if profile query fails.
            console.warn("Failed to fetch user profile:", profileError.message);
          }
          const profileData: UserProfile = profileRow
            ? {
                id: profileRow.id,
                name: profileRow.name ?? authUser.email ?? "",
                role: profileRow.role ?? "owner",
                employee_id: profileRow.employee_id,
                investor_id: profileRow.investor_id,
              }
            : {
                id: authUser.id,
                name: authUser.email ?? "",
                role: "owner",
              };
          setProfile(profileData);
          const permRes = await fetch("/api/auth/permissions", { cache: "no-store" });
          const permData = await permRes.json().catch(() => ({}));
          if (permRes.ok && permData?.permissions) {
            setPermissions({ ...EMPTY_PERMISSIONS, ...permData.permissions });
          } else {
            setPermissions(EMPTY_PERMISSIONS);
          }
        } else {
          setUser(null);
          setProfile(null);
          setPermissions(EMPTY_PERMISSIONS);
        }
        setLoading(false);
      } finally {
        isLoadingUserRef.current = false;
      }
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => subscription.unsubscribe();
  }, []);

  const role = profile?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        role,
        isOwner: role === "owner",
        isManager: role === "manager",
        isStaff: role === "staff",
        isAccountant: role === "accountant",
        isInvestor: role === "investor",
        permissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
