import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/orders/[id]/report-payment
// Customer confirms "I've paid" after sending money directly to the
// vendor's Pochi/Till/Paybill. Optionally attaches the M-Pesa confirmation
// code they received. This does NOT mark the order as PAID outright — it
// moves it to AWAITING_CONFIRMATION so the vendor (or admin) can check
// their own M-Pesa statement/app and confirm the funds actually landed.
// Not applicable to cash-on-delivery orders, which are settled at delivery.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { mpesaCode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.paymentMethod === "COD") {
    return NextResponse.json(
      { error: "This order is cash on delivery — nothing to report yet." },
      { status: 409 }
    );
  }

  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ ok: true, paymentStatus: "PAID" });
  }

  const mpesaCode = body.mpesaCode?.trim().toUpperCase().slice(0, 20) || null;

  const updated = await db.order.update({
    where: { id },
    data: {
      paymentStatus: "AWAITING_CONFIRMATION",
      mpesaCode: mpesaCode ?? order.mpesaCode,
    },
  });

  // Let the vendor know a payment claim is waiting on them.
  try {
    await db.notification.create({
      data: {
        recipientType: "VENDOR",
        recipientId: order.vendorId,
        type: "ORDER_STATUS",
        title: "Payment reported — please confirm 💰",
        body: `Customer says they've paid for order #${order.id.slice(-8).toUpperCase()}${
          mpesaCode ? ` (code ${mpesaCode})` : ""
        }. Check your M-Pesa and confirm in your portal.`,
        orderId: order.id,
      },
    });
  } catch {
    // Never block on notifications.
  }

  return NextResponse.json({
    ok: true,
    paymentStatus: updated.paymentStatus,
    mpesaCode: updated.mpesaCode,
  });
}
