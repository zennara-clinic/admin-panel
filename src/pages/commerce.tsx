import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Page, Btn, Tag, Stats, Card, DataTable, B, Tabs, Note, Hint, In, Sel, Toggle, Area, Switch,
  SecH, Modal, Drawer, Menu, DeleteModal, Async, Empty, Loading, StaleBanner, exportCsv, UploadField, MultiSelect,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import { fmtDate, fmtDateFull, fmtINR, fmtCompactINR, idOf, nameOf } from "../lib/format";
import type { Brand, Coupon, Formulation, OrderStatus, Product, ProductOrder } from "../lib/types";

/* ================= PRODUCTS ================= */
export function Products() {
  const { toast, audit, can } = useStore();
  const loc = useLocation();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [grid, setGrid] = useState(false);
  const [sel, setSel] = useState<Product | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState<Product | null>(null);
  const debounced = useDebounced(search);

  const q = useApi(() => api.products.list({ search: debounced || undefined }), [debounced]);
  const forms = useApi(() => api.formulations.list({ isActive: "true" }), []);
  const stats = useApi(() => api.products.statistics().catch(() => undefined), []);

  const rows = q.data?.data ?? [];
  const formulationNames = useMemo(() => {
    const fromForms = (forms.data ?? []).map((f) => f.name);
    return [...new Set([...fromForms, ...rows.map((p) => p.formulation)])].filter(Boolean);
  }, [forms.data, rows]);

  // One definition of "low": under 10 and not out — matches the statistics tile.
  const LOW = 10;
  const tabs = ["All", ...formulationNames];
  const list = rows.filter((p) =>
    (tab === 0 || p.formulation === tabs[tab]) &&
    (!lowOnly || (p.stock > 0 && p.stock < LOW)));

  // Deep-link from global search / a notification — fetch it if it isn't in the loaded rows.
  const [sp] = useSearchParams();
  useEffect(() => {
    const id = (loc.state as { id?: string } | null)?.id ?? sp.get("product");
    if (!id) return;
    const found = rows.find((p) => p._id === id);
    if (found) setSel(found);
    else if (!q.loading) api.products.get(id).then((p) => p && setSel(p)).catch(() => undefined);
  }, [loc.state, rows.length, q.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const { toast: toastMsg, audit: auditMsg } = useStore();
  const quickToggle = async (p: Product) => {
    if (!can("products.manage")) return;
    try {
      await api.products.toggle(p._id);
      auditMsg("PRODUCT_UPDATED", `${p.name} ${p.isActive ? "hidden from" : "shown in"} the app`, { productId: p._id });
      q.reload(); stats.reload();
    } catch (e) { toastMsg((e as Error).message); }
  };

  const st = stats.data;

  return (
    <Page title="Products" sub={`${rows.length} in the catalogue · ${list.length} shown`}
      actions={<>
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          <button onClick={() => setGrid(false)} className={`px-3 py-2 text-[12.5px] font-bold ${!grid ? "bg-primary text-white" : "bg-surface text-ink2"}`}>☰ List</button>
          <button onClick={() => setGrid(true)} className={`px-3 py-2 text-[12.5px] font-bold ${grid ? "bg-primary text-white" : "bg-surface text-ink2"}`}>▦ Grid</button>
        </div>
        <Btn kind="ghost" disabled={!list.length} onClick={() => exportCsv("zennara-products",
          ["Code", "Name", "Brand", "Formulation", "Price", "GST %", "Stock", "Rating", "Active"],
          list.map((p) => [p.code ?? "", p.name, p.OrgName, p.formulation, p.price, p.gstPercentage, p.stock, p.rating ?? 0, p.isActive ? "yes" : "no"]))}>Export CSV</Btn>
        {can("products.manage") && <Btn onClick={() => setAddOpen(true)}>+ New product</Btn>}
      </>}>
      <Hint id="products-live" steps={[
        "This is the live retail catalogue the app sells from — formulation tabs mirror the app's filters.",
        "Click any product to open it on the right: name, price, stock, image and app visibility.",
        "Use the Low stock filter before ordering day, and Export CSV for the purchase list.",
        "Stock edits here are audited with your name.",
      ]} />

      {st && (
        <Stats items={[
          { k: "Products", v: (st.total ?? rows.length).toLocaleString("en-IN"), d: `${st.active ?? 0} active` },
          { k: "Units on hand", v: (st.totalStock ?? 0).toLocaleString("en-IN") },
          { k: "Stock value", v: fmtCompactINR(st.totalValue), d: `avg ${fmtINR(st.avgPrice)}` },
          { k: "Low stock", v: st.lowStock ?? 0, hot: (st.lowStock ?? 0) > 0 },
          { k: "Out of stock", v: st.outOfStock ?? 0, tone: (st.outOfStock ?? 0) > 0 ? "dn" : undefined },
          { k: "Popular", v: st.popular ?? 0, d: "pinned to the app home" },
        ]} />
      )}

      <div data-tour="prod-filters" className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…"
          className="w-64 rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
        <button onClick={() => setLowOnly(!lowOnly)}
          className={`rounded-(--radius-btn) px-3.5 py-2 text-[12.5px] font-bold ${lowOnly ? "bg-warn-bg text-warn" : "border border-border bg-surface text-ink2"}`}>
          Low stock (under 10) {lowOnly ? "✓" : ""}
        </button>
      </div>

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading the catalogue…" rows={8}>
        {() => (
          <>
            <div data-tour="prod-tabs" />
            <Tabs active={tab} onChange={setTab}
              items={tabs.map((c, i) => [c, i === 0 ? rows.length : rows.filter((p) => p.formulation === c).length]) as [string, number][]} />
            <div data-tour="prod-table" />

            {list.length === 0 ? (
              <Empty title="No products here" hint={debounced ? `Nothing matched “${debounced}”.` : "Add the first product to this formulation."}
                action={can("products.manage") ? <Btn onClick={() => setAddOpen(true)}>+ New product</Btn> : undefined} />
            ) : grid ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {list.slice(0, 60).map((p) => (
                  <Card key={p._id} onClick={() => setSel(p)} className="overflow-hidden">
                    {p.image
                      ? <img src={p.image} alt="" className="h-24 w-full object-cover" />
                      : <div className="grid h-24 place-items-center bg-gradient-to-br from-ivory to-sage">
                          <div className="h-14 w-9 rounded-md border border-border bg-gradient-to-b from-white to-cream" />
                        </div>}
                    <div className="p-3">
                      <div className="font-mono text-[9.5px] font-bold uppercase text-ink3">{p.code ?? p.OrgName}</div>
                      <b className="block text-[12.5px] font-bold leading-tight">{p.name}</b>
                      <div className="mt-0.5 text-[10.5px] text-ink3">{p.formulation} · {p.OrgName}</div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <b className="text-[13px]">{fmtINR(p.price)}</b>
                        {p.stock === 0 ? <Tag kind="err">out</Tag> : p.stock < LOW ? <Tag kind="warn">{p.stock} left</Tag> : <span className="text-[11px] text-ink3">{p.stock} in stock</span>}
                      </div>
                    </div>
                  </Card>
                ))}
                {list.length > 60 && <div className="col-span-full text-center text-[12px] text-ink3">Showing 60 of {list.length} — refine with search or a formulation tab</div>}
              </div>
            ) : (
              <DataTable
                cols={["Product", "Code", "Brand", "Formulation", "Price", "GST", "Stock", "Rating", "In app"]}
                onRow={(i) => setSel(list[i])}
                rows={list.map((p) => [
                  <B key={p._id}>{p.name}{p.isPopular ? " ★" : ""}</B>,
                  <span key={`${p._id}c`} className="font-mono text-[11px]">{p.code ?? "—"}</span>,
                  p.OrgName,
                  p.formulation,
                  fmtINR(p.price),
                  `${p.gstPercentage}%`,
                  p.stock === 0
                    ? <span key={`${p._id}s`}>0 <Tag kind="err">out</Tag></span>
                    : p.stock < LOW ? <span key={`${p._id}s`}>{p.stock} <Tag kind="warn">low</Tag></span> : p.stock,
                  p.rating ? `${p.rating.toFixed(1)} (${p.reviews ?? 0})` : "—",
                  <span key={`${p._id}a`} onClick={(e) => e.stopPropagation()}>
                    <Toggle on={p.isActive} onChange={() => quickToggle(p)} />
                  </span>,
                ])}
              />
            )}
          </>
        )}
      </Async>

      <ProductEditor open={!!sel || addOpen} product={sel} formulations={formulationNames}
        onClose={() => { setSel(null); setAddOpen(false); }}
        onSaved={() => { q.reload(); stats.reload(); setSel(null); setAddOpen(false); }}
        onDelete={(p) => { setSel(null); setDel(p); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `product "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.products.remove(del._id);
            audit("PRODUCT_UPDATED", `Deleted ${del.name} · reason: ${reason}`, { productId: del._id });
            toast("Product deleted"); q.reload(); stats.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function ProductEditor({ open, product, formulations, onClose, onSaved, onDelete }: {
  open: boolean; product: Product | null; formulations: string[];
  onClose: () => void; onSaved: () => void; onDelete: (p: Product) => void;
}) {
  const { toast, audit, can } = useStore();
  const [f, setF] = useState<Partial<Product>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const brands = useApi(() => api.brands.list({ isActive: "true" }).catch(() => [] as Brand[]), [open]);
  const brandNames = (brands.data ?? []).map((b) => b.name);
  const [stockReason, setStockReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setF(product ?? {
      name: "", description: "", formulation: formulations[0] ?? "", OrgName: brandNames[0] ?? "",
      price: 0, gstPercentage: 18, stock: 0, image: "", isActive: true, isPopular: false,
    });
    setStockReason("");
    setErr(null);
  }, [open, product?._id]);

  // The <select> shows its first option; keep state honest so Save doesn't reject a filled-in form.
  useEffect(() => {
    if (!open) return;
    setF((s) => ({
      ...s,
      OrgName: s.OrgName || brandNames[0] || "",
      formulation: s.formulation || formulations[0] || "",
    }));
  }, [open, brandNames.join("|"), formulations.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Product>(k: K) => (v: Product[K]) => setF((s) => ({ ...s, [k]: v }));
  const uploadImage = (file: File) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "");
  const stockChanged = !!product && Number(f.stock) !== Number(product.stock);

  const save = async () => {
    setErr(null);
    if (!f.name?.trim()) return setErr("A product name is required");
    if (!f.description?.trim()) return setErr("A description is required — the app shows it on the product page");
    if (!f.formulation) return setErr("Pick a formulation");
    if (!f.OrgName?.trim()) return setErr("A brand is required");
    if (!f.price) return setErr("A price is required");
    if (Number(f.gstPercentage) < 0 || Number(f.gstPercentage) > 100) return setErr("GST must be between 0 and 100");
    if (stockChanged && stockReason.trim().length < 3) return setErr("Say why the stock changed — it goes in the audit log");

    setBusy(true);
    try {
      const { _id, rating, reviews, createdAt, updatedAt, ...rest } = f as Product & { updatedAt?: string };
      void _id; void rating; void reviews; void createdAt; void updatedAt;
      const body: Partial<Product> = {
        ...rest,
        price: Number(f.price) || 0,
        gstPercentage: Number(f.gstPercentage) || 0,
        stock: Number(f.stock) || 0,
        // Empty string clears a code; the server turns it into null.
        code: f.code?.trim() ?? "",
      };
      if (product) {
        if (stockChanged) {
          // Stock goes through its own route so the ledger/audit sees a STOCK_UPDATED with a reason.
          await api.products.setStock(product._id, Number(f.stock) || 0);
          audit("STOCK_UPDATED", `${f.name}: ${product.stock} → ${Number(f.stock) || 0} · ${stockReason.trim()}`, { productId: product._id });
          delete body.stock;
        }
        await api.products.update(product._id, body);
        audit("PRODUCT_UPDATED", `${f.name}`, { productId: product._id });
        toast("Product saved");
      } else {
        const created = await api.products.create(body);
        audit("PRODUCT_UPDATED", `Created ${created.name}`, { productId: created._id });
        toast(`${created.name} added to the catalogue`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={product ? product.name : "New product"}>
      <div className="grid gap-3">
        <UploadField label="Image" value={f.image ?? ""} onChange={set("image")} upload={uploadImage}
          hint="Square, on a plain background, works best in the shop" />
        <In label="Product name" value={f.name ?? ""} onChange={set("name")} />
        <Area label="Description" value={f.description ?? ""} onChange={set("description")} rows={3} />

        {brandNames.length
          ? <Sel label="Brand" value={f.OrgName ?? brandNames[0]} onChange={set("OrgName")} options={brandNames} />
          : <In label="Brand" value={f.OrgName ?? ""} onChange={set("OrgName")} hint="Add brands under Commerce → Brands & formulations" />}
        {formulations.length
          ? <Sel label="Formulation" value={f.formulation ?? formulations[0]} onChange={set("formulation")} options={formulations} />
          : <In label="Formulation" value={f.formulation ?? ""} onChange={set("formulation")} hint="Add formulations under Commerce → Brands & formulations first" />}
        <In label="Product code (optional)" value={f.code ?? ""} onChange={(v) => set("code")(v.toUpperCase())} />

        <div className="grid grid-cols-2 gap-3">
          <In label="Price (₹)" type="number" value={String(f.price ?? 0)} onChange={(v) => set("price")(Number(v) || 0)} />
          <In label="GST %" type="number" value={String(f.gstPercentage ?? 18)} onChange={(v) => set("gstPercentage")(Number(v) || 0)} />
        </div>
        <In label="Stock on hand" type="number" value={String(f.stock ?? 0)} onChange={(v) => set("stock")(Number(v) || 0)}
          hint="Direct edits are recorded in the audit log" />
        {stockChanged && (
          <In label="Reason for the stock change" value={stockReason} onChange={setStockReason} placeholder="e.g. goods received / stock count / damaged" />
        )}

        <Switch on={!!f.isActive} onChange={set("isActive")} label="Sold in the app" sub="Off hides it from the store" />
        <Switch on={!!f.isPopular} onChange={set("isPopular")} gold label="Popular" sub="Pins it to the app home rail" />

        {product && (
          <div className="rounded-xl bg-ivory px-3.5 py-2.5 text-[12px] text-ink2">
            Rating {product.rating ? product.rating.toFixed(1) : "—"} from {product.reviews ?? 0} review{product.reviews === 1 ? "" : "s"}<br />
            Added {fmtDateFull(product.createdAt)}
          </div>
        )}

        {err && <Note kind="crit">{err}</Note>}
        {can("products.manage") ? (
          <div className="flex flex-wrap gap-2">
            <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : product ? "Save changes" : "Create product"}</Btn>
            {product && <Btn kind="danger" onClick={() => onDelete(product)}>Delete</Btn>}
          </div>
        ) : <Note kind="crit">Your role can view products but not change them.</Note>}
      </div>
    </Drawer>
  );
}

/* ================= BRANDS & FORMULATIONS ================= */
export function Brands() {
  const { toast, audit, can } = useStore();
  const [bOpen, setBOpen] = useState(false);
  const [fOpen, setFOpen] = useState(false);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [editForm, setEditForm] = useState<Formulation | null>(null);
  const [delBrand, setDelBrand] = useState<Brand | null>(null);
  const [delForm, setDelForm] = useState<Formulation | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [logo, setLogo] = useState("");
  const [website, setWebsite] = useState("");
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const brands = useApi(() => api.brands.list(), []);
  const forms = useApi(() => api.formulations.list(), []);

  const openBrand = (b?: Brand) => { setEditBrand(b ?? null); setName(b?.name ?? ""); setDesc(b?.description ?? ""); setLogo(b?.logo ?? ""); setWebsite(b?.website ?? ""); setActive(b?.isActive ?? true); setErr(null); setBOpen(true); };
  const openForm = (f?: Formulation) => { setEditForm(f ?? null); setName(f?.name ?? ""); setDesc(f?.description ?? ""); setActive(f?.isActive ?? true); setErr(null); setFOpen(true); };
  const uploadLogo = (file: File) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "");

  return (
    <Page title="Brands & formulations" sub="These power the app's product filters and the catalogue's grouping"
      actions={can("brands.manage") ? <>
        <Btn kind="ghost" onClick={() => openForm()}>+ Formulation</Btn>
        <Btn onClick={() => openBrand()}>+ Brand</Btn>
      </> : undefined}>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="p-4">
          <SecH t="Brands" em={`· ${(brands.data ?? []).length}`} />
          <Async q={brands} label="Loading brands…" rows={4}>
            {(list) => list.length === 0 ? <Empty title="No brands yet" hint="Add the brands you stock." /> : (
              <div className="grid gap-2 md:grid-cols-2">
                {list.map((b) => (
                  <div key={b._id} className={`flex items-center justify-between gap-2 rounded-xl border border-border bg-ivory px-3 py-2 ${b.isActive ? "" : "opacity-55"}`}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => can("brands.manage") && openBrand(b)}>
                      <span className="block truncate text-[12.5px] font-bold">{b.name}</span>
                      {b.description && <span className="block truncate text-[10.5px] text-ink3">{b.description}</span>}
                    </button>
                    <span className="shrink-0 font-mono text-[11px] text-ink3">{b.productsCount ?? 0} SKUs</span>
                    {can("brands.manage") && (
                      <button onClick={() => setDelBrand(b)} className="shrink-0 text-[11px] font-bold text-err">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>

        <Card className="p-4">
          <SecH t="Formulations" em={`· ${(forms.data ?? []).length}`} />
          <Async q={forms} label="Loading formulations…" rows={4}>
            {(list) => list.length === 0 ? <Empty title="No formulations yet" hint="Serum, Cream, Shampoo and so on." /> : (
              <div className="grid gap-2 md:grid-cols-2">
                {list.map((f) => (
                  <div key={f._id} className={`flex items-center justify-between gap-2 rounded-xl border border-border bg-ivory px-3 py-2 ${f.isActive ? "" : "opacity-55"}`}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => can("brands.manage") && openForm(f)}>
                      <span className="block truncate text-[12.5px] font-bold">{f.name}</span>
                      {f.description && <span className="block truncate text-[10.5px] text-ink3">{f.description}</span>}
                    </button>
                    <span className="shrink-0 font-mono text-[11px] text-gold-dark">{f.productsCount ?? 0}</span>
                    {can("brands.manage") && (
                      <button onClick={() => setDelForm(f)} className="shrink-0 text-[11px] font-bold text-err">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>
      </div>

      <Note>Deleting a brand or formulation that still has products attached is <B>blocked</B>, not cascaded — move the products first.</Note>

      <Modal open={bOpen} onClose={() => setBOpen(false)} title={editBrand ? `Edit ${editBrand.name}` : "New brand"}>
        <div className="grid gap-3">
          <In label="Brand name" value={name} onChange={setName} />
          <Area label="Description (optional)" value={desc} onChange={setDesc} rows={2} />
          <UploadField label="Logo (optional)" value={logo} onChange={setLogo} upload={uploadLogo} />
          <In label="Website (optional)" value={website} onChange={setWebsite} placeholder="https://" />
          {editBrand && <Switch on={active} onChange={setActive} label="Active" sub="Inactive brands are kept but not offered on new products" />}
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setBOpen(false)}>Cancel</Btn>
          <Btn disabled={name.trim().length < 2} onClick={async () => {
            setErr(null);
            try {
              const body = { name: name.trim(), description: desc.trim(), logo: logo.trim() || undefined, website: website.trim() || undefined, isActive: active };
              if (editBrand) { await api.brands.update(editBrand._id, body); toast("Brand updated"); }
              else { await api.brands.create(body); toast(`${name.trim()} added`); }
              audit("PRODUCT_UPDATED", `Brand ${name.trim()}`);
              setBOpen(false); brands.reload();
            } catch (e) { setErr((e as Error).message); }
          }}>{editBrand ? "Save" : "Add brand"}</Btn>
        </div>
      </Modal>

      <Modal open={fOpen} onClose={() => setFOpen(false)} title={editForm ? `Edit ${editForm.name}` : "New formulation"}>
        <div className="grid gap-3">
          <In label="Formulation name" value={name} onChange={setName} hint="Serums, Sunscreens, Cleansers… products are filed under one of these" />
          <Area label="Description (optional)" value={desc} onChange={setDesc} rows={2} />
          {editForm && <Switch on={active} onChange={setActive} label="Active" sub="Inactive formulations are kept but not offered on new products" />}
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setFOpen(false)}>Cancel</Btn>
          <Btn disabled={name.trim().length < 2} onClick={async () => {
            setErr(null);
            try {
              if (editForm) { await api.formulations.update(editForm._id, { name: name.trim(), description: desc.trim(), isActive: active }); toast("Formulation updated"); }
              else { await api.formulations.create({ name: name.trim(), description: desc.trim() }); toast(`${name.trim()} added`); }
              audit("PRODUCT_UPDATED", `Formulation ${name.trim()}`);
              setFOpen(false); forms.reload();
            } catch (e) { setErr((e as Error).message); }
          }}>{editForm ? "Save" : "Add formulation"}</Btn>
        </div>
      </Modal>

      <DeleteModal open={!!delBrand} onClose={() => setDelBrand(null)} what={delBrand ? `brand "${delBrand.name}"` : ""}
        onConfirm={async (reason) => {
          if (!delBrand) return;
          try {
            await api.brands.remove(delBrand._id);
            audit("PRODUCT_UPDATED", `Deleted brand ${delBrand.name} · reason: ${reason}`);
            toast("Brand deleted"); brands.reload();
          } catch (e) { toast((e as Error).message); }
        }} />

      <DeleteModal open={!!delForm} onClose={() => setDelForm(null)} what={delForm ? `formulation "${delForm.name}"` : ""}
        onConfirm={async (reason) => {
          if (!delForm) return;
          try {
            await api.formulations.remove(delForm._id);
            audit("PRODUCT_UPDATED", `Deleted formulation ${delForm.name} · reason: ${reason}`);
            toast("Formulation deleted"); forms.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

/* ================= COUPONS ================= */
export function Coupons() {
  const { toast, audit, can } = useStore();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Coupon | null>(null);
  const [del, setDel] = useState<Coupon | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const debounced = useDebounced(search);
  const q = useApi(() => api.coupons.list({ search: debounced || undefined, status: status === "all" ? undefined : status }), [debounced, status]);
  const stats = useApi(() => api.coupons.statistics().catch(() => undefined), []);
  const rows = q.data ?? [];

  const isExpired = (c: Coupon) => new Date(c.validUntil).getTime() < Date.now();
  const numericStats = Object.entries(stats.data ?? {}).filter(([, v]) => typeof v === "number") as [string, number][];
  const mostUsed = ((stats.data as { mostUsed?: { code: string; usageCount: number }[] } | undefined)?.mostUsed ?? []);

  return (
    <Page title="Coupons" sub="Discounts guests can apply in the app and reception can apply at billing"
      actions={<>
        <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv("zennara-coupons",
          ["Code", "Type", "Value", "Min order", "Max discount", "Used", "Limit", "Valid from", "Valid until", "Active"],
          rows.map((c) => [c.code, c.discountType, c.discountValue, c.minOrderValue ?? 0, c.maxDiscount ?? "",
            c.usageCount ?? 0, c.usageLimit ?? "∞", fmtDate(c.validFrom), fmtDate(c.validUntil), c.isActive ? "yes" : "no"]))}>Export CSV</Btn>
        {can("coupons.manage") && <Btn onClick={() => { setEdit(null); setOpen(true); }}>+ New coupon</Btn>}
      </>}>
      {stats.data && (
        <Stats items={[
          ...numericStats.slice(0, 4).map(([k, v]) => ({ k: k.replace(/([A-Z])/g, " $1"), v: v.toLocaleString("en-IN") })),
          ...(mostUsed.length ? [{ k: "Most used", v: mostUsed[0].code, d: `${mostUsed[0].usageCount} redemptions` }] : []),
        ]} />
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or description…"
          className="w-64 rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
        <div className="flex overflow-hidden rounded-(--radius-btn) border border-border">
          {["all", "active", "upcoming", "expired"].map((st) => (
            <button key={st} onClick={() => setStatus(st)}
              className={`px-3 py-2 text-[12px] font-bold capitalize ${status === st ? "bg-primary text-white" : "bg-surface text-ink2"}`}>{st}</button>
          ))}
        </div>
      </div>

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading coupons…" rows={5}>
        {() => rows.length === 0 ? (
          <Empty title="No coupons yet" hint="Create a discount code guests can apply at checkout."
            action={can("coupons.manage") ? <Btn onClick={() => setOpen(true)}>+ New coupon</Btn> : undefined} />
        ) : (
          <DataTable cols={["Code", "Discount", "Min order", "Description", "Used / limit", "Valid until", "Visible", "Active"]}
            onRow={(i) => can("coupons.manage") && (setEdit(rows[i]), setOpen(true))}
            rows={rows.map((c) => [
              <B key={c._id}>{c.code}</B>,
              c.discountType === "percentage"
                ? `${c.discountValue}%${c.maxDiscount ? ` (max ${fmtINR(c.maxDiscount)})` : ""}`
                : fmtINR(c.discountValue),
              c.minOrderValue ? fmtINR(c.minOrderValue) : "—",
              c.description ? <span key={`${c._id}d`} className="text-[11.5px] italic text-ink3">{c.description}</span> : "—",
              `${c.usageCount ?? 0} / ${c.usageLimit ?? "∞"}`,
              isExpired(c)
                ? <Tag key={`${c._id}e`} kind="err">expired {fmtDate(c.validUntil)}</Tag>
                : fmtDate(c.validUntil),
              c.isPublic ? <Tag key={`${c._id}p`} kind="ok">in app</Tag> : <Tag key={`${c._id}p`} kind="mute">desk only</Tag>,
              <Toggle key={`${c._id}t`} on={c.isActive} onChange={async (v) => {
                if (!can("coupons.manage")) return toast("Your role cannot change coupons");
                try {
                  await api.coupons.update(c._id, { isActive: v });
                  audit("CATALOGUE_STATUS_CHANGED", `Coupon ${c.code} ${v ? "activated" : "deactivated"}`, { couponId: c._id });
                  toast(`${c.code} ${v ? "activated" : "deactivated"}`); q.reload();
                } catch (e) { toast((e as Error).message); }
              }} />,
            ])} />
        )}
      </Async>

      <Note>A coupon only applies where its rules allow — minimum order value, usage limit, per-user limit and validity window are all enforced by the server when the guest applies it.</Note>

      <CouponEditor open={open} coupon={edit} onClose={() => { setOpen(false); setEdit(null); }}
        onSaved={() => { q.reload(); stats.reload(); setOpen(false); setEdit(null); }}
        onDelete={(c) => { setOpen(false); setEdit(null); setDel(c); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `coupon "${del.code}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.coupons.remove(del._id);
            audit("CATALOGUE_DELETED", `Coupon ${del.code} · reason: ${reason}`, { couponId: del._id });
            toast("Coupon deleted"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function CouponEditor({ open, coupon, onClose, onSaved, onDelete }: {
  open: boolean; coupon: Coupon | null; onClose: () => void; onSaved: () => void; onDelete: (c: Coupon) => void;
}) {
  const { toast, audit } = useStore();
  const [f, setF] = useState<Partial<Coupon>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const inAMonth = new Date(); inAMonth.setMonth(inAMonth.getMonth() + 1);
    setF(coupon ?? {
      code: "", description: "", discountType: "percentage", discountValue: 10,
      minOrderValue: 0, maxDiscount: null, usageLimit: null, perUserLimit: 1,
      validFrom: new Date().toISOString(), validUntil: inAMonth.toISOString(),
      isActive: true, isPublic: true,
    });
    setErr(null);
  }, [open, coupon?._id]);

  const set = <K extends keyof Coupon>(k: K) => (v: Coupon[K]) => setF((s) => ({ ...s, [k]: v }));
  const dateVal = (v?: string) => (v ? new Date(v).toISOString().slice(0, 10) : "");
  // "Valid until 20 Nov" means the whole of the 20th, local time — not 00:00 UTC.
  const startOfDay = (d: string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); };
  const endOfDay = (d: string) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString(); };

  // Optional product scoping — every product, searchable.
  const products = useApi(() => (open ? api.products.list({}).then((r) => r.data ?? []) : Promise.resolve([] as Product[])), [open]);
  const scoped = ((f.applicableProducts ?? []) as (string | { _id: string })[]).map((x) => (typeof x === "string" ? x : x._id));

  const save = async () => {
    setErr(null);
    if (!f.code?.trim() || f.code.trim().length < 3) return setErr("A code of at least 3 characters is required");
    if (!f.discountValue) return setErr("A discount value is required");
    if (f.discountType === "percentage" && Number(f.discountValue) > 100) return setErr("A percentage discount cannot exceed 100%");
    if (!f.validFrom || !f.validUntil) return setErr("Both validity dates are required");
    if (new Date(f.validUntil) <= new Date(f.validFrom)) return setErr("The end date must be after the start date");

    setBusy(true);
    try {
      const { _id, usageCount, createdAt, updatedAt, ...rest } = f as Coupon & { createdAt?: string; updatedAt?: string };
      void _id; void usageCount; void createdAt; void updatedAt;
      const body: Partial<Coupon> = {
        ...rest,
        applicableProducts: scoped as Coupon["applicableProducts"],
        code: f.code.trim().toUpperCase(),
        discountValue: Number(f.discountValue),
        minOrderValue: Number(f.minOrderValue) || 0,
        maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : null,
        usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
        perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
      };
      if (coupon) {
        await api.coupons.update(coupon._id, body);
        audit("CATALOGUE_UPDATED", `Coupon ${body.code}`, { couponId: coupon._id });
        toast("Coupon saved");
      } else {
        await api.coupons.create(body);
        audit("CATALOGUE_CREATED", `Coupon ${body.code}`);
        toast(`${body.code} created`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={coupon ? `Edit ${coupon.code}` : "New coupon"} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <In label="Code" value={f.code ?? ""} onChange={(v) => set("code")(v.toUpperCase())} placeholder="FESTIVE10" />
        <Sel label="Discount type" value={f.discountType === "fixed" ? "Fixed ₹" : "Percentage"}
          onChange={(v) => set("discountType")(v === "Fixed ₹" ? "fixed" : "percentage")}
          options={["Percentage", "Fixed ₹"]} />
        <In label={f.discountType === "fixed" ? "Discount (₹)" : "Discount (%)"} type="number"
          value={String(f.discountValue ?? 0)} onChange={(v) => set("discountValue")(Number(v) || 0)} />
        <In label="Maximum discount (₹, optional)" type="number" value={String(f.maxDiscount ?? "")}
          onChange={(v) => set("maxDiscount")(v ? Number(v) : null)} hint="Caps a percentage discount" />
        <In label="Minimum order value (₹)" type="number" value={String(f.minOrderValue ?? 0)}
          onChange={(v) => set("minOrderValue")(Number(v) || 0)} />
        <In label="Total usage limit (blank = unlimited)" type="number" value={String(f.usageLimit ?? "")}
          onChange={(v) => set("usageLimit")(v ? Number(v) : null)} />
        <In label="Per-guest limit (blank = unlimited)" type="number" value={String(f.perUserLimit ?? "")}
          onChange={(v) => set("perUserLimit")(v ? Number(v) : null)} />
        <div />
        <div className="col-span-full">
          <MultiSelect label={`Applies to ${scoped.length ? `${scoped.length} product${scoped.length === 1 ? "" : "s"}` : "every product"}`}
            options={(products.data ?? []).map((p) => [p._id, `${p.name} · ${fmtINR(p.price)}`])} value={scoped}
            onChange={(next) => set("applicableProducts")(next as Coupon["applicableProducts"])}
            placeholder="Every product" searchPlaceholder="Search products…" />
          <div className="mt-1 text-[10.5px] text-ink3">Leave empty to make the coupon store-wide.</div>
        </div>
        <In label="Valid from" type="date" value={dateVal(f.validFrom)} onChange={(v) => v && set("validFrom")(startOfDay(v))} />
        <In label="Valid until" type="date" value={dateVal(f.validUntil)} onChange={(v) => v && set("validUntil")(endOfDay(v))} />
        <div className="col-span-full">
          <Area label="Description — shown to the guest when the coupon applies" value={f.description ?? ""}
            onChange={set("description")} rows={2} placeholder="e.g. Festive week special, valid on weekday slots" />
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Switch on={!!f.isActive} onChange={set("isActive")} label="Active" sub="Off blocks the code everywhere" />
        <Switch on={!!f.isPublic} onChange={set("isPublic")} label="Listed in the app" sub="Off keeps it a desk-only code" />
      </div>

      {coupon && (
        <div className="mt-3 rounded-xl bg-ivory px-3.5 py-2.5 text-[12px] text-ink2">
          Used {coupon.usageCount ?? 0} time{coupon.usageCount === 1 ? "" : "s"}
          {coupon.usageLimit ? ` of ${coupon.usageLimit}` : " (no limit)"}
        </div>
      )}

      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {coupon && <Btn kind="danger" onClick={() => onDelete(coupon)}>Delete</Btn>}
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : coupon ? "Save coupon" : "Create coupon"}</Btn>
      </div>
    </Modal>
  );
}

/* ================= ORDERS ================= */
const ORDER_STATUSES: OrderStatus[] = [
  "Order Placed", "Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery",
  "Delivery Failed", "Delivered", "Cancelled", "Return Requested", "Returned",
];

const FULFILMENT_STEPS: OrderStatus[] = [
  "Order Placed", "Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered",
];

const statusTone = (s: string) =>
  s === "Delivered" ? "ok" : ["Cancelled", "Returned", "Delivery Failed"].includes(s) ? "err"
    : ["Order Placed", "Return Requested"].includes(s) ? "warn" : "info";

export function Orders() {
  const { toast, audit, can } = useStore();
  const loc = useLocation();
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: ORDER_STATUSES.length });
  const [sel, setSel] = useState<string | null>(null);
  const [page, setPage] = useQueryPage();
  const [search, setSearch] = useQueryString("q");
  const [payFilter, setPayFilter] = useQueryString("payment");
  const debounced = useDebounced(search);
  const PAGE = 15;

  const tabs = ["All", ...ORDER_STATUSES];
  const q = useApi(
    () => api.orders.list({ status: tab === 0 ? undefined : tabs[tab], paymentStatus: payFilter || undefined, search: debounced || undefined, page, limit: PAGE }),
    [tab, payFilter, debounced, page],
  );
  const stats = useApi(() => api.orders.stats().catch(() => undefined), []);
  useEffect(() => { setPage(1); }, [tab, payFilter, debounced]);

  const rows = q.data?.data ?? [];
  const total = (q.data as { total?: number } | undefined)?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // The drawer always fetches its own order, so a deep link to an old order works
  // and every action sees fresh data.
  const detail = useApi(() => (sel ? api.orders.get(sel) : Promise.resolve(null)), [sel]);
  const selOrder = detail.data ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => {
      q.reload();
      stats.reload();
      if (sel) detail.reload();
    }, 30000);
    return () => window.clearInterval(timer);
    // The selected id is the only value that changes what the background refresh fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const [sp] = useSearchParams();
  useEffect(() => {
    const id = (loc.state as { id?: string } | null)?.id ?? sp.get("order");
    if (id) setSel(id);
  }, [loc.state, sp]);

  const reloadAll = () => { q.reload(); stats.reload(); detail.reload(); };

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [delivery, setDelivery] = useState({ partner: "", phone: "", courier: "", tracking: "", expected: "" });
  const [failedOpen, setFailedOpen] = useState(false);
  const [failureReason, setFailureReason] = useState("");
  const [failureNote, setFailureNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr(null);
    try { await fn(); toast(msg); reloadAll(); return true; }
    catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const setStatus = (o: ProductOrder, to: string, note?: string) =>
    act(
      () => api.orders.setStatus(o._id, to, note).then(() => audit("ORDER_STATUS_UPDATED", `${o.orderNumber} → ${to}${note ? ` · ${note}` : ""}`, { orderId: o._id })),
      `${o.orderNumber} → ${to}`,
    );

  const itemName = (it: ProductOrder["items"][number]) => it.productName || nameOf(it.productId, "Item");
  const addr = selOrder?.shippingAddress;
  const s = stats.data;
  const currentStep = selOrder ? FULFILMENT_STEPS.indexOf(selOrder.orderStatus) : -1;
  const nextStatus = currentStep >= 0 ? FULFILMENT_STEPS[currentStep + 1] : undefined;

  const invoice = (o: ProductOrder) => {
    const lines = (o.items ?? []).map((it) =>
      `<tr><td>${itemName(it)}</td><td style="text-align:center">${it.quantity}</td><td style="text-align:right">${fmtINR(it.price)}</td><td style="text-align:right">${fmtINR(it.price * it.quantity)}</td></tr>`).join("");
    const pr = o.pricing ?? {};
    const ship = o.shippingAddress;
    const shipHtml = ship ? [ship.fullName, ship.phone, ship.addressLine1, ship.addressLine2, [ship.city, ship.state, ship.postalCode].filter(Boolean).join(" "), ship.country].filter(Boolean).join("<br>") : "";
    const html = `<html><head><title>Invoice ${o.orderNumber}</title><style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#111}h1{letter-spacing:3px;margin:0}td,th{padding:6px 4px;font-size:13px}th{text-align:left;border-bottom:1px solid #999}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px solid #ccc}.tot td{border-top:1px solid #999}.muted{color:#666;font-size:12px}</style></head><body>
<h1>ZENNARA</h1><div class="muted">Skin · Aesthetics · Wellness</div><hr>
<table><tr><td><b>Invoice</b> ${o.orderNumber}<br><b>Date</b> ${fmtDateFull(o.createdAt)}<br><b>Payment</b> ${o.paymentMethod} · ${o.paymentStatus}</td><td style="text-align:right;vertical-align:top"><b>Bill to</b><br>${shipHtml || nameOf(o.userId, "—")}</td></tr></table><hr>
<table><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>${lines}
<tr class="tot"><td colspan="3" style="text-align:right">Subtotal</td><td style="text-align:right">${fmtINR(pr.subtotal)}</td></tr>
${pr.discount ? `<tr><td colspan="3" style="text-align:right">Discount${o.coupon?.code ? ` (${o.coupon.code})` : ""}</td><td style="text-align:right">−${fmtINR(pr.discount)}</td></tr>` : ""}
<tr><td colspan="3" style="text-align:right">GST</td><td style="text-align:right">${fmtINR(pr.gst)}</td></tr>
${pr.deliveryFee ? `<tr><td colspan="3" style="text-align:right">Delivery</td><td style="text-align:right">${fmtINR(pr.deliveryFee)}</td></tr>` : ""}
<tr class="tot"><td colspan="3" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b>${fmtINR(pr.total)}</b></td></tr></table>
<hr><p class="muted">Tax invoice. GST is charged per item at the rate on the product record.</p></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `invoice-${o.orderNumber}.html`; a.click();
  };

  return (
    <Page title="Orders" sub="Product orders placed in the app — fulfilment, returns and refunds"
      actions={<Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv("zennara-orders",
        ["Order", "Guest", "Items", "Total", "Payment", "Method", "Status", "Placed"],
        rows.map((o) => [o.orderNumber, nameOf(o.userId, "—"), o.items?.length ?? 0,
          o.pricing?.total ?? 0, o.paymentStatus ?? "", o.paymentMethod ?? "", o.orderStatus, fmtDate(o.createdAt)]))}>Export CSV (this page)</Btn>}>
      <Stats items={[
        { k: "Total orders", v: (s?.totalOrders ?? total).toLocaleString("en-IN") },
        { k: "Awaiting action", v: (s?.newOrders ?? 0) + (s?.confirmedOrders ?? 0) + (s?.processingOrders ?? 0) + (s?.failedDeliveryOrders ?? 0) + (s?.returnRequestedOrders ?? 0),
          d: `${s?.failedDeliveryOrders ?? 0} failed delivery · ${s?.returnRequestedOrders ?? 0} returns`, hot: ((s?.newOrders ?? 0) + (s?.processingOrders ?? 0) + (s?.failedDeliveryOrders ?? 0)) > 0 },
        { k: "Shipped", v: s?.shippedOrders ?? 0 },
        { k: "Delivered", v: s?.deliveredOrders ?? 0, tone: "up" },
        { k: "Cancelled", v: s?.cancelledOrders ?? 0, tone: (s?.cancelledOrders ?? 0) > 0 ? "dn" : undefined },
        { k: "Revenue", v: fmtCompactINR(s?.totalRevenue) },
      ]} />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order no., guest name or phone…"
          className="w-72 rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
        <Menu button={<Btn kind="ghost">{payFilter || "Any payment"} ▾</Btn>}
          items={[{ label: "Any payment", onClick: () => setPayFilter("") },
            ...["Pending", "Paid", "Failed", "Refunded"].map((p) => ({ label: p, onClick: () => setPayFilter(p) }))]} />
      </div>
      <Tabs active={tab} onChange={setTab} items={tabs.map((t) => [t]) as [string][]} />

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading orders…" rows={8}>
        {() => rows.length === 0 ? <Empty title="No orders in this state" /> : (
          <>
            <DataTable cols={["Order", "Guest", "Items", "Total", "Payment", "Status", "Placed"]}
              onRow={(i) => setSel(rows[i]._id)}
              rows={rows.map((o) => [
                <B key={o._id}>{o.orderNumber}</B>,
                nameOf(o.userId, "—"),
                <span key={`${o._id}i`} className="text-[11.5px]">
                  {(o.items ?? []).slice(0, 2).map((it) => `${itemName(it)} ×${it.quantity}`).join(", ")}
                  {(o.items?.length ?? 0) > 2 ? ` +${o.items!.length - 2}` : ""}
                </span>,
                fmtINR(o.pricing?.total),
                <Tag key={`${o._id}p`} kind={o.paymentStatus === "Paid" ? "ok" : o.paymentStatus === "Refunded" ? "info" : "warn"}>
                  {o.paymentStatus} · {o.paymentMethod}
                </Tag>,
                <Tag key={`${o._id}s`} kind={statusTone(o.orderStatus)}>{o.orderStatus}</Tag>,
                fmtDate(o.createdAt),
              ])} />
            {pages > 1 && (
              <div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-ink3">
                <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
                <span>Page {page} of {pages} · {total} orders</span>
                <Btn kind="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn>
              </div>
            )}
          </>
        )}
      </Async>

      <Drawer open={!!sel} onClose={() => { setSel(null); setErr(null); }}
        title={selOrder ? `${selOrder.orderNumber} · ${nameOf(selOrder.userId, "Guest")}` : "Order"}>
        {!selOrder ? (detail.error ? <Note kind="crit">{detail.error}</Note> : <Loading label="Loading order…" rows={4} />) : (
          <div className="grid gap-3">
            <Card className="p-3.5">
              {(selOrder.items ?? []).map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-[12.5px] last:border-0">
                  <span className="min-w-0 flex-1 truncate">{itemName(it)} <span className="text-ink3">×{it.quantity}</span></span>
                  <b className="shrink-0 tabular-nums">{fmtINR(it.price * it.quantity)}</b>
                </div>
              ))}
              <div className="mt-2 grid gap-1 border-t border-border pt-2 text-[12px]">
                {selOrder.pricing?.subtotal !== undefined && <div className="flex justify-between"><span className="text-ink3">Subtotal</span><span>{fmtINR(selOrder.pricing.subtotal)}</span></div>}
                {!!selOrder.pricing?.gst && <div className="flex justify-between"><span className="text-ink3">GST</span><span>{fmtINR(selOrder.pricing.gst)}</span></div>}
                <div className="flex justify-between"><span className="text-ink3">Delivery</span><span>{selOrder.pricing?.deliveryFee ? fmtINR(selOrder.pricing.deliveryFee) : "Free"}</span></div>
                {!!selOrder.pricing?.discount && (
                  <div className="flex justify-between text-ok">
                    <span>Discount{selOrder.coupon?.code ? ` (${selOrder.coupon.code})` : ""}</span>
                    <span>−{fmtINR(selOrder.pricing.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 text-[13px] font-bold">
                  <span>Total</span><span>{fmtINR(selOrder.pricing?.total)}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tag kind={selOrder.paymentStatus === "Paid" ? "ok" : selOrder.paymentStatus === "Refunded" ? "info" : "warn"}>{selOrder.paymentStatus} · {selOrder.paymentMethod}</Tag>
                <Tag kind={statusTone(selOrder.orderStatus)}>{selOrder.orderStatus}</Tag>
                <span className="text-[11px] text-ink3">placed {fmtDateFull(selOrder.createdAt)}</span>
              </div>
            </Card>

            {addr && (
              <Card className="p-3.5">
                <SecH t="Ship to" />
                <div className="text-[12px] leading-relaxed text-ink2">
                  <B>{addr.fullName}</B>{addr.phone ? ` · ${addr.phone}` : ""}<br />
                  {addr.addressLine1}{addr.addressLine2 ? <><br />{addr.addressLine2}</> : null}
                  {addr.landmark ? <><br /><span className="text-ink3">near {addr.landmark}</span></> : null}<br />
                  {[addr.city, addr.state, addr.postalCode].filter(Boolean).join(", ")}{addr.country ? `, ${addr.country}` : ""}
                </div>
              </Card>
            )}

            {(selOrder.deliveryPartner || selOrder.courier || selOrder.deliveryAttempt) && (
              <Card className="p-3.5">
                <SecH t={`Delivery attempt ${selOrder.deliveryAttempt || 1}`} />
                <div className="grid gap-1 text-[12px] text-ink2">
                  <div><span className="text-ink3">Assigned to</span> · {selOrder.deliveryPartner || selOrder.courier}</div>
                  {selOrder.deliveryPartnerPhone && <div><span className="text-ink3">Phone</span> · {selOrder.deliveryPartnerPhone}</div>}
                  {selOrder.trackingId && <div><span className="text-ink3">Tracking</span> · {selOrder.trackingId}</div>}
                  {selOrder.expectedDeliveryTime && <div><span className="text-ink3">Expected</span> · {fmtDateFull(selOrder.expectedDeliveryTime)}</div>}
                </div>
                {!!selOrder.deliveryFailures?.length && (
                  <div className="mt-2 grid gap-1 border-t border-border pt-2 text-[11.5px] text-ink3">
                    {selOrder.deliveryFailures.map((f, i) => (
                      <div key={i}>Attempt {f.attempt || i + 1} failed · {f.reason}{f.failedAt ? ` · ${fmtDateFull(f.failedAt)}` : ""}</div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {selOrder.cancelReason && <Note kind="crit" className="my-0"><B>Cancelled.</B> {selOrder.cancelReason}{selOrder.cancelledAt ? ` · ${fmtDateFull(selOrder.cancelledAt)}` : ""}</Note>}
            {selOrder.returnReason && (
              <Note kind="crit" className="my-0">
                <B>Return requested.</B> {selOrder.returnReason}
                {selOrder.returnApproved && " · approved"}
                {selOrder.returnRejected && ` · rejected${selOrder.returnRejectionReason ? `: ${selOrder.returnRejectionReason}` : ""}`}
              </Note>
            )}
            {selOrder.refundDetails?.status && (Number(selOrder.refundDetails.amount) > 0 || !!selOrder.refundDetails.method || selOrder.refundDetails.status !== "Pending") && (
              <Note className="my-0">
                <B>Refund {selOrder.refundDetails.status.toLowerCase()}</B> · {fmtINR(selOrder.refundDetails.amount)}{selOrder.refundDetails.method ? ` via ${selOrder.refundDetails.method}` : ""}
                {selOrder.refundDetails.razorpayRefundId ? ` · ${selOrder.refundDetails.razorpayRefundId}` : ""}
                {selOrder.refundDetails.notes ? <><br /><span className="text-ink3">{selOrder.refundDetails.notes}</span></> : null}
              </Note>
            )}
            {selOrder.notes && <Note className="my-0"><B>Guest note.</B> {selOrder.notes}</Note>}
            {err && <Note kind="crit" className="my-0">{err}</Note>}

            {can("orders.manage") && (
              <>
                {nextStatus && nextStatus !== "Out for Delivery" && (
                  <Btn className="w-full" disabled={busy} onClick={() => setStatus(selOrder, nextStatus)}>Mark {nextStatus}</Btn>
                )}
                {selOrder.orderStatus === "Shipped" && (
                  <Btn disabled={busy} onClick={() => {
                    setDelivery({ partner: selOrder.deliveryPartner || "", phone: selOrder.deliveryPartnerPhone || "", courier: selOrder.courier || "", tracking: selOrder.trackingId || "", expected: "" });
                    setDeliveryOpen(true);
                  }}>Assign delivery…</Btn>
                )}
                {selOrder.orderStatus === "Out for Delivery" && (
                  <Btn kind="danger" disabled={busy} onClick={() => { setFailureReason(""); setFailureNote(""); setFailedOpen(true); }}>Mark delivery failed…</Btn>
                )}
                {selOrder.orderStatus === "Delivery Failed" && (
                  <Btn kind="gold" disabled={busy} onClick={() => {
                    setDelivery({ partner: selOrder.deliveryPartner || "", phone: selOrder.deliveryPartnerPhone || "", courier: selOrder.courier || "", tracking: selOrder.trackingId || "", expected: "" });
                    setDeliveryOpen(true);
                  }}>Reassign delivery…</Btn>
                )}
                {!["Cancelled", "Returned", "Delivered", "Return Requested"].includes(selOrder.orderStatus) && (
                  <Btn kind="danger" disabled={busy} onClick={() => { setCancelReason(""); setCancelOpen(true); }}>Cancel order…</Btn>
                )}
                {["Return Requested", "Returned"].includes(selOrder.orderStatus) && selOrder.returnReason && !selOrder.returnApproved && !selOrder.returnRejected && (
                  <div className="grid gap-2">
                    <Btn kind="gold" disabled={busy} onClick={() => act(
                      () => api.orders.approveReturn(selOrder._id).then(() => audit("ORDER_STATUS_UPDATED", `Return approved for ${selOrder.orderNumber}`, { orderId: selOrder._id })),
                      "Return approved — waiting for the item to arrive")}>Approve return</Btn>
                    <Btn kind="danger" disabled={busy} onClick={() => { setRejectReason(""); setRejectOpen(true); }}>Reject return…</Btn>
                  </div>
                )}
                {["Return Requested", "Returned"].includes(selOrder.orderStatus) && selOrder.returnApproved && !selOrder.stockRestoredAt && (
                  <Btn kind="gold" disabled={busy} onClick={() => act(
                    () => api.orders.completeReturn(selOrder._id).then(() => audit("ORDER_STATUS_UPDATED", `Return received for ${selOrder.orderNumber}`, { orderId: selOrder._id })),
                    "Return received — stock restored and refund started")}>Mark return received</Btn>
                )}
                {["Cancelled", "Returned"].includes(selOrder.orderStatus) && selOrder.paymentStatus === "Paid" && !["Processing", "Completed"].includes(selOrder.refundDetails?.status || "") && (
                  <Btn kind="gold" disabled={busy} onClick={() => setRefundOpen(true)}>Refund {fmtINR(selOrder.pricing?.total)}…</Btn>
                )}
                {selOrder.refundDetails?.status === "Processing" && selOrder.refundDetails.method !== "Razorpay" && (
                  <CompleteRefund order={selOrder} busy={busy} act={act} audit={audit} />
                )}
              </>
            )}

            <Btn kind="ghost" onClick={() => invoice(selOrder)}>Download invoice</Btn>

            {!!selOrder.statusHistory?.length && (
              <>
                <SecH t="Status history" />
                <div className="grid gap-1.5">
                  {selOrder.statusHistory.map((h, i) => (
                    <div key={i} className="rounded-lg bg-ivory px-3 py-2 text-[12px] text-ink2">
                      <b>{h.status}</b> · {fmtDateFull(h.timestamp)}{h.note ? ` — ${h.note}` : ""}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order">
        <Note kind="crit">Cancelling restores stock and messages the guest. {selOrder?.paymentStatus === "Paid" && selOrder.paymentMethod !== "COD" ? "The Razorpay refund starts automatically and returns to the original payment method." : selOrder?.paymentStatus === "Paid" ? "This COD payment needs a manual payout method." : "No captured payment will be refunded."}</Note>
        <Area label="Reason (the guest sees this)" value={cancelReason} onChange={setCancelReason} rows={2} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setCancelOpen(false)}>Back</Btn>
          <Btn kind="danger" disabled={busy || cancelReason.trim().length < 4} onClick={async () => {
            if (!selOrder) return;
            const ok = await setStatus(selOrder, "Cancelled", cancelReason.trim());
            if (ok) setCancelOpen(false);
          }}>Cancel order</Btn>
        </div>
      </Modal>

      <Modal open={deliveryOpen} onClose={() => setDeliveryOpen(false)} title={selOrder?.orderStatus === "Delivery Failed" ? "Reassign delivery" : "Assign delivery"}>
        <Note>{selOrder?.orderStatus === "Delivery Failed" ? `This starts delivery attempt ${(selOrder.deliveryAttempt || 1) + 1}. Earlier failures remain in the history.` : "This starts the first delivery attempt and marks the order out for delivery."}</Note>
        <div className="grid grid-cols-2 gap-2">
          <In label="Delivery partner" value={delivery.partner} onChange={(v) => setDelivery({ ...delivery, partner: v })} />
          <In label="Partner phone" value={delivery.phone} onChange={(v) => setDelivery({ ...delivery, phone: v })} />
          <In label="Courier / agency" value={delivery.courier} onChange={(v) => setDelivery({ ...delivery, courier: v })} />
          <In label="Tracking ID" value={delivery.tracking} onChange={(v) => setDelivery({ ...delivery, tracking: v })} />
          <In full label="Expected delivery" type="datetime-local" value={delivery.expected} onChange={(v) => setDelivery({ ...delivery, expected: v })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setDeliveryOpen(false)}>Back</Btn>
          <Btn disabled={busy || (!delivery.partner.trim() && !delivery.courier.trim())} onClick={async () => {
            if (!selOrder) return;
            const ok = await act(
              () => api.orders.assignDelivery(selOrder._id, {
                deliveryPartner: delivery.partner.trim() || undefined,
                deliveryPartnerPhone: delivery.phone.trim() || undefined,
                courier: delivery.courier.trim() || undefined,
                trackingId: delivery.tracking.trim() || undefined,
                expectedDeliveryTime: delivery.expected || undefined,
              }).then(() => audit("ORDER_STATUS_UPDATED", `Delivery assigned for ${selOrder.orderNumber}`, { orderId: selOrder._id })),
              selOrder.orderStatus === "Delivery Failed" ? "Delivery reassigned" : "Delivery assigned");
            if (ok) setDeliveryOpen(false);
          }}>{selOrder?.orderStatus === "Delivery Failed" ? "Start next attempt" : "Assign delivery"}</Btn>
        </div>
      </Modal>

      <Modal open={failedOpen} onClose={() => setFailedOpen(false)} title="Mark delivery failed">
        <Note kind="crit">This records the failed attempt without cancelling or refunding the order. You can reassign it or cancel it afterwards.</Note>
        <Area label="Failure reason" value={failureReason} onChange={setFailureReason} rows={2} />
        <Area label="Internal note (optional)" value={failureNote} onChange={setFailureNote} rows={2} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setFailedOpen(false)}>Back</Btn>
          <Btn kind="danger" disabled={busy || failureReason.trim().length < 4} onClick={async () => {
            if (!selOrder) return;
            const ok = await act(
              () => api.orders.markDeliveryFailed(selOrder._id, failureReason.trim(), failureNote.trim() || undefined)
                .then(() => audit("ORDER_STATUS_UPDATED", `Delivery failed for ${selOrder.orderNumber}: ${failureReason.trim()}`, { orderId: selOrder._id })),
              "Delivery attempt marked failed");
            if (ok) setFailedOpen(false);
          }}>Mark failed</Btn>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject the return">
        <Area label="Why? (the guest sees this)" value={rejectReason} onChange={setRejectReason} rows={2} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setRejectOpen(false)}>Back</Btn>
          <Btn kind="danger" disabled={busy || rejectReason.trim().length < 4} onClick={async () => {
            if (!selOrder) return;
            const ok = await act(
              () => api.orders.rejectReturn(selOrder._id, rejectReason.trim()).then(() => audit("ORDER_STATUS_UPDATED", `Return rejected for ${selOrder.orderNumber}: ${rejectReason.trim()}`, { orderId: selOrder._id })),
              "Return rejected");
            if (ok) setRejectOpen(false);
          }}>Reject return</Btn>
        </div>
      </Modal>

      {selOrder && <RefundModal open={refundOpen} order={selOrder} onClose={() => setRefundOpen(false)} onDone={() => { setRefundOpen(false); reloadAll(); }} />}
    </Page>
  );
}

/** Second step of a manual (non-Razorpay) refund: record that the money went out. */
function CompleteRefund({ order, busy, act, audit }: {
  order: ProductOrder; busy: boolean;
  act: (fn: () => Promise<unknown>, msg: string) => Promise<boolean>;
  audit: (a: "ORDER_STATUS_UPDATED", d: string, x?: Record<string, unknown>) => void;
}) {
  const [txn, setTxn] = useState("");
  const [proof, setProof] = useState("");
  return (
    <Card className="p-3.5">
      <SecH t={`Complete the ${order.refundDetails?.method} refund`} />
      <div className="grid gap-2">
        <In label="Transaction / reference no." value={txn} onChange={setTxn} />
        <In label="Proof URL (optional — bank screenshot etc.)" value={proof} onChange={setProof} />
        <Btn kind="gold" disabled={busy || txn.trim().length < 3} onClick={() => act(
          () => api.orders.completeRefund(order._id, { transactionId: txn.trim(), transactionProof: proof.trim() || undefined })
            .then(() => audit("ORDER_STATUS_UPDATED", `Refund completed for ${order.orderNumber} · ${txn.trim()}`, { orderId: order._id })),
          "Refund marked complete")}>Mark refund paid out</Btn>
      </div>
    </Card>
  );
}

function RefundModal({ open, order, onClose, onDone }: { open: boolean; order: ProductOrder; onClose: () => void; onDone: () => void }) {
  const { toast, audit } = useStore();
  const online = order.paymentMethod !== "COD";
  const [method, setMethod] = useState("Bank Transfer");
  const [amount, setAmount] = useState(String(order.pricing?.total ?? 0));
  const [notes, setNotes] = useState("");
  const [bank, setBank] = useState({ accountHolderName: "", accountNumber: "", ifscCode: "", bankName: "", upiId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saved = useApi(() => (open ? api.orders.bankDetails(idOf(order.userId)).catch(() => null) : Promise.resolve(null)), [open, order._id]);

  useEffect(() => {
    if (!open) return;
    setAmount(String(order.pricing?.total ?? 0)); setNotes(""); setErr(null);
    const b = (saved.data as { bankDetails?: Record<string, string> } | null)?.bankDetails;
    if (b) setBank({ accountHolderName: b.accountHolderName ?? "", accountNumber: b.accountNumber ?? "", ifscCode: b.ifscCode ?? "", bankName: b.bankName ?? "", upiId: b.upiId ?? "" });
  }, [open, saved.data, order._id, order.pricing?.total]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { refundAmount: Number(amount) || undefined, notes: notes.trim() || undefined };
      if (!online) {
        body.refundMethod = method;
        if (method === "Bank Transfer") body.bankDetails = { accountHolderName: bank.accountHolderName, accountNumber: bank.accountNumber, ifscCode: bank.ifscCode, bankName: bank.bankName };
        if (method === "UPI") body.bankDetails = { accountHolderName: bank.accountHolderName, upiId: bank.upiId };
      }
      await api.orders.initiateRefund(order._id, body);
      audit("ORDER_STATUS_UPDATED", `Refund of ${fmtINR(Number(amount))} initiated for ${order.orderNumber}${online ? " via Razorpay" : ` via ${method}`}`, { orderId: order._id });
      toast(online ? "Refund sent to Razorpay — it reaches the guest in 5–7 working days" : "Refund recorded — mark it paid out once the money leaves");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Refund ${order.orderNumber}`}>
      {online ? (
        <Note>Paid online, so the refund goes back through <B>Razorpay</B> to the original payment method. Nothing else to collect.</Note>
      ) : (
        <Note>Cash-on-delivery order: record how the money is going back. Bank and UPI refunds are marked <B>Processing</B> until you confirm the transfer.</Note>
      )}
      <div className="grid gap-3">
        <In label="Amount (₹)" type="number" value={amount} onChange={setAmount} hint={`Order total ${fmtINR(order.pricing?.total)}`} />
        {!online && (
          <>
            <Sel label="Refund method" value={method} onChange={setMethod} options={["Bank Transfer", "UPI", "Cash", "Store Credit"]} />
            {(method === "Bank Transfer" || method === "UPI") && (
              <>
                <In label="Account holder" value={bank.accountHolderName} onChange={(v) => setBank({ ...bank, accountHolderName: v })} />
                {method === "Bank Transfer" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <In label="Account number" value={bank.accountNumber} onChange={(v) => setBank({ ...bank, accountNumber: v })} />
                    <In label="IFSC" value={bank.ifscCode} onChange={(v) => setBank({ ...bank, ifscCode: v.toUpperCase() })} />
                    <In label="Bank" value={bank.bankName} onChange={(v) => setBank({ ...bank, bankName: v })} full />
                  </div>
                ) : (
                  <In label="UPI ID" value={bank.upiId} onChange={(v) => setBank({ ...bank, upiId: v })} />
                )}
                {saved.data && (saved.data as { hasBankDetails?: boolean }).hasBankDetails && <div className="-mt-2 text-[10.5px] text-ink3">Pre-filled from the details the guest saved in the app.</div>}
              </>
            )}
          </>
        )}
        <Area label="Notes (internal)" value={notes} onChange={setNotes} rows={2} />
      </div>
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Back</Btn>
        <Btn kind="gold" disabled={busy || !(Number(amount) > 0)} onClick={submit}>{busy ? "Working…" : online ? "Refund via Razorpay" : "Record refund"}</Btn>
      </div>
    </Modal>
  );
}
