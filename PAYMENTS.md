# Payments — direct-to-vendor (no Daraja required)

WeBizzle currently has no Safaricom Daraja API access, so checkout no longer
uses M-Pesa STK Push. Instead, the customer pays the **vendor's own** number
directly, or pays cash on delivery. WeBizzle never touches the money.

## Payment methods

Each vendor configures whichever of these they actually have:

| Method  | Vendor field(s)                     | How the customer pays                      |
|---------|--------------------------------------|---------------------------------------------|
| POCHI   | `pochiNumber`                        | M-Pesa → Send Money → vendor's number       |
| TILL    | `tillNumber`                         | M-Pesa → Buy Goods → vendor's till number   |
| PAYBILL | `paybillNumber` (+ `paybillAccount`) | M-Pesa → Paybill → business no. + account   |
| COD     | `acceptsCod` (default `true`)        | Cash to the rider on delivery               |

At least one method must be available or the vendor can't be checked out
against (`availablePaymentMethods()` in `src/lib/payment.ts`).

## Order lifecycle

```
PLACED (paymentStatus: PENDING)
  │
  ├─ COD ─────────────────────────────► settled at delivery
  │
  └─ POCHI/TILL/PAYBILL
        │  customer sends money, then taps "I've paid"
        ▼
     POST /api/orders/[id]/report-payment   (paymentStatus → AWAITING_CONFIRMATION)
        │  vendor checks their own M-Pesa app/statement
        ▼
     POST /api/orders/[id]/confirm-payment  (paymentStatus → PAID or FAILED)
```

- `report-payment` is public (keyed by order id) — the customer self-reports,
  optionally attaching the M-Pesa confirmation code they received.
- `confirm-payment` requires either an admin session or a vendor-portal
  session for the order's own vendor.
- Vendors get a `Notification` the moment a payment is reported, and again
  (a `NEW_ORDER` notification) the moment the order is placed — they should
  start packing immediately, same as a walk-in customer, rather than waiting
  on payment confirmation.

## Dormant Daraja code

`src/lib/mpesa.ts`, `src/app/api/mpesa/callback/route.ts`, and
`src/app/api/mpesa/status/route.ts` are kept but unused, so Daraja can be
re-enabled later without a rewrite. They're safe to leave in place —
`mpesa.ts` no longer throws when `MPESA_*` env vars are missing.

## Known follow-up (not done here)

The legal copy and `Order.platformFee` / `vendorPayout` / `driverPayout`
fields still describe a model where WeBizzle deducts fees from a payment it
receives. Now that money never passes through the platform, fee collection
needs a separate settlement mechanism (e.g. vendor invoiced weekly, or fee
deducted from a security deposit) — that's a business-model decision, not a
code change, so it's flagged here rather than guessed at.
