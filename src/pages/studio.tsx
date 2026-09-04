import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Page, Btn, Tag, Card, DataTable, B, Note, Hint, In, Sel, Area, SecH, Modal, Tabs,
  Async, Empty, Loading, StaleBanner, Spinner, DeleteModal, Toggle,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { ADVANCED_COLOR_TOKENS, COLOR_TOKENS, CONTROL_COLOR_TOKENS, COPY_GROUPS, FONT_SIZE_TOKENS } from "../lib/appDesignCatalog";
import { useApi } from "../lib/useApi";
import { useQueryNumber } from "../lib/useListState";
import { fmtAgo, fmtDateFull, fmtINR } from "../lib/format";
import type { AppCustomization } from "../lib/types";

/* Every studio screen edits the same AppCustomization document, so they share
   one loader, one save path and one "unsaved changes" state. */
type Draft = AppCustomization;

/*
 * The sections `save` is allowed to send back.
 *
 * `membership` was missing, so nothing on the Zen membership card ever
 * persisted — pick() dropped it before the request, and the editor looked like
 * it had saved because the draft state kept the value until a reload. The
 * benefits list had the same problem. Anything editable on a studio screen has
 * to be listed here or it is silently discarded.
 */
const EDITABLE = [
  "appLogo", "homeScreen", "consultationsScreen", "appointmentsScreen",
  "productsScreen", "profileScreen", "membership", "termsOfService", "privacyPolicy",
] as const;
const pick = (d: Draft): Draft => {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (d[k] !== undefined) out[k] = d[k];
  // Media lists are managed by their own endpoints; don't round-trip them.
  if (out.homeScreen) {
    const { reelVideos, consultationCategoryCards, ...rest } = out.homeScreen as Record<string, unknown>;
    void reelVideos; void consultationCategoryCards;
    out.homeScreen = rest;
  }
  return out as Draft;
};

function useCustomization() {
  const { can } = useStore();
  // Every App Studio screen is revealed by `appStudio.view` so a role can see
  // what the app is showing; changing it is `appStudio.manage`. One flag here
  // keeps that split consistent across all four editors.
  const canEdit = can("appStudio.manage");
  const q = useApi(() => api.appStudio.get(), []);
  const prevServer = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A reload (after an upload, say) must not wipe text the admin is still
  // typing: keep the draft's pending edits and take the server's copy of
  // everything else.
  useEffect(() => {
    if (!q.data) return;
    setDraft((d) => {
      if (!d || !prevServer.current) return q.data!;
      const merged: Draft = { ...q.data! };
      for (const key of EDITABLE) {
        const was = JSON.stringify(prevServer.current[key] ?? null);
        const now = JSON.stringify(d[key] ?? null);
        if (was !== now && key !== "homeScreen") (merged as Record<string, unknown>)[key] = d[key];
        if (key === "homeScreen") {
          const srvHome = (q.data!.homeScreen ?? {}) as Record<string, unknown>;
          const oldHome = (prevServer.current.homeScreen ?? {}) as Record<string, unknown>;
          const draftHome = (d.homeScreen ?? {}) as Record<string, unknown>;
          const out: Record<string, unknown> = { ...srvHome };
          for (const k of Object.keys(draftHome)) {
            if (JSON.stringify(draftHome[k]) !== JSON.stringify(oldHome[k])) out[k] = draftHome[k];
          }
          merged.homeScreen = out;
        }
      }
      return merged;
    });
    prevServer.current = q.data;
  }, [q.data]);

  const dirty = !!draft && !!q.data && JSON.stringify(pick(draft)) !== JSON.stringify(pick(q.data));

  const save = async (onDone?: () => void) => {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      // Only the editable sections — never _id/version/timestamps back to the server.
      await api.appStudio.update(pick(draft));
      q.reload();
      onDone?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  /** Set a nested field, e.g. section("homeScreen")("heroBannerRoute")("products"). */
  const section = (name: keyof Draft) => (key: string) => (value: unknown) =>
    setDraft((d) => (d ? { ...d, [name]: { ...((d[name] as Record<string, unknown>) ?? {}), [key]: value } } : d));

  const get = (name: keyof Draft, key: string, fallback = "") =>
    String(((draft?.[name] as Record<string, unknown>) ?? {})[key] ?? fallback);

  return { q, draft, setDraft, dirty, save, busy, err, section, get, canEdit };
}

function SaveBar({ dirty, busy, err, onSave, onReset, canEdit = true }: {
  dirty: boolean; busy: boolean; err: string | null; onSave: () => void; onReset: () => void; canEdit?: boolean;
}) {
  if (err) return <Note kind="crit">{err}</Note>;
  if (!canEdit) {
    return <Note className="mb-3">You can see what the app is showing, but publishing changes needs the “edit app home, control &amp; content” permission.</Note>;
  }
  if (!dirty) return null;
  return (
    <div className="sticky top-[52px] z-30 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-gold-dark bg-cream px-4 py-2.5">
      <span className="text-[12.5px] font-semibold text-ink2">You have unsaved changes — the app won’t see them until you publish.</span>
      <div className="flex gap-2">
        <Btn kind="ghost" onClick={onReset}>Discard</Btn>
        <Btn kind="gold" disabled={busy} onClick={onSave}>{busy ? "Publishing…" : "Publish to app"}</Btn>
      </div>
    </div>
  );
}

/* ---------- image field with upload ---------- */
function ImageField({ label, value, onChange, uploadAs, onUploaded, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  uploadAs?: "appLogo" | "heroBanner" | "zenMembershipCard";
  onUploaded?: () => void; hint?: string;
}) {
  const { toast } = useStore();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-2">
      <In label={label} value={value} onChange={onChange} hint={hint} />
      {value && <img src={value} alt="" className="h-28 w-full rounded-xl border border-border object-cover" />}
      {uploadAs && (
        <>
          <Btn kind="ghost" disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? "Uploading…" : "Upload a new image"}
          </Btn>
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              await api.appStudio.uploadImage(uploadAs, file);
              toast("Image uploaded and published");
              onUploaded?.();
            } catch (err) { toast((err as Error).message); } finally { setBusy(false); e.target.value = ""; }
          }} />
          <div className="text-[10.5px] text-ink3">Uploading replaces the image and publishes it immediately.</div>
        </>
      )}
    </div>
  );
}

type ReelVideo = { _id?: string; url: string; poster?: string; permalink?: string; title?: string };

/* ---------- reel video uploader ---------- */
function ReelUploader({ onAdded }: { onAdded: () => void }) {
  const { toast } = useStore();
  const videoRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const [permalink, setPermalink] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!video) { toast("Choose the reel's video file first"); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("video", video);
      if (poster) form.append("poster", poster);
      form.append("permalink", permalink.trim());
      form.append("title", title.trim());
      await api.appStudio.addReelVideo(form);
      toast("Reel uploaded and published");
      setVideo(null); setPoster(null); setPermalink(""); setTitle("");
      onAdded();
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
      <div className="grid gap-2 md:grid-cols-2">
        <In label="Title (optional)" value={title} onChange={setTitle} />
        <In label="Instagram link (optional)" value={permalink} onChange={setPermalink} placeholder="https://www.instagram.com/reel/…" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="ghost" onClick={() => videoRef.current?.click()}>{video ? `Video: ${video.name}` : "Choose video (MP4)"}</Btn>
        <Btn kind="ghost" onClick={() => posterRef.current?.click()}>{poster ? `Poster: ${poster.name}` : "Poster image (optional)"}</Btn>
        <Btn kind="gold" disabled={!video || busy} onClick={submit}>{busy ? "Uploading…" : "Upload reel"}</Btn>
      </div>
      <input ref={videoRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
        onChange={(e) => { setVideo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <input ref={posterRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { setPoster(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}

/* ================= APP HOME ================= */
export function AppHome() {
  const { toast, audit } = useStore();
  const c = useCustomization();
  const [cardOpen, setCardOpen] = useState(false);
  const [delCard, setDelCard] = useState<{ _id?: string; categoryName: string } | null>(null);

  const home = () => ((c.draft?.homeScreen ?? {}) as Record<string, unknown>);
  const setHome = c.section("homeScreen");
  const cards = (home().consultationCategoryCards ?? []) as { _id?: string; image: string; categoryName: string; searchTerm: string; displayOrder?: number }[];
  const reelVideos = (home().reelVideos ?? []) as ReelVideo[];
  const [delReel, setDelReel] = useState<ReelVideo | null>(null);
  const [editCard, setEditCard] = useState<{ _id?: string; image: string; categoryName: string; searchTerm: string; displayOrder?: number } | null>(null);

  const moveCard = async (i: number, dir: -1 | 1) => {
    const sorted = [...cards].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const j = i + dir; if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    try {
      await Promise.all(sorted.map((card, k) => {
        if (!card._id) return Promise.resolve();
        const form = new FormData(); form.append("displayOrder", String(k + 1));
        return api.appStudio.updateConsultationCard(card._id, form);
      }));
      c.q.reload();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title="App home" sub="The mobile app's home screen — published without an app release"
      actions={
        <Btn kind="gold" disabled={!c.dirty || c.busy}
          onClick={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "App home"); toast("Published — live in the app now"); })}>
          {c.busy ? "Publishing…" : "Publish"}
        </Btn>
      }>
      <Hint id="studio-live">Every field here writes to the app-customization record the mobile app reads on launch.</Hint>
      <StaleBanner error={c.q.data ? c.q.error : null} onRetry={c.q.reload} />

      <Async q={c.q} label="Loading app settings…" rows={6}>
        {() => !c.draft ? <Loading /> : (
          <>
            <SaveBar canEdit={c.canEdit} dirty={c.dirty} busy={c.busy} err={c.err}
              onSave={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "App home"); toast("Published"); })}
              onReset={() => c.setDraft(c.q.data ?? null)} />

            <div className="grid items-start gap-4">
              <div className="grid gap-3">
                <Card className="p-4">
                  <SecH t="Branding" />
                  <ImageField label="App logo URL" value={c.draft.appLogo ?? ""}
                    onChange={(v) => c.setDraft((d) => (d ? { ...d, appLogo: v } : d))}
                    uploadAs="appLogo" onUploaded={c.q.reload} />
                </Card>


                <Card className="p-4">
                  <SecH t="Home sections" em="· order & visibility" />
                  <Note className="text-[11.5px]">The home page is built from these sections, top to bottom, exactly as the new layout renders them. Hide or reorder any of them — the greeting always stays on top.</Note>
                  <HomeSectionsEditor value={(home().sections as { id: string; visible?: boolean }[] | undefined) ?? []} onChange={setHome("sections")} />
                </Card>

                <Card className="p-4">
                  <SecH t="Hero banner" />
                  <ImageField label="Hero banner image URL" value={String(home().heroBannerImage ?? "")}
                    onChange={setHome("heroBannerImage")} uploadAs="heroBanner" onUploaded={c.q.reload} />
                  <div className="mt-3">
                    <Sel label="Tapping the banner opens" value={String(home().heroBannerRoute ?? "consultations")}
                      onChange={setHome("heroBannerRoute")}
                      options={["consultations", "products", "appointments", "profile"]} />
                  </div>
                  <Note className="mb-0 text-[11.5px]">
                    <B>Destinations are a validated list, not free-text.</B> An admin cannot point the banner at a page that does not exist.
                  </Note>
                </Card>

                <Card className="p-4">
                  <SecH t="Clinic reels" em={`· ${reelVideos.length} uploaded`} />
                  <Note className="text-[11.5px]">
                    <B>Upload the reel's video file</B> (MP4, under 50 MB) and the app plays it natively — an
                    Instagram embed inside the app cannot be relied on to play on iPhone. Paste the reel's
                    Instagram link too so "View on Instagram" still works. Newest first.
                  </Note>
                  {c.canEdit && <ReelUploader onAdded={c.q.reload} />}
                  {reelVideos.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {reelVideos.map((r, i) => (
                        <div key={r._id ?? i} className="flex items-center gap-2.5 rounded-lg border border-border bg-ivory px-3 py-2">
                          {r.poster
                            ? <img src={r.poster} alt="" className="h-[42px] w-[30px] shrink-0 rounded object-cover" />
                            : <video src={r.url} muted playsInline className="h-[42px] w-[30px] shrink-0 rounded bg-black object-cover" />}
                          <div className="min-w-0 flex-1">
                            <b className="truncate text-[12.5px]">{r.title || `Reel ${reelVideos.length - i}`}</b>
                            <div className={`truncate text-[10.5px] ${r.permalink ? "text-ink3" : "font-semibold text-warn"}`}>{r.permalink || "No Instagram link — 'View on Instagram' hidden for this reel"}</div>
                          </div>
                          {c.canEdit && (
                            <button onClick={() => { const link = window.prompt("Instagram link for this reel (instagram.com URL, empty to remove):", r.permalink ?? ""); if (link === null || !r._id) return; api.appStudio.updateReelVideo(r._id, { permalink: link.trim() }).then(() => { toast("Reel link saved"); c.q.reload(); }).catch((e) => toast((e as Error).message)); }}
                              className="text-[11.5px] font-semibold text-primary">{r.permalink ? "Edit link" : "Add link"}</button>
                          )}
                          {c.canEdit && <button onClick={() => setDelReel(r)} className="text-[12px] font-bold text-err">×</button>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4">
                    <Area label="Instagram reel links (fallback, one per line)" rows={3}
                      value={((home().reels as string[] | undefined) ?? []).join("\n")}
                      onChange={(v) => setHome("reels")(v.split(/\n+/).map((x) => x.trim()).filter(Boolean))} />
                    <div className="mt-1 text-[10.5px] text-ink3">
                      Used only when no video has been uploaded. Embeds may not play on iPhone.
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <SecH t="Quick actions" em="· the four tiles under the banner" />
                  <QuickActionsEditor value={(home().quickActions as { label: string; image?: string; route?: string; visible?: boolean }[] | undefined) ?? []} onChange={setHome("quickActions")} />
                </Card>

                <Card className="p-4">
                  <SecH t="Reviews — celebrity & press quotes" em={`· ${((home().testimonials as unknown[] | undefined) ?? []).length || "bundled"}`} />
                  <Note className="text-[11.5px]">Shown in the reviews carousel with the five gold stars. Leave empty to keep the bundled celebrity set. Headings for this section live under <B>App control → Copy → Home</B>.</Note>
                  <TestimonialsEditor value={(home().testimonials as { name: string; role?: string; quote: string; image?: string }[] | undefined) ?? []} onChange={setHome("testimonials")} />
                </Card>

                <Card className="p-4">
                  <SecH t="Instagram" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <In label="Handle" value={String(home().instagramHandle ?? "")} onChange={setHome("instagramHandle")} placeholder="@zennaraclinics" />
                    <In label="Profile URL" value={String(home().instagramUrl ?? "")} onChange={setHome("instagramUrl")} placeholder="https://www.instagram.com/zennaraclinics/" />
                  </div>
                  <Note className="mb-0 text-[11.5px]">The "Follow us" rail and every "View on Instagram" link use these. Wording lives under <B>App control → Copy → Home</B>.</Note>
                </Card>

                <Note>
                  Every heading, subtitle and button on the home page — the greeting, the booking prompt, the products rail, the reviews headings and the Instagram card — is editable under <B>App studio → App control → Copy</B>. Colours and type sizes live in <B>App control</B> too.
                </Note>
              </div>
            </div>
          </>
        )}
      </Async>

      <AddCardModal open={cardOpen || !!editCard} card={editCard} onClose={() => { setCardOpen(false); setEditCard(null); }} onAdded={() => { c.q.reload(); setCardOpen(false); setEditCard(null); }} />

      <DeleteModal open={!!delCard} onClose={() => setDelCard(null)}
        what={delCard ? `category card "${delCard.categoryName}"` : ""}
        onConfirm={async (reason) => {
          if (!delCard?._id) { toast("This card has no id yet — publish first, then delete."); return; }
          try {
            await api.appStudio.deleteConsultationCard(delCard._id);
            audit("APP_CUSTOMIZATION_UPDATED", `Removed card ${delCard.categoryName} · reason: ${reason}`);
            toast("Card removed"); c.q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />

      <DeleteModal open={!!delReel} onClose={() => setDelReel(null)}
        what={delReel ? `reel "${delReel.title || delReel.permalink || "video"}"` : ""}
        onConfirm={async (reason) => {
          if (!delReel?._id) return;
          try {
            await api.appStudio.deleteReelVideo(delReel._id);
            audit("APP_CUSTOMIZATION_UPDATED", `Removed reel ${delReel.title || delReel.url} · reason: ${reason}`);
            toast("Reel removed"); setDelReel(null); c.q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Page>
  );
}

function AddCardModal({ open, card, onClose, onAdded }: {
  open: boolean; card?: { _id?: string; image: string; categoryName: string; searchTerm: string; displayOrder?: number } | null;
  onClose: () => void; onAdded: () => void;
}) {
  const { toast, audit } = useStore();
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [order, setOrder] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(card?.categoryName ?? ""); setTerm(card?.searchTerm ?? ""); setOrder(card?.displayOrder ? String(card.displayOrder) : "");
    setFile(null); setErr(null);
  }, [open, card?._id]);

  return (
    <Modal open={open} onClose={onClose} title={card ? `Edit card ${card.categoryName}` : "Add category card"}>
      <div className="grid gap-3">
        <In label="Card label" value={name} onChange={(v) => { setName(v); if (!term) setTerm(v); }} placeholder="Skin" />
        <In label="Search term the card runs" value={term} onChange={setTerm}
          hint="Tapping the card searches the catalogue for this term" />
        <In label="Display order (optional)" type="number" value={order} onChange={setOrder} />
        <div>
          <div className="mb-1 text-[11px] font-bold text-ink2">Card image</div>
          <button onClick={() => ref.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border bg-ivory px-4 py-5 text-center text-[12.5px] text-ink3 hover:border-gold-dark">
            {file ? <b className="text-ink2">{file.name}</b> : card?.image ? <>Current image kept — click to replace</> : <>Click to choose an image<br />JPG · PNG</>}
          </button>
          <input ref={ref} type="file" accept="image/*" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy || !name.trim() || !term.trim() || (!file && !card)} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const form = new FormData();
            if (file) form.append("image", file);
            form.append("categoryName", name.trim());
            form.append("searchTerm", term.trim());
            if (order) form.append("displayOrder", order);
            if (card?._id) {
              await api.appStudio.updateConsultationCard(card._id, form);
              audit("APP_CUSTOMIZATION_UPDATED", `Updated category card ${name.trim()}`);
              toast("Card saved and published");
            } else {
              await api.appStudio.addConsultationCard(form);
              audit("APP_CUSTOMIZATION_UPDATED", `Added category card ${name.trim()}`);
              toast("Card added and published");
            }
            onAdded();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : card ? "Save card" : "Add card"}</Btn>
      </div>
    </Modal>
  );
}

/* ================= CONSULTATION PAGE ================= */
export function ConsultPage() {
  const nav = useNavigate();
  const { toast, audit } = useStore();
  const c = useCustomization();
  const setScreen = c.section("consultationsScreen");
  const screen = () => ((c.draft?.consultationsScreen ?? {}) as Record<string, unknown>);

  const doctors = useApi(() => api.doctors.list(), []);
  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);

  return (
    <Page title="Consultation page" sub="The app's consultation screen — copy, tiers and the dermatologists it lists"
      actions={
        <Btn kind="gold" disabled={!c.dirty || c.busy}
          onClick={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Consultation screen"); toast("Published"); })}>
          {c.busy ? "Publishing…" : "Publish"}
        </Btn>
      }>
      <Hint id="consultpage-live">A guest taps <B>Consultation</B> → picks a tier → picks a dermatologist → picks a slot. The copy on this screen is editable here; the tiers and doctors come from the Dermatologists module, so there is one source of truth.</Hint>

      <Async q={c.q} label="Loading screen settings…" rows={4}>
        {() => !c.draft ? <Loading /> : (
          <>
            <SaveBar canEdit={c.canEdit} dirty={c.dirty} busy={c.busy} err={c.err}
              onSave={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Consultation screen"); toast("Published"); })}
              onReset={() => c.setDraft(c.q.data ?? null)} />

            <div className="grid gap-3 xl:grid-cols-2">
              <Card className="p-4">
                <SecH t="Screen copy" />
                <div className="grid gap-3">
                  <In label="Heading" value={String(screen().heading ?? "")} onChange={setScreen("heading")} />
                  <Area label="Sub-heading" value={String(screen().subHeading ?? "")} onChange={setScreen("subHeading")} rows={2} />
                  <In label="Search bar placeholder" value={String(screen().searchbarPlaceholder ?? "")} onChange={setScreen("searchbarPlaceholder")} />
                </div>
              </Card>

              <Card className="p-4">
                <SecH t="Consultation tiers" em="· fees the app charges" right={
                  <Btn kind="ghost" className="!py-1 !text-[12px]" onClick={() => nav("/doctors")}>Edit in Doctors ↗</Btn>} />
                <Async q={tiers} label="Loading tiers…" rows={2}>
                  {(list) => list.length === 0 ? (
                    <Empty title="No tiers configured" hint="Seed them with `node scripts/seedDoctors.js` in the Backend folder." />
                  ) : (
                    <DataTable cols={["Tier", "Fee", "Dermatologists"]} rows={list.map((t) => [
                      <B key={t.id}>{t.title}</B>,
                      fmtINR(t.fee),
                      (doctors.data?.data ?? []).filter((d) => d.tier === t.id).map((d) => d.name).join(", ") || "—",
                    ])} />
                  )}
                </Async>
              </Card>

              <Card className="p-4 xl:col-span-2">
                <SecH t="Dermatologists listed in the app" em="· inherited from the Dermatologists module" right={
                  <Btn kind="ghost" className="!py-1 !text-[12px]" onClick={() => nav("/doctors")}>Manage doctors ↗</Btn>} />
                <Async q={doctors} label="Loading doctors…" rows={4}>
                  {(res) => (res.data ?? []).length === 0 ? (
                    <Empty title="No dermatologists listed" hint="Add the team under Care → Dermatologists." />
                  ) : (
                    <div className="grid gap-1.5 md:grid-cols-2">
                      {(res.data ?? []).map((d) => (
                        <div key={d._id} className="flex items-center gap-3 rounded-lg border border-border bg-ivory px-3 py-2">
                          {d.photo
                            ? <img src={d.photo} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                            : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sage text-[11px] font-extrabold text-primary">
                                {d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                              </span>}
                          <div className="min-w-0 flex-1">
                            <b className="block truncate text-[12.5px]">{d.name}</b>
                            <div className="truncate text-[10.5px] text-ink3">
                              {d.designation ?? d.tier}
                              {d.availableCentres?.length ? ` · ${d.availableCentres.join(", ")}` : ""}
                            </div>
                          </div>
                          <Tag kind={d.isActive ? "ok" : "mute"}>{d.isActive ? "Live" : "Hidden"}</Tag>
                        </div>
                      ))}
                    </div>
                  )}
                </Async>
                <Note className="mb-0 text-[11.5px]">
                  Fees, centres and visibility flow from the <B>Dermatologists</B> module — one source of truth, nothing duplicated here.
                </Note>
              </Card>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}

/* ================= MEMBERSHIP CARD ================= */
export function MembershipCard() {
  const { toast, audit, can } = useStore();
  const c = useCustomization();
  const setHome = c.section("homeScreen");
  const home = () => ((c.draft?.homeScreen ?? {}) as Record<string, unknown>);
  // The membership block lives under its own key, so it gets its own accessors
  // rather than being threaded through homeScreen.
  const setMem = c.section("membership");
  const mem = () => ((c.draft?.membership ?? {}) as Record<string, unknown>);

  // Member counts are a nicety on this editor, and the endpoint belongs to the
  // Analytics page. Ask only when the account may actually read it, so a
  // content-only role does not generate a denial on every visit.
  const members = useApi(() => (can("analytics.view") ? api.analytics.patients().catch(() => undefined) : Promise.resolve(undefined)), []);

  return (
    <Page title="Zen membership card" sub="The membership card as guests see it on the app's home screen"
      actions={
        <Btn kind="gold" disabled={!c.dirty || c.busy}
          onClick={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Membership card"); toast("Published"); })}>
          {c.busy ? "Publishing…" : "Publish"}
        </Btn>
      }>
      <Async q={c.q} label="Loading card settings…" rows={4}>
        {() => !c.draft ? <Loading /> : (
          <>
            <SaveBar canEdit={c.canEdit} dirty={c.dirty} busy={c.busy} err={c.err}
              onSave={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Membership card"); toast("Published"); })}
              onReset={() => c.setDraft(c.q.data ?? null)} />

            <div className="flex flex-wrap items-start gap-5">
              <Card className="min-w-[280px] flex-1 p-4">
                <div className="grid gap-3">
                  <In label="Card title" value={String(home().zenMembershipCardTitle ?? "")} onChange={setHome("zenMembershipCardTitle")} />
                  <Area label="Card description" value={String(home().zenMembershipCardDescription ?? "")}
                    onChange={setHome("zenMembershipCardDescription")} rows={2} />
                  <ImageField label="Card image URL (optional)" value={String(home().zenMembershipCardImage ?? "")}
                    onChange={setHome("zenMembershipCardImage")} uploadAs="zenMembershipCard" onUploaded={c.q.reload}
                    hint="Leave blank for the default green-and-gold card" />
                </div>

                {members.data && (
                  <>
                    <SecH t="Membership right now" />
                    <div className="grid gap-1.5 text-[12.5px]">
                      <div className="flex justify-between border-b border-border pb-1.5">
                        <span className="text-ink3">Active members</span><b>{members.data.membershipStatus?.active ?? 0}</b>
                      </div>
                      <div className="flex justify-between border-b border-border pb-1.5">
                        <span className="text-ink3">Expired</span><b>{members.data.membershipStatus?.expired ?? 0}</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink3">No expiry set</span><b>{members.data.membershipStatus?.pending ?? 0}</b>
                      </div>
                    </div>
                    <Note className="mb-0 text-[11.5px]">
                      Membership is granted per guest from their patient record — open a patient and use <B>Grant Zen membership</B>.
                    </Note>
                  </>
                )}
              </Card>

              <Card className="min-w-[280px] flex-1 p-4">
                {/* Pricing and merchandising. priceInr is what Razorpay charges;
                    base/sale are the struck-through and offer figures on the card. */}
                <SecH t="Pricing" em="· the member is charged the price below" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <In label="Membership name" value={String(mem().name ?? "")} onChange={setMem("name")} />
                  <In label="Tagline" value={String(mem().tagline ?? "")} onChange={setMem("tagline")} />
                  <In label="Price charged (₹)" type="number" value={String(mem().priceInr ?? "")}
                    onChange={(v) => setMem("priceInr")(Number(v) || 0)} />
                  <In label="Original price (₹, optional)" type="number" value={String(mem().basePriceInr ?? "")}
                    onChange={(v) => setMem("basePriceInr")(Number(v) || 0)} />
                  <In label="Offer price shown (₹, optional)" type="number" value={String(mem().salePriceInr ?? "")}
                    onChange={(v) => setMem("salePriceInr")(Number(v) || 0)} />
                  <In label="Renewal price (₹, 0 = same)" type="number" value={String(mem().renewalPriceInr ?? "")}
                    onChange={(v) => setMem("renewalPriceInr")(Number(v) || 0)} />
                  <In label="Member discount (%)" type="number" value={String(mem().discountPercent ?? "")}
                    onChange={(v) => setMem("discountPercent")(Number(v) || 0)} />
                  <In label="Tax (%)" type="number" value={String(mem().taxPercent ?? "")}
                    onChange={(v) => setMem("taxPercent")(Number(v) || 0)} />
                  <In label="Validity (months)" type="number" value={String(mem().durationMonths ?? "")}
                    onChange={(v) => setMem("durationMonths")(Number(v) || 0)} />
                  <In label="Display order" type="number" value={String(mem().displayOrder ?? "")}
                    onChange={(v) => setMem("displayOrder")(Number(v) || 0)} />
                  <In label="CTA text" value={String(mem().ctaText ?? "")} onChange={setMem("ctaText")} />
                  <In label="CTA destination" value={String(mem().ctaDestination ?? "")} onChange={setMem("ctaDestination")}
                    hint="An app route, e.g. /profile/membership" />
                </div>
                <div className="mt-3 grid gap-3">
                  <Area label="Description" value={String(mem().description ?? "")} rows={2} onChange={setMem("description")} />
                  <Area label="Terms" value={String(mem().terms ?? "")} rows={3} onChange={setMem("terms")} />
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-ink2">
                      <Toggle on={mem().isActive !== false} onChange={(v) => setMem("isActive")(v)} /> On sale
                    </label>
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-ink2">
                      <Toggle on={!!mem().featured} onChange={(v) => setMem("featured")(v)} /> Featured
                    </label>
                  </div>
                  <Note className="mb-0 text-[11.5px]">
                    Guests are charged <B>Price charged</B>. The original and offer prices are only what the card
                    displays — they never change what Razorpay collects. Turning <B>On sale</B> off stops new
                    purchases without affecting existing members.
                  </Note>
                </div>
              </Card>

              <Card className="min-w-[280px] flex-1 p-4">
                <SecH t="What's included — benefits list" em={`· ${(((c.draft.membership ?? {}) as Record<string, unknown>).benefits as unknown[] | undefined)?.length || "bundled"}`} />
                <Note className="text-[11.5px]">Shown on the app's membership screen. Leave empty to keep the bundled ten.</Note>
                <BenefitsEditor
                  value={((((c.draft.membership ?? {}) as Record<string, unknown>).benefits as { title: string; copy?: string }[] | undefined) ?? [])}
                  onChange={(v) => c.setDraft((d) => (d ? { ...d, membership: { ...((d.membership ?? {}) as Record<string, unknown>), benefits: v } } : d))} />
              </Card>

              <div className="w-[270px]">
                {String(home().zenMembershipCardImage ?? "") ? (
                  <img src={String(home().zenMembershipCardImage)} alt="" className="w-full rounded-2xl border border-border object-cover" />
                ) : (
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#043528] to-secondary text-white" style={{ padding: 18 }}>
                    <div className="absolute -right-8 -top-8 h-[120px] w-[120px] rounded-full bg-[radial-gradient(circle,rgba(224,195,145,0.32),transparent_68%)]" />
                    <div className="font-logo text-[15px] tracking-[0.2em] text-gold">
                      {String(home().zenMembershipCardTitle ?? "Zen Membership")}
                    </div>
                    <div className="mt-3.5 text-[11px] leading-relaxed opacity-85">
                      {String(home().zenMembershipCardDescription ?? "")}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-center text-[11px] text-ink3">Live card preview</div>
              </div>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}

/* ================= ANNOUNCEMENTS / NOTIFICATION CENTRE ================= */
// Every type the Notification model can carry — so nothing is reachable only via "All".
const NOTIF_TABS: { label: string; type?: string }[] = [
  { label: "All" }, { label: "Bookings", type: "booking" }, { label: "Orders", type: "order" },
  { label: "Consultations", type: "consultation" }, { label: "Products", type: "product" },
  { label: "Inventory", type: "inventory" }, { label: "Promotions", type: "promotion" }, { label: "Reminders", type: "reminder" },
];

export function Announcements() {
  const nav = useNavigate();
  const { toast } = useStore();
  const [tab, setTab] = useState(0);

  const q = useApi(() => api.notifications.list({ type: NOTIF_TABS[tab].type, limit: 100 }), [tab]);
  const stats = useApi(() => api.notifications.stats().catch(() => undefined), []);
  const rows = q.data?.notifications ?? [];

  return (
    <Page title="Notifications" sub="Everything the system has told the clinic and its guests"
      actions={<>
        <Btn kind="ghost" onClick={async () => {
          try { await api.notifications.markAllRead(); toast("All marked read"); q.reload(); stats.reload(); }
          catch (e) { toast((e as Error).message); }
        }}>Mark all read</Btn>
        <Btn kind="ghost" onClick={async () => {
          try { await api.notifications.clearRead(); toast("Read notifications cleared"); q.reload(); stats.reload(); }
          catch (e) { toast((e as Error).message); }
        }}>Clear read</Btn>
      </>}>
      {!!stats.data?.byType?.length && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
          <Card className="px-3.5 py-3">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-ink3">Unread</div>
            <div className="mt-1 text-[22px] font-bold tabular-nums text-gold-dark">
              {(q.data?.unreadCount ?? 0).toLocaleString("en-IN")}
            </div>
          </Card>
          {stats.data.byType.slice(0, 5).map((t) => (
            <Card key={t._id} className="px-3.5 py-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-ink3">{t._id}</div>
              <div className="mt-1 text-[22px] font-bold tabular-nums">{t.count.toLocaleString("en-IN")}</div>
            </Card>
          ))}
        </div>
      )}

      <Tabs active={tab} onChange={setTab} items={NOTIF_TABS.map((t) => [t.label])} />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />

      <Async q={q} label="Loading notifications…" rows={8}>
        {() => rows.length === 0 ? (
          <Empty title="Nothing here" hint="Notifications are raised automatically as bookings, orders and stock events happen." />
        ) : (
          <DataTable cols={["When", "Type", "Title", "Message", "Priority", "Read"]}
            onRow={(i) => {
              const n = rows[i];
              api.notifications.markRead(n._id).then(q.reload).catch(() => toast("Could not mark as read"));
              if (n.actionUrl) nav(n.actionUrl);
            }}
            rows={rows.map((n) => [
              fmtAgo(n.createdAt),
              <Tag key={`${n._id}t`} kind="mute">{n.type}</Tag>,
              <B key={`${n._id}h`}>{n.title}</B>,
              <span key={`${n._id}m`} className="text-[11.5px] text-ink3">{n.message}</span>,
              <Tag key={`${n._id}p`} kind={n.priority === "urgent" || n.priority === "high" ? "err" : n.priority === "medium" ? "warn" : "mute"}>
                {n.priority}
              </Tag>,
              n.isRead ? <Tag key={`${n._id}r`} kind="mute">read</Tag> : <Tag key={`${n._id}r`} kind="info">new</Tag>,
            ])} />
        )}
      </Async>

      <Note>
        These are system notifications raised by bookings, orders and stock events. <B>Outbound marketing campaigns</B>
        {" "}(scheduled push or WhatsApp blasts to a segment) are not part of the backend yet — that needs a campaign
        model and a sender before this screen can schedule one.
      </Note>
    </Page>
  );
}

/* ================= SCREEN COPY ================= */
const SCREENS: { key: keyof Draft; title: string; fields: [string, string][] }[] = [
  { key: "consultationsScreen", title: "Consultations screen", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
  ]},
  { key: "appointmentsScreen", title: "Appointments screen", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"],
  ]},
  { key: "productsScreen", title: "Products screen", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
  ]},
  { key: "profileScreen", title: "Profile screen", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
    ["personalCardText", "Personal card"], ["addressesCardText", "Addresses card"], ["bankDetailsCardText", "Bank details card"],
    ["membershipCardText", "Membership card"], ["ordersCardText", "Orders card"], ["treatmentsCardText", "Treatments card"],
    ["appointmentsCardText", "Appointments card"], ["formsCardText", "Forms card"], ["helpCardText", "Help card"],
    ["termsCardText", "Terms card"], ["privacyCardText", "Privacy card"], ["deleteCardText", "Delete account card"],
  ]},
];

export function ScreenCopy() {
  const { toast, audit } = useStore();
  const c = useCustomization();
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Page title="Screen copy" sub="Every heading, sub-heading and label the mobile app renders"
      actions={<>
        {c.canEdit && <Btn kind="ghost" onClick={() => setResetOpen(true)}>Reset to defaults</Btn>}
        <Btn kind="gold" disabled={!c.dirty || c.busy}
          onClick={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Screen copy"); toast("Published"); })}>
          {c.busy ? "Publishing…" : "Publish"}
        </Btn>
      </>}>
      <Hint id="screen-copy">Change wording here and it appears in the app on the next launch — no release needed. Leave a field blank and the app falls back to its built-in default.</Hint>

      <Async q={c.q} label="Loading screen copy…" rows={6}>
        {() => !c.draft ? <Loading /> : (
          <>
            <SaveBar canEdit={c.canEdit} dirty={c.dirty} busy={c.busy} err={c.err}
              onSave={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", "Screen copy"); toast("Published"); })}
              onReset={() => c.setDraft(c.q.data ?? null)} />

            <div className="grid gap-3 xl:grid-cols-2">
              {SCREENS.map((screen) => {
                const set = c.section(screen.key);
                return (
                  <Card key={String(screen.key)} className="p-4">
                    <SecH t={screen.title} />
                    <div className="grid gap-3">
                      {screen.fields.map(([field, label]) => (
                        <In key={field} label={label} value={c.get(screen.key, field)} onChange={set(field)} />
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>

            {c.draft.lastUpdatedAt && (
              <Note className="text-[11.5px]">
                Last published {fmtDateFull(c.draft.lastUpdatedAt)} · config version {c.draft.version ?? 1}.
                The app caches the last good config, so a failed fetch can never blank a screen.
              </Note>
            )}
            <Card className="p-4">
              <SecH t="Help & Support — FAQs" em={`· ${(((c.draft?.helpScreen ?? {}) as Record<string, unknown>).faqs as unknown[] | undefined)?.length || "bundled"}`} />
              <Note className="text-[11.5px]">The questions on the app's Help screen. Leave empty to keep the bundled set.</Note>
              <FaqEditor
                value={((((c.draft?.helpScreen ?? {}) as Record<string, unknown>).faqs as { q: string; a: string }[] | undefined) ?? [])}
                onChange={(v) => c.setDraft((d) => (d ? { ...d, helpScreen: { ...((d.helpScreen ?? {}) as Record<string, unknown>), faqs: v } } : d))} />
            </Card>
          </>
        )}
      </Async>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset app customisation">
        <Note kind="crit" className="mt-0">
          This restores every screen's copy, the hero banner, the logo and the category cards to their built-in
          defaults, across the whole app. It cannot be undone.
        </Note>
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setResetOpen(false)}>Cancel</Btn>
          <Btn kind="danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.appStudio.reset();
              audit("APP_CUSTOMIZATION_UPDATED", "Reset app customisation to defaults");
              toast("Reset to defaults"); c.q.reload(); setResetOpen(false);
            } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Resetting…" : "Reset everything"}</Btn>
        </div>
      </Modal>
    </Page>
  );
}


/* ---- App home: new-layout section editors ---- */
const HOME_SECTIONS_META: { id: string; label: string; hint: string }[] = [
  { id: "hero", label: "Hero banner", hint: "The tappable artwork under the greeting" },
  { id: "appointment", label: "Next appointment / booking prompt", hint: "Shows the guest's next visit, or the Book CTA" },
  { id: "quickActions", label: "Quick actions", hint: "The four tiles — Consultation, Treatments, Appointment, Products" },
  { id: "products", label: "Products rail", hint: "Popular products, horizontally scrollable" },
  { id: "testimonials", label: "Reviews (celebrity quotes)", hint: "Five stars + rotating quotes" },
  { id: "reels", label: "Instagram reels", hint: "Uploaded clinic reels + follow card" },
  { id: "membership", label: "Zen membership card", hint: "Hidden automatically for existing members" },
];

function HomeSectionsEditor({ value, onChange }: {
  value: { id: string; visible?: boolean }[]; onChange: (v: { id: string; visible?: boolean }[]) => void;
}) {
  // Merge saved state with the full catalogue so new sections always appear.
  const savedIds = value.map((s) => s.id);
  const list = [
    ...value.filter((s) => HOME_SECTIONS_META.some((m) => m.id === s.id)),
    ...HOME_SECTIONS_META.filter((m) => !savedIds.includes(m.id)).map((m) => ({ id: m.id, visible: true })),
  ];
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="grid gap-1.5">
      {list.map((s, i) => {
        const meta = HOME_SECTIONS_META.find((m) => m.id === s.id)!;
        const hidden = s.visible === false;
        return (
          <div key={s.id} className={`flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 ${hidden ? "bg-dis-bg opacity-70" : "bg-ivory"}`}>
            <span className="flex flex-col gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▼</button>
            </span>
            <div className="min-w-0 flex-1">
              <b className="text-[12.5px]">{i + 1}. {meta.label}</b>
              <div className="text-[10.5px] text-ink3">{meta.hint}</div>
            </div>
            <Toggle on={!hidden} onChange={() => onChange(list.map((x, k) => (k === i ? { ...x, visible: hidden } : x)))} />
          </div>
        );
      })}
    </div>
  );
}

const QUICK_ROUTES = ["consultation", "treatments", "appointments", "products", "profile", "membership", "packages"];
const DEFAULT_QUICK: { label: string; route: string }[] = [
  { label: "Consultation", route: "consultation" },
  { label: "Treatments", route: "treatments" },
  { label: "Appointment", route: "appointments" },
  { label: "Products", route: "products" },
];

function QuickActionsEditor({ value, onChange }: {
  value: { label: string; image?: string; route?: string; visible?: boolean }[];
  onChange: (v: { label: string; image?: string; route?: string; visible?: boolean }[]) => void;
}) {
  const list: { label: string; image?: string; route?: string; visible?: boolean }[] =
    value.length ? value : DEFAULT_QUICK.map((d) => ({ ...d, visible: true }));
  const set = (i: number, patch: Partial<(typeof list)[number]>) => onChange(list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const uploadIcon = (i: number) => async (file: File) => {
    const r = await api.media.upload([file]); const url = r?.[0]?.url ?? "";
    if (url) set(i, { image: url });
    return url;
  };
  return (
    <div className="grid gap-2">
      <Note className="text-[11.5px]">Destinations are a validated list — a tile can only open a real page. Leave the icon empty to keep the bundled one.</Note>
      {list.map((a, i) => (
        <div key={i} className="grid items-center gap-2 rounded-lg border border-border bg-ivory px-3 py-2 md:grid-cols-[minmax(0,1fr)_150px_150px_auto_auto]">
          <input value={a.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label"
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
          <select value={a.route ?? "consultation"} onChange={(e) => set(i, { route: e.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none">
            {QUICK_ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="cursor-pointer truncate rounded-lg border border-border bg-surface px-2 py-1.5 text-center text-[11.5px] font-semibold hover:border-gold-dark">
            {a.image ? "Change icon" : "Upload icon"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadIcon(i)(f); e.target.value = ""; }} />
          </label>
          <Toggle on={a.visible !== false} onChange={() => set(i, { visible: a.visible === false })} />
          <button onClick={() => onChange(list.filter((_, k) => k !== i))} className="text-[12px] font-bold text-err">×</button>
        </div>
      ))}
      <div>
        <Btn kind="ghost" className="!py-1 !text-[12px]" disabled={list.length >= 8}
          onClick={() => onChange([...list, { label: "New tile", route: "products", visible: true }])}>+ Add tile</Btn>
      </div>
    </div>
  );
}

function TestimonialsEditor({ value, onChange }: {
  value: { name: string; role?: string; quote: string; image?: string }[];
  onChange: (v: { name: string; role?: string; quote: string; image?: string }[]) => void;
}) {
  const set = (i: number, patch: Partial<(typeof value)[number]>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= value.length) return;
    const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next);
  };
  return (
    <div className="grid gap-2">
      {value.map((t, i) => (
        <div key={i} className="rounded-lg border border-border bg-ivory p-3">
          <div className="flex items-start gap-2.5">
            {t.image ? <img src={t.image} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sage text-[12px] font-bold text-primary">{t.name?.slice(0, 1) || "?"}</span>}
            <div className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-2">
              <input value={t.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Name"
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
              <input value={t.role ?? ""} onChange={(e) => set(i, { role: e.target.value })} placeholder="Role (e.g. Indian Actress)"
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
            </div>
            <span className="flex flex-col gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▼</button>
            </span>
            <button onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-[12px] font-bold text-err">×</button>
          </div>
          <textarea value={t.quote} onChange={(e) => set(i, { quote: e.target.value })} placeholder="Quote" rows={2}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
          <label className="mt-1 inline-block cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold hover:border-gold-dark">
            {t.image ? "Change photo" : "Upload photo"}
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = await api.media.upload([f]); const url = r?.[0]?.url ?? "";
              if (url) set(i, { image: url });
              e.target.value = "";
            }} />
          </label>
        </div>
      ))}
      <div>
        <Btn kind="ghost" className="!py-1 !text-[12px]" disabled={value.length >= 10}
          onClick={() => onChange([...value, { name: "", role: "", quote: "" }])}>+ Add quote</Btn>
        {value.length > 0 && <Btn kind="ghost" className="ml-2 !py-1 !text-[12px] !text-err" onClick={() => onChange([])}>Use the bundled set</Btn>}
      </div>
    </div>
  );
}



function BenefitsEditor({ value, onChange }: { value: { title: string; copy?: string }[]; onChange: (v: { title: string; copy?: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ title: string; copy?: string }>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <div className="grid gap-1.5">
      {value.map((b, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-ivory px-2.5 py-1.5">
          <input value={b.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Benefit"
            className="w-2/5 rounded-lg border border-border bg-surface px-2 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
          <input value={b.copy ?? ""} onChange={(e) => set(i, { copy: e.target.value })} placeholder="One-line description"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
          <button onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-[12px] font-bold text-err">×</button>
        </div>
      ))}
      <div>
        <Btn kind="ghost" className="!py-1 !text-[12px]" disabled={value.length >= 14} onClick={() => onChange([...value, { title: "", copy: "" }])}>+ Add benefit</Btn>
        {value.length > 0 && <Btn kind="ghost" className="ml-2 !py-1 !text-[12px] !text-err" onClick={() => onChange([])}>Use the bundled set</Btn>}
      </div>
    </div>
  );
}

function FaqEditor({ value, onChange }: { value: { q: string; a: string }[]; onChange: (v: { q: string; a: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ q: string; a: string }>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="grid gap-2">
      {value.map((f, i) => (
        <div key={i} className="rounded-lg border border-border bg-ivory p-2.5">
          <div className="flex items-center gap-2">
            <input value={f.q} onChange={(e) => set(i, { q: e.target.value })} placeholder="Question"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-gold-dark" />
            <span className="flex flex-col gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded border border-border px-1 text-[9px] leading-3 disabled:opacity-30">▼</button>
            </span>
            <button onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-[12px] font-bold text-err">×</button>
          </div>
          <textarea value={f.a} onChange={(e) => set(i, { a: e.target.value })} placeholder="Answer" rows={2}
            className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
        </div>
      ))}
      <div>
        <Btn kind="ghost" className="!py-1 !text-[12px]" disabled={value.length >= 25} onClick={() => onChange([...value, { q: "", a: "" }])}>+ Add question</Btn>
        {value.length > 0 && <Btn kind="ghost" className="ml-2 !py-1 !text-[12px] !text-err" onClick={() => onChange([])}>Use the bundled set</Btn>}
      </div>
    </div>
  );
}

/* ================= APP CONTROL — design system & copy ================= */
/**
 * Full control of the app's look and wording: theme colours, type scale and
 * every registered copy string. Saved onto AppCustomization; the app applies
 * it live for mounted screens and app-wide from the next launch.
 */
export function AppControl() {
  const { toast, audit, can } = useStore();
  // Same split as the other App Studio screens: `appStudio.view` shows what the
  // app looks like, `appStudio.manage` publishes a change to it.
  const canEdit = can("appStudio.manage");
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: 2 });
  const q = useApi(() => api.appStudio.get(), []);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [fontScale, setFontScale] = useState(1);
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, number>>({});
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setColors({ ...(q.data.appearance?.colors ?? {}) });
    setFontScale(Number(q.data.appearance?.typography?.fontScale) || 1);
    setSizeOverrides({ ...(q.data.appearance?.typography?.sizeOverrides ?? {}) });
    setCopy({ ...(q.data.copy ?? {}) });
    setDirty(false);
  }, [q.data]);

  const allColorTokens = [...COLOR_TOKENS, ...CONTROL_COLOR_TOKENS, ...ADVANCED_COLOR_TOKENS];
  const val = (key: string) => colors[key] ?? allColorTokens.find((t) => t.key === key)?.default ?? "#000000";
  const setColor = (key: string, v: string) => { setColors((c) => ({ ...c, [key]: v })); setDirty(true); };
  const clearColor = (key: string) => { setColors((c) => { const n = { ...c }; delete n[key]; return n; }); setDirty(true); };
  const overriddenColors = Object.keys(colors).length;
  const overriddenCopy = Object.values(copy).filter((v) => v?.trim()).length;

  const save = async () => {
    setBusy(true);
    try {
      const cleanCopy = Object.fromEntries(Object.entries(copy).filter(([, v]) => v?.trim()));
      const saved = await api.appStudio.update({
        appearance: { colors, typography: { fontScale: Math.round(fontScale * 100) / 100, sizeOverrides } },
        copy: cleanCopy,
      } as Partial<AppCustomization>);
      const persistedColors = saved.appearance?.colors ?? {};
      const missingColors = Object.entries(colors).filter(([key, value]) => persistedColors[key] !== value);
      if (missingColors.length) {
        throw new Error(`The backend did not save ${missingColors.length} colour change${missingColors.length === 1 ? "" : "s"}. Nothing was published; please retry after the backend is deployed.`);
      }
      setColors({ ...persistedColors });
      setFontScale(Number(saved.appearance?.typography?.fontScale) || 1);
      setSizeOverrides({ ...(saved.appearance?.typography?.sizeOverrides ?? {}) });
      setCopy({ ...(saved.copy ?? {}) });
      audit("SETTINGS_UPDATED", `App control saved · ${overriddenColors} colour(s), ${Object.keys(sizeOverrides).length} exact type size(s), scale ${fontScale}, ${Object.keys(cleanCopy).length} cop${Object.keys(cleanCopy).length === 1 ? "y" : "ies"}`, {});
      toast(`Published ${Object.keys(persistedColors).length} colour override${Object.keys(persistedColors).length === 1 ? "" : "s"} — the app will reload with them`);
      setDirty(false);
      q.reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const resetAll = () => {
    if (!window.confirm("Reset every colour, the type scale and all copy to the bundled defaults?")) return;
    setColors({}); setFontScale(1); setSizeOverrides({}); setCopy({}); setDirty(true);
  };

  // Preview palette (defaults + overrides).
  const P = {
    primary: val("primary"), gold: val("gold"), background: val("background"), surface: val("surface"),
    sage: val("sage"), textPrimary: val("text.primary"), textSecondary: val("text.secondary"),
    border: val("border"), card: val("cardBackground"),
    primaryButton: val("primaryButtonBackground"), primaryButtonText: val("primaryButtonText"),
    goldButton: val("goldButtonBackground"), goldButtonText: val("goldButtonText"),
    tab: val("tabBackground"), tabActive: val("tabActiveText"), tabInactive: val("tabInactiveText"),
  };
  const copyVal = (key: string, d: string) => (copy[key]?.trim() ? copy[key] : d);
  const previewFont = (base: number) => (sizeOverrides[String(base)] ?? base) * fontScale;
  const matchesColor = (t: { key: string; label: string; hint: string }) => {
    const term = colorSearch.trim().toLowerCase();
    return !term || `${t.key} ${t.label} ${t.hint}`.toLowerCase().includes(term);
  };

  return (
    <Page title="App control" sub="The app's design system and wording — colours, type scale and every registered copy string"
      actions={<>
        <Btn kind="ghost" onClick={resetAll}>Reset to defaults</Btn>
        {canEdit
          ? <Btn disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save & publish"}</Btn>
          : <span className="text-[11.5px] text-ink3">Publishing needs the “edit app home, control &amp; content” permission.</span>}
      </>}>
      <Hint id="app-control">Changes publish to every install: screens that are open re-style on their next refresh, and the whole app picks the theme up on its next launch. Colours cascade — pressed states, overlays and links follow the primary automatically.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Tabs active={tab} onChange={setTab} items={[["Colours", overriddenColors || undefined], ["Typography", Object.keys(sizeOverrides).length || (fontScale !== 1 ? `${fontScale}×` : undefined)], ["Copy", overriddenCopy || undefined]]} />

      <Async q={q} label="Loading app settings…" rows={6}>
        {() => (
          <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              {tab === 0 && (
                <Card className="p-4">
                  <input value={colorSearch} onChange={(e) => setColorSearch(e.target.value)} placeholder="Search a colour, button, input, icon or element…"
                    className="mb-3 w-full rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {COLOR_TOKENS.filter(matchesColor).map((t) => {
                      const overridden = t.key in colors;
                      return (
                        <div key={t.key} className={`rounded-xl border p-3 ${overridden ? "border-gold bg-gold/5" : "border-border bg-ivory"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-[12.5px] font-bold">{t.label}</b>
                            {overridden && <button onClick={() => clearColor(t.key)} className="text-[10.5px] font-semibold text-ink3 hover:text-err">Reset</button>}
                          </div>
                          <div className="mt-0.5 text-[10.5px] leading-4 text-ink3">{t.hint}</div>
                          <div className="mt-2 flex items-center gap-2">
                            <input type="color" value={/^#[0-9a-f]{6}$/i.test(val(t.key)) ? val(t.key) : "#000000"} onChange={(e) => setColor(t.key, e.target.value)}
                              className="h-8 w-10 cursor-pointer rounded border border-border bg-surface p-0.5" />
                            <input value={val(t.key)} onChange={(e) => setColor(t.key, e.target.value)}
                              className="w-24 rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11.5px] uppercase outline-none focus:border-gold-dark" />
                            <span className="ml-auto font-mono text-[9.5px] text-ink3">default {t.default}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <SecH t="Buttons, inputs, headers, navigation & icons" em={`· ${CONTROL_COLOR_TOKENS.length} controls`} />
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {CONTROL_COLOR_TOKENS.filter(matchesColor).map((t) => {
                        const overridden = t.key in colors;
                        const value = val(t.key);
                        return (
                          <div key={t.key} className={`rounded-xl border p-3 ${overridden ? "border-gold bg-gold/5" : "border-border bg-ivory"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <b className="text-[12.5px] font-bold">{t.label}</b>
                              {overridden && <button onClick={() => clearColor(t.key)} className="text-[10.5px] font-semibold text-ink3 hover:text-err">Reset</button>}
                            </div>
                            <div className="mt-0.5 text-[10.5px] leading-4 text-ink3">{t.hint}</div>
                            <div className="mt-2 flex items-center gap-2">
                              <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => setColor(t.key, e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-surface p-0.5" />
                              <input value={value} onChange={(e) => setColor(t.key, e.target.value)} className="w-32 rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11.5px] uppercase outline-none focus:border-gold-dark" />
                              <span className="ml-auto h-6 w-6 rounded-md border border-border" style={{ background: value }} title={value} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Note className="mb-0 mt-3">Derived shades (pressed states, secondary green, overlays, link colour) follow the primary automatically; the gold's darker shade follows the accent. Only valid hex / rgba values are applied — anything else is ignored by the app.</Note>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12.5px] font-bold text-ink2">All tokens — every remaining colour in the app ({ADVANCED_COLOR_TOKENS.length})</summary>
                    <div className="mt-2 grid gap-2.5 md:grid-cols-2">
                      {ADVANCED_COLOR_TOKENS.filter(matchesColor).map((t) => {
                        const overridden = t.key in colors;
                        return (
                          <div key={t.key} className={`rounded-xl border p-3 ${overridden ? "border-gold bg-gold/5" : "border-border bg-ivory"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <b className="text-[12.5px] font-bold">{t.label}</b>
                              {overridden && <button onClick={() => clearColor(t.key)} className="text-[10.5px] font-semibold text-ink3 hover:text-err">Reset</button>}
                            </div>
                            <div className="mt-0.5 text-[10.5px] leading-4 text-ink3">{t.hint}</div>
                            <div className="mt-2 flex items-center gap-2">
                              <input type="color" value={/^#[0-9a-f]{6}$/i.test(colors[t.key] ?? t.default) ? (colors[t.key] ?? t.default) : "#000000"} onChange={(e) => setColor(t.key, e.target.value)}
                                className="h-8 w-10 cursor-pointer rounded border border-border bg-surface p-0.5" />
                              <input value={colors[t.key] ?? t.default} onChange={(e) => setColor(t.key, e.target.value)}
                                className="w-24 rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11.5px] uppercase outline-none focus:border-gold-dark" />
                              <span className="ml-auto font-mono text-[9.5px] text-ink3">default {t.default}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </Card>
              )}

              {tab === 1 && (
                <Card className="p-4">
                  <SecH t="Type scale" em={`· ${fontScale}×`} />
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-ink3">Smaller</span>
                    <input type="range" min={0.85} max={1.3} step={0.05} value={fontScale}
                      onChange={(e) => { setFontScale(Number(e.target.value)); setDirty(true); }} className="flex-1 accent-[var(--color-primary)]" />
                    <span className="text-[11px] text-ink3">Larger</span>
                    <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => { setFontScale(1); setDirty(true); }}>1×</Btn>
                  </div>
                  <div className="mt-4 rounded-xl border border-border bg-ivory p-4">
                    <div style={{ fontSize: previewFont(22), fontWeight: 800, color: P.textPrimary }}>Good morning, Sana 👋</div>
                    <div style={{ fontSize: previewFont(17), fontWeight: 700, color: P.textPrimary, marginTop: 8 }}>Popular treatments</div>
                    <div style={{ fontSize: previewFont(13), color: P.textSecondary, marginTop: 4 }}>Body copy — descriptions and supporting text scale together, so nothing falls out of step.</div>
                    <div style={{ fontSize: previewFont(11), color: P.textSecondary, marginTop: 4, opacity: 0.7 }}>Captions and metadata</div>
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <SecH t="Every base text size" em={`· ${Object.keys(sizeOverrides).length} changed`} />
                    <div className="mb-3 text-[11.5px] leading-5 text-ink3">These are the exact font sizes found across the active mobile layout. Changing one updates every matching heading, body label, button, caption or counter, while the global scale remains available above.</div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {FONT_SIZE_TOKENS.map((t) => {
                        const key = String(t.base);
                        const overridden = key in sizeOverrides;
                        const value = sizeOverrides[key] ?? t.base;
                        return (
                          <div key={key} className={`rounded-xl border p-2.5 ${overridden ? "border-gold bg-gold/5" : "border-border bg-ivory"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div><b className="text-[11.5px]">{t.label}</b><div className="text-[9.5px] text-ink3">{t.hint}</div></div>
                              {overridden && <button onClick={() => { setSizeOverrides((s) => { const n = { ...s }; delete n[key]; return n; }); setDirty(true); }} className="text-[10px] font-semibold text-ink3 hover:text-err">Reset</button>}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <input type="number" min={8} max={48} step={0.5} value={value}
                                onChange={(e) => { const n = Number(e.target.value); setSizeOverrides((s) => ({ ...s, [key]: n })); setDirty(true); }}
                                className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-[11.5px] outline-none focus:border-gold-dark" />
                              <span className="text-[10.5px] text-ink3">px</span>
                              <span className="ml-auto truncate" style={{ fontSize: Math.min(28, value * fontScale), color: P.textPrimary }}>Aa</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Note className="mb-0 mt-3">The app's interface font is Manrope (brand-fixed; the wordmark stays Cormorant Garamond). Exact sizes apply first, then the global scale. Line heights follow proportionally so text does not overlap.</Note>
                </Card>
              )}

              {tab === 2 && (
                <div>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search copy — key, label or text…"
                    className="mb-3 w-full max-w-[380px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
                  {COPY_GROUPS.map((g) => {
                    const term = search.toLowerCase();
                    const entries = g.entries.filter((e) => !term || e.key.includes(term) || e.label.toLowerCase().includes(term) || e.default.toLowerCase().includes(term) || (copy[e.key] ?? "").toLowerCase().includes(term));
                    if (!entries.length) return null;
                    return (
                      <Card key={g.title} className="mb-3 p-4">
                        <SecH t={g.title} em={`· ${entries.length}`} />
                        <div className="grid gap-2">
                          {entries.map((e) => {
                            const overridden = !!copy[e.key]?.trim();
                            return (
                              <div key={e.key} className="grid items-center gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                                <div>
                                  <div className="text-[12px] font-bold">{e.label}</div>
                                  <div className="font-mono text-[9.5px] text-ink3">{e.key}</div>
                                </div>
                                <input value={copy[e.key] ?? ""} placeholder={e.default}
                                  onChange={(ev) => { setCopy((c) => ({ ...c, [e.key]: ev.target.value })); setDirty(true); }}
                                  className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none focus:border-gold-dark ${overridden ? "border-gold bg-gold/5" : "border-border bg-ivory"}`} />
                                {overridden
                                  ? <button onClick={() => { setCopy((c) => { const n = { ...c }; delete n[e.key]; return n; }); setDirty(true); }} className="text-[10.5px] font-semibold text-ink3 hover:text-err">Reset</button>
                                  : <span className="text-[10px] text-ink3">default</span>}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })}
                  <Note>Empty fields fall back to the app's bundled wording. New strings appear here as screens are wired to the copy registry.</Note>
                </div>
              )}
            </div>

            {/* ---- live preview ---- */}
            <div className="xl:sticky xl:top-[72px]">
              <Card className="overflow-hidden">
                <div className="border-b border-border bg-ivory px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Live preview</div>
                <div style={{ background: P.background }} className="p-3">
                  <div style={{ color: P.textPrimary, fontSize: previewFont(17), fontWeight: 800 }}>{copyVal("home.greeting.morning", "Good morning")}, Sana 👋</div>
                  <div style={{ color: P.textSecondary, fontSize: previewFont(11.5), marginTop: 2 }}>{copyVal("brand.tagline.1", "Skin.")} {copyVal("brand.tagline.2", "Aesthetics.")} {copyVal("brand.tagline.3", "Wellness.")}</div>
                  <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 14, padding: 12, marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 15, background: P.sage, display: "grid", placeItems: "center", color: P.primary, fontWeight: 800, fontSize: previewFont(12) }}>Z</span>
                      <div>
                        <div style={{ color: P.textPrimary, fontWeight: 700, fontSize: previewFont(13) }}>HydraFacial · Signature</div>
                        <div style={{ color: P.textSecondary, fontSize: previewFont(11) }}>Tomorrow · 11:00 · Jubilee Hills</div>
                      </div>
                    </div>
                    <div style={{ background: P.primaryButton, color: P.primaryButtonText, textAlign: "center", borderRadius: 10, padding: "8px 0", marginTop: 10, fontWeight: 700, fontSize: previewFont(12.5) }}>{copyVal("home.book.cta", "Book an appointment")}</div>
                  </div>
                  <div style={{ background: P.sage, borderRadius: 14, padding: 12, marginTop: 10 }}>
                    <div style={{ color: P.primary, fontWeight: 800, fontSize: previewFont(12.5) }}>{copyVal("membership.title", "Zen Membership")}</div>
                    <div style={{ color: P.textSecondary, fontSize: previewFont(10.5), marginTop: 2 }}>{copyVal("membership.pitch", "A year of Zennara's signature treatments and privileges.")}</div>
                    <div style={{ background: P.goldButton, color: P.goldButtonText, textAlign: "center", borderRadius: 10, padding: "7px 0", marginTop: 8, fontWeight: 800, fontSize: previewFont(11.5) }}>{copyVal("membership.cta", "Become a Zen Member")}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-around", borderTop: `1px solid ${P.border}`, background: P.tab, marginTop: 12, paddingTop: 8, borderRadius: 10 }}>
                    {[copyVal("tabs.home", "Home"), copyVal("tabs.consultation", "Consult"), copyVal("tabs.appointments", "Appointments"), copyVal("tabs.shop", "Shop")].map((t, i) => (
                      <span key={t} style={{ fontSize: previewFont(9.5), fontWeight: 700, color: i === 0 ? P.tabActive : P.tabInactive, paddingBottom: 6 }}>{t}</span>
                    ))}
                  </div>
                </div>
              </Card>
              <Note className="mt-2">The preview is an approximation — open the app after saving to see it exactly.</Note>
            </div>
          </div>
        )}
      </Async>
      {dirty && (
        <div className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-gold-dark bg-cream px-4 py-2.5 shadow-lg">
          <span className="text-[12.5px] font-semibold text-ink2">Design changes are still local — publish them to update the app.</span>
          <Btn disabled={busy} onClick={save}>{busy ? "Publishing…" : "Save & publish"}</Btn>
        </div>
      )}
    </Page>
  );
}
