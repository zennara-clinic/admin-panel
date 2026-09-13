import { Component, useLayoutEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Toggle } from "./ui";
import { useStore } from "./store";
import api from "./lib/api";

/*
 * App Studio's own layout system.
 *
 * The rest of the panel is a dense operations tool and reads well at 12–13px.
 * App Studio is a content editor: an admin sits in it for minutes at a time
 * typing copy, so everything here runs at the panel's 14px base or above, with
 * one section on screen at a time and the publish control always in reach.
 *
 * Nothing outside src/pages/studio.tsx and the two App Studio exports in
 * src/pages/content.tsx uses these. ui.tsx's primitives stay untouched.
 */

/* =====================================================================
 * Section state — which part of a page is open, remembered per page
 * =================================================================== */
export type StudioSection = { id: string; title: string; blurb?: string; count?: number | string };

/**
 * The active section id for a page, persisted in localStorage so a reload
 * lands the admin where they were. If the saved id no longer exists (a
 * section that only shows when its data is present), the first one wins.
 */
export function useStudioSection(pageId: string, sections: StudioSection[], initial?: string): [string, (id: string) => void] {
  const key = `zennara.studio.section.${pageId}`;
  const [active, setActiveState] = useState<string>(() => {
    try { const v = localStorage.getItem(key); if (v) return v; } catch { /* private mode */ }
    return initial ?? sections[0]?.id ?? "";
  });
  const setActive = (id: string) => {
    setActiveState(id);
    try { localStorage.setItem(key, id); } catch { /* private mode */ }
  };
  const resolved = sections.some((s) => s.id === active) ? active : (sections[0]?.id ?? "");
  return [resolved, setActive];
}

/* =====================================================================
 * Page scaffold — rail + content pane + footer
 * =================================================================== */
/**
 * Fills the space under the panel header exactly, so the content pane is the
 * thing that scrolls and the rail and publish bar never move. The shell's
 * <main> is `overflow-x-hidden`, which makes any `position: sticky` inside it
 * inert, so the page measures its own offset instead of relying on sticky.
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current; if (!el) return;
      setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return { ref, height: `calc(100vh - ${top ?? 72}px - 20px)` };
}

export function StudioPage({ title, intro, sections, active, onSection, actions, children, footer }: {
  title: string;
  intro: string;
  sections: StudioSection[];
  active: string;
  onSection: (id: string) => void;
  /** Page-level actions (Reset to defaults, Add banner…) — shown under the intro. */
  actions?: ReactNode;
  children: ReactNode;
  /** Normally a <PublishBar>. Sits at the bottom of the content pane. */
  footer?: ReactNode;
}) {
  const { ref, height } = useFillHeight();
  const showRail = sections.length > 1;
  return (
    <div ref={ref} className="flex w-full min-w-0 flex-col" style={{ height, minHeight: 480 }}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-8">
        {/* ---- rail (left on ≥1024px, header + segmented control below) ---- */}
        <div className="flex shrink-0 flex-col gap-4 lg:w-[208px] lg:overflow-y-auto lg:pb-4 xl:w-[240px]">
          <div className="lg:pr-2">
            <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
            <p className="mt-1.5 text-[14px] leading-6 text-ink2">{intro}</p>
            {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
          </div>
          {showRail && (
            <nav aria-label={`${title} sections`}
              className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 no-scrollbar lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
              {sections.map((s) => {
                const on = s.id === active;
                return (
                  <button key={s.id} type="button" onClick={() => onSection(s.id)} aria-current={on ? "page" : undefined}
                    className={`relative flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-left text-[15px] transition-colors lg:whitespace-normal ${
                      on ? "bg-primary/[0.07] font-semibold text-primary" : "font-medium text-ink2 hover:bg-sage hover:text-ink"}`}>
                    {on && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-primary" />}
                    <span className="min-w-0 flex-1">{s.title}</span>
                    {s.count !== undefined && s.count !== "" && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12.5px] font-semibold tabular-nums ${on ? "bg-primary text-white" : "bg-sage text-ink2"}`}>{s.count}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* ---- content pane: the only thing that scrolls ---- */}
        <div className="@container/pane min-h-0 min-w-0 flex-1 overflow-y-auto rounded-(--radius-card) border border-border bg-surface">
          <div className="mx-auto w-full max-w-[880px] px-6 py-8">{children}</div>
        </div>
      </div>
      {footer && <div className="shrink-0 pt-4">{footer}</div>}
    </div>
  );
}

/* =====================================================================
 * Section — title, blurb, a two-column field grid and an optional aside
 * =================================================================== */
export function Section({ title, blurb, children, aside, right }: {
  title: string; blurb?: string; children: ReactNode;
  /** A preview or summary rendered to the right of the fields on wide panes. */
  aside?: ReactNode;
  /** A control next to the title (a link out, a count). */
  right?: ReactNode;
}) {
  return (
    <section className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold leading-7 text-ink">{title}</h2>
          {blurb && <p className="mt-1 max-w-[640px] text-[14px] leading-6 text-ink2">{blurb}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      {/* The fields column is its own query container, so a two-column grid
          only appears when the column itself (not the pane) is wide enough —
          beside a phone preview at 1280px it stays single-column. */}
      {aside ? (
        <div className="grid items-start gap-8 @2xl/pane:grid-cols-[minmax(0,1fr)_300px]">
          <div className="@container/fields min-w-0"><div className="grid gap-6 @lg/fields:grid-cols-2">{children}</div></div>
          <div className="mx-auto w-full max-w-[300px] @2xl/pane:mx-0">{aside}</div>
        </div>
      ) : (
        <div className="@container/fields min-w-0"><div className="grid gap-6 @lg/fields:grid-cols-2">{children}</div></div>
      )}
    </section>
  );
}

/** A second heading inside one section (e.g. "All tokens" under Palette). */
export function SubHeading({ title, blurb, right }: { title: string; blurb?: string; right?: ReactNode }) {
  return (
    <div className="col-span-full flex flex-wrap items-end justify-between gap-3 border-t border-border pt-6">
      <div>
        <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        {blurb && <p className="mt-0.5 text-[14px] leading-6 text-ink2">{blurb}</p>}
      </div>
      {right}
    </div>
  );
}

/* =====================================================================
 * Field + controls
 * =================================================================== */
export function Field({ label, hint, error, full, children, className = "" }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; full?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${full ? "col-span-full" : ""} ${className}`}>
      {label && <label className="text-[14px] font-semibold leading-5 text-ink">{label}</label>}
      {children}
      {error ? <div className="text-[12.5px] leading-5 text-err">{error}</div>
        : hint ? <div className="text-[12.5px] leading-5 text-ink3">{hint}</div> : null}
    </div>
  );
}

const CONTROL = "st-control w-full min-h-[44px] rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[15px] leading-6 text-ink placeholder:text-ink3 disabled:cursor-not-allowed disabled:bg-ivory disabled:text-ink3";

export function Input({ value, onChange, placeholder, type = "text", readOnly, disabled, mono, className = "", id }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; type?: string;
  readOnly?: boolean; disabled?: boolean; mono?: boolean; className?: string; id?: string;
}) {
  return (
    <input id={id} type={type} value={value} placeholder={placeholder} readOnly={readOnly} disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${CONTROL} ${readOnly ? "bg-ivory text-ink2" : ""} ${mono ? "font-mono text-[14px]" : ""} ${className}`} />
  );
}

export function NumberInput({ value, onChange, placeholder, readOnly, min, max, step, className = "" }: {
  value: string | number; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean;
  min?: number; max?: number; step?: number; className?: string;
}) {
  return (
    <input type="number" value={value} placeholder={placeholder} readOnly={readOnly} min={min} max={max} step={step}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${CONTROL} tabular-nums ${readOnly ? "bg-ivory text-ink2" : ""} ${className}`} />
  );
}

export function Textarea({ value, onChange, placeholder, rows = 3, className = "", large }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string;
  /** Document editing — 16px / 1.6 line height. */
  large?: boolean;
}) {
  return (
    <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} resize-y ${large ? "text-[16px] leading-[1.6]" : ""} ${className}`} />
  );
}

export function Select({ value, onChange, options, className = "" }: {
  value: string; onChange: (v: string) => void;
  options: (string | { value: string; label: string })[]; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} appearance-none pr-10`}>
        {options.map((o) => (typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
    </div>
  );
}

/** Two-to-four way choice shown as a segmented control (Zenoti live / Manual). */
export function Segmented({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex min-h-[44px] flex-wrap gap-1 rounded-[10px] border border-border bg-ivory p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on}
            className={`min-h-[34px] rounded-[7px] px-4 text-[14px] font-semibold transition-colors ${on ? "bg-primary text-white" : "text-ink2 hover:bg-surface hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleRow({ label, description, on, onChange, full }: {
  label: ReactNode; description?: ReactNode; on: boolean; onChange?: (v: boolean) => void; full?: boolean;
}) {
  return (
    <label className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-4 rounded-[10px] border border-border bg-surface px-4 py-2.5 ${full ? "col-span-full" : ""}`}>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-5 text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-5 text-ink2">{description}</span>}
      </span>
      <Toggle on={on} onChange={onChange} />
    </label>
  );
}

/**
 * Picture with a preview, a URL and an upload button. `uploadAs` sends the
 * file through the App Studio image endpoint (which replaces and publishes
 * the image immediately, then `onUploaded` reloads); without it, only the URL
 * can be edited. A file dropped on the block uploads the same way.
 */
export function ImageInput({ value, onChange, uploadAs, onUploaded, placeholder = "https://…", emptyLabel = "No image yet", ratio = "16/9", contain }: {
  value: string; onChange: (v: string) => void;
  uploadAs?: "appLogo" | "heroBanner" | "zenMembershipCard";
  onUploaded?: () => void; placeholder?: string; emptyLabel?: string;
  /** CSS aspect-ratio of the thumbnail. */
  ratio?: string;
  /** Fit the whole image inside the thumbnail (logos) instead of filling it. */
  contain?: boolean;
}) {
  const { toast } = useStore();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const upload = async (file: File) => {
    if (!uploadAs) return;
    setBusy(true);
    try {
      await api.appStudio.uploadImage(uploadAs, file);
      toast("Image uploaded and published");
      onUploaded?.();
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div
      onDragOver={uploadAs ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={uploadAs ? () => setOver(false) : undefined}
      onDrop={uploadAs ? (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && f.type.startsWith("image/")) void upload(f); } : undefined}
      className={`grid gap-4 rounded-[12px] border border-dashed p-3 transition-colors @md/fields:grid-cols-[176px_minmax(0,1fr)] ${over ? "border-primary bg-primary/[0.04]" : "border-border bg-ivory"}`}>
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface" style={{ aspectRatio: ratio }}>
        {value
          ? <img src={value} alt="" className={`h-full w-full ${contain ? "object-contain p-3" : "object-cover"}`} />
          : <div className="grid h-full w-full place-items-center px-3 text-center text-[14px] leading-5 text-ink3">{emptyLabel}</div>}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <Input value={value} onChange={onChange} placeholder={placeholder} />
        {uploadAs && (
          <div className="flex flex-wrap items-center gap-3">
            <StudioBtn kind="ghost" disabled={busy} onClick={() => ref.current?.click()}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</> : <><Upload className="h-4 w-4" /> Upload image</>}
            </StudioBtn>
            <span className="text-[12.5px] leading-5 text-ink3">Uploading replaces the image and publishes it immediately.</span>
            <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await upload(file);
              e.target.value = "";
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
 * Buttons, tags, notes, rows
 * =================================================================== */
export function StudioBtn({ children, kind = "primary", onClick, disabled, className = "", type = "button", small, title }: {
  children: ReactNode; kind?: "primary" | "ghost" | "danger" | "link"; onClick?: () => void; disabled?: boolean;
  className?: string; type?: "button" | "submit"; title?: string;
  /** A compact secondary control inside a row (Reset, Edit link) — 36px rather than 44px. */
  small?: boolean;
}) {
  const k = {
    primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-dis-bg disabled:text-dis",
    ghost: "border border-border bg-surface text-ink2 hover:bg-ivory hover:text-ink disabled:bg-dis-bg disabled:text-dis",
    danger: "border border-err/30 bg-surface text-err hover:bg-err-bg disabled:text-dis",
    link: "text-primary hover:underline underline-offset-4 disabled:text-dis",
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[14px] font-semibold transition-colors disabled:cursor-not-allowed ${
        small ? "min-h-[36px] px-3" : "min-h-[44px] px-4"} ${kind === "link" ? "!px-1" : ""} ${k} ${className}`}>
      {children}
    </button>
  );
}

export type StudioTagKind = "ok" | "warn" | "err" | "info" | "mute" | "primary";
export function StatusTag({ kind, children }: { kind: StudioTagKind; children: ReactNode }) {
  const k = {
    ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", err: "bg-err-bg text-err",
    info: "bg-info-bg text-info", mute: "bg-dis-bg text-ink2", primary: "bg-primary/[0.08] text-primary",
  }[kind];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[14px] font-semibold ${k}`}>{children}</span>;
}

export function Note({ kind = "info", children, className = "" }: { kind?: "info" | "warn" | "err" | "ok"; children: ReactNode; className?: string }) {
  const k = {
    info: "border-primary/25 bg-primary/[0.04] text-ink2",
    warn: "border-warn bg-warn-bg text-warn",
    err: "border-err bg-err-bg text-err",
    ok: "border-ok bg-ok-bg text-ok",
  }[kind];
  return <div className={`col-span-full rounded-r-[10px] border-l-[3px] px-4 py-3 text-[14px] leading-6 ${k} ${className}`}>{children}</div>;
}

/** A list row: at least 44px, white on a hairline, everything inside at 14–15px. */
export function Row({ children, muted, className = "", onClick }: { children: ReactNode; muted?: boolean; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className={`flex min-h-[44px] items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-2 ${muted ? "opacity-60" : ""} ${onClick ? "cursor-pointer transition-colors hover:bg-ivory" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** Up / down reorder pair. */
export function OrderButtons({ onUp, onDown, upDisabled, downDisabled }: { onUp: () => void; onDown: () => void; upDisabled?: boolean; downDisabled?: boolean }) {
  const cls = "grid h-9 w-9 place-items-center rounded-[8px] border border-border bg-surface text-ink2 hover:bg-ivory hover:text-ink disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" onClick={onUp} disabled={upDisabled} aria-label="Move up" className={cls}><ChevronUp className="h-4 w-4" /></button>
      <button type="button" onClick={onDown} disabled={downDisabled} aria-label="Move down" className={cls}><ChevronDown className="h-4 w-4" /></button>
    </span>
  );
}

export function RemoveButton({ onClick, label = "Remove" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-ink3 hover:bg-err-bg hover:text-err">
      <X className="h-4 w-4" />
    </button>
  );
}

export function StudioEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="col-span-full rounded-[12px] border border-dashed border-border bg-ivory px-6 py-12 text-center">
      <div className="text-[16px] font-semibold text-ink">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-[460px] text-[14px] leading-6 text-ink2">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Non-blocking banner for a failed refresh when the last good data is still on screen. */
export function StudioStale({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-[10px] border border-warn bg-warn-bg px-4 py-3 text-[14px] text-warn">
      <span>Showing the last good data — {error}</span>
      <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 font-semibold underline underline-offset-4"><RefreshCw className="h-4 w-4" /> Retry</button>
    </div>
  );
}

/* =====================================================================
 * Publish bar — always visible at the bottom of the content pane
 * =================================================================== */
export function PublishBar({ dirty, busy, err, onPublish, onDiscard, canEdit, lastSavedAt, publishLabel = "Publish to app", permissionNote }: {
  dirty: boolean; busy: boolean; err: string | null;
  onPublish: () => void; onDiscard: () => void; canEdit: boolean;
  lastSavedAt?: string | null; publishLabel?: string;
  permissionNote?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-border bg-surface px-5 py-3 shadow-[0_-6px_24px_rgba(3,47,34,0.06)]">
      <div className="flex min-w-0 items-center gap-3 text-[14px]">
        {err ? (
          <span className="flex items-center gap-2 font-semibold text-err"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-err" />{err}</span>
        ) : dirty ? (
          <span className="flex items-center gap-2 font-semibold text-warn"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warn" />Unsaved changes</span>
        ) : (
          <span className="flex items-center gap-2 font-semibold text-ok"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ok" />All changes published</span>
        )}
        {lastSavedAt && !err && <span className="hidden text-ink3 sm:inline">· Last published {lastSavedAt}</span>}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <StudioBtn kind="ghost" disabled={!dirty || busy} onClick={onDiscard}>Discard</StudioBtn>
          <StudioBtn disabled={!dirty || busy} onClick={onPublish}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : publishLabel}
          </StudioBtn>
        </div>
      ) : (
        <span className="text-[14px] text-ink2">{permissionNote ?? "You can see what the app is showing, but publishing changes needs the “edit app home, control & content” permission."}</span>
      )}
    </div>
  );
}

/* =====================================================================
 * Phone preview — an honest mock of a screen, never able to break the editor
 * =================================================================== */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Studio preview error:", error, info.componentStack); }
  render() {
    if (this.state.failed) {
      return <div className="grid h-full place-items-center px-6 text-center text-[14px] leading-5 text-ink3">The preview could not draw this draft. The editor still works.</div>;
    }
    return this.props.children;
  }
}

/** The app's palette, for the mocks only. */
export const APP = { primary: "#2c3e2f", cream: "#f6f0e6", ivory: "#faf8f4", ink: "#111714", ink2: "#4f5853", ink3: "#7a827e", gold: "#e0c391", surface: "#ffffff", border: "#e8e3da" };

export function PhonePreview({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <figure className="m-0 grid justify-items-center gap-3">
      <div className="w-[300px] overflow-hidden rounded-[28px] border-[6px] border-[#1b1f1d] bg-[#1b1f1d] shadow-[0_18px_40px_rgba(3,47,34,0.18)]" style={{ height: 620 }}>
        <div className="flex h-full flex-col overflow-hidden rounded-[22px] bg-white">
          <div className="flex h-8 shrink-0 items-center justify-between px-5 text-[11px] font-semibold text-white" style={{ background: APP.primary }} aria-hidden>
            <span>9:41</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-white/80" /><span className="inline-block h-2 w-2 rounded-full bg-white/80" /><span className="inline-block h-2 w-4 rounded-sm bg-white/80" /></span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden" style={{ fontFamily: "var(--font-sans)", color: APP.ink }}>
            <PreviewBoundary>{children}</PreviewBoundary>
          </div>
        </div>
      </div>
      {caption && <figcaption className="text-center text-[12.5px] leading-5 text-ink3">{caption}</figcaption>}
    </figure>
  );
}
