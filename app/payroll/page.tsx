"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

type Employee = {
  id: string;
  employee_code: string | null;
  name: string | null;
  base_salary: number | null;
  salary_currency: string | null;
  status: string | null;
};

type Commission = {
  id: string;
  employee_id: string;
  amount: number | null;
  month: string | null;
  status: string | null;
  currency: string | null;
};

type SalaryRow = {
  id: string;
  employee_id: string;
  month: string | null;
  total: number | null;
};

const DZD_POCKETS = ["Algeria Cash", "Algeria Bank"] as const;

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  return `${formatNumber(v)} DZD`;
}

function monthFromDate(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export default function PayrollPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [salaryRows, setSalaryRows] = useState<SalaryRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(monthFromDate(new Date().toISOString()));
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [pocket, setPocket] = useState<(typeof DZD_POCKETS)[number]>("Algeria Cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingEmployeeId, setPayingEmployeeId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    const [
      { data: empData, error: empErr },
      { data: commData, error: commErr },
      { data: salaryData, error: salaryErr },
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id, employee_code, name, base_salary, salary_currency, status")
        .eq("status", "active")
        .order("name", { ascending: true }),
      supabase
        .from("commissions")
        .select("id, employee_id, amount, month, status, currency")
        .order("created_at", { ascending: false }),
      supabase
        .from("salaries")
        .select("id, employee_id, month, total")
        .order("date", { ascending: false }),
    ]);
    if (empErr || commErr || salaryErr) {
      setError(empErr?.message || commErr?.message || salaryErr?.message || "Failed to load payroll.");
      setEmployees([]);
      setCommissions([]);
      setSalaryRows([]);
      setLoading(false);
      return;
    }
    setEmployees((empData as Employee[]) ?? []);
    setCommissions((commData as Commission[]) ?? []);
    setSalaryRows((salaryData as SalaryRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    const run = async () => {
      await fetchAll();
    };
    run();
  }, []);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    const now = new Date();
    for (let i = 0; i < 18; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    commissions.forEach((c) => {
      if (c.month) set.add(c.month);
    });
    return Array.from(set).sort().reverse();
  }, [commissions]);

  const rows = useMemo(() => {
    return employees.map((e) => {
      const salaryDzd = Number(e.base_salary || 0);
      const pendingCommissionDzd = commissions
        .filter(
          (c) =>
            c.employee_id === e.id &&
            c.month === selectedMonth &&
            (c.status || "").toLowerCase() === "pending" &&
            ((c.currency || "DZD").toUpperCase() === "DZD")
        )
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const isPaidForMonth = salaryRows.some(
        (s) => s.employee_id === e.id && s.month === selectedMonth
      );
      return {
        employee: e,
        salaryDzd,
        pendingCommissionDzd,
        totalDzd: salaryDzd + pendingCommissionDzd,
        isPaidForMonth,
      };
    });
  }, [employees, commissions, salaryRows, selectedMonth]);

  const filteredRows = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const code = (r.employee.employee_code || "").toLowerCase();
      const name = (r.employee.name || "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [rows, employeeQuery]);

  const monthTotal = filteredRows.reduce((sum, r) => sum + r.totalDzd, 0);
  const dueEmployeesCount = filteredRows.filter((r) => r.totalDzd > 0 && !r.isPaidForMonth).length;
  const paidEmployeesCount = filteredRows.filter((r) => r.isPaidForMonth).length;

  const decrementPocket = async (amount: number) => {
    const { data: pocketRow } = await supabase
      .from("cash_positions")
      .select("id, amount")
      .eq("pocket", pocket)
      .eq("currency", "DZD")
      .limit(1)
      .maybeSingle();
    if (pocketRow?.id) {
      await supabase
        .from("cash_positions")
        .update({ amount: Number(pocketRow.amount || 0) - amount })
        .eq("id", pocketRow.id);
    }
  };

  const handlePayEmployee = async (employee: Employee, salaryDzd: number, pendingCommissionDzd: number) => {
    const total = salaryDzd + pendingCommissionDzd;
    if (total <= 0) {
      setError("Nothing payable for this employee in selected month.");
      return;
    }
    if (salaryRows.some((s) => s.employee_id === employee.id && s.month === selectedMonth)) {
      setError("This employee is already marked paid for the selected month.");
      return;
    }
    setPayingEmployeeId(employee.id);
    setError(null);

    const { error: movementErr } = await supabase.from("movements").insert({
      date,
      type: "Out",
      category: "Salary",
      description: `Payroll - ${employee.name ?? "Employee"} - ${selectedMonth}`,
      amount: total,
      currency: "DZD",
      pocket,
    });
    if (movementErr) {
      setError(movementErr.message);
      setPayingEmployeeId(null);
      return;
    }

    await supabase.from("salaries").insert({
      employee_id: employee.id,
      month: selectedMonth,
      base_salary: salaryDzd,
      commissions: pendingCommissionDzd,
      total,
      currency: "DZD",
      pocket,
      date,
      notes: "Paid via Payroll page",
    });

    if (pendingCommissionDzd > 0) {
      await supabase
        .from("commissions")
        .update({ status: "paid" })
        .eq("employee_id", employee.id)
        .eq("month", selectedMonth)
        .eq("status", "pending");
    }

    await decrementPocket(total);
    await logActivity({
      action: "paid",
      entity: "salary",
      entity_id: employee.id,
      description: `Payroll paid – ${employee.name ?? ""} – ${selectedMonth}`,
      amount: total,
      currency: "DZD",
    });

    await fetchAll();
    setPayingEmployeeId(null);
  };

  return (
    <div className="min-h-screen bg-app text-app">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Payroll</h1>
          <p className="text-sm text-[var(--color-accent)]">Salary + commissions (DZD)</p>
        </header>

        <div className="mb-4 grid gap-3 rounded-lg border border-app surface p-3 md:grid-cols-5">
          <label className="text-xs text-muted">
            Month
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Pocket
            <select
              value={pocket}
              onChange={(e) => setPocket(e.target.value as (typeof DZD_POCKETS)[number])}
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            >
              {DZD_POCKETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Employee filter
            <input
              type="text"
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
              placeholder="Search by code or name"
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            />
          </label>
          <label className="text-xs text-muted">
            Payment date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-app bg-white px-3 py-2 text-sm text-app"
            />
          </label>
          <div className="rounded-md border border-app bg-white px-3 py-2">
            <div className="text-xs text-muted">Total payable</div>
            <div className="text-lg font-semibold text-app">{formatMoney(monthTotal)}</div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-app surface px-4 py-3">
            <div className="text-xs text-muted">Total payable (filtered)</div>
            <div className="text-lg font-semibold text-app">{formatMoney(monthTotal)}</div>
          </div>
          <div className="rounded-lg border border-app surface px-4 py-3">
            <div className="text-xs text-muted">Due employees</div>
            <div className="text-lg font-semibold text-amber-400">{dueEmployeesCount}</div>
          </div>
          <div className="rounded-lg border border-app surface px-4 py-3">
            <div className="text-xs text-muted">Already paid</div>
            <div className="text-lg font-semibold text-emerald-400">{paidEmployeesCount}</div>
          </div>
        </div>

        {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="rounded-lg border border-app surface p-4 text-sm text-muted">Loading payroll...</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-app surface">
            <table className="min-w-[780px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-app text-muted">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Base Salary</th>
                  <th className="px-4 py-3 font-semibold">Pending Commission</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.employee.id} className="border-b border-app last:border-0">
                    <td className="px-4 py-3 text-app">
                      <div className="font-medium">{r.employee.name ?? "—"}</div>
                      <div className="text-xs text-muted">{r.employee.employee_code || "No ID"}</div>
                    </td>
                    <td className="px-4 py-3 text-app">{formatMoney(r.salaryDzd)}</td>
                    <td className="px-4 py-3 text-app">{formatMoney(r.pendingCommissionDzd)}</td>
                    <td className="px-4 py-3 font-semibold text-app">{formatMoney(r.totalDzd)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handlePayEmployee(r.employee, r.salaryDzd, r.pendingCommissionDzd)}
                        disabled={payingEmployeeId === r.employee.id || r.isPaidForMonth}
                        className="rounded-md border border-app bg-white px-3 py-1.5 text-xs font-semibold text-app hover:bg-gray-50 disabled:opacity-50"
                      >
                        {payingEmployeeId === r.employee.id ? "Paying..." : r.isPaidForMonth ? "Paid" : "Pay Employee"}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted">
                      No active employees.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
