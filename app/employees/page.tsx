"use client";

import { useEffect, useMemo, useState } from "react";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

const ROLES = ["Sales Staff", "Manager", "Accountant", "Operations"] as const;
const STATUSES = ["Active", "Inactive"] as const;
const SALARY_CURRENCIES = ["DZD"] as const;
const COMMISSION_POCKETS = ["Algeria Cash", "Algeria Bank"] as const;

type Employee = {
  id: string;
  employee_code?: string | null;
  name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  base_salary: number | null;
  salary_currency: string | null;
  commission_per_deal: number | null;
  commission_per_managed_deal: number | null;
  start_date: string | null;
  notes: string | null;
  status: string | null;
};

type Commission = {
  id: string;
  employee_id: string;
  deal_id: string;
  amount: number | null;
  currency?: string | null;
  rate_snapshot?: number | null;
  type: string | null;
  status: string | null;
  month: string | null;
  created_at?: string | null;
};

type DealRow = {
  id: string;
  date: string | null;
  car_label: string | null;
  client_name: string | null;
  profit: number | null;
};

type EmployeeFormState = {
  name: string;
  role: (typeof ROLES)[number];
  phone: string;
  email: string;
  baseSalary: string;
  salaryCurrency: (typeof SALARY_CURRENCIES)[number];
  commissionPerDeal: string;
  commissionPerManagedDeal: string;
  startDate: string;
  notes: string;
  status: (typeof STATUSES)[number];
};

const emptyForm = (): EmployeeFormState => ({
  name: "",
  role: "Sales Staff",
  phone: "",
  email: "",
  baseSalary: "",
  salaryCurrency: "DZD",
  commissionPerDeal: "0",
  commissionPerManagedDeal: "0",
  startDate: new Date().toISOString().slice(0, 10),
  notes: "",
  status: "Active",
});

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined, currency: string) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  return `${formatNumber(v)} ${currency}`;
}

function parseNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function monthFromDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default function EmployeesPage() {
  const [activeTab, setActiveTab] = useState<"Employees" | "Commissions">("Employees");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [dealsMap, setDealsMap] = useState<Record<string, DealRow>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);

  const [commissionEmployeeFilter, setCommissionEmployeeFilter] = useState("");
  const [commissionMonthFilter, setCommissionMonthFilter] = useState("");
  const [payAllPocket, setPayAllPocket] = useState<string>(COMMISSION_POCKETS[0]);
  const [payAllEmployeeId, setPayAllEmployeeId] = useState<string | null>(null);
  const [payAllSaving, setPayAllSaving] = useState(false);
  const [payAllDate, setPayAllDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [showPayAllModal, setShowPayAllModal] = useState(false);
  const [paySalaryEmployee, setPaySalaryEmployee] = useState<Employee | null>(null);
  const [paySalaryMonth, setPaySalaryMonth] = useState<string>(monthFromDate(new Date().toISOString()));
  const [paySalaryPocket, setPaySalaryPocket] = useState<string>(COMMISSION_POCKETS[0]);
  const [paySalaryDate, setPaySalaryDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paySalaryNotes, setPaySalaryNotes] = useState<string>("");
  const [isSavingSalary, setIsSavingSalary] = useState(false);

  const generateEmployeeCode = async () => {
    const year = new Date().getFullYear();
    const prefix = `EMP-${year}-`;
    const { data: rows, error } = await supabase
      .from("employees")
      .select("employee_code")
      .ilike("employee_code", `${prefix}%`);
    if (error) throw new Error(error.message);
    let maxSeq = 0;
    ((rows as { employee_code?: string | null }[] | null) ?? []).forEach((r) => {
      const code = (r.employee_code || "").trim();
      const raw = code.startsWith(prefix) ? code.slice(prefix.length) : "";
      const seq = Number(raw);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    });
    return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
  };

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [
        { data: empData, error: empErr },
        { data: commData, error: commErr },
        { data: dealsData, error: dealsErr },
      ] = await Promise.all([
        supabase.from("employees").select("*").order("name", { ascending: true }),
        supabase.from("commissions").select("*").order("created_at", { ascending: false }),
        supabase.from("deals").select("id, date, car_label, client_name, profit"),
      ]);

      if (empErr || commErr) {
        setError(empErr?.message ?? commErr?.message ?? "Failed to load employees data");
        return;
      }

      if (dealsErr) {
        // Deals are only used as lookup context; keep employees screen usable if deals is restricted by RLS.
        console.warn("Employees page: deals lookup unavailable", dealsErr.message);
      }

      setEmployees((empData as Employee[]) ?? []);
      setCommissions((commData as Commission[]) ?? []);
      const map: Record<string, DealRow> = {};
      ((dealsData as DealRow[]) ?? []).forEach((d) => {
        map[d.id] = d;
      });
      setDealsMap(map);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const activeEmployees = useMemo(
    () => employees.filter((e) => (e.status || "").toLowerCase() === "active"),
    [employees]
  );

  const commissionsWithDeal = useMemo(() => {
    return commissions.map((c) => ({
      ...c,
      deal: dealsMap[c.deal_id],
    }));
  }, [commissions, dealsMap]);

  const filteredCommissions = useMemo(() => {
    let list = commissionsWithDeal;
    if (commissionEmployeeFilter) {
      list = list.filter((c) => c.employee_id === commissionEmployeeFilter);
    }
    if (commissionMonthFilter) {
      list = list.filter((c) => c.month === commissionMonthFilter);
    }
    return list;
  }, [commissionsWithDeal, commissionEmployeeFilter, commissionMonthFilter]);

  const pendingByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    commissions.forEach((c) => {
      if ((c.status || "").toLowerCase() !== "pending") return;
      map[c.employee_id] = (map[c.employee_id] ?? 0) + (c.amount ?? 0);
    });
    return map;
  }, [commissions]);

  const monthsOptions = useMemo(() => {
    const set = new Set<string>();
    commissions.forEach((c) => {
      if (c.month) set.add(c.month);
    });
    return Array.from(set).sort().reverse();
  }, [commissions]);

  const updateField = <K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
    setError(null);
  };

  const openEdit = (e: Employee) => {
    setEditingId(e.id);
    setForm({
      name: e.name ?? "",
      role: (ROLES.includes((e.role ?? "") as (typeof ROLES)[number]) ? e.role : "Sales Staff") as (typeof ROLES)[number],
      phone: e.phone ?? "",
      email: e.email ?? "",
      baseSalary: e.base_salary != null ? String(e.base_salary) : "",
      salaryCurrency: "DZD",
      commissionPerDeal: e.commission_per_deal != null ? String(e.commission_per_deal) : "0",
      commissionPerManagedDeal: e.commission_per_managed_deal != null ? String(e.commission_per_managed_deal) : "0",
      startDate: (e.start_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      notes: e.notes ?? "",
      status: ((e.status || "").toLowerCase() === "inactive" ? "Inactive" : "Active") as (typeof STATUSES)[number],
    });
    setIsModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    if (!isSaving) {
      setIsModalOpen(false);
      setEditingId(null);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Full name is required.");
      return;
    }
    const baseSalary = parseNum(form.baseSalary);
    const commissionPerDeal = parseNum(form.commissionPerDeal);
    const commissionPerManagedDeal = form.role === "Manager" ? parseNum(form.commissionPerManagedDeal) : null;
    setIsSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      role: form.role,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      base_salary: baseSalary,
      salary_currency: "DZD",
      commission_per_deal: commissionPerDeal,
      commission_per_managed_deal: form.role === "Manager" ? commissionPerManagedDeal : null,
      start_date: form.startDate || null,
      notes: form.notes.trim() || null,
      status: form.status.toLowerCase(),
    };
    if (editingId) {
      const { error: updateErr } = await supabase.from("employees").update(payload).eq("id", editingId);
      if (updateErr) {
        setError(updateErr.message);
        setIsSaving(false);
        return;
      }
      await logActivity({
        action: "updated",
        entity: "employee",
        entity_id: editingId,
        description: `Employee updated – ${form.name.trim()}`,
      });
      setEmployees((prev) =>
        prev.map((e) => (e.id === editingId ? { ...e, ...payload } : e))
      );
    } else {
      let employeeCode: string;
      try {
        employeeCode = await generateEmployeeCode();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate employee code.");
        setIsSaving(false);
        return;
      }
      const { data: inserted, error: insertErr } = await supabase
        .from("employees")
        .insert({ ...payload, employee_code: employeeCode })
        .select("*")
        .single();
      if (insertErr) {
        setError(insertErr.message);
        setIsSaving(false);
        return;
      }
      const newEmployee = inserted as Employee;
      await logActivity({
        action: "created",
        entity: "employee",
        entity_id: newEmployee.id,
        description: `Employee added – ${newEmployee.name ?? ""}`,
      });
      setEmployees((prev) => [...prev, newEmployee].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    }
    setIsSaving(false);
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleDelete = async (e: Employee) => {
    if (!window.confirm(`Delete employee "${e.name}"? This cannot be undone.`)) return;
    setDeletingId(e.id);
    const { error: delErr } = await supabase.from("employees").delete().eq("id", e.id);
    if (delErr) {
      setError(delErr.message);
      setDeletingId(null);
      return;
    }
    await logActivity({
      action: "deleted",
      entity: "employee",
      entity_id: e.id,
      description: `Employee deleted – ${e.name ?? ""}`,
    });
    setEmployees((prev) => prev.filter((x) => x.id !== e.id));
    setDeletingId(null);
  };

  const openPayAllModal = (employeeId: string) => {
    setPayAllEmployeeId(employeeId);
    setPayAllPocket(COMMISSION_POCKETS[0]);
    setPayAllDate(new Date().toISOString().slice(0, 10));
    setShowPayAllModal(true);
  };

  const handlePayAllPending = async () => {
    if (!payAllEmployeeId) return;
    const employee = employees.find((e) => e.id === payAllEmployeeId);
    const pending = commissions.filter(
      (c) => c.employee_id === payAllEmployeeId && (c.status || "").toLowerCase() === "pending"
    );
    if (!employee || pending.length === 0) {
      setError("No pending commissions for this employee.");
      return;
    }
    const total = pending.reduce((s, c) => s + (c.amount ?? 0), 0);
    if (total <= 0) {
      setError("Total pending is 0.");
      return;
    }
    setPayAllSaving(true);
    setError(null);

    const { error: movErr } = await supabase.from("movements").insert({
      date: payAllDate || new Date().toISOString().slice(0, 10),
      type: "Out",
      category: "Salary",
      description: `Commission payment - ${employee.name ?? ""} - ${(payAllDate || "").slice(0, 7)}`,
      amount: total,
      currency: "DZD",
      pocket: payAllPocket,
    });
    if (movErr) {
      setError(movErr.message);
      setPayAllSaving(false);
      setPayAllEmployeeId(null);
      return;
    }

    const { error: updateErr } = await supabase
      .from("commissions")
      .update({ status: "paid" })
      .eq("employee_id", payAllEmployeeId)
      .eq("status", "pending");
    if (updateErr) {
      setError(updateErr.message);
      setPayAllSaving(false);
      setPayAllEmployeeId(null);
      return;
    }
    await logActivity({
      action: "paid",
      entity: "salary",
      entity_id: payAllEmployeeId,
      description: `Commission paid – ${employee.name ?? ""} – ${(payAllDate || "").slice(0, 7)}`,
      amount: total,
      currency: "DZD",
    });

    const { data: pockets } = await supabase
      .from("cash_positions")
      .select("id, amount, currency")
      .eq("pocket", payAllPocket)
      .eq("currency", "DZD")
      .limit(1)
      .maybeSingle();
    if (pockets && (pockets as { id: string; amount: number }).id) {
      const current = (pockets as { amount: number }).amount || 0;
      await supabase
        .from("cash_positions")
        .update({ amount: current - total })
        .eq("id", (pockets as { id: string }).id);
    }

    await fetchAll();
    setPayAllSaving(false);
    setPayAllEmployeeId(null);
    setShowPayAllModal(false);
  };

  const getEmployeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  const monthsForSelect = useMemo(() => {
    const set = new Set<string>();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(y, m - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      set.add(ym);
    }
    commissions.forEach((c) => {
      if (c.month) set.add(c.month);
    });
    return Array.from(set).sort().reverse();
  }, [commissions]);

  const pendingForSalary = useMemo(() => {
    if (!paySalaryEmployee || !paySalaryMonth) return 0;
    return commissions
      .filter(
        (c) =>
          c.employee_id === paySalaryEmployee.id &&
          (c.status || "").toLowerCase() === "pending" &&
          c.month === paySalaryMonth
      )
      .reduce((s, c) => s + (c.amount ?? 0), 0);
  }, [commissions, paySalaryEmployee, paySalaryMonth]);

  const handlePaySalary = async () => {
    if (!paySalaryEmployee) return;
    const base = paySalaryEmployee.base_salary ?? 0;
    const commissionsThisMonth = pendingForSalary;
    const total = base + commissionsThisMonth;
    if (total <= 0) {
      setError("Nothing to pay for this employee.");
      return;
    }
    const currency = paySalaryEmployee.salary_currency || "DZD";
    setIsSavingSalary(true);
    setError(null);
    const date = paySalaryDate || new Date().toISOString().slice(0, 10);

    const { error: movErr } = await supabase.from("movements").insert({
      date,
      type: "Out",
      category: "Salary",
      description: `Salary - ${paySalaryEmployee.name ?? ""} - ${paySalaryMonth}`,
      amount: total,
      currency,
      pocket: paySalaryPocket,
      notes: paySalaryNotes.trim() || null,
    });
    if (movErr) {
      setError(movErr.message);
      setIsSavingSalary(false);
      return;
    }

    const { data: pocketRow } = await supabase
      .from("cash_positions")
      .select("id, amount, currency, pocket")
      .eq("pocket", paySalaryPocket)
      .eq("currency", currency)
      .limit(1)
      .maybeSingle();
    if (pocketRow && (pocketRow as { id: string }).id) {
      const current = (pocketRow as { amount: number }).amount || 0;
      await supabase
        .from("cash_positions")
        .update({ amount: current - total })
        .eq("id", (pocketRow as { id: string }).id);
    }

    if (commissionsThisMonth > 0) {
      await supabase
        .from("commissions")
        .update({ status: "paid" })
        .eq("employee_id", paySalaryEmployee.id)
        .eq("status", "pending")
        .eq("month", paySalaryMonth);
    }

    await supabase.from("salaries").insert({
      employee_id: paySalaryEmployee.id,
      month: paySalaryMonth,
      base_salary: base,
      commissions: commissionsThisMonth,
      total,
      currency,
      pocket: paySalaryPocket,
      date,
      notes: paySalaryNotes.trim() || null,
    });
    await logActivity({
      action: "paid",
      entity: "salary",
      entity_id: paySalaryEmployee.id,
      description: `Salary paid – ${paySalaryEmployee.name ?? ""} – ${paySalaryMonth}`,
      amount: total,
      currency,
    });

    await fetchAll();
    setIsSavingSalary(false);
    setPaySalaryEmployee(null);
    setPaySalaryNotes("");
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="border-b border-app surface px-4 py-4">
        <h1 className="text-xl font-semibold text-app">Employee & Commission Management</h1>
        <p className="mt-1 text-xs text-muted">Manage staff and track commissions.</p>
      </div>

      <div className="flex border-b border-app surface px-4">
        {(["Employees", "Commissions"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              activeTab === tab
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-muted hover:text-app"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {activeTab === "Employees" && (
          <>
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={openAdd}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a03020]"
              >
                Add Employee
              </button>
            </div>
            {isLoading ? (
              <div className="rounded-lg border border-app surface p-6 text-center text-muted">
                Loading...
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-app surface">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-app text-muted">
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Role</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Salary</th>
                      <th className="px-4 py-3 font-semibold">Commission</th>
                      <th className="px-4 py-3 font-semibold hidden sm:table-cell">Status</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.id} className="border-b border-app last:border-0">
                        <td className="px-4 py-3 text-app">
                          <div className="font-medium">{e.name ?? "—"}</div>
                          <div className="text-[11px] text-muted">{e.employee_code || "No ID"}</div>
                        </td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">{e.role ?? "—"}</td>
                        <td className="px-4 py-3 text-app hidden sm:table-cell">{formatMoney(e.base_salary, e.salary_currency ?? "DZD")}</td>
                        <td className="px-4 py-3 text-app">
                          {e.role === "Manager" && e.commission_per_managed_deal != null
                            ? `${formatMoney(e.commission_per_deal, "DZD")} / ${formatMoney(e.commission_per_managed_deal, "DZD")} (managed)`
                            : formatMoney(e.commission_per_deal, "DZD") + " / deal"}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span
                            className={
                              (e.status || "").toLowerCase() === "active"
                                ? "text-emerald-400"
                                : "text-gray-400"
                            }
                          >
                            {e.status ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(e)}
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewEmployee(e)}
                              className="text-app hover:underline"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(e)}
                              disabled={deletingId === e.id}
                              className="text-red-400 hover:underline disabled:opacity-50"
                            >
                              {deletingId === e.id ? "Deleting..." : "Delete"}
                            </button>
                            {(e.status || "").toLowerCase() === "active" && (
                              <span className="text-[11px] text-muted">Use Payroll page for payouts</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {employees.length === 0 && (
                  <div className="p-6 text-center text-gray-400">No employees yet. Add one to get started.</div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "Commissions" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <select
                value={commissionEmployeeFilter}
                onChange={(e) => setCommissionEmployeeFilter(e.target.value)}
                className="rounded-md border border-app surface px-3 py-2 text-sm text-app"
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name ?? e.id}
                  </option>
                ))}
              </select>
              <select
                value={commissionMonthFilter}
                onChange={(e) => setCommissionMonthFilter(e.target.value)}
                className="rounded-md border border-app surface px-3 py-2 text-sm text-app"
              >
                <option value="">All months</option>
                {monthsOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4 rounded-lg border border-app surface p-4">
              <h3 className="mb-2 text-sm font-semibold text-app">Monthly summary – Pending per employee</h3>
              <ul className="space-y-1 text-sm">
                {employees.map((e) => {
                  const pending = pendingByEmployee[e.id] ?? 0;
                  if (pending <= 0) return null;
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-4">
                      <span className="text-app">{e.name ?? "—"}</span>
                      <span className="text-[var(--color-accent)]">{formatMoney(pending, "DZD")}</span>
                      <div className="text-[11px] text-muted">Pay from Payroll page</div>
                    </li>
                  );
                })}
              </ul>
              {Object.keys(pendingByEmployee).filter((id) => (pendingByEmployee[id] ?? 0) > 0).length === 0 && (
                <p className="text-gray-400">No pending commissions.</p>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-app surface">
              <table className="min-w-[640px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-app text-muted">
                    <th className="px-4 py-3 font-semibold">Employee</th>
                    <th className="px-4 py-3 font-semibold hidden sm:table-cell">Deal</th>
                    <th className="px-4 py-3 font-semibold hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold hidden sm:table-cell">Currency</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommissions.map((c) => (
                    <tr key={c.id} className="border-b border-app last:border-0">
                      <td className="px-4 py-3 text-app">{getEmployeeName(c.employee_id)}</td>
                      <td className="px-4 py-3 text-app hidden sm:table-cell">
                        {c.deal
                          ? `${c.deal.car_label ?? "—"} – ${c.deal.client_name ?? ""}`
                          : c.deal_id}
                      </td>
                      <td className="px-4 py-3 text-app hidden sm:table-cell">{formatDate(c.deal?.date ?? null)}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--color-accent)]">{formatMoney(c.amount, "DZD")}</td>
                      <td className="px-4 py-3 text-app hidden sm:table-cell">DZD</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            (c.status || "").toLowerCase() === "paid" ? "text-emerald-400" : "text-amber-400"
                          }
                        >
                          {c.status ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCommissions.length === 0 && (
                <div className="p-6 text-center text-gray-400">No commissions match the filters.</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* View Employee Modal */}
      {viewEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setViewEmployee(null)} />
          <div className="relative max-w-lg rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">Employee details</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="text-gray-400">Name</dt><dd className="text-app">{viewEmployee.name ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Role</dt><dd className="text-app">{viewEmployee.role ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Phone</dt><dd className="text-app">{viewEmployee.phone ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Email</dt><dd className="text-app">{viewEmployee.email ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Base salary</dt><dd className="text-app">{formatMoney(viewEmployee.base_salary, viewEmployee.salary_currency ?? "DZD")}</dd></div>
              <div><dt className="text-gray-400">Commission per deal</dt><dd className="text-app">{formatMoney(viewEmployee.commission_per_deal, "DZD")}</dd></div>
              {viewEmployee.role === "Manager" && (
                <div><dt className="text-gray-400">Commission (managed)</dt><dd className="text-app">{formatMoney(viewEmployee.commission_per_managed_deal, "DZD")}</dd></div>
              )}
              <div><dt className="text-gray-400">Start date</dt><dd className="text-app">{formatDate(viewEmployee.start_date)}</dd></div>
              <div><dt className="text-gray-400">Status</dt><dd className="text-app">{viewEmployee.status ?? "—"}</dd></div>
              {viewEmployee.notes && <div><dt className="text-gray-400">Notes</dt><dd className="text-app whitespace-pre-wrap">{viewEmployee.notes}</dd></div>}
            </dl>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setViewEmployee(null)}
                className="rounded-md border border-app px-4 py-2 text-sm font-medium text-app"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Salary Modal */}
      {paySalaryEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!isSavingSalary) setPaySalaryEmployee(null);
            }}
          />
          <div className="relative max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">Pay Salary</h2>
            <p className="mt-1 text-xs text-muted">
              Pay base salary and pending commissions for this employee.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs text-app">
              <div className="sm:col-span-2">
                <div className="font-semibold text-app">Employee</div>
                <div className="mt-1 text-sm text-app">
                  {paySalaryEmployee.name ?? "—"}
                </div>
              </div>
              <label className="space-y-1">
                <span className="font-semibold">Month</span>
                <select
                  value={paySalaryMonth}
                  onChange={(e) => setPaySalaryMonth(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                >
                  {monthsForSelect.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-1">
                <span className="font-semibold">Base salary</span>
                <div className="mt-1 text-sm text-app">
                  {formatMoney(paySalaryEmployee.base_salary ?? 0, paySalaryEmployee.salary_currency ?? "DZD")}
                </div>
              </div>
              <div className="space-y-1">
                <span className="font-semibold">Currency</span>
                <div className="mt-1 text-sm text-app">
                  {paySalaryEmployee.salary_currency ?? "DZD"}
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <span className="font-semibold">Pending commissions this month</span>
                <div className="mt-1 text-sm text-app">
                  {formatMoney(pendingForSalary, "DZD")}
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <span className="font-semibold">Total to pay</span>
                <div className="mt-1 text-sm text-[var(--color-accent)] font-semibold">
                  {formatMoney(
                    (paySalaryEmployee.base_salary ?? 0) + pendingForSalary,
                    paySalaryEmployee.salary_currency ?? "DZD"
                  )}
                </div>
              </div>
              <label className="space-y-1">
                <span className="font-semibold">Pocket</span>
                <select
                  value={paySalaryPocket}
                  onChange={(e) => setPaySalaryPocket(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                >
                  {COMMISSION_POCKETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  value={paySalaryDate}
                  onChange={(e) => setPaySalaryDate(e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <textarea
                  value={paySalaryNotes}
                  onChange={(e) => setPaySalaryNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!isSavingSalary) setPaySalaryEmployee(null);
                }}
                disabled={isSavingSalary}
                className="rounded-md border border-app px-4 py-2 text-xs font-medium text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePaySalary}
                disabled={isSavingSalary}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isSavingSalary ? "Paying..." : "Pay Salary"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Pay All Pending Commissions Modal */}
      {showPayAllModal && payAllEmployeeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!payAllSaving) {
                setShowPayAllModal(false);
                setPayAllEmployeeId(null);
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-app">Confirm commission payment</h2>
            <p className="mt-1 text-xs text-muted">
              This will mark all pending commissions for this employee as paid and create a DZD salary movement.
            </p>
            {(() => {
              const emp = employees.find((e) => e.id === payAllEmployeeId);
              const total = pendingByEmployee[payAllEmployeeId] ?? 0;
              return (
                <div className="mt-3 space-y-3 text-xs text-app">
                  <div>
                    <div className="text-gray-400">Employee</div>
                    <div className="text-app font-medium">{emp?.name ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Total pending commissions</div>
                    <div className="text-[var(--color-accent)] font-semibold">
                      {formatMoney(total, "DZD")}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-gray-400">Date</span>
                      <input
                        type="date"
                        value={payAllDate}
                        onChange={(e) => setPayAllDate(e.target.value)}
                        className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-gray-400">Pocket</span>
                      <select
                        value={payAllPocket}
                        onChange={(e) => setPayAllPocket(e.target.value)}
                        className="w-full rounded-md border border-app bg-white px-3 py-2 text-xs text-app"
                      >
                        {COMMISSION_POCKETS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              );
            })()}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!payAllSaving) {
                    setShowPayAllModal(false);
                    setPayAllEmployeeId(null);
                  }
                }}
                className="rounded-md border border-app px-4 py-2 text-xs font-medium text-app disabled:opacity-50"
                disabled={payAllSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePayAllPending}
                disabled={payAllSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {payAllSaving ? "Paying..." : "Confirm payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Employee Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={closeModal} />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-app surface p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-app">{editingId ? "Edit Employee" : "Add Employee"}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Full name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Role</span>
                <select
                  value={form.role}
                  onChange={(e) => updateField("role", e.target.value as (typeof ROLES)[number])}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value as (typeof STATUSES)[number])}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Phone</span>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Base salary (monthly)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.baseSalary}
                    onChange={(e) => updateField("baseSalary", e.target.value)}
                    className="flex-1 rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                  <select
                    value={form.salaryCurrency}
                    onChange={(e) => updateField("salaryCurrency", e.target.value as (typeof SALARY_CURRENCIES)[number])}
                    className="w-20 rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  >
                    {SALARY_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Commission per deal as staff (DZD)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.commissionPerDeal}
                  onChange={(e) => updateField("commissionPerDeal", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              {form.role === "Manager" && (
                <label className="space-y-1 text-xs text-app sm:col-span-2">
                  <span className="font-semibold">Commission per deal as manager/fully managed (DZD)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.commissionPerManagedDeal}
                    onChange={(e) => updateField("commissionPerManagedDeal", e.target.value)}
                    className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                  />
                </label>
              )}
              <label className="space-y-1 text-xs text-app">
                <span className="font-semibold">Start date</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
              <label className="space-y-1 text-xs text-app sm:col-span-2">
                <span className="font-semibold">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="rounded-md border border-app px-4 py-2 text-sm font-medium text-app disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
