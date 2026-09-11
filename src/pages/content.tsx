import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Page, Btn, Tag, Card, DataTable, B, Note, Hint, In, Sel, Area, Switch, SecH, Modal, Drawer,
  DeleteModal, Async, Empty, StaleBanner, exportCsv, Stats, Tabs,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryPage, useQueryString } from "../lib/useListState";
import { fmtDate, fmtWhen, fmtAgo } from "../lib/format";
import type { Banner, DeletedAccount, StockMovement } from "../lib/types";

/* =====================================================================
 * BANNERS — the app home carousel (Banner model, /api/banners)
 * =================================================================== */
const SCREENS = ["", "consultations", "treatments", "appointments", "orders", "profile", "offers"];

export function Banners() {
  const { toast, audit, can } = useStore();
  const [edit, setEdit] = useState<Banner | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Banner | null>(null);

  const q = useApi(() => api.banners.list(), []);
  const list = [...(q.data?.data ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]];
    try {
      await api.banners.reorder(next.map((b, k) => ({ id: b._id, order: k })));
      q.reload();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title="Banners" sub="The carousel at the top of the app's home screen — images or short videos, each with an optional link"
      actions={can("banners.manage") ? <Btn onClick={() => { setCreating(true); setEdit(null); }}>+ New banner</Btn> : undefined}>
      <Hint id="banners-live">Banners publish the moment they are saved. Order here is the order in the app; only active banners are shown.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading banners…" rows={4}>
        {() => list.length === 0 ? (
          <Empty title="No banners yet" hint="Add an image or a short video for the home carousel."
            action={can("banners.manage") ? <Btn onClick={() => setCreating(true)}>+ New banner</Btn> : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((b, i) => (
              <Card key={b._id} className="overflow-hidden">
                {b.mediaType === "video"
                  ? <video src={b.videoFile ?? b.videoUrl ?? undefined} muted playsInline className="h-36 w-full bg-black object-cover" />
                  : b.image ? <img src={b.image} alt="" className="h-36 w-full object-cover" /> : <div className="h-36 bg-sage" />}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-[13.5px] font-bold leading-tight">{b.title || "Untitled"}</b>
                    <Tag kind={b.isActive ? "ok" : "mute"}>{b.isActive ? "Live" : "Hidden"}</Tag>
                  </div>
                  <div className="mt-1 text-[11px] text-ink3">
                    {b.mediaType} · {b.linkType === "internal" ? `opens ${b.internalScreen}` : b.linkType === "external" ? "opens a link" : "no link"}
                  </div>
                  {can("banners.manage") && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-30">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-30">↓</button>
                      <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setEdit(b)}>Edit</Btn>
                      <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={async () => {
                        try { await api.banners.toggle(b._id); audit("APP_CUSTOMIZATION_UPDATED", `Banner ${b.title} ${b.isActive ? "hidden" : "shown"}`); q.reload(); }
                        catch (e) { toast((e as Error).message); }
                      }}>{b.isActive ? "Hide" : "Show"}</Btn>
                      <button onClick={() => setDel(b)} className="ml-auto text-[12px] font-bold text-err">Delete</button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Async>

      <BannerEditor open={creating || !!edit} banner={edit} onClose={() => { setCreating(false); setEdit(null); }}
        onSaved={() => { setCreating(false); setEdit(null); q.reload(); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `banner "${del.title}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.banners.remove(del._id);
            audit("APP_CUSTOMIZATION_UPDATED", `Removed banner ${del.title} · reason: ${reason}`);
            toast("Banner removed"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function BannerEditor({ open, banner, onClose, onSaved }: {
  open: boolean; banner: Banner | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast, audit } = useStore();
  const [f, setF] = useState<Partial<Banner>>({});
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(banner ?? { title: "", mediaType: "image", linkType: "none", internalScreen: "", externalUrl: "", isActive: true });
    setFile(null); setErr(null);
  }, [open, banner?._id]);

  const set = <K extends keyof Banner>(k: K) => (v: Banner[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setErr(null);
    if (!f.title?.trim()) return setErr("Give the banner a title (staff only — not shown in the app)");
    if (!banner && f.mediaType === "image" && !file) return setErr("Choose an image");
    if (!banner && f.mediaType === "video" && !file && !f.videoUrl?.trim()) return setErr("Upload a video file or paste a video URL");
    if (f.linkType === "external" && !f.externalUrl?.trim()) return setErr("Enter the link to open");
    if (f.linkType === "internal" && !f.internalScreen) return setErr("Pick the app screen to open");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("title", f.title.trim());
      form.append("mediaType", f.mediaType ?? "image");
      form.append("linkType", f.linkType ?? "none");
      form.append("internalScreen", f.internalScreen ?? "");
      form.append("externalUrl", f.externalUrl ?? "");
      if (f.videoUrl) form.append("videoUrl", f.videoUrl);
      if (banner) form.append("isActive", String(!!f.isActive));
      if (file) form.append("image", file);
      if (banner) {
        await api.banners.update(banner._id, form);
        audit("APP_CUSTOMIZATION_UPDATED", `Banner ${f.title} updated`);
        toast("Banner saved — live in the app");
      } else {
        await api.banners.create(form);
        audit("APP_CUSTOMIZATION_UPDATED", `Banner ${f.title} added`);
        toast("Banner published");
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={banner ? `Edit banner` : "New banner"}>
      <div className="grid gap-3">
        <In label="Title (for staff)" value={f.title ?? ""} onChange={set("title")} />
        <Sel label="Media" value={f.mediaType ?? "image"} onChange={(v) => set("mediaType")(v as Banner["mediaType"])} options={["image", "video"]} />
        <div>
          <label className="text-[11px] font-bold text-ink2">{f.mediaType === "video" ? "Video file (MP4, under 50 MB)" : "Image (1600×900 recommended)"}</label>
          <input type="file" accept={f.mediaType === "video" ? "video/mp4,video/quicktime,video/webm" : "image/*"}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-[12px]" />
          {banner && !file && (banner.image || banner.videoFile) && <div className="mt-1 text-[10.5px] text-ink3">Leave empty to keep the current file.</div>}
        </div>
        {f.mediaType === "video" && <In label="…or a video URL" value={f.videoUrl ?? ""} onChange={set("videoUrl")} placeholder="https://…/clip.mp4" />}
        <Sel label="Tapping the banner" value={f.linkType ?? "none"} onChange={(v) => set("linkType")(v as Banner["linkType"])} options={["none", "internal", "external"]} />
        {f.linkType === "internal" && (
          <Sel label="Opens the app screen" value={f.internalScreen ?? ""} onChange={set("internalScreen")} options={SCREENS} />
        )}
        {f.linkType === "external" && <In label="Opens the link" value={f.externalUrl ?? ""} onChange={set("externalUrl")} placeholder="https://" />}
        {banner && <Switch on={!!f.isActive} onChange={set("isActive")} label="Live in the app" />}
      </div>
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={save}>{busy ? "Uploading…" : banner ? "Save" : "Publish"}</Btn>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * LEGAL — terms of service & privacy policy (AppCustomization root fields)
 * =================================================================== */
export function LegalEditor() {
  const { toast, audit, can } = useStore();
  const q = useApi(() => api.appStudio.get(), []);
  const [terms, setTerms] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setTerms(q.data.termsOfService ?? "");
    setPrivacy(q.data.privacyPolicy ?? "");
  }, [q.data]);

  const dirty = !!q.data && (terms !== (q.data.termsOfService ?? "") || privacy !== (q.data.privacyPolicy ?? ""));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      // Only the two documents — never the whole record back.
      await api.appStudio.update({ termsOfService: terms, privacyPolicy: privacy });
      audit("APP_CUSTOMIZATION_UPDATED", "Legal documents");
      toast("Published — the app shows the new text on next open");
      q.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="Terms & privacy" sub="The legal documents the app shows under Profile and at sign-up"
      actions={can("appContent.manage") ? <Btn kind="gold" disabled={!dirty || busy} onClick={save}>{busy ? "Publishing…" : "Publish"}</Btn> : undefined}>
      <Hint id="legal-live">Plain text. Start a section with a numbered heading on its own line ("1. INFORMATION WE COLLECT"), sub-sections as "1.1 Personal Information", and keep a "Last Updated:" line at the top — the app formats those.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading documents…" rows={6}>
        {() => (
          <>
            <Tabs active={tab} onChange={setTab} items={[["Terms of service"], ["Privacy policy"]]} />
            <Card className="p-4">
              {tab === 0
                ? <Area label="Terms of service" value={terms} onChange={setTerms} rows={28} />
                : <Area label="Privacy policy" value={privacy} onChange={setPrivacy} rows={28} />}
              <div className="mt-2 text-[11px] text-ink3">{(tab === 0 ? terms : privacy).length.toLocaleString("en-IN")} characters</div>
            </Card>
            {err && <Note kind="crit">{err}</Note>}
          </>
        )}
      </Async>
    </Page>
  );
}

/* =====================================================================
 * DELETED ACCOUNTS — restorable archive
 * =================================================================== */
export function DeletedAccounts() {
  const { toast, audit, can } = useStore();
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [showRestored, setShowRestored] = useState(false);
  const debounced = useDebounced(search);
  const [sel, setSel] = useState<DeletedAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useApi(() => api.patients.deleted({ search: debounced || undefined, includeRestored: showRestored ? "true" : undefined }), [debounced, showRestored]);
  const rows = q.data?.data ?? [];

  const restore = async (a: DeletedAccount) => {
    setBusy(true);
    try {
      const r = await api.patients.restore(a._id);
      audit("USER_ACTIVATED", `Restored deleted account ${a.email ?? a.phone ?? a._id}`, { archiveId: a._id });
      toast(`${a.fullName ?? "Account"} restored`);
      setSel(null); q.reload();
      if (r?.userId) nav("/patient", { state: { id: r.userId } });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="Deleted accounts" sub="Guests who deleted their account from the app, kept in full so they can be brought back"
      actions={<Btn kind="ghost" onClick={() => setShowRestored((v) => !v)}>{showRestored ? "Hide restored" : "Show restored too"}</Btn>}>
      <Hint id="deleted-accounts">Deleting an account removes the person from every live screen, but their bookings, orders, forms and chats are archived here. Restore puts everything back exactly as it was — unless the same email or phone has since signed up again.</Hint>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone or guest ID…"
        className="mb-3 w-full max-w-[420px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading archive…" rows={5}>
        {() => rows.length === 0 ? (
          <Empty title="No deleted accounts" hint={debounced ? `Nothing matched “${debounced}”.` : "Nobody has deleted their account."} />
        ) : (
          <DataTable cols={["Guest", "Contact", "Deleted", "By", "Records", "Status"]}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((a) => [
              <B key={a._id}>{a.fullName ?? "—"}{a.patientId ? <span className="ml-1.5 font-mono text-[10px] text-ink3">{a.patientId}</span> : null}</B>,
              <span key={`${a._id}c`} className="text-[12px]">{a.email ?? "—"}<br /><span className="text-ink3">{a.phone ?? ""}</span></span>,
              <span key={`${a._id}d`}>{fmtWhen(a.deletedAt)}<br /><span className="text-[11px] text-ink3">{fmtAgo(a.deletedAt)} ago</span></span>,
              a.deletedBy === "admin" ? "Staff" : "Guest (app)",
              Object.entries(a.counts ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" · ") || "—",
              a.restoredAt ? <Tag key={`${a._id}s`} kind="ok">Restored {fmtDate(a.restoredAt)}</Tag> : <Tag key={`${a._id}s`} kind="mute">Archived</Tag>,
            ])} />
        )}
      </Async>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.fullName ?? "Deleted account"}>
        {sel && (
          <>
            <div className="grid gap-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-ink3">Email</span><span>{sel.email ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-ink3">Phone</span><span>{sel.phone ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-ink3">Deleted</span><span>{fmtWhen(sel.deletedAt)}</span></div>
              <div className="flex justify-between"><span className="text-ink3">By</span><span>{sel.deletedBy === "admin" ? "Staff" : "The guest, from the app"}</span></div>
              {sel.reason && <div className="flex justify-between"><span className="text-ink3">Reason</span><span className="text-right">{sel.reason}</span></div>}
            </div>
            <SecH t="Archived with the account" />
            <div className="grid gap-1 text-[12px]">
              {Object.entries(sel.counts ?? {}).filter(([, n]) => n > 0).map(([k, n]) => (
                <div key={k} className="flex justify-between border-b border-border py-1"><span className="capitalize text-ink3">{k}</span><B>{n}</B></div>
              ))}
              {!Object.values(sel.counts ?? {}).some((n) => n > 0) && <div className="text-ink3">Only the profile itself.</div>}
            </div>
            {sel.restoredAt ? (
              <Note className="mt-3">Restored on {fmtWhen(sel.restoredAt)}.</Note>
            ) : can("patients.delete") ? (
              <>
                <Note className="mt-3"><B>Restoring</B> re-creates the login and every archived record. The guest can sign in again with the same email and phone.</Note>
                <Btn kind="gold" className="w-full" disabled={busy} onClick={() => restore(sel)}>{busy ? "Restoring…" : "Restore this account"}</Btn>
              </>
            ) : (
              <Note className="mt-3">Only an admin can restore an account.</Note>
            )}
          </>
        )}
      </Drawer>
    </Page>
  );
}

/* =====================================================================
 * STOCK LEDGER — every movement, newest first
 * =================================================================== */
const MOVE_TYPES = ["all", "consume", "wastage", "receive", "adjust", "sale", "return"];

export function StockLedger() {
  const [type, setType] = useQueryString("type", "all");
  const [page, setPage] = useQueryPage();
  const q = useApi(() => api.inventory.movements({ type: type === "all" ? undefined : type, page, limit: 15 }), [type, page]);
  const rows = q.data?.data ?? [];
  const pag = (q.data as { pagination?: { totalPages?: number; total?: number } } | undefined)?.pagination;

  const tone = (t: StockMovement["type"]) => (t === "receive" || t === "return" ? "ok" : t === "wastage" ? "err" : t === "consume" || t === "sale" ? "info" : "warn");
  const sum = (tt: StockMovement["type"]) => rows.filter((r) => r.type === tt).reduce((a, r) => a + Math.abs(r.delta), 0);

  return (
    <Page title="Stock ledger" sub="Every change to a quantity, with who, when and why — the answer to “where did it go?”"
      actions={<Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv("zennara-stock-ledger",
        ["When", "Item", "Batch", "Type", "Change", "Before", "After", "Reason", "By"],
        rows.map((r) => [fmtWhen(r.createdAt), r.inventoryName ?? "", r.batchNo ?? "", r.type, r.delta, r.before, r.after, r.reason ?? "", r.adminEmail ?? ""]))}>Export CSV</Btn>}>
      <Hint id="stock-ledger">Sessions on the floor write “consume” and “wastage” rows; edits on the Inventory page write “receive” or “adjust”. Nothing here can be edited — correct a mistake with a new adjustment.</Hint>
      <div className="mb-3 flex overflow-hidden rounded-(--radius-btn) border border-border">
        {MOVE_TYPES.map((t) => (
          <button key={t} onClick={() => { setType(t); setPage(1); }}
            className={`px-3 py-2 text-[12px] font-bold capitalize ${type === t ? "bg-primary text-white" : "bg-surface text-ink2"}`}>{t}</button>
        ))}
      </div>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading ledger…" rows={6}>
        {() => (
          <>
            <Stats items={[
              { k: "Consumed", v: sum("consume"), d: "units on this page" },
              { k: "Wasted", v: sum("wastage"), d: "units", hot: sum("wastage") > 0 },
              { k: "Received", v: sum("receive"), d: "units" },
              { k: "Adjusted", v: sum("adjust"), d: "units" },
            ]} />
            {rows.length === 0 ? <Empty title="No movements yet" hint="Stock changes appear here as they happen." /> : (
              <DataTable cols={["When", "Item", "Type", "Change", "Level", "Reason", "By"]}
                rows={rows.map((r) => [
                  <span key={r._id}>{fmtWhen(r.createdAt)}</span>,
                  <span key={`${r._id}i`}><B>{r.inventoryName ?? r.inventoryId}</B>{r.batchNo ? <span className="ml-1 font-mono text-[10px] text-ink3">{r.batchNo}</span> : null}</span>,
                  <Tag key={`${r._id}t`} kind={tone(r.type)}>{r.type}</Tag>,
                  <span key={`${r._id}d`} className={`font-mono ${r.delta < 0 ? "text-err" : "text-ok"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</span>,
                  <span key={`${r._id}l`} className="font-mono text-ink3">{r.before} → {r.after}</span>,
                  r.reason || "—",
                  r.adminEmail || "—",
                ])} />
            )}
            {pag && (pag.totalPages ?? 1) > 1 && (
              <div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-ink3">
                <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
                <span>Page {page} of {pag.totalPages}</span>
                <Btn kind="ghost" disabled={page >= (pag.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Btn>
              </div>
            )}
          </>
        )}
      </Async>
    </Page>
  );
}
