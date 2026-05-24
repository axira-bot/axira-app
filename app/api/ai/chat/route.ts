// NOTE: movements/deals/debts inserts include source: "ai_agent" for audit. Ensure these tables have a `source` column (nullable text). If not, add it via migration separately.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { attachDealCoreMetrics } from "@/lib/finance/attachDealCoreMetrics";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rcodmxamakoklzezjxyi.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjb2RteGFtYWtva2x6ZXpqeHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDExMzAsImV4cCI6MjA4ODU3NzEzMH0.ae3ueUIeEVtMfuGMB5xFokI47X_PvT5B_d0FJ_xRf-8";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const AI_SOURCE = "ai_agent" as const;

const EXPENSE_CATEGORIES = [
  "Shipping",
  "Maintenance",
  "Rent",
  "Fuel",
  "Salary",
  "Customs",
  "Office",
  "Travel",
  "Marketing",
  "Utilities",
  "Other",
] as const;

const POCKETS = [
  "Dubai Cash",
  "Dubai Bank",
  "Algeria Cash",
  "Algeria Bank",
  "Qatar",
  "EUR Cash",
  "USD Cash",
] as const;

const CURRENCIES = ["AED", "DZD", "USD", "EUR"] as const;

type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
type Pocket = (typeof POCKETS)[number];
type Currency = (typeof CURRENCIES)[number];

function normalizeCategory(category: string): ExpenseCategory {
  const match = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === category.trim().toLowerCase());
  return match ?? "Other";
}

function isDebtPaid(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase();
  return s === "paid" || s === "settled";
}

// ── Fetch business snapshot from Supabase ──────────────────────────────────
async function getBusinessContext() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [{ data: dealRows }, { data: cash }, { data: debts }, { data: cars }, { data: movements }] =
    await Promise.all([
      supabase
        .from("deals")
        .select(
          "id, client_name, car_label, date, sale_amount, sale_currency, sale_rate_to_aed, cost_amount, cost_currency, cost_rate_to_aed, invoice_declared_usd, status, collected_dzd, pending_dzd"
        )
        .order("date", { ascending: false })
        .limit(50),
      supabase.from("cash_positions").select("*"),
      supabase
        .from("debts")
        .select("id, name, original_amount, amount_paid, amount_remaining, currency, type, status, due_date")
        .neq("status", "settled")
        .limit(30),
      supabase
        .from("cars")
        .select("brand, model, year, color, status, purchase_price, purchase_currency, country_of_origin")
        .eq("status", "available")
        .limit(30),
      supabase
        .from("movements")
        .select("date, type, category, description, amount, currency, pocket")
        .gte("date", thirtyDaysAgo)
        .order("date", { ascending: false })
        .limit(100),
    ]);

  const dealFacts =
    (dealRows as {
      id: string;
      client_name: string;
      car_label: string;
      date: string;
      sale_amount: number;
      sale_currency: string;
      sale_rate_to_aed: number | null;
      cost_amount: number;
      cost_currency: string;
      cost_rate_to_aed: number;
      invoice_declared_usd: number | null;
      status: string;
      collected_dzd: number;
      pending_dzd: number;
    }[]) ?? [];
  const deals = await attachDealCoreMetrics(supabase, dealFacts);

  return { deals, cash, debts, cars, movements };
}

// ── Write tools ────────────────────────────────────────────────────────────
async function logExpense(params: {
  amount: number;
  currency: string;
  pocket: string;
  category: string;
  description: string;
  date: string;
}) {
  const category = normalizeCategory(params.category);
  const { error } = await supabase.from("movements").insert({
    date: params.date,
    type: "expense",
    category,
    description: params.description,
    amount: params.amount,
    currency: params.currency,
    pocket: params.pocket,
    aed_equivalent: params.currency === "AED" ? params.amount : null,
    source: AI_SOURCE,
  });
  if (error) throw new Error(error.message);
  return {
    success: true,
    message: `Logged expense: ${params.description} — ${params.amount} ${params.currency} from ${params.pocket} (${category})`,
  };
}

async function logClientPayment(params: {
  deal_id: string;
  amount: number;
  currency: string;
  pocket: string;
  date: string;
  description: string;
}) {
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, client_name, car_label, status, collected_dzd, pending_dzd, sale_amount, sale_currency")
    .eq("id", params.deal_id)
    .maybeSingle();

  if (dealErr) throw new Error(dealErr.message);
  if (!deal) throw new Error("Deal not found");

  const status = (deal.status || "").toLowerCase();
  if (status === "closed") throw new Error("Deal is already closed");

  const { error: movErr } = await supabase.from("movements").insert({
    date: params.date,
    type: "income",
    category: "client_payment",
    description: params.description,
    amount: params.amount,
    currency: params.currency,
    pocket: params.pocket,
    deal_id: params.deal_id,
    aed_equivalent: params.currency === "AED" ? params.amount : null,
    source: AI_SOURCE,
  });
  if (movErr) throw new Error(movErr.message);

  let newPending = Number(deal.pending_dzd || 0);
  if (params.currency.toUpperCase() === "DZD") {
    const prevCollected = Number(deal.collected_dzd || 0);
    const collected = prevCollected + params.amount;
    const saleDzd =
      String(deal.sale_currency || "").toUpperCase() === "DZD" ? Number(deal.sale_amount || 0) : 0;
    newPending = Math.max(saleDzd - collected, 0);

    const { error: dealUpErr } = await supabase
      .from("deals")
      .update({ collected_dzd: collected, pending_dzd: newPending })
      .eq("id", params.deal_id);
    if (dealUpErr) throw new Error(dealUpErr.message);
  }

  const clientName = (deal.client_name as string | null) || "—";
  const carLabel = (deal.car_label as string | null) || "—";
  return {
    success: true,
    message: `Client payment logged: ${params.amount} ${params.currency} for ${clientName} (${carLabel}). New pending balance: ${newPending.toLocaleString()} DZD`,
  };
}

async function logDebtPayment(params: {
  debt_id?: string;
  debt_label?: string;
  amount: number;
  currency: string;
  pocket: string;
  date: string;
}) {
  if (!params.debt_id?.trim() && !params.debt_label?.trim()) {
    throw new Error("Provide debt_id or debt_label");
  }

  let debt: {
    id: string;
    name: string | null;
    original_amount: number | null;
    amount_paid: number | null;
    amount_remaining: number | null;
    status: string | null;
    currency: string | null;
  } | null = null;

  if (params.debt_id?.trim()) {
    const { data, error } = await supabase
      .from("debts")
      .select("id, name, original_amount, amount_paid, amount_remaining, status, currency")
      .eq("id", params.debt_id.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    debt = data;
  } else {
    const label = params.debt_label!.trim();
    const { data, error } = await supabase
      .from("debts")
      .select("id, name, original_amount, amount_paid, amount_remaining, status, currency")
      .ilike("name", label)
      .limit(2);
    if (error) throw new Error(error.message);
    if (!data?.length) debt = null;
    else if (data.length > 1) {
      throw new Error(`Multiple debts match "${label}". Use debt_id instead.`);
    } else debt = data[0];
  }

  if (!debt) throw new Error("Debt not found");
  if (isDebtPaid(debt.status)) throw new Error("Debt is already paid");

  const debtLabel = (debt.name || "").trim() || "Unknown debt";
  const remainingBefore =
    debt.amount_remaining != null
      ? Number(debt.amount_remaining)
      : Math.max(Number(debt.original_amount || 0) - Number(debt.amount_paid || 0), 0);

  const isFullPayment = params.amount >= remainingBefore;
  const movementDescription = isFullPayment
    ? `Payment for: ${debtLabel}`
    : `Payment for: ${debtLabel} (partial — ${params.amount} of ${remainingBefore} ${params.currency})`;

  const { error: movErr } = await supabase.from("movements").insert({
    date: params.date,
    type: "expense",
    category: "debt_payment",
    description: movementDescription,
    amount: params.amount,
    currency: params.currency,
    pocket: params.pocket,
    aed_equivalent: params.currency === "AED" ? params.amount : null,
    source: AI_SOURCE,
  });
  if (movErr) throw new Error(movErr.message);

  const prevPaid = Number(debt.amount_paid || 0);
  const newPaid = prevPaid + params.amount;
  const newRemaining = Math.max(remainingBefore - params.amount, 0);
  const newStatus = newRemaining <= 0 ? "settled" : newPaid > 0 ? "partially_paid" : "outstanding";

  const { error: debtUpErr } = await supabase
    .from("debts")
    .update({
      amount_paid: newPaid,
      amount_remaining: newRemaining,
      status: newStatus,
    })
    .eq("id", debt.id);
  if (debtUpErr) throw new Error(debtUpErr.message);

  return {
    success: true,
    message: `Debt payment logged: ${debtLabel} — paid ${params.amount} ${params.currency} from ${params.pocket}. Remaining balance: ${newRemaining.toLocaleString()} ${params.currency} (${newStatus})`,
  };
}

async function runTool(name: string, input: unknown): Promise<string> {
  switch (name) {
    case "log_expense": {
      const result = await logExpense(input as Parameters<typeof logExpense>[0]);
      return result.message;
    }
    case "log_client_payment": {
      const result = await logClientPayment(input as Parameters<typeof logClientPayment>[0]);
      return result.message;
    }
    case "log_debt_payment": {
      const result = await logDebtPayment(input as Parameters<typeof logDebtPayment>[0]);
      return result.message;
    }
    default:
      return "Unknown tool";
  }
}

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(context: Awaited<ReturnType<typeof getBusinessContext>>) {
  const totalProfit = context.deals
    ?.filter((d) => d.status === "closed")
    .reduce((sum, d) => sum + (d.profit_aed || 0), 0) ?? 0;

  const pendingDeals = context.deals?.filter((d) => d.status !== "closed").length ?? 0;
  const totalPendingDzd = context.deals
    ?.reduce((sum, d) => sum + (d.pending_dzd || 0), 0) ?? 0;

  const openDealsForPayment = (context.deals ?? [])
    .filter((d) => (d.status || "").toLowerCase() !== "closed")
    .map((d) => ({
      id: d.id,
      client_name: d.client_name,
      car_label: d.car_label,
      pending_dzd: d.pending_dzd,
      status: d.status,
    }));

  return `You are Axira's internal AI business analyst. You have full access to Axira Trading FZE's live business data.

COMPANY: Axira Trading FZE — car export from Dubai to Algeria
OWNER: Rami
TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}
CURRENT SNAPSHOT (live data):
- Cash positions: ${JSON.stringify(context.cash)}
- Available cars in inventory: ${context.cars?.length ?? 0} cars
- ${JSON.stringify(context.cars)}
- Recent deals (last 50, each has id for payments): ${JSON.stringify(context.deals)}
- Open deals for client payments (use deal id from here): ${JSON.stringify(openDealsForPayment)}
- Pending deals: ${pendingDeals} — Total pending collection: ${totalPendingDzd.toLocaleString()} DZD
- Closed deals profit (all time loaded): ${totalProfit.toLocaleString()} AED
- Unpaid debts (id + name for matching): ${JSON.stringify(context.debts)}
- Recent movements (last 30 days): ${JSON.stringify(context.movements)}

YOUR CAPABILITIES:
1. Answer any question about the business data above — profit, cash, deals, inventory
2. Log an expense (log_expense tool)
3. Log a client payment against a deal (log_client_payment tool)
4. Log a debt payment (log_debt_payment tool)
5. Flag issues: unpaid debts overdue, deals with no collection, low cash pockets
6. Compare periods, summarize performance, give recommendations
7. Help draft communications or reports

EXPENSE CATEGORIES (log_expense only): ${EXPENSE_CATEGORIES.join(", ")}
If the user's expense does not fit, map to the closest category or use "Other".

SAFETY RULES (MANDATORY — never break these):

RULE A — ALWAYS ASK FOR MISSING INFO: If the user says something vague like "log 5000 expense", ask for currency, pocket, category, and description before calling any tool.

RULE B — ALWAYS CONFIRM BEFORE WRITING: For EVERY write action (expense, client payment, debt payment), regardless of amount, first reply with a summary such as: "Confirm: log [amount] [currency] [type] from [pocket] for [description/deal/debt]? Reply yes to proceed." Then WAIT for an explicit "yes", "confirm", "go", "ok", or similar before calling the tool. If the user says no or anything else, abort the action.

RULE C — AUDIT TRAIL: All write tools automatically set source to "ai_agent" on movements. Never omit or override this.

RULE D — DZD/AED CONVERSION FORBIDDEN: If the user asks you to convert DZD to AED or vice versa, REFUSE and reply: "Conversions need owner approval — please use the Transfers page manually."

RULE E — NO DELETIONS, EVER: You cannot delete records. If asked, refuse: "I can't delete records. You'll need to do that manually for safety."

RULE F — CLIENT PAYMENTS MUST BE TIED TO A DEAL: If the user says "log income 5000 from client X" without a deal, ask which deal it belongs to. Show pending/open deals for that client from the snapshot (id, client_name, car_label, pending_dzd).

RULE G — IF UNSURE, ASK: Never guess. Never invent deal IDs, debt names, amounts, or dates. If anything is ambiguous, ask Rami first.

GENERAL RULES:
- Be concise and direct. Rami is a busy business owner.
- Always use numbers from the data, never guess.
- When a write succeeds, confirm what was logged using the tool result.
- Currency context: deals are DZD (Algeria), costs are AED (Dubai), invoices are USD.
- If you don't have the data to answer something, say so clearly.
- Respond in the same language the user writes in (English, French, or Arabic).`;
}

// ── Tools definition ───────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "log_expense",
    description:
      "Log an expense or cash outflow into the Axira system. Use only after the user explicitly confirmed. Category must be from the allowed list.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Amount spent" },
        currency: { type: "string", enum: [...CURRENCIES], description: "Currency" },
        pocket: {
          type: "string",
          enum: [...POCKETS],
          description: "Which pocket the expense came from",
        },
        category: {
          type: "string",
          enum: [...EXPENSE_CATEGORIES],
          description: "Expense category",
        },
        description: { type: "string", description: "Short description of the expense" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["amount", "currency", "pocket", "category", "description", "date"],
    },
  },
  {
    name: "log_client_payment",
    description:
      "Log an incoming payment from a client against a specific deal. Updates the deal's collected_dzd and pending_dzd automatically and creates a linked movement. Use only after explicit user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "Deal UUID from the snapshot" },
        amount: { type: "number", description: "Payment amount" },
        currency: { type: "string", enum: [...CURRENCIES], description: "Payment currency" },
        pocket: {
          type: "string",
          enum: [...POCKETS],
          description: "Pocket receiving the payment",
        },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        description: { type: "string", description: "Payment description / notes" },
      },
      required: ["deal_id", "amount", "currency", "pocket", "date", "description"],
    },
  },
  {
    name: "log_debt_payment",
    description:
      "Record a payment OUT against an existing unpaid debt. Marks debt as settled (or partially paid) and creates a linked movement. Use only after explicit user confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        debt_id: { type: "string", description: "Debt UUID (preferred if known)" },
        debt_label: {
          type: "string",
          description: "Debt name/label to match case-insensitively (use if debt_id unknown)",
        },
        amount: { type: "number", description: "Amount paid" },
        currency: { type: "string", enum: [...CURRENCIES], description: "Currency" },
        pocket: {
          type: "string",
          enum: [...POCKETS],
          description: "Pocket paying from",
        },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["amount", "currency", "pocket", "date"],
    },
  },
];

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const { messages } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set in .env.local" }, { status: 500 });
    }

    const context = await getBusinessContext();
    const systemPrompt = buildSystemPrompt(context);

    // First call
    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    // Handle tool use
    if (response.stop_reason === "tool_use") {
      const toolUseBlock = response.content.find((b) => b.type === "tool_use");
      if (toolUseBlock && toolUseBlock.type === "tool_use") {
        let toolResult: string;
        try {
          toolResult = await runTool(toolUseBlock.name, toolUseBlock.input);
        } catch (e) {
          toolResult = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }

        // Second call with tool result
        response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          tools,
          messages: [
            ...messages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: toolResult }],
            },
          ],
        });
      }
    }

    const text = response.content.find((b) => b.type === "text");
    return NextResponse.json({ reply: text?.text ?? "No response" });
  } catch (err) {
    console.error("AI chat error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
