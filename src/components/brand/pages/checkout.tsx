"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Loader2,
  ShieldCheck,
  Smartphone,
  Banknote,
  Copy,
  Check,
  User,
  MapPin,
  Phone,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KES } from "../logo";
import { computeFees, PLATFORM_FEE_THRESHOLD } from "@/lib/fees";
import { LocationPicker } from "../map/LocationPicker";
import { LocationPrompt } from "../ui/location-prompt";
import { useGeolocation } from "@/hooks/use-geolocation";
import { getCustomerProfile, saveCustomerProfile } from "@/lib/customer";
import { availablePaymentMethods, paymentInstructions, type PaymentMethod } from "@/lib/payment";
import type { Cart, Order, PageId } from "@/lib/types";

export function CheckoutPage({
  cart,
  onPlaceOrder,
  onNavigate,
}: {
  cart: Cart | null;
  onPlaceOrder: (data: {
    customerName: string;
    phone: string;
    location: string;
    lat?: number | null;
    lng?: number | null;
    paymentMethod: PaymentMethod;
  }) => Promise<Order | null>;
  onNavigate: (p: PageId) => void;
}) {
  // Pre-fill from the saved customer profile so returning customers don't
  // re-enter their details every order.
  const [saved] = useState(() => getCustomerProfile());
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [location, setLocation] = useState(saved.location);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    saved.lat != null && saved.lng != null ? { lat: saved.lat, lng: saved.lng } : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Direct-to-vendor payment: pick from whatever this vendor actually supports.
  const paymentOptions = cart ? availablePaymentMethods(cart.vendor) : [];
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  useEffect(() => {
    if (!method && paymentOptions.length > 0) {
      setMethod(paymentOptions[0].method);
    }
  }, [paymentOptions, method]);

  // Location services for checkout
  const geo = useGeolocation();
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);

  // Prompt location on checkout mount if no saved coords
  useEffect(() => {
    if (!cart) return;
    if (geo.status === "idle" && !coords) {
      // Small delay so the checkout UI renders first
      const t = setTimeout(() => setShowLocationPrompt(true), 600);
      return () => clearTimeout(t);
    }
  }, [cart, geo.status, coords]);

  // Auto-fill coords when location is granted
  useEffect(() => {
    if (geo.status === "granted" && geo.coords) {
      setCoords(geo.coords);
      saveCustomerProfile({ lat: geo.coords.lat, lng: geo.coords.lng });
      setShowLocationPrompt(false);
    }
  }, [geo.status, geo.coords]);

  if (!cart) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Your cart is empty.
        </p>
        <Button
          className="bg-brand text-white hover:bg-brand-dark"
          onClick={() => onNavigate("basket")}
        >
          Build a basket
        </Button>
      </div>
    );
  }

  const subtotal = cart.items.reduce(
    (s, it) => s + it.unitPrice * it.qty,
    0
  );
  const total = subtotal + cart.deliveryFee;
  const fees = computeFees(subtotal, cart.deliveryFee);

  const phoneOk = /^0?7\d{8}$/.test(phone.replace(/\s/g, ""));
  const canSubmit =
    name.trim().length > 1 && phoneOk && location.trim().length > 3 && !!method && !loading;

  const handleSubmit = async () => {
    if (!method) return;
    setError(null);
    setLoading(true);
    try {
      const order = await onPlaceOrder({
        customerName: name,
        phone,
        location,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        paymentMethod: method,
      });
      if (!order) {
        setError("We couldn't place your order. Please try again.");
        return;
      }
      // Remember this customer for next time (name, phone, location, pin).
      saveCustomerProfile({
        name: name.trim(),
        phone: phone.trim(),
        location: location.trim(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
      onNavigate("confirmation");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold">Checkout</h1>
        <p className="text-sm text-muted-foreground">
          Pay once with M-Pesa. Your rider is dispatched immediately.
        </p>
      </div>

      {/* Welcome-back banner for returning customers */}
      {saved.name && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-light/60 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-foreground">
            <CheckCircle2 size={14} className="text-brand" />
            Welcome back, <strong>{saved.name}</strong> — we&apos;ve pre-filled
            your details.
          </span>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-muted-foreground hover:text-destructive"
            onClick={() => {
              setName("");
              setPhone("");
              setLocation("");
              setCoords(null);
            }}
          >
            Not you? Clear
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Form */}
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="flex items-center gap-1.5">
                <User size={14} /> Full name
              </Label>
              <Input
                id="name"
                placeholder="e.g. Wanjiru Kamau"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <Phone size={14} /> M-Pesa phone
              </Label>
              <Input
                id="phone"
                placeholder="07XXXXXXXX"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {phone && !phoneOk && (
                <p className="text-xs text-destructive">
                  Enter a valid Safaricom number (07XXXXXXXX).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc" className="flex items-center gap-1.5">
                <MapPin size={14} /> Delivery location
              </Label>
              <Input
                id="loc"
                placeholder="e.g. Kileleshwa, Njiwa Rd, Apt 4B"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Tip: drop a pin on the map below to auto-fill + give your rider
                exact coordinates.
              </p>
            </div>
            <LocationPicker
              value={coords}
              onChange={(c, addr) => {
                setCoords(c);
                if (addr) setLocation(addr);
              }}
            />
          </Card>

          {/* Direct-to-vendor payment */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 bg-mpesa/10 px-5 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-mpesa text-white">
                <Smartphone size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-mpesa">
                  How do you want to pay?
                </div>
                <div className="text-[11px] text-muted-foreground">
                  You pay {cart.vendor.name} directly — WeBizzle never
                  touches your money.
                </div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              {paymentOptions.length === 0 ? (
                <p className="text-sm text-destructive">
                  {cart.vendor.name} hasn&apos;t set up a payment method yet.
                  Please choose a different vendor.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {paymentOptions.map((opt) => (
                    <button
                      key={opt.method}
                      type="button"
                      onClick={() => setMethod(opt.method)}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        method === opt.method
                          ? "border-mpesa bg-mpesa/10"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          method === opt.method
                            ? "bg-mpesa text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {opt.method === "COD" ? (
                          <Banknote size={16} />
                        ) : (
                          <Smartphone size={16} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-foreground">
                          {opt.label}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {opt.detail}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {method && (
                <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                  {paymentInstructions(cart.vendor, method, total)}
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount to pay</span>
                <span className="text-lg font-extrabold text-foreground">
                  {KES(total)}
                </span>
              </div>
              <Button
                className="w-full bg-mpesa text-white hover:bg-mpesa/90"
                disabled={!canSubmit || paymentOptions.length === 0}
                onClick={handleSubmit}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Placing order…
                  </>
                ) : method === "COD" ? (
                  <>
                    <Banknote size={18} /> Place order — pay on delivery
                  </>
                ) : (
                  <>
                    <Smartphone size={18} /> Place order — pay {KES(total)}
                  </>
                )}
              </Button>
              {error && (
                <p className="text-center text-xs text-destructive">{error}</p>
              )}
              <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <ShieldCheck size={12} className="text-brand" />
                {method === "COD"
                  ? "Pay the rider in cash when your order arrives."
                  : "Your rider is dispatched as soon as you place the order — pay the vendor directly and confirm on the next screen."}
              </p>
            </div>
          </Card>
        </div>

        {/* Order summary */}
        <div className="space-y-4">
          <Card className="p-5 lg:sticky lg:top-20">
            <h3 className="text-sm font-bold">Order summary</h3>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-base">{cart.vendor.emoji}</span>
              {cart.vendor.name}
            </div>
            <div className="mt-3 max-h-52 space-y-2 overflow-y-auto wb-scroll">
              {cart.items.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-lg">{it.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {it.name}{" "}
                    <span className="text-muted-foreground">× {it.qty}</span>
                  </span>
                  <span className="font-medium">
                    {KES(it.unitPrice * it.qty)}
                  </span>
                </div>
              ))}
            </div>
            <div className="my-3 border-t border-border" />
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{KES(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery</span>
                <span>{KES(cart.deliveryFee)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-extrabold">
                <span>Total</span>
                <span className="text-brand">{KES(total)}</span>
              </div>
            </div>

            {/* Fee breakdown (marketplace economics) */}
            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Where the money goes
              </div>
              <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>{cart.vendor.emoji} {cart.vendor.name} receives</span>
                  <span className="font-medium text-foreground">{KES(fees.vendorPayout)}</span>
                </div>
                <div className="flex justify-between">
                  <span>🛵 Rider receives (90%)</span>
                  <span className="font-medium text-foreground">{KES(fees.driverPayout)}</span>
                </div>
                {fees.platformFee > 0 ? (
                  <div className="flex justify-between">
                    <span>WeBizzle levy (3% &gt; {KES(PLATFORM_FEE_THRESHOLD)})</span>
                    <span className="font-medium text-brand">{KES(fees.platformFee)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span>WeBizzle levy</span>
                    <span className="italic">No levy (under {KES(PLATFORM_FEE_THRESHOLD)})</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border/60 pt-1">
                  <span>Rider levy (10% to WeBizzle)</span>
                  <span className="font-medium text-brand">{KES(fees.driverLevy)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Location prompt for checkout */}
      <LocationPrompt
        open={showLocationPrompt}
        status={geo.status}
        error={geo.error}
        reason="checkout"
        onEnable={() => {
          geo.requestLocation();
        }}
        onDismiss={() => {
          setShowLocationPrompt(false);
          geo.dismiss();
        }}
      />
    </div>
  );
}

export function ConfirmationPage({
  order,
  onNavigate,
}: {
  order: Order | null;
  onNavigate: (p: PageId) => void;
}) {
  const [reportCode, setReportCode] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!order) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">No order to show.</p>
        <Button
          className="bg-brand text-white hover:bg-brand-dark"
          onClick={() => onNavigate("home")}
        >
          Back home
        </Button>
      </div>
    );
  }

  const method = order.paymentMethod ?? order.payment?.method ?? "COD";
  const payTo =
    method === "POCHI"
      ? order.payment?.pochiNumber
      : method === "TILL"
        ? order.payment?.tillNumber
        : method === "PAYBILL"
          ? order.payment?.paybillNumber
          : null;
  const needsPayment =
    method !== "COD" &&
    order.paymentStatus !== "PAID" &&
    order.paymentStatus !== "AWAITING_CONFIRMATION";

  const handleCopy = async () => {
    if (!payTo) return;
    try {
      await navigator.clipboard.writeText(payTo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable — silently ignore
    }
  };

  const handleReportPayment = async () => {
    setReporting(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/report-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mpesaCode: reportCode || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Couldn't record your payment. Try again.");
      }
      setReported(true);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <div className="flex flex-col items-center text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-brand-light">
          <CheckCircle2 className="text-brand" size={36} />
        </div>
        <h1 className="mt-3 text-2xl font-extrabold">Order placed!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ve sent your order to{" "}
          <strong>
            {order.vendor.emoji} {order.vendor.name}
          </strong>
          . A rider is being assigned.
        </p>
      </div>

      {/* Direct payment card — Pochi / Till / Paybill */}
      {method !== "COD" && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-mpesa" />
            <h3 className="text-sm font-bold">Pay {order.vendor.name} now</h3>
          </div>
          {payTo && (
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {method === "POCHI" ? "Pochi la Biashara" : method === "TILL" ? "Till number" : "Paybill number"}
                </div>
                <div className="font-mono text-sm font-bold">{payTo}</div>
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Send <strong>{KES(order.total)}</strong> via M-Pesa, then let us
            know so {order.vendor.name} can confirm it.
          </p>

          {order.paymentStatus === "PAID" ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
              <CheckCircle2 size={16} /> Payment confirmed by the vendor.
            </p>
          ) : reported || order.paymentStatus === "AWAITING_CONFIRMATION" ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
              <Loader2 size={14} className="animate-spin" /> Reported —
              waiting for {order.vendor.name} to confirm.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="mpesaCode" className="text-xs">
                M-Pesa confirmation code (optional)
              </Label>
              <Input
                id="mpesaCode"
                placeholder="e.g. QFG7X8Y2K1"
                value={reportCode}
                onChange={(e) => setReportCode(e.target.value)}
              />
              <Button
                className="w-full bg-mpesa text-white hover:bg-mpesa/90"
                disabled={reporting}
                onClick={handleReportPayment}
              >
                {reporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                I&apos;ve paid
              </Button>
              {reportError && (
                <p className="text-center text-xs text-destructive">{reportError}</p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Cash on delivery reminder */}
      {method === "COD" && (
        <Card className="flex items-center gap-3 p-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light text-brand">
            <Banknote size={18} />
          </div>
          <p className="text-sm">
            Pay <strong>{KES(order.total)}</strong> in cash to your rider
            when the order arrives.
          </p>
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Order ID</span>
          <span className="font-mono text-xs font-semibold">
            #{order.id.slice(-8).toUpperCase()}
          </span>
        </div>
        {order.mpesaCode && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">M-Pesa code</span>
            <span className="font-mono text-xs font-bold text-mpesa">
              {order.mpesaCode}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Delivering to</span>
          <span className="text-xs font-medium">{order.location}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-bold">Total{needsPayment ? " due" : ""}</span>
          <span className="text-lg font-extrabold text-brand">
            {KES(order.total)}
          </span>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <Button
          className="bg-brand text-white hover:bg-brand-dark"
          onClick={() => onNavigate("orders")}
        >
          Track my order <ChevronRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate("home")}>
          Back to home
        </Button>
      </div>
    </div>
  );
}
