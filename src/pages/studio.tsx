import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Btn, B, Note as UiNote, In, Modal, Async, Loading, DeleteModal, Toggle } from "../ui";
import {
  StudioPage, Section, SubHeading, Field, Input, NumberInput, Textarea, Select, Segmented, ToggleRow, ImageInput,
  PublishBar, PhonePreview, StudioBtn, StatusTag, Note, Row, OrderButtons, RemoveButton, StudioEmpty, StudioStale,
  useStudioSection, APP, type StudioSection,
} from "../studio-ui";
import { useStore } from "../store";
import api from "../lib/api";
import { ADVANCED_COLOR_TOKENS, COLOR_TOKENS, CONTROL_COLOR_TOKENS, COPY_GROUPS, FONT_SIZE_TOKENS } from "../lib/appDesignCatalog";
import { useApi } from "../lib/useApi";
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

/** The publish bar every AppCustomization editor shares. */
function DraftPublishBar({ c, what, toastText = "Published" }: { c: ReturnType<typeof useCustomization>; what: string; toastText?: string }) {
  const { toast, audit } = useStore();
  return (
    <PublishBar canEdit={c.canEdit} dirty={c.dirty} busy={c.busy} err={c.err}
      lastSavedAt={c.draft?.lastUpdatedAt ? fmtDateFull(c.draft.lastUpdatedAt) : undefined}
      onPublish={() => c.save(() => { audit("APP_CUSTOMIZATION_UPDATED", what); toast(toastText); })}
      onDiscard={() => c.setDraft(c.q.data ?? null)} />
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
    <div className="col-span-full grid gap-4 rounded-[12px] border border-dashed border-border bg-ivory p-4">
      <div className="text-[14px] font-semibold text-ink">Upload a reel</div>
      <div className="grid gap-4 @lg/fields:grid-cols-2">
        <Field label="Title (optional)"><Input value={title} onChange={setTitle} /></Field>
        <Field label="Instagram link (optional)"><Input value={permalink} onChange={setPermalink} placeholder="https://www.instagram.com/reel/…" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StudioBtn kind="ghost" onClick={() => videoRef.current?.click()}>{video ? `Video: ${video.name}` : "Choose video (MP4)"}</StudioBtn>
        <StudioBtn kind="ghost" onClick={() => posterRef.current?.click()}>{poster ? `Poster: ${poster.name}` : "Poster image (optional)"}</StudioBtn>
        <StudioBtn disabled={!video || busy} onClick={submit}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</> : "Upload reel"}</StudioBtn>
      </div>
      <input ref={videoRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
        onChange={(e) => { setVideo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <input ref={posterRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { setPoster(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}

/* ================= APP HOME ================= */
const HOME_SECTIONS: StudioSection[] = [
  { id: "branding", title: "Branding", blurb: "The logo the app shows in its header." },
  { id: "hero", title: "Hero banner", blurb: "The tappable artwork under the greeting, and where it takes the guest." },
  { id: "sections", title: "Home sections", blurb: "The home page is built from these blocks, top to bottom. Hide or reorder any of them — the greeting always stays on top." },
  { id: "quick", title: "Quick actions", blurb: "The four tiles under the banner. Destinations are a validated list — a tile can only open a real page." },
  { id: "reels", title: "Clinic reels", blurb: "Upload the reel's video file (MP4, under 50 MB) and the app plays it natively — an Instagram embed cannot be relied on to play on iPhone. Newest first." },
  { id: "reviews", title: "Reviews", blurb: "Celebrity and press quotes in the reviews carousel, shown with five gold stars. Leave empty to keep the bundled set." },
  { id: "instagram", title: "Instagram", blurb: "The \"Follow us\" rail and every \"View on Instagram\" link use these." },
];

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
  void moveCard;

  const sections = HOME_SECTIONS.map((s) => {
    if (s.id === "reels") return { ...s, count: reelVideos.length || undefined };
    if (s.id === "reviews") return { ...s, count: ((home().testimonials as unknown[] | undefined) ?? []).length || undefined };
    return s;
  });
  const [active, setActive] = useStudioSection("home", sections);
  const sec = sections.find((s) => s.id === active) ?? sections[0];

  const quickActions = (home().quickActions as { label: string; image?: string; route?: string; visible?: boolean }[] | undefined) ?? [];
  const homeSections = (home().sections as { id: string; visible?: boolean }[] | undefined) ?? [];

  return (
    <StudioPage title="App home" intro="The mobile app's home screen — every change here reaches guests on their next launch, without an app release."
      sections={sections} active={active} onSection={setActive}
      footer={<DraftPublishBar c={c} what="App home" toastText="Published — live in the app now" />}>
      <StudioStale error={c.q.data ? c.q.error : null} onRetry={c.q.reload} />

      <Async q={c.q} label="Loading app settings…" rows={6}>
        {() => !c.draft ? <Loading /> : (
          <>
            {active === "branding" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <Field label="App logo" full hint="Paste an image URL, or upload a file — uploads replace the logo straight away.">
                  <ImageInput value={c.draft.appLogo ?? ""} contain emptyLabel="No logo yet"
                    onChange={(v) => c.setDraft((d) => (d ? { ...d, appLogo: v } : d))}
                    uploadAs="appLogo" onUploaded={c.q.reload} />
                </Field>
              </Section>
            )}

            {active === "hero" && (
              <Section title={sec.title} blurb={sec.blurb}
                aside={<PhonePreview caption="How the top of the home screen will look">
                  <HomeMock logo={c.draft.appLogo ?? ""} hero={String(home().heroBannerImage ?? "")} quickActions={quickActions} sections={homeSections} />
                </PhonePreview>}>
                <Field label="Hero banner image" full>
                  <ImageInput value={String(home().heroBannerImage ?? "")} onChange={setHome("heroBannerImage")} uploadAs="heroBanner" onUploaded={c.q.reload} />
                </Field>
                <Field label="Tapping the banner opens" full hint="Destinations are a validated list, not free text — the banner cannot point at a page that does not exist.">
                  <Select value={String(home().heroBannerRoute ?? "consultations")} onChange={setHome("heroBannerRoute")}
                    options={["consultations", "products", "appointments", "profile"]} />
                </Field>
              </Section>
            )}

            {active === "sections" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full">
                  <HomeSectionsEditor value={homeSections} onChange={setHome("sections")} />
                </div>
              </Section>
            )}

            {active === "quick" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full">
                  <QuickActionsEditor value={quickActions} onChange={setHome("quickActions")} />
                </div>
              </Section>
            )}

            {active === "reels" && (
              <Section title={sec.title} blurb={sec.blurb}>
                {c.canEdit && <ReelUploader onAdded={c.q.reload} />}
                <div className="col-span-full grid gap-2">
                  <div className="text-[14px] font-semibold text-ink">{reelVideos.length ? `${reelVideos.length} uploaded` : "No reels uploaded yet"}</div>
                  {reelVideos.map((r, i) => (
                    <Row key={r._id ?? i}>
                      {r.poster
                        ? <img src={r.poster} alt="" className="h-14 w-10 shrink-0 rounded-[6px] object-cover" />
                        : <video src={r.url} muted playsInline className="h-14 w-10 shrink-0 rounded-[6px] bg-black object-cover" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-ink">{r.title || `Reel ${reelVideos.length - i}`}</div>
                        <div className={`truncate text-[14px] ${r.permalink ? "text-ink3" : "font-semibold text-warn"}`}>{r.permalink || "No Instagram link — “View on Instagram” hidden for this reel"}</div>
                      </div>
                      {c.canEdit && (
                        <StudioBtn kind="link" small onClick={() => { const link = window.prompt("Instagram link for this reel (instagram.com URL, empty to remove):", r.permalink ?? ""); if (link === null || !r._id) return; api.appStudio.updateReelVideo(r._id, { permalink: link.trim() }).then(() => { toast("Reel link saved"); c.q.reload(); }).catch((e) => toast((e as Error).message)); }}>
                          {r.permalink ? "Edit link" : "Add link"}
                        </StudioBtn>
                      )}
                      {c.canEdit && <RemoveButton onClick={() => setDelReel(r)} label="Remove reel" />}
                    </Row>
                  ))}
                </div>
                <Field label="Instagram reel links (fallback, one per line)" full hint="Used only when no video has been uploaded. Embeds may not play on iPhone.">
                  <Textarea rows={3} value={((home().reels as string[] | undefined) ?? []).join("\n")}
                    onChange={(v) => setHome("reels")(v.split(/\n+/).map((x) => x.trim()).filter(Boolean))} />
                </Field>
              </Section>
            )}

            {active === "reviews" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full">
                  <TestimonialsEditor value={(home().testimonials as { name: string; role?: string; quote: string; image?: string }[] | undefined) ?? []} onChange={setHome("testimonials")} />
                </div>
                <Note>Headings for this section live under <B>App control → Copy → Home</B>.</Note>
              </Section>
            )}

            {active === "instagram" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <Field label="Handle"><Input value={String(home().instagramHandle ?? "")} onChange={setHome("instagramHandle")} placeholder="@zennaraclinics" /></Field>
                <Field label="Profile URL"><Input value={String(home().instagramUrl ?? "")} onChange={setHome("instagramUrl")} placeholder="https://www.instagram.com/zennaraclinics/" /></Field>
                <Note>Wording for the rail lives under <B>App control → Copy → Home</B>. Every heading, subtitle and button on the home page is editable there; colours and type sizes live in <B>App control</B> too.</Note>
              </Section>
            )}
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
    </StudioPage>
  );
}

/**
 * A simple, honest mock of the home screen drawn from the draft: greeting,
 * hero, the quick-action tiles and the remaining sections in their saved
 * order. The panel shares no code with the app, so this is a sketch, not a
 * render.
 */
function HomeMock({ logo, hero, quickActions, sections }: {
  logo: string; hero: string;
  quickActions: { label: string; image?: string; route?: string; visible?: boolean }[];
  sections: { id: string; visible?: boolean }[];
}) {
  const tiles: { label: string; image?: string; route?: string; visible?: boolean }[] =
    (quickActions.length ? quickActions : DEFAULT_QUICK.map((d) => ({ ...d, visible: true }))).filter((a) => a.visible !== false);
  const savedIds = sections.map((s) => s.id);
  const order = [
    ...sections.filter((s) => HOME_SECTIONS_META.some((m) => m.id === s.id)),
    ...HOME_SECTIONS_META.filter((m) => !savedIds.includes(m.id)).map((m) => ({ id: m.id, visible: true })),
  ].filter((s) => s.visible !== false);
  const label = (id: string) => HOME_SECTIONS_META.find((m) => m.id === id)?.label ?? id;
  const block = (id: string) => {
    switch (id) {
      case "hero":
        return hero
          ? <img src={hero} alt="" className="w-full rounded-[14px] object-cover" style={{ aspectRatio: "16/9" }} />
          : <div className="grid w-full place-items-center rounded-[14px] text-[11px] font-semibold" style={{ aspectRatio: "16/9", background: APP.cream, color: APP.ink3 }}>Hero banner</div>;
      case "appointment":
        return (
          <div className="rounded-[14px] p-3" style={{ background: APP.surface, border: `1px solid ${APP.border}` }}>
            <div className="text-[11px] font-bold" style={{ color: APP.ink }}>Ready when you are</div>
            <div className="mt-0.5 text-[9.5px]" style={{ color: APP.ink2 }}>Your next visit will appear here.</div>
            <div className="mt-2 rounded-[10px] py-1.5 text-center text-[10px] font-bold text-white" style={{ background: APP.primary }}>Book an appointment</div>
          </div>
        );
      case "quickActions":
        return (
          <div className="grid grid-cols-4 gap-2">
            {tiles.slice(0, 8).map((a, i) => (
              <div key={i} className="grid justify-items-center gap-1 text-center">
                <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-[14px]" style={{ background: "#eff3ee" }}>
                  {a.image ? <img src={a.image} alt="" className="h-6 w-6 object-contain" /> : <span className="text-[14px] font-extrabold" style={{ color: APP.primary }}>{(a.label || "?").slice(0, 1)}</span>}
                </span>
                <span className="w-full truncate text-[8.5px] font-semibold" style={{ color: APP.ink2 }}>{a.label || "Tile"}</span>
              </div>
            ))}
          </div>
        );
      case "products":
        return (
          <div>
            <div className="mb-1.5 text-[11px] font-bold" style={{ color: APP.ink }}>Popular products</div>
            <div className="flex gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 flex-1 rounded-[10px]" style={{ background: APP.cream }} />)}</div>
          </div>
        );
      case "testimonials":
        return (
          <div className="rounded-[14px] p-3" style={{ background: APP.cream }}>
            <div className="text-[10px] tracking-[0.15em]" style={{ color: APP.gold }}>★★★★★</div>
            <div className="mt-1 text-[9.5px] italic" style={{ color: APP.ink2 }}>“Reviews rotate here.”</div>
          </div>
        );
      case "reels":
        return (
          <div>
            <div className="mb-1.5 text-[11px] font-bold" style={{ color: APP.ink }}>From the clinic</div>
            <div className="flex gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 flex-1 rounded-[10px]" style={{ background: "#1b1f1d" }} />)}</div>
          </div>
        );
      case "membership":
        return (
          <div className="rounded-[14px] p-3 text-white" style={{ background: APP.primary }}>
            <div className="font-logo text-[12px] tracking-[0.18em]" style={{ color: APP.gold }}>ZEN MEMBERSHIP</div>
            <div className="mt-1 text-[9.5px] opacity-80">Hidden automatically for members.</div>
          </div>
        );
      default:
        return <div className="rounded-[10px] px-3 py-2 text-[9.5px]" style={{ background: APP.cream, color: APP.ink3 }}>{label(id)}</div>;
    }
  };
  return (
    <div className="grid gap-3 px-3.5 py-3" style={{ background: APP.surface }}>
      <div className="flex items-center justify-between">
        {logo ? <img src={logo} alt="" className="h-6 max-w-[110px] object-contain" /> : <span className="font-logo text-[15px] tracking-[0.12em]" style={{ color: APP.primary }}>Zennara</span>}
        <span className="h-7 w-7 rounded-full" style={{ background: APP.cream }} />
      </div>
      <div>
        <div className="text-[15px] font-extrabold leading-tight" style={{ color: APP.ink }}>Good morning, Sana</div>
        <div className="text-[9.5px]" style={{ color: APP.ink2 }}>Skin. Aesthetics. Wellness.</div>
      </div>
      {order.map((s) => <div key={s.id}>{block(s.id)}</div>)}
    </div>
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
      {err && <UiNote kind="crit">{err}</UiNote>}
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
const CONSULT_SECTIONS: StudioSection[] = [
  { id: "copy", title: "Screen copy", blurb: "The heading, sub-heading and search placeholder a guest sees when they tap Consultation." },
  { id: "tiers", title: "Consultation tiers", blurb: "The fees the app charges per tier. Tiers come from the Dermatologists module, so there is one source of truth." },
  { id: "doctors", title: "Dermatologists listed in the app", blurb: "Fees, centres and visibility flow from the Dermatologists module — nothing is duplicated here." },
];

export function ConsultPage() {
  const nav = useNavigate();
  const c = useCustomization();
  const setScreen = c.section("consultationsScreen");
  const screen = () => ((c.draft?.consultationsScreen ?? {}) as Record<string, unknown>);

  const doctors = useApi(() => api.doctors.list(), []);
  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);
  const [active, setActive] = useStudioSection("consultation", CONSULT_SECTIONS);
  const sec = CONSULT_SECTIONS.find((s) => s.id === active) ?? CONSULT_SECTIONS[0];

  return (
    <StudioPage title="Consultation page" intro="A guest taps Consultation, picks a tier, picks a dermatologist, then picks a slot. The copy is editable here; tiers and dermatologists come from the Dermatologists module."
      sections={CONSULT_SECTIONS} active={active} onSection={setActive}
      footer={<DraftPublishBar c={c} what="Consultation screen" />}>
      <Async q={c.q} label="Loading screen settings…" rows={4}>
        {() => !c.draft ? <Loading /> : (
          <>
            {active === "copy" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <Field label="Heading" full><Input value={String(screen().heading ?? "")} onChange={setScreen("heading")} /></Field>
                <Field label="Sub-heading" full><Textarea value={String(screen().subHeading ?? "")} onChange={setScreen("subHeading")} rows={2} /></Field>
                <Field label="Search bar placeholder" full><Input value={String(screen().searchbarPlaceholder ?? "")} onChange={setScreen("searchbarPlaceholder")} /></Field>
              </Section>
            )}

            {active === "tiers" && (
              <Section title={sec.title} blurb={sec.blurb}
                right={<StudioBtn kind="ghost" onClick={() => nav("/doctors")}>Edit in Dermatologists ↗</StudioBtn>}>
                <div className="col-span-full">
                  <Async q={tiers} label="Loading tiers…" rows={2}>
                    {(list) => list.length === 0 ? (
                      <StudioEmpty title="No tiers configured" hint="Seed them with `node scripts/seedDoctors.js` in the Backend folder." />
                    ) : (
                      <div className="grid gap-2">
                        {list.map((t) => (
                          <Row key={t.id}>
                            <div className="min-w-0 flex-1">
                              <div className="text-[15px] font-semibold text-ink">{t.title}</div>
                              <div className="truncate text-[14px] text-ink3">
                                {(doctors.data?.data ?? []).filter((d) => d.tier === t.id).map((d) => d.name).join(", ") || "No dermatologists on this tier"}
                              </div>
                            </div>
                            <div className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">{fmtINR(t.fee)}</div>
                          </Row>
                        ))}
                      </div>
                    )}
                  </Async>
                </div>
              </Section>
            )}

            {active === "doctors" && (
              <Section title={sec.title} blurb={sec.blurb}
                right={<StudioBtn kind="ghost" onClick={() => nav("/doctors")}>Manage dermatologists ↗</StudioBtn>}>
                <div className="col-span-full">
                  <Async q={doctors} label="Loading dermatologists…" rows={4}>
                    {(res) => (res.data ?? []).length === 0 ? (
                      <StudioEmpty title="No dermatologists listed" hint="Add the team under Care → Dermatologists." />
                    ) : (
                      <div className="grid gap-2 @lg/fields:grid-cols-2">
                        {(res.data ?? []).map((d) => (
                          <Row key={d._id}>
                            {d.photo
                              ? <img src={d.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                              : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sage text-[14px] font-extrabold text-primary">
                                  {d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                                </span>}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[15px] font-semibold text-ink">{d.name}</div>
                              <div className="truncate text-[14px] text-ink3">
                                {d.designation ?? d.tier}
                                {d.availableCentres?.length ? ` · ${d.availableCentres.join(", ")}` : ""}
                              </div>
                            </div>
                            <StatusTag kind={d.isActive ? "ok" : "mute"}>{d.isActive ? "Live" : "Hidden"}</StatusTag>
                          </Row>
                        ))}
                      </div>
                    )}
                  </Async>
                </div>
              </Section>
            )}
          </>
        )}
      </Async>
    </StudioPage>
  );
}


/** One row of Zenoti's membership catalog, as the picker sees it. */
type ZenotiPickRow = Awaited<ReturnType<typeof api.zenoti.catalogMemberships>>[number];
const pickKey = (m: ZenotiPickRow) => m.versionId ?? m.id;
const pickLabel = (m: ZenotiPickRow) => [m.price != null ? `₹${m.price}` : null, m.code || null, m.isActive == null ? null : m.isActive ? "active" : "inactive"].filter(Boolean).join(" · ");

/**
 * Pick the Zenoti membership the app's Zen membership is sold as. Only the Zen
 * family (MVP, MVP Jh, Zen Membership…) shows by default; "show all" lists the
 * whole catalog. Older backends send no `isZenFamily`, so with no flagged rows
 * the picker falls back to the full list.
 */
function ZenotiMembershipPick({ value, onChange, onRow }: { value: string; onChange: (versionId: string, name: string) => void; onRow?: (row: ZenotiPickRow | null) => void }) {
  const q = useApi(() => api.zenoti.catalogMemberships().catch(() => [] as ZenotiPickRow[]), []);
  const [showAll, setShowAll] = useState(false);
  const all = q.data ?? [];
  const zenFamily = all.filter((m) => m.isZenFamily);
  const rows = showAll || zenFamily.length === 0 ? all : zenFamily;
  const current = all.find((m) => pickKey(m) === value) ?? null;
  // The picked row may sit outside the Zen family; keep it selectable.
  const options = current && !rows.some((m) => pickKey(m) === value) ? [current, ...rows] : rows;
  useEffect(() => { onRow?.(current); }, [current?.id, current?.price, current?.isActive]);
  return (
    <>
      <Field label="Zenoti membership" full hint={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {q.loading ? "Loading Zenoti memberships…" : current
              ? `Zenoti: ${pickLabel(current) || "no price listed"}${current.discountedPrice != null ? ` (offer ₹${current.discountedPrice})` : ""}${current.durationMonths ? ` · ${current.durationMonths} mo` : ""}`
              : `${rows.length} of ${all.length} membership(s)${zenFamily.length && !showAll ? " · Zen family only" : ""}`}
          </span>
          {zenFamily.length > 0 && zenFamily.length < all.length && (
            <button type="button" className="font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Zen family only" : "Show all"}</button>
          )}
        </span>}>
        <Select value={value}
          onChange={(v) => { const m = all.find((r) => pickKey(r) === v); onChange(v, m?.name ?? ""); }}
          options={[
            { value: "", label: "— not linked (uses the server's default membership) —" },
            ...options.map((m) => ({ value: pickKey(m), label: `${m.name}${pickLabel(m) ? ` · ${pickLabel(m)}` : ""}` })),
          ]} />
      </Field>
      {current?.isActive === false && (
        <Note kind="err">This membership is inactive in Zenoti; invoices for it may be refused.</Note>
      )}
    </>
  );
}

/* ================= MEMBERSHIP CARD ================= */
const MEMBERSHIP_SECTIONS: StudioSection[] = [
  { id: "status", title: "Membership right now", blurb: "How many guests hold the Zen membership today. Membership is granted per guest from their guest record — open a guest and use Grant Zen membership." },
  { id: "zenoti", title: "Zenoti membership", blurb: "What an app purchase is recorded as in Zenoti." },
  { id: "pricing", title: "Pricing", blurb: "What the guest is charged, and the figures the card displays." },
  { id: "closing", title: "Closing the sale in Zenoti", blurb: "How an app purchase is invoiced there." },
  { id: "benefits", title: "What's included", blurb: "The benefits list on the app's membership screen. Leave empty to keep the bundled ten." },
  { id: "faqs", title: "Help & Support", blurb: "The questions on the app's Help screen. Leave empty to keep the bundled set." },
  { id: "card", title: "Card & copy", blurb: "The card on the home screen and the membership page behind it." },
];

export function MembershipCard() {
  const { can } = useStore();
  const c = useCustomization();
  const setHome = c.section("homeScreen");
  const home = () => ((c.draft?.homeScreen ?? {}) as Record<string, unknown>);
  // The membership block lives under its own key, so it gets its own accessors
  // rather than being threaded through homeScreen.
  const setMem = c.section("membership");
  const mem = () => ((c.draft?.membership ?? {}) as Record<string, unknown>);
  const priceSource = mem().priceSource === "manual" ? "manual" : "zenoti";
  // The Zenoti variant the picker resolved — its list price is the live price
  // when the source is Zenoti.
  const [zenotiRow, setZenotiRow] = useState<ZenotiPickRow | null>(null);
  const livePrice = priceSource === "zenoti" ? zenotiRow?.price ?? null : Number(mem().priceInr ?? 0) || null;
  // Zenoti employees who can be recorded as closing the sale.
  const staff = useApi(() => api.zenoti.practitioners().catch(() => []), []);
  const staffRows = (staff.data ?? []).filter((p) => p.zenotiEmployeeId);
  const closedById = String(mem().zenotiClosedByEmployeeId ?? "");
  const closedByKnown = staffRows.some((p) => p.zenotiEmployeeId === closedById);

  // Member counts are a nicety on this editor, and the endpoint belongs to the
  // Analytics page. Ask only when the account may actually read it, so a
  // content-only role does not generate a denial on every visit.
  const members = useApi(() => (can("analytics.view") ? api.analytics.patients().catch(() => undefined) : Promise.resolve(undefined)), []);

  const benefits = ((mem().benefits as { title: string; copy?: string }[] | undefined) ?? []);
  const faqs = ((((c.draft?.helpScreen ?? {}) as Record<string, unknown>).faqs as { q: string; a: string }[] | undefined) ?? []);
  const sections = MEMBERSHIP_SECTIONS
    .filter((s) => s.id !== "status" || !!members.data)
    .map((s) => s.id === "benefits" ? { ...s, count: benefits.length || undefined }
      : s.id === "faqs" ? { ...s, count: faqs.length || undefined } : s);
  const [active, setActive] = useStudioSection("membership", sections, "card");
  const sec = sections.find((s) => s.id === active) ?? sections[0];

  const preview = (
    <PhonePreview caption="The card as guests see it">
      <MembershipMock
        image={String(home().zenMembershipCardImage ?? "")}
        title={String(home().zenMembershipCardTitle ?? "")}
        cardDescription={String(home().zenMembershipCardDescription ?? "")}
        name={String(mem().name ?? "")} tagline={String(mem().tagline ?? "")} description={String(mem().description ?? "")}
        price={livePrice} basePrice={Number(mem().basePriceInr ?? 0) || null} salePrice={Number(mem().salePriceInr ?? 0) || null}
        benefits={benefits} cta={String(mem().ctaText ?? "")} onSale={mem().isActive !== false} />
    </PhonePreview>
  );

  return (
    <StudioPage title="Membership card" intro="The Zen membership as guests see it on the app's home screen — the card, its price, what's included and how a purchase lands in Zenoti."
      sections={sections} active={active} onSection={setActive}
      footer={<DraftPublishBar c={c} what="Membership card" />}>
      <Async q={c.q} label="Loading card settings…" rows={4}>
        {() => !c.draft ? <Loading /> : (
          <>
            {active === "status" && members.data && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full grid gap-3 @md/fields:grid-cols-3">
                  {([["Active members", members.data.membershipStatus?.active ?? 0], ["Expired", members.data.membershipStatus?.expired ?? 0], ["No expiry set", members.data.membershipStatus?.pending ?? 0]] as [string, number][]).map(([k, v]) => (
                    <div key={k} className="rounded-[12px] border border-border bg-ivory px-4 py-4">
                      <div className="text-[14px] font-semibold text-ink2">{k}</div>
                      <div className="mt-1 text-[28px] font-extrabold tabular-nums leading-none text-ink">{v.toLocaleString("en-IN")}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {active === "zenoti" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <ZenotiMembershipPick value={String(mem().zenotiMembershipVersionId ?? "")}
                  onChange={(id, name) => { setMem("zenotiMembershipVersionId")(id); setMem("zenotiMembershipName")(name); }}
                  onRow={setZenotiRow} />
              </Section>
            )}

            {active === "pricing" && (
              <Section title={sec.title} blurb={priceSource === "zenoti" ? "The member is charged Zenoti's live price." : "The member is charged the price typed below."}>
                {/* priceInr is what Razorpay charges; base/sale are the struck-through and offer figures on the card. */}
                <Field label="Price source" full hint={
                  priceSource === "zenoti"
                    ? zenotiRow
                      ? zenotiRow.price != null
                        ? <>Live price <B>{fmtINR(zenotiRow.price)}</B>{zenotiRow.code ? ` · ${zenotiRow.code}` : ""}{zenotiRow.isActive == null ? "" : zenotiRow.isActive ? " · active in Zenoti" : " · inactive in Zenoti"} — read from the picked variant each time the app loads.</>
                        : "The picked Zenoti variant lists no price — pick another or switch to Manual."
                      : "Pick a Zenoti membership (in the Zenoti membership section) to read its price."
                    : "The app charges the price typed here; Zenoti's list price is ignored."}>
                  <div><Segmented value={priceSource} onChange={(v) => setMem("priceSource")(v)} options={[{ value: "zenoti", label: "Zenoti live" }, { value: "manual", label: "Manual" }]} /></div>
                </Field>
                {priceSource === "zenoti" && zenotiRow?.isActive === false && (
                  <Note kind="err">This membership is inactive in Zenoti; invoices for it may be refused.</Note>
                )}
                <Field label={priceSource === "zenoti" ? "Price charged (₹) · from Zenoti" : "Price charged (₹)"}>
                  <NumberInput value={priceSource === "zenoti" ? String(zenotiRow?.price ?? mem().priceInr ?? "") : String(mem().priceInr ?? "")}
                    readOnly={priceSource === "zenoti"}
                    onChange={(v) => { if (priceSource === "manual") setMem("priceInr")(Number(v) || 0); }} />
                </Field>
                <Field label="Original price (₹, optional)" hint="Shown struck through on the card.">
                  <NumberInput value={String(mem().basePriceInr ?? "")} onChange={(v) => setMem("basePriceInr")(Number(v) || 0)} />
                </Field>
                <Field label="Offer price shown (₹, optional)">
                  <NumberInput value={String(mem().salePriceInr ?? "")} onChange={(v) => setMem("salePriceInr")(Number(v) || 0)} />
                </Field>
                <Field label="Renewal price (₹, 0 = same)">
                  <NumberInput value={String(mem().renewalPriceInr ?? "")} onChange={(v) => setMem("renewalPriceInr")(Number(v) || 0)} />
                </Field>
                <Field label="Member discount (%)">
                  <NumberInput value={String(mem().discountPercent ?? "")} onChange={(v) => setMem("discountPercent")(Number(v) || 0)} />
                </Field>
                <Field label="Tax (%)">
                  <NumberInput value={String(mem().taxPercent ?? "")} onChange={(v) => setMem("taxPercent")(Number(v) || 0)} />
                </Field>
                <Field label="Validity (months)">
                  <NumberInput value={String(mem().durationMonths ?? "")} onChange={(v) => setMem("durationMonths")(Number(v) || 0)} />
                </Field>
                <Note>
                  Guests are charged {priceSource === "zenoti" ? <>Zenoti&rsquo;s live price{livePrice != null ? <> (<B>{fmtINR(livePrice)}</B> right now)</> : null}</> : <B>Price charged</B>}. The original and offer prices are only what the card
                  displays — they never change what Razorpay collects. Turning <B>On sale</B> off (under Card &amp; copy) stops new
                  purchases without affecting existing members.
                </Note>
              </Section>
            )}

            {active === "closing" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <Field label="Custom payment type id" full hint="The id of the Razorpay/online custom payment type set up in Zenoti — Zenoti has no API to list these, paste it from Zenoti admin">
                  <Input value={String(mem().zenotiCustomPaymentId ?? "")} onChange={setMem("zenotiCustomPaymentId")} placeholder="e.g. 4f1c…-…" />
                </Field>
                <Field label="Closed by (employee)" full hint={<>The Zenoti employee the invoice is recorded as closed by. {closedById && !closedByKnown ? "The saved id is not in the staff list — it is kept as typed below." : ""}</>}>
                  <Select value={closedByKnown ? closedById : ""}
                    onChange={(v) => { const p = staffRows.find((x) => x.zenotiEmployeeId === v); setMem("zenotiClosedByEmployeeId")(p?.zenotiEmployeeId ?? ""); setMem("zenotiClosedByEmployeeName")(p?.name ?? ""); }}
                    options={[
                      { value: "", label: staff.loading ? "Loading Zenoti staff…" : staffRows.length ? "— pick a Zenoti employee —" : "— no Zenoti staff loaded; type an id below —" },
                      ...staffRows.map((p) => ({ value: p.zenotiEmployeeId ?? "", label: `${p.name}${p.centers?.length ? ` · ${p.centers.join(", ")}` : ""}` })),
                    ]} />
                </Field>
                <Field label="Employee id (any Zenoti employee)" hint="Free-text fallback when the person is not in the list">
                  <Input value={closedById} placeholder="Paste a Zenoti employee id"
                    onChange={(v) => { setMem("zenotiClosedByEmployeeId")(v.trim()); const p = staffRows.find((x) => x.zenotiEmployeeId === v.trim()); if (p) setMem("zenotiClosedByEmployeeName")(p.name); }} />
                </Field>
                <Field label="Employee name (shown on the sale)">
                  <Input value={String(mem().zenotiClosedByEmployeeName ?? "")} onChange={setMem("zenotiClosedByEmployeeName")} />
                </Field>
              </Section>
            )}

            {active === "benefits" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full">
                  <BenefitsEditor value={benefits}
                    onChange={(v) => c.setDraft((d) => (d ? { ...d, membership: { ...((d.membership ?? {}) as Record<string, unknown>), benefits: v } } : d))} />
                </div>
              </Section>
            )}

            {active === "faqs" && (
              <Section title={sec.title} blurb={sec.blurb}>
                <div className="col-span-full">
                  <FaqEditor value={faqs}
                    onChange={(v) => c.setDraft((d) => (d ? { ...d, helpScreen: { ...((d.helpScreen ?? {}) as Record<string, unknown>), faqs: v } } : d))} />
                </div>
              </Section>
            )}

            {active === "card" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}>
                <Field label="Card title" full><Input value={String(home().zenMembershipCardTitle ?? "")} onChange={setHome("zenMembershipCardTitle")} /></Field>
                <Field label="Card description" full><Textarea value={String(home().zenMembershipCardDescription ?? "")} onChange={setHome("zenMembershipCardDescription")} rows={2} /></Field>
                <Field label="Card image (optional)" full hint="Leave blank for the default green-and-gold card">
                  <ImageInput value={String(home().zenMembershipCardImage ?? "")} onChange={setHome("zenMembershipCardImage")} uploadAs="zenMembershipCard" onUploaded={c.q.reload} />
                </Field>
                <Field label="Membership name"><Input value={String(mem().name ?? "")} onChange={setMem("name")} /></Field>
                <Field label="Tagline"><Input value={String(mem().tagline ?? "")} onChange={setMem("tagline")} /></Field>
                <Field label="Description" full><Textarea value={String(mem().description ?? "")} rows={2} onChange={setMem("description")} /></Field>
                <Field label="CTA text"><Input value={String(mem().ctaText ?? "")} onChange={setMem("ctaText")} /></Field>
                <Field label="CTA destination" hint="An app route, e.g. /profile/membership"><Input value={String(mem().ctaDestination ?? "")} onChange={setMem("ctaDestination")} /></Field>
                <Field label="Terms" full><Textarea value={String(mem().terms ?? "")} rows={3} onChange={setMem("terms")} /></Field>
                <Field label="Display order"><NumberInput value={String(mem().displayOrder ?? "")} onChange={(v) => setMem("displayOrder")(Number(v) || 0)} /></Field>
                <ToggleRow label="On sale" description="Turning this off stops new purchases without affecting existing members." on={mem().isActive !== false} onChange={(v) => setMem("isActive")(v)} />
                <ToggleRow label="Featured" description="Highlights the card in the app." on={!!mem().featured} onChange={(v) => setMem("featured")(v)} />
              </Section>
            )}
          </>
        )}
      </Async>
    </StudioPage>
  );
}

/** The membership card and the screen behind it, sketched from the draft. */
function MembershipMock({ image, title, cardDescription, name, tagline, description, price, basePrice, salePrice, benefits, cta, onSale }: {
  image: string; title: string; cardDescription: string; name: string; tagline: string; description: string;
  price: number | null; basePrice: number | null; salePrice: number | null;
  benefits: { title: string; copy?: string }[]; cta: string; onSale: boolean;
}) {
  const shown = salePrice ?? price;
  const was = basePrice && shown && basePrice > shown ? basePrice : null;
  const list = benefits.length ? benefits.slice(0, 5) : [{ title: "Bundled benefits" }, { title: "Ten included perks" }, { title: "Shown as saved in the app" }];
  return (
    <div className="grid gap-3 px-3.5 py-3" style={{ background: APP.surface }}>
      {image ? (
        <img src={image} alt="" className="w-full rounded-[16px] object-cover" style={{ aspectRatio: "16/10" }} />
      ) : (
        <div className="relative overflow-hidden rounded-[16px] p-4 text-white" style={{ background: `linear-gradient(135deg, #1f2f24, ${APP.primary})` }}>
          <div className="absolute -right-8 -top-8 h-[110px] w-[110px] rounded-full" style={{ background: "radial-gradient(circle, rgba(224,195,145,0.35), transparent 68%)" }} />
          <div className="font-logo text-[15px] tracking-[0.2em]" style={{ color: APP.gold }}>{title || name || "Zen Membership"}</div>
          <div className="mt-2 text-[9.5px] leading-relaxed opacity-85">{cardDescription || tagline || "A year of Zennara's signature treatments and privileges."}</div>
        </div>
      )}
      <div>
        <div className="text-[15px] font-extrabold leading-tight" style={{ color: APP.ink }}>{name || title || "Zen Membership"}</div>
        {tagline && <div className="mt-0.5 text-[10px]" style={{ color: APP.ink2 }}>{tagline}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[18px] font-extrabold tabular-nums" style={{ color: APP.primary }}>{shown != null ? fmtINR(shown) : "—"}</span>
        {was && <span className="text-[11px] line-through tabular-nums" style={{ color: APP.ink3 }}>{fmtINR(was)}</span>}
        {!onSale && <span className="ml-auto rounded-full px-2 py-0.5 text-[8.5px] font-bold" style={{ background: APP.cream, color: APP.ink2 }}>Not on sale</span>}
      </div>
      {description && <div className="text-[9.5px] leading-relaxed" style={{ color: APP.ink2 }}>{description}</div>}
      <div className="grid gap-1.5">
        {list.map((b, i) => (
          <div key={i} className="flex items-start gap-2 text-[9.5px]" style={{ color: APP.ink }}>
            <span className="mt-[3px] grid h-3 w-3 shrink-0 place-items-center rounded-full text-[7px] font-bold text-white" style={{ background: APP.primary }}>✓</span>
            <span><b>{b.title || "Benefit"}</b>{b.copy ? <span style={{ color: APP.ink2 }}> — {b.copy}</span> : null}</span>
          </div>
        ))}
        {benefits.length > 5 && <div className="text-[9px]" style={{ color: APP.ink3 }}>+ {benefits.length - 5} more</div>}
      </div>
      <div className="rounded-[12px] py-2 text-center text-[11px] font-bold" style={{ background: APP.gold, color: APP.primary }}>{cta || "Become a Zen Member"}</div>
    </div>
  );
}

/* ================= ANNOUNCEMENTS / NOTIFICATION CENTRE ================= */
// Every type the Notification model can carry — so nothing is reachable only via "All".
const NOTIF_TABS: { label: string; type?: string }[] = [
  { label: "All" }, { label: "Bookings", type: "booking" }, { label: "Orders", type: "order" },
  { label: "Consultations", type: "consultation" }, { label: "Products", type: "product" },
  { label: "Inventory", type: "inventory" }, { label: "Promotions", type: "promotion" }, { label: "Reminders", type: "reminder" },
];
const NOTIF_PAGE = 20;

export function Announcements() {
  const nav = useNavigate();
  const { toast } = useStore();
  const stats = useApi(() => api.notifications.stats().catch(() => undefined), []);
  const sections: StudioSection[] = NOTIF_TABS.map((t) => ({
    id: t.type ?? "all", title: t.label,
    count: t.type ? stats.data?.byType?.find((b) => b._id === t.type)?.count || undefined : undefined,
  }));
  const [active, setActive] = useStudioSection("announcements", sections);
  const tab = Math.max(0, NOTIF_TABS.findIndex((t) => (t.type ?? "all") === active));
  const [page, setPage] = useState(1);

  const q = useApi(() => api.notifications.list({ type: NOTIF_TABS[tab].type, limit: 100 }), [tab]);
  const rows = q.data?.notifications ?? [];
  useEffect(() => { setPage(1); }, [tab]);
  const pages = Math.max(1, Math.ceil(rows.length / NOTIF_PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * NOTIF_PAGE, current * NOTIF_PAGE);

  return (
    <StudioPage title="Announcements" intro="Everything the system has told the clinic and its guests — raised automatically as bookings, orders and stock events happen."
      sections={sections} active={active} onSection={(id) => { setActive(id); }}
      actions={<>
        <StudioBtn kind="ghost" onClick={async () => {
          try { await api.notifications.markAllRead(); toast("All marked read"); q.reload(); stats.reload(); }
          catch (e) { toast((e as Error).message); }
        }}>Mark all read</StudioBtn>
        <StudioBtn kind="ghost" onClick={async () => {
          try { await api.notifications.clearRead(); toast("Read notifications cleared"); q.reload(); stats.reload(); }
          catch (e) { toast((e as Error).message); }
        }}>Clear read</StudioBtn>
      </>}>
      <Section title={NOTIF_TABS[tab].label === "All" ? "All notifications" : NOTIF_TABS[tab].label}
        blurb={rows.length ? `${rows.length.toLocaleString("en-IN")} shown, newest first · ${(q.data?.unreadCount ?? 0).toLocaleString("en-IN")} unread. Opening one marks it read.` : undefined}>
        {!!stats.data?.byType?.length && (
          <div className="col-span-full grid grid-cols-2 gap-3 @md/fields:grid-cols-3 @2xl/fields:grid-cols-6">
            <div className="rounded-[12px] border border-primary/20 bg-primary/[0.04] px-4 py-3">
              <div className="text-[14px] font-semibold text-ink2">Unread</div>
              <div className="mt-1 text-[24px] font-extrabold tabular-nums leading-none text-primary">{(q.data?.unreadCount ?? 0).toLocaleString("en-IN")}</div>
            </div>
            {stats.data.byType.slice(0, 5).map((t) => (
              <div key={t._id} className="rounded-[12px] border border-border bg-ivory px-4 py-3">
                <div className="truncate text-[14px] font-semibold capitalize text-ink2">{t._id}</div>
                <div className="mt-1 text-[24px] font-extrabold tabular-nums leading-none text-ink">{t.count.toLocaleString("en-IN")}</div>
              </div>
            ))}
          </div>
        )}
        <div className="col-span-full"><StudioStale error={q.data ? q.error : null} onRetry={q.reload} /></div>
        <div className="col-span-full">
          <Async q={q} label="Loading notifications…" rows={8}>
            {() => rows.length === 0 ? (
              <StudioEmpty title="Nothing here" hint="Notifications are raised automatically as bookings, orders and stock events happen." />
            ) : (
              <div className="grid gap-2">
                {shown.map((n) => (
                  <Row key={n._id} className={n.isRead ? "" : "border-primary/30"} onClick={() => {
                    api.notifications.markRead(n._id).then(q.reload).catch(() => toast("Could not mark as read"));
                    if (n.actionUrl) nav(n.actionUrl);
                  }}>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${n.isRead ? "bg-border" : "bg-primary"}`} aria-hidden />
                    <div className="min-w-0 flex-1 py-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold text-ink">{n.title}</span>
                        <StatusTag kind="mute">{n.type}</StatusTag>
                        <StatusTag kind={n.priority === "urgent" || n.priority === "high" ? "err" : n.priority === "medium" ? "warn" : "mute"}>{n.priority ?? "low"}</StatusTag>
                        {n.isRead ? <StatusTag kind="mute">read</StatusTag> : <StatusTag kind="info">new</StatusTag>}
                      </div>
                      <div className="mt-0.5 text-[14px] leading-6 text-ink2">{n.message}</div>
                    </div>
                    <span className="shrink-0 text-[14px] text-ink3">{fmtAgo(n.createdAt)}</span>
                  </Row>
                ))}
                {pages > 1 && (
                  <div className="flex items-center justify-end gap-2 pt-2 text-[14px] text-ink2">
                    <StudioBtn kind="ghost" small disabled={current <= 1} onClick={() => setPage(current - 1)}>← Previous</StudioBtn>
                    <span>{(current - 1) * NOTIF_PAGE + 1}–{Math.min(current * NOTIF_PAGE, rows.length)} of {rows.length}</span>
                    <StudioBtn kind="ghost" small disabled={current >= pages} onClick={() => setPage(current + 1)}>Next →</StudioBtn>
                  </div>
                )}
              </div>
            )}
          </Async>
        </div>
        <Note>
          These are system notifications raised by bookings, orders and stock events. <B>Outbound marketing campaigns</B>
          {" "}(scheduled push or WhatsApp blasts to a segment) are not part of the backend yet — that needs a campaign
          model and a sender before this screen can schedule one.
        </Note>
      </Section>
    </StudioPage>
  );
}

/* ================= SCREEN COPY ================= */
const SCREENS: { key: keyof Draft; title: string; blurb: string; fields: [string, string][] }[] = [
  { key: "consultationsScreen", title: "Consultations screen", blurb: "The screen a guest reaches from the Consultation tab.", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
  ]},
  { key: "appointmentsScreen", title: "Appointments screen", blurb: "The guest's upcoming and past visits.", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"],
  ]},
  { key: "productsScreen", title: "Products screen", blurb: "The shop.", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
  ]},
  { key: "profileScreen", title: "Profile screen", blurb: "The guest's profile and the cards that lead off it.", fields: [
    ["heading", "Heading"], ["subHeading", "Sub-heading"], ["searchbarPlaceholder", "Search placeholder"],
    ["personalCardText", "Personal card"], ["addressesCardText", "Addresses card"], ["bankDetailsCardText", "Bank details card"],
    ["membershipCardText", "Membership card"], ["ordersCardText", "Orders card"], ["treatmentsCardText", "Treatments card"],
    ["appointmentsCardText", "Appointments card"], ["formsCardText", "Forms card"], ["helpCardText", "Help card"],
    ["termsCardText", "Terms card"], ["privacyCardText", "Privacy card"], ["deleteCardText", "Delete account card"],
  ]},
];
const COPY_SECTIONS: StudioSection[] = SCREENS.map((s) => ({ id: String(s.key), title: s.title, blurb: s.blurb }));

export function ScreenCopy() {
  const { toast, audit } = useStore();
  const c = useCustomization();
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useStudioSection("screen-copy", COPY_SECTIONS);
  const screen = SCREENS.find((s) => String(s.key) === active) ?? SCREENS[0];

  return (
    <StudioPage title="Screen copy" intro="Every heading, sub-heading and label the mobile app renders. Change wording here and it appears on the next launch — leave a field blank and the app falls back to its built-in default."
      sections={COPY_SECTIONS} active={active} onSection={setActive}
      actions={c.canEdit ? <StudioBtn kind="danger" onClick={() => setResetOpen(true)}>Reset to defaults</StudioBtn> : undefined}
      footer={<DraftPublishBar c={c} what="Screen copy" />}>
      <Async q={c.q} label="Loading screen copy…" rows={6}>
        {() => !c.draft ? <Loading /> : (
          <Section key={String(screen.key)} title={screen.title} blurb={screen.blurb}>
            {screen.fields.map(([field, label]) => {
              const set = c.section(screen.key);
              return (
                <Field key={field} label={label} full={field === "subHeading"}>
                  <Input value={c.get(screen.key, field)} onChange={set(field)} />
                </Field>
              );
            })}
            {c.draft.lastUpdatedAt && (
              <Note>
                Last published {fmtDateFull(c.draft.lastUpdatedAt)} · config version {c.draft.version ?? 1}.
                The app caches the last good config, so a failed fetch can never blank a screen.
              </Note>
            )}
          </Section>
        )}
      </Async>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset app customisation">
        <Note kind="err" className="mt-0">
          This restores every screen's copy, the hero banner, the logo and the category cards to their built-in
          defaults, across the whole app. It cannot be undone.
        </Note>
        <div className="mt-4 flex justify-end gap-2">
          <StudioBtn kind="ghost" onClick={() => setResetOpen(false)}>Cancel</StudioBtn>
          <StudioBtn kind="danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.appStudio.reset();
              audit("APP_CUSTOMIZATION_UPDATED", "Reset app customisation to defaults");
              toast("Reset to defaults"); c.q.reload(); setResetOpen(false);
            } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Resetting…" : "Reset everything"}</StudioBtn>
        </div>
      </Modal>
    </StudioPage>
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
    <div className="grid gap-2">
      {list.map((s, i) => {
        const meta = HOME_SECTIONS_META.find((m) => m.id === s.id)!;
        const hidden = s.visible === false;
        return (
          <Row key={s.id} muted={hidden}>
            <OrderButtons onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === list.length - 1} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-ink">{i + 1}. {meta.label}</div>
              <div className="text-[14px] text-ink3">{meta.hint}</div>
            </div>
            <span className="hidden text-[14px] text-ink3 sm:inline">{hidden ? "Hidden" : "Shown"}</span>
            <Toggle on={!hidden} onChange={() => onChange(list.map((x, k) => (k === i ? { ...x, visible: hidden } : x)))} />
          </Row>
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
    <div className="grid gap-3">
      <div className="hidden grid-cols-[44px_minmax(0,1fr)_170px_140px_auto_auto] gap-3 px-3.5 text-[14px] font-semibold text-ink3 @xl/fields:grid">
        <span>Icon</span><span>Label</span><span>Opens</span><span /><span>Shown</span><span />
      </div>
      {list.map((a, i) => (
        <div key={i} className="grid items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-3 @xl/fields:grid-cols-[44px_minmax(0,1fr)_170px_140px_auto_auto]">
          <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-[10px] bg-sage">
            {a.image ? <img src={a.image} alt="" className="h-7 w-7 object-contain" /> : <span className="text-[14px] font-extrabold text-primary">{(a.label || "?").slice(0, 1)}</span>}
          </span>
          <Input value={a.label} onChange={(v) => set(i, { label: v })} placeholder="Label" />
          <Select value={a.route ?? "consultation"} onChange={(v) => set(i, { route: v })} options={QUICK_ROUTES} />
          <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-[10px] border border-border bg-surface px-3 text-[14px] font-semibold text-ink2 hover:bg-ivory hover:text-ink">
            {a.image ? "Change icon" : "Upload icon"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadIcon(i)(f); e.target.value = ""; }} />
          </label>
          <div className="flex items-center gap-2 text-[14px] text-ink3"><Toggle on={a.visible !== false} onChange={() => set(i, { visible: a.visible === false })} /><span className="@xl/fields:hidden">{a.visible === false ? "Hidden" : "Shown"}</span></div>
          <RemoveButton onClick={() => onChange(list.filter((_, k) => k !== i))} label="Remove tile" />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <StudioBtn kind="ghost" disabled={list.length >= 8}
          onClick={() => onChange([...list, { label: "New tile", route: "products", visible: true }])}>+ Add tile</StudioBtn>
      </div>
      <div className="text-[12.5px] text-ink3">Leave the icon empty to keep the bundled one. Up to eight tiles.</div>
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
    <div className="grid gap-3">
      {value.length === 0 && <StudioEmpty title="Using the bundled celebrity set" hint="Add a quote to replace it with your own list." />}
      {value.map((t, i) => (
        <div key={i} className="grid gap-3 rounded-[12px] border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            {t.image ? <img src={t.image} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sage text-[15px] font-bold text-primary">{t.name?.slice(0, 1) || "?"}</span>}
            <div className="grid min-w-0 flex-1 gap-3 @lg/fields:grid-cols-2">
              <Field label="Name"><Input value={t.name} onChange={(v) => set(i, { name: v })} placeholder="Name" /></Field>
              <Field label="Role"><Input value={t.role ?? ""} onChange={(v) => set(i, { role: v })} placeholder="e.g. Indian Actress" /></Field>
            </div>
            <div className="flex shrink-0 items-center gap-1 pt-7">
              <OrderButtons onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === value.length - 1} />
              <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} label="Remove quote" />
            </div>
          </div>
          <Field label="Quote"><Textarea value={t.quote} onChange={(v) => set(i, { quote: v })} placeholder="Quote" rows={2} /></Field>
          <div>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-[10px] border border-border bg-surface px-4 text-[14px] font-semibold text-ink2 hover:bg-ivory hover:text-ink">
              {t.image ? "Change photo" : "Upload photo"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const r = await api.media.upload([f]); const url = r?.[0]?.url ?? "";
                if (url) set(i, { image: url });
                e.target.value = "";
              }} />
            </label>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <StudioBtn kind="ghost" disabled={value.length >= 10}
          onClick={() => onChange([...value, { name: "", role: "", quote: "" }])}>+ Add quote</StudioBtn>
        {value.length > 0 && <StudioBtn kind="danger" onClick={() => onChange([])}>Use the bundled set</StudioBtn>}
      </div>
    </div>
  );
}



function BenefitsEditor({ value, onChange }: { value: { title: string; copy?: string }[]; onChange: (v: { title: string; copy?: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ title: string; copy?: string }>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <div className="grid gap-3">
      {value.length === 0 && <StudioEmpty title="Using the bundled ten benefits" hint="Add a benefit to replace them with your own list." />}
      {value.length > 0 && (
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)_36px] gap-3 px-3.5 text-[14px] font-semibold text-ink3 @lg/fields:grid">
          <span>Benefit</span><span>One-line description</span><span />
        </div>
      )}
      {value.map((b, i) => (
        <div key={i} className="grid items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-3 @lg/fields:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_36px]">
          <Input value={b.title} onChange={(v) => set(i, { title: v })} placeholder="Benefit" />
          <Input value={b.copy ?? ""} onChange={(v) => set(i, { copy: v })} placeholder="One-line description" />
          <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} label="Remove benefit" />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <StudioBtn kind="ghost" disabled={value.length >= 14} onClick={() => onChange([...value, { title: "", copy: "" }])}>+ Add benefit</StudioBtn>
        {value.length > 0 && <StudioBtn kind="danger" onClick={() => onChange([])}>Use the bundled set</StudioBtn>}
      </div>
    </div>
  );
}

function FaqEditor({ value, onChange }: { value: { q: string; a: string }[]; onChange: (v: { q: string; a: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ q: string; a: string }>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="grid gap-3">
      {value.length === 0 && <StudioEmpty title="Using the bundled questions" hint="Add a question to replace them with your own list." />}
      {value.map((f, i) => (
        <div key={i} className="grid gap-3 rounded-[12px] border border-border bg-surface p-4">
          <div className="flex items-end gap-3">
            <Field label={`Question ${i + 1}`} className="min-w-0 flex-1"><Input value={f.q} onChange={(v) => set(i, { q: v })} placeholder="Question" /></Field>
            <div className="flex shrink-0 items-center gap-1 pb-1">
              <OrderButtons onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === value.length - 1} />
              <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} label="Remove question" />
            </div>
          </div>
          <Field label="Answer"><Textarea value={f.a} onChange={(v) => set(i, { a: v })} placeholder="Answer" rows={2} /></Field>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <StudioBtn kind="ghost" disabled={value.length >= 25} onClick={() => onChange([...value, { q: "", a: "" }])}>+ Add question</StudioBtn>
        {value.length > 0 && <StudioBtn kind="danger" onClick={() => onChange([])}>Use the bundled set</StudioBtn>}
      </div>
    </div>
  );
}

/* ================= APP CONTROL — design system & copy ================= */
const CONTROL_SECTIONS: StudioSection[] = [
  { id: "palette", title: "Palette", blurb: "The app's core colours. Derived shades — pressed states, secondary green, overlays, link colour — follow the primary automatically; the gold's darker shade follows the accent." },
  { id: "controls", title: "Colours & buttons", blurb: "Buttons, inputs, headers, navigation and icons. Each role can change independently of the palette." },
  { id: "scale", title: "Type scale", blurb: "One multiplier for every text size in the app. The interface font is Manrope (brand-fixed; the wordmark stays Cormorant Garamond)." },
  { id: "sizes", title: "Text sizes", blurb: "The exact font sizes found across the active mobile layout. Changing one updates every matching heading, label, button, caption or counter; the global scale still applies on top." },
  { id: "copy", title: "Copy", blurb: "Every registered string. Empty fields fall back to the app's bundled wording; new strings appear here as screens are wired to the copy registry." },
];

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
  const q = useApi(() => api.appStudio.get(), []);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [fontScale, setFontScale] = useState(1);
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, number>>({});
  const [copy, setCopy] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const applyServer = (data: AppCustomization) => {
    setColors({ ...(data.appearance?.colors ?? {}) });
    setFontScale(Number(data.appearance?.typography?.fontScale) || 1);
    setSizeOverrides({ ...(data.appearance?.typography?.sizeOverrides ?? {}) });
    setCopy({ ...(data.copy ?? {}) });
    setDirty(false);
  };
  useEffect(() => {
    if (!q.data) return;
    applyServer(q.data);
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

  const paletteChanged = [...COLOR_TOKENS, ...ADVANCED_COLOR_TOKENS].filter((t) => t.key in colors).length;
  const controlsChanged = CONTROL_COLOR_TOKENS.filter((t) => t.key in colors).length;
  const sections = CONTROL_SECTIONS.map((s) => ({
    ...s,
    count: s.id === "palette" ? paletteChanged || undefined
      : s.id === "controls" ? controlsChanged || undefined
      : s.id === "scale" ? (fontScale !== 1 ? `${fontScale}×` : undefined)
      : s.id === "sizes" ? Object.keys(sizeOverrides).length || undefined
      : overriddenCopy || undefined,
  }));
  const [active, setActive] = useStudioSection("app-control", sections);
  const sec = sections.find((s) => s.id === active) ?? sections[0];

  // A render function, not a component: a component declared inside render
  // is a new type on every keystroke, which remounts the card and drops focus.
  const tokenCard = (t: { key: string; label: string; hint: string; default: string }) => {
    const overridden = t.key in colors;
    const value = val(t.key);
    return (
      <div key={t.key} className={`grid gap-3 rounded-[12px] border p-4 ${overridden ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">{t.label}</div>
            <div className="mt-0.5 text-[12.5px] leading-5 text-ink3">{t.hint}</div>
          </div>
          {overridden && <StudioBtn kind="link" small onClick={() => clearColor(t.key)}>Reset</StudioBtn>}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" aria-label={`${t.label} colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => setColor(t.key, e.target.value)}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-[10px] border border-border bg-surface p-1" />
          <Input value={value} onChange={(v) => setColor(t.key, v)} mono className="!w-[150px] uppercase" />
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-ink3">
            <span className="h-6 w-6 rounded-[6px] border border-border" style={{ background: value }} title={value} />
            <span className="hidden font-mono sm:inline">default {t.default}</span>
          </span>
        </div>
      </div>
    );
  };

  const preview = (
    <div className="overflow-hidden rounded-[12px] border border-border">
      <div className="border-b border-border bg-ivory px-4 py-2.5 text-[14px] font-semibold text-ink2">Live preview</div>
      <div style={{ background: P.background }} className="p-3">
        <div style={{ color: P.textPrimary, fontSize: previewFont(17), fontWeight: 800 }}>{copyVal("home.greeting.morning", "Good morning")}, Sana</div>
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
      <div className="border-t border-border bg-ivory px-4 py-2.5 text-[12.5px] leading-5 text-ink3">An approximation — open the app after publishing to see it exactly.</div>
    </div>
  );

  const colorSearchField = (
    <Field label="Find a colour" full>
      <Input value={colorSearch} onChange={setColorSearch} placeholder="Search a colour, button, input, icon or element…" />
    </Field>
  );

  return (
    <StudioPage title="App control" intro="The app's design system and wording. Changes publish to every install: open screens re-style on their next refresh, and the whole app picks the theme up on its next launch."
      sections={sections} active={active} onSection={setActive}
      actions={<StudioBtn kind="danger" onClick={resetAll}>Reset to defaults</StudioBtn>}
      footer={<PublishBar canEdit={canEdit} dirty={dirty} busy={busy} err={null}
        lastSavedAt={q.data?.lastUpdatedAt ? fmtDateFull(q.data.lastUpdatedAt) : undefined}
        onPublish={save} onDiscard={() => { if (q.data) applyServer(q.data); }} />}>
      <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />

      <Async q={q} label="Loading app settings…" rows={6}>
        {() => (
          <>
            {active === "palette" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}>
                {colorSearchField}
                <div className="col-span-full grid gap-3 @lg/fields:grid-cols-2">
                  {COLOR_TOKENS.filter(matchesColor).map((t) => tokenCard(t))}
                </div>
                <Note>Only valid hex / rgba values are applied — anything else is ignored by the app.</Note>
                <details className="col-span-full">
                  <summary className="cursor-pointer text-[15px] font-semibold text-ink">All tokens — every remaining colour in the app ({ADVANCED_COLOR_TOKENS.length})</summary>
                  <div className="mt-4 grid gap-3 @lg/fields:grid-cols-2">
                    {ADVANCED_COLOR_TOKENS.filter(matchesColor).map((t) => tokenCard(t))}
                  </div>
                </details>
              </Section>
            )}

            {active === "controls" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}
                right={<span className="text-[14px] text-ink3">{CONTROL_COLOR_TOKENS.length} controls</span>}>
                {colorSearchField}
                <div className="col-span-full grid gap-3 @lg/fields:grid-cols-2">
                  {CONTROL_COLOR_TOKENS.filter(matchesColor).map((t) => tokenCard(t))}
                </div>
                <Note>Only valid hex / rgba values are applied — anything else is ignored by the app.</Note>
              </Section>
            )}

            {active === "scale" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}>
                <Field label={`Scale · ${fontScale}×`} full hint="Exact sizes apply first, then this scale. Line heights follow proportionally so text does not overlap.">
                  <div className="flex min-h-[44px] items-center gap-4">
                    <span className="text-[14px] text-ink2">Smaller</span>
                    <input type="range" min={0.85} max={1.3} step={0.05} value={fontScale} aria-label="Type scale"
                      onChange={(e) => { setFontScale(Number(e.target.value)); setDirty(true); }} className="h-11 flex-1 accent-[var(--color-primary)]" />
                    <span className="text-[14px] text-ink2">Larger</span>
                    <StudioBtn kind="ghost" onClick={() => { setFontScale(1); setDirty(true); }}>1×</StudioBtn>
                  </div>
                </Field>
                <div className="col-span-full rounded-[12px] border border-border bg-ivory p-5">
                  <div style={{ fontSize: previewFont(22), fontWeight: 800, color: P.textPrimary }}>Good morning, Sana</div>
                  <div style={{ fontSize: previewFont(17), fontWeight: 700, color: P.textPrimary, marginTop: 8 }}>Popular treatments</div>
                  <div style={{ fontSize: previewFont(13), color: P.textSecondary, marginTop: 4 }}>Body copy — descriptions and supporting text scale together, so nothing falls out of step.</div>
                  <div style={{ fontSize: previewFont(11), color: P.textSecondary, marginTop: 4, opacity: 0.7 }}>Captions and metadata</div>
                </div>
              </Section>
            )}

            {active === "sizes" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}
                right={<span className="text-[14px] text-ink3">{Object.keys(sizeOverrides).length} changed</span>}>
                <div className="col-span-full grid gap-3 @lg/fields:grid-cols-2">
                  {FONT_SIZE_TOKENS.map((t) => {
                    const key = String(t.base);
                    const overridden = key in sizeOverrides;
                    const value = sizeOverrides[key] ?? t.base;
                    return (
                      <div key={key} className={`grid gap-3 rounded-[12px] border p-4 ${overridden ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold text-ink">{t.label}</div>
                            <div className="mt-0.5 text-[12.5px] leading-5 text-ink3">{t.hint}</div>
                          </div>
                          {overridden && <StudioBtn kind="link" small onClick={() => { setSizeOverrides((s) => { const n = { ...s }; delete n[key]; return n; }); setDirty(true); }}>Reset</StudioBtn>}
                        </div>
                        <div className="flex items-center gap-2">
                          <NumberInput min={8} max={48} step={0.5} value={value} className="!w-[110px]"
                            onChange={(v) => { const n = Number(v); setSizeOverrides((s) => ({ ...s, [key]: n })); setDirty(true); }} />
                          <span className="text-[14px] text-ink3">px</span>
                          <span className="ml-auto truncate" style={{ fontSize: Math.min(28, value * fontScale), color: P.textPrimary }}>Aa</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {active === "copy" && (
              <Section title={sec.title} blurb={sec.blurb} aside={preview}>
                <Field label="Find a string" full>
                  <Input value={search} onChange={setSearch} placeholder="Search copy — key, label or text…" />
                </Field>
                {COPY_GROUPS.map((g) => {
                  const term = search.toLowerCase();
                  const entries = g.entries.filter((e) => !term || e.key.includes(term) || e.label.toLowerCase().includes(term) || e.default.toLowerCase().includes(term) || (copy[e.key] ?? "").toLowerCase().includes(term));
                  if (!entries.length) return null;
                  return (
                    <div key={g.title} className="col-span-full grid gap-4">
                      <SubHeading title={g.title} right={<span className="text-[14px] text-ink3">{entries.length}</span>} />
                      {entries.map((e) => {
                        const overridden = !!copy[e.key]?.trim();
                        return (
                          <Field key={e.key} label={e.label} hint={<span className="font-mono">{e.key}</span>}>
                            <div className="flex items-center gap-2">
                              <Input value={copy[e.key] ?? ""} placeholder={e.default}
                                onChange={(v) => { setCopy((c) => ({ ...c, [e.key]: v })); setDirty(true); }}
                                className={overridden ? "!border-primary/40 !bg-primary/[0.04]" : ""} />
                              {overridden
                                ? <StudioBtn kind="link" small onClick={() => { setCopy((c) => { const n = { ...c }; delete n[e.key]; return n; }); setDirty(true); }}>Reset</StudioBtn>
                                : <span className="shrink-0 text-[12.5px] text-ink3">default</span>}
                            </div>
                          </Field>
                        );
                      })}
                    </div>
                  );
                })}
              </Section>
            )}
          </>
        )}
      </Async>
    </StudioPage>
  );
}
