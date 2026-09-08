import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IndianRupee, Package, RotateCw, Star, StickyNote, UserCheck, X, type LucideIcon } from "lucide-react";
import { LifecycleActions, LIFECYCLE_TOAST, useLifecycle } from "../lifecycle";
import { Btn, Tag, Modal, Note, In, Sel, Area, B, SecH, DataTable, Async } from "../ui";
import { useStore } from "../store";
import api, { type TodaysSales } from "../lib/api";
import { useApi, useMutation } from "../lib/useApi";
import {
  bookingProvider, bookingServiceName, bookingSlotDate, clinicHM, fmtAgo, fmtINR, fmtWhen, isConsultationBooking, statusKey,
} from "../lib/format";
import type { Booking, Consultation, DayBook, DayBookBlock, DayBookProvider } from "../lib/types";
import { InvoiceModal } from "./billing";

/* ------------------------------------------------------------------------- *
 * The desk day book, laid out the way Zenoti's appointment book is:
 * one ROW per dermatologist, time running left to right in 15-minute
 * columns, a red line at "now", grey outside the shift, a beige band on
 * leave, purple block-outs, and cards coloured by booking state that stack
 * into lanes when two guests share a slot. Hover for the details; click for
 * the quick card; right-click an empty cell to book or block that time.
 * ------------------------------------------------------------------------- */

const COL_MIN = 15;
const COL_W = 34;          // px per 15 minutes → 136 px per hour
const ROW_H = 44;          // px per lane
const LEFT_W = 172;

const toMin = (t: string) => { const m = t.match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hourFloor = (m: number) => Math.floor(m / 60) * 60;
const label12 = (m: number) => { const h = Math.floor(m / 60); const mm = m % 60; const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${ap}`; };

/** Colour per booking state — Zenoti's legend, in the panel's tokens. */
export const STATE_STYLE: Record<string, { bg: string; text: string; label: string; swatch: string }> = {
  pending:     { bg: "bg-[#f3d9f0]", text: "text-[#7a2a6e]", label: "New / awaiting", swatch: "#d63fa0" },
  confirmed:   { bg: "bg-ok-bg",     text: "text-ok",        label: "Confirmed",      swatch: "#b9e3b6" },
  late:        { bg: "bg-err-bg",    text: "text-err",       label: "Running late",   swatch: "#f2b8b5" },
  checkedin:   { bg: "bg-warn-bg",   text: "text-warn",      label: "Checked in",     swatch: "#f2d35b" },
  inprogress:  { bg: "bg-[#cfe9cf]", text: "text-[#1f5a2a]", label: "Started",        swatch: "#6fbf73" },
  completed:   { bg: "bg-[#f4c7c3]", text: "text-[#7a1f19]", label: "Completed / paid", swatch: "#e8746d" },
  rescheduled: { bg: "bg-[#fde3c4]", text: "text-[#7a4a12]", label: "Reschedule requested", swatch: "#f0a24a" },
  noshow:      { bg: "bg-dis-bg",    text: "text-dis",       label: "No-show",        swatch: "#c9c9c9" },
  cancelled:   { bg: "bg-dis-bg",    text: "text-dis line-through", label: "Cancelled", swatch: "#e3e3e3" },
  block:       { bg: "bg-[#ddd8f0]", text: "text-[#3b3270]", label: "Block-out",      swatch: "#9c7bd6" },
};

/** Card state: "checked in" is In Progress before the dermatologist has started. */
export function cardState(b: Booking): keyof typeof STATE_STYLE {
  const k = statusKey(b);
  if (k === "inprogress") return b.consultationStage && b.consultationStage !== "checked_in" && b.consultationStage !== "waiting" && b.consultationStage !== "confirmed" && b.consultationStage !== "booked" ? "inprogress" : "checkedin";
  return k as keyof typeof STATE_STYLE;
}

const durationOf = (b: Booking) => {
  const c = b.consultationId && typeof b.consultationId === "object" ? (b.consultationId as Consultation) : null;
  const d = Number(c?.duration_minutes);
  return d > 0 ? d : 60;
};

type Placed = { b: Booking; start: number; end: number; lane: number };

/** Greedy lane assignment: overlapping cards go to the next free lane. */
function layout(rows: Booking[]): { placed: Placed[]; lanes: number } {
  const items = rows
    .map((b) => { const d = bookingSlotDate(b); if (!d) return null; const start = toMin(clinicHM(d)); return { b, start, end: start + durationOf(b), lane: 0 }; })
    .filter(Boolean)
    .sort((a, b) => a!.start - b!.start || a!.end - b!.end) as Placed[];
  const laneEnds: number[] = [];
  for (const it of items) {
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = it.end;
    it.lane = lane;
  }
  return { placed: items, lanes: Math.max(1, laneEnds.length) };
}

/** Card badges. Real icons, never emoji — those render differently on every
 *  machine and carry no accessible name. */
function CardIcons({ b }: { b: Booking }) {
  const icons: { Icon: LucideIcon; title: string }[] = [];
  if (b.checkInTime) icons.push({ Icon: UserCheck, title: `Checked in ${fmtAgo(b.checkInTime)}` });
  if (b.paymentStatus === "paid" || b.zenotiInvoiceId) icons.push({ Icon: IndianRupee, title: b.paymentStatus === "paid" ? `Paid ${fmtINR(b.amount)}` : "Invoice open" });
  if (b.notes || b.adminNotes) icons.push({ Icon: StickyNote, title: "Has a note" });
  if (b.isPackageIncluded) icons.push({ Icon: Package, title: "Package session" });
  if (b.rescheduledAt || b.status === "Rescheduled") icons.push({ Icon: RotateCw, title: "Rescheduled" });
  const u = b.userId && typeof b.userId === "object" ? (b.userId as { memberType?: string }) : null;
  if (u?.memberType === "Zen Member") icons.push({ Icon: Star, title: "Zen member" });
  if (!icons.length) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 opacity-80">
      {icons.map(({ Icon, title }, k) => (
        <Icon key={k} size={11} strokeWidth={2.2} aria-label={title}>
          <title>{title}</title>
        </Icon>
      ))}
    </span>
  );
}

function tooltipText(b: Booking) {
  const d = bookingSlotDate(b);
  const lines = [
    `${b.status}${b.consultationStage ? ` · ${b.consultationStage.replace(/_/g, " ")}` : ""}`,
    `${b.fullName} ${b.mobileNumber || ""}`.trim(),
    bookingServiceName(b, "Service"),
    d ? `${label12(toMin(clinicHM(d)))} – ${label12(toMin(clinicHM(d)) + durationOf(b))}` : "",
    b.checkInTime ? `Check-in: ${fmtWhen(b.checkInTime)}` : "",
    b.zenotiSource?.receiptNumber ? `Receipt No: ${b.zenotiSource.receiptNumber}` : b.zenotiSource?.invoiceNumber ? `Invoice: ${b.zenotiSource.invoiceNumber}` : "",
    b.paymentStatus === "paid" ? `Paid ${fmtINR(b.amount)} · ${b.paymentMethod || ""}` : b.amount ? `${fmtINR(b.amount)} due` : "",
    `Created by: ${b.zenotiSource?.createdByName || (b.source === "app" ? "Guest (app)" : b.source === "zenoti" ? "Clinic (Zenoti)" : "Reception")}`,
    b.notes ? `Note: ${b.notes}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/* ------------------------------ quick card ------------------------------ */

function QuickCard({ b, anchor, onClose, onOpen, onChanged, onCheckIn, onCheckOut, onInvoice }: {
  b: Booking; anchor: { x: number; y: number }; onClose: () => void; onOpen: () => void; onChanged: () => void;
  onCheckIn: () => void; onCheckOut: () => void; onInvoice: () => void;
}) {
  const { toast, audit, can } = useStore();
  const nav = useNavigate();
  // Returns true so callers can tell success from failure — useMutation gives
  // back `undefined` on error, and LifecycleActions needs that distinction to
  // know whether to close its "why?" prompt.
  const act = useMutation(async (fn: () => Promise<unknown>, msg: string) => { await fn(); toast(msg); onChanged(); return true; });
  const state = cardState(b);
  const st = STATE_STYLE[state] ?? STATE_STYLE.pending;
  const canManage = can("bookings.manage");
  const d = bookingSlotDate(b);
  const idOf = (v: unknown) => (typeof v === "string" ? v : (v as { _id?: string })?._id ?? "");

  /*
   * The desk's actions come from the SERVER, not a list kept here.
   *
   * This card hand-rolled its own, and it had already drifted: no entry at all
   * for "Checked In", "Undo check-in" shown for a booking that was actually
   * In Progress (that undo is undo-start), and — since Zenoti's AA102 refusal
   * was honoured on 2026-09-08 — an "Undo check-out" that the backend no
   * longer accepts, so pressing it only produced an error. lifecycleState()
   * already answers exactly this question, honours the Zenoti-owned rules, and
   * is what the reception drawer uses.
   */
  const { state: lifecycleState, reload: reloadLifecycle } = useLifecycle(b._id);

  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div role="dialog" aria-label={`Appointment for ${b.fullName}`}
        className="fixed z-[81] w-[320px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        style={{
          left: Math.max(8, Math.min(anchor.x, window.innerWidth - 340)),
          top: Math.max(8, Math.min(anchor.y, window.innerHeight - 360)),
        }}>
        <div className="flex items-start gap-3 bg-side px-4 py-3 text-white">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-[12px] font-bold">{b.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold">{b.fullName}</div>
            <div className="text-[11.5px] opacity-80">{b.mobileNumber || "no phone"}{b.isPackageIncluded ? " · package" : ""}</div>
          </div>
          <button className="text-[11px] underline-offset-2 hover:underline" onClick={() => nav("/patient", { state: { id: idOf(b.userId) } })}>Profile</button>
        </div>
        <div className="grid gap-2 px-4 py-3 text-[12.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Service details</span>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${st.bg} ${st.text}`}>{st.label}</span>
          </div>
          <div><B>{bookingServiceName(b, "Service")}</B></div>
          <div className="text-ink2">{d ? `${label12(toMin(clinicHM(d)))} – ${label12(toMin(clinicHM(d)) + durationOf(b))}` : "time TBC"} <span className="text-ink3">|</span> {bookingProvider(b)}</div>
          {(b.notes || b.adminNotes) && <div className="rounded-lg bg-ivory px-2.5 py-1.5 text-[11.5px] text-ink2"><span className="text-[10px] font-bold uppercase tracking-wider text-ink3">Notes</span><br />{b.notes || b.adminNotes}</div>}
          {canManage && (
            <div className="grid gap-1.5">
              <LifecycleActions
                state={lifecycleState}
                busy={act.busy}
                canOverride={canManage}
                onRun={async (action, over) => {
                  const ok = await act.mutate(
                    () => api.bookings.lifecycle(b._id, { action, ...over })
                      .then(() => audit("BOOKING_UPDATED", `${b.fullName} · ${action}`, { bookingId: b._id })),
                    LIFECYCLE_TOAST[action],
                  );
                  await reloadLifecycle();
                  return Boolean(ok);
                }}
              />
            </div>
          )}
          {act.error && <Note kind="crit" className="my-0">{act.error}</Note>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {canManage && (b.status === "Confirmed" || b.status === "Rescheduled" || b.status === "No Show") && <Btn onClick={() => { onClose(); onCheckIn(); }}>Check in</Btn>}
            {canManage && b.status === "Checked In" && <Btn onClick={() => { onClose(); onCheckIn(); }}>Start session</Btn>}
            {canManage && b.status === "In Progress" && <Btn kind="gold" onClick={() => { onClose(); onCheckOut(); }}>Complete session</Btn>}
            {b.invoiceId
              ? <Btn kind="ghost" onClick={() => { onClose(); onInvoice(); }}>Show invoice</Btn>
              : b.paymentStatus === "paid"
                ? <Btn kind="ghost" onClick={() => { onClose(); onOpen(); }}>Show payment</Btn>
                : canManage && !["Cancelled", "No Show"].includes(b.status) && <Btn kind="gold" onClick={() => { onClose(); onInvoice(); }}>Take payment</Btn>}
            <Btn kind="ghost" onClick={() => { onClose(); onOpen(); }}>Open booking</Btn>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------ context menu ----------------------------- */

function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: { label: string; onClick: () => void }[]; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div role="menu" className="fixed z-[81] min-w-[210px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
        style={{
          left: Math.max(8, Math.min(at.x, window.innerWidth - 230)),
          top: Math.max(8, Math.min(at.y, window.innerHeight - 140)),
        }}>
        {items.map((it) => (
          <button key={it.label} className="block w-full px-3.5 py-2 text-left text-[12.5px] font-medium text-ink2 hover:bg-ivory" onClick={() => { onClose(); it.onClick(); }}>{it.label}</button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ block modal ------------------------------ */

function BlockModal({ open, onClose, onSaved, date, providers, initial }: {
  open: boolean; onClose: () => void; onSaved: () => void; date: string; providers: DayBookProvider[];
  initial?: { doctorId?: string; startTime?: string } | null;
}) {
  const { toast, branchId } = useStore();
  const [doctorId, setDoctorId] = useState(initial?.doctorId ?? providers[0]?.doctorId ?? "");
  const [start, setStart] = useState(initial?.startTime ?? "13:00");
  const [end, setEnd] = useState(initial?.startTime ? toHHMM(Math.min(23 * 60 + 45, toMin(initial.startTime) + 60)) : "14:00");
  const [title, setTitle] = useState("Meeting");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setDoctorId(initial?.doctorId ?? providers[0]?.doctorId ?? ""); setStart(initial?.startTime ?? "13:00"); setEnd(initial?.startTime ? toHHMM(Math.min(23 * 60 + 45, toMin(initial.startTime) + 60)) : "14:00"); setTitle("Meeting"); setNotes(""); setErr(null); } }, [open, initial?.doctorId, initial?.startTime]);
  const name = (id: string) => providers.find((p) => p.doctorId === id)?.name ?? "";

  const who = providers.find((p) => p.doctorId === doctorId);
  const s0 = toMin(start); const e0 = toMin(end);
  /** What stops this block being saved. */
  const problem = !doctorId
    ? "Choose whose time is being held."
    : e0 <= s0
      ? "The end time has to be after the start time."
      : null;
  /**
   * What is odd but allowed. Holding time outside a shift is legitimate — a
   * meeting before the clinic opens — so these read as warnings, not blocks.
   */
  const warnings = (() => {
    if (problem || !who) return [] as string[];
    const out: string[] = [];
    const inShift = (who.ranges ?? []).some((r) => s0 >= toMin(r.start) && e0 <= toMin(r.end));
    if (!(who.ranges ?? []).length) out.push(`${who.name} has no shift on this day.`);
    else if (!inShift) out.push(`Outside ${who.name}'s shift (${who.ranges.map((r) => `${label12(toMin(r.start))}–${label12(toMin(r.end))}`).join(", ")}).`);
    const clash = (who.blocks ?? []).find((b) => s0 < toMin(b.endTime) && e0 > toMin(b.startTime));
    if (clash) out.push(`Overlaps "${clash.title}" (${label12(toMin(clash.startTime))}–${label12(toMin(clash.endTime))}).`);
    if (e0 - s0 > 8 * 60) out.push("That holds more than eight hours.");
    return out;
  })();

  return (
    <Modal open={open} onClose={onClose} title="Block out time">
      <div className="grid gap-3">
        <Note className="my-0">Held time is not offered to guests in the app and shows purple on the book — meetings, vendor demos, CRM calls. Blocks made in Zenoti appear here on their own.</Note>
        <Sel label="Dermatologist" value={name(doctorId)} options={providers.map((p) => p.name)} onChange={(v) => setDoctorId(providers.find((p) => p.name === v)?.doctorId ?? "")} />
        <div className="grid grid-cols-2 gap-3">
          <In label="From" type="time" value={start} onChange={setStart} />
          <In label="To" type="time" value={end} onChange={setEnd} />
        </div>
        <Sel label="Reason" value={title} options={["Meeting", "CRM Booking", "Vendor visit", "Training", "Lunch", "Reserved", "Other"]} onChange={setTitle} />
        <Area label="Note" value={notes} onChange={setNotes} rows={2} placeholder="Who, what, phone number…" />
        {problem && <Note kind="crit" className="my-0">{problem}</Note>}
        {!problem && warnings.length > 0 && <Note kind="gold" className="my-0">{warnings.join(" ")}</Note>}
        {err && <Note kind="crit">{err}</Note>}
        <div className="flex items-center justify-end gap-2">
          {!problem && <span className="mr-auto text-[11.5px] text-ink3">Holds {Math.round((e0 - s0) / 15) * 15} min · {label12(s0)}–{label12(e0)}</span>}
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={busy || !!problem} onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await api.providerBlocks.create({ date, startTime: start, endTime: end, doctorId, branchId: branchId || null, title, notes });
              toast("Time blocked"); onSaved(); onClose();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Block time"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ today's sales ---------------------------- */

export function TodaysSalesModal({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const { branchId, can, toast } = useStore();
  const nav = useNavigate();
  const q = useApi(() => (open ? api.analytics.todaySales({ date, branchId: branchId || null }) : Promise.resolve(null as unknown as TodaysSales)), [open, date, branchId]);
  const [source, setSource] = useState("All");
  const [status, setStatus] = useState("All");
  const [sel, setSel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Find a bill by its number, whatever day it was raised. A guest phones
  // quoting a number and reception has nothing else to search by — this was
  // the one thing the retired Invoices register did that nothing else does.
  const [lookup, setLookup] = useState("");
  const [lookErr, setLookErr] = useState<string | null>(null);
  const findBill = async () => {
    const number = lookup.trim();
    if (!number) return;
    setLookErr(null);
    try { const i = await api.invoices.lookup(number); setSel(i._id); }
    catch (e) { setLookErr((e as Error).message || `No bill found for "${number}".`); }
  };
  const data = q.data;
  const rows = (data?.rows ?? []).filter((r) => (source === "All" || r.source === source) && (status === "All" || r.status === status));
  const canVoid = can("billing.void");
  const quick = async (id: string, fn: () => Promise<unknown>, msg: string) => { setBusyId(id); try { await fn(); toast(msg); q.reload(); } catch (e) { toast((e as Error).message); } finally { setBusyId(null); } };
  return (
    <Modal open={open} onClose={onClose} title={`Today's sales · ${date}`} xl>
      <Async q={q} label="Adding up the day…" rows={4}>
        {() => data ? (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-6">
              {[["Collected", fmtINR(data.totals.amount)], ["Services", fmtINR(data.totals.visits)], ["Products", fmtINR(data.totals.products)], ["Packages", fmtINR(data.totals.packages)], ["Due", `${fmtINR(data.totals.due)} · ${data.totals.dueCount}`], ["Open bills", String(data.totals.open ?? 0)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-ivory px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{k}</div><div className="text-[15px] font-extrabold tabular-nums">{v}</div></div>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink3">By method:</span>
              {Object.entries(data.totals.byMethod).map(([m, v]) => <Tag key={m} kind="mute">{m} {fmtINR(v)}</Tag>)}
              <span className="ml-auto flex items-center gap-2">
                <input value={lookup} onChange={(e) => setLookup(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void findBill(); }}
                  placeholder="Invoice / receipt no. ↵"
                  className="w-44 rounded-lg border border-border bg-ivory px-2 py-1 text-[12px] outline-none focus:border-gold-dark" />
                <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-border bg-ivory px-2 py-1 text-[12px]"><option>All</option><option>Desk</option><option>App</option><option>Zenoti</option></select>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-ivory px-2 py-1 text-[12px]"><option>All</option>{[...new Set((data.rows ?? []).map((r) => r.status))].map((s) => <option key={s}>{s}</option>)}</select>
              </span>
            </div>
            {lookErr && <Note kind="crit" className="my-0 mb-2">{lookErr}</Note>}
            {rows.length === 0 ? <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-ink3">No bills or payments on this day.</div> : (
              <DataTable cols={["Invoice no", "Receipt no", "Customer", "Sale items (qty)", "Amount", "Due", "Status", "Source", ""]}
                rows={rows.map((r) => [
                  <span key="r" className="font-mono text-[11px]">{r.ref ?? "—"}</span>,
                  <span key="rc" className="font-mono text-[11px] text-ink3">{r.receipt ?? "—"}</span>,
                  <span key="c"><B>{r.customer ?? "—"}</B>{r.patientId ? <span className="ml-1 font-mono text-[10px] text-ink3">{r.patientId}</span> : null}</span>,
                  <span key="i" className="text-[11.5px]">{r.items.join(", ")}<span className="text-ink3">{r.method ? ` · ${r.method}` : ""}</span></span>,
                  <span key="a" className="tabular-nums">{fmtINR(r.amount)}</span>,
                  <span key="d" className={`tabular-nums ${r.due > 0 ? "font-bold text-err" : ""}`}>{fmtINR(r.due)}</span>,
                  <Tag key="s" kind={r.status === "CLOSED" || r.status === "PAID" ? "ok" : r.status === "OPEN" ? "gold" : r.status === "VOID" ? "mute" : "info"}>{r.status}</Tag>,
                  r.source,
                  <span key="o" className="flex items-center gap-2 whitespace-nowrap text-[11.5px] font-semibold">
                    <button className="text-primary underline-offset-2 hover:underline" onClick={() => {
                      if (r.kind === "invoice") setSel(r.id);
                      else if (r.kind === "visit") { onClose(); nav("/bookings", { state: { open: r.id } }); }
                      else if (r.kind === "order") { onClose(); nav("/orders"); }
                      else { onClose(); nav("/packages"); }
                    }}>Show</button>
                    {/* A guest's whole money history lives on their record. */}
                    {r.userId && <button className="text-ink3 underline-offset-2 hover:underline"
                      onClick={() => { onClose(); nav("/patient", { state: { id: String(r.userId) } }); }}>Guest</button>}
                    {r.kind === "invoice" && canVoid && r.status === "CLOSED" && <button className="text-ink3 underline-offset-2 hover:underline" disabled={busyId === r.id} onClick={() => quick(r.id, () => api.invoices.reopen(r.id), "Invoice reopened")}>Reopen</button>}
                    {r.kind === "invoice" && canVoid && r.status !== "VOID" && <button className="text-err underline-offset-2 hover:underline" disabled={busyId === r.id} onClick={() => { const reason = window.prompt(`Void ${r.ref}? Give a reason.`) || ""; if (reason.trim().length >= 3) quick(r.id, () => api.invoices.void(r.id, reason.trim()), "Invoice voided"); }}>Void</button>}
                  </span>,
                ])} />
            )}
          </>
        ) : null}
      </Async>
      <InvoiceModal open={!!sel} invoiceId={sel} onClose={() => setSel(null)} onChanged={q.reload} />
    </Modal>
  );
}

/* ------------------------------ the grid ------------------------------- */

export function DayBookGrid({ date, bookings, onOpen, onChanged, onNewAt, onCheckIn, onCheckOut, onInvoice, filterKind }: {
  date: string;
  bookings: Booking[];
  onOpen: (id: string) => void;
  onChanged: () => void;
  onNewAt: (preset: { doctorId?: string; doctorName?: string; time?: string }) => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
  /** "Take payment" / "Show invoice" — opens the bill for this visit. */
  onInvoice: (id: string) => void;
  filterKind?: "" | "consultation" | "treatment";
}) {
  const { branchId, can, toast } = useStore();
  const shifts = useApi(() => api.schedules.dayShifts(date, branchId || null), [date, branchId]);
  /*
   * ONE overlay at a time.
   *
   * The card popover and the right-click menu were separate state at the same
   * z-index, so opening one never closed the other and they rendered stacked —
   * the menu landing on top of a booking's details, both half-readable. A
   * single slot makes that impossible to express.
   */
  type Overlay =
    | { kind: "card"; b: Booking; x: number; y: number }
    | { kind: "menu"; x: number; y: number; doctorId?: string; doctorName?: string; time: string };
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const quick = overlay?.kind === "card" ? overlay : null;
  const menu = overlay?.kind === "menu" ? overlay : null;
  const setQuick = (v: { b: Booking; x: number; y: number } | null) =>
    setOverlay(v ? { kind: "card", ...v } : null);
  const setMenu = (v: { x: number; y: number; doctorId?: string; doctorName?: string; time: string } | null) =>
    setOverlay(v ? { kind: "menu", ...v } : null);
  const [blockOpen, setBlockOpen] = useState<null | { doctorId?: string; startTime?: string }>(null);

  // Escape closes whichever popover is open — neither had a keyboard way out.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOverlay(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);
  const [now, setNow] = useState(() => new Date());
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(t); }, []);

  const book: DayBook | undefined = shifts.data;
  const rows = useMemo(() => (filterKind === "consultation" ? bookings.filter(isConsultationBooking) : filterKind === "treatment" ? bookings.filter((b) => !isConsultationBooking(b)) : bookings), [bookings, filterKind]);

  // Time axis: centre hours, widened to cover any shift or booking outside them.
  const [axisStart, axisEnd] = useMemo(() => {
    let s = toMin(book?.branch?.open || "09:00"); let e = toMin(book?.branch?.close || "20:00");
    for (const p of book?.providers ?? []) { for (const r of p.ranges) { s = Math.min(s, toMin(r.start)); e = Math.max(e, toMin(r.end)); } for (const bl of p.blocks) { s = Math.min(s, toMin(bl.startTime)); e = Math.max(e, toMin(bl.endTime)); } }
    for (const b of rows) { const d = bookingSlotDate(b); if (d) { const m = toMin(clinicHM(d)); s = Math.min(s, m); e = Math.max(e, m + durationOf(b)); } }
    s = Math.floor(s / 60) * 60; e = Math.ceil(e / 60) * 60;
    return [Math.max(0, s), Math.min(24 * 60, Math.max(e, s + 60))];
  }, [book, rows]);
  const cols = (axisEnd - axisStart) / COL_MIN;
  const x = (min: number) => ((min - axisStart) / COL_MIN) * COL_W;

  // Providers: rostered dermatologists first, then anyone who has a booking today but no roster row.
  const providers = useMemo(() => {
    const list: { key: string; name: string; sub: string; row?: DayBookProvider }[] = (book?.providers ?? []).map((p) => ({ key: p.name, name: p.name, sub: p.designation || "", row: p }));
    const known = new Set(list.map((l) => l.name));
    for (const b of rows) { const n = bookingProvider(b); if (n && n !== "Not assigned" && !known.has(n)) { known.add(n); list.push({ key: n, name: n, sub: b.specialistTier || "Zenoti practitioner" }); } }
    if (rows.some((b) => bookingProvider(b) === "Not assigned")) list.push({ key: "Not assigned", name: "Not assigned", sub: "needs a dermatologist" });
    return list;
  }, [book, rows]);

  const byProvider = useMemo(() => {
    const m = new Map<string, { placed: Placed[]; lanes: number }>();
    for (const p of providers) m.set(p.key, layout(rows.filter((b) => bookingProvider(b) === p.key)));
    return m;
  }, [providers, rows]);

  const isToday = date === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const nowMin = toMin(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }));
  useEffect(() => { if (isToday && scroller.current) scroller.current.scrollLeft = Math.max(0, x(nowMin) - 240); }, [isToday, axisStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = {
    guests: new Set(rows.map((b) => (typeof b.userId === "string" ? b.userId : (b.userId as { _id?: string })?._id) || b.mobileNumber)).size,
    bookings: rows.length,
    open: rows.filter((b) => ["Awaiting Confirmation", "Confirmed", "Rescheduled", "In Progress"].includes(b.status)).length,
    value: rows.filter((b) => !["Cancelled", "No Show"].includes(b.status)).reduce((n, b) => n + (b.amount || 0), 0),
  };

  const legend = ["pending", "confirmed", "checkedin", "inprogress", "completed", "late", "rescheduled", "noshow", "block"] as const;

  return (
    <div className="rounded-(--radius-card) border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[10.5px] text-ink3">
        {legend.map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10" style={{ background: STATE_STYLE[k].swatch }} />{STATE_STYLE[k].label}</span>)}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#efe6d2]" />Leave</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-ivory" />Off shift</span>
        <span className="ml-auto">Right-click a free cell to book or block it · hover a card for details</span>
      </div>

      <div ref={scroller} className="overflow-x-auto">
        <div style={{ width: LEFT_W + cols * COL_W, position: "relative" }}>
          {/* header */}
          <div className="sticky top-0 z-[3] flex border-b border-border bg-ivory">
            <div className="shrink-0 border-r border-border px-3 py-2 text-[11px] font-bold" style={{ width: LEFT_W }}>{book?.branch?.name ?? "All centres"}</div>
            {/* Two-line axis, the way Zenoti heads its book: the hour named in
                full on top, each quarter marked underneath, so a card that
                starts at 11:45 can be read off the ruler instead of counted. */}
            <div className="relative" style={{ width: cols * COL_W, height: 34 }}>
              {Array.from({ length: Math.ceil((axisEnd - hourFloor(axisStart)) / 60) }, (_, i) => hourFloor(axisStart) + i * 60)
                .filter((h) => h + 60 > axisStart)
                .map((h) => (
                  <div key={h} className="absolute top-0 h-[19px] overflow-hidden border-l border-border"
                    style={{ left: x(Math.max(h, axisStart)), width: (Math.min(h + 60, axisEnd) - Math.max(h, axisStart)) / COL_MIN * COL_W }}>
                    <span className="block whitespace-nowrap px-1 pt-1 font-mono text-[10.5px] font-bold text-ink2">{label12(h)}</span>
                  </div>
                ))}
              {Array.from({ length: cols }, (_, i) => axisStart + i * COL_MIN).map((m) => (
                <div key={m} className={`absolute bottom-0 h-[15px] border-l ${m % 60 === 0 ? "border-border" : "border-border/40"}`} style={{ left: x(m), width: COL_W }}>
                  <span className={`block text-center font-mono text-[9px] leading-[15px] ${m % 60 === 0 ? "text-ink2" : "text-ink3"}`}>
                    {String(m % 60).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* rows */}
          {/*
           * While the shifts load, the board used to render with NO provider
           * rows at all — a bare ruler for the five to ten seconds the Zenoti
           * read takes, with the roster and its "not working" bands popping in
           * afterwards. Placeholder rows keep the grid's shape so the desk can
           * see it is filling in rather than empty, and the layout does not
           * jump when it lands.
           */}
          {shifts.loading && !book && Array.from({ length: 5 }, (_, i) => (
            <div key={`sk${i}`} className="flex animate-pulse border-b border-border last:border-0">
              <div className="shrink-0 border-r border-border px-3 py-3" style={{ width: LEFT_W }}>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-6 w-1 rounded-full bg-border" />
                  <div className="min-w-0 flex-1">
                    <div className="h-3 w-28 rounded bg-border" />
                    <div className="mt-1.5 h-2.5 w-20 rounded bg-border/60" />
                  </div>
                </div>
              </div>
              <div className="relative" style={{ width: cols * COL_W, height: ROW_H + 6 }}>
                <div className="absolute inset-y-2 rounded bg-border/40" style={{ left: 8, width: Math.max(80, cols * COL_W * 0.45) }} />
              </div>
            </div>
          ))}
          {!shifts.loading && providers.length === 0 && <div className="px-4 py-8 text-center text-[12.5px] text-ink3">No dermatologists rostered here today. Add shifts under Care → Dermatologists → Schedule.</div>}
          {providers.map((p) => {
            const lay = byProvider.get(p.key)!;
            const h = Math.max(1, lay.lanes) * ROW_H + 6;
            const ranges = p.row?.ranges ?? [];
            const onLeave = p.row?.onLeave ?? false;
            const blocks = p.row?.blocks ?? [];
            return (
              <div key={p.key} className="flex border-b border-border last:border-0">
                <div className="shrink-0 border-r border-border px-3 py-2" style={{ width: LEFT_W }}>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-6 w-1 rounded-full" style={{ background: p.row ? (p.row.tier === "senior-consultant" ? "#e0c391" : "#0b4a37") : "#c9c9c9" }} />
                    <div className="min-w-0">
                      <div className={`truncate text-[12.5px] font-bold ${!p.row || (!ranges.length && !onLeave) ? "text-ink3" : ""}`}>{p.name}</div>
                      <div className="truncate font-mono text-[9.5px] text-ink3">{onLeave ? "On leave" : ranges.length ? ranges.map((r) => `${label12(toMin(r.start))}–${label12(toMin(r.end))}`).join(", ") : p.row ? "No shift today" : p.sub}</div>
                    </div>
                  </div>
                </div>
                <div className="relative bg-ivory/70" style={{ width: cols * COL_W, height: h }}
                  onContextMenu={(e) => {
                    if (!can("bookings.manage") || !p.row) return;
                    e.preventDefault();
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const min = axisStart + Math.floor(((e.clientX - rect.left) / COL_W)) * COL_MIN;
                    setMenu({ x: e.clientX, y: e.clientY, doctorId: p.row.doctorId, doctorName: p.name, time: toHHMM(min) });
                  }}>
                  {/* shift = white */}
                  {ranges.map((r, i) => <div key={i} className="absolute top-0 h-full bg-surface" style={{ left: x(toMin(r.start)), width: x(toMin(r.end)) - x(toMin(r.start)) }} />)}
                  {onLeave && <div className="absolute inset-y-0 left-0 right-0 flex items-center bg-[#efe6d2] pl-3 text-[11px] font-bold text-[#7a5b2a]">Leave{p.row?.note ? ` · ${p.row.note}` : ""}</div>}
                  {/* grid lines */}
                  {Array.from({ length: cols }, (_, i) => axisStart + i * COL_MIN).map((m) => <div key={m} className={`pointer-events-none absolute top-0 h-full border-l ${m % 60 === 0 ? "border-border" : "border-border/30"}`} style={{ left: x(m) }} />)}
                  {/* blocks */}
                  {blocks.map((bl) => (
                    <div key={bl._id} title={`${bl.title}\n${label12(toMin(bl.startTime))} – ${label12(toMin(bl.endTime))}${bl.notes ? `\n${bl.notes}` : ""}${bl.source === "zenoti" ? "\nFrom Zenoti" : ""}`}
                      className={`absolute top-1 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-md border border-[#9c7bd6]/50 px-2 text-[10.5px] font-semibold ${STATE_STYLE.block.bg} ${STATE_STYLE.block.text}`}
                      style={{ left: x(toMin(bl.startTime)) + 1, width: Math.max(COL_W - 2, x(toMin(bl.endTime)) - x(toMin(bl.startTime)) - 2) }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (bl.source === "panel" && can("bookings.manage")) setMenu({ x: e.clientX, y: e.clientY, doctorId: p.row?.doctorId, doctorName: p.name, time: bl.startTime }); }}>
                      <span className="truncate">{bl.title}{bl.notes ? ` · ${bl.notes}` : ""}</span>
                      {bl.source === "panel" && can("bookings.manage") && (
                        <button className="ml-auto pl-2 text-[10px] opacity-70 hover:opacity-100" title="Release this block" onClick={async (e) => { e.stopPropagation(); try { await api.providerBlocks.remove(bl._id); toast("Block released"); shifts.reload(); } catch (err) { toast((err as Error).message); } }}><X size={11} /></button>
                      )}
                    </div>
                  ))}
                  {/* bookings */}
                  {lay.placed.map(({ b, start, end, lane }) => {
                    const state = cardState(b);
                    const st = STATE_STYLE[state] ?? STATE_STYLE.pending;
                    return (
                      <button key={b._id} title={tooltipText(b)}
                        onClick={(e) => setQuick({ b, x: e.clientX, y: e.clientY })}
                        onContextMenu={(e) => { e.preventDefault(); setQuick({ b, x: e.clientX, y: e.clientY }); }}
                        className={`absolute overflow-hidden rounded-md border border-black/10 px-1.5 text-left text-[10.5px] leading-tight shadow-sm hover:z-[2] hover:shadow-md ${st.bg} ${st.text}`}
                        style={{ left: x(start) + 1, width: Math.max(COL_W - 2, x(end) - x(start) - 2), top: 3 + lane * ROW_H, height: ROW_H - 6 }}>
                        <div className="flex items-center truncate">
                          <b className="truncate text-[11px] font-bold">{b.fullName}</b>
                          {b.mobileNumber && <span className="ml-1 truncate opacity-70">({b.mobileNumber})</span>}
                          <CardIcons b={b} />
                        </div>
                        <div className="truncate opacity-85">{bookingServiceName(b, "").split("—")[0]}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* now line */}
          {isToday && nowMin >= axisStart && nowMin <= axisEnd && (
            <div className="pointer-events-none absolute top-0 z-[4] h-full border-l-2 border-dotted border-err" style={{ left: LEFT_W + x(nowMin) }}>
              <span className="absolute -left-[22px] top-[6px] rounded bg-err px-1 font-mono text-[9.5px] font-bold text-white">{toHHMM(nowMin)}</span>
            </div>
          )}
        </div>
      </div>

      {/* footer totals */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-ivory px-3 py-2 text-[11.5px] text-ink2">
        <span>Total guests: <B>{totals.guests}</B></span>
        <span>Total appointments: <B>{totals.bookings}</B></span>
        <span>Open appointments: <B>{totals.open}</B></span>
        <span>Services value: <B>{fmtINR(totals.value)}</B></span>
        {book?.otherBlocks?.length ? <span className="text-ink3">{book.otherBlocks.length} block-out{book.otherBlocks.length === 1 ? "" : "s"} on other staff</span> : null}
        <span className="ml-auto text-ink3">{shifts.loading ? "Refreshing shifts…" : `Shifts from the dermatologists' schedules · ${(book?.providers ?? []).filter((p) => p.ranges.length).length} on today`}</span>
      </div>

      {quick && (
        <QuickCard b={quick.b} anchor={{ x: quick.x, y: quick.y }} onClose={() => setQuick(null)} onOpen={() => onOpen(quick.b._id)}
          onChanged={() => { onChanged(); shifts.reload(); }} onCheckIn={() => onCheckIn(quick.b._id)} onCheckOut={() => onCheckOut(quick.b._id)} onInvoice={() => onInvoice(quick.b._id)} />
      )}
      {menu && (
        <ContextMenu at={menu} onClose={() => setMenu(null)} items={[
          { label: `New appointment · ${label12(toMin(menu.time))} with ${menu.doctorName ?? "…"}`, onClick: () => onNewAt({ doctorId: menu.doctorId, doctorName: menu.doctorName, time: menu.time }) },
          { label: "New group appointment (several services)", onClick: () => onNewAt({ doctorId: menu.doctorId, doctorName: menu.doctorName, time: menu.time }) },
          { label: `Block out time from ${label12(toMin(menu.time))}`, onClick: () => setBlockOpen({ doctorId: menu.doctorId, startTime: menu.time }) },
        ]} />
      )}
      <BlockModal open={!!blockOpen} onClose={() => setBlockOpen(null)} onSaved={() => shifts.reload()} date={date} providers={book?.providers ?? []} initial={blockOpen} />
    </div>
  );
}
