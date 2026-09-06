import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Btn, Tag, Modal, Note, In, Sel, Area, B, Page, DataTable, Async, DateRange, Empty } from "../ui";
import { useStore } from "../store";
import api, { type NewInvoiceLine } from "../lib/api";
import { useApi } from "../lib/useApi";
import { fmtINR, fmtWhen, fmtAgo, isoDay } from "../lib/format";
import type { Invoice, InvoiceLine, GuestPackageBalance, GuestMembership, PaymentMethod, Consultation, Product, Inventory, Package, Doctor, Membership } from "../lib/types";

/* ------------------------------------------------------------------------- *
 * Billing — Zenoti's POS window, for our data.
 *
 * InvoiceModal is the bill: guest header, line items (Item · Sale by · Qty ·
 * Price · Discount · Final), the add-line tabs (Service / Product / Package /
 * Custom), "Discount on invoice", the guest's Packages to redeem against,
 * comments — and on the right "Collect payment" with the method tabs, amount,
 * change, the tenders taken so far, Print / Email / WhatsApp, Close invoice,
 * Reopen, Void. The server owns every figure; the panel only edits inputs
 * and re-renders what comes back.
 * ------------------------------------------------------------------------- */

const money = (n: number | undefined | null) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const idOf = (v: unknown) => (typeof v === "string" ? v : (v as { _id?: string })?._id ?? "");
const errMsg = (e: unknown) => (e as Error)?.message || "Something went wrong";

const METHOD_TABS: { key: PaymentMethod; label: string }[] = [
  { key: "Cash", label: "Cash" }, { key: "Card", label: "Credit / Debit" }, { key: "UPI", label: "UPI" }, { key: "Custom", label: "Custom" },
  { key: "BankTransfer", label: "Bank transfer" }, { key: "Cheque", label: "Cheque" }, { key: "Membership", label: "Membership" },
];

/** Print the GST receipt in a small popup — the browser's print dialog does the rest. */
export function printReceipt(html: string, title: string) {
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:12px;background:#fff}</style></head><body>${html}<script>setTimeout(function(){window.print();},250);</script></body></html>`);
  w.document.close();
  return true;
}

function StatusRibbon({ inv }: { inv: Invoice }) {
  if (inv.status === "void") return <span className="rounded-md bg-dis-bg px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-dis">VOID</span>;
  if (inv.status === "closed" && inv.totals.due > 0) return <span className="rounded-md bg-warn-bg px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-warn">CLOSED · DUE {fmtINR(inv.totals.due)}</span>;
  if (inv.status === "closed") return <span className="rounded-md bg-ok-bg px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-ok">PAID IN FULL</span>;
  return <span className="rounded-md bg-gold/20 px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-gold-dark">OPEN</span>;
}

/* ------------------------------ line row -------------------------------- */

function LineRow({ inv, l, editable, onChanged, onBusy }: { inv: Invoice; l: InvoiceLine; editable: boolean; onChanged: (i: Invoice) => void; onBusy: (b: boolean) => void }) {
  const [qty, setQty] = useState(String(l.qty));
  const [price, setPrice] = useState(String(l.unitPrice));
  const [disc, setDisc] = useState(String(l.discount || 0));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setQty(String(l.qty)); setPrice(String(l.unitPrice)); setDisc(String(l.discount || 0)); }, [l.qty, l.unitPrice, l.discount]);
  const commit = async (body: Parameters<typeof api.invoices.updateLine>[2]) => {
    onBusy(true); setErr(null);
    try { onChanged(await api.invoices.updateLine(inv._id, l._id, body)); } catch (e) { setErr(errMsg(e)); } finally { onBusy(false); }
  };
  const cell = "w-full rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12px] tabular-nums outline-none focus:border-gold-dark disabled:bg-ivory disabled:text-ink3";
  const redeemed = !!l.redeemed?.kind;
  return (
    <tr className="border-b border-border/70 align-top text-[12.5px]">
      <td className="py-2 pr-2">
        <div className="font-semibold">{l.name}{l.kind === "package" && <Tag kind="gold">Package</Tag>}</div>
        <div className="text-[11px] text-ink3">
          {l.soldByName ? <>Sale by: {l.soldByName}</> : <span className="text-warn">No sale-by</span>}
          {l.code ? ` · ${l.code}` : ""}{l.hsn ? ` · ${l.kind === "service" ? "SAC" : "HSN"} ${l.hsn}` : ""}{l.batchNo ? ` · B.No ${l.batchNo}` : ""}{l.expiryDate ? ` · Exp ${new Date(l.expiryDate).toLocaleDateString("en-GB")}` : ""}
          {l.taxPercent ? ` · GST ${l.taxPercent}%${l.priceIncludesTax ? " incl." : ""}` : " · no GST"}
        </div>
        {redeemed && (
          <div className="mt-0.5 text-[11px] font-semibold text-ok">
            {l.redeemed?.label || "Package credit used"}
            {editable && <button className="ml-2 font-normal text-ink3 underline-offset-2 hover:underline" onClick={async () => { onBusy(true); try { onChanged(await api.invoices.removeRedemption(inv._id, l._id)); } catch (e) { setErr(errMsg(e)); } finally { onBusy(false); } }}>Remove</button>}
          </div>
        )}
        {l.discountSource === "membership" && l.discountLabel && <div className="text-[11px] font-semibold text-gold-dark">{l.discountLabel}</div>}
        {l.discountSource === "manual" && editable && !redeemed && <button className="text-[10.5px] text-ink3 underline-offset-2 hover:underline" onClick={() => commit({ restoreMembershipDiscount: true })}>clear discount / restore member rate</button>}
        {l.notes && <div className="text-[11px] text-ink3">{l.notes}</div>}
        {err && <div className="text-[11px] text-err">{err}</div>}
      </td>
      <td className="w-14 py-2 pr-2"><input className={cell} disabled={!editable || l.kind === "package"} value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => Number(qty) !== l.qty && commit({ qty: Number(qty) || 0 })} /></td>
      <td className="w-24 py-2 pr-2"><input className={cell} disabled={!editable} value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => Number(price) !== l.unitPrice && commit({ unitPrice: Number(price) || 0 })} /></td>
      <td className="w-20 py-2 pr-2"><input className={cell} disabled={!editable || redeemed} value={disc} onChange={(e) => setDisc(e.target.value)} onBlur={() => Number(disc) !== (l.discount || 0) && commit({ discount: Number(disc) || 0 })} /></td>
      <td className="w-24 py-2 text-right tabular-nums">
        <div className={redeemed ? "text-ink3 line-through" : "font-semibold"}>{money(redeemed ? l.base : l.net)}</div>
        {redeemed ? <div className="font-semibold">0.00</div> : (l.invoiceDiscountShare > 0 && <div className="text-[10.5px] text-ink3">−{money(l.invoiceDiscountShare)} bill disc.</div>)}
      </td>
      <td className="w-6 py-2 text-right">{editable && <button className="text-ink3 hover:text-err" title="Remove line" onClick={async () => { onBusy(true); try { onChanged(await api.invoices.removeLine(inv._id, l._id)); } catch (e) { setErr(errMsg(e)); } finally { onBusy(false); } }}>✕</button>}</td>
    </tr>
  );
}

/* ------------------------------ add a line ------------------------------ */

function AddLine({ inv, onChanged }: { inv: Invoice; onChanged: (i: Invoice) => void }) {
  const [tab, setTab] = useState<"service" | "product" | "stock" | "package" | "membership" | "custom">("service");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("1");
  const [soldBy, setSoldBy] = useState("");
  const [custom, setCustom] = useState({ name: "", unitPrice: "", taxPercent: "5", incl: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const branchId = idOf(inv.branchId);
  const docs = useApi(() => api.doctors.list({ limit: 200 }), []);
  const doctorRows = ((docs.data?.data ?? []) as Doctor[]).filter((d) => d.isActive !== false);
  const debounced = useDebounced(q, 250);
  const results = useApi(async () => {
    if (tab === "custom" || tab === "package" || tab === "membership") return [] as unknown[];
    if (debounced.trim().length < 2) return [] as unknown[];
    if (tab === "service") return ((await api.services.list({ search: debounced, limit: 12, isActive: "true" })).data ?? []) as Consultation[];
    if (tab === "product") return ((await api.products.list({ search: debounced, limit: 12 })).data ?? []) as Product[];
    return ((await api.inventory.list({ search: debounced, limit: 12, ...(branchId ? { branchId } : {}) })).data ?? []) as Inventory[];
  }, [tab, debounced, branchId]);
  const pkgs = useApi(() => (tab === "package" ? api.packages.list({ isActive: "true" }) : Promise.resolve([] as Package[])), [tab]);
  const plans = useApi(() => (tab === "membership" ? api.memberships.list() : Promise.resolve([] as Membership[])), [tab]);

  const add = async (body: NewInvoiceLine) => {
    setBusy(true); setErr(null);
    const doc = doctorRows.find((d) => d.name === soldBy);
    try {
      onChanged(await api.invoices.addLine(inv._id, { ...body, qty: Math.max(1, Number(qty) || 1), soldById: doc?.doctorId ?? null, soldByName: doc?.name ?? null, soldByModel: doc ? "Doctor" : null }));
      setQ(""); setQty("1"); setOpen(false);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  if (!open) return <div className="mt-2"><Btn kind="ghost" className="!py-1.5 !text-[12px]" onClick={() => setOpen(true)}>+ Add service, product or package</Btn></div>;
  const tabBtn = (k: typeof tab, label: string) => <button key={k} onClick={() => { setTab(k); setQ(""); }} className={`rounded-md px-2.5 py-1 text-[11.5px] font-bold ${tab === k ? "bg-primary text-white" : "bg-ivory text-ink2 hover:bg-border/60"}`}>{label}</button>;
  return (
    <div className="mt-2 rounded-xl border border-border bg-ivory/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabBtn("service", "Service")}{tabBtn("product", "Product")}{tabBtn("stock", "Stock item (batch)")}{tabBtn("package", "Package")}{tabBtn("membership", "Membership")}{tabBtn("custom", "Custom")}
        <button className="ml-auto text-[11px] text-ink3 underline-offset-2 hover:underline" onClick={() => setOpen(false)}>Done</button>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_80px_180px]">
        {tab === "custom" ? (
          <In label="Description" value={custom.name} onChange={(v) => setCustom({ ...custom, name: v })} placeholder="e.g. Consumables, Late fee" />
        ) : tab === "package" ? (
          <Sel label="Package" value={q} onChange={setQ} options={["", ...(pkgs.data ?? []).map((p) => `${p.name} · ${fmtINR(p.price)}`)]} />
        ) : tab === "membership" ? (
          <Sel label="Membership plan" value={q} onChange={setQ} options={["", ...(plans.data ?? []).filter((p) => p.isActive).map((p) => `${p.name} · ${fmtINR(p.price)} · ${p.validityMonths} mo`)]} />
        ) : (
          <In label={tab === "service" ? "Search services" : tab === "product" ? "Search products (retail catalogue)" : "Search stock by name or batch"} value={q} onChange={setQ} placeholder="Type at least 2 letters…" />
        )}
        <In label="Qty" type="number" value={qty} onChange={setQty} />
        <Sel label="Sale by" value={soldBy} onChange={setSoldBy} options={["", ...doctorRows.map((d) => d.name)]} />
      </div>
      {tab === "custom" && (
        <div className="mt-2 grid gap-2 md:grid-cols-[120px_100px_160px_auto]">
          <In label="Unit price (₹)" type="number" value={custom.unitPrice} onChange={(v) => setCustom({ ...custom, unitPrice: v })} />
          <In label="GST %" type="number" value={custom.taxPercent} onChange={(v) => setCustom({ ...custom, taxPercent: v })} />
          <label className="flex items-end gap-2 pb-2 text-[12px]"><input type="checkbox" checked={custom.incl} onChange={(e) => setCustom({ ...custom, incl: e.target.checked })} /> Price includes GST</label>
          <div className="flex items-end"><Btn disabled={busy || !custom.name.trim()} onClick={() => add({ kind: "custom", name: custom.name.trim(), unitPrice: Number(custom.unitPrice) || 0, taxPercent: Number(custom.taxPercent) || 0, priceIncludesTax: custom.incl })}>Add</Btn></div>
        </div>
      )}
      {tab === "package" && q && (
        <div className="mt-2 flex justify-end"><Btn disabled={busy} onClick={() => { const p = (pkgs.data ?? []).find((x) => `${x.name} · ${fmtINR(x.price)}` === q); if (p) add({ packageId: p._id }); }}>Add package</Btn></div>
      )}
      {tab === "membership" && q && (
        <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-ink3">Closing the bill enrols the guest and issues the member number.</span><Btn disabled={busy} onClick={() => { const p = (plans.data ?? []).find((x) => `${x.name} · ${fmtINR(x.price)} · ${x.validityMonths} mo` === q); if (p) add({ membershipId: p._id }); }}>Add membership</Btn></div>
      )}
      {tab !== "custom" && tab !== "package" && tab !== "membership" && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface">
          {results.loading && debounced.trim().length >= 2 ? <div className="px-3 py-2 text-[12px] text-ink3">Searching…</div>
            : (results.data ?? []).length === 0 ? <div className="px-3 py-2 text-[12px] text-ink3">{debounced.trim().length < 2 ? "Start typing to search." : "Nothing matches."}</div>
            : (results.data as unknown[]).map((r) => {
              if (tab === "service") { const c = r as Consultation; const cp = (c.centrePrices ?? []).find((x) => String(x.branchId) === branchId); const price = cp?.price ?? c.price; return (
                <button key={c._id} className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left text-[12.5px] hover:bg-ivory" disabled={busy} onClick={() => add({ consultationId: c._id })}>
                  <span><B>{c.name}</B> <span className="text-ink3">{c.category}{c.code ? ` · ${c.code}` : ""}</span></span><span className="tabular-nums">{fmtINR(price)} <span className="text-[10.5px] text-ink3">incl. GST {c.taxPercent ?? 5}%</span></span>
                </button>); }
              if (tab === "product") { const p = r as Product; return (
                <div key={p._id} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-[12.5px]">
                  <span><B>{p.name}</B> {p.isRx ? <Tag kind="warn">Rx</Tag> : null} <span className="text-ink3">{p.code ?? ""}{p.trackStock !== false ? ` · ${p.stock} in stock` : ""}</span></span>
                  <span className="flex items-center gap-1.5">
                    <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy} onClick={() => add({ productId: p._id })}>{fmtINR(p.price)} + GST</Btn>
                    {Number(p.mrp) > 0 && <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy} onClick={() => add({ productId: p._id, useMrp: true })}>MRP {fmtINR(p.mrp)}</Btn>}
                  </span>
                </div>); }
              const s = r as Inventory; return (
                <button key={s._id} className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left text-[12.5px] hover:bg-ivory" disabled={busy} onClick={() => add({ inventoryId: s._id })}>
                  <span><B>{s.inventoryName}</B> <span className="text-ink3">{s.batchNo ? `B.No ${s.batchNo}` : ""}{s.batchExpiryDate ? ` · Exp ${new Date(s.batchExpiryDate).toLocaleDateString("en-GB")}` : ""} · {s.qohAllBatches ?? 0} on shelf</span></span>
                  <span className="tabular-nums">{fmtINR(s.inventoryAfterTaxSellingPrice || s.inventorySellingPrice || 0)}</span>
                </button>);
            })}
        </div>
      )}
      {err && <Note kind="crit" className="mt-2">{err}</Note>}
    </div>
  );
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/* ------------------------------ the bill -------------------------------- */

export function InvoiceModal({ open, invoiceId, onClose, onChanged }: { open: boolean; invoiceId: string | null; onClose: () => void; onChanged?: () => void }) {
  const { can, toast } = useStore();
  const nav = useNavigate();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState("");
  const [customName, setCustomName] = useState("");
  const [reference, setReference] = useState("");
  const [discMode, setDiscMode] = useState<"percent" | "amount">("percent");
  const [discVal, setDiscVal] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [comments, setComments] = useState("");
  const [pkgSel, setPkgSel] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendPhone, setSendPhone] = useState("");
  const changed = useRef(false);
  const canManage = can("billing.manage") || can("bookings.manage");
  const canVoid = can("billing.void");

  const load = async (id: string) => {
    setLoadErr(null);
    try { const i = await api.invoices.get(id); setInv(i); } catch (e) { setLoadErr(errMsg(e)); }
  };
  useEffect(() => { if (open && invoiceId) { setInv(null); setErr(null); changed.current = false; load(invoiceId); } }, [open, invoiceId]);
  useEffect(() => {
    if (!inv) return;
    setAmount(String(inv.totals.due || ""));
    setDiscMode(inv.invoiceDiscount?.percent > 0 ? "percent" : "amount");
    setDiscVal(inv.invoiceDiscount?.percent > 0 ? String(inv.invoiceDiscount.percent) : inv.invoiceDiscount?.amount > 0 ? String(inv.invoiceDiscount.amount) : "");
    setDiscReason(inv.invoiceDiscount?.reason || "");
    setComments(inv.comments || "");
    setSendEmail(inv.guest?.email || ""); setSendPhone(inv.guest?.phone || "");
  }, [inv?._id, inv?.totals.due, inv?.status]);
  const pkgs = useApi(() => (inv?._id && inv.userId ? api.invoices.guestPackages(inv._id) : Promise.resolve({ success: true, data: [] as GuestPackageBalance[], membership: null as GuestMembership | null })), [inv?._id, inv?.status]);
  const guestPkgs: GuestPackageBalance[] = (pkgs.data?.data ?? []) as GuestPackageBalance[];
  const guestMem: GuestMembership | null = (pkgs.data as { membership?: GuestMembership | null } | undefined)?.membership ?? null;

  const apply = (next: Invoice) => { setInv(next); changed.current = true; };
  const run = async (fn: () => Promise<Invoice>, msg?: string) => {
    setBusy(true); setErr(null);
    try { apply(await fn()); if (msg) toast(msg); return true; } catch (e) { setErr(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const close = () => { if (changed.current) onChanged?.(); onClose(); };

  if (!open) return null;
  const editable = !!inv && inv.status === "open" && canManage;
  const t = inv?.totals;
  const guestName = inv?.guest?.name || (inv?.userId as { fullName?: string } | null)?.fullName || "Guest";
  const centre = (inv?.branchId as { name?: string } | null)?.name || inv?.seller?.name || "";
  const cashChange = method === "Cash" && inv ? Math.max(0, (Number(amount) || 0) - inv.totals.due) : 0;

  return (
    <Modal open onClose={close} title={inv ? `Invoice ${inv.invoiceNumber}` : "Invoice"} xl>
      {!inv ? (loadErr ? <Note kind="crit">{loadErr}</Note> : <div className="py-8 text-center text-[12.5px] text-ink3">Opening the bill…</div>) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* ------------------------------ left: the bill ------------------------------ */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-side px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-wider opacity-70">Center: {centre}</div>
                <div className="text-[15px] font-extrabold">Invoice No {inv.invoiceNumber}{inv.receiptNumber ? <span className="ml-2 text-[12px] font-semibold opacity-80">Receipt {inv.receiptNumber}</span> : null}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px]">
                  <button className="font-bold underline-offset-2 hover:underline" onClick={() => { const uid = idOf(inv.userId); if (uid) { close(); nav("/patient", { state: { id: uid } }); } }}>{guestName}</button>
                  {inv.guest?.phone && <span className="opacity-80">| {inv.guest.phone}</span>}
                  {inv.guest?.email ? <span className="opacity-80">| {inv.guest.email}</span> : <button className="text-[11px] underline-offset-2 opacity-80 hover:underline" onClick={() => setSendOpen(true)}>Add email</button>}
                  {inv.guest?.patientId && <span className="font-mono text-[11px] opacity-70">{inv.guest.patientId}</span>}
                  {inv.membership?.name && <span className="rounded-full bg-gold/30 px-2 py-0.5 text-[10.5px] font-bold">{inv.membership.name}{inv.membership.memberNumber ? ` · ${inv.membership.memberNumber}` : ""}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1"><StatusRibbon inv={inv} /><span className="text-[10.5px] opacity-70">{fmtWhen(inv.closedAt || inv.issuedAt)}{inv.closedByName ? ` · closed by ${inv.closedByName}` : inv.createdByName ? ` · by ${inv.createdByName}` : ""}</span></div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead><tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-ink3"><th className="pb-1">Item</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Price</th><th className="pb-1 text-right">Discount</th><th className="pb-1 text-right">Final price</th><th /></tr></thead>
                <tbody>
                  {inv.lines.length === 0 ? <tr><td colSpan={6} className="py-4 text-center text-[12px] text-ink3">No items yet — add a service, product or package below.</td></tr>
                    : inv.lines.map((l) => <LineRow key={l._id} inv={inv} l={l} editable={editable} onChanged={apply} onBusy={setBusy} />)}
                </tbody>
              </table>
            </div>
            <div className="text-[10.5px] text-ink3">Prices in the table are before GST, as Zenoti shows them. Discounts are in rupees, before GST.</div>
            {editable && <AddLine inv={inv} onChanged={apply} />}

            <div className="mt-3 grid gap-2 text-[12.5px] md:grid-cols-2">
              <div className="rounded-xl border border-border p-3">
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink3">Discount on invoice</div>
                <div className="flex items-center gap-2">
                  <select disabled={!editable} value={discMode} onChange={(e) => setDiscMode(e.target.value as "percent" | "amount")} className="rounded-md border border-border bg-surface px-1.5 py-1 text-[12px]"><option value="percent">%</option><option value="amount">₹</option></select>
                  <input disabled={!editable} value={discVal} onChange={(e) => setDiscVal(e.target.value)} placeholder="0" className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px] tabular-nums outline-none focus:border-gold-dark disabled:bg-ivory" />
                  <input disabled={!editable} value={discReason} onChange={(e) => setDiscReason(e.target.value)} placeholder="Reason" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-gold-dark disabled:bg-ivory" />
                  {editable && <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy} onClick={() => run(() => api.invoices.update(inv._id, { invoiceDiscount: discMode === "percent" ? { percent: Number(discVal) || 0, amount: 0, reason: discReason } : { percent: 0, amount: Number(discVal) || 0, reason: discReason } }))}>▶</Btn>}
                </div>
                {t && t.invoiceDiscount > 0 && <div className="mt-1 text-[11px] text-ok">−{fmtINR(t.invoiceDiscount)} across the billable lines</div>}
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink3">Packages</div>
                {!inv.userId ? <div className="text-[11.5px] text-ink3">Walk-in bill — no guest record to redeem from.</div>
                  : guestPkgs.length === 0 ? <div className="text-[11.5px] text-ink3">{pkgs.loading ? "Checking…" : "No active packages on this guest."}</div>
                  : (
                    <div className="flex items-center gap-2">
                      <select disabled={!editable} value={pkgSel} onChange={(e) => setPkgSel(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[12px]">
                        <option value="">Select package</option>
                        {guestPkgs.map((p) => <option key={p._id} value={p._id} disabled={p.redeemable ? !p.redeemable.ok : false}>{p.name}{p.frozen ? " (frozen)" : p.redeemable?.grace ? " (grace period)" : p.redeemable && !p.redeemable.ok ? ` (${p.redeemable.code?.replace("PACKAGE_", "").toLowerCase()})` : ""} — {p.balances.map((b) => `${b.serviceName ?? b.serviceId} ${b.balance}/${b.entitled}`).join(", ")}</option>)}
                      </select>
                      {editable && <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy || !pkgSel} onClick={async () => {
                        setBusy(true); setErr(null);
                        try { const r = await api.invoices.applyPackage(inv._id, { packageAssignmentId: pkgSel }); apply(r.data as Invoice); toast(`Package benefits applied to ${r.applied ?? 1} line${(r.applied ?? 1) === 1 ? "" : "s"}`); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
                      }}>Apply</Btn>}
                    </div>
                  )}
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-border p-3 text-[12.5px]">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink3">Memberships</div>
              {!inv.userId ? <div className="text-[11.5px] text-ink3">Walk-in bill — no guest record.</div>
                : !guestMem ? <div className="text-[11.5px] text-ink3">{pkgs.loading ? "Checking…" : "Not a member. Sell a plan from the add-line tabs to enrol this guest."}</div>
                : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Tag kind="gold">{guestMem.name}{guestMem.memberNumber ? ` · ${guestMem.memberNumber}` : ""}</Tag>
                    <span className="text-[11.5px] text-ink2">
                      {[guestMem.discounts.servicesPercent ? `${guestMem.discounts.servicesPercent}% off services` : "", guestMem.discounts.productsPercent ? `${guestMem.discounts.productsPercent}% off products` : "", guestMem.discounts.packagesPercent ? `${guestMem.discounts.packagesPercent}% off packages` : ""].filter(Boolean).join(" · ") || "no % discount"}
                      {guestMem.validUntil ? ` · valid to ${new Date(guestMem.validUntil).toLocaleDateString("en-GB")}` : ""}
                    </span>
                    {guestMem.credits.length > 0 && (
                      <span className="flex items-center gap-2 text-[11.5px]">
                        <span className="text-ink3">Credits:</span>{guestMem.credits.map((c) => <span key={c.serviceId}>{c.serviceName ?? c.serviceId} <B>{c.balance}</B>/{c.entitled}</span>)}
                        {editable && guestMem.credits.some((c) => c.balance > 0) && <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy} onClick={async () => {
                          setBusy(true); setErr(null);
                          try { const r = await api.invoices.applyMembershipCredits(inv._id); apply(r.data as Invoice); toast(`Membership credit used on ${r.applied ?? 1} line${(r.applied ?? 1) === 1 ? "" : "s"}`); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
                        }}>Use credit</Btn>}
                      </span>
                    )}
                    <span className="text-[10.5px] text-ink3">Member discounts are applied to each line as it is added; edit a line's discount to override, or clear it to restore.</span>
                  </div>
                )}
            </div>
            <div className="mt-2">
              <Area label="Comments" value={comments} onChange={setComments} rows={2} placeholder="Comments are saved when you leave the box." />
              {comments !== (inv.comments || "") && <div className="mt-1 flex justify-end"><Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" disabled={busy} onClick={() => run(() => api.invoices.update(inv._id, { comments }), "Comment saved")}>Save comment</Btn></div>}
            </div>
            {inv.status === "void" && <Note kind="crit" className="mt-2">Voided {fmtAgo(inv.voidedAt)} by {inv.voidedByName}: {inv.voidReason}</Note>}
          </div>

          {/* ------------------------------ right: collect payment ------------------------------ */}
          <div className="min-w-0">
            <div className="rounded-xl border border-border bg-ivory/60 p-3">
              <div className="text-[13px] font-extrabold">Collect payment</div>
              {t && (
                <table className="mt-2 w-full text-[12.5px]"><tbody>
                  <tr><td className="py-0.5 text-ink2">Net price</td><td className="py-0.5 text-right tabular-nums">{money(t.net)}</td></tr>
                  <tr><td className="py-0.5 text-ink2">Tax{inv.interState ? " (IGST)" : ` (CGST ${money(t.cgst)} + SGST ${money(t.sgst)})`}</td><td className="py-0.5 text-right tabular-nums">{money(t.tax)}</td></tr>
                  {t.rounding !== 0 && <tr><td className="py-0.5 text-ink2">Rounding</td><td className="py-0.5 text-right tabular-nums">{money(t.rounding)}</td></tr>}
                  <tr className="border-t border-border font-extrabold"><td className="py-1">Sum total</td><td className="py-1 text-right tabular-nums">{fmtINR(t.total)}</td></tr>
                  <tr><td className="py-0.5 text-ink2">Paid</td><td className="py-0.5 text-right tabular-nums">{money(t.paid)}</td></tr>
                  <tr className={t.due > 0 ? "font-bold text-err" : "text-ok"}><td className="py-0.5">Due</td><td className="py-0.5 text-right tabular-nums">{money(t.due)}</td></tr>
                  {t.change > 0 && <tr className="text-ink2"><td className="py-0.5">Change given</td><td className="py-0.5 text-right tabular-nums">{money(t.change)}</td></tr>}
                  {t.redeemed > 0 && <tr className="text-ok"><td className="py-0.5">Settled by package credit</td><td className="py-0.5 text-right tabular-nums">{money(t.redeemed)}</td></tr>}
                </tbody></table>
              )}

              {editable && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-1">
                    {METHOD_TABS.map((m) => <button key={m.key} onClick={() => { setMethod(m.key); setAmount(String(inv.totals.due || "")); }} className={`rounded-md px-2 py-1 text-[11px] font-bold ${method === m.key ? "bg-primary text-white" : "bg-surface text-ink2 hover:bg-border/60"}`}>{m.label}</button>)}
                  </div>
                  <div className="mt-2 grid gap-2">
                    {method === "Custom" && <In label="Payment method name" value={customName} onChange={setCustomName} placeholder="e.g. UPI – PhonePe, Wallet" />}
                    <In label="Amount (₹)" type="number" value={amount} onChange={setAmount} />
                    {(method === "Card" || method === "UPI" || method === "BankTransfer" || method === "Cheque" || method === "Custom") && <In label="Reference / approval no." value={reference} onChange={setReference} placeholder="optional" />}
                    {method === "Cash" && cashChange > 0 && <div className="text-[12px]">Change to return: <B>{fmtINR(cashChange)}</B></div>}
                    <Btn kind="gold" disabled={busy || !(Number(amount) > 0) || inv.lines.length === 0} onClick={async () => {
                      setBusy(true); setErr(null);
                      try {
                        const r = await api.invoices.addPayment(inv._id, { method, amount: Number(amount), customName: method === "Custom" ? customName : undefined, reference: reference || undefined });
                        apply(r.data as Invoice); setReference(""); toast(r.message || (r.closed ? "Payment taken — invoice closed" : "Payment taken"));
                      } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
                    }}>Add payment</Btn>
                  </div>
                </div>
              )}

              {inv.payments.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Payment details</div>
                  {inv.payments.map((p) => (
                    <div key={p._id} className={`mt-1 flex items-start justify-between gap-2 text-[12px] ${p.voided ? "text-ink3 line-through" : ""}`}>
                      <span><B>{p.method === "Custom" ? `Custom · ${p.customName}` : p.method.toUpperCase()}</B>{p.reference ? <span className="text-ink3"> {p.reference}</span> : null}<div className="text-[10.5px] text-ink3">{fmtWhen(p.paidAt)}{p.takenByName ? ` · ${p.takenByName}` : ""}{p.voided ? ` · voided: ${p.voidReason}` : ""}</div></span>
                      <span className="flex items-center gap-2 tabular-nums">{money(p.amount)}{editable && canVoid && !p.voided && <button className="text-[10.5px] text-ink3 hover:text-err" title="Void this payment" onClick={() => { const reason = window.prompt("Reason for voiding this payment?") || ""; if (reason.trim()) run(() => api.invoices.voidPayment(inv._id, p._id, reason), "Payment voided"); }}>void</button>}</span>
                    </div>
                  ))}
                </div>
              )}
              {err && <Note kind="crit" className="mt-2">{err}</Note>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Btn kind="ghost" disabled={busy} onClick={async () => { try { const r = await api.invoices.receipt(inv._id, true); if (!printReceipt(r.html, inv.invoiceNumber)) setErr("Allow pop-ups to print the receipt."); } catch (e) { setErr(errMsg(e)); } }}>Print</Btn>
              <Btn kind="ghost" disabled={busy || !canManage} onClick={() => setSendOpen(true)}>Email / WhatsApp</Btn>
              {inv.status === "open" && canManage && <Btn disabled={busy || inv.lines.length === 0} onClick={() => (inv.totals.due > 0 ? setDueOpen(true) : run(() => api.invoices.close(inv._id), "Invoice closed"))}>Close invoice</Btn>}
              {inv.status === "closed" && canVoid && <Btn kind="ghost" disabled={busy} onClick={() => run(() => api.invoices.reopen(inv._id), "Invoice reopened")}>Reopen</Btn>}
              {inv.status !== "void" && canVoid && <Btn kind="danger" disabled={busy} onClick={() => setVoidOpen(true)}>Void</Btn>}
              <Btn kind="ghost" onClick={close}>Close window</Btn>
            </div>
            {inv.status === "open" && inv.totals.due === 0 && inv.lines.length > 0 && <Note className="mt-2">Everything is settled — Close invoice to finish. Closing marks the visits paid, takes stock off the shelf and activates any package sold.</Note>}
          </div>
        </div>
      )}

      {/* void */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title={`Void ${inv?.invoiceNumber ?? "invoice"}`}>
        <Note kind="crit">Voiding keeps the number but cancels the bill: visits go back to unpaid, stock returns to the shelf, package sessions are restored, packages sold on it are cancelled, and every payment on it is marked void.</Note>
        <div className="mt-3"><Area label="Reason" value={voidReason} onChange={setVoidReason} rows={2} placeholder="e.g. Billed the wrong guest" /></div>
        <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={() => setVoidOpen(false)}>Back</Btn><Btn kind="danger" disabled={busy || voidReason.trim().length < 3} onClick={async () => { if (inv && await run(() => api.invoices.void(inv._id, voidReason.trim()), "Invoice voided")) { setVoidOpen(false); setVoidReason(""); } }}>Void invoice</Btn></div>
      </Modal>
      {/* close with a balance */}
      <Modal open={dueOpen} onClose={() => setDueOpen(false)} title="Close with a balance due?">
        <Note kind="crit">{fmtINR(inv?.totals.due ?? 0)} has not been collected. The bill will show as CLOSED · DUE in today's sales and the visits stay unpaid until the balance is taken (reopen the invoice to add the payment).</Note>
        <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={() => setDueOpen(false)}>Back</Btn><Btn kind="gold" disabled={busy} onClick={async () => { if (inv && await run(() => api.invoices.close(inv._id, true), "Invoice closed with a balance due")) setDueOpen(false); }}>Close anyway</Btn></div>
      </Modal>
      {/* send */}
      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send the receipt">
        <div className="grid gap-3 md:grid-cols-2">
          <In label="Email" type="email" value={sendEmail} onChange={setSendEmail} placeholder="guest@example.com" />
          <In label="WhatsApp number" value={sendPhone} onChange={setSendPhone} placeholder="+91 …" />
        </div>
        <Note className="mt-3">Email carries the full GST receipt. WhatsApp sends a short text summary (items, total, payments).</Note>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Btn kind="ghost" onClick={() => setSendOpen(false)}>Back</Btn>
          {(["email", "whatsapp", "both"] as const).map((ch) => (
            <Btn key={ch} kind={ch === "both" ? "gold" : "primary"} disabled={busy || (ch !== "whatsapp" && !sendEmail.trim()) || (ch !== "email" && !sendPhone.trim())} onClick={async () => {
              if (!inv) return; setBusy(true); setErr(null);
              try {
                const r = await api.invoices.send(inv._id, { channel: ch, email: sendEmail.trim() || undefined, phone: sendPhone.trim() || undefined });
                const parts = [r.data?.email ? `email ${r.data.email.ok ? "sent" : `failed (${r.data.email.error})`}` : "", r.data?.whatsapp ? `WhatsApp ${r.data.whatsapp.ok ? "sent" : `failed (${r.data.whatsapp.error})`}` : ""].filter(Boolean);
                toast(parts.join(" · ")); if (r.success) { setSendOpen(false); load(inv._id); }
              } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
            }}>{ch === "email" ? "Email" : ch === "whatsapp" ? "WhatsApp" : "Both"}</Btn>
          ))}
        </div>
      </Modal>
    </Modal>
  );
}

/** Open (or return) the bill for a booking, then show it. */
export function useOpenInvoice() {
  const { toast } = useStore();
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openForBooking = async (bookingId: string, branchId?: string | null) => {
    setBusy(true);
    try { const r = await api.invoices.open({ bookingId, branchId: branchId || undefined }); setInvoiceId((r.data as Invoice)._id); }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  const openForGuest = async (userId: string, branchId: string) => {
    setBusy(true);
    try { const r = await api.invoices.open({ userId, branchId }); setInvoiceId((r.data as Invoice)._id); }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  return { invoiceId, setInvoiceId, openForBooking, openForGuest, busy };
}

/* ------------------------------ the register ---------------------------- */

export function Invoices() {
  const { branchId, can } = useStore();
  const [from, setFrom] = useState(isoDay());
  const [to, setTo] = useState(isoDay());
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const dq = useDebounced(search, 300);
  const q = useApi(() => api.invoices.list({ from, to, status, search: dq || undefined, branchId: branchId || undefined, limit: 200 }), [from, to, status, dq, branchId]);
  const rows = (q.data?.data ?? []) as Invoice[];
  const totals = q.data?.totals;
  const kindOf = (i: Invoice) => i.status === "void" ? <Tag kind="mute">VOID</Tag> : i.status === "open" ? <Tag kind="gold">OPEN</Tag> : i.totals.due > 0 ? <Tag kind="warn">CLOSED · DUE</Tag> : <Tag kind="ok">CLOSED</Tag>;
  return (
    <Page title="Invoices" sub="Every desk bill — open, closed and void. Search by invoice or receipt number, guest or item."
      actions={<div className="flex items-center gap-2"><input value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && lookup.trim()) { setLookErr(null); try { const i = await api.invoices.lookup(lookup.trim()); setSel(i._id); } catch (er) { setLookErr(errMsg(er)); } } }} placeholder="Invoice / receipt no. ↵" className="w-48 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" /></div>}>
      {lookErr && <Note kind="crit">{lookErr}</Note>}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Sel label="Status" value={status} onChange={setStatus} options={["all", "open", "closed", "void"]} />
        <div className="min-w-[220px] flex-1"><In label="Search" value={search} onChange={setSearch} placeholder="Guest, phone, patient id, item…" /></div>
      </div>
      {totals && (
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          {[["Bills", String(totals.count)], ["Billed", fmtINR(totals.amount)], ["Collected", fmtINR(totals.paid)], ["Due", fmtINR(totals.due)]].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-ivory px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{k}</div><div className="text-[15px] font-extrabold tabular-nums">{v}</div></div>
          ))}
        </div>
      )}
      <Async q={q} label="Loading invoices…" rows={5}>
        {() => rows.length === 0 ? <Empty title="No invoices in this range" hint="Bills are raised from a booking's Take payment button or from the guest's record." /> : (
          <DataTable cols={["Invoice no", "Receipt no", "Date", "Customer", "Sale items (qty)", "Amount", "Due", "Status", "Source", ""]}
            onRow={(i) => setSel(rows[i]._id)}
            rows={rows.map((i) => [
              <span key="n" className="font-mono text-[11.5px] font-semibold">{i.invoiceNumber}</span>,
              <span key="r" className="font-mono text-[11px] text-ink3">{i.receiptNumber ?? "—"}</span>,
              fmtWhen(i.closedAt || i.issuedAt),
              <span key="c"><B>{i.guest?.name ?? "—"}</B>{i.guest?.phone ? <span className="ml-1 text-[11px] text-ink3">{i.guest.phone}</span> : null}</span>,
              <span key="i" className="text-[11.5px]">{i.lines.map((l) => `${l.name} (${l.qty})`).join(", ") || "—"}</span>,
              <span key="a" className="tabular-nums">{fmtINR(i.totals.total)}</span>,
              <span key="d" className={`tabular-nums ${i.totals.due > 0 && i.status !== "void" ? "font-bold text-err" : ""}`}>{fmtINR(i.status === "void" ? 0 : i.totals.due)}</span>,
              kindOf(i),
              i.source === "zenoti" ? "Zenoti" : i.source === "app" ? "App" : "Desk",
              <button key="o" className="text-[11.5px] font-semibold text-primary underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setSel(i._id); }}>Show</button>,
            ])} />
        )}
      </Async>
      <InvoiceModal open={!!sel} invoiceId={sel} onClose={() => setSel(null)} onChanged={q.reload} />
      {!can("billing.manage") && !can("bookings.manage") && <Note className="mt-3">You can view bills but not take payments — ask for the "Raise invoices, take payments" permission.</Note>}
    </Page>
  );
}

export const __billingInternals = { useMemo };
