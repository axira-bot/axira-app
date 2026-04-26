export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID!;

// ── Telegram API helpers ───────────────────────────────────────────────────
async function sendMessage(chatId: string | number, text: string, extra?: object) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...extra }),
  });
}

async function sendDocument(chatId: string | number, fileId: string, caption?: string) {
  await fetch(`${TELEGRAM_API}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: fileId, caption }),
  });
}

async function getFile(fileId: string): Promise<string | null> {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) return null;
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}

// ── Supabase client ────────────────────────────────────────────────────────
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Business context ───────────────────────────────────────────────────────
async function getBusinessContext() {
  const supabase = getSupabase();
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
    supabase.from("deals").select("client_name, car_label, date, sale_dzd, sale_aed, sale_usd, profit, status, collected_dzd, pending_dzd, rate").order("date", { ascending: false }).limit(50),
    supabase.from("cash_positions").select("*"),
    supabase.from("debts").select("label, amount, currency, type, status, due_date").eq("status", "unpaid").limit(20),
    supabase.from("cars").select("brand, model, year, color, status, purchase_price, purchase_currency, country_of_origin").eq("status", "available").limit(30),
    supabase.from("movements").select("date, type, category, description, amount, currency, pocket").gte("date", thirtyDaysAgo).order("date", { ascending: false }).limit(100),
  ]);

  return { deals, cash, debts, cars, movements };
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof getBusinessContext>>, extraContext?: string) {
  const totalProfit = context.deals?.filter((d) => d.status === "closed").reduce((sum, d) => sum + (d.profit || 0), 0) ?? 0;
  const pendingDeals = context.deals?.filter((d) => d.status !== "closed").length ?? 0;
  const totalPendingDzd = context.deals?.reduce((sum, d) => sum + (d.pending_dzd || 0), 0) ?? 0;

  return `You are Axira AI — the internal business assistant for Axira Trading FZE, operating via Telegram.

COMPANY: Axira Trading FZE — car export from Dubai/UAE to Algeria
OWNER: Rami (you are talking to him directly on Telegram)

CURRENT LIVE DATA:
- Cash positions: ${JSON.stringify(context.cash)}
- Available cars: ${context.cars?.length ?? 0} — ${JSON.stringify(context.cars)}
- Recent deals (last 50): ${JSON.stringify(context.deals)}
- Pending deals: ${pendingDeals} — Total pending: ${totalPendingDzd.toLocaleString()} DZD
- All-time closed profit loaded: ${totalProfit.toLocaleString()} AED
- Unpaid debts: ${JSON.stringify(context.debts)}
- Recent movements (30 days): ${JSON.stringify(context.movements)}
${extraContext ? `\nDOCUMENT ANALYSIS:\n${extraContext}` : ""}

CAPABILITIES:
1. Answer any business question using live data
2. Log expenses directly (log_expense tool)
3. Analyze documents sent by Rami (invoices, BLs, reports)
4. Flag issues: overdue debts, low cash, pending collections
5. Summarize performance, compare periods

RULES:
- Be concise — this is Telegram, keep responses short and clear
- Use bullet points and emojis for readability
- Always use real numbers from the data
- Respond in the same language as the user (EN/FR/AR)
- When logging expenses, confirm what was logged`;
}

// ── AI Tools ───────────────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "log_expense",
    description: "Log an expense into the Axira system",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number" },
        currency: { type: "string", enum: ["AED", "DZD", "USD", "EUR"] },
        pocket: { type: "string", enum: ["Dubai Cash", "Dubai Bank", "Algeria Cash", "Algeria Bank", "Qatar", "EUR Cash", "USD Cash"] },
        category: { type: "string" },
        description: { type: "string" },
        date: { type: "string" },
      },
      required: ["amount", "currency", "pocket", "category", "description", "date"],
    },
  },
];

async function logExpense(params: { amount: number; currency: string; pocket: string; category: string; description: string; date: string }) {
  const supabase = getSupabase();
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
  return `✅ Logged: *${params.description}* — ${params.amount} ${params.currency} from ${params.pocket}`;
}

// ── AI Chat handler ────────────────────────────────────────────────────────
async function handleAIMessage(chatId: number, userMessage: string, documentContent?: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const context = await getBusinessContext();
  const systemPrompt = buildSystemPrompt(context, documentContent);

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "tool_use") {
    const toolUseBlock = response.content.find((b) => b.type === "tool_use");
    if (toolUseBlock && toolUseBlock.type === "tool_use") {
      let toolResult: string;
      try {
        if (toolUseBlock.name === "log_expense") {
          toolResult = await logExpense(toolUseBlock.input as Parameters<typeof logExpense>[0]);
        } else {
          toolResult = "Unknown tool";
        }
      } catch (e) {
        toolResult = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: [
          { role: "user", content: userMessage },
          { role: "assistant", content: response.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: toolResult }] },
        ],
      });
    }
  }

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "I couldn't process that.";
}

// ── Document handler ───────────────────────────────────────────────────────
async function handleDocument(chatId: number, fileId: string, caption: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await sendMessage(chatId, "📄 Analyzing document...");

  const fileUrl = await getFile(fileId);
  if (!fileUrl) {
    await sendMessage(chatId, "❌ Could not download the file.");
    return;
  }

  // Fetch file content
  const fileRes = await fetch(fileUrl);
  const buffer = await fileRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = fileUrl.endsWith(".pdf") ? "application/pdf" : "image/jpeg";

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "document" as const,
            source: { type: "base64", media_type: mimeType as "application/pdf", data: base64 },
          } as Anthropic.DocumentBlockParam,
          {
            type: "text",
            text: caption
              ? `The user says: "${caption}". Analyze this document and extract all key information. Summarize what you find and highlight anything actionable for Axira Trading FZE (car export business). Be concise.`
              : `Analyze this document. Extract all key information: amounts, dates, parties, items, reference numbers. Summarize clearly for Axira Trading FZE (car export business). Be concise.`,
          },
        ],
      }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const summary = textBlock && textBlock.type === "text" ? textBlock.text : "Could not analyze document.";

    await sendMessage(chatId, `📋 *Document Analysis:*\n\n${summary}`);
  } catch {
    await sendMessage(chatId, "❌ Could not analyze this document type. Try sending as an image or PDF.");
  }
}

// ── Voice handler ─────────────────────────────────────────────────────────
async function handleVoice(chatId: number, fileId: string) {
  await sendMessage(chatId, "🎙 Transcribing...");

  const fileUrl = await getFile(fileId);
  if (!fileUrl) {
    await sendMessage(chatId, "❌ Could not download the voice message.");
    return;
  }

  // Download the OGG audio file
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    await sendMessage(chatId, "❌ Could not fetch the voice file from Telegram. Please try again.");
    return;
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Transcribe via OpenAI Whisper
  const formData = new FormData();
  const blob = new Blob([buffer], { type: "audio/ogg" });
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-1");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    await sendMessage(chatId, "❌ Could not transcribe voice message. Try typing instead.");
    return;
  }

  const { text: transcript } = await whisperRes.json();
  if (!transcript) {
    await sendMessage(chatId, "❌ Empty transcription. Please try again.");
    return;
  }

  await sendMessage(chatId, `🎙 _"${transcript}"_`);
  const reply = await handleAIMessage(chatId, transcript);
  await sendMessage(chatId, reply);
}

// ── Photo handler ─────────────────────────────────────────────────────────
async function handlePhoto(chatId: number, fileId: string, caption: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await sendMessage(chatId, "🖼 Analyzing image...");

  const fileUrl = await getFile(fileId);
  if (!fileUrl) {
    await sendMessage(chatId, "❌ Could not download the image.");
    return;
  }

  const fileRes = await fetch(fileUrl);
  const buffer = await fileRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        {
          type: "text",
          text: caption
            ? `The user says: "${caption}". Analyze this image and extract all key information relevant to Axira Trading FZE (car export business). Be concise.`
            : `Analyze this image. Extract all key info: amounts, dates, parties, reference numbers. Summarize clearly. Be concise.`,
        },
      ],
    }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const summary = textBlock && textBlock.type === "text" ? textBlock.text : "Could not analyze image.";
  await sendMessage(chatId, `🖼 *Image Analysis:*\n\n${summary}`);
}

// ── Main webhook handler ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message || body.callback_query?.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text || "";
    const caption = message.caption || "";

    // Commands
    if (text === "/start") {
      await sendMessage(chatId, `🏎 *Welcome to Axira AI*\n\nYour business assistant is ready.\n\n*What I can do:*\n• Answer any question about your business\n• Log expenses\n• Analyze documents (send PDFs or photos)\n• Give profit summaries\n\nJust type your question or send a document!`);
      return NextResponse.json({ ok: true });
    }

    if (text === "/summary") {
      const reply = await handleAIMessage(chatId, "Give me a quick business summary: total profit this month, cash positions, pending deals, and any urgent issues.");
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    if (text === "/cash") {
      const reply = await handleAIMessage(chatId, "What are my current cash positions across all pockets?");
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    if (text === "/deals") {
      const reply = await handleAIMessage(chatId, "List my recent deals with their profit and status.");
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    if (text === "/inventory") {
      const reply = await handleAIMessage(chatId, "What cars do I currently have in inventory?");
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    if (text === "/debts") {
      const reply = await handleAIMessage(chatId, "What are my current unpaid debts? Which ones are overdue?");
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    // Handle voice messages
    if (message.voice) {
      await handleVoice(chatId, message.voice.file_id);
      return NextResponse.json({ ok: true });
    }

    // Handle documents (PDF, etc.)
    if (message.document) {
      await handleDocument(chatId, message.document.file_id, caption);
      return NextResponse.json({ ok: true });
    }

    // Handle photos
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1]; // highest res
      await handlePhoto(chatId, photo.file_id, caption);
      return NextResponse.json({ ok: true });
    }

    // Regular text message → AI
    if (text) {
      await sendMessage(chatId, "⏳ Thinking...");
      const reply = await handleAIMessage(chatId, text);
      await sendMessage(chatId, reply);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}

// ── GET — used to verify webhook is alive ─────────────────────────────────
export async function GET() {
  return NextResponse.json({ ok: true, service: "Axira Telegram Bot" });
}
