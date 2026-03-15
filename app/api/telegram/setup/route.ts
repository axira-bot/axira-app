export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!token || !webhookUrl) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN or NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
  }

  const url = `${webhookUrl}/api/telegram/webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const data = await res.json();
  return NextResponse.json({ webhookSet: data.ok, url, telegram: data });
}
