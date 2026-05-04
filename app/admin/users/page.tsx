"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  TextField,
} from "@heroui/react";
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
  suppliers: "Suppliers",
  audit_log: "Audit log",
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
    <div className="min-h-full text-foreground" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              User management
            </h1>
            <p className="text-sm font-medium text-danger">
              Owner only — manage users, access, and password resets
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-default-500 hover:text-danger"
          >
            Back to Dashboard
          </Link>
        </header>

        {error ? (
          <Alert.Root status="danger" className="mb-4">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Card.Root className="mb-8 border border-default-200 shadow-sm">
          <Card.Content className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-default-500">
            Add user
          </h2>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-4">
            <TextField
              name="addEmail"
              type="email"
              value={addEmail}
              onChange={setAddEmail}
              isRequired
              className="min-w-[180px]"
            >
              <Label className="text-xs text-default-500">Email</Label>
              <Input className="text-sm" placeholder="user@company.com" />
            </TextField>
            <TextField
              name="addName"
              value={addName}
              onChange={setAddName}
              isRequired
              className="min-w-[180px]"
            >
              <Label className="text-xs text-default-500">Full name (required)</Label>
              <Input className="text-sm" placeholder="Full name" />
            </TextField>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-default-500">Role</Label>
              <select
                value={addRole}
                onChange={(e) => {
                  setAddRole(e.target.value);
                  setAddEmployeeId("");
                  setAddInvestorId("");
                }}
                className="rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {(addRole === "staff" || addRole === "manager") && (
              <div className="flex min-w-[180px] flex-col gap-1">
                <Label className="text-xs text-default-500">Employee (optional)</Label>
                <select
                  value={addEmployeeId}
                  onChange={(e) => setAddEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
                >
                  <option value="">— None</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name ?? e.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {addRole === "investor" && (
              <div className="flex min-w-[180px] flex-col gap-1">
                <Label className="text-xs text-default-500">Investor (optional)</Label>
                <select
                  value={addInvestorId}
                  onChange={(e) => setAddInvestorId(e.target.value)}
                  className="w-full rounded-lg border border-default-200 bg-content1 px-3 py-2 text-sm outline-none focus:border-danger"
                >
                  <option value="">— None</option>
                  {investors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name ?? i.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <TextField
              name="addPassword"
              type="password"
              value={addPassword}
              onChange={setAddPassword}
              className="min-w-[160px]"
            >
              <Label className="text-xs text-default-500">Password (optional, min 6)</Label>
              <Input className="text-sm" placeholder="Leave blank for invite" minLength={6} />
            </TextField>
            <Button type="submit" variant="primary" size="sm" isDisabled={adding}>
              {adding ? "Adding…" : "Add user"}
            </Button>
          </form>
          {addError ? (
            <Alert.Root status="danger">
              <Alert.Content>
                <Alert.Description>{addError}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : null}
          </Card.Content>
        </Card.Root>

        <Card.Root className="overflow-hidden border border-default-200 shadow-sm">
          <h2 className="border-b border-default-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-default-500">
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
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-7 text-xs text-primary"
                            onPress={() => {
                              setResetUser(u);
                              setResetPassword("");
                            }}
                          >
                            Reset Password
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-7 text-xs text-danger"
                            onPress={() => handleOpenAccess(u)}
                          >
                            Edit Access
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-7 text-xs text-danger"
                            isDisabled={deletingId === u.id}
                            onPress={() => handleDelete(u.id)}
                          >
                            {deletingId === u.id ? "Removing…" : "Remove"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card.Root>
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
              <Button type="button" variant="outline" size="sm" onPress={() => setResetUser(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                isDisabled={resetting}
                onPress={handleResetPassword}
              >
                {resetting ? "Saving…" : "Save"}
              </Button>
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
              <Button type="button" variant="outline" size="sm" onPress={() => setAccessUser(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                isDisabled={savingAccess}
                onPress={handleSaveAccess}
              >
                {savingAccess ? "Saving…" : "Save Access"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
