import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/admin";
import { getPortalSession } from "@/lib/portal-auth";
import { normalisePhone } from "@/lib/sms";

// POST /api/orders/[id]/confirm-payment
// Vendor (checking their own M-Pesa/Pochi app) or an admin confirms that a
// direct payment actually landed, or that cash was collected on delivery.
// body: { status: "PAID" | "FAILED" }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // --- Auth: admin, or the vendor this order belongs to ---
  const adminSession = getAdminSession(req);
  let confirmedBy: "ADMIN" | "VENDOR" | null = adminSession ? "ADMIN" : null;

  if (!confirmedBy) {
    const portalSession = getPortalSession(req, "VENDOR_LOGIN");
    if (portalSession) {
      const portal = await db.vendorPortal.findFirst({
        where: { phone: normalisePhone(portalSession.phone) },
      });
      if (portal && portal.vendorId === order.vendorId) {
        confirmedBy = "VENDOR";
      }
    }
  }

  if (!confirmedBy) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed = ["PAID", "FAILED"];
  if (!body.status || !allowed.includes(body.status)) {
    return NextResponse.json({ error: "status must be PAID or FAILED" }, { status: 400 });
  }

  const updated = await db.order.update({
    where: { id },
    data: {
      paymentStatus: body.status,
      paymentConfirmedBy: confirmedBy,
      paymentConfirmedAt: new Date(),
      // Confirming payment is also a natural cue to start packing.
      status: body.status === "PAID" && order.status === "PLACED" ? "CONFIRMED" : order.status,
    },
  });

  return NextResponse.json({
    ok: true,
    paymentStatus: updated.paymentStatus,
    status: updated.status,
  });
}
