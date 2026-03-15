"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at?: string;
};

type EmployeeOption = { id: string; name: string | null };
type InvestorOption = { id: string; name: string | null };

const ROLES = ["owner", "manager", "staff", "accountant", "investor"] as const;

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
    fetchUsers();
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
      setError(data.error ?? "Failed to delete user");
      return;
    }
    fetchUsers();
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
              Owner only — add and remove users
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
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-app disabled:opacity-50"
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
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleDelete(u.id)}
                          disabled={deletingId === u.id}
                          className="text-xs font-medium text-red-400 hover:underline disabled:opacity-50"
                        >
                          {deletingId === u.id ? "Removing…" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
