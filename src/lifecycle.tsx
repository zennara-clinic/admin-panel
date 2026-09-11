/**
 * The appointment action bar — the desk's whole relationship with an
 * appointment's status, in one component.
 *
 * The rules live on the server (services/bookingLifecycleService.js): which
 * actions are legal from the current status, whether check-in is inside its
 * time window, whether a reason is required, and what each one does in Zenoti.
 * This component asks for that list and renders it. Nothing here re-implements
 * a rule, so the panel and the API can never disagree about what the desk may
 * do — which is exactly how the old code-based check-in drifted out of step
 * with what Zenoti actually held.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import api from "./lib/api";
import type { LifecycleAction, LifecycleOption, LifecycleState, StatusLogEntry } from "./lib/types";
import { Area, Btn, Note, Tag } from "./ui";
import { fmtAgo } from "./lib/format";

/** Which button style each action deserves — destructive ones look it. */
const KIND: Partial<Record<LifecycleAction, "primary" | "gold" | "ghost" | "danger">> = {
  confirm: "primary",
  check_in: "primary",
  start: "primary",
  complete: "gold",
  no_show: "ghost",
  cancel: "danger",
  undo_check_in: "ghost",
  undo_start: "ghost",
  undo_complete: "ghost",
  undo_no_show: "ghost",
  undo_cancel: "ghost",
};

/**
 * Actions that end an appointment. Each reaches Zenoti the moment it runs, so
 * one mis-tap on a crowded day book must not be enough — the desk confirms.
 */
const DESTRUCTIVE: Partial<Record<LifecycleAction, { title: string; body: string; placeholder: string }>> = {
  cancel: {
    title: "Cancel this appointment?",
    body: "The slot is released and Zenoti is updated in the same step. It is recorded against your name.",
    placeholder: "e.g. guest called to cancel",
  },
  no_show: {
    title: "Mark this guest as a no-show?",
    body: "Zenoti is updated in the same step. It is recorded against your name.",
    placeholder: "e.g. no answer on two calls",
  },
};

const LOCAL_ONLY = "Corrects Zennara only — Zenoti has no undo for this; fix it there too.";

const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "";

export function useLifecycle(bookingId: string | null | undefined) {
  const [state, setState] = useState<LifecycleState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!bookingId) { setState(null); setError(null); return; }
    setLoading(true);
    try {
      setState(await api.bookings.lifecycleState(bookingId));
      setError(null);
    } catch (e) {
      setState(null);
      setError((e as Error).message || "Couldn't load the actions for this appointment.");
    } finally {
      setLoading(false);
    }
  }, [bookingId]);
  useEffect(() => { void reload(); }, [reload]);
  return { state, reload, loading, error };
}

export function LifecycleActions({ state, busy, onRun, extraFor, canOverride = true, variant = "stack" }: {
  state: LifecycleState | null;
  busy?: boolean;
  /** Perform the action; the caller owns the API call, toasts and reload. */
  onRun: (action: LifecycleAction, body: { reason?: string; force?: boolean }) => Promise<boolean> | boolean;
  /** Extra fields a specific action needs before it can run (e.g. a dermatologist picker). */
  extraFor?: (action: LifecycleAction) => { node?: ReactNode; blocked?: string | null } | undefined;
  /** Whether this staff member may push past a closed check-in window. */
  canOverride?: boolean;
  /**
   * "stack" — every action a full button (the booking drawer).
   * "card"  — the next step as one wide button, everything else as small
   *           secondary buttons underneath (the day book's quick card).
   */
  variant?: "stack" | "card";
}) {
  const [ask, setAsk] = useState<LifecycleOption | null>(null);
  const [confirm, setConfirm] = useState<LifecycleOption | null>(null);
  const [reason, setReason] = useState("");

  if (!state) return null;
  const actions = state.actions;
  if (!actions.length) return null;

  const run = async (opt: LifecycleOption, over?: { reason?: string; force?: boolean }) => {
    const ok = await onRun(opt.action, over ?? {});
    if (ok) { setAsk(null); setConfirm(null); setReason(""); }
  };

  const start = (opt: LifecycleOption) => {
    // A blocked action needs the desk to say why it is going ahead anyway; a
    // reopen needs a reason on principle.
    if ((opt.blocked && canOverride) || opt.needsReason) { setReason(""); setAsk(opt); return; }
    // Ending an appointment is confirmed first; the reason is optional.
    if (DESTRUCTIVE[opt.action]) { setReason(""); setConfirm(opt); return; }
    void run(opt);
  };

  const isMain = (opt: LifecycleOption) => KIND[opt.action] === "primary" || KIND[opt.action] === "gold";
  const main = variant === "card" ? actions.filter(isMain) : actions;
  const rest = variant === "card" ? actions.filter((o) => !isMain(o)) : [];

  return (
    <>
      {main.map((opt) => {
        const extra = extraFor?.(opt.action);
        const hardBlocked = Boolean(opt.blocked && !canOverride);
        return (
          <div key={opt.action} className="grid gap-1">
            {extra?.node}
            <Btn
              kind={KIND[opt.action] ?? "ghost"}
              className={variant === "card" ? "w-full !py-2.5" : ""}
              disabled={busy || hardBlocked || Boolean(extra?.blocked)}
              onClick={() => start(opt)}
            >
              {opt.label}
              {opt.blocked ? " — not yet" : ""}
            </Btn>
            {opt.blocked && (
              <div className="px-1 text-[11.5px] text-ink3">
                {opt.blockedReason}
                {canOverride ? " Tap to check in early with a reason." : ""}
              </div>
            )}
            {extra?.blocked && <div className="px-1 text-[11.5px] text-err">{extra.blocked}</div>}
            {opt.localOnly && <div className="px-1 text-[11.5px] text-ink3">{LOCAL_ONLY}</div>}
          </div>
        );
      })}

      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rest.map((opt) => (
            <button
              key={opt.action}
              type="button"
              disabled={busy}
              onClick={() => start(opt)}
              title={opt.localOnly ? LOCAL_ONLY : undefined}
              className={`rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                opt.action === "cancel" ? "text-err hover:border-err hover:bg-err-bg" : "text-ink2 hover:bg-sage"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {ask && (
        <Modalish
          title={ask.blocked ? `${ask.label} early` : ask.label}
          onClose={() => setAsk(null)}
        >
          {ask.blocked
            ? <Note kind="crit">{ask.blockedReason} Checking in now is recorded against your name on the appointment.</Note>
            : <Note>This is recorded against your name on the appointment.</Note>}
          <div className="mt-3">
            <Area label="Reason" value={reason} onChange={setReason} rows={2}
              placeholder={ask.blocked ? "e.g. guest arrived early and the room is free" : "e.g. billing correction"} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn kind="ghost" onClick={() => setAsk(null)}>Back</Btn>
            <Btn kind={KIND[ask.action] ?? "primary"} disabled={busy || reason.trim().length < 3}
              onClick={() => run(ask, { reason: reason.trim(), force: true })}>
              {ask.label}
            </Btn>
          </div>
        </Modalish>
      )}

      {confirm && DESTRUCTIVE[confirm.action] && (
        <Modalish title={DESTRUCTIVE[confirm.action]!.title} onClose={() => setConfirm(null)}>
          <Note kind={confirm.action === "cancel" ? "crit" : "gold"}>{DESTRUCTIVE[confirm.action]!.body}</Note>
          <div className="mt-3">
            <Area label="Reason (optional)" value={reason} onChange={setReason} rows={2}
              placeholder={DESTRUCTIVE[confirm.action]!.placeholder} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn kind="ghost" onClick={() => setConfirm(null)}>Keep appointment</Btn>
            <Btn kind={confirm.action === "cancel" ? "danger" : "primary"} disabled={busy}
              onClick={() => run(confirm, reason.trim() ? { reason: reason.trim() } : {})}>
              {confirm.label}
            </Btn>
          </div>
        </Modalish>
      )}
    </>
  );
}

/**
 * A minimal dialog so this file doesn't depend on each page's modal state.
 * Portalled above everything — it is opened from the day book's quick card
 * (z 81) and from the full-screen book, and used to paint underneath both.
 */
function Modalish({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // This dialog owns Escape; the quick card and full screen must not close with it.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[15px] font-bold">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * What happened to this appointment and when — including whether Zenoti took
 * it. The desk needs to see a failed push, not discover it a day later when
 * the clinic's own report disagrees.
 */
export function StatusHistory({ log }: { log?: StatusLogEntry[] }) {
  const rows = (log ?? []).slice(-8).reverse();
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] font-bold text-ink2">Appointment history</div>
      <div className="grid gap-1 rounded-lg bg-ivory px-2.5 py-2 text-[11.5px] text-ink2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-bold">{r.to ?? r.action}</span>
            <span className="text-ink3">{clock(r.at)} · {r.byName ?? (r.via === "system" ? "automatic" : "staff")} · {fmtAgo(r.at)}</span>
            {r.overrode && <Tag kind="warn">early</Tag>}
            {r.reason && <span className="text-ink3">“{r.reason}”</span>}
            {r.zenoti === "failed" && <Tag kind="err">Zenoti: {r.zenotiError || "failed"}</Tag>}
            {r.zenoti === "skipped" && <Tag kind="mute">Not sent to Zenoti</Tag>}
            {r.zenoti === "dryrun" && <Tag kind="mute">Zenoti dry-run</Tag>}
            {r.zenoti === "synced" && <Tag kind="ok">In Zenoti</Tag>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The message the panel shows once an action succeeded. */
export const LIFECYCLE_TOAST: Record<LifecycleAction, string> = {
  confirm: "Booking confirmed — the guest has been notified",
  check_in: "Guest checked in",
  undo_check_in: "Check-in reversed",
  start: "Session started",
  undo_start: "Start reversed — the guest is checked in",
  complete: "Session completed",
  undo_complete: "Session reopened",
  no_show: "Marked as no-show",
  undo_no_show: "No show reversed",
  cancel: "Booking cancelled",
  undo_cancel: "Cancellation reversed",
};
