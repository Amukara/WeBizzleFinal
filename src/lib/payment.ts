// Direct-to-vendor payment helpers.
//
// WeBizzle does not currently have Daraja (M-Pesa API) access, so instead of
// an STK Push we let the customer pay the vendor's own M-Pesa number
// directly — Pochi la Biashara, a Buy Goods till, or a Paybill — or pay the
// rider cash on delivery. The vendor supplies these numbers; the platform
// never touches the money, so no payment gateway integration is required.

export type PaymentMethod = "POCHI" | "TILL" | "PAYBILL" | "COD";

export type VendorPaymentInfo = {
  pochiNumber?: string | null;
  tillNumber?: string | null;
  paybillNumber?: string | null;
  paybillAccount?: string | null;
  acceptsCod?: boolean;
};

export type PaymentOption = {
  method: PaymentMethod;
  label: string;
  detail: string; // the number/account to pay, or "Cash to rider"
};

// Which payment methods this vendor actually supports, in a sensible
// display order. Only methods with real data (or COD) are returned.
export function availablePaymentMethods(v: VendorPaymentInfo): PaymentOption[] {
  const options: PaymentOption[] = [];
  if (v.pochiNumber) {
    options.push({ method: "POCHI", label: "Pochi la Biashara", detail: v.pochiNumber });
  }
  if (v.tillNumber) {
    options.push({ method: "TILL", label: "Buy Goods (Till)", detail: v.tillNumber });
  }
  if (v.paybillNumber) {
    options.push({
      method: "PAYBILL",
      label: "Paybill",
      detail: v.paybillAccount ? `${v.paybillNumber} · Acc: ${v.paybillAccount}` : v.paybillNumber,
    });
  }
  if (v.acceptsCod !== false) {
    options.push({ method: "COD", label: "Cash on delivery", detail: "Pay the rider" });
  }
  return options;
}

export function isMethodAvailable(v: VendorPaymentInfo, method: string): method is PaymentMethod {
  return availablePaymentMethods(v).some((o) => o.method === method);
}

// Human instructions for the confirmation screen / checkout summary.
export function paymentInstructions(
  v: VendorPaymentInfo,
  method: PaymentMethod,
  amountKes: number
): string {
  switch (method) {
    case "POCHI":
      return `On your phone: M-Pesa → Send Money → ${v.pochiNumber} → KES ${amountKes}.`;
    case "TILL":
      return `On your phone: M-Pesa → Lipa na M-Pesa → Buy Goods → Till ${v.tillNumber} → KES ${amountKes}.`;
    case "PAYBILL":
      return `On your phone: M-Pesa → Lipa na M-Pesa → Paybill → Business no. ${v.paybillNumber}${
        v.paybillAccount ? `, Account ${v.paybillAccount}` : ""
      } → KES ${amountKes}.`;
    case "COD":
      return `Pay KES ${amountKes} in cash to your rider when the order arrives.`;
  }
}
