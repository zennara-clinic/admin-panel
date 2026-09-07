import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Page, Btn, Tag, Card, DataTable, B, Tabs, Note, Hint, In, Sel, Area, Toggle, Switch, Stats,
  SecH, Modal, Drawer, DeleteModal, Async, Empty, Loading, StaleBanner, exportCsv, UploadField, Menu, FilterDrawer, FSection, Chips, MultiSelect, NumRange, ActiveFilters, ChartCard, GBars, HBars, AreaChart,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { openHtmlExport, download } from "../lib/http";
import { AssignPackageModal, PatientPickerModal } from "./reception";
import { SignInControls } from "./access";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import { fmtAgo, fmtCompactINR, fmtDate, fmtINR, fmtWhen, imageUrl, initials, isoDay, nameOf } from "../lib/format";
import type { Admin, Category, Consultation, Doctor, DoctorFeeRequest, Package, PackageAssignment, PackageSession, ServiceType, User } from "../lib/types";
import type { AuditAction } from "../store";

/* ================= SERVICES ================= */
type ServiceFilters = { status: string; popular: string; content: string; priceMin: string; priceMax: string; pricing: string; sort: string };
const EMPTY_SF: ServiceFilters = { status: "", popular: "", content: "", priceMin: "", priceMax: "", pricing: "", sort: "order" };

/** Pick the Zenoti catalogue record a local service/package is written to Zenoti as. */
function ZenotiPick({ label, value, onChange, kind, hint }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; kind: "services" | "packages"; hint?: string }) {
  const q = useApi(() => (kind === "services" ? api.zenoti.catalogServices() : api.zenoti.catalogPackages()).catch(() => [] as { id: string; name: string; code?: string | null }[]), [kind]);
  const rows = (q.data ?? []) as { id: string; name: string; code?: string | null; canBook?: boolean | null; price?: number | null }[];
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = rows.filter((r) => !query || r.name.toLowerCase().includes(query) || (r.code ?? "").toLowerCase().includes(query));
  const current = rows.find((r) => r.id === (value ?? "").toLowerCase());
  return (
    <div className="flex flex-col gap-1 col-span-full">
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search Zenoti ${kind}…`}
          className="w-56 rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
          className="min-w-64 flex-1 rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark">
          <option value="">— not mapped (nothing is written to Zenoti) —</option>
          {current && !visible.some((r) => r.id === current.id) && <option value={current.id}>{current.name}{current.code ? ` · ${current.code}` : ""}</option>}
          {visible.map((r) => <option key={r.id} value={r.id}>{r.name}{r.code ? ` · ${r.code}` : ""}{"price" in r && r.price != null ? ` · ₹${r.price}` : ""}{"canBook" in r && r.canBook === false ? " · not bookable online" : ""}</option>)}
        </select>
      </div>
      <div className="text-[10.5px] text-ink3">{q.loading ? "Loading the Zenoti catalogue…" : hint ?? `${rows.length} in Zenoti`}</div>
    </div>
  );
}

export function Services() {
  const nav = useNavigate();
  const { can, toast, audit, branchId } = useStore();
  const [search, setSearch] = useQueryString("q");
  const [type, setType] = useQueryString("type", "");
  const [category, setCategory] = useQueryString("category", "");
  const [grid, setGrid] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [applied, setApplied] = useState<ServiceFilters>(EMPTY_SF);
  const [draft, setDraft] = useState<ServiceFilters>(EMPTY_SF);
  const debounced = useDebounced(search);

  const types = useApi(() => api.serviceTypes.list(), []);
  const cats = useApi(() => api.categories.list(), []);
  const q = useApi(() => api.services.list({ limit: 500, includeInactive: "true" }), []);

  const services = q.data?.data ?? [];
  const typeRows = types.data?.data ?? [];
  const allCategories = cats.data?.data ?? [];

  // Tree: type → categories (from the taxonomy plus anything services reference).
  const tree = useMemo(() => {
    const byType = new Map<string, Set<string>>();
    const order = [...typeRows.map((t) => t.name)];
    typeRows.forEach((t) => byType.set(t.name, new Set()));
    allCategories.forEach((c) => { const k = c.type || "Unfiled"; if (!byType.has(k)) { byType.set(k, new Set()); order.push(k); } byType.get(k)!.add(c.name); });
    services.forEach((s) => { const k = s.type || "Unfiled"; if (!byType.has(k)) { byType.set(k, new Set()); order.push(k); } if (s.category) byType.get(k)!.add(s.category); });
    return order.map((t) => ({ type: t, categories: [...(byType.get(t) ?? [])].sort((a, b) => a.localeCompare(b)) }));
  }, [typeRows, allCategories, services]);

  const countType = (t: string) => services.filter((s) => (s.type || "Unfiled") === t).length;
  const countCat = (t: string, c: string) => services.filter((s) => (s.type || "Unfiled") === t && s.category === c).length;

  const needsContent = (s: Consultation) => !s.image?.trim() || !s.price;
  const incomplete = services.filter(needsContent).length;

  const list = useMemo(() => {
    const term = debounced.toLowerCase();
    let out = services.filter((s) =>
      (!type || (s.type || "Unfiled") === type) &&
      (!category || s.category === category) &&
      (!term || s.name.toLowerCase().includes(term) || (s.summary ?? "").toLowerCase().includes(term) || (s.tags ?? []).some((t) => t.toLowerCase().includes(term)) || (s.category ?? "").toLowerCase().includes(term)) &&
      (!applied.status || (applied.status === "active" ? s.isActive : !s.isActive)) &&
      (!applied.popular || !!s.isPopular) &&
      (!applied.content || (applied.content === "needs" ? needsContent(s) : !needsContent(s))) &&
      (!applied.pricing || (applied.pricing === "shown" ? !!s.showPriceInApp : applied.pricing === "hidden" ? !s.showPriceInApp : applied.pricing === "online" ? s.chargeOnlineBooking !== false : s.chargeOnlineBooking === false)) &&
      (!applied.priceMin || s.price >= Number(applied.priceMin)) &&
      (!applied.priceMax || s.price <= Number(applied.priceMax)));
    const sorters: Record<string, (a: Consultation, b: Consultation) => number> = {
      order: () => 0, name: (a, b) => a.name.localeCompare(b.name), priceAsc: (a, b) => a.price - b.price, priceDesc: (a, b) => b.price - a.price,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0), newest: (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    };
    if (applied.sort !== "order") out = [...out].sort(sorters[applied.sort] ?? sorters.order);
    return out;
  }, [services, type, category, debounced, applied]);

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const clear = (patch: Partial<ServiceFilters>) => { const next = { ...applied, ...patch }; setApplied(next); setDraft(next); };
  if (applied.status) chips.push({ key: "st", label: applied.status === "active" ? "Active only" : "Inactive only", onRemove: () => clear({ status: "" }) });
  if (applied.popular) chips.push({ key: "pop", label: "Popular", onRemove: () => clear({ popular: "" }) });
  if (applied.content) chips.push({ key: "c", label: applied.content === "needs" ? "Needs photo/price" : "Complete", onRemove: () => clear({ content: "" }) });
  if (applied.pricing) chips.push({ key: "p", label: { shown: "Price shown", hidden: "Price on consultation", online: "Paid in app", clinic: "Pay at clinic" }[applied.pricing] ?? applied.pricing, onRemove: () => clear({ pricing: "" }) });
  if (applied.priceMin || applied.priceMax) chips.push({ key: "pr", label: `₹${applied.priceMin || 0}–${applied.priceMax || "∞"}`, onRemove: () => clear({ priceMin: "", priceMax: "" }) });

  // Manual ordering inside one category — the app lists in this order.
  const canReorder = can("services.manage") && !!category && !debounced && !grid && applied.sort === "order";
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    try {
      await api.services.reorder(next.map((x, k) => ({ id: x._id, displayOrder: k })));
      audit("CATALOGUE_UPDATED", `Reordered ${category}`, {});
      q.reload();
    } catch (e) { toast((e as Error).message); }
  };

  // Group the result by category when the whole tree (or a type) is shown.
  const groups = useMemo(() => {
    if (category) return [[category, list] as [string, Consultation[]]];
    const m = new Map<string, Consultation[]>();
    list.forEach((s) => { const k = `${s.type || "Unfiled"} › ${s.category || "—"}`; m.set(k, [...(m.get(k) ?? []), s]); });
    return [...m.entries()];
  }, [list, category]);

  const open = (s: Consultation) => nav("/service-editor", { state: { id: s._id } });
  const row = (s: Consultation, i: number, withOrder: boolean) => [
    ...(withOrder ? [
      <span key={`${s._id}o`} className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-border px-1.5 text-[11px] disabled:opacity-30">↑</button>
        <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="rounded border border-border px-1.5 text-[11px] disabled:opacity-30">↓</button>
      </span>,
    ] : []),
    <span key={s._id} className="flex items-center gap-2.5">
      {s.image ? <img src={s.image} alt="" className="h-9 w-12 shrink-0 rounded-md object-cover" /> : <span className="h-9 w-12 shrink-0 rounded-md bg-gradient-to-br from-sage to-cream" />}
      <span>
        <B>{s.name}</B>
        {needsContent(s) && <span className="ml-1.5 rounded-full bg-warn-bg px-1.5 py-0.5 text-[9px] font-bold text-warn">needs {!s.image?.trim() ? "photo" : "price"}</span>}
        <span className="block text-[11px] text-ink3 line-clamp-1">{s.summary}</span>
      </span>
    </span>,
    <span key={`${s._id}p`}>{s.showPriceInApp ? <B>{fmtINR(s.price)}</B> : <span className="text-ink3">On consultation <span className="text-[10.5px]">({fmtINR(s.price)})</span></span>}<span className="block text-[10.5px] text-ink3">{s.chargeOnlineBooking === false ? "pay at clinic" : "paid in app"}</span></span>,
    s.rating ? <span key={`${s._id}r`}>★ {s.rating.toFixed(1)} <span className="text-[10.5px] text-ink3">({s.reviews ?? 0})</span></span> : <span key={`${s._id}r`} className="text-ink3">—</span>,
    <span key={`${s._id}f`} className="flex flex-wrap gap-1">
      {s.isPopular && <Tag kind="gold">★ popular</Tag>}
      {(s.media?.length ?? 0) > 0 && <Tag kind="info">{s.media!.length} media</Tag>}
      {(s.faqs?.length ?? 0) > 0 && <Tag kind="mute">{s.faqs!.length} FAQ</Tag>}
    </span>,
    s.isActive ? <Tag key={`${s._id}s`} kind="ok">Live in app</Tag> : <Tag key={`${s._id}s`} kind="mute">Hidden</Tag>,
  ];

  return (
    <Page title="Services"
      sub={`${typeRows.length} types · ${allCategories.length} categories · ${services.length} services — exactly what the app sells`}
      actions={<>
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          <button onClick={() => setGrid(false)} className={`px-3 py-2 text-[12.5px] font-bold ${!grid ? "bg-primary text-white" : "bg-surface text-ink2"}`}>☰ List</button>
          <button onClick={() => setGrid(true)} className={`px-3 py-2 text-[12.5px] font-bold ${grid ? "bg-primary text-white" : "bg-surface text-ink2"}`}>▦ Grid</button>
        </div>
        <Menu align="right" button={<Btn kind="ghost">Sort ▾</Btn>} items={[["order", "App order"], ["name", "Name"], ["priceAsc", "Price ↑"], ["priceDesc", "Price ↓"], ["rating", "Rating"], ["newest", "Newest"]].map(([v, l]) => ({ label: `${l}${applied.sort === v ? " ✓" : ""}`, onClick: () => clear({ sort: v }) }))} />
        <Btn kind={chips.length ? "gold" : "ghost"} onClick={() => { setDraft(applied); setDrawer(true); }}>Filters{chips.length ? ` (${chips.length})` : ""}</Btn>
        <Btn kind="ghost" disabled={!list.length} onClick={() => exportCsv("zennara-services",
          ["Name", "Type", "Category", "Price", "Price shown", "Paid in app", "Popular", "Active", "Rating", "Reviews"],
          list.map((s) => [s.name, s.type ?? "", s.category, s.price, s.showPriceInApp ? "yes" : "no", s.chargeOnlineBooking === false ? "no" : "yes", s.isPopular ? "yes" : "no", s.isActive ? "yes" : "no", s.rating ?? "", s.reviews ?? 0]))}>Export CSV</Btn>
        <Menu button={<Btn kind="ghost">Price list ▾</Btn>} items={[{ label: "Open printable price list", onClick: () => { openHtmlExport("/bulk/price-list", { format: "html", branchId: branchId || undefined }, "Zennara price list").catch((e) => toast((e as Error).message)); } }, { label: "Download CSV", onClick: () => { download(`/bulk/price-list?format=csv${branchId ? `&branchId=${branchId}` : ""}`, "zennara-price-list.csv").catch((e) => toast((e as Error).message)); } }]} />
        {can("services.manage") && <Btn onClick={() => nav("/service-editor", { state: { blank: true, type: type || undefined, category: category || undefined } })}>+ New service</Btn>}
      </>}>
      <Hint id="services-live">Pick a type or category on the left; everything on the right is exactly what the app shows. Click a service to edit its photo, gallery, price, copy, pre/post care and FAQs.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <div className="grid items-start gap-3.5 xl:grid-cols-[250px_minmax(0,1fr)]">
        {/* ---- taxonomy tree ---- */}
        <Card className="sticky top-[72px] max-h-[calc(100vh-96px)] overflow-y-auto p-2">
          <button onClick={() => { setType(""); setCategory(""); }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] font-bold ${!type && !category ? "bg-primary text-white" : "hover:bg-ivory"}`}>
            <span>All services</span><span className={`font-mono text-[10.5px] ${!type && !category ? "text-white/70" : "text-ink3"}`}>{services.length}</span>
          </button>
          {tree.map((t) => (
            <div key={t.type} className="mt-1">
              <button onClick={() => { setType(t.type); setCategory(""); }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-bold ${type === t.type && !category ? "bg-primary text-white" : "hover:bg-ivory"}`}>
                <span>{t.type}</span><span className={`font-mono text-[10.5px] ${type === t.type && !category ? "text-white/70" : "text-ink3"}`}>{countType(t.type)}</span>
              </button>
              {(type === t.type || !type) && t.categories.map((c) => (
                <button key={c} onClick={() => { setType(t.type); setCategory(c); }}
                  className={`ml-3 flex w-[calc(100%-12px)] items-center justify-between rounded-lg px-2.5 py-1 text-left text-[11.5px] ${type === t.type && category === c ? "bg-gold/20 font-bold text-primary" : "text-ink2 hover:bg-ivory"}`}>
                  <span className="truncate">{c}</span><span className="ml-2 font-mono text-[10px] text-ink3">{countCat(t.type, c)}</span>
                </button>
              ))}
            </div>
          ))}
          {can("services.manage") && <Btn kind="ghost" className="mt-2 w-full !text-[11.5px]" onClick={() => nav("/categories")}>Manage types & categories</Btn>}
        </Card>

        {/* ---- results ---- */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services, categories, tags…"
              className="w-full max-w-[380px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
            <span className="text-[12px] text-ink3">{list.length} of {services.length}{category ? ` in ${category}` : type ? ` in ${type}` : ""}</span>
            {incomplete > 0 && !applied.content && (
              <button onClick={() => clear({ content: "needs" })} className="ml-auto rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-bold text-warn">{incomplete} need a photo or price →</button>
            )}
          </div>
          <ActiveFilters items={chips} onClear={() => clear({ ...EMPTY_SF, sort: applied.sort })} />

          <Async q={q} label="Loading the service catalogue…" rows={8}>
            {() => list.length === 0 ? (
              <Empty title="No services here" hint={debounced || chips.length ? "Nothing matched the search/filters." : "Create the first service for this category."}
                action={can("services.manage") ? <Btn onClick={() => nav("/service-editor", { state: { blank: true, type: type || undefined, category: category || undefined } })}>+ New service</Btn> : undefined} />
            ) : grid ? (
              groups.map(([title, items]) => (
                <div key={title} className="mb-5">
                  {!category && <div className="mb-2 flex items-baseline gap-2"><span className="text-[13px] font-extrabold">{title}</span><span className="text-[11.5px] text-ink3">{items.length}</span></div>}
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {items.map((s) => (
                      <Card key={s._id} onClick={() => open(s)} className="group overflow-hidden">
                        <div className="relative">
                          {s.image ? <img src={s.image} alt="" className="h-36 w-full object-cover" /> : <div className="h-36 bg-gradient-to-br from-sage to-cream" />}
                          <div className="absolute left-2 top-2 flex gap-1">
                            {s.isPopular && <Tag kind="gold">★</Tag>}
                            {!s.isActive && <Tag kind="mute">Hidden</Tag>}
                          </div>
                          {needsContent(s) && <span className="absolute bottom-2 left-2 rounded-full bg-warn-bg px-1.5 py-0.5 text-[9px] font-bold text-warn">needs {!s.image?.trim() ? "photo" : "price"}</span>}
                        </div>
                        <div className="p-3">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">{s.category}</div>
                          <b className="mt-0.5 block text-[13.5px] font-bold leading-tight">{s.name}</b>
                          <div className="mt-1 line-clamp-2 text-[11.5px] text-ink3">{s.summary}</div>
                          <div className="mt-2.5 flex items-center justify-between">
                            <b className="text-[13.5px]">{s.showPriceInApp ? fmtINR(s.price) : "On consultation"}</b>
                            <span className="text-[11px] text-ink3">{s.rating ? `★ ${s.rating.toFixed(1)}` : ""}{(s.media?.length ?? 0) > 0 ? ` · ${s.media!.length} media` : ""}</span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              groups.map(([title, items]) => (
                <div key={title} className="mb-5">
                  {!category && <div className="mb-2 flex items-baseline gap-2"><span className="text-[13px] font-extrabold">{title}</span><span className="text-[11.5px] text-ink3">{items.length}</span></div>}
                  <DataTable
                    cols={[...(canReorder ? ["Order"] : []), "Service", "Price", "Rating", "Content", "Status"]}
                    onRow={(i) => open(items[i])}
                    rows={items.map((s, i) => row(s, i, canReorder))} />
                </div>
              ))
            )}
          </Async>
        </div>
      </div>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} title="Filter services" activeCount={chips.length}
        onApply={() => setApplied(draft)} onReset={() => setDraft({ ...EMPTY_SF, sort: draft.sort })}>
        <FSection title="Status"><Chips options={[["", "All"], ["active", "Live in app"], ["inactive", "Hidden"]]} value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v as string }))} /></FSection>
        <FSection title="Highlights"><Chips options={[["1", "Popular only"]]} value={draft.popular} onChange={(v) => setDraft((d) => ({ ...d, popular: v as string }))} /></FSection>
        <FSection title="Content"><Chips options={[["", "Any"], ["needs", "Needs photo or price"], ["complete", "Complete"]]} value={draft.content} onChange={(v) => setDraft((d) => ({ ...d, content: v as string }))} /></FSection>
        <FSection title="Pricing">
          <Chips options={[["shown", "Price shown"], ["hidden", "Price on consultation"], ["online", "Paid in app"], ["clinic", "Pay at clinic"]]} value={draft.pricing} onChange={(v) => setDraft((d) => ({ ...d, pricing: v as string }))} />
          <div className="mt-2"><NumRange prefix="₹" min={draft.priceMin} max={draft.priceMax} onChange={(a, b) => setDraft((d) => ({ ...d, priceMin: a, priceMax: b }))} /></div>
        </FSection>
        <FSection title="Sort"><Chips options={[["order", "App order"], ["name", "Name"], ["priceAsc", "Price ↑"], ["priceDesc", "Price ↓"], ["rating", "Rating"], ["newest", "Newest"]]} value={draft.sort} onChange={(v) => setDraft((d) => ({ ...d, sort: (v as string) || "order" }))} /></FSection>
      </FilterDrawer>
    </Page>
  );
}

/* ================= SERVICE EDITOR ================= */
const BLANK: Partial<Consultation> = {
  name: "", category: "", summary: "", about: "", price: 0, image: "",
  key_benefits: [], ideal_for: [], tags: [], pre_care: [], post_care: [], faqs: [],
  isActive: true, showPriceInApp: true, chargeOnlineBooking: true, isPopular: false, cta_label: "Book Consultation",
};

export function ServiceEditor() {
  const nav = useNavigate();
  const loc = useLocation();
  const { toast, audit, can } = useStore();
  const [sp] = useSearchParams();
  const state = { ...((loc.state as { id?: string; blank?: boolean; type?: string; category?: string; cloneFrom?: string } | null) ?? {}) };
  if (!state.id && sp.get("id")) state.id = sp.get("id") ?? undefined;
  const isNew = !state.id;

  const [f, setF] = useState<Partial<Consultation>>({ ...BLANK, type: state.type ?? null, category: state.category ?? "" });
  const [section, setSection] = useState(0);
  const [delOpen, setDelOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const types = useApi(() => api.serviceTypes.list(), []);
  const cats = useApi(() => api.categories.list(), []);
  const q = useApi(
    () => (state.id ? api.services.get(state.id)
      : state.cloneFrom ? api.services.get(state.cloneFrom).then((c) => ({ ...c, _id: undefined, id: undefined, slug: undefined, name: `${c.name} (copy)`, code: null, zenotiServiceId: null, createdAt: undefined } as unknown as Consultation))
      : Promise.resolve(BLANK as Consultation)),
    [state.id, state.cloneFrom],
  );

  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);

  const set = <K extends keyof Consultation>(k: K) => (v: Consultation[K]) => setF((s) => ({ ...s, [k]: v }));
  const setList = (k: "key_benefits" | "ideal_for" | "tags" | "pre_care" | "post_care") => (v: string) =>
    setF((s) => ({ ...s, [k]: v.split("\n").map((x) => x.trim()).filter(Boolean) }));

  const typeOptions = (types.data?.data ?? []).map((t) => t.name);
  const allCats = cats.data?.data ?? [];
  /* Only offer categories that belong to the chosen type — the tree stays valid. */
  const scopedCats = f.type ? allCats.filter((c) => c.type === f.type) : allCats;
  const categoryOptions = (scopedCats.length ? scopedCats : allCats).map((c) => c.name);

  // A <select> always shows *something*; make sure state matches what it shows,
  // otherwise a form that looks filled in is rejected on save.
  useEffect(() => {
    if (!f.type && typeOptions.length) setF((s) => ({ ...s, type: typeOptions[0] }));
  }, [typeOptions.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (categoryOptions.length && (!f.category || !categoryOptions.includes(f.category))) {
      setF((s) => ({ ...s, category: categoryOptions[0] }));
    }
  }, [categoryOptions.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadImage = (file: File) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "");

  const save = async () => {
    setErr(null);
    if (!f.name?.trim()) return setErr("A sub-category name is required");
    if (!f.type) return setErr("Pick a type — it is the top level of the menu");
    if (!f.category) return setErr("Pick a treatment category");
    if (!f.summary?.trim()) return setErr("A short summary is required — the app shows it on cards");
    if (!f.about?.trim()) return setErr("The 'about' text is required — the app shows it on the detail page");
    if (f.price === undefined || f.price === null || Number.isNaN(Number(f.price))) return setErr("A price is required (0 is allowed)");

    setBusy(true);
    try {
      // The server owns `id`/`slug`; sending them back would pin a rename to the old slug.
      const { _id, id, slug, createdAt, updatedAt, rating, reviews, ...rest } = f as Consultation & { updatedAt?: string };
      void _id; void id; void slug; void createdAt; void updatedAt; void rating; void reviews;
      const body: Partial<Consultation> = {
        ...rest,
        price: Number(f.price) || 0,
        faqs: (f.faqs ?? []).filter((x) => x.q?.trim() || x.a?.trim()),
      };
      if (isNew) {
        const created = await api.services.create(body);
        audit("CATALOGUE_CREATED", `Service ${created.name}`, { serviceId: created._id });
        toast("Service created — live in the app");
        nav("/service-editor", { state: { id: created._id }, replace: true });
      } else {
        await api.services.update(state.id!, body);
        audit("CATALOGUE_UPDATED", `Service ${f.name}`, { serviceId: state.id });
        toast("Service saved — live in the app");
        q.reload();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (q.initial && !isNew) return <Page title="Service editor"><Loading label="Loading service…" rows={6} /></Page>;
  if (q.error && !q.data) return <Page title="Service editor"><Empty title="Couldn’t load that service" hint={q.error} action={<Btn onClick={() => nav("/services")}>← Back to services</Btn>} /></Page>;

  return (
    <Page title={isNew ? "New service" : "Service editor"}
      sub={isNew ? "Creating a new treatment" : `${f.name} · updated ${fmtDate((q.data as Consultation & { updatedAt?: string })?.updatedAt ?? q.data?.createdAt)}`}
      actions={<>
        <Btn kind="ghost" onClick={() => nav("/services")}>← All services</Btn>
        {!isNew && can("services.manage") && <Btn kind="ghost" onClick={() => nav("/service-editor", { state: { cloneFrom: state.id } })} >Clone</Btn>}
        {!isNew && can("services.manage") && <Btn kind="danger" onClick={() => setDelOpen(true)}>Delete</Btn>}
        {can("services.manage") && <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : isNew ? "Create service" : "Save changes"}</Btn>}
      </>}>
      {!can("services.manage") && <Note kind="crit">Your role can view the catalogue but not change it. Ask a Super Admin or Admin to make edits.</Note>}
      {err && <Note kind="crit">{err}</Note>}

      <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* The three levels, in order: type → treatment category → this. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-ivory px-3 py-2 text-[12px]">
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Sits under</span>
            <Tag kind={f.type ? "info" : "mute"}>{f.type || "no type"}</Tag>
            <span className="text-ink3">›</span>
            <Tag kind={f.category ? "info" : "mute"}>{f.category || "no category"}</Tag>
            <span className="text-ink3">›</span>
            <B>{f.name || "this service"}</B>
          </div>

          <Tabs active={section} onChange={setSection} items={[["Basics"], ["Photos & gallery", (f.media?.length ?? 0) + (f.image ? 1 : 0)], ["App copy"], ["Care instructions", (f.pre_care?.length ?? 0) + (f.post_care?.length ?? 0)], ["FAQs", f.faqs?.length ?? 0]]} />

          {section === 0 && (
            <Card className="p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <In label="Service name" value={f.name ?? ""} onChange={set("name")} hint="This is the treatment guests book" />
                {typeOptions.length
                  ? <Sel label="Type" value={f.type ?? typeOptions[0]} onChange={(v) => { set("type")(v); set("category")(""); }} options={typeOptions} />
                  : <In label="Type" value={f.type ?? ""} onChange={set("type")} hint="No types yet — add them under Categories → Types" />}
                {categoryOptions.length
                  ? <Sel label="Treatment category" value={f.category ?? categoryOptions[0]} onChange={set("category")} options={categoryOptions} />
                  : <In label="Treatment category" value={f.category ?? ""} onChange={set("category")} hint="No categories for this type yet" />}
                <In label="Price (₹)" type="number" value={String(f.price ?? 0)} onChange={(v) => set("price")(Number(v) || 0)} hint="Hidden in the app when 'Show price' is off" />
                <In label="Call-to-action label" value={f.cta_label ?? ""} onChange={set("cta_label")} placeholder="Book your appointment" hint="The button text under the service in the app" />
                <ZenotiPick kind="services" label="Zenoti service — what an app or panel booking of this is created as in Zenoti" value={f.zenotiServiceId} onChange={(v) => set("zenotiServiceId")(v)}
                  hint="Unmapped services still work here; they just cannot be written into Zenoti's diary." />
              </div>
              <div className="mt-3 grid gap-3">
                <Area label="Short summary — shown on app cards and under the title" value={f.summary ?? ""} onChange={set("summary")} rows={2} />
                <Area label="About — the detail page copy" value={f.about ?? ""} onChange={set("about")} rows={6} />
              </div>
              <SecH t="Visibility & booking" />
              <div className="grid gap-2 md:grid-cols-2">
                <Switch on={!!f.isActive} onChange={set("isActive")} label="Live in the app" sub="Off hides it from the app and from booking" />
                <Switch on={!!f.isPopular} onChange={set("isPopular")} gold label="Mark as popular" sub="Pins it to the app home rail" />
                <Switch on={!!f.showPriceInApp} onChange={set("showPriceInApp")} label="Show price in app" sub={'Off shows "Price on consultation"'} />
                <Switch on={f.chargeOnlineBooking !== false} onChange={set("chargeOnlineBooking")} label="Collect payment in the app" sub="On: the guest pays this price when booking. Off: they book and pay at the clinic." />
              </div>
            </Card>
          )}

          {section === 1 && (
            <Card className="p-4">
              <UploadField label="Cover photo" value={f.image ?? ""} onChange={set("image")} full upload={uploadImage}
                hint="The first image guests see — cards, the detail header and search" />
              <SecH t="Gallery" em="· photos and videos shown in the detail carousel after the cover" right={
                <label className="cursor-pointer rounded-(--radius-btn) border border-border bg-surface px-3 py-1.5 text-[12px] font-bold hover:border-gold-dark">
                  + Add files
                  <input type="file" multiple accept="image/*,video/mp4" className="hidden" onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (!files.length) return;
                    try {
                      const r = await api.media.upload(files);
                      const added = (r ?? []).map((m, k) => ({ type: /\.(mp4|mov|webm)(\?|$)/i.test(m.url) || files[k]?.type.startsWith("video/") ? "video" : "image", url: m.url }));
                      setF((s) => ({ ...s, media: [...(s.media ?? []), ...added] }));
                    } catch (err) { setErr((err as Error).message); }
                    e.target.value = "";
                  }} />
                </label>} />
              {(f.media?.length ?? 0) === 0 ? <div className="text-[12px] text-ink3">No gallery yet — the app shows just the cover photo.</div> : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {(f.media ?? []).map((m, i) => (
                    <div key={`${m.url}-${i}`} className="group relative overflow-hidden rounded-lg border border-border bg-ivory">
                      {m.type === "video" ? <video src={m.url} className="h-28 w-full object-cover" muted /> : <img src={m.url} alt="" className="h-28 w-full object-cover" />}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1.5 py-1 text-[10px] text-white">
                        <span>{m.type}</span>
                        <span className="flex gap-1">
                          <button onClick={() => setF((s) => { const arr = [...(s.media ?? [])]; if (i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; return { ...s, media: arr }; })} className="px-1">←</button>
                          <button onClick={() => setF((s) => { const arr = [...(s.media ?? [])]; if (i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; return { ...s, media: arr }; })} className="px-1">→</button>
                          <button onClick={() => setF((s) => ({ ...s, media: (s.media ?? []).filter((_, j) => j !== i) }))} className="px-1 font-bold">×</button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {section === 2 && (
            <Card className="p-4">
              <Note className="mt-0">One item per line. These appear in the app exactly in this order.</Note>
              <div className="grid gap-3 md:grid-cols-2">
                <Area label="Key benefits" value={(f.key_benefits ?? []).join("\n")} onChange={setList("key_benefits")} rows={6} />
                <Area label="Ideal for" value={(f.ideal_for ?? []).join("\n")} onChange={setList("ideal_for")} rows={6} />
                <Area label="Search tags" value={(f.tags ?? []).join("\n")} onChange={setList("tags")} rows={4} />
              </div>
            </Card>
          )}

          {section === 3 && (
            <Card className="p-4">
              <Note className="mt-0">Shown in the app as “Before your visit” and “After your treatment”. One instruction per line.</Note>
              <div className="grid gap-3 md:grid-cols-2">
                <Area label="Before your visit (pre-care)" value={(f.pre_care ?? []).join("\n")} onChange={setList("pre_care")} rows={7} />
                <Area label="After your treatment (post-care)" value={(f.post_care ?? []).join("\n")} onChange={setList("post_care")} rows={7} />
              </div>
            </Card>
          )}

          {section === 4 && (
            <Card className="p-4">
              <SecH t="FAQs" right={
                <Btn kind="ghost" className="!py-1 !text-[12px]"
                  onClick={() => setF((s) => ({ ...s, faqs: [...(s.faqs ?? []), { q: "", a: "" }] }))}>+ Add FAQ</Btn>} />
              {(f.faqs ?? []).length === 0 && <div className="text-[12px] text-ink3">No FAQs yet.</div>}
              {(f.faqs ?? []).map((faq, i) => (
                <div key={i} className="mb-2 rounded-xl border border-border bg-ivory p-2.5">
                  <div className="flex gap-2">
                    <input value={faq.q} placeholder="Question"
                      onChange={(e) => setF((s) => ({ ...s, faqs: (s.faqs ?? []).map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) }))}
                      className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
                    <button onClick={() => setF((s) => ({ ...s, faqs: (s.faqs ?? []).filter((_, j) => j !== i) }))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-err-bg text-[12px] font-bold text-err">×</button>
                  </div>
                  <textarea value={faq.a} placeholder="Answer" rows={2}
                    onChange={(e) => setF((s) => ({ ...s, faqs: (s.faqs ?? []).map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) }))}
                    className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* ---- how it looks in the app ---- */}
        <div className="grid gap-3">
          <Card className="overflow-hidden">
            <div className="border-b border-border bg-ivory px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">As seen in the app</div>
            {f.image ? <img src={f.image} alt="" className="h-40 w-full object-cover" /> : <div className="grid h-40 place-items-center bg-gradient-to-br from-sage to-cream text-[11px] text-ink3">No cover photo yet</div>}
            <div className="p-3.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">{f.category || "Category"}</div>
              <div className="mt-0.5 text-[16px] font-extrabold leading-tight">{f.name || "Service name"}</div>
              <div className="mt-1 text-[12px] text-ink2">{f.summary || "Short summary appears here."}</div>
              <div className="mt-2 text-[15px] font-bold">{f.showPriceInApp ? fmtINR(Number(f.price) || 0) : "Price on consultation"}</div>
              {(f.key_benefits?.length ?? 0) > 0 && (
                <ul className="mt-2 grid gap-1 text-[11.5px] text-ink2">{(f.key_benefits ?? []).slice(0, 3).map((b, i) => <li key={i}>✓ {b}</li>)}</ul>
              )}
              {(f.ideal_for?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1">{(f.ideal_for ?? []).slice(0, 4).map((t, i) => <span key={i} className="rounded-full bg-sage px-2 py-0.5 text-[10.5px]">{t}</span>)}</div>}
              <div className="mt-3 rounded-(--radius-btn) bg-primary py-2 text-center text-[12px] font-bold text-white">{f.cta_label || "Book your appointment"}</div>
              <div className="mt-2 text-[10.5px] text-ink3">{f.isActive ? "Visible in the app" : "Hidden from the app"} · {f.chargeOnlineBooking === false ? "pay at clinic" : "pays in app"}{f.isPopular ? " · popular" : ""}</div>
            </div>
          </Card>

          {!isNew && q.data && (
            <Card className="p-4">
              <SecH t="Live figures" />
              <div className="grid gap-1.5 text-[12.5px] text-ink2">
                <div className="flex justify-between"><span className="text-ink3">Rating</span><b>{q.data.rating ? q.data.rating.toFixed(1) : "—"}</b></div>
                <div className="flex justify-between"><span className="text-ink3">Reviews</span><b>{q.data.reviews ?? 0}</b></div>
                <div className="flex justify-between"><span className="text-ink3">Slug</span><b className="font-mono text-[11px]">{q.data.slug}</b></div>
              </div>
              <Btn kind="ghost" className="mt-3 w-full" onClick={async () => {
                try {
                  await api.services.toggle(state.id!);
                  audit("CATALOGUE_STATUS_CHANGED", `${f.name}`, { serviceId: state.id });
                  toast(f.isActive ? "Hidden from the app" : "Live in the app"); q.reload();
                } catch (e) { setErr((e as Error).message); }
              }}>{f.isActive ? "Hide from app now" : "Show in app now"}</Btn>
            </Card>
          )}
        </div>
      </div>

      <DeleteModal open={delOpen} onClose={() => setDelOpen(false)} what={`service "${f.name}"`}
        onConfirm={async (reason) => {
          try {
            await api.services.remove(state.id!);
            audit("CATALOGUE_DELETED", `${f.name} · reason: ${reason}`, { serviceId: state.id });
            toast("Service deleted"); nav("/services");
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

/* ================= CATEGORIES ================= */
export function Categories() {
  const nav = useNavigate();
  const [selType, setSelType] = useQueryString("type", "");
  const { toast, audit, can } = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<Category | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [nType, setNType] = useState("");

  // Level 1 — service types, edited inline on this page.
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeEdit, setTypeEdit] = useState<ServiceType | null>(null);
  const [tName, setTName] = useState("");
  const [tDesc, setTDesc] = useState("");
  const [tErr, setTErr] = useState<string | null>(null);
  const [delType, setDelType] = useState<ServiceType | null>(null);

  const types = useApi(() => api.serviceTypes.list({ includeInactive: "true" }), []);
  const q = useApi(() => api.categories.list(), []);
  const cats = [...(q.data?.data ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));
  const typeList = [...(types.data?.data ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const typeNames = typeList.map((t) => t.name);

  const moveType = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= typeList.length) return;
    const next = [...typeList]; [next[i], next[j]] = [next[j], next[i]];
    try {
      await Promise.all(next.map((t, k) => api.serviceTypes.update(t._id, { displayOrder: k })));
      types.reload();
    } catch (e) { toast((e as Error).message); }
  };
  const moveCat = async (items: Category[], i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]];
    try {
      await api.categories.reorder(next.map((c, k) => ({ id: c._id, displayOrder: k })));
      q.reload();
    } catch (e) { toast((e as Error).message); }
  };

  /* Grouped so the page reads as the tree it now is: type → categories. */
  const grouped = [
    ...typeList.map((t) => ({
      type: t.name,
      items: cats.filter((c) => c.type === t.name),
    })),
    { type: "", items: cats.filter((c) => !c.type || !typeNames.includes(c.type)) },
  ].filter((g) => g.items.length > 0);

  return (
    <Page title="Categories" sub="Level 2 of the menu — treatment categories, filed under a type"
      actions={<>
        <Btn kind="ghost" onClick={async () => {
          try {
            await api.categories.syncCounts();
            await api.serviceTypes.syncCounts();
            toast("Counts recalculated"); q.reload(); types.reload();
          } catch (e) { toast((e as Error).message); }
        }}>Recount services</Btn>
        {can("categories.manage") && <Btn kind="ghost" onClick={() => { setTypeOpen(true); setTypeEdit(null); setTName(""); setTDesc(""); setTErr(null); }}>+ New type</Btn>}
        {can("categories.manage") && <Btn onClick={() => { setAddOpen(true); setNName(""); setNDesc(""); setNType(typeNames[0] ?? ""); setErr(null); }}>+ New category</Btn>}
      </>}>
      <Hint id="categories-live">Categories group services in the app. Deactivating a category hides it from browsing without touching the services inside it.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <div className="grid items-start gap-3.5 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Level 1 — types. The app's top-level chips, in this order. */}
        <Card className="xl:sticky xl:top-[72px]">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-ivory px-4 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink3">Types · level 1</span>
            <span className="font-mono text-[10px] text-ink3">{typeList.length}</span>
          </div>
          <button onClick={() => setSelType("")} className={`flex w-full items-center justify-between px-4 py-2 text-left text-[12.5px] font-bold ${!selType ? "bg-primary text-white" : "hover:bg-ivory"}`}>
            <span>All types</span><span className={`font-mono text-[10.5px] ${!selType ? "text-white/70" : "text-ink3"}`}>{cats.length} categories</span>
          </button>
          {typeList.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink3">No types yet — add Skin, Hair, Wellness and so on.</div>}
          {typeList.map((t, i) => (
            <div key={t._id} className={`flex items-center gap-2 border-t border-border px-3 py-2 ${selType === t.name ? "bg-gold/10" : ""}`}>
              {can("categories.manage") && (
                <span className="flex flex-col gap-0.5">
                  <button onClick={() => moveType(i, -1)} disabled={i === 0} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▲</button>
                  <button onClick={() => moveType(i, 1)} disabled={i === typeList.length - 1} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▼</button>
                </span>
              )}
              <button onClick={() => setSelType(t.name)} className="min-w-0 flex-1 text-left">
                <b className={`text-[13px] font-bold ${selType === t.name ? "text-primary" : ""}`}>{t.name}</b>
                <div className="truncate text-[11px] text-ink3">
                  {cats.filter((c) => c.type === t.name).length} categories · {t.treatmentCount ?? 0} services{!t.isActive ? " · hidden" : ""}
                </div>
              </button>
              {can("categories.manage") && (
                <Menu align="right" button={<button className="px-1 text-ink3">⋯</button>} items={[
                  { label: "Edit", onClick: () => { setTypeOpen(true); setTypeEdit(t); setTName(t.name); setTDesc(t.description ?? ""); setTErr(null); } },
                  { label: <span className="text-err">Delete</span>, onClick: () => setDelType(t) },
                ]} />
              )}
            </div>
          ))}
        </Card>

        <div className="min-w-0">
          <Async q={q} label="Loading categories…" rows={6}>
            {() => cats.length === 0 ? (
              <Empty title="No categories yet" hint="Create the groups your services sit in — Laser, Injectables, Facials and so on."
                action={can("categories.manage") ? <Btn onClick={() => setAddOpen(true)}>+ New category</Btn> : undefined} />
            ) : (
              grouped.filter((g) => !selType || g.type === selType).map((group) => (
              <Card key={group.type || "unfiled"} className="mb-3">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-ivory px-4 py-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink3">
                    {group.type || "Not filed under a type"} · level 2
                  </span>
                  <span className="font-mono text-[10px] text-ink3">
                    {group.items.length} categor{group.items.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                {group.items.map((c, i) => (
                  <div key={c._id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                    {can("categories.manage") && group.type && (
                      <span className="flex flex-col gap-0.5">
                        <button onClick={() => moveCat(group.items, i, -1)} disabled={i === 0} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▲</button>
                        <button onClick={() => moveCat(group.items, i, 1)} disabled={i === group.items.length - 1} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▼</button>
                      </span>
                    )}
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sage text-[12px] font-bold text-primary">
                      {initials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <b className="text-[13px] font-bold">{c.name}</b>
                      <div className="truncate text-[11px] text-ink3">
                        {c.consultationCount ?? 0} service{(c.consultationCount ?? 0) === 1 ? "" : "s"}
                        {c.description ? ` · ${c.description}` : ""}
                      </div>
                    </div>
                    <button onClick={() => nav(`/services?type=${encodeURIComponent(group.type ?? "")}&category=${encodeURIComponent(c.name)}`)} className="text-[11.5px] font-semibold text-ink3 hover:text-primary">View services →</button>
                    <Toggle on={c.isActive} onChange={async () => {
                      if (!can("categories.manage")) return toast("Your role cannot change the catalogue");
                      try {
                        await api.categories.toggle(c._id);
                        audit("CATALOGUE_STATUS_CHANGED", `Category ${c.name}`, { categoryId: c._id });
                        toast(`${c.name} ${c.isActive ? "hidden from" : "shown in"} the app`);
                        q.reload();
                      } catch (e) { toast((e as Error).message); }
                    }} />
                    {can("categories.manage") && (
                      <Menu align="right" button={<button className="px-1 text-ink3">⋯</button>} items={[
                        { label: "Edit", onClick: () => { setEdit(c); setNName(c.name); setNDesc(c.description ?? ""); setNType(c.type ?? ""); setErr(null); } },
                        { label: "+ New service here", onClick: () => nav("/service-editor", { state: { blank: true, type: group.type ?? undefined, category: c.name } }) },
                        { label: <span className="text-err">Delete</span>, onClick: () => setDel(c) },
                      ]} />
                    )}
                  </div>
                ))}
              </Card>
              ))
            )}
          </Async>
        </div>
      </div>

      <Modal open={addOpen || !!edit} onClose={() => { setAddOpen(false); setEdit(null); }}
        title={edit ? `Edit ${edit.name}` : "New category"}>
        <div className="grid gap-3">
          <In label="Category name" value={nName} onChange={setNName} />
          {typeNames.length
            ? <Sel label="Type" value={nType || typeNames[0]} onChange={setNType} options={typeNames} />
            : <In label="Type" value={nType} onChange={setNType} hint="No types yet — add one with “+ New type” first" />}
          <Area label="Description (optional)" value={nDesc} onChange={setNDesc} rows={2} />
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => { setAddOpen(false); setEdit(null); }}>Cancel</Btn>
          <Btn disabled={nName.trim().length < 2} onClick={async () => {
            setErr(null);
            try {
              if (edit) {
                await api.categories.update(edit._id, { name: nName.trim(), description: nDesc.trim(), type: nType || typeNames[0] });
                audit("CATALOGUE_UPDATED", `Category ${nName.trim()}`, { categoryId: edit._id });
                toast("Category updated");
              } else {
                await api.categories.create({ name: nName.trim(), description: nDesc.trim(), type: nType || typeNames[0] });
                audit("CATALOGUE_CREATED", `Category ${nName.trim()}`);
                toast("Category created");
              }
              setAddOpen(false); setEdit(null); q.reload(); types.reload();
            } catch (e) { setErr((e as Error).message); }
          }}>{edit ? "Save" : "Create"}</Btn>
        </div>
      </Modal>

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `category "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.categories.remove(del._id);
            audit("CATALOGUE_DELETED", `Category ${del.name} · reason: ${reason}`, { categoryId: del._id });
            toast("Category deleted"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />

      <Modal open={typeOpen} onClose={() => setTypeOpen(false)} title={typeEdit ? `Edit type ${typeEdit.name}` : "New type"}>
        <div className="grid gap-3">
          <In label="Type name" value={tName} onChange={setTName} hint="Skin, Hair, Wellness… the app's top-level chips" />
          <Area label="Description (optional)" value={tDesc} onChange={setTDesc} rows={2} />
          {typeEdit && (
            <Switch on={typeEdit.isActive} label="Shown in the app" sub="Hidden types keep their categories and services"
              onChange={async (v) => {
                try { await api.serviceTypes.update(typeEdit._id, { isActive: v }); setTypeEdit({ ...typeEdit, isActive: v }); types.reload(); }
                catch (e) { setTErr((e as Error).message); }
              }} />
          )}
        </div>
        {tErr && <Note kind="crit">{tErr}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setTypeOpen(false)}>Cancel</Btn>
          <Btn disabled={tName.trim().length < 2} onClick={async () => {
            setTErr(null);
            try {
              if (typeEdit) {
                await api.serviceTypes.update(typeEdit._id, { name: tName.trim(), description: tDesc.trim() });
                audit("CATALOGUE_UPDATED", `Type ${tName.trim()}`, { typeId: typeEdit._id });
                toast("Type updated — categories and services were re-filed");
              } else {
                await api.serviceTypes.create({ name: tName.trim(), description: tDesc.trim(), displayOrder: typeList.length });
                audit("CATALOGUE_CREATED", `Type ${tName.trim()}`);
                toast("Type created");
              }
              setTypeOpen(false); types.reload(); q.reload();
            } catch (e) { setTErr((e as Error).message); }
          }}>{typeEdit ? "Save" : "Create"}</Btn>
        </div>
      </Modal>

      <DeleteModal open={!!delType} onClose={() => setDelType(null)} what={delType ? `type "${delType.name}"` : ""}
        onConfirm={async (reason) => {
          if (!delType) return;
          try {
            await api.serviceTypes.remove(delType._id);
            audit("CATALOGUE_DELETED", `Type ${delType.name} · reason: ${reason}`, { typeId: delType._id });
            toast("Type deleted"); types.reload(); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

/* ================= PACKAGES ================= */
export function Packages() {
  const { toast, audit, can } = useStore();
  const [edit, setEdit] = useState<Package | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Package | null>(null);
  const [cloneSeed, setCloneSeed] = useState<Partial<Package> | null>(null);

  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: 3 });
  const [search, setSearch] = useState("");
  const dq = useDebounced(search, 300);
  const [pickOpen, setPickOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<User | null>(null);
  const assignUi = (
    <>
      <PatientPickerModal open={pickOpen} onClose={() => setPickOpen(false)} title="Assign a package — who is it for?" onPick={(u) => { setPickOpen(false); setAssignFor(u); }} />
      {assignFor && <AssignPackageModal open={!!assignFor} onClose={() => setAssignFor(null)} user={assignFor} onAssigned={() => { setAssignFor(null); assignments.reload(); }} />}
    </>
  );

  /*
   * Zenoti keeps three different things in one list; we separate them:
   *   0 Catalogue      — what Zenoti's centres sell today (its package master)
   *   1 Custom & sold  — built for one guest at the desk, or retired, and kept
   *                      because guests still hold sessions on them
   *   2 Our packages   — created here, sold through the app
   *   3 Assignments    — who holds what
   */
  const PACKAGE_TABS = [
    { label: "Catalogue", q: { origin: "zenoti", inCatalogue: "true" } },
    { label: "Custom & sold", q: { origin: "zenoti", inCatalogue: "false" } },
    { label: "Our packages", q: { origin: "panel" } },
  ];
  const q = useApi(() => api.packages.list({ includeInactive: "true", limit: 200, search: dq || undefined, ...(PACKAGE_TABS[tab]?.q ?? PACKAGE_TABS[0].q) }), [tab, dq]);
  const assignments = useApi(() => api.packageAssignments.stats().catch(() => undefined), []);
  const list = (q.data?.data ?? []) as Package[];
  const buckets = q.data?.buckets;
  const total = q.data?.total ?? list.length;

  const tabs: [string, number?][] = [
    ["Catalogue", buckets?.catalogue],
    ["Custom & sold", buckets?.sold],
    ["Our packages", buckets?.ours],
    ["Assignments"],
  ];
  if (tab === 3) {
    return (
      <Page title="Packages" sub="Packages assigned to patients — sessions, payment and cancellation"
        actions={<Btn kind="gold" onClick={() => setPickOpen(true)}>+ Assign package</Btn>}>
        <Tabs active={tab} onChange={setTab} items={tabs} />
        <AssignmentsConsole />
        {assignUi}
      </Page>
    );
  }
  return (
    <Page title="Packages" sub="Bundles of services and consultations, assignable to any patient"
      actions={<>
        <Btn kind="ghost" disabled={!list.length} onClick={() => exportCsv("zennara-packages",
          ["Name", "Code", "Kind", "Price", "Services", "Validity (days)", "Grace", "Centres", "Bookings", "In app"],
          list.map((p) => [p.name, p.code ?? "", p.packageType ?? "", p.price,
            (p.services?.length ?? 0) + (p.consultationServices?.length ?? 0), p.validityDays ?? (p.neverExpires ? "never" : ""), p.graceDays ?? 0,
            (p.centres ?? []).map((c) => c.branchName).join("; "), p.bookingsCount ?? 0, p.isActive ? "yes" : "no"]))}>Export CSV</Btn>
        <Btn kind="gold" onClick={() => setPickOpen(true)}>+ Assign package</Btn>
        {can("packages.manage") && <Btn onClick={() => { setCreating(true); setEdit(null); }}>+ New package</Btn>}
      </>}>
      {assignUi}
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Tabs active={tab} onChange={setTab} items={tabs} />
      <Async q={q} label="Loading packages…" rows={6}>
        {() => (
          <>
            {assignments.data && (
              <Stats items={[
                { k: tabs[tab][0] as string, v: total, d: `${list.filter((p) => p.isActive).length} of these live in the app` },
                ...(assignments.data.statusCounts ?? []).slice(0, 3).map((s) => ({
                  k: `${s._id} assignments`, v: s.count,
                })),
                {
                  k: "Assigned revenue",
                  v: fmtINR(assignments.data.totalRevenue?.[0]?.total),
                  d: `${(assignments.data.paymentStats ?? []).find((p) => p._id === true)?.count ?? 0} paid`,
                },
              ]} />
            )}

            <div className="mb-2 flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1"><In label="Search" value={search} onChange={setSearch} placeholder="Package name, code or description" /></div>
              {tab === 0 && <Note className="my-0 flex-1">Zenoti's own package list, mirrored hourly — name, code, category, validity and the centres it is sold at. Zenoti's API does <B>not</B> publish a package's price or the services inside it, to anyone: that is a limit of the integration, not a sync that failed. Both are filled in from real sales where a guest has bought one; for the rest, set the price and add the services here before selling it in the app.</Note>}
              {tab === 1 && <Note className="my-0 flex-1">Built for one guest at the desk, or retired from the catalogue. Kept because guests still hold sessions on them.</Note>}
            </div>
            {list.length === 0 ? (
              <Empty title={tab === 2 ? "No packages of our own yet" : "Nothing here"} hint={tab === 2 ? "Bundle a course of treatments into a package the app can sell." : "Nothing in this group right now."}
                action={can("packages.manage") && tab === 2 ? <Btn onClick={() => setCreating(true)}>+ New package</Btn> : undefined} />
            ) : (
              <DataTable cols={["Package", "Code", "Kind", "Includes", "Price", "Validity", "Centres", "In app"]}
                onRow={(i) => can("packages.manage") && setEdit(list[i])}
                rows={list.map((p) => {
                  const lines = (p.services?.length ?? 0) + (p.consultationServices?.length ?? 0);
                  const sessions = (p.services ?? []).reduce((n, s) => n + (s.sessions ?? 1), 0);
                  return [
                    <span key={p._id}><B>{p.name}{p.isPopular ? " ★" : ""}</B>{p.origin === "zenoti" ? <Tag kind="info">Zenoti</Tag> : null}</span>,
                    <span key={`${p._id}c`} className="font-mono text-[11px] text-ink3">{p.code ?? "—"}</span>,
                    <span key={`${p._id}t`} className="text-[11.5px]">{p.packageType === "custom" ? "Custom" : p.packageType === "day" ? "Day package" : p.packageType === "offer" ? "Offer" : "Series"}</span>,
                    lines
                      ? <span key={`${p._id}i`}>{lines} service{lines === 1 ? "" : "s"} <span className="text-ink3">· {sessions} sessions</span></span>
                      : <span key={`${p._id}i`} className="text-[11.5px] text-warn">contents not published by Zenoti — add them</span>,
                    <span key={`${p._id}pr`}>
                      <B>{fmtINR(p.price)}</B>
                      {!p.price ? <span className="ml-1 text-[10.5px] text-warn">set a price</span> : null}
                      {!!p.originalPrice && p.originalPrice > p.price && <s className="ml-1.5 text-[11px] text-ink3">{fmtINR(p.originalPrice)}</s>}
                    </span>,
                    <span key={`${p._id}v`} className="text-[11.5px]">{p.neverExpires ? "never expires" : p.validityDays ? `${p.validityDays} days` : `${p.validityMonths ?? 12} months`}{p.graceDays ? ` +${p.graceDays}d grace` : ""}</span>,
                    <span key={`${p._id}ce`} className="text-[11.5px] text-ink3">{(p.centres ?? []).length ? (p.centres ?? []).map((c) => c.branchName).filter(Boolean).join(", ") : "—"}</span>,
                    p.isActive ? <Tag key={`${p._id}a`} kind="ok">shown</Tag> : <Tag key={`${p._id}a`} kind="mute">hidden</Tag>,
                  ];
                })} />
            )}
          </>
        )}
      </Async>

      <PackageEditor
        open={creating || !!edit}
        pkg={edit}
        seed={cloneSeed}
        onClone={(p) => { const { _id, id, createdAt, versions, version, zenotiPackageId, bookingsCount, ...rest } = p as Package & { createdAt?: string }; void _id; void id; void createdAt; void versions; void version; void zenotiPackageId; void bookingsCount; setEdit(null); setCloneSeed({ ...rest, name: `${p.name} (copy)`, code: null }); setCreating(true); }}
        onClose={() => { setCreating(false); setEdit(null); setCloneSeed(null); }}
        onSaved={() => { q.reload(); setCreating(false); setEdit(null); setCloneSeed(null); }}
        onDelete={(p) => { setEdit(null); setDel(p); }}
      />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `package "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.packages.remove(del._id);
            audit("CATALOGUE_DELETED", `Package ${del.name} · reason: ${reason}`, { packageId: del._id });
            toast("Package deleted"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function PackageEditor({ open, pkg, seed, onClose, onSaved, onDelete, onClone }: {
  open: boolean; pkg: Package | null; seed?: Partial<Package> | null; onClose: () => void; onSaved: () => void; onDelete: (p: Package) => void; onClone?: (p: Package) => void;
}) {
  // Packages are sold and redeemed at clinics only.
  const { toast, audit, clinics: branches } = useStore();
  const [f, setF] = useState<Partial<Package>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [svcSearch, setSvcSearch] = useState("");

  const services = useApi(() => api.services.list({ isActive: "true", limit: 500 }), [open]);
  const catalogue = services.data?.data ?? [];

  /** Stored rows key on the Consultation `id`; the picker keys on `_id`. Match either. */
  const findSvc = (key?: string) => catalogue.find((s) => s._id === key || s.id === key || s.slug === key);

  useEffect(() => {
    if (!open) return;
    setF(pkg ?? seed ?? {
      name: "", description: "", price: 0, originalPrice: 0, discount: 0, image: "", validityMonths: 12,
      benefits: [], services: [], consultationServices: [], isActive: true, isPopular: false,
    });
    setErr(null);
  }, [open, pkg?._id]);

  const set = <K extends keyof Package>(k: K) => (v: Package[K]) => setF((s) => ({ ...s, [k]: v }));
  const uploadImage = (file: File) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "");

  const included = (f.services ?? []) as { serviceId?: string; name?: string; serviceName?: string; sessions?: number; customPrice?: number; redemptionOrder?: number }[];
  const listPrice = included.reduce((sum, it) => {
    const svc = findSvc(it.serviceId);
    const unit = it.customPrice ?? svc?.price ?? 0;
    return sum + unit * (it.sessions ?? 1);
  }, 0);
  const price = Number(f.price) || 0;
  const savings = listPrice > 0 ? Math.round((1 - price / listPrice) * 100) : 0;

  const save = async () => {
    setErr(null);
    if (!f.name?.trim()) return setErr("A package name is required");
    if (!f.description?.trim()) return setErr("A description is required — the app shows it");
    if (!price) return setErr("A price is required");
    setBusy(true);
    try {
      // The server recomputes originalPrice/discount from the services, and owns `id`.
      const { _id, id, originalPrice, discount, bookingsCount, createdAt, ...rest } = f as Package & { createdAt?: string };
      void _id; void id; void originalPrice; void discount; void bookingsCount; void createdAt;
      const body: Partial<Package> = {
        ...rest,
        price,
        services: included.map((it) => ({
          serviceId: findSvc(it.serviceId)?._id ?? it.serviceId,
          sessions: Math.max(1, it.sessions ?? 1),
          redemptionOrder: Math.max(1, it.redemptionOrder ?? 1),
          ...(it.customPrice !== undefined && it.customPrice !== null ? { customPrice: Number(it.customPrice) } : {}),
        })),
      };
      // The version history is server-owned.
      delete (body as { versions?: unknown }).versions; delete (body as { version?: unknown }).version;
      if (pkg) {
        await api.packages.update(pkg._id, body);
        audit("CATALOGUE_UPDATED", `Package ${f.name}`, { packageId: pkg._id });
        toast("Package saved");
      } else {
        const created = await api.packages.create(body);
        audit("CATALOGUE_CREATED", `Package ${created.name}`, { packageId: created._id });
        toast("Package created");
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={pkg ? `Edit ${pkg.name}` : "New package"} xl>
      {services.initial && !services.data ? <Loading label="Loading services…" /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="grid gap-3 md:grid-cols-2">
              <In label="Package name" value={f.name ?? ""} onChange={set("name")} placeholder="e.g. Glow Ritual · 6 sessions" />
              <ZenotiPick kind="packages" label="Zenoti package — sold in Zenoti when this package is assigned to a guest" value={f.zenotiPackageId} onChange={(v) => set("zenotiPackageId")(v)} />
              <In label="Package price (₹)" type="number" value={String(f.price ?? 0)} onChange={(v) => set("price")(Number(v) || 0)} hint={listPrice ? `List value ${fmtINR(listPrice)}` : undefined} />
              <In label="Validity (months)" type="number" value={String(f.validityMonths ?? 12)}
                onChange={(v) => set("validityMonths")(Math.max(1, Number(v) || 12))}
                hint="How long a customer has to use it after it is assigned — 12 = one year, 6 = six months" />
            </div>
            <div className="mt-3"><Area label="Description — shown in the app" value={f.description ?? ""} onChange={set("description")} rows={3} /></div>
            <div className="mt-3">
              <Area label="Benefits (one per line)" value={(f.benefits ?? []).join("\n")}
                onChange={(v) => set("benefits")(v.split("\n").map((x) => x.trim()).filter(Boolean))} rows={3} />
            </div>

            <SecH t="What's included" em={`· ${included.reduce((n, it) => n + (it.sessions ?? 1), 0)} sessions`} />
            <div className="mb-2 flex gap-2">
              <input value={svcSearch} onChange={(e) => setSvcSearch(e.target.value)} placeholder="Search a service to add…"
                className="min-w-0 flex-1 rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
            </div>
            {svcSearch && (
              <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface">
                {catalogue.filter((c) => c.name.toLowerCase().includes(svcSearch.toLowerCase()) || c.category.toLowerCase().includes(svcSearch.toLowerCase())).slice(0, 12).map((c) => (
                  <button key={c._id} onClick={() => { setF((s) => ({ ...s, services: [...(s.services ?? []), { serviceId: c._id, name: c.name, sessions: 1 }] })); setSvcSearch(""); }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12.5px] hover:bg-ivory">
                    <span><B>{c.name}</B> <span className="text-[11px] text-ink3">· {c.category}</span></span><span className="font-mono text-[11px] text-ink3">{fmtINR(c.price)}</span>
                  </button>
                ))}
              </div>
            )}
            {included.length === 0 && <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-ink3">No services yet — search above to add the treatments this package covers.</div>}
            {included.map((it, i) => {
              const svc = findSvc(it.serviceId);
              return (
                <div key={i} className="mb-2 rounded-xl border border-border bg-ivory px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <B>{svc?.name ?? it.name ?? it.serviceName ?? "Service"}</B>
                      <div className="text-[10.5px] text-ink3">{svc?.category ?? ""}{svc ? ` · list ${fmtINR(svc.price)}/session` : ""}</div>
                    </div>
                    <button title="Remove" onClick={() => setF((s) => ({ ...s, services: ((s.services ?? []) as typeof included).filter((_, j) => j !== i) }))}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-err-bg text-[12px] font-bold text-err">×</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-[11px] font-bold text-ink2">
                      Sessions
                      <span className="flex items-center overflow-hidden rounded-lg border border-border">
                        <button className="grid h-8 w-8 place-items-center bg-sage font-bold"
                          onClick={() => setF((s) => ({ ...s, services: ((s.services ?? []) as typeof included).map((x, j) => (j === i ? { ...x, sessions: Math.max(1, (x.sessions ?? 1) - 1) } : x)) }))}>−</button>
                        <span className="grid h-8 w-10 place-items-center bg-surface font-mono text-[13px] font-bold">{it.sessions ?? 1}</span>
                        <button className="grid h-8 w-8 place-items-center bg-sage font-bold"
                          onClick={() => setF((s) => ({ ...s, services: ((s.services ?? []) as typeof included).map((x, j) => (j === i ? { ...x, sessions: (x.sessions ?? 1) + 1 } : x)) }))}>+</button>
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] font-bold text-ink2">
                      ₹ / session
                      <input type="number" value={String(it.customPrice ?? svc?.price ?? 0)}
                        onChange={(e) => setF((s) => ({ ...s, services: ((s.services ?? []) as typeof included).map((x, j) => (j === i ? { ...x, customPrice: Number(e.target.value) || 0 } : x)) }))}
                        className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right font-mono text-[12px] outline-none focus:border-gold-dark" />
                    </label>
                    <label className="flex items-center gap-2 text-[11px] font-bold text-ink2" title="Zenoti 'Order': which benefit a redemption draws from first when a bill could match several">
                      Order
                      <input type="number" min={1} value={String(it.redemptionOrder ?? 1)}
                        onChange={(e) => setF((s) => ({ ...s, services: ((s.services ?? []) as typeof included).map((x, j) => (j === i ? { ...x, redemptionOrder: Math.max(1, Number(e.target.value) || 1) } : x)) }))}
                        className="w-14 rounded-lg border border-border bg-surface px-2 py-1.5 text-right font-mono text-[12px] outline-none focus:border-gold-dark" />
                    </label>
                    <span className="ml-auto font-mono text-[12.5px] font-bold tabular-nums">
                      {fmtINR((it.customPrice ?? svc?.price ?? 0) * (it.sessions ?? 1))}
                    </span>
                  </div>
                </div>
              );
            })}

            <SecH t="Terms" em="· how Zenoti defines a package" />
            <div className="grid gap-3 md:grid-cols-3">
              <In label="Code" value={f.code ?? ""} onChange={(v) => set("code")(v.toUpperCase())} placeholder="e.g. 2GFCEXO" hint="Printed on receipts" />
              <In label="Category" value={f.category ?? "Default"} onChange={set("category")} />
              <Sel label="Type" value={f.packageType === "custom" ? "Custom (built for one guest)" : "Series (defined package)"} onChange={(v) => set("packageType")(v.startsWith("Custom") ? "custom" : "series")} options={["Series (defined package)", "Custom (built for one guest)"]} />
              <Sel label="Validity" value={f.neverExpires ? "Never expires" : Number(f.validityDays) > 0 ? "Fixed — days" : "Fixed — months"} onChange={(v) => { if (v === "Never expires") { set("neverExpires")(true); } else if (v === "Fixed — days") { set("neverExpires")(false); set("validityDays")(f.validityDays || 182); } else { set("neverExpires")(false); set("validityDays")(null); } }} options={["Fixed — months", "Fixed — days", "Never expires"]} />
              {!f.neverExpires && Number(f.validityDays) > 0 && <In label="Expiry period (days)" type="number" value={String(f.validityDays ?? 182)} onChange={(v) => set("validityDays")(Math.max(1, Number(v) || 1))} />}
              {!f.neverExpires && <Sel label="Validity starts" value={f.validityStartsAt === "firstRedemption" ? "At first redemption" : "From sale date"} onChange={(v) => set("validityStartsAt")(v.startsWith("At") ? "firstRedemption" : "sale")} options={["From sale date", "At first redemption"]} />}
              {!f.neverExpires && <In label="Grace period (days)" type="number" value={String(f.graceDays ?? 0)} onChange={(v) => set("graceDays")(Math.max(0, Number(v) || 0))} hint="Redeemable this long after expiry" />}
              <In label="Freezes allowed" type="number" value={String(f.maxFreezes ?? 2)} onChange={(v) => set("maxFreezes")(Math.max(0, Number(v) || 0))} hint="0 = no freezing" />
              <In label="Max freeze days" type="number" value={String(f.maxFreezeDays ?? 90)} onChange={(v) => set("maxFreezeDays")(Math.max(0, Number(v) || 0))} />
              <In label="Minimum partial payment %" type="number" value={String(f.minPartialPaymentPercent ?? 0)} onChange={(v) => set("minPartialPaymentPercent")(Math.min(100, Math.max(0, Number(v) || 0)))} hint="0 = pay in full at the bill" />
              <In label="GST %" type="number" value={String(f.taxPercent ?? 5)} onChange={(v) => set("taxPercent")(Math.max(0, Number(v) || 0))} />
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Switch on={f.closeWhenConsumed !== false} onChange={set("closeWhenConsumed")} label="Close when all benefits are used" sub="Off keeps it Active (service discounts stay valid)" />
              <Switch on={f.redemption?.scope === "centres"} onChange={(v) => set("redemption")({ scope: v ? "centres" : "organization", branchIds: f.redemption?.branchIds ?? [] })} label="Redeemable only at chosen centres" sub="Off = any centre" />
            </div>
            {f.redemption?.scope === "centres" && (
              <div className="mt-2 flex flex-wrap gap-3 text-[12.5px]">
                {branches.map((b) => { const on = (f.redemption?.branchIds ?? []).map(String).includes(String(b._id)); return <label key={b._id} className="flex items-center gap-1.5"><input type="checkbox" checked={on} onChange={(e) => set("redemption")({ scope: "centres", branchIds: e.target.checked ? [...(f.redemption?.branchIds ?? []), b._id] : (f.redemption?.branchIds ?? []).filter((x) => String(x) !== String(b._id)) })} />{b.name}</label>; })}
              </div>
            )}
            <div className="mt-3">
              <div className="text-[11px] font-bold text-ink2">Sale price per centre <span className="font-normal text-ink3">(blank = {fmtINR(price)} everywhere; untick to not sell there)</span></div>
              <div className="mt-1 grid gap-1.5 md:grid-cols-2">
                {branches.map((b) => { const row = (f.centrePrices ?? []).find((c) => String(c.branchId) === String(b._id)); const upd = (patch: Partial<NonNullable<Package["centrePrices"]>[number]>) => set("centrePrices")([...(f.centrePrices ?? []).filter((c) => String(c.branchId) !== String(b._id)), { branchId: b._id, price: row?.price ?? null, taxPercent: row?.taxPercent ?? null, available: row?.available !== false, ...patch }]); return (
                  <div key={b._id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px]">
                    <input type="checkbox" checked={row ? row.available !== false : true} onChange={(e) => upd({ available: e.target.checked })} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <input type="number" placeholder={String(price)} value={row?.price ?? ""} onChange={(e) => upd({ price: e.target.value === "" ? null : Number(e.target.value) })} className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-[12px]" />
                  </div>
                ); })}
              </div>
            </div>
            <div className="mt-3"><Area label="Package agreement (sent with the bill)" value={f.agreementText ?? ""} onChange={set("agreementText")} rows={2} /></div>
            {pkg?.version && pkg.version > 1 && <div className="mt-1 text-[11px] text-ink3">Version {pkg.version} · earlier versions: {(pkg.versions ?? []).map((v) => `v${v.version} (${fmtINR(v.price ?? 0)}, ${fmtDate(v.at)})`).join(", ") || "—"}. Guests keep the terms of the version they bought.</div>}

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Switch on={!!f.isActive} onChange={set("isActive")} label="Live in the app" sub="Off hides it from the app" />
              <Switch on={!!f.isPopular} onChange={set("isPopular")} gold label="Popular" sub="Pins it to the app home rail" />
            </div>
            {err && <Note kind="crit">{err}</Note>}
          </div>

          <div className="grid gap-3">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-ivory px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">As seen in the app</div>
              {f.image ? <img src={f.image} alt="" className="h-32 w-full object-cover" /> : <div className="grid h-32 place-items-center bg-gradient-to-br from-sage to-cream text-[11px] text-ink3">No photo yet</div>}
              <div className="p-3">
                <div className="text-[14px] font-extrabold leading-tight">{f.name || "Package name"}</div>
                <div className="mt-1 line-clamp-3 text-[11.5px] text-ink3">{f.description || "Description appears here."}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <b className="text-[15px]">{fmtINR(price)}</b>
                  {listPrice > price && <s className="text-[11px] text-ink3">{fmtINR(listPrice)}</s>}
                  {listPrice > price && <Tag kind="ok">save {savings}%</Tag>}
                </div>
                <ul className="mt-2 grid gap-0.5 text-[11px] text-ink2">
                  {included.slice(0, 5).map((it, i) => <li key={i}>• {it.sessions ?? 1}× {findSvc(it.serviceId)?.name ?? it.name ?? "service"}</li>)}
                </ul>
              </div>
            </Card>
            <UploadField label="Photo" value={f.image ?? ""} onChange={set("image")} upload={uploadImage} preview={false} />
            {listPrice > 0 && price >= listPrice && <Note kind="crit" className="mb-0">Priced at or above the list value — the guest saves nothing.</Note>}
            <div className="flex flex-col gap-2">
              <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : pkg ? "Save package" : "Create package"}</Btn>
              <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
              {pkg && onClone && <Btn kind="ghost" onClick={() => onClone(pkg)}>Clone package</Btn>}
              {pkg && <Btn kind="danger" onClick={() => onDelete(pkg)}>Delete package</Btn>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}


/* ================= PACKAGE ASSIGNMENTS ================= */
function AssignmentsConsole() {
  const { toast, audit, can } = useStore();
  const [status, setStatus] = useQueryString("assignmentStatus", "all");
  const [search, setSearch] = useQueryString("assignmentQ");
  const debounced = useDebounced(search);
  const [page, setPage] = useQueryPage("assignmentPage");
  const [sel, setSel] = useState<PackageAssignment | null>(null);

  const q = useApi(() => api.packageAssignments.list({ status, search: debounced || undefined, page, limit: 15 }), [status, debounced, page]);
  const rows = q.data?.data ?? [];
  const pag = (q.data as { pagination?: { totalPages?: number; pages?: number; total?: number } } | undefined)?.pagination;
  const totalPages = pag?.totalPages ?? pag?.pages ?? 1;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search guest, phone, assignment id…"
          className="w-full max-w-[360px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          {["all", "Active", "Completed", "Expired", "Cancelled"].map((st) => (
            <button key={st} onClick={() => { setStatus(st); setPage(1); }}
              className={`px-3 py-2 text-[12px] font-bold ${status === st ? "bg-primary text-white" : "bg-surface text-ink2"}`}>{st === "all" ? "All" : st}</button>
          ))}
        </div>
      </div>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading assignments…" rows={6}>
        {() => rows.length === 0 ? (
          <Empty title="No assignments" hint="Assign a package from a patient's record (Patients → open → Assign package)." />
        ) : (
          <>
            <DataTable cols={["Guest", "Package", "Sessions", "Paid", "Valid until", "Status"]}
              onRow={(i) => setSel(rows[i])}
              rows={rows.map((a) => {
                const done = (a.sessions ?? []).filter((x) => x.status === "Completed").length + 0;
                const total = (a.sessions ?? []).length;
                return [
                  <span key={a._id}><B>{a.userDetails?.fullName ?? nameOf(a.userId, "Guest")}</B><div className="text-[11px] text-ink3">{a.userDetails?.phone ?? ""} · {a.assignmentId}</div></span>,
                  a.packageDetails?.packageName ?? nameOf(a.packageId, "Package"),
                  `${done}/${total}`,
                  a.payment?.isReceived ? <Tag key={`${a._id}p`} kind="ok">paid</Tag> : <Tag key={`${a._id}p`} kind="warn">due</Tag>,
                  a.validUntil ? fmtDate(a.validUntil) : "—",
                  <Tag key={`${a._id}s`} kind={a.status === "Active" ? "ok" : a.status === "Cancelled" ? "err" : "mute"}>{a.status}</Tag>,
                ];
              })} />
            {pag && totalPages > 1 && (
              <div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-ink3">
                <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
                <span>Page {page} of {totalPages}</span>
                <Btn kind="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Btn>
              </div>
            )}
          </>
        )}
      </Async>
      <AssignmentDrawer a={sel} onClose={() => setSel(null)} onChanged={() => { q.reload(); }} canEdit={can("packages.manage")} toast={toast} audit={audit} />
    </>
  );
}

function AssignmentDrawer({ a, onClose, onChanged, canEdit, toast, audit }: {
  a: PackageAssignment | null; onClose: () => void; onChanged: () => void; canEdit: boolean;
  toast: (m: string) => void; audit: (action: AuditAction, detail: string, extra?: Record<string, unknown>) => void;
}) {
  const [sessions, setSessions] = useState<PackageSession[]>([]);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  // Roster for the per-session dermatologist picker.
  const doctors = useApi(() => api.doctors.list({ isActive: "true" }), []);
  // Zenoti package detail: balances, redemptions, freeze / transfer / refund.
  const { can } = useStore();
  const canRefund = can("packages.refund");
  const ledger = useApi(() => (a ? api.packageAssignments.ledger(a._id).catch(() => null) : Promise.resolve(null)), [a?._id, a?.status, a?.freeze?.isFrozen, (a?.transfers ?? []).length]);
  // Sessions still owed — the reason an extension is worth granting at all.
  const unusedUnits = (ledger.data?.balances ?? []).reduce((n, b) => n + (b.balance ?? 0), 0);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezeUntil, setFreezeUntil] = useState("");
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [extendDays, setExtendDays] = useState("");
  const [extendReason, setExtendReason] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<User | null>(null);
  const [transferQty, setTransferQty] = useState<Record<string, number>>({});
  const [transferReason, setTransferReason] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmt, setRefundAmt] = useState("");
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [refundRef, setRefundRef] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const refundPrev = useApi(() => (refundOpen && a ? api.packageAssignments.refundPreview(a._id) : Promise.resolve(null)), [refundOpen, a?._id]);
  useEffect(() => { if (refundPrev.data) setRefundAmt(String(refundPrev.data.suggested)); }, [refundPrev.data?.suggested]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(null);
    try { const r = (await fn()) as { message?: string } | undefined; toast(r?.message || done); onChanged(); ledger.reload(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!a) return;
    setSessions((a.sessions ?? []).map((x) => ({ ...x })));
    setNotes(a.notes ?? "");
    setValidUntil(a.validUntil ? String(a.validUntil).slice(0, 10) : "");
    setErr(null); setCancelOpen(false); setOtpSent(false); setOtp(""); setCancelReason("");
  }, [a?._id]);

  if (!a) return null;
  const guest = a.userDetails?.fullName ?? nameOf(a.userId, "Guest");

  const save = async () => {
    if (sessions.some((x) => !x.scheduledDate)) { setErr("Every session needs a date — the server drops undated sessions."); return; }
    setBusy(true); setErr(null);
    try {
      await api.packageAssignments.update(a._id, {
        sessions: sessions.map((x) => ({ ...x, scheduledDate: x.scheduledDate || null })),
        notes,
        validUntil: validUntil || null,
      });
      audit("CATALOGUE_UPDATED", `Assignment ${a.assignmentId} sessions/notes`, { assignmentId: a._id });
      toast("Assignment saved"); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const markPaid = async (paid: boolean) => {
    setBusy(true); setErr(null);
    try {
      await api.packageAssignments.update(a._id, { "payment.isReceived": paid });
      audit("CATALOGUE_UPDATED", `Assignment ${a.assignmentId} marked ${paid ? "paid" : "unpaid"}`, { assignmentId: a._id });
      toast(paid ? "Marked as paid" : "Marked as unpaid"); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const uploadProof = async (file: File) => {
    const form = new FormData(); form.append("proof", file);
    setBusy(true); setErr(null);
    try { await api.packageAssignments.uploadProof(a._id, form); toast("Payment proof attached"); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const sendOtp = async () => {
    setBusy(true); setErr(null);
    try { await api.packageAssignments.cancelSendOtp(a._id); setOtpSent(true); toast(`Code sent to ${guest}`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const confirmCancel = async () => {
    setBusy(true); setErr(null);
    try {
      await api.packageAssignments.cancelVerifyOtp(a._id, { otp, reason: cancelReason });
      audit("CATALOGUE_UPDATED", `Assignment ${a.assignmentId} cancelled · ${cancelReason}`, { assignmentId: a._id });
      toast("Package cancelled"); onChanged(); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={!!a} onClose={onClose} title={<span>{a.packageDetails?.packageName ?? "Package"} <span className="font-mono text-[11px] text-ink3">{a.assignmentId}</span></span>}>
      <div className="grid gap-1.5 text-[12.5px]">
        <div className="flex justify-between"><span className="text-ink3">Guest</span><B>{guest}</B></div>
        <div className="flex justify-between"><span className="text-ink3">Phone</span><span>{a.userDetails?.phone ?? "—"}</span></div>
        <div className="flex justify-between"><span className="text-ink3">Price</span><B>{fmtINR(a.pricing?.finalAmount ?? a.packageDetails?.packagePrice)}</B></div>
        <div className="flex justify-between"><span className="text-ink3">Payment</span>
          {a.payment?.isReceived ? <Tag kind="ok">paid{a.payment.receivedDate ? ` · ${fmtDate(a.payment.receivedDate)}` : ""}</Tag> : <Tag kind="warn">due</Tag>}</div>
        {a.payment?.proofUrl && <a href={a.payment.proofUrl} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-primary">View payment proof ↗</a>}
        <div className="flex justify-between"><span className="text-ink3">Status</span><Tag kind={a.status === "Active" ? "ok" : "mute"}>{a.status}</Tag></div>
        <div className="flex justify-between"><span className="text-ink3">Clinic</span><span>{a.preferredLocation || "—"}</span></div>
      </div>

      {(a.freeze?.isFrozen || a.graceUntil || a.terms) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {a.freeze?.isFrozen && <Tag kind="warn">Frozen since {fmtDate(a.freeze.frozenAt)}{a.freeze.reason ? ` · ${a.freeze.reason}` : ""}</Tag>}
          {a.validUntil && <span className="text-ink3">Expires {fmtDate(a.validUntil)}{a.graceUntil ? ` · grace to ${fmtDate(a.graceUntil)}` : ""}</span>}
          {a.terms?.validityStartsAt === "firstRedemption" && !a.validUntil && <Tag kind="info">Validity starts at first redemption</Tag>}
          {a.terms?.neverExpires && <Tag kind="info">Never expires</Tag>}
          {a.terms?.redeemableScope === "centres" && <Tag kind="mute">Redeem only at selected centres</Tag>}
          {a.terms?.version ? <span className="text-ink3">· package v{a.terms.version}{a.terms.code ? ` · ${a.terms.code}` : ""}</span> : null}
          {a.transferredFrom?.userName && <Tag kind="mute">Transferred from {a.transferredFrom.userName}</Tag>}
          {a.payment?.balanceDue ? <Tag kind="warn">Instalment: {fmtINR(a.payment.amountPaid ?? 0)} paid · {fmtINR(a.payment.balanceDue)} due</Tag> : null}
        </div>
      )}
      {ledger.data && (
        <>
          <SecH t="Benefits" em={`· ${ledger.data.balances.reduce((n, b) => n + b.balance, 0)} of ${ledger.data.balances.reduce((n, b) => n + b.entitled, 0)} left`} />
          <table className="w-full text-[12px]"><thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink3"><th>Service</th><th className="text-right">Order</th><th className="text-right">Qty</th><th className="text-right">Used</th><th className="text-right">Transferred</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{ledger.data.balances.map((b) => <tr key={b.serviceId} className="border-t border-border/60"><td className="py-1">{b.serviceName ?? b.serviceId}</td><td className="text-right">{b.order ?? 1}</td><td className="text-right">{b.entitled}</td><td className="text-right">{b.used}</td><td className="text-right">{b.transferred ?? 0}</td><td className="text-right font-bold">{b.balance}</td></tr>)}</tbody></table>
          {ledger.data.invoice && <div className="mt-1 text-[11.5px] text-ink3">Sold on invoice <span className="font-mono">{ledger.data.invoice.invoiceNumber}</span>{ledger.data.invoice.receiptNumber ? ` · receipt ${ledger.data.invoice.receiptNumber}` : ""}{ledger.data.invoice.totals?.due ? ` · ${fmtINR(ledger.data.invoice.totals.due)} due` : ""}</div>}
          {ledger.data.redemptions.length > 0 && (
            <details className="mt-2 text-[12px]"><summary className="cursor-pointer font-semibold">Redemptions ({ledger.data.redemptions.filter((r) => !r.reversed).length})</summary>
              {ledger.data.redemptions.map((r, i) => <div key={i} className={`flex justify-between border-t border-border/60 py-1 ${r.reversed ? "text-ink3 line-through" : ""}`}><span>{fmtDate(r.at)} · {r.serviceName ?? r.serviceId}{r.byName ? ` · ${r.byName}` : ""}</span><span className="font-mono text-[11px] text-ink3">{r.invoiceNumber ?? ""}</span></div>)}
            </details>
          )}
          {(a.expiryExtensions ?? []).length > 0 && (
            <details className="mt-1 text-[12px]" open>
              <summary className="cursor-pointer font-semibold">Expiry extensions · {(a.expiryExtensions ?? []).length}</summary>
              {(a.expiryExtensions ?? []).map((x, i) => (
                <div key={`x${i}`} className="border-t border-border/60 py-1">
                  {x.from ? fmtDate(x.from) : "no expiry"} → <B>{x.to ? fmtDate(x.to) : "—"}</B>
                  {x.days ? ` (+${x.days} day${x.days === 1 ? "" : "s"})` : ""} · {x.byName || "Admin"} on {fmtDate(x.at)}
                  {x.reason ? ` · ${x.reason}` : ""}
                  {x.zenotiStatus && x.zenotiStatus !== "synced" && (
                    <span className="text-warn"> · Zenoti not updated{x.zenotiError ? `: ${x.zenotiError}` : ""}</span>
                  )}
                </div>
              ))}
            </details>
          )}
          {(ledger.data.freezeHistory.length > 0 || ledger.data.transfers.length > 0) && (
            <details className="mt-1 text-[12px]"><summary className="cursor-pointer font-semibold">Freeze & transfer history</summary>
              {ledger.data.freezeHistory.map((h, i) => <div key={`f${i}`} className="border-t border-border/60 py-1">Frozen {fmtDate(h.frozenAt)} → {fmtDate(h.resumedAt)} ({h.days} day{h.days === 1 ? "" : "s"} added back){h.reason ? ` · ${h.reason}` : ""}</div>)}
              {ledger.data.transfers.map((t, i) => <div key={`t${i}`} className="border-t border-border/60 py-1">Transferred {fmtDate(t.at)} to <B>{t.toUserName}</B>: {t.services.map((s) => `${s.serviceName ?? s.serviceId} ×${s.qty}`).join(", ")}{t.reason ? ` · ${t.reason}` : ""}</div>)}
            </details>
          )}
          {ledger.data.refund?.refundedAt && <Note kind="crit" className="mt-2 mb-0">Refunded {fmtINR(ledger.data.refund.amount ?? 0)} by {ledger.data.refund.method} on {fmtDate(ledger.data.refund.refundedAt)} — {ledger.data.refund.reason}</Note>}
        </>
      )}

      {canEdit && (a.status === "Active" || a.status === "Expired") && !a.terms?.neverExpires && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind={a.status === "Expired" ? "gold" : "ghost"} disabled={busy}
            onClick={() => { setExtendDate(""); setExtendDays(""); setExtendReason(""); setExtendOpen(true); }}>
            Extend expiry…
          </Btn>
        </div>
      )}

      {canEdit && a.status === "Active" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.freeze?.isFrozen
            ? <Btn kind="gold" disabled={busy} onClick={() => act(() => api.packageAssignments.unfreeze(a._id), "Package unfrozen")}>Unfreeze</Btn>
            : <Btn kind="ghost" disabled={busy} onClick={() => { setFreezeReason(""); setFreezeUntil(""); setFreezeOpen(true); }}>Freeze…</Btn>}
          {canRefund && <Btn kind="ghost" disabled={busy || !!a.freeze?.isFrozen} onClick={() => { setTransferTo(null); setTransferQty({}); setTransferReason(""); setTransferOpen(true); }}>Transfer…</Btn>}
          {canRefund && <Btn kind="ghost" disabled={busy} onClick={() => { setRefundReason(""); setRefundRef(""); setRefundMethod("Cash"); setRefundOpen(true); }}>Refund…</Btn>}
          <Btn kind="ghost" disabled={busy} onClick={() => markPaid(!a.payment?.isReceived)}>{a.payment?.isReceived ? "Mark unpaid" : "Mark paid"}</Btn>
          <label className="cursor-pointer rounded-(--radius-btn) border border-border bg-surface px-3 py-2 text-[12.5px] font-bold text-ink2">
            Attach proof<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadProof(f); }} />
          </label>
          <Btn kind="danger" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel package…</Btn>
        </div>
      )}

      <SecH t="Sessions" em={`· ${sessions.length}`} />
      {sessions.length === 0 && <div className="text-[12px] text-ink3">No sessions were scheduled on this assignment.</div>}
      {sessions.map((sess, i) => (
        <div key={sess._id ?? i} className="mb-2 rounded-xl border border-border bg-ivory p-2.5">
          <div className="flex items-center justify-between gap-2">
            <B>{sess.serviceName ?? sess.serviceId}</B>
            <Tag kind={sess.status === "Completed" ? "ok" : sess.status === "Booked" ? "info" : sess.status === "Cancelled" ? "err" : "mute"}>{sess.status ?? "Scheduled"}</Tag>
          </div>
          {canEdit && sess.status !== "Completed" ? (
            <>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <input type="date" value={sess.scheduledDate ? String(sess.scheduledDate).slice(0, 10) : ""}
                  onChange={(e) => setSessions((xs) => xs.map((x, j) => (j === i ? { ...x, scheduledDate: e.target.value ? new Date(e.target.value).toISOString() : undefined } : x)))}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none" />
                <input type="text" value={sess.scheduledTime ?? ""} placeholder="e.g. 2:30 PM"
                  onChange={(e) => setSessions((xs) => xs.map((x, j) => (j === i ? { ...x, scheduledTime: e.target.value } : x)))}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none" />
              </div>
              <select value={sess.specialistId ?? ""}
                onChange={(e) => {
                  const doc = (doctors.data?.data ?? []).find((d) => d.doctorId === e.target.value);
                  setSessions((xs) => xs.map((x, j) => (j === i
                    ? { ...x, specialistId: e.target.value || null, specialistName: doc?.name ?? null, specialistTier: doc?.designation ?? null }
                    : x)));
                }}
                className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-gold-dark">
                <option value="">No dermatologist</option>
                {(doctors.data?.data ?? []).map((d) => <option key={d._id} value={d.doctorId}>{d.name}</option>)}
              </select>
            </>
          ) : (
            <div className="mt-1 text-[11.5px] text-ink3">
              {sess.scheduledDate ? `${fmtDate(sess.scheduledDate)} ${sess.scheduledTime ?? ""}` : "not scheduled"}
              {sess.specialistName ? ` · ${sess.specialistName}` : ""}
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <>
          <div className="mt-2 grid gap-2">
            <In label="Valid until" type="date" value={validUntil} onChange={setValidUntil}
              hint="Leave blank to use the package's validity. Sessions cannot be booked after this date; the package is marked Expired the night it passes." />
            <Area label="Notes" value={notes} onChange={setNotes} rows={2} />
          </div>
          {err && <Note kind="crit">{err}</Note>}
          <div className="mt-3 flex justify-end gap-2">
            <Btn kind="ghost" onClick={onClose}>Close</Btn>
            <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Btn>
          </div>
        </>
      )}

      <Modal open={freezeOpen} onClose={() => setFreezeOpen(false)} title="Freeze this package">
        <Note className="my-0">While frozen, sessions cannot be booked or redeemed. When you unfreeze, the frozen days are added back to the expiry{a.terms?.maxFreezes ? ` — this package allows ${a.terms.maxFreezes} freeze${a.terms.maxFreezes === 1 ? "" : "s"}` : ""}{a.terms?.maxFreezeDays ? ` of up to ${a.terms.maxFreezeDays} days` : ""}.</Note>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <In label="Reason" value={freezeReason} onChange={setFreezeReason} placeholder="e.g. Travelling" />
          <In label="Planned resume (optional)" type="date" value={freezeUntil} onChange={setFreezeUntil} />
        </div>
        {err && <Note kind="crit" className="mt-2">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={() => setFreezeOpen(false)}>Back</Btn><Btn disabled={busy} onClick={async () => { if (await act(() => api.packageAssignments.freeze(a._id, { reason: freezeReason, resumeOn: freezeUntil || null }), "Package frozen")) setFreezeOpen(false); }}>Freeze package</Btn></div>
      </Modal>

      <Modal open={extendOpen} onClose={() => setExtendOpen(false)} title="Extend this package">
        <Note className="my-0">
          Gives the guest longer to use the sessions they have already paid for. The app tells guests to
          ask the clinic for this — they cannot do it themselves. The change is written to Zenoti too, and
          recorded here with your name.
          {unusedUnits > 0 ? ` This package has ${unusedUnits} session${unusedUnits === 1 ? "" : "s"} unused.` : " Every session in this package has been used."}
        </Note>
        <div className="mt-3 text-[12.5px] text-ink3">
          Current expiry: <B>{a.validUntil ? fmtDate(a.validUntil) : "none set"}</B>
          {a.status === "Expired" ? " · this package has lapsed" : ""}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <In label="New expiry date" type="date" value={extendDate}
            onChange={(v) => { setExtendDate(v); if (v) setExtendDays(""); }} />
          <In label="…or add this many days" type="number" value={extendDays}
            onChange={(v) => { setExtendDays(v); if (v) setExtendDate(""); }} placeholder="e.g. 90" />
        </div>
        <div className="mt-3">
          <In label="Reason (required)" value={extendReason} onChange={setExtendReason}
            placeholder="e.g. Guest was unwell through the validity period" />
        </div>
        {err && <Note kind="crit" className="mt-2">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setExtendOpen(false)}>Back</Btn>
          <Btn disabled={busy || !extendReason.trim() || (!extendDate && !(Number(extendDays) > 0))}
            onClick={async () => {
              if (await act(() => api.packageAssignments.extendExpiry(a._id, {
                ...(extendDate ? { validUntil: extendDate } : { days: Number(extendDays) }),
                reason: extendReason.trim(),
              }), "Expiry extended")) setExtendOpen(false);
            }}>Extend package</Btn>
        </div>
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer sessions to another guest" wide>
        <Note className="my-0">The chosen sessions move to a new package on the other guest's record (same terms, same expiry) and show as Transferred here.</Note>
        <div className="mt-3">
          {transferTo ? <div className="flex items-center justify-between rounded-lg bg-ivory px-3 py-2 text-[12.5px]"><span><B>{transferTo.fullName}</B> <span className="text-ink3">{transferTo.phone}</span></span><button className="text-[11px] text-ink3 underline-offset-2 hover:underline" onClick={() => setTransferTo(null)}>change</button></div>
            : <PatientPickerModal open={transferOpen && !transferTo} onClose={() => setTransferOpen(false)} title="Transfer to — who receives the sessions?" onPick={(u) => setTransferTo(u)} />}
        </div>
        {transferTo && (
          <>
            <div className="mt-3 grid gap-2">
              {(ledger.data?.balances ?? []).filter((b) => b.balance > 0).map((b) => (
                <div key={b.serviceId} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-[12.5px]">
                  <span><B>{b.serviceName ?? b.serviceId}</B> <span className="text-ink3">· {b.balance} left</span></span>
                  <input type="number" min={0} max={b.balance} value={transferQty[b.serviceId] ?? 0} onChange={(e) => setTransferQty({ ...transferQty, [b.serviceId]: Math.max(0, Math.min(b.balance, Number(e.target.value) || 0)) })} className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px]" />
                </div>
              ))}
            </div>
            <div className="mt-2"><In label="Reason" value={transferReason} onChange={setTransferReason} /></div>
            {err && <Note kind="crit" className="mt-2">{err}</Note>}
            <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={() => setTransferOpen(false)}>Back</Btn><Btn disabled={busy || !Object.values(transferQty).some((n) => n > 0)} onClick={async () => { if (await act(() => api.packageAssignments.transfer(a._id, { toUserId: transferTo._id, services: Object.entries(transferQty).filter(([, n]) => n > 0).map(([serviceId, qty]) => ({ serviceId, qty })), reason: transferReason }), "Transferred")) setTransferOpen(false); }}>Transfer</Btn></div>
          </>
        )}
      </Modal>

      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Refund and cancel this package">
        {refundPrev.data && <Note className="my-0">Paid {fmtINR(refundPrev.data.paid)} · {refundPrev.data.unitsLeft} of {refundPrev.data.unitsTotal} sessions unused → suggested refund <B>{fmtINR(refundPrev.data.suggested)}</B>. Unbooked sessions and pending appointments from this package are released.</Note>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <In label="Refund amount (₹)" type="number" value={refundAmt} onChange={setRefundAmt} />
          <Sel label="Refund by" value={refundMethod} onChange={setRefundMethod} options={["Cash", "UPI", "Card reversal", "Bank Transfer", "Credit note"]} />
          <In label="Reference" value={refundRef} onChange={setRefundRef} />
        </div>
        <div className="mt-2"><Area label="Reason" value={refundReason} onChange={setRefundReason} rows={2} /></div>
        {err && <Note kind="crit" className="mt-2">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2"><Btn kind="ghost" onClick={() => setRefundOpen(false)}>Back</Btn><Btn kind="danger" disabled={busy || refundReason.trim().length < 3 || !(Number(refundAmt) >= 0)} onClick={async () => { if (await act(() => api.packageAssignments.refund(a._id, { amount: Number(refundAmt) || 0, method: refundMethod, reference: refundRef || undefined, reason: refundReason.trim() }), "Refund recorded")) { setRefundOpen(false); onClose(); } }}>Refund & cancel</Btn></div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this package">
        <Note kind="crit"><B>The guest must approve.</B> A one-time code is sent to {guest}; enter it here to confirm. The package is marked cancelled — no refund is triggered automatically.</Note>
        <div className="grid gap-2">
          <Area label="Reason (shared with the guest)" value={cancelReason} onChange={setCancelReason} rows={2} />
          {!otpSent
            ? <Btn disabled={busy || cancelReason.trim().length < 4} onClick={sendOtp}>Send code to guest</Btn>
            : <>
                <In label="Code from the guest" value={otp} onChange={setOtp} placeholder="6 digits" />
                <div className="flex justify-end gap-2">
                  <Btn kind="ghost" disabled={busy} onClick={sendOtp}>Resend</Btn>
                  <Btn kind="danger" disabled={busy || otp.trim().length !== 6} onClick={confirmCancel}>Confirm cancellation</Btn>
                </div>
              </>}
        </div>
        {err && <Note kind="crit">{err}</Note>}
      </Modal>
    </Drawer>
  );
}

/* ================= DOCTORS ================= */
export function Doctors() {
  // Dermatologists practise at clinics, never at a pharmacy shelf.
  const { toast, audit, can, clinics: branches } = useStore();
  const nav = useNavigate();
  const [sel, setSel] = useState<Doctor | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState<Doctor | null>(null);

  const q = useApi(() => api.doctors.list({ includeInactive: "true" }), []);
  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);
  const requests = useApi(() => api.feeRequests.list({ limit: 200 }), []);
  const list = q.data?.data ?? [];
  const tierList = tiers.data ?? [];
  const allRequests = requests.data?.data ?? [];
  const pending = allRequests.filter((r) => r.status === "Pending");

  /** Effective fee: an approved personal rate, else the tier's standard fee. */
  const feeFor = (d: Doctor) => d.fee || tierList.find((t) => t.id === d.tier)?.fee || 0;
  const onStandard = (d: Doctor) => !d.fee || d.fee <= 0;

  const reloadAll = () => { q.reload(); tiers.reload(); requests.reload(); practitioners.reload(); };

  // Zenoti's doctor roster, for "in Zenoti but not in the app" and centre hints.
  const practitioners = useApi(() => api.zenoti.practitioners().catch(() => []), []);
  const zenotiRows = practitioners.data ?? [];
  const notOnboarded = zenotiRows.filter((p) => p.source === "zenoti" && !p.onboarded && !p.historical);
  const zenotiCentresFor = (d: Doctor) => zenotiRows.find((p) => p.doctorId === d.doctorId)?.centers ?? null;
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const onboard = async (employeeId: string, name: string) => {
    setOnboarding(employeeId);
    try {
      await api.zenoti.onboardPractitioner(employeeId);
      toast(`${name} added as an app dermatologist — set working hours and a panel login next`);
      audit("DOCTOR_CREATED", `${name} onboarded from Zenoti`, {});
      reloadAll();
    } catch (e) { toast((e as Error).message); } finally { setOnboarding(null); }
  };

  return (
    <Page title="Dermatologists"
      sub={list.length
        ? `${list.length} practitioner${list.length === 1 ? "" : "s"} · ${tierList.map((t) => `${t.title} ${fmtINR(t.fee)}`).join(" · ")}`
        : "The dermatology team the app shows"}
      actions={<>
        {can("dermatologists.manage") && tierList.length > 0 && <TierEditor tiers={tierList} onSaved={reloadAll} />}
        {can("dermatologists.manage") && <Btn onClick={() => setAddOpen(true)}>+ Add dermatologist</Btn>}
      </>}>
      <Hint id="doctors-live">The clinic sets a <B>standard fee per tier</B> under Consultation fees — that is what every dermatologist on the tier charges. A doctor who wants a different rate raises a request, and you decide here. Nothing a doctor does changes their own price.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <FeeRequestQueue
        requests={allRequests}
        canDecide={can("dermatologists.manage")}
        tiers={tierList}
        onDecided={reloadAll}
      />

      <Async q={q} label="Loading the team…" rows={6}>
        {() => list.length === 0 ? (
          <Empty title="No dermatologists yet"
            hint="Add the dermatology team, or seed it from the clinic's profiles with `node scripts/seedDoctors.js` in the Backend folder."
            action={can("dermatologists.manage") ? <Btn onClick={() => setAddOpen(true)}>+ Add dermatologist</Btn> : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((doc) => (
              <Card key={doc._id} onClick={() => setSel(doc)} className={`p-4 ${doc.isActive ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  {doc.photo
                    ? <img src={doc.photo} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
                    : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sage to-cream text-[15px] font-extrabold text-primary">{initials(doc.name)}</span>}
                  <div className="min-w-0">
                    <b className="block text-[14px] font-bold leading-tight">{doc.name}</b>
                    <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-gold-dark">
                      {doc.designation ?? tierList.find((t) => t.id === doc.tier)?.title ?? doc.tier}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink3">
                      {doc.experienceYears ? `${doc.experienceYears} yrs` : ""}
                      {doc.availableCentres?.length ? ` · ${doc.availableCentres.join(", ")}` : ""}
                    </div>
                  </div>
                  <span className="ml-auto shrink-0 text-right">
                    <span className="block rounded-lg bg-cream px-2 py-1 font-mono text-[11.5px] font-bold text-primary">{fmtINR(feeFor(doc))}</span>
                    <span className={`mt-0.5 block text-[9px] font-bold uppercase tracking-[0.04em] ${onStandard(doc) ? "text-ink3" : "text-gold-dark"}`}>
                      {onStandard(doc) ? "standard" : "own rate"}
                    </span>
                    {pending.some((r) => r.doctorId === doc.doctorId) && (
                      <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.04em] text-warn">request open</span>
                    )}
                  </span>
                </div>
                {!!doc.qualifications?.length && (
                  <div className="mt-2.5 text-[11px] leading-relaxed text-ink3">{doc.qualifications.join(", ")}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {(doc.expertise ?? []).slice(0, 4).map((e) => (
                    <span key={e} className="rounded-full bg-sage px-2 py-0.5 text-[10px] font-semibold text-secondary">{e}</span>
                  ))}
                  {(doc.expertise?.length ?? 0) > 4 && <span className="text-[10px] text-ink3">+{doc.expertise!.length - 4}</span>}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-ink3">
                  <span className="flex gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); nav(`/dermatologist?id=${doc._id}`); }}
                      className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-white hover:bg-primary-hover">
                      View details
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); nav(`/doctors/schedule?doctorId=${encodeURIComponent(doc.doctorId)}`); }}
                      className="rounded-lg bg-sage px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary hover:text-white"
                      title="Set the days and hours this dermatologist takes appointments — this is what fills the booking slots">
                      Working hours
                    </button>
                  </span>
                  <Tag kind={doc.isActive ? "ok" : "mute"}>{doc.isActive ? "Live" : "Hidden"}</Tag>
                </div>
                {(() => { const z = zenotiCentresFor(doc); if (!z) return <div className="mt-1.5 text-[10.5px] text-warn">Not linked to a Zenoti doctor — clinic visits cannot be attributed and app bookings cannot name them in Zenoti.</div>; const extra = z.filter((c) => !(doc.availableCentres ?? []).includes(c)); return extra.length ? <div className="mt-1.5 text-[10.5px] text-ink3">Zenoti also rosters them at {extra.join(", ")} — add the centre here if they take app bookings there.</div> : null; })()}
              </Card>
            ))}
          </div>
        )}
      </Async>

      <DoctorEditor
        open={addOpen || !!sel}
        doctor={sel}
        tiers={tierList}
        branchNames={branches.map((b) => b.name)}
        onClose={() => { setAddOpen(false); setSel(null); }}
        onSaved={() => { q.reload(); setAddOpen(false); setSel(null); }}
        onDelete={(d) => { setSel(null); setDel(d); }}
      />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `dermatologist "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            const res = await api.doctors.remove(del._id);
            audit("DOCTOR_DELETED", `${del.name} · reason: ${reason}`, { doctorId: del.doctorId });
            toast((res as { message?: string }).message ?? "Dermatologist removed");
            q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}


/* ---------- fee-change requests: the admin's decision queue ---------- */
function FeeRequestQueue({ requests, canDecide, tiers, onDecided }: {
  requests: DoctorFeeRequest[];
  canDecide: boolean;
  tiers: { id: string; title: string; fee: number }[];
  onDecided: () => void;
}) {
  const { toast, audit } = useStore();
  const [open, setOpen] = useState<DoctorFeeRequest | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const pending = requests.filter((r) => r.status === "Pending");
  const decided = requests.filter((r) => r.status !== "Pending");

  useEffect(() => {
    if (!open) return;
    setAmount(String(open.requestedFee));
    setNote("");
    setErr(null);
  }, [open?._id]);

  const decide = async (action: "approve" | "reject") => {
    if (!open) return;
    setBusy(true); setErr(null);
    try {
      if (action === "approve") {
        const res = await api.feeRequests.approve(open._id, {
          approvedFee: Number(amount) || open.requestedFee,
          reviewNote: note.trim() || undefined,
        });
        audit("DOCTOR_UPDATED",
          `Approved fee for ${open.doctorName} at ${fmtINR(res.approvedFee ?? 0)}`,
          { doctorId: open.doctorId });
        toast(`${open.doctorName} now charges ${fmtINR(res.approvedFee ?? 0)}`);
      } else {
        await api.feeRequests.reject(open._id, note.trim());
        audit("DOCTOR_UPDATED", `Rejected fee request from ${open.doctorName}`, { doctorId: open.doctorId });
        toast("Request rejected — the dermatologist can see your note");
      }
      setOpen(null);
      onDecided();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (pending.length === 0 && decided.length === 0) return null;

  const delta = (r: DoctorFeeRequest) => {
    const diff = r.requestedFee - r.currentFee;
    const sign = diff > 0 ? "+" : "";
    const pctChange = r.currentFee ? Math.round((diff / r.currentFee) * 100) : 0;
    return `${sign}${fmtINR(diff)}${r.currentFee ? ` · ${sign}${pctChange}%` : ""}`;
  };

  return (
    <>
      {pending.length > 0 && (
        <Card className="mb-4 border-gold-dark p-4">
          <SecH t="Fee change requests" em={`· ${pending.length} awaiting your decision`} />
          {!canDecide && (
            <Note kind="crit" className="mt-0">
              Only an Admin or Super Admin can decide these.
            </Note>
          )}
          <DataTable
            cols={["Dermatologist", "Now", "Requested", "Change", "Reason", "Raised", ""]}
            onRow={canDecide ? (i) => setOpen(pending[i]) : undefined}
            rows={pending.map((r) => [
              <span key={r._id}>
                <B>{r.doctorName}</B>
                <span className="block text-[10.5px] text-ink3">
                  {r.currentFeeWasTierFee ? "on the standard fee" : "on a personal rate"}
                </span>
              </span>,
              fmtINR(r.currentFee),
              <b key={`${r._id}rf`} className="text-gold-dark">{fmtINR(r.requestedFee)}</b>,
              <span key={`${r._id}d`} className={r.requestedFee > r.currentFee ? "text-warn" : "text-ok"}>
                {delta(r)}
              </span>,
              <span key={`${r._id}re`} className="line-clamp-2 text-[11.5px] text-ink3">{r.reason}</span>,
              fmtWhen(r.createdAt),
              canDecide ? <Btn key={`${r._id}b`} kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]">Review</Btn> : "",
            ])}
          />
        </Card>
      )}

      {decided.length > 0 && (
        <div className="mb-4">
          <button onClick={() => setShowHistory((v) => !v)}
            className="text-[12px] font-semibold text-ink3 hover:text-ink2">
            {showHistory ? "▾" : "▸"} Decided requests ({decided.length})
          </button>
          {showHistory && (
            <div className="mt-2">
              <DataTable cols={["Dermatologist", "Requested", "Outcome", "Decided by", "Note", "When"]}
                rows={decided.slice(0, 30).map((r) => [
                  <B key={r._id}>{r.doctorName}</B>,
                  <span key={`${r._id}a`}>{fmtINR(r.currentFee)} → {fmtINR(r.requestedFee)}</span>,
                  r.status === "Approved"
                    ? <Tag key={`${r._id}s`} kind="ok">
                        Approved{r.approvedFee !== r.requestedFee ? ` at ${fmtINR(r.approvedFee ?? 0)}` : ""}
                      </Tag>
                    : r.status === "Rejected"
                      ? <Tag key={`${r._id}s`} kind="err">Rejected</Tag>
                      : <Tag key={`${r._id}s`} kind="mute">{r.status}</Tag>,
                  r.reviewedByEmail ?? "—",
                  <span key={`${r._id}n`} className="line-clamp-2 text-[11.5px] text-ink3">{r.reviewNote ?? "—"}</span>,
                  fmtWhen(r.decidedAt ?? r.createdAt),
                ])} />
            </div>
          )}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Fee request — ${open.doctorName}` : ""}>
        {open && (
          <>
            <Card className="p-3.5">
              <div className="grid gap-1.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="text-ink3">Charging now</span>
                  <b>{fmtINR(open.currentFee)}{open.currentFeeWasTierFee ? " (standard)" : " (personal rate)"}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink3">Requested</span>
                  <b className="text-gold-dark">{fmtINR(open.requestedFee)}</b>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5">
                  <span className="text-ink3">Change</span>
                  <b className={open.requestedFee > open.currentFee ? "text-warn" : "text-ok"}>{delta(open)}</b>
                </div>
              </div>
              <div className="mt-2.5 rounded-lg bg-ivory px-3 py-2 text-[12.5px] text-ink2">
                <b className="block text-[11px] text-ink3">Their reason</b>
                {open.reason}
              </div>
              <div className="mt-1.5 font-mono text-[10.5px] text-ink3">
                Raised {fmtWhen(open.createdAt)}{open.requestedByEmail ? ` by ${open.requestedByEmail}` : ""}
              </div>
            </Card>

            <div className="mt-3">
              <In label="Approve at (₹)" type="number" value={amount} onChange={setAmount}
                hint={`Change this to approve a different amount than the ${fmtINR(open.requestedFee)} requested.`} />
            </div>
            <div className="mt-3">
              <Area label="Note to the dermatologist" value={note} onChange={setNote} rows={2}
                placeholder="Optional when approving · required when rejecting" />
            </div>

            <Note className="mb-0 text-[11.5px]">
              Approving sets a <B>personal rate</B> for this doctor. Everyone else on the{" "}
              {tiers.find((t) => t.id)?.title ? "same tier" : "tier"} stays on the standard fee, and the
              new price applies to bookings made from now on.
            </Note>

            {err && <Note kind="crit">{err}</Note>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Btn kind="ghost" onClick={() => setOpen(null)}>Close</Btn>
              <Btn kind="danger" disabled={busy || note.trim().length < 4} onClick={() => decide("reject")}>
                Reject
              </Btn>
              <Btn disabled={busy || !Number(amount)} onClick={() => decide("approve")}>
                {busy ? "Saving…" : `Approve at ${fmtINR(Number(amount) || 0)}`}
              </Btn>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function TierEditor({ tiers, onSaved }: {
  tiers: { id: string; title: string; description?: string; fee: number }[]; onSaved: () => void;
}) {
  const { toast, audit } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(tiers);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDraft(tiers); }, [open, tiers]);

  return (
    <>
      <Btn kind="ghost" onClick={() => setOpen(true)}>Standard pricing</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Standard consultation pricing">
        <Note className="mt-0">
          This is the clinic's <B>standard fee</B> for each tier — the price every dermatologist on that tier
          charges. It is the whole cost of the consultation; nothing is added at checkout. A doctor who
          needs a different rate raises a request for you to approve; they cannot change it themselves.
        </Note>
        {draft.map((t, i) => (
          <div key={t.id} className="mb-3 rounded-xl border border-border bg-ivory p-3">
            <In label="Title" value={t.title} onChange={(v) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
            <div className="mt-2"><In label="Standard fee (₹)" type="number" value={String(t.fee)}
              onChange={(v) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, fee: Number(v) || 0 } : x)))}
              hint="Applies to every dermatologist on this tier who is not on an approved personal rate." /></div>
            <div className="mt-2"><Area label="Description" value={t.description ?? ""} rows={2}
              onChange={(v) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, description: v } : x)))} /></div>
          </div>
        ))}
        <div className="mt-3 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              for (const t of draft) await api.doctors.updateTier?.(t.id, t);
              audit("SETTINGS_UPDATED", `Standard consultation pricing: ${draft.map((t) => `${t.title} ${t.fee}`).join(", ")}`);
              toast("Standard pricing updated — the app and checkout follow it now");
              onSaved(); setOpen(false);
            } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Save fees"}</Btn>
        </div>
      </Modal>
    </>
  );
}


/* ================= DERMATOLOGIST DETAIL ================= */
export function DermatologistDetail() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const id = sp.get("id") ?? "";
  const { toast, audit, can, clinics: branches, admin } = useStore();
  const [range, setRange] = useState("Last 90 days");
  const [editOpen, setEditOpen] = useState(false);
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPhone, setAcctPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const win = useMemo(() => {
    const e = new Date(); const s = new Date();
    if (range === "Last 30 days") s.setDate(e.getDate() - 29);
    else if (range === "Last 90 days") s.setDate(e.getDate() - 89);
    else if (range === "This year") s.setMonth(0, 1);
    else s.setFullYear(e.getFullYear() - 5);
    return { startDate: isoDay(s), endDate: isoDay(e) };
  }, [range]);

  const q = useApi(() => (id ? api.doctors.get(id) : Promise.reject(new Error("No dermatologist selected"))), [id]);
  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);
  const stats = useApi(() => (id ? api.doctors.stats(id, win) : Promise.resolve(undefined)), [id, win.startDate, win.endDate]);
  const account = useApi(() => (id && admin?.role !== "doctor" ? api.doctors.account(id).catch(() => null) : Promise.resolve(null)), [id]);
  useEffect(() => { if (account.data) { setAcctEmail(account.data.email); setAcctPhone(account.data.phone ?? ""); } }, [account.data]);

  const d = q.data;
  const st = stats.data;
  const tierList = tiers.data ?? [];
  const tierTitle = d ? (tierList.find((t) => t.id === d.tier)?.title ?? (d.tier === "senior-consultant" ? "Senior Dermatologist" : "Dermatologist")) : "";
  const fee = d ? (d.fee || tierList.find((t) => t.id === d.tier)?.fee || 0) : 0;

  const saveAccount = async () => {
    if (!d) return;
    setBusy(true);
    try {
      await api.doctors.update(d._id, { email: acctEmail.trim().toLowerCase() || null, phone: acctPhone.trim() || null } as Partial<Doctor>);
      audit("DOCTOR_UPDATED", `${d.name} · login contact updated`, { doctorId: d._id });
      toast("Login details saved"); q.reload(); account.reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Async q={q} label="Loading dermatologist…" rows={6}>
      {(doc) => (
        <Page title={doc.name}
          sub={`${tierTitle} · ${fmtINR(fee)} per consultation · ${(doc.availableCentres ?? []).join(", ") || "no centre yet"}${doc.experienceYears ? ` · ${doc.experienceYears} yrs` : ""}`}
          actions={<>
            <Menu button={<Btn kind="ghost">{range} ▾</Btn>} items={["Last 30 days", "Last 90 days", "This year", "All time"].map((l) => ({ label: l, onClick: () => setRange(l) }))} />
            <Btn kind="ghost" onClick={() => nav("/doctors")}>← All dermatologists</Btn>
            <Btn kind="ghost" onClick={() => nav(`/doctors/schedule?doctorId=${encodeURIComponent(doc.doctorId)}`)}>Working hours</Btn>
            <Btn kind="ghost" onClick={() => nav(`/bookings?scope=all`, { state: { specialistId: doc.doctorId } })}>Bookings</Btn>
            {can("dermatologists.manage") && <Btn onClick={() => setEditOpen(true)}>Edit profile</Btn>}
          </>}>
          <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {st && (
                <>
                  <Stats items={[
                    { k: "Revenue", v: fmtCompactINR(st.summary.revenue), d: `consults ${fmtCompactINR(st.summary.consultationRevenue)} · treatments ${fmtCompactINR(st.summary.treatmentRevenue)}`, hot: true },
                    { k: "Consultations", v: st.summary.consultations, d: `${st.summary.treatments} treatments` },
                    { k: "Completed", v: st.summary.completed, d: `${st.summary.bookings} booked · ${st.summary.upcoming} upcoming` },
                    { k: "No-shows", v: st.summary.noShow, d: `${st.summary.cancelled} cancelled`, tone: st.summary.noShow ? "dn" : undefined },
                    { k: "Patients", v: st.summary.patients, d: `${st.allTime.patients} all time` },
                    { k: "Rating", v: st.summary.avgRating ? `★ ${st.summary.avgRating}` : "—", d: `${st.summary.ratings} rating${st.summary.ratings === 1 ? "" : "s"}${st.summary.avgSessionMinutes ? ` · ${st.summary.avgSessionMinutes} min avg` : ""}` },
                  ]} />
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <ChartCard title="Month by month" sub="Consultations vs treatments">
                      {st.byMonth.length > 1 ? <GBars cats={st.byMonth.map((m) => m.month.slice(2).replace("-", "/"))} series={[{ n: "Consultations", v: st.byMonth.map((m) => m.consultations) }, { n: "Treatments", v: st.byMonth.map((m) => m.treatments) }]} /> : <Empty title="Pick a longer range" />}
                    </ChartCard>
                    <ChartCard title="Revenue by month" hero={fmtINR(st.summary.revenue)}>
                      {st.byMonth.length > 1 ? <AreaChart pts={st.byMonth.map((m) => m.revenue)} label="Revenue" labels={st.byMonth.map((m) => m.month.slice(5))} format={fmtCompactINR} /> : <Empty title="Pick a longer range" />}
                    </ChartCard>
                  </div>
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    <ChartCard title="Top services">{st.topServices.length ? <HBars rows={st.topServices.slice(0, 8).map((s) => [s.name, s.bookings, fmtINR(s.revenue)] as [string, number, string])} /> : <Empty title="No visits in this period" />}</ChartCard>
                    <ChartCard title="By centre">{st.byCentre.length ? <HBars rows={st.byCentre.map((c) => [c.centre, c.bookings] as [string, number])} color="var(--color-c3)" /> : <Empty title="No visits in this period" />}</ChartCard>
                  </div>
                  <div className="mt-3">
                    <SecH t="Recent visits" em={`· ${st.recent.length}`} />
                    {st.recent.length === 0 ? <Empty title="No visits in this period" /> : (
                      <DataTable cols={["When", "Guest", "Service", "Kind", "Status", "Amount", "Rating"]}
                        onRow={(i) => nav("/bookings", { state: { open: st.recent[i]._id } })}
                        rows={st.recent.map((r) => [
                          fmtWhen(r.date, r.time), <B key={r._id}>{r.guest}</B>, r.service ?? "—",
                          r.kind === "consultation" ? <Tag key={`${r._id}k`} kind="gold">Consultation</Tag> : <Tag key={`${r._id}k`} kind="mute">Treatment</Tag>,
                          r.status, r.paymentStatus === "paid" ? fmtINR(r.amount) : <span className="text-ink3">{fmtINR(r.amount)} due</span>, r.rating ? `★ ${r.rating}` : "—",
                        ])} />
                    )}
                  </div>
                  {st.feedback.length > 0 && (
                    <div className="mt-3"><SecH t="Guest feedback" />
                      {st.feedback.map((f, i) => <Card key={i} className="mb-2 p-3 text-[12.5px]"><B>★ {f.rating}</B> · {f.guest} · <span className="text-ink3">{fmtDate(f.date)}</span><div className="mt-1 text-ink2">{f.feedback}</div></Card>)}
                    </div>
                  )}
                </>
              )}
              {stats.loading && !st && <Loading label="Crunching the numbers…" rows={4} />}
            </div>

            <div className="grid gap-3">
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  {doc.photo ? <img src={doc.photo} alt="" className="h-16 w-16 rounded-full object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-sage to-cream text-[18px] font-extrabold text-primary">{initials(doc.name)}</span>}
                  <div className="min-w-0">
                    <b className="block text-[15px] font-bold leading-tight">{doc.name}</b>
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-gold-dark">{doc.designation ?? tierTitle}</div>
                    <div className="mt-0.5"><Tag kind={doc.isActive ? "ok" : "mute"}>{doc.isActive ? "Live in app" : "Hidden"}</Tag></div>
                  </div>
                </div>
                <div className="mt-3 grid gap-1 text-[12.5px]">
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-ink3">Fee</span><B>{fmtINR(fee)}{doc.fee ? " (own rate)" : " (standard)"}</B></div>
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-ink3">Experience</span><B>{doc.experienceYears ? `${doc.experienceYears} years` : "—"}</B></div>
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-ink3">Centres</span><b className="text-right font-bold">{(doc.availableCentres ?? []).join(", ") || "—"}</b></div>
                </div>
                {!!doc.qualifications?.length && <div className="mt-3"><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Qualifications</div><div className="text-[12px] text-ink2">{doc.qualifications.join(", ")}</div></div>}
                {!!doc.expertise?.length && <div className="mt-2"><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Expertise</div><div className="mt-1 flex flex-wrap gap-1">{doc.expertise.map((e) => <span key={e} className="rounded-full bg-sage px-2 py-0.5 text-[10.5px] font-semibold text-secondary">{e}</span>)}</div></div>}
                {!!doc.achievements?.length && <div className="mt-2"><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Achievements</div><ul className="text-[12px] text-ink2">{doc.achievements.map((a) => <li key={a}>• {a}</li>)}</ul></div>}
              </Card>

              {can("dermatologists.manage") && (
                <Card className="p-4">
                  <SecH t="Panel login" right={account.data ? <Tag kind={account.data.hasPassword ? "ok" : "info"}>{account.data.hasPassword ? "password set" : "code only"}</Tag> : undefined} />
                  <Note className="mt-0">
                    Dermatologists sign in to their panel with the login email below and either a password you set here or a 6-digit code emailed to that address.
                    {account.data?.placeholderEmail ? " This address is a placeholder that cannot receive a code — set a password so they can sign in." : ""}
                  </Note>
                  <div className="grid gap-2">
                    <In label="Login email" type="email" value={acctEmail} onChange={setAcctEmail} hint={account.data?.placeholderEmail ? "Placeholder — replace with their real address" : undefined} />
                    <In label="Phone" value={acctPhone} onChange={setAcctPhone} placeholder="10-digit mobile" />
                    <Btn kind="ghost" disabled={busy} onClick={saveAccount}>Save login details</Btn>
                    {account.data && (
                      <SignInControls accountId={account.data._id} email={account.data.email} phone={account.data.phone}
                        hasPassword={!!account.data.hasPassword} onChanged={() => account.reload()} />
                    )}
                    {account.data?.lastLogin && <div className="text-[11px] text-ink3">Last signed in {fmtAgo(account.data.lastLogin)}</div>}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <DoctorEditor open={editOpen} doctor={doc} tiers={tierList} branchNames={branches.map((b) => b.name)}
            onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); q.reload(); }} onDelete={() => undefined} />

        </Page>
      )}
    </Async>
  );
}

/** Chip editor — click a chip to remove it, type and press Enter to add one.
    Mirrors the dermatologist panel's My profile, so both sides edit the same
    fields with the same element. */
function ChipList({ label, em, values, onChange, placeholder }: {
  label: string; em?: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <SecH t={label} em={em} />
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((e, i) => (
          <button key={`${e}${i}`} type="button" title="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="rounded-full bg-sage px-2.5 py-1 text-[11px] font-semibold text-secondary hover:bg-err-bg hover:text-err">{e} ×</button>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder ?? "+ type & press Enter"}
          className="w-60 max-w-full rounded-full border border-dashed border-border bg-surface px-2.5 py-1 text-[11px] outline-none focus:border-gold-dark" />
      </div>
    </div>
  );
}

function DoctorEditor({ open, doctor, tiers, branchNames, onClose, onSaved, onDelete }: {
  open: boolean; doctor: Doctor | null;
  tiers: { id: string; title: string; fee: number }[];
  branchNames: string[];
  onClose: () => void; onSaved: () => void; onDelete: (d: Doctor) => void;
}) {
  const { toast, audit } = useStore();
  const [f, setF] = useState<Partial<Doctor>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(doctor ?? {
      name: "", tier: (tiers[tiers.length - 1]?.id ?? "") as Doctor["tier"], level: "dermatologist",
      designation: tiers[tiers.length - 1]?.title ?? "Dermatologist",
      availableCentres: [], qualifications: [], expertise: [], achievements: [],
      experienceYears: 0, fee: 0, isActive: true, photo: "", email: "", phone: "", branch: "", displayOrder: 0,
    });
    setErr(null);
  }, [open, doctor?._id]);

  const uploadPhoto = (file: File) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "");

  const set = <K extends keyof Doctor>(k: K) => (v: Doctor[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setErr(null);
    if (!f.name?.trim()) return setErr("A name is required");
    if (!f.tier) return setErr("Pick a consultation tier");
    if (!(f.availableCentres ?? []).length) return setErr("Assign at least one centre — a dermatologist with no centre cannot be booked");
    // Creating a dermatologist creates their login in the same save — name,
    if (!doctor) {
      const email = f.email?.trim() ?? "";
      if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("A valid work email is required — it becomes their sign-in address");
      if (!f.phone?.trim()) return setErr("A contact phone number is required");
    }

    setBusy(true);
    try {
      const body: Partial<Doctor> = {
        ...f,
        email: f.email?.trim().toLowerCase() || null,
        phone: f.phone?.trim() || null,
        branch: f.branch || null,
        displayOrder: Number(f.displayOrder) || 0,
        experienceYears: Number(f.experienceYears) || 0,
        fee: Number(f.fee) || 0,
      };
      if (doctor) {
        await api.doctors.update(doctor._id, body);
        audit("DOCTOR_UPDATED", `${f.name} · ${(f.availableCentres ?? []).join(", ")}`, { doctorId: doctor.doctorId });
        toast("Dermatologist updated — the app reflects it immediately");
      } else {
        // One request: profile + login + credentials email, so the account
        const res = await api.doctors.create({ ...body });
        const created = res.data as Doctor;
        audit("DOCTOR_CREATED", `${created.name} · ${(created.availableCentres ?? []).join(", ")}`, { doctorId: created.doctorId });
        toast((res.message as string) ?? `${created.name} added`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={doctor ? doctor.name : "Add dermatologist"}>
      <div className="grid gap-3">
        <In label="Full name" value={f.name ?? ""} onChange={set("name")} placeholder="Rickson Pereira" />
        <UploadField label="Photo" value={f.photo ?? ""} onChange={set("photo")} upload={uploadPhoto} preview={false}
          hint="Leave blank for an initials avatar" />
        {f.photo && <img src={f.photo} alt="" className="h-24 w-24 rounded-full border border-border object-cover" />}

        <In label="Work email" value={f.email ?? ""} onChange={set("email")} placeholder="doctor@zennara.in"
          hint="Their sign-in address — a 6-digit code is emailed here each time they sign in" />
        <In label="Phone (staff only — never shown in the app)" value={f.phone ?? ""} onChange={set("phone")} />

        {tiers.length === 0 && <Note kind="crit">No consultation tiers exist yet — set them up under Standard pricing before adding dermatologists.</Note>}
        <Sel label="Consultation tier"
          value={tiers.find((t) => t.id === f.tier)?.title ?? f.tier ?? ""}
          onChange={(v) => set("tier")((tiers.find((t) => t.title === v)?.id ?? f.tier) as Doctor["tier"])}
          options={tiers.map((t) => t.title)} />
        <In label="Personal rate (₹)" type="number" value={String(f.fee ?? 0)} onChange={(v) => set("fee")(Number(v) || 0)}
          hint={`0 keeps them on the standard fee of ${fmtINR(tiers.find((t) => t.id === f.tier)?.fee ?? 0)}. Normally this is set by approving the dermatologist's request rather than typed here.`} />
        {!!f.fee && f.fee > 0 && doctor && (
          <Btn kind="ghost" disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await api.feeRequests.clearOverride(doctor.doctorId);
              set("fee")(0);
              audit("DOCTOR_FEE_APPROVED", `${doctor.name} back on the standard fee`, { doctorId: doctor.doctorId });
              toast("Back on the standard fee"); onSaved();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>
            Put back on the standard fee ({fmtINR(tiers.find((t) => t.id === f.tier)?.fee ?? 0)})
          </Btn>
        )}

        <Note className="mb-0">Shown in the app as <B>{f.tier === "senior-consultant" ? "Senior Dermatologist" : "Dermatologist"}</B> — the label follows the fee tier above. There are only two.</Note>
        <div className="grid grid-cols-2 gap-2">
          <In label="Years of experience" type="number" value={String(f.experienceYears ?? 0)}
            onChange={(v) => set("experienceYears")(Number(v) || 0)} />
          <In label="Order in the app" type="number" value={String(f.displayOrder ?? 0)}
            onChange={(v) => set("displayOrder")(Number(v) || 0)} hint="Lower comes first" />
        </div>
        {branchNames.length > 0 && (
          <Sel label="Home centre — profile label only" value={f.branch || "—"} onChange={(v) => set("branch")(v === "—" ? null : v)}
            options={["—", ...branchNames]} />
        )}
        {!!f.branch && !(f.availableCentres ?? []).includes(f.branch) && (
          <Note kind="crit" className="mt-0">
            {f.branch} is set as the home centre but is not in their bookable centres below — guests will
            read a centre they cannot book there. Add it below or clear the home centre.
          </Note>
        )}
        <Area label="About them — shown on the app card" value={f.experienceNote ?? ""} onChange={set("experienceNote")} rows={2} />

        <div>
          <div className="mb-1.5 text-[11px] font-bold text-ink2">Centres — a dermatologist only appears where they practise</div>
          {branchNames.length === 0 ? (
            <div className="text-[12px] text-ink3">No branches configured yet.</div>
          ) : (
            <MultiSelect options={branchNames.map((b) => [b, b])} value={f.availableCentres ?? []}
              onChange={set("availableCentres")} placeholder="Select centres…" searchPlaceholder="Search centres…" />
          )}
        </div>

        <div className="grid gap-4">
          <ChipList label="Qualifications" em="· shown on the app card" values={f.qualifications ?? []}
            onChange={set("qualifications")} placeholder="+ e.g. MD (Dermatology) — Enter to add" />
          <ChipList label="Expertise" em="· shown on the app card" values={f.expertise ?? []}
            onChange={set("expertise")} placeholder="+ e.g. Acne & acne scars — Enter to add" />
          <ChipList label="Achievements" em="· optional" values={f.achievements ?? []}
            onChange={set("achievements")} placeholder="+ e.g. 10,000+ procedures — Enter to add" />
        </div>

        <Switch on={!!f.isActive} onChange={set("isActive")} label="Listed in the app"
          sub="Off removes them from consultation booking without deleting history" />

        <Note>Selecting centres here also updates the booking slot engine, so a dermatologist becomes bookable at those centres straight away.</Note>
        {err && <Note kind="crit">{err}</Note>}

        <div className="flex flex-wrap gap-2">
          <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : doctor ? "Save changes" : "Add dermatologist"}</Btn>
          {doctor && <Btn kind="danger" onClick={() => onDelete(doctor)}>Delete</Btn>}
        </div>
      </div>
    </Drawer>
  );
}


/* ================= THERAPISTS ================= */
/**
 * Floor-staff accounts — the people who run treatment sessions on the tablet.
 *
 * Mirrors the dermatologist onboarding: name, email and phone are
 * all required at creation, the credentials are emailed by the server, and
 * The assigned centre pins their panel's floor to
 * that centre.
 */
export function Therapists() {
  const { toast, audit, branches, can } = useStore();
  const q = useApi(() => api.staff.list({ role: "therapist" }), []);
  const list = (q.data?.data ?? []) as Admin[];

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Admin | null>(null);
  const [toDelete, setToDelete] = useState<Admin | null>(null);

  const centreNames = (a: Admin) => {
    const ids = (a.branchIds?.length ? a.branchIds : a.branchId ? [a.branchId] : []) as string[];
    const names = ids.map((id) => branches.find((b) => b._id === id)?.name).filter(Boolean) as string[];
    return names.length ? names.join(", ") : "—";
  };

  const open = (a: Admin | null) => { setEditing(a); setEditorOpen(true); };



  return (
    <Page title="Therapists" sub={`${list.length} floor staff · they run sessions on the Therapist panel`}
      actions={can("therapists.manage") ? <Btn onClick={() => open(null)}>+ Add therapist</Btn> : undefined}>
      <Hint id="therapists-how">
        A therapist signs in to the Therapist panel with a 6-digit code emailed to their work address each time —
        there is no password. The assigned centre pins their floor to that centre. Sessions, stock use and
        service cards are written from their tablet.
      </Hint>

      <Async q={q} label="Loading therapists…" rows={5}>
        {() => list.length === 0 ? (
          <Empty title="No therapists yet"
            hint="Add one — they sign in with a code emailed to them and can run sessions the moment a centre is assigned."
            action={can("therapists.manage") ? <Btn onClick={() => open(null)}>+ Add therapist</Btn> : undefined} />
        ) : (
          <>
            <DataTable cols={["Name", "Email", "Phone", "Centres", "Last sign-in", "Status"]}
              onRow={can("therapists.manage") ? (i) => open(list[i]) : undefined}
              rows={list.map((a) => [
                <B key={a._id}>{a.name}</B>,
                a.email,
                a.phone || "—",
                centreNames(a),
                a.lastLogin ? fmtAgo(a.lastLogin) : "never",
                a.isActive ? <Tag key={`${a._id}s`} kind="ok">active</Tag> : <Tag key={`${a._id}s`} kind="mute">inactive</Tag>,
              ])} />
            {can("therapists.manage") && <div className="mt-2 text-[11.5px] text-ink3">Click a therapist to open their details — centres, status and delete live there.</div>}
          </>
        )}
      </Async>

      <TherapistEditor open={editorOpen} therapist={editing} branches={branches.map((b) => [b._id, b.name] as [string, string])}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); q.reload(); }}
        onToggle={async () => {
          if (!editing) return;
          try {
            await api.staff.toggle(editing._id);
            audit("SETTINGS_UPDATED", `${editing.name} · therapist ${editing.isActive ? "deactivated" : "activated"}`, { staffId: editing._id });
            toast(editing.isActive ? `${editing.name} deactivated — signed out everywhere` : `${editing.name} activated`);
            setEditorOpen(false); q.reload();
          } catch (e) { toast((e as Error).message); }
        }}
        onDelete={() => { if (editing) { setEditorOpen(false); setToDelete(editing); } }} />


      <DeleteModal open={!!toDelete} onClose={() => setToDelete(null)}
        what={toDelete ? `${toDelete.name} (therapist)` : "this therapist"}
        onConfirm={async (reason) => {
          if (!toDelete) return;
          try {
            await api.staff.remove(toDelete._id);
            audit("SETTINGS_UPDATED", `${toDelete.name} · therapist deleted — ${reason}`, { staffId: toDelete._id });
            toast(`${toDelete.name} deleted`);
            setToDelete(null); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function TherapistEditor({ open, therapist, branches, onClose, onSaved, onToggle, onDelete }: {
  open: boolean; therapist: Admin | null; branches: [string, string][];
  onClose: () => void; onSaved: () => void;
  onToggle?: () => void; onDelete?: () => void;
}) {
  const { toast, audit, can } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(therapist?.name ?? "");
    setEmail(therapist?.email ?? "");
    setPhone(therapist?.phone ?? "");
    setBranchIds(((therapist?.branchIds?.length ? therapist.branchIds : therapist?.branchId ? [therapist.branchId] : []) as string[]) ?? []);
    setErr(null);
  }, [open, therapist?._id]);

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr("A name is required");
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setErr("A valid email is required — it becomes their sign-in address");
    if (!therapist) {
      if (!phone.trim()) return setErr("A phone number is required");
    }
    setBusy(true);
    try {
      if (therapist) {
        await api.staff.update(therapist._id, { name: name.trim(), email: addr, phone: phone.trim() || null, branchIds } as Partial<Admin>);
        audit("SETTINGS_UPDATED", `${name.trim()} · therapist updated`, { staffId: therapist._id });
        toast("Therapist updated");
      } else {
        const res = await api.staff.create({
          email: addr, name: name.trim(), role: "therapist",
          phone: phone.trim() || null, branchIds,
        });
        const created = res.data as Admin;
        audit("SETTINGS_UPDATED", `Created therapist ${created.email}`, { staffId: created._id });
        toast((res.message as string) ?? `${created.name} added`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={therapist ? therapist.name : "Add therapist"}>
      <div className="grid gap-3">
        <In label="Full name" value={name} onChange={setName} placeholder="Asha Verma" />
        <In label="Work email" type="email" value={email} onChange={setEmail}
          placeholder="therapist@zennara.in"
          hint="Their sign-in address — a 6-digit code is emailed here each time they sign in. Changing it signs them out everywhere." />
        <In label="Phone (staff only — never shown to guests)" value={phone} onChange={setPhone} />
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-ink2">Centres — their floor tablet is pinned to these</div>
          {branches.length === 0 ? (
            <div className="text-[12px] text-ink3">No branches configured yet.</div>
          ) : (
            <MultiSelect options={branches} value={branchIds} onChange={setBranchIds}
              placeholder="Select centres…" searchPlaceholder="Search centres…" />
          )}
          <div className="mt-1 text-[11px] text-ink3">One centre pins their panel to it; several let them switch between those centres only.</div>
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="flex gap-2">
          <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : therapist ? "Save changes" : "Add therapist"}</Btn>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        </div>

        {therapist && (
          <>
            <SecH t="Account" em="· access, removal" />
            <div className="grid gap-2">
              <SignInControls accountId={therapist._id} email={therapist.email} phone={therapist.phone}
                hasPassword={!!therapist.hasPassword} onChanged={onSaved} />
              <div className="text-[11px] text-ink3">
                {therapist.lastLogin ? `Last sign-in ${fmtAgo(therapist.lastLogin)}.` : "Never signed in yet."}
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-ivory px-3.5 py-2.5">
                <div>
                  <div className="text-[12.5px] font-bold">{therapist.isActive ? "Active" : "Deactivated"}</div>
                  <div className="text-[11px] text-ink3">
                    {therapist.isActive ? "Deactivating signs them out everywhere immediately" : "Activate to let them sign in again"}
                  </div>
                </div>
                <Btn kind="ghost" onClick={onToggle}>{therapist.isActive ? "Deactivate" : "Activate"}</Btn>
              </div>
              <Btn kind="danger" onClick={onDelete}>Delete therapist</Btn>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
