import { useEffect, useMemo, useState } from "react";
import { Btn, Tag, Modal, Note, In, Sel, Area, B, Page, DataTable, Async, Tabs, Empty, SecH, exportCsv, HBars, Card } from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { fmtINR, fmtCompactINR, fmtDate, fmtWhen } from "../lib/format";
import type { CurrentStockRow, StockSummary, StockCount, StockTransfer, StockValuation, StockImportResult } from "../lib/types";

/* ------------------------------------------------------------------------- *
 * Stock control — Zenoti's Inventory module beyond the item list:
 *   Current stock  per centre, valued three ways (Avg · Configured · Last procured), export, last reconcile date
 *   Audits         count sheets: expected vs counted → variance → reconcile writes the shelf
 *   Transfers      stock moved between centres (send → receive), transfer returns
 *   Valuation      stock value per centre / category and the audit-to-audit trend
 * ------------------------------------------------------------------------- */

const errMsg = (e: unknown) => (e as Error)?.message || "Something went wrong";
const BASES = [["avg", "Average value"], ["configured", "Configured value"], ["lastProcured", "Last procured value"]] as const;

export function StockControl() {
  const [tab, setTab] = useState(0);
  return (
    <Page title="Stock control" sub="Current stock by centre with valuation, audits that reconcile the shelf, transfers between centres.">
      <Tabs active={tab} onChange={setTab} items={[["Current stock"], ["Audits"], ["Transfers"], ["Valuation"], ["Import from Zenoti"]]} />
      {tab === 0 && <CurrentStock />}
      {tab === 1 && <Audits />}
      {tab === 2 && <Transfers />}
      {tab === 3 && <Valuation />}
      {tab === 4 && <ZenotiStockImport />}
    </Page>
  );
}

/* ------------------------------ current stock ------------------------------ */

function useBranchChoice() {
  const { branches, branchId } = useStore();
  const [sel, setSel] = useState<string>(branchId || "all");
  useEffect(() => { if (branchId) setSel(branchId); }, [branchId]);
  const options = [["all", "All centres"], ...branches.map((b) => [b._id, b.name] as [string, string]), ["none", "Not assigned to a centre"]] as [string, string][];
  const label = options.find((o) => o[0] === sel)?.[1] ?? "All centres";
  const set = (lbl: string) => setSel(options.find((o) => o[1] === lbl)?.[0] ?? "all");
  return { sel, label, options, set, branches };
}

function CurrentStock() {
  const { can, toast } = useStore();
  const bc = useBranchChoice();
  const [category, setCategory] = useState("All");
  const [basis, setBasis] = useState<(typeof BASES)[number][0]>("avg");
  const [inStock, setInStock] = useState(true);
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const [adj, setAdj] = useState<CurrentStockRow | null>(null);
  const q = useApi(() => api.stockControl.current({ branchId: bc.sel, category, basis, inStock: inStock ? "true" : undefined, search: dq || undefined }), [bc.sel, category, basis, inStock, dq]);
  const rows = (q.data?.data ?? []) as CurrentStockRow[];
  const totals = q.data?.totals as StockSummary | undefined;
  const last = q.data?.lastReconcile;
  const v = (r: CurrentStockRow) => (basis === "configured" ? r.configured : basis === "lastProcured" ? r.lastProcured : r.avg);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Sel label="Centre" value={bc.label} onChange={bc.set} options={bc.options.map((o) => o[1])} />
        <Sel label="Category" value={category} onChange={setCategory} options={["All", "Retail products", "Consumables"]} />
        <Sel label="Valuation" value={BASES.find((b) => b[0] === basis)?.[1] ?? "Average value"} onChange={(l) => setBasis(BASES.find((b) => b[1] === l)?.[0] ?? "avg")} options={BASES.map((b) => b[1])} />
        <label className="flex items-center gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> Current stock greater than 0</label>
        <div className="min-w-[220px] flex-1"><In label="Search" value={search} onChange={setSearch} placeholder="Product name, code, batch, vendor" /></div>
        <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv(`current-stock-${bc.label.replace(/\s+/g, "-").toLowerCase()}`, ["Code", "Product", "Category", "Unit", "Batch", "Expiry", "Vendor", "Centre", "On hand", "Avg unit", "Avg stock cost", "Tax", "Configured unit", "Configured cost", "Last procured unit", "Last procured cost", "Re-order level"],
          rows.map((r) => [r.code ?? "", r.name, r.category, r.unit ?? "", r.batchNo ?? "", r.expiryDate ? fmtDate(r.expiryDate) : "", r.vendor ?? "", r.branch ?? "", r.onHand, r.avg.unit, r.avg.cost, r.avg.tax ?? 0, r.configured.unit, r.configured.cost, r.lastProcured.unit, r.lastProcured.cost, r.reOrderLevel]))}>Export</Btn>
      </div>
      {totals && (
        <div className="mb-3 grid gap-2 sm:grid-cols-5">
          {[["Items", `${totals.items}`, `${totals.inStock} in stock`], ["On hand", totals.onHand.toLocaleString("en-IN"), "units"], ["Stock cost", fmtCompactINR(totals.cost), BASES.find((b) => b[0] === basis)?.[1]], ["Tax in stock", fmtCompactINR(totals.tax), "GST on cost"], ["Configured value", fmtCompactINR(totals.configured), "at selling price"]].map(([k, val, sub]) => (
            <div key={k} className="rounded-xl border border-border bg-ivory px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{k}</div><div className="text-[15px] font-extrabold tabular-nums">{val}</div><div className="text-[10.5px] text-ink3">{sub}</div></div>
          ))}
        </div>
      )}
      <div className="mb-2 text-[11.5px] text-ink3">Last reconcile date: <B>{last ? `${fmtWhen(last.at)} (${last.ref})` : "never"}</B>{can("inventory.manage") ? " · click a row to adjust its quantity with a reason." : ""}</div>
      <Async q={q} label="Counting the shelves…" rows={5}>
        {() => rows.length === 0 ? <Empty title="No stock rows match" hint={inStock ? "Untick “greater than 0” to see items with nothing on hand." : "Add items from Inventory, receive a purchase order, or transfer stock in."} /> : (
          <DataTable cols={["Code", "Product", "Unit", "Vendor", "Centre", "On-hand qty", `${BASES.find((b) => b[0] === basis)?.[1]} (unit · stock cost · tax)`, "Configured (unit · cost)", "Last procured (unit · cost)"]}
            onRow={(i) => can("inventory.manage") && setAdj(rows[i])}
            rows={rows.map((r) => [
              <span key="c" className="font-mono text-[11px]">{r.code ?? "—"}</span>,
              <span key="n"><B>{r.name}</B>{r.batchNo ? <span className="ml-1 text-[10.5px] text-ink3">B.No {r.batchNo}</span> : null}{r.expiryDate ? <span className="ml-1 text-[10.5px] text-ink3">exp {fmtDate(r.expiryDate)}</span> : null}<div className="text-[10.5px] text-ink3">{r.category}</div></span>,
              r.unit ?? "—",
              r.vendor ?? "—",
              r.branch ?? <span className="text-ink3">—</span>,
              <span key="q" className={`tabular-nums font-bold ${r.onHand <= 0 ? "text-err" : r.onHand <= (r.reOrderLevel || 0) ? "text-warn" : ""}`}>{r.onHand.toLocaleString("en-IN")}</span>,
              <span key="v" className="tabular-nums">{fmtINR(v(r).unit)} · <B>{fmtINR(v(r).cost)}</B>{basis === "avg" ? <span className="text-ink3"> · {fmtINR(r.avg.tax ?? 0)}</span> : null}</span>,
              <span key="cf" className="tabular-nums text-ink2">{fmtINR(r.configured.unit)} · {fmtINR(r.configured.cost)}</span>,
              <span key="lp" className="tabular-nums text-ink2">{r.lastProcured.unit ? `${fmtINR(r.lastProcured.unit)} · ${fmtINR(r.lastProcured.cost)}` : "—"}{r.lastProcured.at ? <div className="text-[10px] text-ink3">{fmtDate(r.lastProcured.at)}</div> : null}</span>,
            ])} />
        )}
      </Async>
      {totals && rows.length > 0 && <div className="mt-2 flex flex-wrap justify-end gap-4 text-[12px]"><span>On-hand <B>{totals.onHand.toLocaleString("en-IN")}</B></span><span>Stock cost <B>{fmtINR(totals.cost)}</B></span><span>Tax <B>{fmtINR(totals.tax)}</B></span><span>Configured <B>{fmtINR(totals.configured)}</B></span></div>}
      <AdjustModal row={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); q.reload(); toast("Quantity adjusted"); }} />
    </>
  );
}

function AdjustModal({ row, onClose, onDone }: { row: CurrentStockRow | null; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (row) { setQty(String(row.onHand)); setReason(""); setErr(null); } }, [row?._id]);
  if (!row) return null;
  return (
    <Modal open onClose={onClose} title={`Adjust · ${row.name}`}>
      <div className="text-[12.5px] text-ink2">On hand now <B>{row.onHand}</B>{row.branch ? ` at ${row.branch}` : ""}. Enter the correct quantity and why — the change is written to the stock ledger.</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <In label="New quantity" type="number" value={qty} onChange={setQty} />
        <In label="Reason" value={reason} onChange={setReason} placeholder="e.g. Damaged, found in store room" />
      </div>
      {err && <Note kind="crit" className="mt-2">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={busy || reason.trim().length < 3 || qty === ""} onClick={async () => { setBusy(true); setErr(null); try { await api.stockControl.adjust({ inventoryId: row._id, newQty: Number(qty), reason: reason.trim() }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>Save adjustment</Btn></div>
    </Modal>
  );
}

/* ------------------------------ audits ------------------------------ */

function Audits() {
  const { can, toast } = useStore();
  const bc = useBranchChoice();
  const [status, setStatus] = useState("all");
  const [openNew, setOpenNew] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const q = useApi(() => api.stockControl.counts({ branchId: bc.sel === "all" || bc.sel === "none" ? undefined : bc.sel, status }), [bc.sel, status]);
  const rows = q.data ?? [];
  const tag = (s: StockCount["status"]) => <Tag kind={s === "reconciled" ? "ok" : s === "submitted" ? "info" : s === "open" ? "gold" : "mute"}>{s}</Tag>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Sel label="Centre" value={bc.label} onChange={bc.set} options={bc.options.map((o) => o[1])} />
        <Sel label="Status" value={status} onChange={setStatus} options={["all", "open", "submitted", "reconciled", "cancelled"]} />
        <div className="ml-auto">{(can("inventory.count") || can("inventory.manage")) && <Btn onClick={() => setOpenNew(true)}>New audit</Btn>}</div>
      </div>
      <Note className="mb-3">An audit freezes today's expected quantities, staff type what they counted, and a manager reconciles — every difference becomes a ledger row that sets the shelf to the counted figure. Zenoti calls this Audit → Reconcile.</Note>
      <Async q={q} label="Loading audits…" rows={4}>
        {() => rows.length === 0 ? <Empty title="No audits yet" hint="Start one for a centre (optionally one category) and hand the count sheet to the floor." /> : (
          <DataTable cols={["Ref", "Title", "Centre", "Lines", "Counted", "Variance (qty · value)", "Stock value (before → after)", "Status", "When"]}
            onRow={(i) => setSel(rows[i]._id)}
            rows={rows.map((c) => [
              <span key="r" className="font-mono text-[11.5px] font-semibold">{c.ref}</span>, c.title, c.branchName, String(c.totals.items), `${c.totals.counted}/${c.totals.items}`,
              <span key="v" className={`tabular-nums ${c.totals.varianceValue < 0 ? "text-err" : c.totals.varianceValue > 0 ? "text-ok" : ""}`}>{c.totals.varianceQty >= 0 ? "+" : ""}{c.totals.varianceQty} · {fmtINR(c.totals.varianceValue)}</span>,
              <span key="s" className="tabular-nums">{fmtCompactINR(c.totals.stockValueBefore)}{c.totals.stockValueAfter !== null && c.totals.stockValueAfter !== undefined ? ` → ${fmtCompactINR(c.totals.stockValueAfter)}` : ""}</span>,
              tag(c.status), fmtWhen(c.reconciledAt || c.submittedAt || c.createdAt),
            ])} />
        )}
      </Async>
      <NewAuditModal open={openNew} onClose={() => setOpenNew(false)} onCreated={(id) => { setOpenNew(false); q.reload(); setSel(id); }} />
      <AuditSheet id={sel} onClose={() => setSel(null)} onChanged={() => { q.reload(); }} />
    </>
  );
}

function NewAuditModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const bc = useBranchChoice();
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Open a count sheet">
      <div className="grid gap-3">
        <Sel label="Centre" value={bc.label} onChange={bc.set} options={bc.options.map((o) => o[1])} />
        <Sel label="Category" value={category} onChange={setCategory} options={["All", "Retail products", "Consumables"]} />
        <In label="Only items matching (optional)" value={search} onChange={setSearch} placeholder="e.g. ZENCON, a vendor, a brand" />
        <In label="Title (optional)" value={title} onChange={setTitle} placeholder="e.g. Retail audit 6 Sep" />
        <Note className="my-0">Expected quantities are frozen when the sheet opens. Sales after that are still deducted from the shelf; reconcile adjusts against the shelf as it is then.</Note>
        {err && <Note kind="crit">{err}</Note>}
        <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { const r = await api.stockControl.createCount({ branchId: bc.sel as string, category, search: search || undefined, title: title || undefined }); onCreated((r.data as StockCount)._id); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>{busy ? "Opening…" : "Open sheet"}</Btn></div>
      </div>
    </Modal>
  );
}

function AuditSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { can, toast } = useStore();
  const q = useApi(() => (id ? api.stockControl.count(id) : Promise.resolve(null as unknown as StockCount)), [id]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = q.data;
  useEffect(() => { if (c) { const d: Record<string, string> = {}; const n: Record<string, string> = {}; for (const l of c.lines ?? []) { d[l._id] = l.counted === null || l.counted === undefined ? "" : String(l.counted); n[l._id] = l.note || ""; } setDraft(d); setNotes(n); setErr(null); } }, [c?._id, c?.status]);
  if (!id) return null;
  const editable = !!c && c.status === "open" && (can("inventory.count") || can("inventory.manage"));
  const lines = (c?.lines ?? []).filter((l) => (!filter || `${l.name} ${l.code ?? ""} ${l.batchNo ?? ""}`.toLowerCase().includes(filter.toLowerCase())) && (!onlyUncounted || draft[l._id] === "" || draft[l._id] === undefined));
  const dirty = !!c && (c.lines ?? []).some((l) => (draft[l._id] ?? "") !== (l.counted === null || l.counted === undefined ? "" : String(l.counted)) || (notes[l._id] ?? "") !== (l.note || ""));
  const save = async () => {
    if (!c) return false; setBusy(true); setErr(null);
    try { await api.stockControl.updateCount(c._id, { lines: (c.lines ?? []).map((l) => ({ lineId: l._id, counted: draft[l._id] === "" || draft[l._id] === undefined ? null : Number(draft[l._id]), note: notes[l._id] ?? "" })) }); q.reload(); onChanged(); return true; } catch (e) { setErr(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const run = async (fn: () => Promise<{ message?: string }>, fallback: string) => { setBusy(true); setErr(null); try { const r = await fn(); toast(r.message || fallback); q.reload(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title={c ? `${c.ref} · ${c.title}` : "Audit"} xl>
      {!c ? <div className="py-6 text-center text-[12.5px] text-ink3">Loading…</div> : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink2">
            <span>{c.branchName}</span><Tag kind={c.status === "reconciled" ? "ok" : c.status === "submitted" ? "info" : c.status === "open" ? "gold" : "mute"}>{c.status}</Tag>
            <span>{c.totals.counted}/{c.totals.items} counted</span>
            <span className={c.totals.varianceValue < 0 ? "text-err" : c.totals.varianceValue > 0 ? "text-ok" : ""}>variance {c.totals.varianceQty >= 0 ? "+" : ""}{c.totals.varianceQty} units · {fmtINR(c.totals.varianceValue)}</span>
            <span className="text-ink3">short {c.totals.shortQty} · excess {c.totals.excessQty}</span>
            {c.reconciledAt && <span className="text-ink3">reconciled {fmtWhen(c.reconciledAt)} by {c.reconciledByName}</span>}
            <span className="ml-auto flex gap-2">
              <Btn kind="ghost" className="!py-1 !text-[11.5px]" onClick={() => exportCsv(`${c.ref}-count-sheet`, ["Code", "Product", "Batch", "Category", "Expected", "Counted", "Variance", "Unit cost", "Note"], (c.lines ?? []).map((l) => [l.code ?? "", l.name, l.batchNo ?? "", l.category ?? "", l.expected, l.counted ?? "", l.counted === null || l.counted === undefined ? "" : l.counted - l.expected, l.unitCost, l.note ?? ""]))}>Export sheet</Btn>
            </span>
          </div>
          <div className="my-2 flex flex-wrap items-center gap-3">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a line…" className="w-56 rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} /> Only uncounted</label>
            <span className="text-[11.5px] text-ink3">{lines.length} lines shown</span>
          </div>
          <div className="max-h-[52vh] overflow-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead className="sticky top-0 bg-ivory text-left text-[10.5px] font-bold uppercase tracking-wider text-ink3"><tr><th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5">Batch</th><th className="px-2 py-1.5 text-right">Expected</th><th className="px-2 py-1.5 text-right">Counted</th><th className="px-2 py-1.5 text-right">Variance</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5">Note</th>{c.status === "reconciled" && <th className="px-2 py-1.5 text-right">Applied</th>}</tr></thead>
              <tbody>
                {lines.map((l) => { const cv = draft[l._id] ?? ""; const counted = cv === "" ? null : Number(cv); const variance = counted === null ? null : counted - l.expected; return (
                  <tr key={l._id} className="border-t border-border/60">
                    <td className="px-2 py-1"><B>{l.name}</B>{l.code ? <span className="ml-1 font-mono text-[10.5px] text-ink3">{l.code}</span> : null}<div className="text-[10.5px] text-ink3">{l.category}{l.unit ? ` · ${l.unit}` : ""}</div></td>
                    <td className="px-2 py-1 font-mono text-[11px]">{l.batchNo ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.expected}</td>
                    <td className="px-2 py-1 text-right"><input disabled={!editable} value={cv} onChange={(e) => setDraft({ ...draft, [l._id]: e.target.value })} inputMode="numeric" className="w-20 rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12px] tabular-nums outline-none focus:border-gold-dark disabled:bg-ivory" /></td>
                    <td className={`px-2 py-1 text-right tabular-nums font-semibold ${variance === null ? "text-ink3" : variance < 0 ? "text-err" : variance > 0 ? "text-ok" : ""}`}>{variance === null ? "—" : `${variance > 0 ? "+" : ""}${variance}`}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink2">{variance === null ? "—" : fmtINR(variance * l.unitCost)}</td>
                    <td className="px-2 py-1"><input disabled={!editable} value={notes[l._id] ?? ""} onChange={(e) => setNotes({ ...notes, [l._id]: e.target.value })} placeholder={editable ? "why?" : ""} className="w-full min-w-[120px] rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] outline-none focus:border-gold-dark disabled:bg-ivory" /></td>
                    {c.status === "reconciled" && <td className="px-2 py-1 text-right tabular-nums">{l.applied === null || l.applied === undefined ? "—" : `${l.applied > 0 ? "+" : ""}${l.applied}`}{l.shelfAtReconcile !== null && l.shelfAtReconcile !== undefined ? <div className="text-[10px] text-ink3">shelf was {l.shelfAtReconcile}</div> : null}</td>}
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          {err && <Note kind="crit" className="mt-2">{err}</Note>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {editable && <Btn kind="ghost" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save counts"}</Btn>}
            {editable && <Btn disabled={busy} onClick={async () => { if (dirty && !(await save())) return; run(async () => { try { return await api.stockControl.submitCount(c._id); } catch (e) { const er = e as Error & { code?: string }; if (/uncounted/i.test(er.message) && window.confirm(`${er.message}\n\nSubmit anyway, treating uncounted lines as unchanged?`)) return api.stockControl.submitCount(c._id, true); throw e; } }, "Submitted"); }}>Submit count</Btn>}
            {["open", "submitted"].includes(c.status) && can("inventory.reconcile") && <Btn kind="gold" disabled={busy} onClick={async () => { if (dirty && editable && !(await save())) return; if (window.confirm(`Reconcile ${c.ref}? Every counted line will set the shelf to the counted figure and write a ledger row.`)) run(() => api.stockControl.reconcileCount(c._id), "Reconciled"); }}>Reconcile</Btn>}
            {["open", "submitted"].includes(c.status) && (can("inventory.count") || can("inventory.manage")) && <Btn kind="danger" disabled={busy} onClick={() => { const reason = window.prompt("Cancel this audit — reason?") || ""; if (reason.trim()) run(() => api.stockControl.cancelCount(c._id, reason.trim()), "Cancelled"); }}>Cancel audit</Btn>}
            <Btn kind="ghost" onClick={onClose}>Close</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------ transfers ------------------------------ */

function Transfers() {
  const { can, toast } = useStore();
  const bc = useBranchChoice();
  const [status, setStatus] = useState("all");
  const [openNew, setOpenNew] = useState(false);
  const [sel, setSel] = useState<StockTransfer | null>(null);
  const q = useApi(() => api.stockControl.transfers({ branchId: bc.sel === "all" || bc.sel === "none" ? undefined : bc.sel, status }), [bc.sel, status]);
  const rows = q.data ?? [];
  const canTransfer = can("inventory.transfer") || can("inventory.manage");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, fn: () => Promise<{ message?: string }>, fb: string) => { setBusy(id); try { const r = await fn(); toast(r.message || fb); q.reload(); setSel(null); } catch (e) { toast(errMsg(e)); } finally { setBusy(null); } };
  const tag = (s: StockTransfer["status"]) => <Tag kind={s === "received" ? "ok" : s === "sent" ? "info" : s === "draft" ? "gold" : "mute"}>{s === "received" ? "DELIVERED" : s.toUpperCase()}</Tag>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Sel label="Centre" value={bc.label} onChange={bc.set} options={bc.options.map((o) => o[1])} />
        <Sel label="Status" value={status} onChange={setStatus} options={["all", "draft", "sent", "received", "cancelled"]} />
        <div className="ml-auto">{canTransfer && <Btn onClick={() => setOpenNew(true)}>Add transfer</Btn>}</div>
      </div>
      <Async q={q} label="Loading transfers…" rows={4}>
        {() => rows.length === 0 ? <Empty title="No transfers" hint="Move stock from one centre's shelf to another. Sending deducts here; receiving adds there." /> : (
          <DataTable cols={["Ref", "Type", "From", "To", "Qty", "Value", "Status", "Sent", "Received", ""]}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((t) => [
              <span key="r" className="font-mono text-[11.5px] font-semibold">{t.ref}</span>, t.kind === "return" ? "Return" : "Transfer", t.fromBranchName, t.toBranchName, String(t.totals.qty), fmtINR(t.totals.value), tag(t.status), t.sentAt ? fmtWhen(t.sentAt) : "—", t.receivedAt ? fmtWhen(t.receivedAt) : "—",
              <span key="a" className="flex gap-2 text-[11.5px] font-semibold" onClick={(e) => e.stopPropagation()}>
                {canTransfer && t.status === "draft" && <button className="text-primary underline-offset-2 hover:underline" disabled={busy === t._id} onClick={() => act(t._id, () => api.stockControl.sendTransfer(t._id), "Sent")}>Send</button>}
                {canTransfer && t.status === "sent" && <button className="text-primary underline-offset-2 hover:underline" disabled={busy === t._id} onClick={() => act(t._id, () => api.stockControl.receiveTransfer(t._id), "Received")}>Receive</button>}
                {canTransfer && ["draft", "sent"].includes(t.status) && <button className="text-err underline-offset-2 hover:underline" disabled={busy === t._id} onClick={() => { const r = window.prompt(`Cancel ${t.ref}?${t.status === "sent" ? " Units go back on the sending shelf." : ""} Reason:`) || ""; if (r.trim()) act(t._id, () => api.stockControl.cancelTransfer(t._id, r.trim()), "Cancelled"); }}>Cancel</button>}
              </span>,
            ])} />
        )}
      </Async>
      <NewTransferModal open={openNew} onClose={() => setOpenNew(false)} onDone={() => { setOpenNew(false); q.reload(); }} />
      {sel && (
        <Modal open onClose={() => setSel(null)} title={`${sel.ref} · ${sel.fromBranchName} → ${sel.toBranchName}`} wide>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-ink2">{tag(sel.status)}<span>{sel.totals.qty} units · {fmtINR(sel.totals.value)}</span>{sel.createdByName && <span className="text-ink3">· by {sel.createdByName}</span>}{sel.notes && <span className="text-ink3">· {sel.notes}</span>}</div>
          <DataTable cols={["Product", "Batch", "Qty", "Received", "Unit cost", "Value"]} rows={sel.lines.map((l) => [<B key="n">{l.name}</B>, l.batchNo ?? "—", String(l.qty), l.receivedQty === null || l.receivedQty === undefined ? "—" : String(l.receivedQty), fmtINR(l.unitCost), fmtINR(l.qty * l.unitCost)])} />
        </Modal>
      )}
    </>
  );
}

function NewTransferModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { branches, toast } = useStore();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"transfer" | "return">("transfer");
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 250);
  const [picked, setPicked] = useState<{ row: CurrentStockRow; qty: number }[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setFrom(branches[0]?._id ?? ""); setTo(branches[1]?._id ?? ""); setPicked([]); setSearch(""); setNotes(""); setErr(null); } }, [open, branches.length]);
  const fromId = branches.find((b) => b.name === from)?._id ?? from;
  const toId = branches.find((b) => b.name === to)?._id ?? to;
  const stock = useApi(() => (open && fromId && dq.trim().length >= 2 ? api.stockControl.current({ branchId: fromId, search: dq, inStock: "true" }) : Promise.resolve(null)), [open, fromId, dq]);
  const nameOf = (id: string) => branches.find((b) => String(b._id) === String(id))?.name ?? "";
  const total = useMemo(() => picked.reduce((n, p) => n + p.qty * p.row.avg.unit, 0), [picked]);
  return (
    <Modal open={open} onClose={onClose} title="Add transfer between centres" wide>
      <div className="grid gap-3 md:grid-cols-3">
        <Sel label="From" value={nameOf(fromId)} onChange={(v) => setFrom(v)} options={branches.map((b) => b.name)} />
        <Sel label="To" value={nameOf(toId)} onChange={(v) => setTo(v)} options={branches.map((b) => b.name)} />
        <Sel label="Type" value={kind === "return" ? "Transfer return" : "Transfer"} onChange={(v) => setKind(v.includes("return") ? "return" : "transfer")} options={["Transfer", "Transfer return"]} />
      </div>
      <div className="mt-3"><In label={`Add items held at ${nameOf(fromId) || "the sending centre"}`} value={search} onChange={setSearch} placeholder="Type at least 2 letters of the product name or code" /></div>
      {dq.trim().length >= 2 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface">
          {((stock.data?.data ?? []) as CurrentStockRow[]).filter((r) => !picked.some((p) => p.row._id === r._id)).slice(0, 12).map((r) => (
            <button key={r._id} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] hover:bg-ivory" onClick={() => { setPicked([...picked, { row: r, qty: 1 }]); setSearch(""); }}>
              <span><B>{r.name}</B> <span className="text-ink3">{r.code ?? ""}{r.batchNo ? ` · B.No ${r.batchNo}` : ""}</span></span><span className="text-ink3">{r.onHand} on hand</span>
            </button>
          ))}
          {stock.data && ((stock.data.data ?? []) as CurrentStockRow[]).length === 0 && <div className="px-3 py-2 text-[12px] text-ink3">Nothing in stock matches at this centre. (Rows not yet tagged to a centre appear under “Not assigned”.)</div>}
        </div>
      )}
      {picked.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {picked.map((p, i) => (
            <div key={p.row._id} className="flex items-center gap-2 rounded-lg bg-ivory px-3 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate"><B>{p.row.name}</B> <span className="text-ink3">{p.row.onHand} on hand · {fmtINR(p.row.avg.unit)}/unit</span></span>
              <input type="number" min={1} max={p.row.onHand} value={p.qty} onChange={(e) => setPicked(picked.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.min(p.row.onHand, Number(e.target.value) || 1)) } : x)))} className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px]" />
              <button className="text-ink3 hover:text-err" onClick={() => setPicked(picked.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="text-right text-[12px]">Value <B>{fmtINR(total)}</B></div>
        </div>
      )}
      <div className="mt-2"><Area label="Notes" value={notes} onChange={setNotes} rows={2} /></div>
      {err && <Note kind="crit" className="mt-2">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        {(["draft", "send"] as const).map((mode) => (
          <Btn key={mode} kind={mode === "send" ? "gold" : "primary"} disabled={busy || !picked.length || !fromId || !toId || fromId === toId} onClick={async () => {
            setBusy(true); setErr(null);
            try { const r = await api.stockControl.createTransfer({ fromBranchId: fromId, toBranchId: toId, kind, lines: picked.map((p) => ({ inventoryId: p.row._id, qty: p.qty })), notes, send: mode === "send" }); toast(r.message || "Transfer created"); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
          }}>{mode === "send" ? "Create & send" : "Save draft"}</Btn>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------ valuation ------------------------------ */

function Valuation() {
  const bc = useBranchChoice();
  const q = useApi(() => api.stockControl.valuation({ branchId: bc.sel }), [bc.sel]);
  const d = q.data as StockValuation | undefined;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3"><Sel label="Centre" value={bc.label} onChange={bc.set} options={bc.options.map((o) => o[1])} /></div>
      <Async q={q} label="Valuing the stock…" rows={4}>
        {() => d ? (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              {[["Stock value (avg cost)", fmtINR(d.total.cost)], ["Tax in stock", fmtINR(d.total.tax)], ["At selling price", fmtINR(d.total.configured)], ["Units on hand", d.total.onHand.toLocaleString("en-IN")]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-ivory px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{k}</div><div className="text-[15px] font-extrabold tabular-nums">{v}</div></div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <SecH t="By centre" />
                <DataTable cols={["Centre", "Items", "In stock", "On hand", "Stock cost", "At selling price"]} rows={d.perBranch.map((b) => [<B key="b">{b.branch}</B>, String(b.items), String(b.inStock), b.onHand.toLocaleString("en-IN"), fmtINR(b.cost), fmtINR(b.configured)])} />
              </div>
              <div>
                <SecH t="By category" />
                <HBars rows={Object.entries(d.total.byCategory).map(([k, v]) => [k, v.cost, fmtCompactINR(v.cost)] as [string, number, string])} />
              </div>
            </div>
            <SecH t="Stock value at each audit" em="· Zenoti's Inventory dashboard" />
            {d.history.length === 0 ? <div className="text-[12px] text-ink3">No reconciled audits yet — the trend appears after the first reconcile.</div> : (
              <DataTable cols={["Audit", "Centre", "Reconciled", "Value before", "Value after", "Variance"]} rows={d.history.map((h) => [<span key="r" className="font-mono text-[11.5px]">{h.ref}</span>, h.branch, fmtWhen(h.at), fmtINR(h.before), h.after === null ? "—" : fmtINR(h.after), <span key="v" className={h.varianceValue < 0 ? "text-err" : "text-ok"}>{fmtINR(h.varianceValue)}</span>])} />
            )}
          </>
        ) : null}
      </Async>
    </>
  );
}


/* ------------------------------ Zenoti import ------------------------------ */

/**
 * Zenoti's inventory API is not open to our key (stock, adjustments, purchase
 * orders and transfers all answer 401), but the clinic already exports these
 * screens to Excel. Dropping either export in here brings the quantities,
 * batches, expiry dates, vendor and stock value onto this centre's shelf, and
 * writes a ledger row for every change.
 */
function ZenotiStockImport() {
  const { branches, toast, can } = useStore();
  const bc = useBranchChoice();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StockImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<StockImportResult | null>(null);
  const branchId = bc.sel && bc.sel !== "all" && bc.sel !== "none" ? bc.sel : "";
  const branchName = branches.find((b) => b._id === branchId)?.name ?? "";
  const canImport = can("inventory.reconcile") || can("inventory.manage");

  const run = async (commit: boolean) => {
    if (!branchId || !file) return;
    setBusy(true); setErr(null);
    try {
      if (commit) {
        const r = await api.stockControl.importCommit(branchId, file);
        setDone(r.data as StockImportResult); setPreview(null); toast(r.message || "Stock imported");
      } else setPreview(await api.stockControl.importPreview(branchId, file));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <SecH t="Import a Zenoti stock export" em="· Current stock or Audit inventory" />
        <Note className="mt-0">
          In Zenoti open <B>Inventory › Retail (or Consumable) › Current stock</B> — or <B>Audit inventory</B> if you want batch numbers and expiry dates — choose the centre, then <B>Export</B>. Upload that file here without editing its columns.
        </Note>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Sel label="Centre this export came from" value={bc.label} onChange={bc.set} options={bc.options.filter((o) => o[0] !== "all" && o[0] !== "none").map((o) => o[1])} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-[0.02em] text-ink2">Export file (.csv or .xlsx)</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); setErr(null); }}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] file:mr-2 file:rounded file:border-0 file:bg-ivory file:px-2 file:py-1 file:text-[12px]" />
          </label>
        </div>
        {err && <Note kind="crit" className="mt-3">{err}</Note>}
        <div className="mt-3 flex gap-2">
          <Btn kind="ghost" disabled={busy || !file || !branchId} onClick={() => run(false)}>{busy && !preview ? "Reading…" : "Check the file"}</Btn>
          <Btn kind="gold" disabled={busy || !preview || !canImport} onClick={() => run(true)}>Apply to {branchName || "the centre"}</Btn>
        </div>

        {preview && (
          <>
            <SecH t="What this will do" em={`· ${preview.rows} rows read`} />
            <div className="grid gap-2 sm:grid-cols-4">
              {[["Matched", String(preview.matched)], ["Not found here", String(preview.unmatched)], ["Quantities change", String(preview.changed)], ["Stock value after", fmtINR(preview.valueAfter)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-ivory px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{k}</div><div className="text-[15px] font-extrabold tabular-nums">{v}</div></div>
              ))}
            </div>
            {preview.samples.changes.length > 0 && (
              <DataTable cols={["Product", "Code", "On hand now", "After import", "Batch", "Expiry"]}
                rows={preview.samples.changes.map((c) => [<B key={c.name}>{c.name}</B>, c.code ?? "—", String(c.before), <B key={`${c.name}a`}>{String(c.after)}</B>, c.batchNo ?? "—", c.expiry ? fmtDate(c.expiry) : "—"])} />
            )}
            {preview.unmatched > 0 && (
              <Note kind="crit" className="mt-2">
                {preview.unmatched} row{preview.unmatched === 1 ? "" : "s"} did not match anything on this centre's shelf and will be skipped — check you picked the right centre, and that those products exist in Zenoti's product master (they arrive with the hourly sync). For example: {preview.samples.unmatched.slice(0, 4).join(", ")}.
              </Note>
            )}
          </>
        )}

        {done && (
          <>
            <SecH t="Imported" />
            <Note>{done.applied ?? 0} shelf rows updated{done.created ? `, ${done.created} created` : ""}{done.ledgerRows ? `, ${done.ledgerRows} ledger entries written` : ""}. Every quantity change is in the stock ledger with your name on it.</Note>
          </>
        )}
      </div>

      <div className="grid content-start gap-3">
        <Card className="p-3 text-[12.5px]">
          <SecH t="Why an import" />
          <p className="text-ink2">Zenoti's own inventory API refuses our key: stock, adjustments, purchase orders and transfers all answer <span className="font-mono">401</span>. Products, prices (MRP), vendors, invoices and appointments come through live; quantities do not.</p>
          <p className="mt-2 text-ink2">Two ways to close that gap: ask Zenoti to add the Inventory scope to our API key, after which this becomes automatic — or keep importing the export, which is what the clinic already produces each week.</p>
        </Card>
        <Card className="p-3 text-[12.5px]">
          <SecH t="Columns we read" />
          <p className="text-ink2">Code, Product, Unit, Vendor, Current On-Hand Qty, Value Considered / Avg. Value, Batch #, Expiry date, Notes. Column order does not matter and extra columns are ignored.</p>
        </Card>
      </div>
    </div>
  );
}
