"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/auth/featureKeys";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  employee_id?: string | null;
  investor_id?: string | null;
  permissions?: Partial<Record<FeatureKey, boolean>>;
  created_at?: string;
};

type EmployeeOption = { id: string; name: string | null };
type InvestorOption = { id: string; name: string | null };

const ROLES = ["owner", "manager", "staff", "accountant", "investor"] as const;
const FEATURE_LABELS: Record<FeatureKey, string> = {
  dashboard: "Dashboard",
  activity: "Activity",
  inventory: "Inventory",
  deals: "Deals",
  containers: "Containers",
  movements: "Movements",
  transfers: "Transfers",
  debts: "Debts",
  employees: "Employees",
  payroll: "Payroll",
  investors: "Investors",
  reports: "Reports",
  clients: "Clients",
  inquiries: "Inquiries",
  purchase_orders: "Purchase Orders",
  admin_users: "Admin Users",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [investors, setInvestors] = useState<InvestorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState<string>("staff");
  const [addEmployeeId, setAddEmployeeId] = useState<string>("");
  const [addInvestorId, setAddInvestorId] = useState<string>("");
  const [addPassword, setAddPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [accessUser, setAccessUser] = useState<UserRow | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessRole, setAccessRole] = useState<string>("staff");
  const [accessName, setAccessName] = useState("");
  const [accessEmployeeId, setAccessEmployeeId] = useState("");
  const [accessInvestorId, setAccessInvestorId] = useState("");
  const [accessPermissions, setAccessPermissions] = useState<Partial<Record<FeatureKey, boolean>>>(
    {}
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/users");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load users");
      setUsers([]);
    } else {
      setError(null);
      setUsers(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await fetchUsers();
    };
    run();
  }, [fetchUsers]);

  useEffect(() => {
    const loadOptions = async () => {
      const [empRes, invRes] = await Promise.all([
        supabase.from("employees").select("id, name").order("name", { ascending: true }),
        supabase.from("investors").select("id, name").order("name", { ascending: true }),
      ]);
      setEmployees((empRes.data as EmployeeOption[]) ?? []);
      setInvestors((invRes.data as InvestorOption[]) ?? []);
    };
    loadOptions();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!addName.trim()) {
      setAddError("Full name is required.");
      return;
    }
    setAdding(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: addEmail.trim(),
        name: addName.trim(),
        role: addRole,
        employee_id: (addRole === "staff" || addRole === "manager") && addEmployeeId ? addEmployeeId : null,
        investor_id: addRole === "investor" && addInvestorId ? addInvestorId : null,
        password: addPassword.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) {
      setAddError(data.error ?? "Failed to add user");
      return;
    }
    setAddEmail("");
    setAddName("");
    setAddRole("staff");
    setAddEmployeeId("");
    setAddInvestorId("");
    setAddPassword("");
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Remove this user? They will no longer be able to sign in.")) return;
    setDeletingId(id);
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    setDeletingId(null);
    if (!res.ok) {
      setError(data.error ? `Delete failed: ${data.error}` : "Failed to delete user");
      return;
    }
    fetchUsers();
  };

  const handleOpenAccess = (u: UserRow) => {
    setAccessUser(u);
    setAccessRole(u.role || "staff");
    setAccessName(u.name || "");
    setAccessEmployeeId(u.employee_id || "");
    setAccessInvestorId(u.investor_id || "");
    setAccessPermissions(u.permissions || {});
  };

  const handleSaveAccess = async () => {
    if (!accessUser) return;
    setSavingAccess(true);
    setError(null);
    const roleRes = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "update_profile_role_links",
        user_id: accessUser.id,
        role: accessRole,
        name: accessName,
        employee_id: (accessRole === "staff" || accessRole === "manager") ? accessEmployeeId || null : null,
        investor_id: accessRole === "investor" ? accessInvestorId || null : null,
      }),
    });
    const roleData = await roleRes.json().catch(() => ({}));
    if (!roleRes.ok) {
      setSavingAccess(false);
      setError(roleData.error ?? "Failed to save profile links");
      return;
    }

    const permRes = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "set_feature_permissions",
        user_id: accessUser.id,
        permissions: accessPermissions,
      }),
    });
    const permData = await permRes.json().catch(() => ({}));
    setSavingAccess(false);
    if (!permRes.ok) {
      setError(permData.error ?? "Failed to save feature access");
      return;
    }
    setAccessUser(null);
    fetchUsers();
  };

  const handleResetPassword = async () => {
    if (!resetUser) return;
    if (resetPassword.trim().length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    setResetting(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reset_password",
        user_id: resetUser.id,
        new_password: resetPassword.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setResetting(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to reset password");
      return;
    }
    setResetUser(null);
    setResetPassword("");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app p-6 text-muted">
        Loading users…
      </div>
    );
  }

  if (error && users.length === 0) {
    return (
      <div className="min-h-screen bg-app p-6">
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
        <p className="mt-4 text-sm text-muted">
          If you are not an owner, you do not have access to this page.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              User management
            </h1>
            <p className="text-sm font-medium text-[var(--color-accent)]">
              Owner only — manage users, access, and password resets
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-muted hover:text-[var(--color-accent)]"
          >
            Back to Dashboard
          </Link>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="mb-8 rounded-lg border border-app surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Add user
          </h2>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-4">
            <label className="min-w-[180px]">
              <span className="mb-1 block text-xs text-muted">Email</span>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
                className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                placeholder="user@company.com"
              />
            </label>
            <label className="min-w-[180px]">
              <span className="mb-1 block text-xs text-muted">Full name (required)</span>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
                className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                placeholder="Full name"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted">Role</span>
              <select
                value={addRole}
                onChange={(e) => {
                  setAddRole(e.target.value);
                  setAddEmployeeId("");
                  setAddInvestorId("");
                }}
                className="rounded-md border border-app surface px-3 py-2 text-sm text-app"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {(addRole === "staff" || addRole === "manager") && (
              <label className="min-w-[180px]">
                <span className="mb-1 block text-xs text-muted">Employee (optional)</span>
                <select
                  value={addEmployeeId}
                  onChange={(e) => setAddEmployeeId(e.target.value)}
                  className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                >
                  <option value="">— None</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name ?? e.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {addRole === "investor" && (
              <label className="min-w-[180px]">
                <span className="mb-1 block text-xs text-muted">Investor (optional)</span>
                <select
                  value={addInvestorId}
                  onChange={(e) => setAddInvestorId(e.target.value)}
                  className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                >
                  <option value="">— None</option>
                  {investors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name ?? i.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="min-w-[160px]">
              <span className="mb-1 block text-xs text-muted">
                Password (optional, min 6)
              </span>
              <input
                type="password"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                minLength={6}
                className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                placeholder="Leave blank for invite"
              />
            </label>
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add user"}
            </button>
          </form>
          {addError && (
            <p className="mt-2 text-sm text-red-300">{addError}</p>
          )}
        </section>

        <section className="rounded-lg border border-app surface overflow-hidden">
          <h2 className="border-b border-app px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">
            All users
          </h2>
          {users.length === 0 ? (
            <div className="p-6 text-sm text-gray-400">No users yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-app text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Links</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-app last:border-b-0"
                    >
                      <td className="px-4 py-3 text-app">{u.email}</td>
                      <td className="px-4 py-3 text-app">
                        {u.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-app">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {u.employee_id ? `EMP: ${u.employee_id.slice(0, 8)}…` : ""}
                        {u.employee_id && u.investor_id ? " | " : ""}
                        {u.investor_id ? `INV: ${u.investor_id.slice(0, 8)}…` : ""}
                        {!u.employee_id && !u.investor_id ? "—" : ""}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setResetUser(u);
                              setResetPassword("");
                            }}
                            className="text-xs font-medium text-blue-400 hover:underline"
                          >
                            Reset Password
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenAccess(u)}
                            className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                          >
                            Edit Access
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u.id)}
                            disabled={deletingId === u.id}
                            className="text-xs font-medium text-red-400 hover:underline disabled:opacity-50"
                          >
                            {deletingId === u.id ? "Removing…" : "Remove"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-app surface p-4">
            <h3 className="text-lg font-semibold">Reset password</h3>
            <p className="mt-1 text-sm text-muted">{resetUser.email}</p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-muted">New password</span>
              <input
                type="password"
                minLength={6}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetUser(null)}
                className="rounded-md border border-app px-3 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting}
                className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {resetting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {accessUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-app surface p-4">
            <h3 className="text-lg font-semibold">Edit Access</h3>
            <p className="mt-1 text-sm text-muted">{accessUser.email}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label>
                <span className="mb-1 block text-xs text-muted">Name</span>
                <input
                  type="text"
                  value={accessName}
                  onChange={(e) => setAccessName(e.target.value)}
                  className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs text-muted">Role</span>
                <select
                  value={accessRole}
                  onChange={(e) => {
                    setAccessRole(e.target.value);
                    if (e.target.value !== "investor") setAccessInvestorId("");
                    if (e.target.value !== "staff" && e.target.value !== "manager") {
                      setAccessEmployeeId("");
                    }
                  }}
                  className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {(accessRole === "staff" || accessRole === "manager") && (
                <label>
                  <span className="mb-1 block text-xs text-muted">Employee link</span>
                  <select
                    value={accessEmployeeId}
                    onChange={(e) => setAccessEmployeeId(e.target.value)}
                    className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                  >
                    <option value="">— None</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name ?? e.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {accessRole === "investor" && (
                <label>
                  <span className="mb-1 block text-xs text-muted">Investor link</span>
                  <select
                    value={accessInvestorId}
                    onChange={(e) => setAccessInvestorId(e.target.value)}
                    className="w-full rounded-md border border-app surface px-3 py-2 text-sm text-app"
                  >
                    <option value="">— None</option>
                    {investors.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name ?? i.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="mt-4 rounded-md border border-app p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Feature access
              </p>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {FEATURE_KEYS.map((feature) => (
                  <label key={feature} className="flex items-center gap-2 text-sm text-app">
                    <input
                      type="checkbox"
                      checked={Boolean(accessPermissions[feature])}
                      onChange={(e) =>
                        setAccessPermissions((prev) => ({
                          ...prev,
                          [feature]: e.target.checked,
                        }))
                      }
                    />
                    {FEATURE_LABELS[feature]}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAccessUser(null)}
                className="rounded-md border border-app px-3 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAccess}
                disabled={savingAccess}
                className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingAccess ? "Saving…" : "Save Access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
