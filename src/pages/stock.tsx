import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Page, Btn, Tag, Card, DataTable, B, Tabs, Note, Hint, In, Sel, Area, SecH, Stats, Stars,
  Drawer, Modal, DeleteModal, Async, Empty, StaleBanner, exportCsv, Menu,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { fmtCompactINR, fmtDate, fmtINR, isoDay, toDate } from "../lib/format";
import type { Inventory as Item, Product, Vendor } from "../lib/types";

/* ================= INVENTORY ================= */
const daysUntil = (d?: string) => {
  const date = toDate(d);
  if (!date) return null;
  return Math.round((date.getTime() - Date.now()) / 86400000);
};

const EXPIRING_WINDOW = 90; // days — matches the model's expiryStatus virtual

const randomSuffix = (length = 6) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};
const generatedItemCode = (name: string) => {
  const prefix = name.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "ITEM";
  return `${prefix}-${Date.now().toString(36).slice(-5).toUpperCase()}-${randomSuffix(4)}`;
};
const generatedBatchNumber = () => {
  const day = isoDay().replace(/-/g, "");
  return `BAT-${day}-${randomSuffix(5)}`;
};

function GeneratedInput({ label, value, onChange, onGenerate, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; onGenerate: () => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <div className="flex overflow-hidden rounded-lg border border-border bg-ivory focus-within:border-gold-dark">
        <input value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[12.5px] font-mono text-ink outline-none" />
        <button type="button" onClick={onGenerate}
          className="shrink-0 border-l border-border bg-surface px-2.5 text-[10.5px] font-bold text-primary hover:bg-sage">
          Generate
        </button>
      </div>
    </div>
  );
}

function ProductSearch({ products, value, loading, error, onChange, onSelect }: {
  products: Product[]; value: string; loading: boolean; error?: string | null;
  onChange: (value: string) => void; onSelect: (product: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const query = value.trim().toLocaleLowerCase();
  const matches = products.filter((product) => {
    const haystack = [product.name, product.code, product.OrgName, product.formulation].filter(Boolean).join(" ").toLocaleLowerCase();
    return !query || haystack.includes(query);
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={root} className="relative flex flex-col gap-1">
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">Item name</label>
      <input value={value} onFocus={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        placeholder="Search the product catalogue or type an item…"
        autoComplete="off" role="combobox" aria-expanded={open} aria-controls="stock-product-options"
        className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark" />
      <div className="text-[10.5px] text-ink3">Choose an app product to prefill its details, or enter a consumable manually.</div>
      {open && (
        <div id="stock-product-options" role="listbox" className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {loading ? <div className="px-3 py-3 text-[11.5px] text-ink3">Loading products…</div>
            : error ? <div className="px-3 py-3 text-[11.5px] text-err">Could not load the product list. You can still type the item name.</div>
              : matches.length ? <>
                {matches.slice(0, 12).map((product) => (
                  <button key={product._id} type="button" role="option" onClick={() => { onSelect(product); setOpen(false); }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-ivory focus:bg-ivory focus:outline-none">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-bold text-ink">{product.name}</span>
                      <span className="block truncate text-[10.5px] text-ink3">{[product.code, product.formulation, product.OrgName].filter(Boolean).join(" · ") || "Catalogue product"}</span>
                    </span>
                    <span className="shrink-0 text-right text-[10.5px] text-ink3">
                      <span className="block font-semibold text-ink2">{fmtINR(product.price)}</span>
                      <span>{product.stock ?? 0} in catalogue</span>
                    </span>
                  </button>
                ))}
                {matches.length > 12 && <div className="border-t border-border px-3 py-2 text-[10.5px] text-ink3">Keep typing to narrow {matches.length} matching products.</div>}
              </> : <div className="px-3 py-3 text-[11.5px] text-ink3">No catalogue product matches. Keep this name to create a standalone stock item.</div>}
        </div>
      )}
    </div>
  );
}

export function Inventory() {
  const { toast, audit, can } = useStore();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sel, setSel] = useState<Item | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState<Item | null>(null);
  const debounced = useDebounced(search);

  const q = useApi(
    () => api.inventory.list({ search: debounced || undefined, category: category === "All" ? undefined : category }),
    [debounced, category],
  );

  const rows = q.data?.data ?? [];
  // Deep link from a low-stock notification (?item=).
  useEffect(() => {
    const want = sp.get("item");
    if (!want || !rows.length) return;
    const f = rows.find((r) => r._id === want);
    if (f) setSel(f);
  }, [sp, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = q.data?.stats as
    | { total?: number; batchable?: number; nonBatchable?: number; lowStock?: number; expired?: number; totalValue?: number }
    | undefined;

  const belowReorder = (i: Item) => (i.qohAllBatches ?? 0) <= (i.reOrderLevel ?? 0);
  const expiringSoon = (i: Item) => {
    const d = daysUntil(i.batchExpiryDate);
    return d !== null && d >= 0 && d <= EXPIRING_WINDOW;
  };
  const expired = (i: Item) => {
    const d = daysUntil(i.batchExpiryDate);
    return d !== null && d < 0;
  };

  const buckets = [
    { label: "All stock", filter: () => true },
    { label: "Below re-order", filter: belowReorder },
    { label: "Out of stock", filter: (i: Item) => (i.qohAllBatches ?? 0) === 0 },
    { label: `Expiring ≤${EXPIRING_WINDOW}d`, filter: expiringSoon },
    { label: "Expired", filter: expired },
  ];
  const list = rows.filter(buckets[tab].filter);

  return (
    <Page title="Inventory" sub="Live stock, batches and expiry across the clinic"
      actions={<>
        <Menu button={<Btn kind="ghost">{category} ▾</Btn>}
          items={["All", "Retail products", "Consumables"].map((c) => ({ label: c, onClick: () => setCategory(c) }))} />
        <Btn kind="ghost" disabled={!list.length} onClick={() => exportCsv("zennara-inventory",
          ["Item", "Code", "Category", "Formulation", "Brand", "Batch", "Expiry", "On hand", "Re-order", "Target", "Buying", "Selling", "Vendor"],
          list.map((i) => [i.inventoryName, i.code ?? "", i.inventoryCategory, i.formulation ?? "", i.orgName ?? "",
            i.batchNo ?? "", i.batchExpiryDate ? fmtDate(i.batchExpiryDate) : "", i.qohAllBatches ?? 0,
            i.reOrderLevel ?? 0, i.targetLevel ?? 0, i.inventoryBuyingPrice ?? 0, i.inventorySellingPrice ?? 0, i.vendorName ?? ""]))}>
          Export CSV
        </Btn>
        <Btn kind="ghost" onClick={() => window.print()}>Print report</Btn>
        {can("inventory.manage") && <Btn onClick={() => setAddOpen(true)}>+ Add item</Btn>}
      </>}>

      <Hint id="inventory-live">Batch and expiry are columns rather than detail fields, because a recall question is “which batch, and who received it” — it has to be answerable at a glance. Anything at or below its re-order level shows in the second tab; that is your ordering list.</Hint>

      {stats && (
        <Stats items={[
          { k: "Items", v: (stats.total ?? rows.length).toLocaleString("en-IN") },
          { k: "Stock value", v: fmtCompactINR(stats.totalValue) , d: "at buying price" },
          { k: "Below re-order", v: rows.filter(belowReorder).length, hot: rows.filter(belowReorder).length > 0 },
          { k: "Out of stock", v: rows.filter((i) => (i.qohAllBatches ?? 0) === 0).length, tone: "dn" },
          { k: `Expiring ≤${EXPIRING_WINDOW}d`, v: rows.filter(expiringSoon).length, tone: "dn" },
          { k: "Expired", v: stats.expired ?? rows.filter(expired).length, tone: "dn" },
        ]} />
      )}

      <div className="mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, batch number or vendor…"
          className="w-full max-w-[420px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      </div>

      <div data-tour="inv-tabs">
        <Tabs active={tab} onChange={setTab} items={buckets.map((b) => [b.label, rows.filter(b.filter).length]) as [string, number][]} />
      </div>
      <div data-tour="inv-table" />

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading stock…" rows={8}>
        {() => list.length === 0 ? (
          <Empty title={tab === 0 ? "No stock items yet" : "Nothing in this bucket"}
            hint={tab === 0 ? "Add the consumables and retail stock the clinic holds." : "Good news — nothing needs attention here."}
            action={tab === 0 && can("inventory.manage") ? <Btn onClick={() => setAddOpen(true)}>+ Add item</Btn> : undefined} />
        ) : (
          <DataTable cols={["Item", "Category", "Batch", "Expiry", "On hand", "Re-order", "Value", "Vendor", "Status"]}
            onRow={(i) => setSel(list[i])}
            rows={list.map((i) => {
              const days = daysUntil(i.batchExpiryDate);
              const qoh = i.qohAllBatches ?? 0;
              return [
                <span key={i._id}>
                  <B>{i.inventoryName}</B>
                  {i.code && <span className="ml-1.5 font-mono text-[10.5px] text-ink3">{i.code}</span>}
                  {i.formulation && <span className="block text-[10.5px] text-ink3">{i.formulation}{i.orgName ? ` · ${i.orgName}` : ""}</span>}
                </span>,
                <Tag key={`${i._id}c`} kind={i.inventoryCategory === "Consumables" ? "info" : "mute"}>{i.inventoryCategory}</Tag>,
                <span key={`${i._id}b`} className="font-mono text-[11.5px]">{i.batchNo || "—"}</span>,
                <span key={`${i._id}e`} className="font-mono text-[11.5px]">
                  {i.batchExpiryDate ? fmtDate(i.batchExpiryDate) : "—"}
                  {days !== null && days >= 0 && days <= EXPIRING_WINDOW && <span className="ml-1 text-warn">({days}d)</span>}
                </span>,
                <b key={`${i._id}q`} className={belowReorder(i) ? "text-warn" : ""}>{qoh}{i.packName ? ` ${i.packName}` : ""}</b>,
                i.reOrderLevel ?? 0,
                fmtINR((i.inventoryBuyingPrice ?? 0) * qoh),
                i.vendorName || "—",
                expired(i) ? <Tag key={`${i._id}s`} kind="err">Expired</Tag>
                  : qoh === 0 ? <Tag key={`${i._id}s`} kind="err">Out</Tag>
                  : belowReorder(i) ? <Tag key={`${i._id}s`} kind="warn">Re-order</Tag>
                  : expiringSoon(i) ? <Tag key={`${i._id}s`} kind="warn">Expiring</Tag>
                  : <Tag key={`${i._id}s`} kind="ok">In stock</Tag>,
              ];
            })} />
        )}
      </Async>

      <ItemEditor open={!!sel || addOpen} item={sel}
        onClose={() => { setSel(null); setAddOpen(false); }}
        onSaved={() => { q.reload(); setSel(null); setAddOpen(false); }}
        onDelete={(i) => { setSel(null); setDel(i); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `stock item "${del.inventoryName}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.inventory.remove(del._id);
            audit("INVENTORY_DELETED", `${del.inventoryName} · reason: ${reason}`, { itemId: del._id });
            toast("Stock item deleted"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />

      <Note>
        Stock is held per item and batch. Adjusting a quantity here records who changed it and why in the audit log —
        that trail is what makes a monthly count meaningful.
      </Note>
    </Page>
  );
}

function ItemEditor({ open, item, onClose, onSaved, onDelete }: {
  open: boolean; item: Item | null; onClose: () => void; onSaved: () => void; onDelete: (i: Item) => void;
}) {
  const { toast, audit } = useStore();
  const [f, setF] = useState<Partial<Item>>({});
  const [adjust, setAdjust] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vendors = useApi(() => api.vendors.list({ status: "Active" }).catch(() => [] as Vendor[]), [open]);
  const forms = useApi(() => api.formulations.list({ isActive: "true" }).catch(() => []), [open]);
  const brands = useApi(() => api.brands.list({ isActive: "true" }).catch(() => []), [open]);
  const products = useApi(() => open && !item
    ? api.products.list({ isActive: "true", sort: "name_asc" }).then((response) => response.data ?? [])
    : Promise.resolve([] as Product[]), [open, item?._id]);
  const vendorNames = (vendors.data ?? []).map((v) => v.name);
  const formNames = (forms.data ?? []).map((x) => x.name);
  const brandNames = (brands.data ?? []).map((brand) => brand.name);

  useEffect(() => {
    if (!open) return;
    setF(item ?? {
      inventoryName: "", inventoryCategory: "Consumables", batchMaintenance: "Non Batchable",
      batchType: "FIFO", qohAllBatches: 0, reOrderLevel: 5, targetLevel: 20, gstPercentage: 18,
      inventoryBuyingPrice: 0, inventorySellingPrice: 0, packSize: 1,
      formulation: formNames[0] ?? "", vendorName: vendorNames[0] ?? "",
    });
    setAdjust(""); setReason(""); setErr(null);
  }, [open, item?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep state in step with what the selects display.
  useEffect(() => {
    if (!open) return;
    setF((s) => ({ ...s, formulation: s.formulation || formNames[0] || "", vendorName: s.vendorName || vendorNames[0] || "" }));
  }, [open, formNames.join("|"), vendorNames.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Item>(k: K) => (v: Item[K]) => setF((s) => ({ ...s, [k]: v }));
  // isoDay reads the instant back in clinic time. toISOString() is UTC, so an
  // IST-midnight date (18:30Z the day before) showed as the previous day.
  const dateVal = (v?: string) => (v ? isoDay(new Date(v)) : "");
  const selectProduct = (product: Product) => setF((current) => ({
    ...current,
    inventoryName: product.name,
    inventoryCategory: "Retail products",
    code: product.code || current.code || "",
    formulation: product.formulation || current.formulation || "",
    orgName: product.OrgName || current.orgName || "",
    gstPercentage: product.gstPercentage ?? current.gstPercentage ?? 18,
    inventorySellingPrice: product.price ?? current.inventorySellingPrice ?? 0,
  }));

  const save = async () => {
    setErr(null);
    if (!f.inventoryName?.trim()) return setErr("An item name is required");
    if (item && adjust !== "" && Number(adjust) !== (item.qohAllBatches ?? 0) && reason.trim().length < 4) {
      return setErr("Changing the quantity needs a reason — it goes on the audit trail");
    }

    setBusy(true);
    try {
      const qty = adjust !== "" ? Number(adjust) : Number(f.qohAllBatches) || 0;
      const body: Partial<Item> & { reason?: string } = {
        ...f,
        qohAllBatches: qty,
        qohBatchWise: qty,
        // Goes on the stock ledger row the server writes for this change.
        reason: reason.trim() || undefined,
        reOrderLevel: Number(f.reOrderLevel) || 0,
        targetLevel: Number(f.targetLevel) || 0,
        gstPercentage: Number(f.gstPercentage) || 0,
        inventoryBuyingPrice: Number(f.inventoryBuyingPrice) || 0,
        inventorySellingPrice: Number(f.inventorySellingPrice) || 0,
        packSize: Number(f.packSize) || 1,
      };
      if (item) {
        await api.inventory.update(item._id, body);
        audit("INVENTORY_UPDATED",
          `${f.inventoryName}${adjust !== "" ? ` · qty ${item.qohAllBatches ?? 0} → ${qty} · ${reason.trim()}` : ""}`,
          { itemId: item._id });
        toast("Stock item saved");
      } else {
        const created = await api.inventory.create(body);
        audit("INVENTORY_CREATED", `${created.inventoryName}`, { itemId: created._id });
        toast(`${created.inventoryName} added to stock`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };


  return (
    <Drawer open={open} onClose={onClose} title={item ? item.inventoryName : "New stock item"}>
      <div className="grid gap-3">
        {item
          ? <In label="Item name" value={f.inventoryName ?? ""} onChange={set("inventoryName")} />
          : <ProductSearch products={products.data ?? []} value={f.inventoryName ?? ""} loading={products.loading}
              error={products.error} onChange={set("inventoryName")} onSelect={selectProduct} />}
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Category" value={f.inventoryCategory ?? "Consumables"}
            onChange={(v) => set("inventoryCategory")(v as Item["inventoryCategory"])}
            options={["Consumables", "Retail products"]} />
          <GeneratedInput label="Code" value={f.code ?? ""} onChange={set("code")}
            onGenerate={() => set("code")(generatedItemCode(f.inventoryName ?? ""))} placeholder="Enter or generate" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {formNames.length
            ? <Sel label="Formulation" value={f.formulation ?? formNames[0]} onChange={set("formulation")} options={formNames} />
            : <In label="Formulation" value={f.formulation ?? ""} onChange={set("formulation")} />}
          {brandNames.length
            ? <Sel label="Brand" value={f.orgName ?? ""} onChange={set("orgName")} options={[...new Set(["", ...brandNames, ...(f.orgName ? [f.orgName] : [])])]} />
            : <In label="Brand" value={f.orgName ?? ""} onChange={set("orgName")} />}
        </div>

        <SecH t="Batch" />
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Batch tracking" value={f.batchMaintenance ?? "Non Batchable"}
            onChange={(v) => set("batchMaintenance")(v as Item["batchMaintenance"])}
            options={["Non Batchable", "Batchable"]} />
          <Sel label="Consumption order" value={f.batchType ?? "FIFO"}
            onChange={(v) => set("batchType")(v as Item["batchType"])} options={["FIFO", "ByExpiry"]} />
          <GeneratedInput label="Batch number" value={f.batchNo ?? ""}
            onChange={(value) => setF((current) => ({ ...current, batchNo: value, ...(value ? { batchMaintenance: "Batchable" as const } : {}) }))}
            onGenerate={() => setF((current) => ({ ...current, batchNo: generatedBatchNumber(), batchMaintenance: "Batchable" }))}
            placeholder="Enter or generate" />
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">Expiry date</label>
            <input type="date" value={dateVal(f.batchExpiryDate)}
              onChange={(event) => setF((current) => ({ ...current,
                batchExpiryDate: event.target.value ? new Date(event.target.value).toISOString() : undefined,
                ...(event.target.value ? { batchMaintenance: "Batchable" as const } : {}),
              }))}
              className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark" />
            <div className="flex gap-1 text-[9.5px] font-bold">
              {[6, 12, 24].map((months) => <button key={months} type="button" onClick={() => {
                const expiry = new Date(); expiry.setMonth(expiry.getMonth() + months);
                setF((current) => ({ ...current, batchExpiryDate: expiry.toISOString(), batchMaintenance: "Batchable" }));
              }} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-ink3 hover:border-gold-dark hover:text-primary">+{months}m</button>)}
            </div>
          </div>
        </div>

        <SecH t="Quantities" />
        {item ? (
          <>
            <div className="rounded-xl bg-ivory px-3.5 py-2.5 font-mono text-[12px]">
              On hand now: <b>{item.qohAllBatches ?? 0}</b>
              {item.batchNo ? ` · batch ${item.batchNo}` : ""}
              {item.batchExpiryDate ? ` · exp ${fmtDate(item.batchExpiryDate)}` : ""}
            </div>
            <In label="New quantity" type="number" value={adjust} onChange={setAdjust}
              placeholder={String(item.qohAllBatches ?? 0)} hint="Leave blank to keep the current quantity" />
            {adjust !== "" && Number(adjust) !== (item.qohAllBatches ?? 0) && (
              <Area label="Reason for the change (required, audited)" value={reason} onChange={setReason} rows={2}
                placeholder="e.g. goods receipt PO-118 / stock count correction / breakage" />
            )}
          </>
        ) : (
          <In label="Opening quantity" type="number" value={String(f.qohAllBatches ?? 0)}
            onChange={(v) => set("qohAllBatches")(Number(v) || 0)} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <In label="Re-order level" type="number" value={String(f.reOrderLevel ?? 0)} onChange={(v) => set("reOrderLevel")(Number(v) || 0)} />
          <In label="Target level" type="number" value={String(f.targetLevel ?? 0)} onChange={(v) => set("targetLevel")(Number(v) || 0)} />
          <In label="Pack name" value={f.packName ?? ""} onChange={set("packName")} placeholder="btl / ea / vial" />
          <In label="Pack size" type="number" value={String(f.packSize ?? 1)} onChange={(v) => set("packSize")(Number(v) || 1)} />
        </div>

        <SecH t="Costing" />
        <div className="grid grid-cols-2 gap-3">
          <In label="Buying price (₹)" type="number" value={String(f.inventoryBuyingPrice ?? 0)} onChange={(v) => set("inventoryBuyingPrice")(Number(v) || 0)} />
          <In label="Selling price (₹)" type="number" value={String(f.inventorySellingPrice ?? 0)} onChange={(v) => set("inventorySellingPrice")(Number(v) || 0)} />
          <In label="GST %" type="number" value={String(f.gstPercentage ?? 18)} onChange={(v) => set("gstPercentage")(Number(v) || 0)} />
          {vendorNames.length
            ? <Sel label="Vendor" value={f.vendorName ?? vendorNames[0]} onChange={set("vendorName")} options={vendorNames} />
            : <In label="Vendor" value={f.vendorName ?? ""} onChange={set("vendorName")} />}
        </div>

        {err && <Note kind="crit">{err}</Note>}
        <div className="flex flex-wrap gap-2">
          <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : item ? "Save changes" : "Add to stock"}</Btn>
          {item && <Btn kind="danger" onClick={() => onDelete(item)}>Delete</Btn>}
        </div>
      </div>
    </Drawer>
  );
}

/* ================= VENDORS ================= */
export function Vendors() {
  const { toast, audit, can } = useStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [sel, setSel] = useState<Vendor | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState<Vendor | null>(null);
  const debounced = useDebounced(search);

  const q = useApi(
    () => api.vendors.list({ search: debounced || undefined, status: status === "All" ? undefined : status }),
    [debounced, status],
  );
  const stats = useApi(() => api.vendors.stats().catch(() => ({} as Record<string, number>)), []);

  const rows = q.data ?? [];
  const s = stats.data ?? {};

  return (
    <Page title="Vendors" sub={`${rows.length} supplier${rows.length === 1 ? "" : "s"} · ratings and procurement contacts`}
      actions={<>
        <Menu button={<Btn kind="ghost">{status} ▾</Btn>}
          items={["All", "Active", "Inactive"].map((x) => ({ label: x, onClick: () => setStatus(x) }))} />
        <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv("zennara-vendors",
          ["Vendor", "Contact", "Email", "Phone", "GSTIN", "PAN", "City", "Rating", "Products", "Status"],
          rows.map((v) => [v.name, v.contactPerson ?? "", v.email ?? "", v.phone ?? "", v.gstNumber ?? "",
            v.panNumber ?? "", v.city ?? "", v.rating ?? 0, v.productsSupplied ?? v.productsCount ?? 0, v.status]))}>Export CSV</Btn>
        {can("vendors.manage") && <Btn onClick={() => setAddOpen(true)}>+ Vendor</Btn>}
      </>}>
      {Object.keys(s).length > 0 && (
        <Stats items={Object.entries(s).slice(0, 6).map(([k, v]) => ({
          k: k.replace(/([A-Z])/g, " $1"),
          v: typeof v === "number" ? v.toLocaleString("en-IN") : String(v),
        }))} />
      )}

      <div className="mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor, contact or GSTIN…"
          className="w-full max-w-[420px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      </div>

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading vendors…" rows={6}>
        {() => rows.length === 0 ? (
          <Empty title="No vendors yet" hint="Add the suppliers you buy consumables and retail stock from."
            action={<Btn onClick={() => setAddOpen(true)}>+ Vendor</Btn>} />
        ) : (
          <DataTable cols={["Vendor", "Contact", "GSTIN", "City", "Rating", "Products", "Status"]}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((v) => [
              <B key={v._id}>{v.name}</B>,
              <span key={`${v._id}c`} className="text-[11.5px]">
                {v.contactPerson || "—"}
                {v.phone && <span className="block text-ink3">{v.phone}</span>}
              </span>,
              <span key={`${v._id}g`} className="font-mono text-[11.5px]">{v.gstNumber || "—"}</span>,
              v.city || "—",
              <Stars key={`${v._id}r`} n={Math.round(v.rating ?? 0)} />,
              v.productsSupplied ?? v.productsCount ?? 0,
              v.status === "Active" ? <Tag key={`${v._id}s`} kind="ok">Active</Tag> : <Tag key={`${v._id}s`} kind="mute">Inactive</Tag>,
            ])} />
        )}
      </Async>

      <VendorEditor open={!!sel || addOpen} vendor={sel}
        onClose={() => { setSel(null); setAddOpen(false); }}
        onSaved={() => { q.reload(); stats.reload(); setSel(null); setAddOpen(false); }}
        onDelete={(v) => { setSel(null); setDel(v); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `vendor "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.vendors.remove(del._id);
            audit("VENDOR_DELETED", `${del.name} · reason: ${reason}`, { vendorId: del._id });
            toast("Vendor deleted"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />

      <Note>
        Bank details are masked until you reveal them, and revealing writes an audit entry with your name — vendor
        payment fraud is an internal-actor risk, and the trail is the deterrent.
      </Note>
    </Page>
  );
}

function VendorEditor({ open, vendor, onClose, onSaved, onDelete }: {
  open: boolean; vendor: Vendor | null; onClose: () => void; onSaved: () => void; onDelete: (v: Vendor) => void;
}) {
  const { toast, audit, can } = useStore();
  const [f, setF] = useState<Partial<Vendor> & { bankDetails?: Record<string, string> }>({});
  const [showBank, setShowBank] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(vendor ?? { name: "", status: "Active", rating: 3 });
    setShowBank(false);
    setErr(null);
  }, [open, vendor?._id]);

  const set = <K extends keyof Vendor>(k: K) => (v: Vendor[K]) => setF((s) => ({ ...s, [k]: v }));
  const bank = (f.bankDetails ?? {}) as Record<string, string>;
  const setBank = (k: string) => (v: string) => setF((s) => ({ ...s, bankDetails: { ...(s.bankDetails ?? {}), [k]: v } }));
  const [bankBusy, setBankBusy] = useState(false);
  // The list never carries bank details; revealing fetches them through an
  // audited, admin-only endpoint.
  const reveal = async () => {
    if (showBank) { setShowBank(false); return; }
    if (!vendor) { setShowBank(true); return; }
    setBankBusy(true);
    try {
      const b = await api.vendors.bankDetails(vendor._id);
      setF((s) => ({ ...s, bankDetails: { ...(b ?? {}) } }));
      setShowBank(true);
    } catch (e) { setErr((e as Error).message); } finally { setBankBusy(false); }
  };

  const save = async () => {
    setErr(null);
    // These five are required by the Vendor model — check them here so the
    // user is told which field is missing instead of getting a server error.
    if (!f.name?.trim()) return setErr("A vendor name is required");
    if (!f.contactPerson?.trim()) return setErr("A contact person is required");
    if (!f.email?.trim()) return setErr("An email is required");
    if (!f.phone?.trim()) return setErr("A phone number is required");
    if (!f.address?.trim()) return setErr("An address is required");
    setBusy(true);
    try {
      // Bank details only travel when they were revealed (and so are real values).
      const { bankDetails, hasBankDetails, productsSupplied, productsCount, _id, createdAt, ...rest } = f as Vendor & { createdAt?: string };
      void hasBankDetails; void productsSupplied; void productsCount; void _id; void createdAt;
      const body = { ...rest, rating: Number(f.rating) || 0, ...(showBank && bankDetails ? { bankDetails } : {}) };
      if (vendor) {
        await api.vendors.update(vendor._id, body);
        audit("VENDOR_UPDATED", f.name, { vendorId: vendor._id });
        toast("Vendor saved");
      } else {
        const created = await api.vendors.create(body);
        audit("VENDOR_CREATED", `${created.name}${created.gstNumber ? ` · GST ${created.gstNumber}` : ""}`, { vendorId: created._id });
        toast(`${created.name} added`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={vendor ? vendor.name : "New vendor"}>
      <div className="grid gap-3">
        <In label="Vendor name *" value={f.name ?? ""} onChange={set("name")} />
        <In label="Contact person *" value={f.contactPerson ?? ""} onChange={set("contactPerson")} />
        <div className="grid grid-cols-2 gap-3">
          <In label="Email *" type="email" value={f.email ?? ""} onChange={set("email")} />
          <In label="Phone *" value={f.phone ?? ""} onChange={set("phone")} />
        </div>
        <In label="Address *" value={f.address ?? ""} onChange={set("address")} />
        <div className="grid grid-cols-3 gap-3">
          <In label="City" value={f.city ?? ""} onChange={set("city")} />
          <In label="State" value={f.state ?? ""} onChange={set("state")} />
          <In label="Pincode" value={f.pincode ?? ""} onChange={set("pincode")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <In label="GSTIN" value={f.gstNumber ?? ""} onChange={(v) => set("gstNumber")(v.toUpperCase())} />
          <In label="PAN" value={f.panNumber ?? ""} onChange={(v) => set("panNumber")(v.toUpperCase())} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Status" value={f.status ?? "Active"} onChange={(v) => set("status")(v as Vendor["status"])}
            options={["Active", "Inactive"]} />
          <In label="Rating (0–5)" type="number" value={String(f.rating ?? 0)} onChange={(v) => set("rating")(Math.min(5, Math.max(0, Number(v) || 0)))} />
        </div>

        <SecH t="Bank details" right={
          can("vendors.bank") ? <Btn kind="ghost" className="!py-1 !text-[11.5px]" disabled={bankBusy} onClick={reveal}>{bankBusy ? "…" : showBank ? "Hide" : "Reveal (audited)"}</Btn> : <Tag kind="mute">admin only</Tag>} />
        {showBank ? (
          <div className="grid gap-3">
            <In label="Account holder" value={bank.accountHolderName ?? ""} onChange={setBank("accountHolderName")} />
            <In label="Bank name" value={bank.bankName ?? ""} onChange={setBank("bankName")} />
            <div className="grid grid-cols-2 gap-3">
              <In label="Account number" value={bank.accountNumber ?? ""} onChange={setBank("accountNumber")} />
              <In label="IFSC" value={bank.ifscCode ?? ""} onChange={(v) => setBank("ifscCode")(v.toUpperCase())} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-ivory px-3.5 py-2.5 font-mono text-[12px] text-ink2">
            {vendor?.hasBankDetails ? "On file — reveal to view or edit. Every reveal is logged." : "No bank details on file."}
          </div>
        )}

        <Area label="Notes" value={f.notes ?? ""} onChange={set("notes")} rows={2} />

        {err && <Note kind="crit">{err}</Note>}
        {can("vendors.manage") ? (
          <div className="flex flex-wrap gap-2">
            <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : vendor ? "Save changes" : "Create vendor"}</Btn>
            {vendor && <Btn kind="danger" onClick={() => onDelete(vendor)}>Delete</Btn>}
          </div>
        ) : <Note kind="crit">Your role can view vendors but not change them.</Note>}
      </div>
    </Drawer>
  );
}
