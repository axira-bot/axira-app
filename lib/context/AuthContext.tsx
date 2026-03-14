"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UserProfile = {
  id: string;
  name: string;
  role: string;
  employee_id?: string;
  investor_id?: string;
};

type AuthContextType = {
  user: any;
  profile: UserProfile | null;
  loading: boolean;
  role: string | null;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  isAccountant: boolean;
  isInvestor: boolean;
};

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
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    async function loadUser() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) {
        setUser(authUser);
        const { data: profileRow } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", authUser.id)
          .single();
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
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
