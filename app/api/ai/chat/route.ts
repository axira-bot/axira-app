export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Fetch business snapshot from Supabase ──────────────────────────────────
async function getBusinessContext() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: deals },
    { data: cash },
    { data: debts },
    { data: cars },
    { data: movements },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select("client_name, car_label, date, sale_dzd, sale_aed, sale_usd, profit, status, collected_dzd, pending_dzd, rate")
      .order("date", { ascending: false })
      .limit(50),
    supabase.from("cash_positions").select("*"),
    supabase
      .from("debts")
      .select("label, amount, currency, type, status, due_date")
      .eq("status", "unpaid")
      .limit(20),
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

  return { deals, cash, debts, cars, movements };
}

// ── Log expense tool ───────────────────────────────────────────────────────
async function logExpense(params: {
  amount: number;
  currency: string;
  pocket: string;
  category: string;
  description: string;
  date: string;
}) {
  const { error } = await supabase.from("movements").insert({
    date: params.date,
    type: "expense",
    category: params.category,
    description: params.description,
    amount: params.amount,
    currency: params.currency,
    pocket: params.pocket,
    aed_equivalent: params.currency === "AED" ? params.amount : null,
  });
  if (error) throw new Error(error.message);
  return { success: true, message: `Logged: ${params.description} — ${params.amount} ${params.currency} from ${params.pocket}` };
}

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(context: Awaited<ReturnType<typeof getBusinessContext>>) {
  const totalProfit = context.deals
    ?.filter((d) => d.status === "closed")
    .reduce((sum, d) => sum + (d.profit || 0), 0) ?? 0;

  const pendingDeals = context.deals?.filter((d) => d.status !== "closed").length ?? 0;
  const totalPendingDzd = context.deals
    ?.reduce((sum, d) => sum + (d.pending_dzd || 0), 0) ?? 0;

  return `You are Axira's internal AI business analyst. You have full access to Axira Trading FZE's live business data.

COMPANY: Axira Trading FZE — car export from Dubai to Algeria
OWNER: Rami

CURRENT SNAPSHOT (live data):
- Cash positions: ${JSON.stringify(context.cash)}
- Available cars in inventory: ${context.cars?.length ?? 0} cars
- ${JSON.stringify(context.cars)}
- Recent deals (last 50): ${JSON.stringify(context.deals)}
- Pending deals: ${pendingDeals} — Total pending collection: ${totalPendingDzd.toLocaleString()} DZD
- Closed deals profit (all time loaded): ${totalProfit.toLocaleString()} AED
- Unpaid debts: ${JSON.stringify(context.debts)}
- Recent movements (last 30 days): ${JSON.stringify(context.movements)}

YOUR CAPABILITIES:
1. Answer any question about the business data above — profit, cash, deals, inventory
2. Log an expense directly into the system when asked (use the log_expense tool)
3. Flag issues: unpaid debts overdue, deals with no collection, low cash pockets
4. Compare periods, summarize performance, give recommendations
5. Help draft communications or reports

RULES:
- Be concise and direct. Rami is a busy business owner.
- Always use numbers from the data, never guess.
- When logging expenses, confirm back what you logged.
- Currency context: deals are DZD (Algeria), costs are AED (Dubai), invoices are USD.
- If you don't have the data to answer something, say so clearly.
- Respond in the same language the user writes in (English, French, or Arabic).`;
}

// ── Tools definition ───────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "log_expense",
    description: "Log an expense or cash movement directly into the Axira system. Use when the user says they spent money or wants to record a transaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Amount spent" },
        currency: { type: "string", enum: ["AED", "DZD", "USD", "EUR"], description: "Currency" },
        pocket: {
          type: "string",
          enum: ["Dubai Cash", "Dubai Bank", "Algeria Cash", "Algeria Bank", "Qatar", "EUR Cash", "USD Cash"],
          description: "Which pocket the expense came from",
        },
        category: { type: "string", description: "Category e.g. Shipping, Maintenance, Rent, Fuel, Other" },
        description: { type: "string", description: "Short description of the expense" },
        date: { type: "string", description: "Date in YYYY-MM-DD format, default today" },
      },
      required: ["amount", "currency", "pocket", "category", "description", "date"],
    },
  },
];

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
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
          if (toolUseBlock.name === "log_expense") {
            const result = await logExpense(toolUseBlock.input as Parameters<typeof logExpense>[0]);
            toolResult = result.message;
          } else {
            toolResult = "Unknown tool";
          }
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
