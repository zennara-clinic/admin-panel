/**
 * One guest's money history, merged from every place a charge can come from.
 *
 * Kept apart from the billing screen because this is arithmetic, not UI, and
 * because getting it wrong overstates what a guest has paid — the same
 * purchase reaches us by more than one route and must be counted once.
 */

import type { Invoice, InvoiceLine, ProductOrder, PackageAssignment, MembershipAssignment } from "./types";

/** One line in the guest's money history, whatever it started life as. */
export type LedgerRow = {
  key: string;
  number: string;
  subNumber?: string | null;
  at?: string | null;
  kind: "Service" | "Product" | "Package" | "Membership" | "Mixed";
  items: string;
  itemsNote?: string;
  amount: number;
  due: number;
  status: "open" | "closed" | "void";
  statusLabel?: string;
  source: string;
  invoiceId?: string;
  orderId?: string;
};

/**
 * Merge every money record on one guest into a single list, newest first,
 * without counting a purchase twice.
 */
export function buildGuestLedger({ invoices, orders, assignments, memberships, zOrders, zPkgs, zMems }: {
  invoices: Invoice[];
  orders: ProductOrder[];
  assignments: PackageAssignment[];
  memberships: MembershipAssignment[];
  zOrders: { invoiceNumber?: string | null; name?: string | null; quantity?: number | null; price?: number | null; saleDate?: string | null; paymentType?: string | null; centerName?: string | null }[];
  zPkgs: { invoiceNumber?: string | null; name?: string | null; price?: number | null; purchaseDate?: string | null; centerName?: string | null }[];
  zMems: { invoiceNumber?: string | null; name?: string | null; price?: number | null; purchaseDate?: string | null; centerName?: string | null }[];
}): LedgerRow[] {
  const rows: LedgerRow[] = [];

  /*
   * Every invoice number we already hold. A Zenoti product sale, package or
   * membership carrying one of these is the SAME transaction reaching us by a
   * second route, so it must not be listed — or paid for — twice.
   */
  const known = new Set<string>();
  const remember = (v?: string | null) => { if (v) known.add(String(v).trim().toLowerCase()); };

  // A bill's "For" column comes from its lines. `custom` is a one-off charge
  // the desk typed in, which is a service in every practical sense.
  const kindOfLine = (l: InvoiceLine): LedgerRow["kind"] =>
    l.kind === "product" ? "Product"
      : l.kind === "package" ? "Package"
      : l.kind === "membership" ? "Membership"
      : "Service";

  for (const i of invoices) {
    remember(i.invoiceNumber);
    remember(i.receiptNumber);
    remember(i.zenotiSource?.invoiceNumber);
    remember(i.zenotiSource?.receiptNumber);

    const lines = i.lines ?? [];
    const kinds = new Set(lines.map(kindOfLine));
    const shown = lines.slice(0, 3).map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ");
    rows.push({
      key: `inv:${i._id}`,
      number: i.invoiceNumber,
      subNumber: i.receiptNumber ?? null,
      at: i.closedAt || i.issuedAt,
      kind: kinds.size === 1 ? ([...kinds][0] as LedgerRow["kind"]) : kinds.size === 0 ? "Service" : "Mixed",
      items: lines.length ? `${shown}${lines.length > 3 ? ` +${lines.length - 3} more` : ""}` : "",
      itemsNote: i.source === "zenoti" ? "Zenoti did not return any items for this bill" : "no items",
      amount: i.totals?.total ?? 0,
      due: i.status === "void" ? 0 : (i.totals?.due ?? 0),
      status: i.status === "void" ? "void" : i.status === "open" ? "open" : "closed",
      statusLabel: i.status !== "void" && i.status !== "open" && (i.totals?.due ?? 0) > 0 ? "CLOSED · DUE" : undefined,
      source: i.source === "zenoti" ? "Zenoti" : i.source === "app" ? "App" : "Desk",
      invoiceId: i._id,
    });
  }

  // App product orders. A clinic counter sale mirrored as an order already has
  // its Zenoti invoice above, so skip it.
  for (const o of orders) {
    const zInv = (o as { zenotiInvoiceId?: string | null }).zenotiInvoiceId;
    if (zInv && known.has(String(zInv).trim().toLowerCase())) continue;
    if (known.has(String(o.orderNumber).trim().toLowerCase())) continue;
    const items = o.items ?? [];
    const paid = o.paymentStatus === "Paid" || o.paymentStatus === "Refunded" || o.paymentStatus === "Partially Refunded";
    const total = o.pricing?.total ?? 0;
    rows.push({
      key: `ord:${o._id}`,
      number: o.orderNumber,
      at: o.createdAt ?? null,
      kind: "Product",
      items: items.slice(0, 3).map((it) => `${it.productName ?? "Item"}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", ")
        + (items.length > 3 ? ` +${items.length - 3} more` : ""),
      amount: total,
      due: paid || o.orderStatus === "Cancelled" ? 0 : total,
      status: o.orderStatus === "Cancelled" ? "void" : paid ? "closed" : "open",
      statusLabel: paid ? o.orderStatus?.toUpperCase() : undefined,
      source: o.source === "zenoti" ? "Zenoti" : "App",
      orderId: o._id,
    });
  }

  // Package purchases sold without a bill. One with an invoiceId is already above.
  for (const a of assignments) {
    if (a.invoiceId) continue;
    const amount = a.pricing?.finalAmount ?? a.packageDetails?.packagePrice ?? 0;
    if (!amount) continue;
    const paidAmt = a.payment?.amountPaid ?? (a.payment?.isReceived ? amount : 0);
    rows.push({
      key: `pkg:${a._id}`,
      number: a.assignmentId,
      at: a.payment?.receivedDate ?? a.validFrom ?? a.createdAt ?? null,
      kind: "Package",
      items: a.packageDetails?.packageName ?? "Package",
      amount,
      due: a.status === "Cancelled" ? 0 : Math.max(0, amount - paidAmt),
      status: a.status === "Cancelled" ? "void" : a.payment?.isReceived ? "closed" : "open",
      source: "Desk",
    });
  }

  // Membership purchases sold without a bill.
  for (const m of memberships) {
    if (m.invoiceId) continue;
    const amount = m.price ?? 0;
    if (!amount) continue;
    const paidAmt = m.payment?.amountPaid ?? (m.payment?.isReceived ? amount : 0);
    const name = typeof m.membershipId === "object" ? m.membershipId?.name : m.snapshot?.name;
    rows.push({
      key: `mem:${m._id}`,
      number: m.memberNumber || "Membership",
      at: m.payment?.receivedDate ?? m.validFrom ?? m.createdAt ?? null,
      kind: "Membership",
      items: name ?? "Membership",
      amount,
      due: m.status === "Cancelled" ? 0 : Math.max(0, amount - paidAmt),
      status: m.status === "Cancelled" ? "void" : m.payment?.isReceived ? "closed" : "open",
      source: m.source === "zenoti" ? "Zenoti" : m.source === "app" ? "App" : "Desk",
    });
  }

  // Zenoti-side sales the invoice mirror has not brought across yet. These are
  // history, not something the desk can collect against, so they carry no due.
  const zRow = (kind: LedgerRow["kind"], prefix: string) =>
    (r: { invoiceNumber?: string | null; name?: string | null; price?: number | null; quantity?: number | null; saleDate?: string | null; purchaseDate?: string | null; centerName?: string | null }, i: number): LedgerRow | null => {
      if (r.invoiceNumber && known.has(String(r.invoiceNumber).trim().toLowerCase())) return null;
      return {
        key: `${prefix}:${i}`,
        number: r.invoiceNumber || "Clinic sale",
        at: r.saleDate ?? r.purchaseDate ?? null,
        kind,
        items: `${r.name ?? kind}${r.quantity && r.quantity > 1 ? ` ×${r.quantity}` : ""}`,
        amount: Number(r.price) || 0,
        due: 0,
        status: "closed",
        source: "Zenoti",
      };
    };
  for (const [list, kind, prefix] of [[zOrders, "Product", "zord"], [zPkgs, "Package", "zpkg"], [zMems, "Membership", "zmem"]] as const) {
    (list as never[]).forEach((r, i) => { const row = zRow(kind, prefix)(r, i); if (row) rows.push(row); });
  }

  const time = (v?: string | null) => (v ? new Date(v).getTime() : 0);
  return rows.sort((a, b) => time(b.at) - time(a.at));
}

