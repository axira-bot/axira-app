const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID!;

export async function sendTelegramNotification(message: string, chatId?: string) {
  const target = chatId || OWNER_CHAT_ID;
  if (!TELEGRAM_TOKEN || !target) return;

  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("Telegram notification error:", err);
  }
}

// ── Notification templates ─────────────────────────────────────────────────

export function notifyNewDeal(deal: {
  clientName: string;
  carLabel: string;
  saleDzd?: number;
  saleAed?: number;
  saleUsd?: number;
  date: string;
}) {
  const amount = deal.saleUsd
    ? `$${deal.saleUsd.toLocaleString()} USD`
    : deal.saleAed
    ? `${deal.saleAed.toLocaleString()} AED`
    : deal.saleDzd
    ? `${deal.saleDzd.toLocaleString()} DZD`
    : "—";

  return sendTelegramNotification(
    `🚗 *New Deal Added*\n\n` +
    `👤 Client: ${deal.clientName}\n` +
    `🚘 Car: ${deal.carLabel}\n` +
    `💰 Sale: ${amount}\n` +
    `📅 Date: ${deal.date}`
  );
}

export function notifyDealClosed(deal: {
  clientName: string;
  carLabel: string;
  profit?: number;
}) {
  return sendTelegramNotification(
    `✅ *Deal Closed*\n\n` +
    `👤 Client: ${deal.clientName}\n` +
    `🚘 Car: ${deal.carLabel}\n` +
    `💵 Profit: ${deal.profit ? deal.profit.toLocaleString() + " AED" : "—"}`
  );
}

export function notifyPaymentReceived(payment: {
  clientName: string;
  amount: number;
  currency: string;
  carLabel?: string;
}) {
  return sendTelegramNotification(
    `💸 *Payment Received*\n\n` +
    `👤 From: ${payment.clientName}\n` +
    `💰 Amount: ${payment.amount.toLocaleString()} ${payment.currency}` +
    (payment.carLabel ? `\n🚘 Car: ${payment.carLabel}` : "")
  );
}

export function notifyExpenseLogged(expense: {
  description: string;
  amount: number;
  currency: string;
  pocket: string;
  loggedBy?: string;
}) {
  return sendTelegramNotification(
    `📤 *Expense Logged*\n\n` +
    `📝 ${expense.description}\n` +
    `💰 ${expense.amount.toLocaleString()} ${expense.currency}\n` +
    `👛 From: ${expense.pocket}` +
    (expense.loggedBy ? `\n👤 By: ${expense.loggedBy}` : "")
  );
}

export function notifyNewCar(car: {
  brand: string;
  model: string;
  year?: number;
  color?: string;
}) {
  return sendTelegramNotification(
    `🆕 *Car Added to Inventory*\n\n` +
    `🚘 ${car.brand} ${car.model}${car.year ? ` (${car.year})` : ""}` +
    (car.color ? `\n🎨 Color: ${car.color}` : "")
  );
}

export function notifyApprovalRequest(request: {
  type: string;
  description: string;
  amount?: number;
  currency?: string;
  requestedBy: string;
  requestId: string;
}) {
  const amount = request.amount
    ? `\n💰 Amount: ${request.amount.toLocaleString()} ${request.currency || ""}`
    : "";

  return sendTelegramNotification(
    `⚠️ *Approval Required*\n\n` +
    `📋 Type: ${request.type}\n` +
    `📝 ${request.description}` +
    amount +
    `\n👤 Requested by: ${request.requestedBy}\n\n` +
    `Reply with:\n✅ /approve_${request.requestId}\n❌ /reject_${request.requestId}`
  );
}
