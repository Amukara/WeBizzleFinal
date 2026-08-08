import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pickRider } from "@/lib/pricing";
import { computeFees, REFERRAL_REWARD_KES } from "@/lib/fees";
import { getAdminSession, unauthorized } from "@/lib/admin";
import {
  availablePaymentMethods,
  isMethodAvailable,
  type PaymentMethod,
} from "@/lib/payment";

// GET /api/orders — list orders.
//   • Admin (cookie or x-admin-token): returns all orders with full PII.
//   • Customer (?phone=07XXXXXXXX): returns only their own orders with
//     rider phone masked.
//   • No auth + no phone: 401.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const phoneParam = url.searchParams.get("phone")?.trim();

  const adminSession = getAdminSession(req);

  // --- Customer path: filter by phone, mask rider PII ---
  if (!adminSession && phoneParam) {
    // Normalize: strip spaces, prepend 0 if missing
    const normalized = phoneParam.replace(/\s/g, "");
    if (!normalized) {
      return NextResponse.json({ error: "Phone parameter is required" }, { status: 400 });
    }

    const orders = await db.order.findMany({
      where: { phone: { endsWith: normalized.replace(/^0/, "") } },
      include: { vendor: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const data = orders.map((o) => ({
      id: o.id,
      customerName: o.customerName,
      phone: o.phone,
      location: o.location,
      vendor: { id: o.vendor.id, name: o.vendor.name, emoji: o.vendor.emoji, type: o.vendor.type },
      items: JSON.parse(o.itemsJson),
      subtotal: o.subtotal,
      deliveryFee: o.deliveryFee,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      mpesaCode: o.mpesaCode,
      createdAt: o.createdAt.toISOString(),
      rider: o.riderName
        ? {
            name: o.riderName,
            plate: o.riderPlate!,
            // Mask rider phone: show only last 4 digits
            phone: o.riderPhone
              ? o.riderPhone.slice(0, -4) + "****"
              : null,
            rating: o.riderRating,
          }
        : null,
      saved: o.saved,
    }));

    return NextResponse.json({ orders: data });
  }

  // --- Admin path: full access ---
  if (!adminSession) {
    return unauthorized();
  }

  const orders = await db.order.findMany({
    include: { vendor: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const data = orders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    phone: o.phone,
    location: o.location,
    vendor: { id: o.vendor.id, name: o.vendor.name, emoji: o.vendor.emoji, type: o.vendor.type },
    items: JSON.parse(o.itemsJson),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    mpesaCode: o.mpesaCode,
    createdAt: o.createdAt.toISOString(),
    rider: o.riderName
      ? { name: o.riderName, plate: o.riderPlate!, phone: o.riderPhone!, rating: o.riderRating }
      : null,
    saved: o.saved,
    platformFee: o.platformFee,
    driverLevy: o.driverLevy,
    vendorPayout: o.vendorPayout,
    driverPayout: o.driverPayout,
    referralCode: o.referralCode,
  }));

  return NextResponse.json({ orders: data });
}

// POST /api/orders — create a new order.
//
// SECURITY: prices are recomputed server-side from the vendor's actual
// VendorProduct catalogue.  Client-supplied subtotal/deliveryFee/total
// and per-item unitPrice are IGNORED.
//
// Payment flow (no Daraja/STK Push — direct-to-vendor payment instead):
//   1. Server validates the requested paymentMethod against what this
//      vendor supports (Pochi / Till / Paybill / cash on delivery).
//   2. Server creates the order with paymentStatus = "PENDING" and notifies
//      the vendor immediately — they start packing regardless of payment
//      method, same as a walk-in customer.
//   3. Customer pays the vendor's number directly, then self-reports via
//      POST /api/orders/[id]/report-payment (optional M-Pesa code).
//   4. Vendor (or admin) confirms the funds actually landed via
//      POST /api/orders/[id]/confirm-payment, which sets paymentStatus = PAID.
//   5. Cash-on-delivery orders skip 3–4 and settle when the rider delivers.
export async function POST(req: Request) {
  let body: {
    vendorId: string;
    customerName: string;
    phone: string;
    location: string;
    items: { productId: string; name: string; unit: string; emoji: string; qty: number }[];
    paymentMethod?: string; // POCHI, TILL, PAYBILL, COD
    referralCode?: string;
    lat?: number | null;
    lng?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.vendorId || !body.customerName || !body.phone || !body.location || !body.items?.length) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ---- 1. Look up vendor ----
  const vendor = await db.vendor.findUnique({ where: { id: body.vendorId } });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  }

  // ---- 1b. Validate payment method against what this vendor supports ----
  // No Daraja STK Push here — the customer pays the vendor's own Pochi/Till/
  // Paybill number directly, or pays the rider cash on delivery.
  const requestedMethod = body.paymentMethod?.trim().toUpperCase();
  const methodOptions = availablePaymentMethods(vendor);
  if (methodOptions.length === 0) {
    return NextResponse.json(
      { error: `${vendor.name} has no payment method configured yet` },
      { status: 409 }
    );
  }
  const paymentMethod: PaymentMethod = requestedMethod && isMethodAvailable(vendor, requestedMethod)
    ? requestedMethod
    : methodOptions[0].method;

  // ---- 2. Server-side price recomputation ----
  // Fetch the vendor's actual listings for every requested product.
  const productIds = body.items.map((it) => it.productId);
  const vendorListings = await db.vendorProduct.findMany({
    where: {
      vendorId: body.vendorId,
      productId: { in: productIds },
    },
    include: { product: true },
  });

  // Build a lookup: productId → { price, name, unit, emoji, inStock }
  const listingMap = new Map<string, (typeof vendorListings)[number]>();
  for (const l of vendorListings) {
    listingMap.set(l.productId, l);
  }

  // Validate every item: must exist, be in stock, and have a valid qty.
  const serverItems: {
    productId: string;
    name: string;
    unit: string;
    emoji: string;
    qty: number;
    unitPrice: number; // server-authoritative price
  }[] = [];

  for (const it of body.items) {
    if (typeof it.qty !== "number" || it.qty < 1) {
      return NextResponse.json(
        { error: `Invalid quantity for ${it.productId}` },
        { status: 400 }
      );
    }
    const listing = listingMap.get(it.productId);
    if (!listing) {
      return NextResponse.json(
        { error: `Product ${it.productId} is not listed by this vendor` },
        { status: 409 }
      );
    }
    if (!listing.inStock) {
      return NextResponse.json(
        { error: `${listing.product.name} is out of stock at ${vendor.name}` },
        { status: 409 }
      );
    }
    serverItems.push({
      productId: it.productId,
      name: listing.product.name,
      unit: listing.product.unit,
      emoji: listing.product.emoji,
      qty: it.qty,
      unitPrice: listing.price, // SERVER price, NOT client-supplied
    });
  }

  // Compute totals server-side
  const subtotal = serverItems.reduce((s, it) => s + it.unitPrice * it.qty, 0);
  const deliveryFee = vendor.deliveryFee; // from vendor record, not client
  const total = subtotal + deliveryFee;

  // ---- 3. Compute savings vs. market-average prices ----
  const allListings = await db.vendorProduct.findMany({
    where: { productId: { in: productIds }, inStock: true },
  });
  const sumsByProduct = new Map<string, number>();
  const countByProduct = new Map<string, number>();
  for (const l of allListings) {
    sumsByProduct.set(l.productId, (sumsByProduct.get(l.productId) ?? 0) + l.price);
    countByProduct.set(l.productId, (countByProduct.get(l.productId) ?? 0) + 1);
  }
  const avgByProduct = new Map<string, number>();
  for (const pid of productIds) {
    const sum = sumsByProduct.get(pid) ?? 0;
    const cnt = countByProduct.get(pid) ?? 0;
    avgByProduct.set(pid, cnt > 0 ? Math.round(sum / cnt) : 0);
  }
  let saved = 0;
  for (const it of serverItems) {
    const avg = avgByProduct.get(it.productId) ?? it.unitPrice;
    saved += Math.max(0, (avg - it.unitPrice) * it.qty);
  }

  // ---- 4. Monetisation fees ----
  const fees = computeFees(subtotal, deliveryFee);

  // ---- 5. Referral code (best-effort, never blocks) ----
  let referralCode: string | null = null;
  if (body.referralCode && typeof body.referralCode === "string") {
    const ref = await db.referral.findUnique({
      where: { code: body.referralCode.trim().toUpperCase() },
    });
    if (ref && ref.status === "ACTIVE") {
      referralCode = ref.code;
      await db.referral.update({
        where: { id: ref.id },
        data: {
          orders: { increment: 1 },
          rewardEarned: { increment: REFERRAL_REWARD_KES },
        },
      });
    }
  }

  // ---- 6. Assign rider ----
  const rider = pickRider(`${body.vendorId}-${Date.now()}`);

  // ---- 7. Create the order (PENDING payment) ----
  const order = await db.order.create({
    data: {
      customerName: body.customerName.trim(),
      phone: body.phone.trim(),
      location: body.location.trim(),
      vendorId: body.vendorId,
      itemsJson: JSON.stringify(serverItems),
      subtotal,
      deliveryFee,
      total,
      status: "PLACED",
      paymentStatus: "PENDING",
      paymentMethod,
      riderName: rider.name,
      riderPlate: rider.plate,
      riderPhone: rider.phone,
      riderRating: rider.rating,
      saved: Math.round(saved),
      platformFee: fees.platformFee,
      driverLevy: fees.driverLevy,
      vendorPayout: fees.vendorPayout,
      driverPayout: fees.driverPayout,
      referralCode,
      lat: typeof body.lat === "number" ? body.lat : null,
      lng: typeof body.lng === "number" ? body.lng : null,
    },
    include: { vendor: true },
  });

  // ---- 8. Notify the vendor immediately ----
  // No gateway confirmation to wait for: the vendor gets notified straight
  // away and starts packing, exactly like a walk-in order. Payment happens
  // directly between the customer and the vendor (Pochi/Till/Paybill) or on
  // delivery (COD) — see /api/orders/[id]/report-payment for the customer's
  // "I've paid" step and PATCH /api/admin/orders for vendor/admin confirmation.
  await notifyVendorOfOrder({
    id: order.id,
    vendorId: order.vendorId,
    vendorName: vendor.name,
    customerName: order.customerName,
    total: order.total,
    itemCount: serverItems.length,
  });

  try {
    const { pushSingleOrderToAirtable } = await import("@/lib/airtable");
    await pushSingleOrderToAirtable({
      id: order.id,
      customerName: order.customerName,
      phone: order.phone,
      location: order.location,
      vendor: { name: vendor.name, emoji: vendor.emoji, type: vendor.type },
      items: serverItems,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      status: order.status,
      mpesaCode: order.mpesaCode,
      riderName: rider.name,
      riderPlate: rider.plate,
      saved: order.saved,
      platformFee: order.platformFee,
      driverLevy: order.driverLevy,
      createdAt: order.createdAt.toISOString(),
    });
  } catch (err) {
    // Never let a best-effort sync failure block order creation.
    console.error(`[orders] Airtable push failed for ${order.id}:`, err);
  }

  // ---- 9. Return order + where-to-pay details ----
  return NextResponse.json({
    order: {
      id: order.id,
      customerName: order.customerName,
      phone: order.phone,
      location: order.location,
      vendor: { id: order.vendor.id, name: order.vendor.name, emoji: order.vendor.emoji, type: order.vendor.type },
      items: serverItems,
      subtotal,
      deliveryFee,
      total,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      mpesaCode: order.mpesaCode,
      createdAt: order.createdAt.toISOString(),
      rider: { name: rider.name, plate: rider.plate, phone: rider.phone, rating: rider.rating },
      saved: order.saved,
      platformFee: order.platformFee,
      driverLevy: order.driverLevy,
      vendorPayout: order.vendorPayout,
      driverPayout: order.driverPayout,
      referralCode: order.referralCode,
      payment: {
        method: paymentMethod,
        pochiNumber: vendor.pochiNumber,
        tillNumber: vendor.tillNumber,
        paybillNumber: vendor.paybillNumber,
        paybillAccount: vendor.paybillAccount,
      },
    },
  });
}

// Best-effort helper to fire a vendor notification when an order is placed.
// Called from the route above after the order is created. Kept as a named
// export so it can be invoked without blocking the response.
export async function notifyVendorOfOrder(order: {
  id: string;
  vendorId: string;
  vendorName: string;
  customerName: string;
  total: number;
  itemCount: number;
}) {
  try {
    await db.notification.create({
      data: {
        recipientType: "VENDOR",
        recipientId: order.vendorId,
        type: "NEW_ORDER",
        title: "New order received! 🛒",
        body: `${order.customerName} placed an order for ${order.itemCount} item(s) — KES ${order.total}. Confirm to start packing.`,
        orderId: order.id,
      },
    });
    // Fire-and-forget socket broadcast (the realtime service is best-effort).
    // Bounded with a short timeout: an unreachable port can otherwise hang
    // the whole request for tens of seconds under some network conditions,
    // which is disastrous once you're serving thousands of concurrent orders.
    await fetch("http://localhost:3001/?XTransformPort=3001", {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    }).catch(() => {});
  } catch {
    // never block on notifications
  }
}