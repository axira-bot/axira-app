export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sendTelegramNotification, notifyNewDeal, notifyDealClosed, notifyPaymentReceived, notifyExpenseLogged, notifyNewCar } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { type, data } = await req.json();

    switch (type) {
      case "new_deal":
        await notifyNewDeal(data);
        break;
      case "deal_closed":
        await notifyDealClosed(data);
        break;
      case "payment_received":
        await notifyPaymentReceived(data);
        break;
      case "expense_logged":
        await notifyExpenseLogged(data);
        break;
      case "new_car":
        await notifyNewCar(data);
        break;
      case "custom":
        await sendTelegramNotification(data.message);
        break;
      default:
        return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Notify error:", err);
    return NextResponse.json({ error: "Failed to send notification" }, { status: 500 });
  }
}
