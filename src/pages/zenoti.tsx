import { useState } from "react";
/**
 * Clinic data (Zenoti CRM).
 *
 * Every Zenoti guest is mirrored into Patients as an ordinary app user, and
 * their clinic history (profile, treatments, purchases, packages, memberships,
 * notes and forms) is kept
 * in a local mirror that the backend refreshes continuously. This page is the
 * all-customers view of that data — no per-customer search needed — plus the
 * sync health and controls. Per-customer detail lives on the patient record.
 */
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import {
  api, type ZenotiAppointment, type ZenotiForm, type ZenotiListRow, type ZenotiMembership,
  type ZenotiNote, type ZenotiOrder, type ZenotiPackage,
  type ZenotiSyncRun,
} from "../lib/api";
import { useApi, useDebounced, usePoll } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import { useStore } from "../store";
import { Page, Card, Btn, Stats, DataTable, Empty, Note, Tag, Prog, Tabs, Spinner, StaleBanner, B } from "../ui";
import { fmtAgo, fmtDateFull, fmtTime, isoDay, toDate } from "../lib/format";

type SvcBalance = { name: string | null; total: number | null; used: number | null; balance: number | null };

export function fmtZDate(s: string | null | undefined): string {
  if (!s) return "—";
  return toDate(s) ? fmtDateFull(s) : String(s);
}
export function fmtZWhen(s: string | null | undefined): string {
  if (!s) return "—";
  return toDate(s) ? `${fmtDateFull(s)}, ${fmtTime(s)}` : String(s);
}
export function money(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;
}
const num = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Number(n) : 0);
export const isPast = (s: string | null | undefined) => !!s && !!toDate(s) && toDate(s)!.getTime() < Date.now();
export const isFuture = (s: string | null | undefined) => !!s && !!toDate(s) && toDate(s)!.getTime() > Date.now();
export const pkgActive = (k: ZenotiPackage) => {
  const status = String(k.status ?? "").toLowerCase();
  return (status === "1" || status === "active") && num(k.sessionsRemaining) > 0 && (k.neverExpires || !k.endDate || isFuture(k.endDate));
};
function PackageStatus({ k }: { k: ZenotiPackage }) {
  if (pkgActive(k)) return <Tag kind="ok">Active</Tag>;
  if (String(k.status) === "3") return <Tag kind="warn">Frozen</Tag>;
  if (String(k.status) === "7") return <Tag kind="info">Not started</Tag>;
  if (!k.neverExpires && k.endDate && isPast(k.endDate)) return <Tag kind="err">Expired</Tag>;
  if (num(k.sessionsRemaining) <= 0) return <Tag kind="mute">Used up</Tag>;
  return <Tag kind="mute">Inactive</Tag>;
}
export const membershipActive = (m: ZenotiMembership) => {
  if (m.expiryDate && !isFuture(m.expiryDate)) return false;
  const status = String(m.status ?? "").toLowerCase();
  return status === "1" || status === "active";
};
export function appointmentState(a: ZenotiAppointment): { label: string; kind: "ok" | "info" | "err" | "warn" | "mute" } {
  const status = String(a.status ?? "").toLowerCase();
  if (status === "-2" || status === "no show") return { label: "No show", kind: "warn" };
  if (status === "-1" || status === "cancelled") return { label: "Cancelled", kind: "err" };
  if (status === "21" || status === "voided") return { label: "Voided", kind: "mute" };
  if (status === "2" || status === "checkin") return { label: "Checked in", kind: "info" };
  if (status === "1" || status === "closed" || status === "completed") return { label: "Done", kind: "ok" };
  return isFuture(a.startTime) ? { label: "Upcoming", kind: "info" } : { label: "Past", kind: "mute" };
}

/** One service line inside a package/membership: name + used/total + progress. */
function ServiceLine({ s }: { s: SvcBalance }) {
  const total = num(s.total);
  const used = num(s.used);
  const balance = s.balance ?? (total - used);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1 truncate text-sm text-ink">{s.name || "—"}</div>
      <Prog pct={pct} w="w-16" />
      <div className="w-28 shrink-0 text-right text-xs tabular-nums text-ink3">
        {used}/{total} used · <span className="font-semibold text-ink">{balance} left</span>
      </div>
    </div>
  );
}

export function ZenotiPackageCard({ k, who }: { k: ZenotiPackage; who?: string }) {
  const total = num(k.sessionsTotal);
  const left = num(k.sessionsRemaining);
  const done = Math.max(0, total - left);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink">{k.name || "Package"}{who ? <span className="ml-2 text-xs font-normal text-ink3">· {who}</span> : null}</div>
          <div className="mt-0.5 text-xs text-ink3">
            Bought {fmtZDate(k.purchaseDate || k.startDate)} · {k.neverExpires ? "Never expires" : `Expires ${fmtZDate(k.endDate)}`}
            {k.centerName ? ` · ${k.centerName}` : ""} · {money(k.price)} · <Tag kind="info">Clinic</Tag>
          </div>
        </div>
        <PackageStatus k={k} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Prog pct={pct} w="w-full" />
        <div className="shrink-0 text-xs font-semibold tabular-nums text-ink">{done}/{total} sessions used</div>
      </div>
      {!!k.services?.length && (
        <div className="mt-3 divide-y divide-border border-t border-border pt-1">
          {k.services.map((s, i) => <ServiceLine key={i} s={s} />)}
        </div>
      )}
      {!!k.products?.length && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink3">Included products</div>
          <div className="divide-y divide-border">{k.products.map((s, i) => <ServiceLine key={i} s={s} />)}</div>
        </div>
      )}
    </Card>
  );
}

export function ZenotiMembershipCard({ m }: { m: ZenotiMembership }) {
  const active = membershipActive(m);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink">
            {m.name || "Membership"}
            {m.code ? <span className="ml-2 text-xs font-normal text-ink3">({m.code})</span> : ""}
          </div>
          <div className="mt-0.5 text-xs text-ink3">
            {m.memberSince ? `Member since ${fmtZDate(m.memberSince)}` : ""}
            {m.expiryDate ? ` · ${active ? "Expires" : "Expired"} ${fmtZDate(m.expiryDate)}` : ""}
            {m.creditBalance ? ` · Credit ${money(m.creditBalance)}` : ""}
            {m.centerName ? ` · ${m.centerName}` : ""}
          </div>
        </div>
        {active ? <Tag kind="gold">Active</Tag> : <Tag kind="mute">Expired</Tag>}
      </div>
      {!!m.services?.length && (
        <div className="mt-3 divide-y divide-border border-t border-border pt-1">
          {m.services.map((s, i) => <ServiceLine key={i} s={s} />)}
        </div>
      )}
      {!!m.products?.length && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink3">Product benefits</div>
          <div className="divide-y divide-border">{m.products.map((s, i) => <ServiceLine key={i} s={s} />)}</div>
        </div>
      )}
      {m.guestPassTotal != null && (
        <div className="mt-2 text-xs text-ink3">Guest passes: <B>{m.guestPassBalance ?? 0}</B> of {m.guestPassTotal} remaining</div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------ *
 * All-customer lists (one per mirrored collection)
 * ------------------------------------------------------------------------ */
type Kind = "packages" | "appointments" | "memberships" | "orders" | "notes" | "forms";
type AnyItem = ZenotiPackage | ZenotiAppointment | ZenotiMembership | ZenotiOrder | ZenotiNote | ZenotiForm;
type ZenotiListEnvelope = { success: boolean; data: ZenotiListRow<AnyItem>[]; total: number; page: number; limit: number };
const PAGE = 15;

function who<T>(r: ZenotiListRow<T>) {
  return r.user?.fullName || "Guest";
}

/**
 * A paged, branch-scoped list of every customer's clinic packages /
 * appointments / memberships / purchases. `embedded` drops the page chrome so
 * it can sit inside another page's tab (e.g. Packages → Clinic packages).
 */
export function ZenotiList({ kind, embedded }: { kind: Kind; embedded?: boolean }) {
  const nav = useNavigate();
  const route = useLocation();
  const { branchId } = useStore();
  const [page, setPage] = useQueryPage("clinicPage");
  const [search, setSearch] = useQueryString("clinicQ");
  const [statusParam, setStatus] = useQueryString("clinicStatus", "active");
  const status: "active" | "expired" | "all" = statusParam === "expired" || statusParam === "all" ? statusParam : "active";
  const defaultWhen = kind === "appointments" ? "upcoming" : "all";
  const [whenParam, setWhen] = useQueryString("clinicWhen", defaultWhen);
  const when: "upcoming" | "past" | "all" = whenParam === "upcoming" || whenParam === "past" ? whenParam : "all";
  const debounced = useDebounced(search);
  useEffect(() => { setPage(1); }, [debounced, branchId, status, when, kind]);

  const q = useApi((): Promise<ZenotiListEnvelope> => {
    const base: Record<string, string | number> = { page, limit: PAGE };
    if (branchId) base.branchId = branchId;
    if (debounced) base.search = debounced;
    if (kind === "packages" || kind === "memberships") base.status = status;
    if (kind === "appointments") {
      if (when === "upcoming") base.upcoming = 1;
      if (when === "past") base.to = isoDay();
    }
    return api.zenoti[kind](base) as Promise<ZenotiListEnvelope>;
  }, [kind, page, debounced, branchId, status, when]);

  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const open = (r: ZenotiListRow<unknown>) => nav("/patient", {
    state: { id: String(r.userId), returnTo: `${route.pathname}${route.search}` },
  });

  const filters = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by guest, phone or service…"
        className="w-full max-w-[360px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      {(kind === "packages" || kind === "memberships") && (
        <div className="flex gap-1">
          {(kind === "packages" ? (["active", "expired", "all"] as const) : (["active", "all"] as const)).map((s) => (
            <Btn key={s} kind={status === s ? "primary" : "ghost"} className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </Btn>
          ))}
        </div>
      )}
      {kind === "appointments" && (
        <div className="flex gap-1">
          {(["upcoming", "past", "all"] as const).map((s) => (
            <Btn key={s} kind={when === s ? "primary" : "ghost"} className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setWhen(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </Btn>
          ))}
        </div>
      )}
      <span className="ml-auto text-[12px] text-ink3">{total.toLocaleString("en-IN")} {kind}</span>
    </div>
  );

  let table: React.ReactNode;
  if (q.loading && !q.data) table = <div className="p-6"><Spinner /></div>;
  else if (rows.length === 0) table = <Empty title={`No ${kind} here`} hint={debounced ? `Nothing matched “${debounced}”.` : "Clinic history fills in as guests are synced from Zenoti."} />;
  else if (kind === "packages") {
    const rs = rows as ZenotiListRow<ZenotiPackage>[];
    table = (
      <DataTable cols={["Guest", "Package", "Sessions", "Bought", "Expires", "Price", "Status"]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => {
          const k = r.item; const total = num(k.sessionsTotal); const left = num(k.sessionsRemaining);
          return [
            <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone} · {r.branchName ?? r.user?.location ?? "—"}</span></span>,
            k.name ?? "Package",
            <span key={`${r.userId}s`} className="tabular-nums">{Math.max(0, total - left)}/{total} used · <B>{left} left</B></span>,
            fmtZDate(k.purchaseDate || k.startDate),
            k.neverExpires ? "Never" : fmtZDate(k.endDate),
            money(k.price),
            <PackageStatus key={`${r.userId}status`} k={k} />,
          ];
        })} />
    );
  } else if (kind === "appointments") {
    const rs = rows as ZenotiListRow<ZenotiAppointment>[];
    table = (
      <DataTable cols={["When", "Guest", "Service", "Therapist", "Centre", "Price", ""]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => {
          const state = appointmentState(r.item);
          return [
          fmtZWhen(r.item.startTime),
          <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone}</span></span>,
          r.item.serviceName ?? "—",
          r.item.therapistName ?? "—",
          r.item.centerName ?? r.branchName ?? "—",
          money(r.item.price),
          <Tag key={`${r.userId}state`} kind={state.kind}>{state.label}</Tag>,
        ];})} />
    );
  } else if (kind === "memberships") {
    const rs = rows as ZenotiListRow<ZenotiMembership>[];
    table = (
      <DataTable cols={["Guest", "Membership", "Since", "Expires", "Credit", "Status"]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => [
          <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone} · {r.branchName ?? "—"}</span></span>,
          <span key={`${r.userId}m`}>{r.item.name ?? "Membership"}{r.item.code ? <span className="ml-1 text-[11px] text-ink3">({r.item.code})</span> : null}</span>,
          fmtZDate(r.item.memberSince),
          fmtZDate(r.item.expiryDate),
          money(r.item.creditBalance),
          membershipActive(r.item) ? <Tag kind="gold">Active</Tag> : <Tag kind="mute">Inactive</Tag>,
        ])} />
    );
  } else if (kind === "notes") {
    const rs = rows as ZenotiListRow<ZenotiNote>[];
    table = (
      <DataTable cols={["Date", "Guest", "Note", "Type", "Added by", "Centre"]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => [
          fmtZWhen(r.item.createdAt),
          <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone}</span></span>,
          <span key={`${r.userId}n`} className="block max-w-[460px] whitespace-normal">{r.item.text ?? "—"}</span>,
          r.item.isProfileAlert ? <Tag kind="warn">Profile alert</Tag> : String(r.item.type ?? "General"),
          r.item.createdBy ?? "—",
          r.item.centerName ?? r.branchName ?? "—",
        ])} />
    );
  } else if (kind === "forms") {
    const rs = rows as ZenotiListRow<ZenotiForm>[];
    const formStatus = (v: number | string | null) => {
      if (String(v) === "2") return <Tag kind="ok">Submitted</Tag>;
      if (String(v) === "1") return <Tag kind="warn">Saved</Tag>;
      if (String(v) === "0") return <Tag kind="mute">Not filled</Tag>;
      return <Tag kind="mute">{v === null ? "No form" : String(v)}</Tag>;
    };
    table = (
      <DataTable cols={["Guest", "Form", "Last filled", "Filled by", "Status", ""]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => [
          <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone}</span></span>,
          r.item.name ?? "Form",
          fmtZWhen(r.item.lastFilledAt),
          r.item.lastFilledBy ?? "—",
          r.item.isExpired ? <Tag kind="err">Expired</Tag> : formStatus(r.item.status),
          r.item.viewOnly ? <Tag kind="info">View only</Tag> : "",
        ])} />
    );
  } else {
    const rs = rows as ZenotiListRow<ZenotiOrder>[];
    table = (
      <DataTable cols={["Date", "Guest", "Product", "Qty", "Price", "Paid by", "Invoice"]} onRow={(i) => open(rs[i])}
        rows={rs.map((r) => [
          fmtZDate(r.item.saleDate),
          <span key={String(r.userId)}><B>{who(r)}</B><br /><span className="text-[11px] text-ink3">{r.user?.phone}</span></span>,
          r.item.name ?? "—",
          r.item.quantity ?? 1,
          money(r.item.price),
          r.item.paymentType ?? "—",
          <span key={`${r.userId}i`} className="font-mono text-[11px]">{r.item.invoiceNumber ?? "—"}</span>,
        ])} />
    );
  }

  const body = (
    <>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      {filters}
      {q.error && !q.data ? <Empty title="Could not load clinic data" hint={q.error} action={<Btn onClick={q.reload}>Retry</Btn>} /> : table}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink3">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Btn>
            <Btn kind="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Btn>
          </div>
        </div>
      )}
    </>
  );
  return embedded ? <div>{body}</div> : body;
}

/* ------------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------------ */
function runLabel(r: ZenotiSyncRun | null | undefined) {
  if (!r) return "never";
  const when = fmtAgo(r.finishedAt || r.startedAt);
  if (r.status === "running") return `running · ${r.processed}/${r.total || "?"}`;
  if (r.status === "failed") return `failed ${when}`;
  return `${when}`;
}

/** Can what is created here reach Zenoti? The honest checklist. */
function PublishHours() {
  const { toast, can } = useStore();
  const [busy, setBusy] = useState<"plan" | "publish" | null>(null);
  const [result, setResult] = useState<{ planned: number; written: number; alreadyWorking: number; failed: number; dryRun: boolean; wouldWrite?: number; errors: string[]; mode: string } | null>(null);
  if (!can("zenoti.manage")) return null;
  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "plan" : "publish");
    try { const r = await api.zenoti.publishDoctorHours({ dryRun }); setResult(r); toast(dryRun ? `Would write ${r.wouldWrite ?? 0} shifts` : `${r.written} shifts written to Zenoti${r.failed ? `, ${r.failed} failed` : ""}`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
      <Btn kind="ghost" disabled={!!busy} onClick={() => run(true)}>{busy === "plan" ? "Checking…" : "Preview shifts to publish"}</Btn>
      <Btn disabled={!!busy} onClick={() => run(false)}>{busy === "publish" ? "Publishing…" : "Publish dermatologist hours to Zenoti"}</Btn>
      {result && (
        <span className="text-ink3">
          {result.dryRun ? `Plan: ${result.planned} doctor-days, ${result.wouldWrite ?? 0} to write, ${result.alreadyWorking} already scheduled in Zenoti` : `Written ${result.written}, already scheduled ${result.alreadyWorking}, failed ${result.failed}`}
          {result.mode !== "live" && " · write mode is not live, nothing was sent"}
          {result.errors.length > 0 && ` · ${result.errors[0]}`}
        </span>
      )}
    </div>
  );
}

/** Is everything flowing, both ways? Shown at the top of the Zenoti page. */
function SyncHealth() {
  const { toast, can } = useStore();
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const q = useApi(() => api.zenoti.syncHealth().catch(() => null), [nonce]);
  const h = q.data;
  if (!h) return null;
  const tag = (l: { status: string; failed?: number } | null) =>
    !l ? <Tag kind="mute">never run</Tag>
      : l.status === "running" ? <Tag kind="info">running</Tag>
      : l.status === "failed" ? <Tag kind="err">failed</Tag>
      : (l.failed ?? 0) > 0 ? <Tag kind="warn">done · {l.failed} failed</Tag>
      : <Tag kind="ok">ok</Tag>;
  const out = h.outbound as Record<string, number | string>;
  const row = (label: string, n: number | string, bad = false) => (
    <div key={label} className="flex justify-between border-b border-border py-1 last:border-0">
      <span className="text-ink3">{label}</span><b className={bad && Number(n) > 0 ? "text-err" : ""}>{n}</b>
    </div>
  );
  return (
    <Card className="mb-3 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-bold text-ink2">
          Sync health <span className="font-normal text-ink3">(checked {fmtAgo(h.checkedAt)}) · write mode <b>{h.writeMode}</b></span>
        </div>
        <div className="flex gap-2">
          <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setNonce((n) => n + 1)}>Refresh</Btn>
          {busy && <span className="text-[11.5px] text-ink3">Syncing…</span>}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="text-[12px]">
          <div className="mb-1 font-bold text-ink2">Zenoti → Zennara</div>
          {h.inbound.map((m) => {
            const run = ({
              products: api.zenoti.syncProducts, catalog: api.zenoti.syncCatalog,
              centers: api.zenoti.syncCenters, categories: api.zenoti.syncCategories,
              appointments: api.zenoti.syncAppointments, details: () => api.zenoti.crawl(),
            } as Record<string, (() => Promise<unknown>) | undefined>)[m.type];
            return (
              <div key={m.type} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1 last:border-0">
                <span>{m.label} <span className="text-ink3">· {m.every}</span></span>
                <span className="flex items-center gap-2">
                  {tag(m.last)}{m.last?.startedAt && <span className="text-ink3">{fmtAgo(m.last.startedAt)}</span>}
                  {run && can("zenoti.manage") && (
                    <button className="text-[11px] underline-offset-2 hover:underline" disabled={busy} onClick={async () => {
                      setBusy(true);
                      try { await run(); toast(`${m.label.split(" (")[0]} — synced`); setNonce((n) => n + 1); }
                      catch (e) { toast((e as Error).message); } finally { setBusy(false); }
                    }}>Sync now</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="text-[12px]">
          <div className="mb-1 font-bold text-ink2">Zennara → Zenoti (waiting)</div>
          {row("Confirmed bookings not yet in Zenoti", out.bookingsAwaitingPush, true)}
          {row("Bookings whose push failed", out.bookingsFailed, true)}
          {row("Bookings needing a person (half-created)", out.bookingsNeedingAPerson, true)}
          {row("Guests pending sync", out.patientsPendingSync)}
          {row("Guests sync failed", out.patientsSyncFailed, true)}
          {row("Guests needing review", out.patientsNeedingReview, true)}
          {row("Package sales pending", out.packageSalesPending)}
          {row("Prescription notes failed", out.prescriptionNotesFailed, true)}
          <div className="mt-1 text-[11px] text-ink3">{String(out.retry ?? "")}</div>
        </div>
      </div>
    </Card>
  );
}

function ReadinessCard() {
  const q = useApi(() => api.zenoti.readiness().catch(() => null), []);
  const r = q.data;
  if (!r) return null;
  const ok = (v: boolean | null) => v === null ? <Tag kind="mute">unknown</Tag> : v ? <Tag kind="ok">yes</Tag> : <Tag kind="err">no</Tag>;
  return (
    <Card className="mb-3 p-4">
      <div className="mb-2 text-[12px] font-bold text-ink2">Writing to Zenoti — readiness <span className="font-normal text-ink3">(checked {fmtAgo(r.checkedAt)})</span></div>
      <div className="grid gap-x-6 gap-y-1 text-[12px] md:grid-cols-2">
        <div>New records (bookings, package sales) → Zenoti: {ok(r.writeMode === "live")} <span className="text-ink3">mode {r.writeMode}</span></div>
        <div>Desk check-in / check-out → Zenoti: {ok(r.lifecycleWriteback)}</div>
        <div>Updater employee for completions (ZENOTI_UPDATED_BY_ID): {ok(r.updatedByConfigured)} <span className="text-ink3">{r.updatedByConfigured ? "" : "falls back to the visit's own provider"}</span></div>
        <div>Referral source for brand-new guests (ZENOTI_REFERRAL_SOURCE_ID): {ok(r.referralSourceConfigured)} <span className="text-ink3">{r.referralSourceConfigured ? "" : "new app sign-ups cannot be created in Zenoti"}</span></div>
        <div>Safety breaker: {r.breaker.tripped ? <Tag kind="err">tripped</Tag> : <Tag kind="ok">armed</Tag>} <span className="text-ink3">{r.breaker.writesLastHour} writes in the last hour</span></div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {r.clinics.map((c) => (
          <div key={c.centerId} className="rounded-lg bg-ivory px-3 py-2 text-[12px]">
            <B>{c.name}</B>
            <div className="mt-1">Staff shifts published in Zenoti this week: {ok(c.schedulesPublished)} <span className="text-ink3">{c.shiftsWorking}/{c.shiftsTotal} working</span></div>
            <div>Services mapped: <B>{c.servicesResolved}</B>/{c.servicesTotal} <span className="text-ink3">· {c.bookableServices} bookable of {c.servicesInCatalogue} in Zenoti</span></div>
            <div>Packages mapped: <B>{c.packagesResolved}</B>/{c.packagesTotal} <span className="text-ink3">· {c.zenotiPackages} in Zenoti</span></div>
          </div>
        ))}
      </div>
      {(r.unmappedServices.length > 0 || r.unmappedPackages.length > 0 || (r.unlinkedDermatologists ?? []).length > 0) && (
        <div className="mt-2 text-[11.5px] text-ink3">
          {r.unmappedServices.length > 0 && <div>Services without a Zenoti mapping ({r.unmappedServices.length}): {r.unmappedServices.slice(0, 12).join(", ")}{r.unmappedServices.length > 12 ? "…" : ""} — set it on each service under Care → Services.</div>}
          {r.unmappedPackages.length > 0 && <div>Packages without a Zenoti mapping: {r.unmappedPackages.join(", ")} — set it under Care → Packages.</div>}
          {(r.unlinkedDermatologists ?? []).length > 0 && <div>Dermatologists not linked to a Zenoti employee ({(r.unlinkedDermatologists ?? []).length}): {(r.unlinkedDermatologists ?? []).join(", ")} — link them under Practitioners on this page (Onboard), or their confirmed bookings will be refused by Zenoti.</div>}
        </div>
      )}
      {r.clinics.some((c) => c.schedulesPublished === false) && (
        <Note kind="crit" className="mt-2">Zenoti's slot engine offers nothing while staff shifts are "NotScheduled", so appointments created here cannot be written into Zenoti. Publish the dermatologists' panel hours into Zenoti below (runs nightly too); only days Zenoti has nothing scheduled are written, and shifts the clinic set are never touched.</Note>
      )}
      <PublishHours />
    </Card>
  );
}

export function ClinicData() {
  const nav = useNavigate();
  const { toast, can } = useStore();
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: 5 });
  const status = useApi(() => api.zenoti.status(), []);
  const s = status.data;
  const busy = !!(s?.fullImportRunning || s?.rosterRunning || s?.detailsRunning);
  usePoll(status.reload, busy ? 5000 : 60000, true);
  const isAdmin = can("zenoti.manage");

  const kinds = useMemo(() => ["packages", "appointments", "memberships", "orders", "notes", "forms"] as const, []);
  const pct = s && s.linkedUsers > 0 ? Math.round((s.freshWithin24h / s.linkedUsers) * 100) : 0;
  const detailRun = s?.running.find((r) => r.type === "details");
  const datasetLabels: Record<string, string> = {
    profile: "Profiles", appointments: "Treatments", orders: "Purchases", memberships: "Memberships",
    packages: "Packages", notes: "Notes", forms: "Forms",
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); status.reload(); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title="Zennara clinic data"
      sub="Guests and every supported clinic dataset are mirrored here, with per-section coverage and errors."
      actions={isAdmin ? <>
        <Btn kind="ghost" disabled={s?.appointmentSyncRunning} onClick={() => run(() => api.zenoti.syncAppointments(), "Refreshing every clinic appointment book now")}>Sync appointments</Btn>
        <Btn kind="ghost" disabled={busy} onClick={() => run(() => api.zenoti.crawl(80), "Refreshing the 80 least-recent guests")}> 
          <span className="flex items-center gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${s?.detailsRunning ? "animate-spin" : ""}`} />Refresh history</span>
        </Btn>
        <Btn disabled={busy} onClick={() => run(() => api.zenoti.import(), "Full import started — guests and all supported history are syncing")}>
          {s?.fullImportRunning || s?.rosterRunning ? "Full import running…" : "Import everything"}
        </Btn>
      </> : undefined}>
      {s && !s.configured && <Note kind="crit">Zenoti is not configured on the server (ZENOTI_API_KEY). Nothing will sync until it is.</Note>}
      <SyncHealth />
      <ReadinessCard />
      {s?.writeBreaker?.tripped && (
        <Note kind="crit">
          Writes to Zenoti are <B>paused by the safety breaker</B> since {fmtAgo(s.writeBreaker.at ?? undefined)}: {s.writeBreaker.reason}.
          Nothing is being written to Zenoti until an admin resets it.
          {isAdmin && <> <button className="underline" onClick={() => api.zenoti.resetWriteBreaker().then(() => { toast("Zenoti write breaker reset"); status.reload(); })}>Reset breaker</button></>}
        </Note>
      )}
      {s && (
        <Stats items={[
          { k: "Clinic guests", v: s.linkedUsers.toLocaleString("en-IN"), d: "in Guests", onClick: () => nav("/patients") },
          { k: "History synced", v: s.mirrored.toLocaleString("en-IN"), d: `${pct}% fresh (24h)` },
          { k: "Guest import", v: s.lastRoster ? (s.lastRoster.status === "running" ? "Running" : fmtAgo(s.lastRoster.finishedAt || s.lastRoster.startedAt)) : "Never", d: s.lastRoster ? `${s.lastRoster.created} new · ${s.lastRoster.updated} updated · ${s.lastRoster.skipped} skipped` : "nightly 02:30", hot: s.rosterRunning },
          { k: "History import", v: s.detailsRunning ? `${detailRun?.processed ?? 0}/${detailRun?.total || "?"}` : runLabel(s.lastDetails), d: s.detailsRunning ? (detailRun?.mode === "full" ? "full supported record" : "rolling refresh") : "every 5 min, oldest first", hot: s.detailsRunning },
          { k: "Live appointments", v: s.appointmentSyncRunning ? "Syncing" : runLabel(s.lastAppointments), d: "every 2 min · all clinics", hot: s.appointmentSyncRunning },
          { k: "Sync errors", v: s.withErrors, d: s.withErrors ? "retried automatically" : "none", tone: s.withErrors ? "dn" : undefined },
          { k: "Write-back", v: s.writeMode, d: s.writeMode === "live" ? `new records → Zenoti on · status changes ${s.lifecycleWriteback ? "ON" : "off"}` : "not writing to Zenoti", hot: !!s.writeBreaker?.tripped },
        ]} />
      )}
      {s && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><B>Import coverage by dataset</B><div className="text-[11.5px] text-ink3">A zero means not imported yet; an empty guest result still counts once Zenoti was checked.</div></div>
            <Tag kind={s.mirrored === s.linkedUsers && s.withErrors === 0 ? "ok" : "warn"}>{s.mirrored}/{s.linkedUsers} guests checked</Tag>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {s.supportedDatasets.map((key) => {
              const done = s.sectionCoverage[key] ?? 0;
              const coverage = s.linkedUsers ? Math.round((done / s.linkedUsers) * 100) : 0;
              return <div key={key} className="rounded-lg border border-border bg-ivory p-2.5">
                <div className="flex justify-between text-[11.5px]"><B>{datasetLabels[key] ?? key}</B><span>{done.toLocaleString("en-IN")}/{s.linkedUsers.toLocaleString("en-IN")}</span></div>
                <div className="mt-1.5"><Prog pct={coverage} w="w-full" /></div>
              </div>;
            })}
          </div>
          {s.providerLimitations.length > 0 && (
            <Note className="mb-0 mt-3">
              <B>Checked but unavailable from the current Zenoti account:</B>{" "}
              {s.providerLimitations.map((x) => `${x.label} — ${x.reason}`).join(" · ")}
            </Note>
          )}
        </Card>
      )}
      <Note className="mb-0 text-[11.5px]">
        Packages, appointments, purchases and memberships from Zenoti are no longer listed here — they are the same
        records as everything else: see Packages → Assignments, Bookings, Orders and each guest&rsquo;s profile.
      </Note>
    </Page>
  );
}
