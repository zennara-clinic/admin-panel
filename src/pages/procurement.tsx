/**
 * Purchase orders and goods receipt.
 *
 * The flow the clinic asked for, in one screen:
 *   create → raise → approve → order → receive (part or full)
 *
 * Receiving is deliberately its own modal rather than an editable field on the
 * row: booking a delivery in raises stock and writes the ledger, so it should
 * feel like an action being taken, not a number being corrected.
 */
import { useMemo, useState } from "react";
import {
  Page, Btn, Tag, Card, DataTable, B, Note, In, Sel, Area, Modal, Async, Empty, SecH,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { fmtDate, fmtINR } from "../lib/format";
import type { Id, PurchaseOrder, PurchaseOrderStatus, Vendor, Branch } from "../lib/types";

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  raised: "Raised",
  approved: "Approved",
  ordered: "Ordered",
  partially_received: "Partly received",
  fully_received: "Received",
  cancelled: "Cancelled",
};

const STATUS_TAG: Record<PurchaseOrderStatus, "mute" | "info" | "gold" | "ok" | "warn" | "err"> = {
  draft: "mute",
  raised: "info",
  approved: "gold",
  ordered: "info",
  partially_received: "warn",
  fully_received: "ok",
  cancelled: "err",
};

/** Mirrors TRANSITIONS in the backend controller, which is the real authority. */
const NEXT: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ["raised", "cancelled"],
  raised: ["approved", "draft", "cancelled"],
  approved: ["ordered", "cancelled"],
  ordered: ["cancelled"],
  partially_received: ["cancelled"],
  fully_received: [],
  cancelled: [],
};

type DraftLine = { name: string; sku: string; requestedQuantity: string; unitCost: string; taxPercent: string };

const EMPTY_LINE: DraftLine = { name: "", sku: "", requestedQuantity: "", unitCost: "", taxPercent: "" };

export function PurchaseOrders() {
  const { toast, can } = useStore();
  const [status, setStatus] = useState("All");
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const [sel, setSel] = useState<PurchaseOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveFor, setReceiveFor] = useState<PurchaseOrder | null>(null);
  const [nonce, setNonce] = useState(0);

  const list = useApi(
    () => api.purchaseOrders
      .list({
        ...(status !== "All" ? { status: Object.keys(STATUS_LABEL).find((k) => STATUS_LABEL[k as PurchaseOrderStatus] === status) } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        limit: 200,
      })
      .then((r) => r.data ?? []),
    [status, search, nonce],
  );

  const reload = () => setNonce((n) => n + 1);

  const move = async (po: PurchaseOrder, next: PurchaseOrderStatus) => {
    try {
      await api.purchaseOrders.setStatus(po._id, next);
      toast(`Order ${STATUS_LABEL[next].toLowerCase()}`);
      setSel(null);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const rows = (list.data ?? []).map((po) => [
    <B key="n">{po.poNumber}</B>,
    po.vendorName || "—",
    po.branchName || "—",
    <span key="q" className="tabular-nums">
      {po.totals?.received ?? 0}/{po.totals?.requested ?? 0}
      {(po.totals?.pending ?? 0) > 0 && <span className="ml-1 text-ink3">({po.totals?.pending} pending)</span>}
    </span>,
    po.expectedDeliveryDate ? fmtDate(po.expectedDeliveryDate) : "—",
    <Tag key="s" kind={STATUS_TAG[po.status]}>{STATUS_LABEL[po.status]}</Tag>,
  ]);

  return (
    <Page title="Purchase orders" sub="Raise an order, approve it, then book the delivery in — receiving is what raises stock."
      actions={can("purchaseOrders.manage")
        ? <Btn kind="gold" onClick={() => setCreateOpen(true)}>New purchase order</Btn>
        : undefined}>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <In label="Search" value={q} onChange={setQ} placeholder="PO number, vendor or item" />
        </div>
        <Sel label="Status" value={status} onChange={setStatus}
          options={["All", ...Object.values(STATUS_LABEL)]} />
      </div>

      <Async q={list} label="Loading purchase orders…" rows={5}>
        {(orders) => orders.length === 0
          ? <Empty title="No purchase orders yet" hint="Raise one to start tracking what has been ordered and what is still owed." />
          : (
            <DataTable
              cols={["PO number", "Vendor", "Branch", "Received", "Expected", "Status"]}
              rows={rows}
              onRow={(i) => setSel(orders[i])}
            />
          )}
      </Async>

      {/* ---- detail ---- */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.poNumber} · ${sel.vendorName ?? ""}` : ""} wide>
        {sel && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Tag kind={STATUS_TAG[sel.status]}>{STATUS_LABEL[sel.status]}</Tag>
              {sel.branchName && <span className="text-[12px] text-ink3">{sel.branchName}</span>}
              {sel.expectedDeliveryDate && <span className="text-[12px] text-ink3">Expected {fmtDate(sel.expectedDeliveryDate)}</span>}
              {sel.createdByName && <span className="text-[12px] text-ink3">Raised by {sel.createdByName}</span>}
              {sel.approvedByName && <span className="text-[12px] text-ink3">Approved by {sel.approvedByName}</span>}
            </div>

            <SecH t="Items" em={`· ${sel.lines.length}`} />
            <div className="mb-3 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink3">
                    <th className="py-1.5">Item</th><th>Ordered</th><th>Received</th><th>Pending</th><th>Rejected</th><th>Unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.lines.map((l) => (
                    <tr key={String(l._id)} className="border-b border-border last:border-0">
                      <td className="py-1.5">{l.name}{l.sku ? <span className="text-ink3"> · {l.sku}</span> : ""}</td>
                      <td className="tabular-nums">{l.requestedQuantity}</td>
                      <td className="tabular-nums">{l.receivedQuantity}</td>
                      <td className="tabular-nums">{Math.max(0, l.requestedQuantity - l.receivedQuantity)}</td>
                      <td className="tabular-nums">{l.rejectedQuantity || 0}</td>
                      <td className="tabular-nums">{l.unitCost ? fmtINR(l.unitCost) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sel.notes && <Note className="text-[12px]">{sel.notes}</Note>}

            {(sel.statusHistory ?? []).length > 0 && (
              <>
                <SecH t="History" />
                <div className="mb-3 text-[11.5px] text-ink3">
                  {(sel.statusHistory ?? []).slice(-8).reverse().map((h, i) => (
                    <div key={i}>{fmtDate(h.at)} · {STATUS_LABEL[h.status as PurchaseOrderStatus] ?? h.status}{h.byName ? ` · ${h.byName}` : ""}{h.note ? ` — ${h.note}` : ""}</div>
                  ))}
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {["approved", "ordered", "partially_received"].includes(sel.status) && can("inventory.receive") && (
                <Btn kind="gold" onClick={() => { setReceiveFor(sel); setSel(null); }}>Receive goods</Btn>
              )}
              {NEXT[sel.status].map((next) => (
                <Btn key={next}
                  kind={next === "cancelled" ? "danger" : "ghost"}
                  disabled={next === "approved" ? !can("purchaseOrders.approve") && !can("purchaseOrders.manage") : !can("purchaseOrders.manage")}
                  onClick={() => move(sel, next)}>
                  {next === "cancelled" ? "Cancel order" : `Mark ${STATUS_LABEL[next].toLowerCase()}`}
                </Btn>
              ))}
            </div>
          </>
        )}
      </Modal>

      <CreatePO open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); reload(); }} />
      <ReceiveGoods po={receiveFor} onClose={() => setReceiveFor(null)} onDone={() => { setReceiveFor(null); reload(); }} />
    </Page>
  );
}

/** New purchase order — vendor, branch, and the items being ordered. */
function CreatePO({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useStore();
  const [vendorId, setVendorId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const vendors = useApi(() => api.vendors.list(), [open]);
  const branches = useApi(() => api.branches.list(), [open]);

  const vendorOptions = useMemo(
    () => ["Select a vendor", ...((vendors.data ?? []) as Vendor[]).map((v) => v.name)],
    [vendors.data],
  );
  const branchOptions = useMemo(
    () => ["All / not yet decided", ...((branches.data ?? []) as Branch[]).map((b) => b.name)],
    [branches.data],
  );

  const setLine = (i: number, key: keyof DraftLine) => (v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [key]: v } : l)));

  const submit = async () => {
    setErr(null);
    const vendor = ((vendors.data ?? []) as Vendor[]).find((v) => v.name === vendorId);
    if (!vendor) { setErr("Choose a vendor."); return; }
    const branch = ((branches.data ?? []) as Branch[]).find((b) => b.name === branchId);
    const clean = lines
      .filter((l) => l.name.trim() && Number(l.requestedQuantity) > 0)
      .map((l) => ({
        name: l.name.trim(),
        sku: l.sku.trim(),
        requestedQuantity: Number(l.requestedQuantity),
        unitCost: Number(l.unitCost) || 0,
        taxPercent: Number(l.taxPercent) || 0,
      }));
    if (!clean.length) { setErr("Add at least one item with a quantity."); return; }

    setBusy(true);
    try {
      await api.purchaseOrders.create({
        vendorId: vendor._id as Id,
        branchId: (branch?._id as Id) ?? null,
        expectedDeliveryDate: expected || null,
        notes,
        lines: clean,
      });
      toast("Purchase order created as a draft");
      setVendorId(""); setBranchId(""); setExpected(""); setNotes(""); setLines([{ ...EMPTY_LINE }]);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase order" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Sel label="Vendor" value={vendorId || "Select a vendor"} onChange={(v) => setVendorId(v === "Select a vendor" ? "" : v)} options={vendorOptions} />
        <Sel label="Receive into branch" value={branchId || "All / not yet decided"} onChange={(v) => setBranchId(v.startsWith("All /") ? "" : v)} options={branchOptions} />
        <In label="Expected delivery" type="date" value={expected} onChange={setExpected} />
      </div>

      <SecH t="Items" />
      {lines.map((l, i) => (
        <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
          <In label={i === 0 ? "Item" : ""} value={l.name} onChange={setLine(i, "name")} placeholder="Product or consumable" />
          <In label={i === 0 ? "SKU" : ""} value={l.sku} onChange={setLine(i, "sku")} />
          <In label={i === 0 ? "Qty" : ""} type="number" value={l.requestedQuantity} onChange={setLine(i, "requestedQuantity")} />
          <In label={i === 0 ? "Unit cost" : ""} type="number" value={l.unitCost} onChange={setLine(i, "unitCost")} />
          <In label={i === 0 ? "Tax %" : ""} type="number" value={l.taxPercent} onChange={setLine(i, "taxPercent")} />
          <button className="self-end pb-2 text-[16px] font-bold text-err"
            onClick={() => setLines((ls) => (ls.length === 1 ? [{ ...EMPTY_LINE }] : ls.filter((_, j) => j !== i)))}>×</button>
        </div>
      ))}
      <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]" onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>Add another item</Btn>

      <div className="mt-3">
        <Area label="Notes" value={notes} rows={2} onChange={setNotes} />
      </div>

      {err && <Note kind="crit" className="mt-2 text-[12px]">{err}</Note>}
      <Note className="mt-2 text-[11.5px]">
        The order is created as a <B>draft</B>. Raise it, have it approved, then book the delivery in —
        stock only moves when goods are received.
      </Note>

      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="gold" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create draft"}</Btn>
      </div>
    </Modal>
  );
}

/**
 * Book a delivery in.
 *
 * Quantities default to what is still outstanding, because a full delivery is
 * the common case and re-typing every number invites a typo.
 */
function ReceiveGoods({ po, onClose, onDone }: { po: PurchaseOrder | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useStore();
  const [entries, setEntries] = useState<Record<string, { qty: string; rejected: string; batch: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const key = po?._id ?? "";
  const state = useMemo(() => {
    if (!po) return {};
    const next: typeof entries = {};
    for (const l of po.lines) {
      next[String(l._id)] = {
        qty: String(Math.max(0, l.requestedQuantity - l.receivedQuantity)),
        rejected: "", batch: "", reason: "",
      };
    }
    return next;
    // Rebuilt whenever a different order is opened.
  }, [key]);

  // Seed the form the first time this order is shown.
  const values = Object.keys(entries).length && po && Object.keys(state).every((k) => k in entries) ? entries : state;

  const set = (lineId: string, field: "qty" | "rejected" | "batch" | "reason") => (v: string) =>
    setEntries({ ...values, [lineId]: { ...values[lineId], [field]: v } });

  const submit = async () => {
    if (!po) return;
    setErr(null);
    const receipts = po.lines
      .map((l) => {
        const e = values[String(l._id)];
        return {
          lineId: l._id,
          quantity: Number(e?.qty) || 0,
          rejectedQuantity: Number(e?.rejected) || 0,
          rejectionReason: e?.reason || "",
          batchNo: e?.batch || "",
        };
      })
      .filter((r) => r.quantity > 0 || r.rejectedQuantity > 0);

    if (!receipts.length) { setErr("Enter what actually arrived."); return; }

    setBusy(true);
    try {
      const res = await api.purchaseOrders.receive(po._id, receipts);
      const warnings = (res as { warnings?: { name: string; overDelivery: number }[] }).warnings;
      toast(warnings?.length
        ? `Delivery recorded — ${warnings.map((w) => `${w.name} over by ${w.overDelivery}`).join(", ")}`
        : "Delivery recorded and stock updated");
      setEntries({});
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!po} onClose={onClose} title={po ? `Receive goods — ${po.poNumber}` : ""} wide>
      {po && (
        <>
          <Note className="text-[11.5px]">
            Received quantities are added to <B>{po.branchName || "the branch"}</B> straight away and written to the
            stock ledger. Rejected items are recorded but <B>not</B> added to stock.
          </Note>

          {po.lines.map((l) => {
            const id = String(l._id);
            const outstanding = Math.max(0, l.requestedQuantity - l.receivedQuantity);
            return (
              <div key={id} className="mb-3 rounded-xl border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <B>{l.name}</B>
                  <span className="text-[11.5px] text-ink3">{outstanding} of {l.requestedQuantity} outstanding</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <In label="Received" type="number" value={values[id]?.qty ?? ""} onChange={set(id, "qty")} />
                  <In label="Rejected" type="number" value={values[id]?.rejected ?? ""} onChange={set(id, "rejected")} />
                  <In label="Batch no." value={values[id]?.batch ?? ""} onChange={set(id, "batch")} />
                  <In label="Rejection reason" value={values[id]?.reason ?? ""} onChange={set(id, "reason")} />
                </div>
              </div>
            );
          })}

          {err && <Note kind="crit" className="text-[12px]">{err}</Note>}
          <div className="flex justify-end gap-2">
            <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
            <Btn kind="gold" disabled={busy} onClick={submit}>{busy ? "Recording…" : "Record delivery"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}
