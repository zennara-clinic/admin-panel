import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Btn, Tag, Modal, Note, In, Sel, Area, B, Page, DataTable, Async, Tabs, Switch, Empty, SecH, Card, type TagKind } from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi } from "../lib/useApi";
import { fmtINR, fmtDate } from "../lib/format";
import type { Membership, MembershipAssignment, Consultation, User } from "../lib/types";

/* ------------------------------------------------------------------------- *
 * Memberships — Zenoti's "Manage memberships": plans (name, code, prefix +
 * seed, price, validity, % off services / products / packages, service
 * credits, centres) and the guests who hold them (member number, validity,
 * credits left, payments). Plans mirrored from Zenoti keep their link; their
 * discount rules are set here because the Zenoti API does not expose them.
 * ------------------------------------------------------------------------- */

const errMsg = (e: unknown) => (e as Error)?.message || "Something went wrong";
const nameOf = (v: unknown, fb = "—") => (typeof v === "object" && v ? ((v as { fullName?: string; name?: string }).fullName || (v as { name?: string }).name || fb) : fb);

/* ---------------------------- Zenoti sale sync ---------------------------- */

const ZENOTI_SYNC: Record<NonNullable<MembershipAssignment["zenotiSyncStatus"]>, { label: string; kind: TagKind }> = {
  synced: { label: "Synced", kind: "ok" },
  invoice_open: { label: "Invoice open", kind: "warn" },
  failed: { label: "Failed", kind: "err" },
  pending: { label: "Pending", kind: "mute" },
  skipped: { label: "Skipped", kind: "mute" },
  dryrun: { label: "Dry run", kind: "mute" },
};
/** Sales made here or in the app that Zenoti has not fully recorded yet — the ones a re-push can help. */
const canPushToZenoti = (a: MembershipAssignment) => (a.source === "app" || a.source === "panel") && a.zenotiSyncStatus !== "synced";

function ZenotiSyncTag({ a }: { a: MembershipAssignment }) {
  const st = a.zenotiSyncStatus ? ZENOTI_SYNC[a.zenotiSyncStatus] : null;
  if (!st) return <span className="text-ink3">—</span>;
  return <span title={a.zenotiSyncError || undefined}><Tag kind={st.kind}>{st.label}</Tag></span>;
}

function PushToZenotiButton({ a, onDone, small }: { a: MembershipAssignment; onDone: () => void; small?: boolean }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy}
      onClick={async (e) => {
        e.stopPropagation(); setBusy(true);
        try { const r = await api.memberships.zenotiPush(a._id); toast(r.message || "Pushed to Zenoti"); onDone(); }
        catch (err) { toast(errMsg(err)); }
        finally { setBusy(false); }
      }}
      className={`rounded-(--radius-btn) border border-border bg-surface font-semibold text-ink2 hover:bg-ivory disabled:cursor-not-allowed disabled:text-dis ${small ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1.5 text-[12px]"}`}>
      {busy ? "Pushing…" : "Push to Zenoti"}
    </button>
  );
}

export function Memberships() {
  const { can, toast } = useStore();
  const nav = useNavigate();
  const [tab, setTab] = useState(0);
  const [edit, setEdit] = useState<Membership | null>(null);
  const [creating, setCreating] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [memberSel, setMemberSel] = useState<MembershipAssignment | null>(null);
  const [status, setStatus] = useState("Active");
  const [search, setSearch] = useState("");
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The default list is the one plan on sale (the Zen membership); the retired
  // Zenoti variants only come back when asked for, and only for reference.
  const plans = useApi(() => api.memberships.list(), []);
  const retired = useApi(() => api.memberships.list({ includeInactive: "true" }).catch(() => [] as Membership[]), []);
  const members = useApi(() => (tab === 1 ? api.memberships.members({ status, search: search || undefined, limit: 300 }) : Promise.resolve([] as MembershipAssignment[])), [tab, status, search]);
  const canManage = can("memberships.manage") || can("packages.manage");
  const rows = plans.data ?? [];
  const zen = rows.find((m) => m.isAppDefault) ?? rows[0] ?? null;
  const retiredRows = (retired.data ?? []).filter((m) => m._id !== zen?._id);
  const reloadPlans = () => { plans.reload(); retired.reload(); };
  const refreshPrice = async () => {
    setRefreshing(true);
    try { await api.zenoti.syncCatalog(); toast("Zenoti catalogue refreshed"); reloadPlans(); }
    catch (e) { toast(errMsg(e)); }
    finally { setRefreshing(false); }
  };
  return (
    <Page title="Memberships" sub="The Zen membership a guest can hold — a % off services and products for a period, some with service credits. Member numbers run prefix + seed."
      actions={canManage ? <div className="flex gap-2"><Btn kind="ghost" onClick={() => setSellOpen(true)}>Sell / grant a membership</Btn>{!zen && <Btn onClick={() => setCreating(true)}>New plan</Btn>}</div> : undefined}>
      <Tabs active={tab} onChange={setTab} items={[["The Zen membership"], ["Members"]]} />
      {tab === 0 ? (
        <Async q={plans} label="Loading the plan…" rows={4}>
          {() => !zen ? <Empty title="No membership plan yet" hint="Create one, or wait for the hourly Zenoti sync to mirror the clinic's plan." action={canManage ? <Btn onClick={() => setCreating(true)}>New plan</Btn> : undefined} /> : (
            <ZenPlanCard plan={zen} canManage={canManage} refreshing={refreshing}
              onEdit={() => setEdit(zen)} onRefresh={refreshPrice} onStudio={() => nav("/studio/membership")} />
          )}
        </Async>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Sel label="Status" value={status} onChange={setStatus} options={["Active", "Expired", "Cancelled", "all"]} />
            <div className="min-w-[240px] flex-1"><In label="Search" value={search} onChange={setSearch} placeholder="Member no., plan, guest name or phone" /></div>
          </div>
          <Async q={members} label="Loading members…" rows={4}>
            {() => (members.data ?? []).length === 0 ? <Empty title="No members match" /> : (
              <DataTable cols={["Member no.", "Guest", "Plan", "Valid", "Credits left", "Paid", "Status", "Source", "Zenoti"]}
                onRow={(i) => setMemberSel((members.data ?? [])[i])}
                rows={(members.data ?? []).map((a) => [
                  <span key="n" className="font-mono text-[11.5px] font-semibold">{a.memberNumber ?? "—"}</span>,
                  <span key="g"><B>{nameOf(a.userId, "Guest")}</B><span className="ml-1 text-[11px] text-ink3">{(a.userId as { phone?: string })?.phone ?? ""}</span></span>,
                  a.snapshot?.name ?? nameOf(a.membershipId),
                  `${fmtDate(a.validFrom)} → ${a.validUntil ? fmtDate(a.validUntil) : "no expiry"}`,
                  a.credits.length ? a.credits.map((c) => `${c.serviceName || c.serviceId} ${Math.max(0, c.qty - c.used)}/${c.qty}`).join(", ") : "—",
                  a.payment?.isReceived ? <Tag key="p" kind="ok">{fmtINR(a.price)}</Tag> : <Tag key="p" kind="warn">{fmtINR(a.payment?.balanceDue ?? a.price)} due</Tag>,
                  <Tag key="s" kind={a.status === "Active" ? "ok" : "mute"}>{a.status}</Tag>,
                  a.source === "zenoti" ? "Zenoti" : a.source === "app" ? "App" : "Desk",
                  <span key="z" className="flex flex-wrap items-center gap-1.5">
                    <ZenotiSyncTag a={a} />
                    {a.zenotiInvoiceNumber && <span className="font-mono text-[11px] text-ink3">{a.zenotiInvoiceNumber}</span>}
                    {canManage && canPushToZenoti(a) && <PushToZenotiButton a={a} small onDone={() => members.reload()} />}
                  </span>,
                ])} />
            )}
          </Async>
        </>
      )}
      {tab === 0 && zen && (
        <div className="mt-4">
          <button className="text-[12px] font-semibold text-ink2 underline-offset-2 hover:underline" onClick={() => setRetiredOpen((v) => !v)}>
            {retiredOpen ? "Hide" : "Show"} retired Zenoti variants{retired.data ? ` (${retiredRows.length})` : ""}
          </button>
          {retiredOpen && (
            <div className="mt-2">
              <Note className="my-0 mb-2 text-[11.5px]">Earlier names Zenoti has used for the same membership (MVP, MVP-2026, Zen Membership…). Kept for reference only — nothing here is sold or edited.</Note>
              <Async q={retired} label="Loading variants…" rows={2}>
                {() => retiredRows.length === 0 ? <div className="text-[12.5px] text-ink3">No retired variants.</div> : (
                  <DataTable dense cols={["Name", "Code", "Price", "Validity", "Members", "Status", "Source"]}
                    rows={retiredRows.map((m) => [
                      <B key="n">{m.name}</B>,
                      <span key="c" className="font-mono text-[11px]">{m.code || m.zenotiRaw?.code || "—"}</span>,
                      fmtINR(m.price),
                      `${m.validityMonths} mo`,
                      String(m.membersCount ?? 0),
                      <Tag key="s" kind={m.isActive ? "ok" : "mute"}>{m.isActive ? "Active" : "Retired"}</Tag>,
                      m.source === "zenoti" ? <Tag key="z" kind="info">Zenoti</Tag> : "Panel",
                    ])} />
                )}
              </Async>
            </div>
          )}
        </div>
      )}
      <PlanEditor open={creating || !!edit} plan={edit} onClose={() => { setCreating(false); setEdit(null); }} onSaved={() => { setCreating(false); setEdit(null); reloadPlans(); }} />
      <SellMembershipModal open={sellOpen} onClose={() => setSellOpen(false)} onDone={() => { setSellOpen(false); members.reload(); reloadPlans(); }} />
      <MemberDrawer a={memberSel} onClose={() => setMemberSel(null)} onChanged={() => { members.reload(); }} canEdit={canManage} />
    </Page>
  );
}

/* ------------------------------ the Zen card ------------------------------ */

const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5 text-[12.5px]"><span className="shrink-0 text-ink3">{k}</span><span className="text-right">{v}</span></div>;

function ZenPlanCard({ plan: m, canManage, refreshing, onEdit, onRefresh, onStudio }: { plan: Membership; canManage: boolean; refreshing: boolean; onEdit: () => void; onRefresh: () => void; onStudio: () => void }) {
  const live = m.live ?? null;
  const liveAmount = live?.amount ?? null;
  const liveSource = live?.source ?? null;
  const inactiveInZenoti = live?.zenotiIsActive === false;
  const variant = [live?.zenotiName, live?.zenotiCode].filter(Boolean).join(" · ");
  const discountPct = live?.discountPercent ?? m.discounts?.servicesPercent ?? 0;
  const validity = live?.validityMonths ?? m.validityMonths;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold">{m.name}</span>
            {m.isAppDefault && <Tag kind="gold">App card</Tag>}
            <Tag kind={m.isActive ? "ok" : "mute"}>{m.isActive ? "On sale" : "Inactive"}</Tag>
            {m.source === "zenoti" && <Tag kind="info">Linked to Zenoti</Tag>}
            {inactiveInZenoti && <Tag kind="warn">Inactive in Zenoti</Tag>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink3">{m.code}{m.prefix ? ` · next member no. ${m.prefix}${m.seed ?? 1}` : ""}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <Btn kind="ghost" onClick={onEdit}>Edit plan</Btn>}
          {canManage && <Btn kind="ghost" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh price from Zenoti"}</Btn>}
          <Btn kind="gold" onClick={onStudio}>Configure in App Studio → Membership</Btn>
        </div>
      </div>
      <div className="mt-3 grid gap-x-6 md:grid-cols-2">
        <div>
          <Row k="Stored price" v={<B>{fmtINR(m.price)}</B>} />
          <Row k="Live price (what the app charges)" v={
            liveAmount == null ? <span className="text-ink3">not resolved yet</span> : (
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <B>{fmtINR(liveAmount)}</B>
                {liveSource === "zenoti" ? <Tag kind="info">from Zenoti</Tag> : liveSource === "manual" ? <Tag kind="mute">manual</Tag> : null}
                {liveSource === "manual" && live?.zenotiListPrice != null && live.zenotiListPrice !== liveAmount && <span className="text-[11px] text-ink3">Zenoti lists {fmtINR(live.zenotiListPrice)}</span>}
              </span>
            )} />
          <Row k="Zenoti variant" v={variant ? <span>{variant}{inactiveInZenoti && <Tag kind="warn">inactive in Zenoti</Tag>}</span> : <span className="text-ink3">{m.zenotiMembershipId || m.zenotiVersionId ? "linked" : "not linked"}</span>} />
          <Row k="Validity" v={`${validity} months`} />
        </div>
        <div>
          <Row k="Member discount" v={discountPct ? `${discountPct}%` : "—"} />
          <Row k="Discounts on the bill" v={[m.discounts?.servicesPercent ? `${m.discounts.servicesPercent}% services` : "", m.discounts?.productsPercent ? `${m.discounts.productsPercent}% products` : "", m.discounts?.packagesPercent ? `${m.discounts.packagesPercent}% packages` : ""].filter(Boolean).join(" · ") || "—"} />
          <Row k="Service credits" v={(m.credits ?? []).length ? (m.credits ?? []).map((c) => `${c.serviceName || c.serviceId} ×${c.qty}`).join(", ") : "—"} />
          <Row k="Members" v={<B>{m.membersCount ?? 0}</B>} />
        </div>
      </div>
      {inactiveInZenoti && <Note kind="crit" className="mb-0 mt-3 text-[11.5px]">Zenoti marks this variant inactive. Zenoti only holds the price for it — no duration or benefits — and may refuse invoices raised against it. Check the variant in App Studio → Membership.</Note>}
      {!inactiveInZenoti && <Note className="mb-0 mt-3 text-[11.5px]">Zenoti holds only the price for this membership; validity, discounts and credits are set here and on the app card in App Studio.</Note>}
    </Card>
  );
}

/* ------------------------------ plan editor ------------------------------ */

function PlanEditor({ open, plan, onClose, onSaved }: { open: boolean; plan: Membership | null; onClose: () => void; onSaved: () => void }) {
  const { toast, clinics: branches } = useStore();
  const [f, setF] = useState<Partial<Membership>>({});
  const [svc, setSvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const services = useApi(() => (open ? api.services.list({ isActive: "true", limit: 500 }) : Promise.resolve(null)), [open]);
  const catalogue = (services.data?.data ?? []) as Consultation[];
  useEffect(() => {
    if (!open) return;
    setF(plan ? { ...plan } : { name: "", code: "", prefix: "", seed: 1, price: 0, taxPercent: 18, priceIncludesTax: true, validityMonths: 12, membershipType: "non_recurring", discounts: { servicesPercent: 0, productsPercent: 0, packagesPercent: 0 }, credits: [], benefits: [], branchIds: [], isActive: true, isAppDefault: false, terms: "" });
    setErr(null); setSvc("");
  }, [open, plan?._id]);
  const set = <K extends keyof Membership>(k: K) => (v: Membership[K]) => setF((s) => ({ ...s, [k]: v }));
  const d = f.discounts ?? { servicesPercent: 0, productsPercent: 0, packagesPercent: 0 };
  const save = async () => {
    if (!f.name?.trim()) return setErr("Name is required");
    setBusy(true); setErr(null);
    try {
      if (plan) { await api.memberships.update(plan._id, f); toast("Plan saved"); }
      else { await api.memberships.create(f); toast("Plan created"); }
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={plan ? `Edit ${plan.name}` : "New membership plan"} xl>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="grid gap-3 md:grid-cols-2">
            <In label="Name" value={f.name ?? ""} onChange={set("name")} placeholder="e.g. Zennara Prime – 30% off" />
            <In label="Code" value={f.code ?? ""} onChange={(v) => set("code")(v.toUpperCase())} placeholder="ZPM" hint="Identification in Zenoti's list" />
            <In label="Member no. prefix" value={f.prefix ?? ""} onChange={(v) => set("prefix")(v.toUpperCase())} placeholder="MVPJH" />
            <In label="Next number (seed)" type="number" value={String(f.seed ?? 1)} onChange={(v) => set("seed")(Math.max(1, Number(v) || 1))} hint={`Next member gets ${(f.prefix ?? "") + String(f.seed ?? 1)}`} />
            <In label="Price (₹)" type="number" value={String(f.price ?? 0)} onChange={(v) => set("price")(Number(v) || 0)} />
            <In label="GST %" type="number" value={String(f.taxPercent ?? 18)} onChange={(v) => set("taxPercent")(Number(v) || 0)} />
            <In label="Validity (months)" type="number" value={String(f.validityMonths ?? 12)} onChange={(v) => set("validityMonths")(Math.max(1, Number(v) || 12))} />
            <Sel label="Type" value={f.membershipType === "recurring" ? "Recurring" : "Non-recurring (one-time)"} onChange={(v) => set("membershipType")(v.startsWith("Recurring") ? "recurring" : "non_recurring")} options={["Non-recurring (one-time)", "Recurring"]} />
          </div>
          <SecH t="Benefits" em="· applied on the bill automatically" />
          <div className="grid gap-3 md:grid-cols-3">
            <In label="% off services" type="number" value={String(d.servicesPercent ?? 0)} onChange={(v) => set("discounts")({ ...d, servicesPercent: Math.min(100, Math.max(0, Number(v) || 0)) })} />
            <In label="% off products" type="number" value={String(d.productsPercent ?? 0)} onChange={(v) => set("discounts")({ ...d, productsPercent: Math.min(100, Math.max(0, Number(v) || 0)) })} />
            <In label="% off packages" type="number" value={String(d.packagesPercent ?? 0)} onChange={(v) => set("discounts")({ ...d, packagesPercent: Math.min(100, Math.max(0, Number(v) || 0)) })} />
          </div>
          <div className="mt-3">
            <div className="text-[11px] font-bold text-ink2">Service credits (MVP-style: a number of free sittings)</div>
            <input value={svc} onChange={(e) => setSvc(e.target.value)} placeholder="Search a service to add as a credit…" className="mt-1 w-full rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
            {svc && (
              <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-border bg-surface">
                {catalogue.filter((c) => c.name.toLowerCase().includes(svc.toLowerCase())).slice(0, 10).map((c) => (
                  <button key={c._id} className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-ivory" onClick={() => { set("credits")([...(f.credits ?? []), { serviceId: c.id || c._id, serviceName: c.name, qty: 1 }]); setSvc(""); }}>{c.name} <span className="text-ink3">{c.category}</span></button>
                ))}
              </div>
            )}
            {(f.credits ?? []).map((c, i) => (
              <div key={`${c.serviceId}-${i}`} className="mt-1.5 flex items-center gap-2 rounded-lg bg-ivory px-2.5 py-1.5 text-[12.5px]">
                <span className="flex-1"><B>{c.serviceName || c.serviceId}</B></span>
                <input type="number" min={1} value={c.qty} onChange={(e) => set("credits")((f.credits ?? []).map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12px]" />
                <button className="text-ink3 hover:text-err" onClick={() => set("credits")((f.credits ?? []).filter((_, j) => j !== i))}><X size={13} /></button>
              </div>
            ))}
          </div>
          <div className="mt-3"><Area label="Benefit copy (one per line, printed on the card)" value={(f.benefits ?? []).join("\n")} onChange={(v) => set("benefits")(v.split("\n").map((x) => x.trim()).filter(Boolean))} rows={2} /></div>
          <div className="mt-3"><Area label="Terms" value={f.terms ?? ""} onChange={set("terms")} rows={2} /></div>
        </div>
        <div className="grid content-start gap-3">
          <Switch label="Active" sub="Can be sold and honoured" on={f.isActive !== false} onChange={set("isActive")} />
          <Switch label="App card plan" sub="The plan the app's Zen Membership card enrols" on={!!f.isAppDefault} onChange={set("isAppDefault")} gold />
          <Switch label="Price includes GST" on={f.priceIncludesTax !== false} onChange={set("priceIncludesTax")} />
          <div>
            <div className="text-[11px] font-bold text-ink2">Sold / honoured at</div>
            <div className="mt-1 grid gap-1">
              {branches.map((b) => { const on = (f.branchIds ?? []).map(String).includes(String(b._id)); return (
                <label key={b._id} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={on} onChange={(e) => set("branchIds")(e.target.checked ? [...(f.branchIds ?? []), b._id] : (f.branchIds ?? []).filter((x) => String(x) !== String(b._id)))} />{b.name}</label>
              ); })}
              <div className="text-[10.5px] text-ink3">None ticked = every centre.</div>
            </div>
          </div>
          {plan?.source === "zenoti" && <Note className="my-0">Linked to Zenoti, but <B>name, price, discounts and credits are set here</B> — Zenoti&rsquo;s rows disagree with each other on price and its API never exposes discounts or credits. Only the link to Zenoti follows the sync.</Note>}
          {err && <Note kind="crit">{err}</Note>}
          <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={busy} onClick={save}>{busy ? "Saving…" : plan ? "Save plan" : "Create plan"}</Btn></div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ sell / grant ------------------------------ */

const SELL_METHODS = ["Cash", "Card", "UPI", "Bank Transfer", "Pay at clinic", "Complimentary"];

export function SellMembershipModal({ open, onClose, onDone, user: fixedUser }: { open: boolean; onClose: () => void; onDone: () => void; user?: User | null }) {
  const { toast, branchId } = useStore();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<User | null>(fixedUser ?? null);
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const [txn, setTxn] = useState("");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plans = useApi(() => (open ? api.memberships.list() : Promise.resolve([] as Membership[])), [open]);
  const found = useApi(() => (open && !user && q.trim().length >= 2 ? api.patients.list({ search: q.trim(), limit: 8 }) : Promise.resolve(null)), [open, q, user?._id]);
  useEffect(() => { if (open) { setUser(fixedUser ?? null); setQ(""); setPlanId(""); setMethod("Cash"); setAmount(""); setTxn(""); setStart(""); setErr(null); } }, [open, fixedUser?._id]);
  const plan = (plans.data ?? []).find((p) => p._id === planId);
  useEffect(() => { if (plan) setAmount(String(plan.price)); }, [plan?._id]);
  const received = method !== "Pay at clinic";
  return (
    <Modal open={open} onClose={onClose} title="Sell / grant a membership">
      <div className="grid gap-3">
        {!user ? (
          <div>
            <In label="Guest (name or phone)" value={q} onChange={setQ} placeholder="Type at least 2 characters" />
            {(found.data?.data as { users?: User[] } | undefined)?.users?.length ? (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface">
                {((found.data?.data as { users?: User[] })?.users ?? []).map((u) => <button key={u._id} className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-ivory" onClick={() => setUser(u)}><B>{u.fullName}</B> <span className="text-ink3">{u.phone}{u.memberType === "Zen Member" ? " · already a member" : ""}</span></button>)}
              </div>
            ) : null}
          </div>
        ) : <div className="flex items-center justify-between rounded-lg bg-ivory px-3 py-2 text-[12.5px]"><span><B>{user.fullName}</B> <span className="text-ink3">{user.phone}</span></span>{!fixedUser && <button className="text-[11px] text-ink3 underline-offset-2 hover:underline" onClick={() => setUser(null)}>change</button>}</div>}
        <Sel label="Plan" value={plan ? `${plan.name} · ${fmtINR(plan.price)} · ${plan.validityMonths} mo` : ""} onChange={(v) => setPlanId((plans.data ?? []).find((p) => `${p.name} · ${fmtINR(p.price)} · ${p.validityMonths} mo` === v)?._id ?? "")} options={["", ...(plans.data ?? []).filter((p) => p.isActive).map((p) => `${p.name} · ${fmtINR(p.price)} · ${p.validityMonths} mo`)]} />
        {plan && <Note className="my-0">{[plan.discounts.servicesPercent ? `${plan.discounts.servicesPercent}% off services` : "", plan.discounts.productsPercent ? `${plan.discounts.productsPercent}% off products` : "", plan.credits.length ? `credits: ${plan.credits.map((c) => `${c.serviceName || c.serviceId} ×${c.qty}`).join(", ")}` : ""].filter(Boolean).join(" · ") || "No % discount configured on this plan yet."} Member no. will be {(plan.prefix ?? "") + String(plan.seed ?? 1)}.</Note>}
        <div className="grid gap-3 md:grid-cols-2">
          <Sel label="Payment" value={method} onChange={setMethod} options={SELL_METHODS} />
          <In label="Amount (₹)" type="number" value={method === "Complimentary" ? "0" : amount} onChange={setAmount} readOnly={method === "Complimentary"} />
          <In label="Transaction / receipt no." value={txn} onChange={setTxn} />
          <In label="Starts on (blank = today / after current expiry)" type="date" value={start} onChange={setStart} />
        </div>
        <Note className="my-0">To take the money on a GST bill instead, open the guest's invoice and add the plan from the Membership tab — the bill closing enrols them.</Note>
        {err && <Note kind="crit">{err}</Note>}
        <div className="flex justify-end gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={busy || !user || !plan} onClick={async () => {
            if (!user || !plan) return; setBusy(true); setErr(null);
            try {
              const r = await api.memberships.sell({ userId: user._id, membershipId: plan._id, branchId: branchId || null, startDate: start || undefined, paymentMethod: method, amount: method === "Complimentary" ? 0 : Number(amount) || 0, paymentReceived: received && method !== "Complimentary" ? true : method === "Complimentary", transactionId: txn || undefined });
              toast(r.message || "Membership granted"); onDone();
            } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Grant membership"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ member drawer ------------------------------ */

function MemberDrawer({ a, onClose, onChanged, canEdit }: { a: MembershipAssignment | null; onClose: () => void; onChanged: () => void; canEdit: boolean }) {
  const { toast } = useStore();
  const [validUntil, setValidUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (a) { setValidUntil(a.validUntil ? String(a.validUntil).slice(0, 10) : ""); setReason(""); setErr(null); } }, [a?._id]);
  if (!a) return null;
  return (
    <Modal open onClose={onClose} title={`${a.snapshot?.name ?? "Membership"} · ${a.memberNumber ?? ""}`} wide>
      <div className="grid gap-1.5 text-[12.5px]">
        <div className="flex justify-between"><span className="text-ink3">Guest</span><B>{nameOf(a.userId, "Guest")}</B></div>
        <div className="flex justify-between"><span className="text-ink3">Valid</span><span>{fmtDate(a.validFrom)} → {a.validUntil ? fmtDate(a.validUntil) : "no expiry"}</span></div>
        <div className="flex justify-between"><span className="text-ink3">Discounts</span><span>{[a.snapshot?.discounts?.servicesPercent ? `${a.snapshot.discounts.servicesPercent}% services` : "", a.snapshot?.discounts?.productsPercent ? `${a.snapshot.discounts.productsPercent}% products` : ""].filter(Boolean).join(" · ") || "—"}</span></div>
        <div className="flex justify-between"><span className="text-ink3">Payment</span><span>{a.payment?.isReceived ? <Tag kind="ok">{fmtINR(a.price)} · {a.payment.paymentMethod}</Tag> : <Tag kind="warn">{fmtINR(a.payment?.balanceDue ?? a.price)} due</Tag>}</span></div>
        <div className="flex justify-between"><span className="text-ink3">Status</span><Tag kind={a.status === "Active" ? "ok" : "mute"}>{a.status}</Tag></div>
        <div className="flex justify-between"><span className="text-ink3">Sold by</span><span>{a.soldByName ?? "—"} · {a.source}</span></div>
        <div className="flex items-center justify-between gap-2"><span className="text-ink3">Zenoti</span>
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            <ZenotiSyncTag a={a} />
            {a.zenotiInvoiceNumber && <span className="font-mono text-[11px] text-ink3">{a.zenotiInvoiceNumber}</span>}
            {a.zenotiSyncedAt && <span className="text-[11px] text-ink3">{fmtDate(a.zenotiSyncedAt)}</span>}
            {canEdit && canPushToZenoti(a) && <PushToZenotiButton a={a} onDone={onChanged} />}
          </span>
        </div>
        {a.zenotiSyncError && <Note kind="crit" className="my-0 text-[11.5px]">{a.zenotiSyncError}</Note>}
      </div>
      {a.credits.length > 0 && (
        <>
          <SecH t="Service credits" />
          <table className="w-full text-[12.5px]"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-ink3"><th>Service</th><th className="text-right">Qty</th><th className="text-right">Used</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{a.credits.map((c) => <tr key={c.serviceId} className="border-t border-border/60"><td className="py-1">{c.serviceName || c.serviceId}</td><td className="text-right">{c.qty}</td><td className="text-right">{c.used}</td><td className="text-right font-bold">{Math.max(0, c.qty - c.used)}</td></tr>)}</tbody></table>
        </>
      )}
      {(a.redemptions ?? []).length > 0 && (
        <>
          <SecH t="Redemptions" em={`· ${(a.redemptions ?? []).length}`} />
          <div className="max-h-40 overflow-y-auto text-[12px]">{(a.redemptions ?? []).map((r, i) => <div key={i} className={`flex justify-between border-t border-border/60 py-1 ${r.reversed ? "text-ink3 line-through" : ""}`}><span>{fmtDate(r.at)} · {r.kind === "credit" ? `${r.serviceName || r.serviceId} credit` : `${fmtINR(r.amount)} discount`}</span><span className="font-mono text-[11px] text-ink3">{r.invoiceNumber ?? ""}</span></div>)}</div>
        </>
      )}
      {canEdit && a.status === "Active" && (
        <>
          <SecH t="Manage" />
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <In label="Valid until" type="date" value={validUntil} onChange={setValidUntil} />
            <div className="flex items-end"><Btn kind="ghost" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await api.memberships.updateMember(a._id, { validUntil: validUntil || null }); toast("Validity updated"); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>Save</Btn></div>
          </div>
          {!a.payment?.isReceived && <div className="mt-2"><Btn kind="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await api.memberships.updateMember(a._id, { payment: { isReceived: true, amountPaid: a.price, balanceDue: 0 } }); toast("Marked paid"); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>Mark paid</Btn></div>}
          <div className="mt-3 grid gap-2">
            <Area label="Cancel — reason" value={reason} onChange={setReason} rows={2} />
            <div className="flex justify-end"><Btn kind="danger" disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); setErr(null); try { await api.memberships.cancelMember(a._id, { reason: reason.trim() }); toast("Membership cancelled"); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>Cancel membership</Btn></div>
          </div>
        </>
      )}
      {err && <Note kind="crit">{err}</Note>}
    </Modal>
  );
}
