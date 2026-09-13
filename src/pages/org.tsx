import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { AreaChart, Async, B, DeleteModal, GBars, HBars, Modal, RatingValue, Stars, Toggle, exportCsv } from "../ui";
import {
  CellStack, ChartPanel, ChoicePills, DateInput, DetailList, Field, FilterBar, ImageInput, Input, KeyValue, Note, NumberInput, RemoveButton, Row,
  SearchInput, Section, Segmented, Select, StatGrid, StatusTag, StudioBtn, StudioEmpty, StudioHint, StudioPage, StudioSheet, StudioStale,
  StudioTable, SubHeading, Textarea, ToggleRow, useStudioSection, type StudioSection,
} from "../studio-ui";
import { useStore, ROLE_LABEL } from "../store";
import { DEFAULT_METRIC_RANGE, METRIC_RANGES, customWindow, isMetricRange, metricWindow, type MetricRange } from "../lib/ranges";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import {
  clinicWeekday, fmtCompactINR, fmtDate, fmtDateFull, fmtDayKey, fmtINR, fmtWhen,
  initials, isoDay, nameOf, pct,
} from "../lib/format";
import type { Admin, AdminRole, AuditEntry, Branch, ConsultationReview, PermissionGroup, PermissionKey, ProductReview, Role, ServiceReview, StaffAssignment } from "../lib/types";
import { SESSION_SLOT_MINUTES } from "../lib/scheduling";
import { RolesManager, SignInSecurityTab, StaffAccessFields, RoleChip, useCatalog, CentreRolesEditor, SignInControls } from "./access";

/*
 * The Organisation pages — Branches, Reviews, Analytics, Staff & roles and
 * the Audit log — share App Studio's layout (src/studio-ui.tsx): a 24px title
 * and intro on the left, one section on screen at a time, everything at 14px
 * or above. The data hooks, API calls, permissions and state are unchanged
 * from the dense version; only the presentation moved.
 */

/* ================= BRANCHES ================= */
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const DAY_LABEL: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const dayKeyOf = (iso: string) => DAYS[(clinicWeekday(iso) + 6) % 7]; // Monday-first

/** Today's status for a centre — closure first, then the weekly hours. */
function branchToday(b: Branch, iso = isoDay()) {
  const closure = (b.closures ?? []).find((c) => c.date <= iso && (c.to ? c.to >= iso : c.date === iso));
  if (!b.isActive) return { open: false, label: "Inactive", reason: "Centre inactive" };
  if (closure) return { open: false, label: "Closed today", reason: closure.reason || "Closed" };
  const h = (b.operatingHours ?? {})[dayKeyOf(iso)] ?? {};
  if (h.isOpen === false) return { open: false, label: "Closed today", reason: "Weekly off" };
  return { open: true, label: `Open ${h.openTime ?? h.open ?? "10:00"}–${h.closeTime ?? h.close ?? "19:00"}`, reason: "" };
}

const CENTRE_TYPE_LABEL: Record<string, string> = { clinic: "Clinic", pharmacy: "Pharmacy", training: "Training centre" };

export function Branches() {
  const { toast, audit, reloadBranches, can } = useStore();
  const [sel, setSel] = useState<Branch | null>(null);
  const [view, setView] = useState<Branch | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState<Branch | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [closeFor, setCloseFor] = useState<Branch | null>(null);
  const [closeDate, setCloseDate] = useState(isoDay());
  const [closeTo, setCloseTo] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [closureCentre, setClosureCentre] = useState("");

  // The one place that shows every Zenoti centre, stock locations included.
  const q = useApi(() => api.branches.list({ activeOnly: "false" }), []);
  const list = q.data ?? [];
  const docs = useApi(() => api.doctors.list({ includeInactive: "true" }).catch(() => ({ success: true, data: [] })), []);
  const doctorCount = (b: Branch) => (docs.data?.data ?? []).filter((d) => d.isActive && (d.availableCentres ?? []).includes(b.name)).length;

  const addressLine = (b: Branch) => {
    if (typeof b.address === "string") return b.address;
    const a = b.address ?? {};
    return [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(", ") || "—";
  };

  const saveClosures = async (b: Branch, closures: NonNullable<Branch["closures"]>, msg: string) => {
    try {
      await api.branches.update(b._id, { closures } as Partial<Branch>);
      audit("BRANCH_UPDATED", `${b.name} · ${msg}`, { branchId: b._id });
      toast(msg); q.reload(); reloadBranches();
      if (view && view._id === b._id) setView({ ...view, closures });
    } catch (e) { toast((e as Error).message); }
  };

  const openClosure = (b: Branch) => { setCloseFor(b); setCloseDate(isoDay()); setCloseTo(""); setCloseReason(""); };
  const isClosedNow = (c: { date: string; to?: string | null }) => c.date <= isoDay() && (c.to ? c.to >= isoDay() : c.date === isoDay());
  const sameClosure = (x: NonNullable<Branch["closures"]>[number], c: NonNullable<Branch["closures"]>[number]) =>
    x.date === c.date && (x.to ?? null) === (c.to ?? null) && (x.reason ?? "") === (c.reason ?? "");

  // Every closure still to come, across all centres — the Closures section.
  const upcomingAll = useMemo(() =>
    list.flatMap((b) => (b.closures ?? []).filter((c) => (c.to ?? c.date) >= isoDay()).map((c) => ({ b, c })))
      .sort((x, y) => x.c.date.localeCompare(y.c.date)), [list]);

  const sections: StudioSection[] = [
    { id: "centres", title: "All centres", count: list.length || undefined },
    { id: "closures", title: "Closures & holidays", count: upcomingAll.length || undefined },
  ];
  const [active, setActive] = useStudioSection("branches", sections);
  const closureFor = list.find((b) => b._id === closureCentre) ?? list.find((b) => b.isActive) ?? list[0];

  const exportBranches = () => exportCsv("zennara-branches",
    ["Name", "Address", "Phone", "Email", "Today", "Active"],
    list.map((b) => [b.name, addressLine(b), (b.contact?.phone ?? []).join(" / "), b.contact?.email ?? "", branchToday(b).label, b.isActive ? "yes" : "no"]));

  return (
    <StudioPage title="Branches" sections={sections} active={active} onSection={setActive}
      intro="Every centre, stock locations included. Dermatologists, bookings, chat and the app's centre picker all follow this list."
      actions={<>
        <StudioBtn onClick={() => setAddOpen(true)}>Add centre</StudioBtn>
        <StudioBtn kind="ghost" disabled={!list.length} onClick={exportBranches}>Export CSV</StudioBtn>
      </>}>
      <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />

      {active === "centres" && (
        <Section title="All centres"
          blurb="Each centre's weekly hours and closures decide when dermatologists can be booked there — slots outside the centre's hours never appear in the app. Use “Close today” for a holiday or an unexpected shutdown.">
          <div className="col-span-full">
            <Async q={q} label="Loading centres…" rows={4}>
              {() => list.length === 0 ? (
                <StudioEmpty title="No centres yet"
                  hint="A branch is the unit everything routes by — dermatologists, bookings, chat and stock. Add the first one."
                  action={<StudioBtn onClick={() => setAddOpen(true)}>Add centre</StudioBtn>} />
              ) : (
                <div className="grid gap-4">
                  {list.map((b) => {
                    const today = branchToday(b);
                    const upcoming = (b.closures ?? []).filter((c) => (c.to ?? c.date) >= isoDay()).sort((x, y) => x.date.localeCompare(y.date));
                    const phones = (b.contact?.phone ?? []).join(" / ");
                    const n = doctorCount(b);
                    return (
                      <div key={b._id} className={`rounded-[12px] border border-border bg-surface p-4 ${b.isActive ? "" : "opacity-60"}`}>
                        <div className="flex flex-wrap items-start gap-4">
                          {b.images?.[0]
                            ? <img src={b.images[0]} alt="" className="h-[72px] w-[72px] shrink-0 rounded-[10px] border border-border object-cover" />
                            : <div className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[10px] bg-sage text-[20px] font-semibold text-primary">{initials(b.name)}</div>}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[16px] font-semibold leading-6 text-ink">{b.name}</span>
                              <StatusTag kind={!b.isActive ? "mute" : today.open ? "ok" : "err"}>{today.label}</StatusTag>
                              {b.centreType && b.centreType !== "clinic" && <StatusTag kind="mute">{CENTRE_TYPE_LABEL[b.centreType] ?? b.centreType}</StatusTag>}
                            </div>
                            <div className="mt-0.5 text-[14px] leading-5 text-ink2">{addressLine(b)}</div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[14px] leading-5 text-ink3">
                              <span>{phones || "No phone"}</span>
                              <span>{n} dermatologist{n === 1 ? "" : "s"}</span>
                              {upcoming.length > 0 && <span className="text-warn">{upcoming.length} closure{upcoming.length === 1 ? "" : "s"} ahead</span>}
                            </div>
                            {!today.open && today.reason && <div className="mt-1 text-[14px] leading-5 text-err">{today.reason}</div>}
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-7 gap-1.5">
                          {DAYS.map((d) => {
                            const h = (b.operatingHours ?? {})[d] ?? {};
                            const off = h.isOpen === false;
                            return (
                              <div key={d} className={`rounded-[8px] px-1 py-1.5 text-center ${off ? "bg-ivory text-ink3" : "bg-sage text-primary"}`}
                                title={off ? "Closed" : `${h.openTime ?? h.open ?? "10:00"}–${h.closeTime ?? h.close ?? "19:00"}`}>
                                <div className="text-[12.5px] font-semibold leading-5">{DAY_LABEL[d]}</div>
                                <div className="text-[14px] leading-5 tabular-nums">{off ? "—" : (h.openTime ?? h.open ?? "10:00").slice(0, 5)}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                          <StudioBtn kind="ghost" small onClick={() => setView(b)}>View details</StudioBtn>
                          <StudioBtn kind="ghost" small onClick={() => setSel(b)}>Edit</StudioBtn>
                          {b.isActive && (today.open || today.reason === "Weekly off"
                            ? <StudioBtn kind="ghost" small className="!text-err" onClick={() => openClosure(b)}>Close today</StudioBtn>
                            : <StudioBtn kind="ghost" small className="!text-ok" onClick={() => saveClosures(b, (b.closures ?? []).filter((c) => !isClosedNow(c)), "Reopened today")}>Reopen today</StudioBtn>)}
                          <StudioBtn kind="ghost" small onClick={async () => {
                            try {
                              await api.branches.toggle(b._id);
                              audit("BRANCH_UPDATED", `${b.name} ${b.isActive ? "deactivated" : "activated"}`, { branchId: b._id });
                              toast(`${b.name} ${b.isActive ? "deactivated" : "activated"}`); q.reload(); reloadBranches();
                            } catch (e) { toast((e as Error).message); }
                          }}>{b.isActive ? "Deactivate centre" : "Activate centre"}</StudioBtn>
                          <StudioBtn kind="link" small className="ml-auto !text-err" onClick={() => setDel(b)}>Delete</StudioBtn>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Async>
          </div>

          <Note>
            Deleting a branch <B>deactivates</B> it rather than erasing it, because bookings, chats and stock still point
            at it. An inactive centre disappears from the app's picker and from the branch switcher here.
            {!can("branches.manage") && " Permanent deletion is a super-admin action."}
          </Note>
          {can("branches.manage") && (
            <ToggleRow full label="Super admin: erase permanently on the next delete"
              description="Cannot be undone; history keeps the name only." on={permanent} onChange={setPermanent} />
          )}
        </Section>
      )}

      {active === "closures" && (
        <Section title="Closures & holidays"
          blurb="Every closure still to come, across all centres. No appointments can be booked for a closed day; existing bookings stay as they are — call those guests.">
          <Field label="Add a closure" full hint="Pick the centre, then choose the dates and a reason.">
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[240px] flex-1">
                <Select value={closureFor?._id ?? ""} onChange={setClosureCentre}
                  options={list.map((b) => ({ value: b._id, label: b.isActive ? b.name : `${b.name} (inactive)` }))} />
              </div>
              <StudioBtn disabled={!closureFor} onClick={() => { if (closureFor) openClosure(closureFor); }}>Add closure</StudioBtn>
            </div>
          </Field>
          <div className="col-span-full">
            <Async q={q} label="Loading centres…" rows={3}>
              {() => upcomingAll.length === 0 ? (
                <StudioEmpty title="No closures ahead" hint="Holidays and shutdowns you add here, or with “Close today” on a centre, appear in this list." />
              ) : (
                <div className="grid gap-2">
                  {upcomingAll.map(({ b, c }, i) => (
                    <Row key={`${b._id}-${c.date}-${i}`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold leading-6 text-ink">{b.name}</div>
                        <div className="text-[14px] leading-5 text-ink2">
                          {fmtDateFull(c.date)}{c.to ? ` → ${fmtDateFull(c.to)}` : ""}{c.reason ? <span className="text-ink3"> · {c.reason}</span> : null}
                        </div>
                      </div>
                      {isClosedNow(c) && <StatusTag kind="err">Closed now</StatusTag>}
                      <RemoveButton label="Remove closure" onClick={() => saveClosures(b, (b.closures ?? []).filter((x) => !sameClosure(x, c)), "Closure removed")} />
                    </Row>
                  ))}
                </div>
              )}
            </Async>
          </div>
        </Section>
      )}

      {/* ---- detail sheet ---- */}
      <StudioSheet open={!!view} onClose={() => setView(null)} title={view?.name ?? ""} sub={view ? addressLine(view) : undefined} width={640}
        footer={view ? <>
          <StudioBtn kind="ghost" onClick={() => setView(null)}>Close</StudioBtn>
          <StudioBtn onClick={() => { setSel(view); setView(null); }}>Edit centre</StudioBtn>
        </> : undefined}>
        {view && (() => {
          const today = branchToday(view);
          const closures = [...(view.closures ?? [])].sort((x, y) => y.date.localeCompare(x.date));
          const todayKey = dayKeyOf(isoDay());
          return (
            <div className="grid gap-6">
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-err">
                <StatusTag kind={!view.isActive ? "mute" : today.open ? "ok" : "err"}>{today.label}</StatusTag>
                {!today.open && today.reason && <span>{today.reason}</span>}
              </div>
              <DetailList items={[
                ["Address", addressLine(view)],
                ["Phone", (view.contact?.phone ?? []).join(" / ") || "—"],
                ["Email", view.contact?.email || "—"],
                ["Dermatologists here", (docs.data?.data ?? []).filter((d) => (d.availableCentres ?? []).includes(view.name)).map((d) => d.name).join(", ") || "—"],
                !!view.amenities?.length && ["Amenities", view.amenities.join(", ")],
                view.location?.coordinates?.length === 2 && ["Map", <a key="map" className="font-semibold text-primary underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${view.location.coordinates[1]},${view.location.coordinates[0]}`}>Open in Google Maps</a>],
              ]} />
              {!!view.images?.length && (
                <div className="grid grid-cols-2 gap-2 @sm/fields:grid-cols-4">
                  {view.images.slice(0, 4).map((u) => <img key={u} src={u} alt="" className="h-24 w-full rounded-[10px] border border-border object-cover" />)}
                </div>
              )}
              <div className="grid gap-4">
                <SubHeading title="Weekly hours" />
                <div className="grid gap-2">
                  {DAYS.map((d) => {
                    const h = (view.operatingHours ?? {})[d] ?? {};
                    const off = h.isOpen === false;
                    const isToday = d === todayKey;
                    return (
                      <Row key={d} className={isToday ? "!border-primary/40 !bg-primary/[0.04]" : ""}>
                        <span className="w-14 text-[15px] font-semibold text-ink">{DAY_LABEL[d]}</span>
                        <span className={`text-[14px] tabular-nums ${off ? "text-ink3" : "text-ink"}`}>{off ? "Closed" : `${h.openTime ?? h.open ?? "10:00"} – ${h.closeTime ?? h.close ?? "19:00"}`}</span>
                        {isToday && <span className="ml-auto text-[12.5px] font-semibold text-primary">Today</span>}
                      </Row>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4">
                <SubHeading title="Closures & holidays" blurb={`${closures.length} on record.`}
                  right={<StudioBtn kind="ghost" small onClick={() => openClosure(view)}>Add closure</StudioBtn>} />
                {closures.length === 0 ? <div className="text-[14px] leading-6 text-ink3">No closures recorded.</div> : (
                  <div className="grid gap-2">
                    {closures.map((c, i) => (
                      <Row key={`${c.date}-${i}`} muted={(c.to ?? c.date) < isoDay()}>
                        <span className="min-w-0 flex-1 text-[14px] leading-5 text-ink">
                          <B>{fmtDateFull(c.date)}</B>{c.to ? ` → ${fmtDateFull(c.to)}` : ""}{c.reason ? <span className="text-ink3"> · {c.reason}</span> : null}
                        </span>
                        {(c.to ?? c.date) < isoDay() && <StatusTag kind="mute">past</StatusTag>}
                        <RemoveButton label="Remove closure" onClick={() => saveClosures(view, (view.closures ?? []).filter((x) => !sameClosure(x, c)), "Closure removed")} />
                      </Row>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </StudioSheet>

      {/* ---- close today / add closure ---- */}
      <Modal open={!!closeFor} onClose={() => setCloseFor(null)} title={closeFor ? `Close ${closeFor.name}` : ""}>
        <div className="@container/fields grid gap-4">
          <Note kind="warn">No appointments can be booked at this centre for the closed day(s); existing bookings stay as they are — call those guests.</Note>
          <div className="grid gap-4 @sm/fields:grid-cols-2">
            <Field label="From"><DateInput value={closeDate} onChange={setCloseDate} /></Field>
            <Field label="To (optional)" hint="Leave empty for a single day"><DateInput value={closeTo} onChange={setCloseTo} min={closeDate || undefined} /></Field>
            <Field label="Reason" full><Input value={closeReason} onChange={setCloseReason} placeholder="e.g. Public holiday, maintenance" /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <StudioBtn kind="ghost" onClick={() => setCloseFor(null)}>Cancel</StudioBtn>
            <StudioBtn kind="danger" disabled={!closeDate} onClick={async () => {
              if (!closeFor) return;
              await saveClosures(closeFor, [...(closeFor.closures ?? []), { date: closeDate, to: closeTo || null, reason: closeReason.trim() }], closeTo ? `Closed ${closeDate} → ${closeTo}` : closeDate === isoDay() ? "Closed today" : `Closed on ${closeDate}`);
              setCloseFor(null);
            }}>Close centre</StudioBtn>
          </div>
        </div>
      </Modal>

      <BranchEditor open={!!sel || addOpen} branch={sel}
        onClose={() => { setSel(null); setAddOpen(false); }}
        onSaved={() => { q.reload(); reloadBranches(); setSel(null); setAddOpen(false); }}
        onDelete={(b) => { setSel(null); setDel(b); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `branch "${del.name}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.branches.remove(del._id, permanent);
            audit("BRANCH_DELETED", `${del.name} · ${permanent ? "PERMANENTLY deleted" : "deactivated"} · reason: ${reason}`, { branchId: del._id });
            toast(permanent ? "Branch permanently deleted" : "Branch deactivated"); q.reload(); reloadBranches();
            setPermanent(false);
          } catch (e) { toast((e as Error).message); }
        }} />
    </StudioPage>
  );
}

function BranchEditor({ open, branch, onClose, onSaved, onDelete }: {
  open: boolean; branch: Branch | null; onClose: () => void; onSaved: () => void; onDelete: (b: Branch) => void;
}) {
  const { toast, audit } = useStore();
  const [f, setF] = useState<Partial<Branch>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const seed = branch ?? {
      name: "", address: { line1: "", city: "", state: "", pincode: "" }, contact: { phone: [""], email: "" },
      location: { type: "Point", coordinates: [0, 0] },
      slotDuration: SESSION_SLOT_MINUTES, isActive: true, displayOrder: 0, amenities: [], description: "", operatingHours: {},
    };
    // The model stores openTime/closeTime; this editor works in open/close.
    // Normalise both ways (here on load, and again on save) so a branch's real
    // hours actually show up and persist instead of silently resetting to 10-19.
    const oh = DAYS.reduce((acc, d) => {
      const h = ((seed.operatingHours ?? {}) as Record<string, any>)[d] ?? {};
      return { ...acc, [d]: { open: h.open ?? h.openTime ?? "10:00", close: h.close ?? h.closeTime ?? "19:00", isOpen: h.isOpen !== false } };
    }, {} as Record<string, { open: string; close: string; isOpen: boolean }>);
    setF({ ...seed, operatingHours: oh } as Partial<Branch>);
    setErr(null);
  }, [open, branch?._id]);

  const set = <K extends keyof Branch>(k: K) => (v: Branch[K]) => setF((s) => ({ ...s, [k]: v }));
  const addr = (typeof f.address === "object" ? f.address : {}) ?? {};
  const setAddr = (k: string) => (v: string) => setF((s) => ({ ...s, address: { ...(typeof s.address === "object" ? s.address : {}), [k]: v } }));
  const contact = f.contact ?? {};
  const setContact = (k: string) => (v: string) => setF((s) => ({ ...s, contact: { ...(s.contact ?? {}), [k]: v } }));
  // A centre has several lines; the model stores them as a list.
  const phones: string[] = Array.isArray(contact.phone) ? contact.phone : contact.phone ? [String(contact.phone)] : [""];
  const setPhones = (next: string[]) => setF((s) => ({ ...s, contact: { ...(s.contact ?? {}), phone: next } }));
  const coords = (f.location?.coordinates ?? [0, 0]) as number[];
  const setCoord = (i: 0 | 1) => (v: string) => setF((s) => {
    const c = [...((s.location?.coordinates ?? [0, 0]) as number[])];
    c[i] = Number(v) || 0;
    return { ...s, location: { type: "Point", coordinates: c } };
  });
  const hours = (f.operatingHours ?? {}) as Record<string, { open?: string; close?: string; isOpen?: boolean }>;
  const setHours = (day: string, patch: Partial<{ open: string; close: string; isOpen: boolean }>) =>
    setF((s) => ({
      ...s,
      operatingHours: { ...(s.operatingHours ?? {}), [day]: { ...((s.operatingHours ?? {})[day] ?? {}), ...patch } },
    }));

  // Centre cover image — stored as images[0], shown in the app's centre picker.
  const [uploadingImg, setUploadingImg] = useState(false);
  const image = f.images?.[0] ?? "";
  const setImage = (url: string) => setF((s) => ({ ...s, images: url ? [url] : [] }));
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setUploadingImg(true);
    try {
      const res = await api.media.upload([file]);
      const url = res?.[0]?.url;
      if (url) setImage(url);
      else setErr("Upload failed — no URL returned");
    } catch (err) {
      setErr((err as Error).message);
    } finally {
      setUploadingImg(false);
    }
  };

  const save = async () => {
    setErr(null);
    // Required by the Branch model — validated here so the user sees the field.
    if (!f.name?.trim()) return setErr("A branch name is required");
    if (!addr.line1?.trim()) return setErr("Address line 1 is required");
    if (!addr.pincode?.trim()) return setErr("A pincode is required");
    if (!contact.email?.trim()) return setErr("A contact email is required");
    const cleanPhones = phones.map((x) => x.trim()).filter(Boolean);
    if (!cleanPhones.length) return setErr("At least one contact phone is required — guests call it from the app");
    setBusy(true);
    try {
      // Persist BOTH the editor keys and the model's openTime/closeTime, so the
      // hours the clinic sets here actually reach the backend (and the app's
      // treatment-booking slots) instead of being stripped as unknown fields.
      const operatingHours = DAYS.reduce((acc, d) => {
        const h = ((f.operatingHours ?? {}) as Record<string, any>)[d] ?? {};
        const openTime = h.open ?? "10:00";
        const closeTime = h.close ?? "19:00";
        return { ...acc, [d]: { isOpen: h.isOpen !== false, openTime, closeTime, open: openTime, close: closeTime } };
      }, {} as Record<string, any>);
      const { _id, createdAt, updatedAt, ...rest } = f as Branch;
      void _id; void createdAt; void updatedAt;
      const body = {
        ...rest,
        contact: { ...(f.contact ?? {}), phone: cleanPhones },
        operatingHours,
        slotDuration: SESSION_SLOT_MINUTES,
        displayOrder: Number(f.displayOrder) || 0,
      } as Partial<Branch>;
      if (branch) {
        await api.branches.update(branch._id, body);
        audit("BRANCH_UPDATED", f.name, { branchId: branch._id });
        toast("Branch saved — booking hours and the app picker follow it");
      } else {
        const created = await api.branches.create(body);
        audit("BRANCH_CREATED", created.name, { branchId: created._id });
        toast(`${created.name} is live across the platform`);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <StudioSheet open={open} onClose={onClose} title={branch ? branch.name : "New centre"} width={640}
      sub={branch ? "Details, hours and billing for this centre." : "A new centre goes live across the platform as soon as it is saved."}
      footer={<>
        {err && <span className="mr-auto text-[14px] font-semibold leading-5 text-err">{err}</span>}
        {branch && <StudioBtn kind="danger" onClick={() => onDelete(branch)}>Deactivate</StudioBtn>}
        <StudioBtn disabled={busy} onClick={save}>{busy ? "Saving…" : branch ? "Save centre" : "Create centre"}</StudioBtn>
      </>}>
      <div className="grid gap-5 @lg/fields:grid-cols-2">
        <Field label="Centre name"><Input value={f.name ?? ""} onChange={set("name")} placeholder="e.g. Kondapur" /></Field>
        <Field label="Description (optional)"><Input value={f.description ?? ""} onChange={set("description")} /></Field>

        <SubHeading title="Centre image" blurb="Shown beside the centre in the app's centre picker." />
        <div className="col-span-full grid gap-3">
          <ImageInput value={image} onChange={setImage} emptyLabel="No image yet" />
          <label className={`inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-surface px-4 text-[14px] font-semibold text-ink2 hover:bg-ivory hover:text-ink ${uploadingImg ? "opacity-60" : ""}`}>
            <input type="file" accept="image/*" className="hidden" onChange={onPickImage} disabled={uploadingImg} />
            {uploadingImg ? "Uploading…" : image ? "Replace image" : "Upload an image"}
          </label>
        </div>

        <SubHeading title="Address" />
        <Field label="Address line 1" full><Input value={addr.line1 ?? ""} onChange={setAddr("line1")} /></Field>
        <Field label="Address line 2" full><Input value={addr.line2 ?? ""} onChange={setAddr("line2")} /></Field>
        <div className="col-span-full grid gap-5 @md/fields:grid-cols-3">
          <Field label="City"><Input value={addr.city ?? ""} onChange={setAddr("city")} /></Field>
          <Field label="State"><Input value={addr.state ?? ""} onChange={setAddr("state")} /></Field>
          <Field label="Pincode"><Input value={addr.pincode ?? ""} onChange={setAddr("pincode")} /></Field>
        </div>

        <SubHeading title="Contact" blurb="Guests call the first number from the app." />
        <div className="col-span-full grid gap-3">
          {phones.map((ph, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label={i === 0 ? "Phone" : `Phone ${i + 1}`} className="flex-1"><Input value={ph} onChange={(v) => setPhones(phones.map((x, j) => (j === i ? v : x)))} placeholder="+91 …" /></Field>
              {phones.length > 1 && <div className="pb-1"><RemoveButton label="Remove this line" onClick={() => setPhones(phones.filter((_, j) => j !== i))} /></div>}
            </div>
          ))}
          <StudioBtn kind="ghost" small className="w-fit" onClick={() => setPhones([...phones, ""])}>Add another line</StudioBtn>
        </div>
        <Field label="Email" full><Input type="email" value={contact.email ?? ""} onChange={setContact("email")} /></Field>

        <SubHeading title="Map location" blurb="Used by the app for directions and the nearest-centre order. Paste from Google Maps (right-click the pin → copy coordinates)." />
        <Field label="Latitude" hint="e.g. 17.4326"><NumberInput value={String(coords[1] ?? 0)} onChange={setCoord(1)} /></Field>
        <Field label="Longitude" hint="e.g. 78.4071"><NumberInput value={String(coords[0] ?? 0)} onChange={setCoord(0)} /></Field>

        <SubHeading title="Billing & GST" blurb="Printed on every receipt from this centre." />
        <Field label="Legal entity name"><Input value={f.legalName ?? ""} onChange={(v) => setF((s) => ({ ...s, legalName: v }))} placeholder="e.g. Curispro Health Care Services Pvt Ltd" /></Field>
        <Field label="Invoice prefix" hint="Invoices run ZNJH26 0001…; receipts ZNJH26R1…"><Input value={f.invoicePrefix ?? ""} onChange={(v) => setF((s) => ({ ...s, invoicePrefix: v.toUpperCase() }))} placeholder="e.g. ZNJH (blank = ZN + initials)" /></Field>
        <Field label="GSTIN"><Input value={f.gstin ?? ""} onChange={(v) => setF((s) => ({ ...s, gstin: v.toUpperCase() }))} placeholder="36AAJCC4657R2ZT" /></Field>
        <Field label="PAN"><Input value={f.pan ?? ""} onChange={(v) => setF((s) => ({ ...s, pan: v.toUpperCase() }))} placeholder="AAJCC4657R" /></Field>
        <Field label="State code" hint="36 = Telangana; decides CGST+SGST vs IGST"><Input value={f.stateCode ?? "36"} onChange={(v) => setF((s) => ({ ...s, stateCode: v }))} /></Field>
        <Field label="Zone" hint="Groups centres in the switcher"><Input value={f.zone ?? "Hyderabad"} onChange={(v) => setF((s) => ({ ...s, zone: v }))} /></Field>
        <ToggleRow full label="Pharmacy centre" description="Retail-only shelf; grouped apart from clinics" on={!!f.isPharmacy} onChange={(v) => setF((s) => ({ ...s, isPharmacy: v }))} />

        <SubHeading title="Guest messaging" blurb="Avoid double messages with Zenoti's ezConnect." />
        <ToggleRow full label="Send WhatsApp from here" description="Confirmations, reminders, check-in codes, receipts"
          on={f.messaging?.whatsappEnabled !== false} onChange={(v) => setF((s) => ({ ...s, messaging: { ...(s.messaging ?? {}), whatsappEnabled: v } }))} />
        <ToggleRow full label="Zenoti (ezConnect) messages guests at this centre" description="On = our automatic WhatsApp is skipped for appointments booked in Zenoti; check-in codes still go"
          on={!!f.messaging?.zenotiSendsGuestMessages} onChange={(v) => setF((s) => ({ ...s, messaging: { ...(s.messaging ?? {}), zenotiSendsGuestMessages: v } }))} />
        <Field label="WhatsApp number guests write to" full hint="Routes incoming WhatsApp messages to this centre's inbox">
          <Input value={f.messaging?.whatsappNumber ?? ""} onChange={(v) => setF((s) => ({ ...s, messaging: { ...(s.messaging ?? {}), whatsappNumber: v } }))} placeholder="+91 …" />
        </Field>

        <SubHeading title="Booking" />
        <Field label="Session length" hint="Fixed for consultations and treatments"><Input value={`${SESSION_SLOT_MINUTES} minutes`} readOnly /></Field>
        <Field label="Display order"><NumberInput value={String(f.displayOrder ?? 0)} onChange={(v) => set("displayOrder")(Number(v) || 0)} /></Field>

        <SubHeading title="Weekly hours" blurb="Slots outside these hours never appear in the app." />
        <div className="col-span-full grid gap-2">
          {DAYS.map((day) => {
            const h = hours[day] ?? {};
            const off = h.isOpen === false;
            return (
              <Row key={day} className="flex-wrap">
                <span className="w-12 text-[15px] font-semibold text-ink">{DAY_LABEL[day]}</span>
                <div className="w-[124px]"><Input type="time" value={h.open ?? "10:00"} onChange={(v) => setHours(day, { open: v })} disabled={off} /></div>
                <span className="text-[14px] text-ink3">to</span>
                <div className="w-[124px]"><Input type="time" value={h.close ?? "19:00"} onChange={(v) => setHours(day, { close: v })} disabled={off} /></div>
                <label className="ml-auto flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px] text-ink2">
                  <span>{off ? "Closed" : "Open"}</span>
                  <Toggle on={!off} onChange={(v) => setHours(day, { isOpen: v })} />
                </label>
              </Row>
            );
          })}
        </div>

        <ToggleRow full on={!!f.isActive} onChange={set("isActive")} label="Centre active"
          description="Inactive removes it from the app picker, the branch switcher and new bookings" />

        {err && <Note kind="err">{err}</Note>}
      </div>
    </StudioSheet>
  );
}

/* ================= REVIEWS ================= */
type ReviewKind = "products" | "consultations" | "services";

const REVIEW_SECTIONS: (StudioSection & { id: ReviewKind; heading: string })[] = [
  { id: "consultations", title: "Consultations", heading: "Consultation reviews", blurb: "What guests said after a consultation." },
  { id: "products", title: "Products", heading: "Product reviews", blurb: "What guests said after a delivered order." },
  { id: "services", title: "Package services", heading: "Package service reviews", blurb: "What guests said after a package session." },
];

function BigStars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-gold-dark" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={20} strokeWidth={2} className={i <= n ? "fill-current" : "text-border"} />)}
    </span>
  );
}

export function Reviews() {
  const { toast, audit, can } = useStore();
  // The page is revealed by `reviews.view`; moderating is `reviews.manage`.
  const canModerate = can("reviews.manage");
  const [kind, setKind] = useState<ReviewKind>("consultations");
  const [pending, setPending] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const q = useApi(() => {
    const params = pending ? { isApproved: "false", limit: 200 } : { limit: 200 };
    if (kind === "products") return api.reviews.products(params);
    if (kind === "services") return api.reviews.packageServices(params);
    return api.reviews.consultations(params);
  }, [kind, pending]);

  type AnyReview = (ProductReview | ConsultationReview | ServiceReview) & {
    productId?: unknown; consultationId?: unknown; serviceName?: string;
  };
  const rows = (q.data?.data ?? []) as AnyReview[];
  const selected = rows.find((r) => r._id === sel);

  const subjectOf = (r: AnyReview) =>
    r.serviceName || nameOf(r.consultationId, "") || nameOf(r.productId, "") || "—";

  const avg = rows.length ? rows.reduce((n, r) => n + r.rating, 0) / rows.length : 0;
  const lowScores = rows.filter((r) => r.rating <= 2);

  const approve = async (id: string, isApproved: boolean) => {
    try {
      if (kind === "products") await api.reviews.approveProduct(id, isApproved);
      else if (kind === "services") await api.reviews.approveServiceReview(id, isApproved);
      else await api.reviews.approveConsultation(id, isApproved);
      audit(isApproved ? "REVIEW_APPROVED" : "REVIEW_REJECTED", `${kind} review ${id}`, { reviewId: id });
      toast(isApproved ? "Review published" : "Review hidden");
      q.reload(); setSel(null);
    } catch (e) { toast((e as Error).message); }
  };

  const remove = async (id: string) => {
    try {
      if (kind === "products") await api.reviews.removeProduct(id);
      else if (kind === "services") await api.reviews.removeServiceReview(id);
      else await api.reviews.removeConsultation(id);
      audit("REVIEW_DELETED", `${kind} review ${id}`, { reviewId: id });
      toast("Review deleted"); q.reload(); setSel(null);
    } catch (e) { toast((e as Error).message); }
  };

  const sec = REVIEW_SECTIONS.find((s) => s.id === kind) ?? REVIEW_SECTIONS[0];

  return (
    <StudioPage title="Reviews" intro="Guest reviews from the app — moderate what shows publicly."
      sections={REVIEW_SECTIONS} active={kind} onSection={(id) => setKind(id as ReviewKind)}
      actions={
        <StudioBtn kind="ghost" disabled={!rows.length} onClick={() => exportCsv(`zennara-${kind}-reviews`,
          ["Date", "Guest", "Subject", "Rating", "Review", "Approved"],
          rows.map((r) => [fmtDate(r.createdAt), nameOf(r.userId, "Anonymous"), subjectOf(r), r.rating, r.reviewText, r.isApproved ? "yes" : "no"]))}>
          Export CSV
        </StudioBtn>
      }>
      <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />
      <Section title={sec.heading} blurb={sec.blurb}
        right={<Segmented value={pending ? "pending" : "all"} onChange={(v) => setPending(v === "pending")}
          options={[{ value: "all", label: "All reviews" }, { value: "pending", label: "Awaiting approval" }]} />}>
        <StatGrid items={[
          { k: "Reviews", v: rows.length },
          { k: "Average rating", v: avg ? avg.toFixed(1) : "—", hot: avg >= 4.5 },
          { k: "5 star", v: rows.filter((r) => r.rating === 5).length, tone: "up" },
          { k: "2 star or less", v: lowScores.length, tone: lowScores.length ? "dn" : undefined },
          { k: "Awaiting approval", v: rows.filter((r) => !r.isApproved).length },
        ]} />

        <div className="col-span-full">
          <Async q={q} label="Loading reviews…" rows={6}>
            {() => rows.length === 0 ? (
              <StudioEmpty title={pending ? "Nothing awaiting approval" : "No reviews yet"}
                hint="Guests are asked for a review after a completed visit or a delivered order." />
            ) : (
              <StudioTable cols={[{ label: "Date", nowrap: true }, "Guest", "Subject", { label: "Rating", nowrap: true }, { label: "Review", width: "36%" }, "Status"]}
                onRow={(i) => setSel(rows[i]._id)}
                rows={rows.map((r) => [
                  fmtDate(r.createdAt),
                  <span key={`${r._id}g`} className="font-semibold text-ink">{nameOf(r.userId, "Anonymous")}</span>,
                  subjectOf(r),
                  <Stars key={`${r._id}s`} n={r.rating} />,
                  <span key={`${r._id}t`} className="line-clamp-2">{r.reviewText}</span>,
                  r.isApproved ? <StatusTag key={`${r._id}a`} kind="ok">Published</StatusTag> : <StatusTag key={`${r._id}a`} kind="warn">Hidden</StatusTag>,
                ])} />
            )}
          </Async>
        </div>

        <Note>
          Approving publishes a review to the app and feeds the service or product's star rating. Hiding keeps it on
          record without showing it — nothing is silently edited.
        </Note>
      </Section>

      <StudioSheet open={!!selected} onClose={() => setSel(null)} title={selected ? nameOf(selected.userId, "Anonymous") : ""}
        sub={selected ? `${subjectOf(selected)} · ${fmtDateFull(selected.createdAt)}` : undefined}
        footer={selected && canModerate ? <>
          <StudioBtn kind="danger" className="mr-auto" onClick={() => remove(selected._id)}>Delete review</StudioBtn>
          {selected.isApproved
            ? <StudioBtn kind="ghost" onClick={() => approve(selected._id, false)}>Hide from the app</StudioBtn>
            : <StudioBtn onClick={() => approve(selected._id, true)}>Publish to the app</StudioBtn>}
        </> : undefined}>
        {selected && (
          <div className="grid gap-5">
            <div className="rounded-[12px] border border-border bg-surface p-5">
              <BigStars n={selected.rating} />
              <p className="m-0 mt-3 text-[15px] leading-7 text-ink">{selected.reviewText}</p>
              {"images" in selected && !!selected.images?.length && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.images.map((img, i) => <img key={i} src={img} alt="" className="h-20 w-20 rounded-[10px] border border-border object-cover" />)}
                </div>
              )}
            </div>
            <DetailList items={[
              ["Guest", nameOf(selected.userId, "Anonymous")],
              ["Subject", subjectOf(selected)],
              ["Rating", `${selected.rating} of 5`],
              ["Written", fmtDateFull(selected.createdAt)],
              ["Status", selected.isApproved ? <StatusTag kind="ok">Published</StatusTag> : <StatusTag kind="warn">Hidden</StatusTag>],
            ]} />

            {selected.rating <= 2 && (
              <Note kind="err">
                A low score usually needs a call, not a reply. Open the guest's record and have the branch manager
                reach out before anything is published.
              </Note>
            )}

            {!canModerate && (
              <Note>You can read reviews, but only someone with the “moderate reviews” permission can publish, hide or delete them.</Note>
            )}
          </div>
        )}
      </StudioSheet>
    </StudioPage>
  );
}

/* ================= ANALYTICS ================= */
/*
 * The period follows every metrics page (lib/ranges.ts): This month by
 * default — the 1st to today — then Last 90 days, All time, or custom dates.
 *
 * "All time" is not a number of days. The dashboard is sent no start and finds
 * the oldest record itself. Financial, appointments and services fall back to
 * their OWN last 30 days when no start is given — which is how "All time" used
 * to show a month on those tabs — so they are sent the all-time floor instead.
 */
const ANALYTICS_SECTIONS: StudioSection[] = [
  { id: "revenue", title: "Revenue", blurb: "Every stream, as paid, over the period." },
  { id: "appointments", title: "Appointments", blurb: "Bookings, outcomes and when the centres are busiest." },
  { id: "dermatologists", title: "Dermatologists", blurb: "Bookings, completion and revenue per dermatologist." },
  { id: "services", title: "Services", blurb: "What gets booked, what earns, and what does not move." },
  { id: "guests", title: "Guests", blurb: "The guest base, new joins and retention." },
  { id: "products", title: "Products & orders", blurb: "App orders, clinic counter sales and stock value." },
  { id: "packages", title: "Packages & memberships", blurb: "Packages sold and assigned, and the Zen membership base." },
  { id: "stock", title: "Stock", blurb: "Items tracked, value on hand and what needs re-ordering." },
  { id: "staffSales", title: "Staff sales", blurb: "Who sold what, from closed bills — the Sale-by on each line." },
];

/** Group a daily series into ≤ n buckets (sum) for bar charts. */
function bucketSeries<T>(rows: T[], n: number, pick: (r: T) => number): number[] {
  const size = Math.max(1, Math.ceil(rows.length / n));
  const out: number[] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size).reduce((a, r) => a + pick(r), 0));
  return out;
}
function bucketLabels(rows: { date: string }[], n: number): string[] {
  const size = Math.max(1, Math.ceil(rows.length / n));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += size) out.push(fmtDayKey(rows[i].date.slice(0, 10), { day: "numeric", month: "short", year: "2-digit" }));
  return out;
}

const CHART_GRID = "grid gap-6 @2xl/pane:grid-cols-2";
const ANALYTICS_STATS = "@4xl/pane:grid-cols-6";

export function Analytics() {
  // Trade happens at the three clinics; a pharmacy filter would always be empty.
  const { clinics: branches } = useStore();
  const [rangeParam, setRange] = useQueryString("range", DEFAULT_METRIC_RANGE);
  // An old link can still carry "30 days" or "This year"; it opens on the default.
  const range: MetricRange = isMetricRange(rangeParam) ? rangeParam : DEFAULT_METRIC_RANGE;
  const [custom, setCustom] = useState<{ startDate: string; endDate: string } | null>(null);
  const [branchId, setBranchId] = useQueryString("branch", "");
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: ANALYTICS_SECTIONS.length - 1 });

  const win = useMemo(() => (custom ? customWindow(custom.startDate, custom.endDate) : metricWindow(range)), [range, custom]);
  const window = useMemo(() => ({ startDate: win.startDate, endDate: win.endDate }), [win]);
  const scope = { ...window, branchId: branchId || undefined };
  /** For the endpoints that cannot take an open start (see above). */
  const bounded = { ...scope, startDate: win.floorStart };
  // The guests endpoint wants a day count.
  const rangeDays = win.days;

  const q = useApi(async () => {
    const [dash, financial, appointments, patients, services, inventory, monthly, acquisition, demographics, sources, top, orders, products, pkgStats] =
      await Promise.all([
        api.analytics.dashboard(scope).catch((e) => { throw new Error(`Dashboard: ${(e as Error).message}`); }),
        api.analytics.financial(bounded).catch(() => undefined),
        api.analytics.appointments(bounded).catch((e) => { throw new Error(`Appointments: ${(e as Error).message}`); }),
        api.analytics.patients({ ...scope, days: rangeDays }).catch(() => undefined),
        api.analytics.services(bounded).catch(() => undefined),
        api.analytics.inventory(window).catch(() => undefined),
        api.analytics.monthlyRevenue({ branchId: branchId || undefined }).catch(() => []),
        api.analytics.patientAcquisition().catch(() => []),
        api.analytics.demographics().catch(() => undefined),
        api.analytics.sources().catch(() => []),
        api.analytics.topPatients(10, scope).catch(() => []),
        api.orders.stats().catch(() => undefined),
        api.products.statistics().catch(() => undefined),
        api.packageAssignments.stats().catch(() => undefined),
      ]);
    return { dash, financial, appointments, patients, services, inventory, monthly, acquisition, demographics, sources, top, orders, products, pkgStats };
  }, [window.startDate, window.endDate, branchId, range]);

  const branchName = branches.find((b) => b._id === branchId)?.name ?? "All centres";
  const label = custom ? `Custom · ${win.label}` : range === "All time" ? "All time" : `${range} · ${win.label}`;
  const seed = { startDate: win.startDate ?? metricWindow(DEFAULT_METRIC_RANGE).startDate!, endDate: win.endDate };

  const sec = ANALYTICS_SECTIONS[tab] ?? ANALYTICS_SECTIONS[0];
  const active = sec.id;
  const onSection = (id: string) => setTab(Math.max(0, ANALYTICS_SECTIONS.findIndex((s) => s.id === id)));

  const exportAll = () => {
    if (!q.data) return;
    const d = q.data.dash, a = q.data.appointments.overview;
    exportCsv("zennara-analytics", ["Metric", "Value"], [
      ["Range", label], ["Centre", branchName], ["Total revenue", d.revenue.total], ["Previous period", d.revenue.previous],
      ...d.revenue.streams.map((s) => [`${s.label} revenue`, s.revenue] as [string, number]),
      ...d.revenue.streams.map((s) => [`${s.label} count`, s.count] as [string, number]),
      ["Bookings", a.totalBookings], ["Completed", a.completedBookings], ["Cancellation rate %", a.cancellationRate], ["No-show rate %", a.noShowRate],
      ["New guests", d.counts.newPatients], ["Active Zen members", d.counts.activeZen], ["Orders", d.counts.orders], ["Packages assigned", d.counts.packagesAssigned],
      ...d.dermatologists.map((x) => [`${x.name}`, `${x.bookings} bookings · ${x.completed} completed · ₹${x.revenue}`] as [string, string]),
      ...d.topServices.map((x) => [`Service: ${x.name}`, `${x.bookings} · ₹${x.revenue}`] as [string, string]),
    ]);
  };

  return (
    <StudioPage title="Analytics" wide intro={`Showing ${branchName}, ${label}. Every figure follows the period and centre chosen below.`}
      sections={ANALYTICS_SECTIONS} active={active} onSection={onSection}
      actions={
        <div className="grid w-full gap-2">
          <Segmented value={custom ? "custom" : range}
            onChange={(v) => { if (v === "custom") { setCustom(custom ?? seed); } else { setCustom(null); setRange(v); } }}
            options={[...METRIC_RANGES.map((r) => ({ value: r, label: r })), { value: "custom", label: "Custom" }]} />
          {custom && (
            <div className="grid grid-cols-2 gap-2">
              <DateInput ariaLabel="From" value={custom.startDate} max={custom.endDate} onChange={(v) => v && setCustom({ ...custom, startDate: v })} />
              <DateInput ariaLabel="To" value={custom.endDate} min={custom.startDate} onChange={(v) => v && setCustom({ ...custom, endDate: v })} />
            </div>
          )}
          <Select value={branchId} onChange={setBranchId}
            options={[{ value: "", label: "All centres" }, ...branches.map((b) => ({ value: b._id, label: b.name }))]} />
          <StudioBtn kind="ghost" disabled={!q.data} onClick={exportAll}>Export CSV</StudioBtn>
        </div>
      }>
      <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />
      <Section title={sec.title} blurb={sec.blurb}>
        <div className="col-span-full grid gap-6">
          {active === "staffSales" ? <StaffSalesPanel /> : (
            <Async q={q} label="Crunching the numbers…" rows={8}>
              {({ dash: d, financial, appointments, patients, services, inventory, monthly, acquisition, demographics, sources, top, orders, products, pkgStats }) => {
                const a = appointments.overview;
                const growth = d.revenue.growthPercent;
                const dailyLabels = d.daily.map((x) => fmtDayKey(x.date.slice(0, 10), { day: "numeric", month: "short", year: "2-digit" }));
                const streams = d.revenue.streams;
                const consultTrend = bucketSeries(d.daily, 10, (x) => x.consultations);
                const treatTrend = bucketSeries(d.daily, 10, (x) => x.treatments);
                const bookingsTrend = bucketSeries(d.daily, 10, (x) => x.bookings);
                void bookingsTrend;
                const bl = bucketLabels(d.daily, 10);
                const longer = <StudioEmpty title="Pick a longer range" />;
                return (
                  <>
                    {active === "revenue" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Total revenue", v: fmtCompactINR(d.revenue.total), hot: true, d: growth === null ? (d.revenue.previousHasData === false ? "no comparable earlier period" : `prev ${fmtCompactINR(d.revenue.previous)}`) : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}% vs previous ${d.period.days}d`, tone: growth === null ? undefined : growth >= 0 ? "up" : "dn" },
                          ...streams.map((s) => ({
                            k: s.label,
                            v: s.key === "memberships" && s.revenue === 0 && s.count > 0 ? `${s.count} sold` : fmtCompactINR(s.revenue),
                            d: s.unpriced
                              ? `${s.count} sold · ${s.unpriced} without a recorded price`
                              : `${s.count} · app ${fmtCompactINR(s.app)}${s.clinic ? ` · clinic ${fmtCompactINR(s.clinic)}` : ""}`,
                          })),
                        ]} />

                        {/*
                          Fixed reference points, deliberately separate from the
                          revenue row above. These do not move with the date picker —
                          "how many guests do we have" is always all of them, and a
                          window-relative answer to that is just wrong.
                        */}
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Guests on file", v: d.counts.totalPatients.toLocaleString("en-IN"), hot: true,
                            d: `${d.counts.newThisMonth ?? 0} joined this month` },
                          { k: "New in this period", v: (d.counts.newPatients ?? 0).toLocaleString("en-IN"),
                            d: d.period.isAllTime ? "all time" : `${d.period.days} days` },
                          { k: "Returning guests", v: (d.counts.returningPatients ?? 0).toLocaleString("en-IN"),
                            d: "seen more than once", tone: "up" },
                          { k: "Appointments to date", v: (d.counts.appointmentsAllTime ?? 0).toLocaleString("en-IN"),
                            d: `${d.counts.completed.toLocaleString("en-IN")} completed in period` },
                          { k: "Treatments this week", v: (d.counts.treatmentsThisWeek ?? 0).toLocaleString("en-IN"),
                            d: "completed, last 7 days" },
                          { k: "Still to come", v: (d.counts.upcomingAll ?? 0).toLocaleString("en-IN"),
                            d: "confirmed and awaiting, from now", hot: (d.counts.upcomingAll ?? 0) > 0 },
                        ]} />

                        <div className={CHART_GRID}>
                          <ChartPanel full title="Revenue by day" sub="All streams, as paid" hero={fmtINR(d.revenue.total)}>
                            {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.total)} labels={dailyLabels} label="Revenue" format={fmtCompactINR} /> : longer}
                          </ChartPanel>
                          <ChartPanel full title="Streams over time" sub="Consultations · treatments · products · packages · memberships">
                            {bl.length > 1 ? <GBars cats={bl} series={[
                              { n: "Consultations", v: bucketSeries(d.daily, 10, (x) => x.consultations) }, { n: "Treatments", v: bucketSeries(d.daily, 10, (x) => x.treatments) },
                              { n: "Products", v: bucketSeries(d.daily, 10, (x) => x.products) }, { n: "Packages", v: bucketSeries(d.daily, 10, (x) => x.packages) }, { n: "Memberships", v: bucketSeries(d.daily, 10, (x) => x.memberships) },
                            ]} /> : longer}
                          </ChartPanel>
                          <ChartPanel title="Revenue mix" sub="Share by stream">
                            <HBars rows={streams.map((s) => [s.label, s.revenue, `${d.revenue.total ? Math.round((s.revenue / d.revenue.total) * 100) : 0}% · ${fmtCompactINR(s.revenue)}`] as [string, number, string])} />
                          </ChartPanel>
                          <ChartPanel title="Revenue by centre" sub="Visits, packages and clinic sales — app orders have no centre">
                            {d.revenueByCentre.length ? <HBars color="var(--color-c2)" rows={d.revenueByCentre.map((r) => [r.centre, r.revenue, `${r.bookings} bookings · ${fmtCompactINR(r.revenue)}`] as [string, number, string])} /> : <StudioEmpty title="No bookings" />}
                          </ChartPanel>
                          <ChartPanel full title="Monthly revenue" sub="Last 12 months, all centres in scope">
                            {monthly.length > 1 ? <AreaChart pts={monthly.map((m) => Number((m as { totalRevenue?: number; revenue?: number }).totalRevenue ?? m.revenue) || 0)} labels={monthly.map((m) => String(m.month))} label="Monthly" format={fmtCompactINR} /> : <StudioEmpty title="Not enough history yet" />}
                          </ChartPanel>
                          <ChartPanel title="Payment mix" sub="How the money came in">
                            {d.paymentMix.length ? <HBars color="var(--color-c3)" rows={d.paymentMix.map((p) => [p.method, p.amount, fmtCompactINR(p.amount)] as [string, number, string])} /> : <StudioEmpty title="No payments" />}
                          </ChartPanel>
                          <ChartPanel title="Money owed and averages" sub="Across the period">
                            <KeyValue k="Outstanding (bookings + packages)" v={fmtINR(d.counts.outstanding)} />
                            <KeyValue k="Average ticket" v={fmtINR(d.counts.averageTicket)} />
                            {financial && <KeyValue k="Cancelled (catalogue value)" v={fmtINR(financial.overview.refundsLost)} />}
                          </ChartPanel>
                        </div>
                      </>
                    )}

                    {active === "appointments" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Bookings", v: d.counts.bookings, d: `${d.counts.upcoming} upcoming`, hot: true },
                          { k: "Consultations", v: d.counts.consultations, d: `${Math.round((d.counts.consultations / Math.max(1, d.counts.bookings)) * 100)}% of bookings` },
                          { k: "Treatments", v: d.counts.treatments, d: `${Math.round((d.counts.treatments / Math.max(1, d.counts.bookings)) * 100)}% of bookings` },
                          { k: "Completed", v: d.counts.completed, d: `${pct(a.conversionRate)} conversion`, tone: "up" },
                          { k: "No-show", v: `${d.counts.noShowRate}%`, d: `${d.counts.noShow} missed`, tone: d.counts.noShowRate > 8 ? "dn" : "up" },
                          { k: "Cancelled", v: `${d.counts.cancellationRate}%`, d: `${d.counts.cancelled} cancelled`, tone: d.counts.cancellationRate > 10 ? "dn" : undefined },
                        ]} />
                        <div className={CHART_GRID}>
                          <ChartPanel full title="Consultations vs treatments" sub="Bookings over the period">
                            {bl.length > 1 ? <GBars cats={bl} series={[{ n: "Consultations", v: consultTrend }, { n: "Treatments", v: treatTrend }]} /> : longer}
                          </ChartPanel>
                          <ChartPanel full title="Bookings per day" hero={String(d.counts.bookings)}>
                            {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.bookings)} labels={dailyLabels} label="Bookings" /> : longer}
                          </ChartPanel>
                          <ChartPanel title="Outcome mix" sub={label}>
                            <GBars cats={["Completed", "Upcoming", "Cancelled", "No-show"]} series={[{ n: "Bookings", v: [d.counts.completed, d.counts.upcoming, d.counts.cancelled, d.counts.noShow] }]} />
                          </ChartPanel>
                          <ChartPanel title="Where bookings come from" sub="App · reception · package · Zennara clinic">
                            <HBars color="var(--color-c4)" rows={Object.entries(d.counts.bookingsBySource).map(([k, v]) => [k, v] as [string, number])} />
                          </ChartPanel>
                          <ChartPanel title="Busiest days" sub="Bookings by weekday">
                            <HBars color="var(--color-c2)" rows={(appointments.peakDays ?? []).map((x) => [x.day, x.count] as [string, number])} />
                          </ChartPanel>
                          <ChartPanel title="Busiest hours" sub="Bookings by hour of day">
                            <HBars color="var(--color-c3)" rows={(appointments.peakHours ?? []).filter((h) => h.count > 0).map((h) => [h.hour, h.count] as [string, number])} />
                          </ChartPanel>
                          <ChartPanel title="Load & flow" sub="Averages over the period">
                            <KeyValue k="Per day" v={String(appointments.averages?.perDay ?? 0)} />
                            <KeyValue k="Per week" v={String(appointments.averages?.perWeek ?? 0)} />
                            <KeyValue k="Per month" v={String(appointments.averages?.perMonth ?? 0)} />
                            <KeyValue k="Upcoming this week" v={String(appointments.upcomingThisWeek ?? 0)} />
                            <KeyValue k="Awaiting confirmation" v={String(d.counts.awaitingConfirmation)} />
                            <KeyValue k="Avg days between visits" v={String(appointments.avgTimeBetweenBookings ?? 0)} />
                          </ChartPanel>
                          {!!(appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService?.length && (
                            <ChartPanel title="No-shows by service">
                              <HBars color="var(--color-err)" rows={((appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService ?? []).slice(0, 8).map((x) => [x.service, x.count] as [string, number])} />
                            </ChartPanel>
                          )}
                        </div>
                      </>
                    )}

                    {active === "dermatologists" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Dermatologists", v: d.dermatologists.filter((x) => x.bookings > 0).length, d: `${d.dermatologists.length} on the roster`, hot: true },
                          { k: "Top earner", v: d.dermatologists[0]?.revenue ? d.dermatologists[0].name.split(" ")[0] : "—", d: d.dermatologists[0] ? fmtCompactINR(d.dermatologists[0].revenue) : "" },
                          { k: "Busiest", v: [...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.name.split(" ")[0] ?? "—", d: `${[...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.bookings ?? 0} bookings` },
                          { k: "Best completion", v: `${Math.max(0, ...d.dermatologists.filter((x) => x.bookings >= 3).map((x) => x.completionRate))}%`, d: "min 3 bookings" },
                          { k: "Avg rating", v: (() => { const r = d.dermatologists.filter((x) => x.avgRating); return r.length ? <RatingValue value={Number((r.reduce((n, x) => n + (x.avgRating ?? 0), 0) / r.length).toFixed(1))} /> : "—"; })(), d: "across rated visits" },
                        ]} />
                        <div className={CHART_GRID}>
                          <ChartPanel title="Revenue by dermatologist" sub={label}>
                            <HBars rows={d.dermatologists.filter((x) => x.revenue > 0).map((x) => [x.name, x.revenue, fmtCompactINR(x.revenue)] as [string, number, string])} />
                          </ChartPanel>
                          <ChartPanel title="Consultations vs treatments" sub="Per dermatologist">
                            <GBars cats={d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.name.split(" ")[0])} series={[{ n: "Consultations", v: d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.consultations) }, { n: "Treatments", v: d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.treatments) }]} />
                          </ChartPanel>
                        </div>
                        <StudioTable stickyFirst minWidth={1100}
                          cols={["Dermatologist", "Level", { label: "Bookings", align: "right" }, { label: "Consults", align: "right" }, { label: "Treatments", align: "right" }, { label: "Completed", align: "right", nowrap: true }, { label: "No-show", align: "right" }, { label: "Guests", align: "right" }, "Rating", { label: "Revenue", align: "right", nowrap: true }, { label: "Per booking", align: "right", nowrap: true }]}
                          rows={d.dermatologists.map((x, i) => [
                            <span key={x.doctorId} className="flex items-center gap-2 whitespace-nowrap">
                              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12.5px] font-bold ${i === 0 && x.revenue > 0 ? "bg-primary text-white" : "bg-sage text-ink2"}`}>{i + 1}</span>
                              <B>{x.name}</B>{!x.onboarded && <StatusTag kind="info">Zenoti</StatusTag>}
                            </span>,
                            <StatusTag key={`${x.doctorId}l`} kind={!x.onboarded ? "info" : x.level === "Senior Dermatologist" ? "primary" : "mute"}>{x.level}</StatusTag>,
                            x.bookings, x.consultations, x.treatments, `${x.completed} (${x.completionRate}%)`, x.noShow, x.patients, x.avgRating ? <RatingValue value={x.avgRating} /> : "—", <B key={`${x.doctorId}r`}>{fmtINR(x.revenue)}</B>, fmtINR(x.bookings ? Math.round(x.revenue / x.bookings) : 0),
                          ])} />
                      </>
                    )}

                    {active === "services" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Services booked", v: d.topServices.length, d: `${services?.summary?.totalServices ?? "—"} in catalogue`, hot: true },
                          { k: "Top service", v: d.topServices[0]?.name ?? "—", d: d.topServices[0] ? `${d.topServices[0].bookings} bookings · ${fmtCompactINR(d.topServices[0].revenue)}` : "" },
                          { k: "Revenue / service", v: fmtINR(services?.summary?.avgRevenuePerService), d: "average" },
                          { k: "Categories", v: services?.categoryPerformance?.length ?? 0, d: "with bookings" },
                        ]} />
                        <div className={CHART_GRID}>
                          <ChartPanel title="Top services by revenue" sub={label}>
                            {d.topServices.length ? <HBars rows={d.topServices.slice(0, 10).map((x) => [x.name, x.revenue, `${x.bookings} · ${fmtCompactINR(x.revenue)}`] as [string, number, string])} /> : <StudioEmpty title="No services booked" />}
                          </ChartPanel>
                          <ChartPanel title="Top services by volume">
                            {d.topServices.length ? <HBars color="var(--color-c2)" rows={[...d.topServices].sort((x, y) => y.bookings - x.bookings).slice(0, 10).map((x) => [x.name, x.bookings, x.kind] as [string, number, string])} /> : <StudioEmpty title="No services booked" />}
                          </ChartPanel>
                          <ChartPanel title="Category performance" sub={label}>
                            {services?.categoryPerformance?.length ? <HBars color="var(--color-c3)" rows={services.categoryPerformance.slice(0, 10).map((c) => [c.category, c.revenue, fmtCompactINR(c.revenue)] as [string, number, string])} /> : <StudioEmpty title="No category data" />}
                          </ChartPanel>
                          {!!services?.leastPerformingServices?.length && (
                            <ChartPanel title="Needs attention" sub="Least booked services in the catalogue">
                              <HBars color="var(--color-err)" rows={(services.leastPerformingServices as { name: string; bookings?: number }[]).slice(0, 8).map((x) => [x.name, x.bookings ?? 0] as [string, number])} />
                            </ChartPanel>
                          )}
                          {!!services?.packageUtilization?.length && (
                            <ChartPanel title="Package utilisation" sub="Sessions used of sessions sold">
                              <HBars color="var(--color-c4)" rows={services.packageUtilization.slice(0, 8).map((p2) => [p2.name, p2.used, `${p2.used}/${p2.total}`] as [string, number, string])} />
                            </ChartPanel>
                          )}
                        </div>
                      </>
                    )}

                    {active === "guests" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Guests on file", v: d.counts.totalPatients.toLocaleString("en-IN"), hot: true, d: `${d.counts.newPatients} new in period` },
                          { k: "New guests", v: d.counts.newPatients, d: patients ? `${pct(patients.overview.newPatientRatio)} of bookers` : "" },
                          { k: "Retention", v: patients ? pct(patients.overview.retentionRate) : "—", d: patients ? `${patients.overview.returningPatients} returning` : "" },
                          { k: "Zen members", v: d.counts.activeZen, d: `${d.counts.zenExpiring} expiring in 30d`, tone: d.counts.zenExpiring ? "dn" : undefined },
                          { k: "Birthdays today", v: patients?.birthdaysToday?.length ?? 0, d: "send a wish from the guest page" },
                          { k: "Inactive", v: patients?.inactivePatients?.count ?? 0, d: `no visit in ${patients?.inactivePatients?.threshold ?? 90}d` },
                        ]} />
                        <div className={CHART_GRID}>
                          <ChartPanel full title="New guests per month" hero={String(d.counts.newPatients)}>
                            {acquisition.length > 1 ? <AreaChart pts={acquisition.map((m) => Number(m.count) || 0)} labels={acquisition.map((m) => String(m.month))} label="New guests" /> : <StudioEmpty title="Not enough history yet" />}
                          </ChartPanel>
                          <ChartPanel title="By home centre" sub="Registered guests">
                            {sources.length ? <HBars color="var(--color-c2)" rows={sources.map((x) => [x.source || "Unknown", x.count, `${x.count} · ${pct(x.percentage)}`] as [string, number, string])} /> : <StudioEmpty title="No data" />}
                          </ChartPanel>
                          {demographics && (
                            <>
                              <ChartPanel title="Age groups" sub="Registered guests"><HBars rows={(demographics.ageGroups ?? []).map((g) => [(g as { range?: string; group?: string }).range ?? (g as { group?: string }).group ?? "—", g.count] as [string, number])} /></ChartPanel>
                              <ChartPanel title="Gender" sub="Registered guests"><HBars color="var(--color-c3)" rows={Object.entries(demographics.gender ?? {}).filter(([k]) => k !== "total").map(([k, v]) => [k, Number(v)] as [string, number])} /></ChartPanel>
                            </>
                          )}
                          <ChartPanel full title="Top guests by spend" sub={label}>
                            {top.length === 0 ? <StudioEmpty title="No spend recorded" /> : (
                              <StudioTable minWidth={420} cols={["Guest", { label: "Spend", align: "right", nowrap: true }, { label: "Visits", align: "right" }]}
                                rows={top.map((t) => [<B key={t._id}>{t.fullName}</B>, fmtINR(t.totalSpent), t.visits ?? "—"])} />
                            )}
                          </ChartPanel>
                        </div>
                      </>
                    )}

                    {active === "products" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Product revenue", v: fmtCompactINR(streams.find((s) => s.key === "products")?.revenue ?? 0), hot: true, d: `app ${fmtCompactINR(streams.find((s) => s.key === "products")?.app ?? 0)} · clinic ${fmtCompactINR(streams.find((s) => s.key === "products")?.clinic ?? 0)}` },
                          { k: "Orders", v: d.counts.orders, d: `${d.counts.paidOrders} paid · ${d.counts.openOrders} open` },
                          { k: "Delivered", v: d.counts.ordersByStatus["Delivered"] ?? 0, d: `${d.counts.ordersByStatus["Cancelled"] ?? 0} cancelled · ${d.counts.ordersByStatus["Returned"] ?? 0} returned` },
                          { k: "All-time orders", v: orders?.totalOrders ?? "—", d: orders ? fmtCompactINR(orders.totalRevenue) : "" },
                          { k: "Products", v: products?.total ?? "—", d: products ? `${products.active} live · ${products.lowStock} low stock` : "" },
                          { k: "Stock value", v: products ? fmtCompactINR(products.totalValue) : "—", d: products ? `${products.totalStock} units` : "" },
                        ]} />
                        <div className={CHART_GRID}>
                          <ChartPanel full title="Product revenue by day" hero={fmtINR(streams.find((s) => s.key === "products")?.app ?? 0)}>
                            {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.products)} labels={dailyLabels} label="Products" format={fmtCompactINR} /> : longer}
                          </ChartPanel>
                          <ChartPanel title="Orders by status" sub={label}>
                            {Object.keys(d.counts.ordersByStatus).length ? <HBars color="var(--color-c2)" rows={Object.entries(d.counts.ordersByStatus).map(([k, v]) => [k, v] as [string, number])} /> : <StudioEmpty title="No orders in this period" />}
                          </ChartPanel>
                          {products?.byFormulation && Object.keys(products.byFormulation).length > 0 && (
                            <ChartPanel title="Stock value by formulation">
                              <HBars color="var(--color-c3)" rows={Object.entries(products.byFormulation).map(([k, v]) => [k, v.value, `${v.count} products · ${v.stock} units`] as [string, number, string])} />
                            </ChartPanel>
                          )}
                          {orders && (
                            <ChartPanel title="Order pipeline" sub="All time">
                              <KeyValue k="New" v={String(orders.newOrders)} /><KeyValue k="Confirmed" v={String(orders.confirmedOrders)} /><KeyValue k="Processing" v={String(orders.processingOrders)} /><KeyValue k="Shipped" v={String(orders.shippedOrders)} /><KeyValue k="Delivered" v={String(orders.deliveredOrders)} /><KeyValue k="Cancelled" v={String(orders.cancelledOrders)} />
                            </ChartPanel>
                          )}
                        </div>
                      </>
                    )}

                    {active === "packages" && (
                      <>
                        <StatGrid className={ANALYTICS_STATS} items={[
                          { k: "Package revenue", v: fmtCompactINR(streams.find((s) => s.key === "packages")?.revenue ?? 0), hot: true, d: `app ${fmtCompactINR(streams.find((s) => s.key === "packages")?.app ?? 0)} · clinic ${fmtCompactINR(streams.find((s) => s.key === "packages")?.clinic ?? 0)}` },
                          { k: "Packages assigned", v: d.counts.packagesAssigned, d: `${d.counts.packagesPaid} paid · ${d.counts.packagesUnpaid} due` },
                          { k: "Membership revenue", v: fmtCompactINR(streams.find((s) => s.key === "memberships")?.revenue ?? 0), d: d.counts.membershipsUnpriced ? `${d.counts.membershipsSold} sold · ${d.counts.membershipsUnpriced} unpriced` : `${d.counts.membershipsSold} sold` },
                          { k: "Active Zen members", v: d.counts.activeZen, d: `${d.counts.zenExpiring} expiring in 30d`, tone: d.counts.zenExpiring ? "dn" : undefined },
                          { k: "Active assignments", v: pkgStats?.statusCounts?.find((s) => s._id === "Active")?.count ?? "—", d: `${pkgStats?.statusCounts?.find((s) => s._id === "Completed")?.count ?? 0} completed` },
                        ]} />
                        {!!d.counts.membershipsUnpriced && (
                          <Note kind="warn">
                            <B>{d.counts.membershipsUnpriced}</B> of {d.counts.membershipsSold} memberships in this period have no amount on record — Zennara clinic (Zenoti) memberships carry no price in the CRM feed, and desk grants made before amounts were captured have none either.
                            They are counted here but contribute <B>₹0</B> to revenue rather than an invented figure. Open the guest and use <B>Record payment details</B> on their membership card to add what was charged.
                          </Note>
                        )}
                        <div className={CHART_GRID}>
                          <ChartPanel full title="Packages & memberships by day">
                            {bl.length > 1 ? <GBars cats={bl} series={[{ n: "Packages", v: bucketSeries(d.daily, 10, (x) => x.packages) }, { n: "Memberships", v: bucketSeries(d.daily, 10, (x) => x.memberships) }]} /> : longer}
                          </ChartPanel>
                          {pkgStats?.statusCounts && (
                            <ChartPanel title="Assignments by status" sub="All time">
                              <HBars color="var(--color-c2)" rows={pkgStats.statusCounts.map((s) => [s._id, s.count] as [string, number])} />
                            </ChartPanel>
                          )}
                          {pkgStats?.paymentStats && (
                            <ChartPanel title="Package payments" sub="Received vs due (all time)">
                              <HBars color="var(--color-c3)" rows={pkgStats.paymentStats.map((s) => [s._id ? "Received" : "Due", s.totalAmount, `${s.count} · ${fmtCompactINR(s.totalAmount)}`] as [string, number, string])} />
                            </ChartPanel>
                          )}
                          {!!services?.packageUtilization?.length && (
                            <ChartPanel title="Package utilisation" sub="Sessions used of sessions sold">
                              <HBars color="var(--color-c4)" rows={services.packageUtilization.slice(0, 10).map((p2) => [p2.name, p2.used, `${p2.used}/${p2.total} · ${pct(p2.utilizationRate)}`] as [string, number, string])} />
                            </ChartPanel>
                          )}
                          {patients?.membershipStatus && (
                            <ChartPanel title="Membership base" sub="Every Zen membership on record">
                              <KeyValue k="Active" v={String(patients.membershipStatus.active)} /><KeyValue k="Expired" v={String(patients.membershipStatus.expired)} /><KeyValue k="Pending" v={String(patients.membershipStatus.pending)} />
                            </ChartPanel>
                          )}
                        </div>
                      </>
                    )}

                    {active === "stock" && (
                      inventory ? (
                        <>
                          <StatGrid className={ANALYTICS_STATS} items={[
                            { k: "Items tracked", v: inventory.summary?.totalItems ?? 0, hot: true },
                            { k: "Stock value", v: fmtCompactINR(inventory.summary?.totalValue), d: `cost ${fmtCompactINR(inventory.summary?.totalCost)}` },
                            { k: "Below re-order", v: inventory.summary?.lowStockCount ?? 0, tone: (inventory.summary?.lowStockCount ?? 0) ? "dn" : undefined },
                            { k: "Out of stock", v: inventory.summary?.outOfStockCount ?? 0, tone: (inventory.summary?.outOfStockCount ?? 0) ? "dn" : undefined },
                            { k: "Expiring in 30d", v: inventory.summary?.expiringIn30Days ?? 0, d: `${inventory.summary?.expired ?? 0} expired` },
                          ]} />
                          <div className={CHART_GRID}>
                            <ChartPanel title="Low-stock alerts" sub="Below the re-order level">
                              {(inventory.lowStockAlerts ?? []).length === 0 ? <StudioEmpty title="Nothing below re-order level" /> : (
                                <StudioTable minWidth={360} cols={["Item", { label: "On hand", align: "right" }, { label: "Re-order", align: "right" }]}
                                  rows={(inventory.lowStockAlerts ?? []).slice(0, 15).map((i) => [<B key={i._id}>{i.inventoryName}</B>, i.qohAllBatches ?? 0, i.reOrderLevel ?? 0])} />)}
                            </ChartPanel>
                            {!!(inventory as { fastMovingProducts?: { name?: string; inventoryName?: string; consumed?: number; quantity?: number }[] }).fastMovingProducts?.length && (
                              <ChartPanel title="Fast-moving stock">
                                <HBars color="var(--color-c2)" rows={((inventory as { fastMovingProducts?: { name?: string; inventoryName?: string; consumed?: number; quantity?: number }[] }).fastMovingProducts ?? []).slice(0, 10).map((x) => [x.name ?? x.inventoryName ?? "—", x.consumed ?? x.quantity ?? 0] as [string, number])} />
                              </ChartPanel>
                            )}
                          </div>
                        </>
                      ) : <StudioEmpty title="Stock analytics unavailable" hint="The inventory analytics endpoint did not respond." />
                    )}
                  </>
                );
              }}
            </Async>
          )}
        </div>
      </Section>
    </StudioPage>
  );
}

/* ================= STAFF & ROLES ================= */
type StaffRow = Admin & {
  canSignIn?: boolean;
  isVerified?: boolean;
  /** Emailed code for everyone; 'password' once an administrator has set one. */
  loginMethod?: "otp" | "password";
  onAllowList?: boolean;
};


export function Roles() {
  const { can, isSuperAdmin } = useStore();
  const canViewStaff = can("staff.view");
  const canViewRoles = can("roles.view");

  const rolesQ = useApi(() => (canViewRoles || canViewStaff ? api.roles.list() : Promise.resolve([] as Role[])), []);
  const roleCount = rolesQ.data?.length;

  /*
   * Sign-in security is super-admin-only and by ROLE, not permission: these
   * switches govern who can get into the panels at all, so they must not be
   * grantable through a custom role someone assembles later. The server
   * enforces the same rule.
   */
  const sections: StudioSection[] = [];
  if (canViewStaff) sections.push({ id: "staff", title: "Staff" });
  if (canViewRoles) sections.push({ id: "roles", title: "Roles & permissions", count: roleCount });
  if (isSuperAdmin) sections.push({ id: "security", title: "Sign-in security" });

  // Lands on whichever section the account can actually see.
  const [active, setActive] = useStudioSection("roles", sections);

  return (
    <StudioPage title="Staff & roles" intro="Who signs into the panel, and exactly what each person can do."
      sections={sections} active={active} onSection={setActive}>
      {active === "staff" && canViewStaff && <StaffTab roles={rolesQ.data ?? []} />}
      {active === "roles" && canViewRoles && <RolesManager />}
      {active === "security" && isSuperAdmin && <SignInSecurityTab />}
    </StudioPage>
  );
}

function StaffTab({ roles }: { roles: Role[] }) {
  // Staff are posted to clinics; stock locations have no roster.
  const { toast, audit, canManageStaff, admin, clinics: branches } = useStore();
  const [invOpen, setInvOpen] = useState(false);
  const [sel, setSel] = useState<StaffRow | null>(null);
  const [del, setDel] = useState<StaffRow | null>(null);
  const [cloneOf, setCloneOf] = useState<StaffRow | null>(null);
  const [endOf, setEndOf] = useState<StaffRow | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const q = useApi(() => api.staff.list({ search: debounced || undefined }), [debounced]);
  const rows = (q.data?.data ?? []) as StaffRow[];
  const stats = q.data?.stats as { total?: number; active?: number; byRole?: Record<string, number> } | undefined;
  const catalog = useCatalog();
  const roleName = (id?: string | null) => roles.find((r) => r._id === id)?.name ?? null;
  const branchName = (id?: string | null) => branches.find((b) => b._id === id)?.name ?? null;
  // Dermatologist profiles, for linking a `doctor` login to the profile it edits.
  const doctors = useApi(() => api.doctors.list({ includeInactive: "true" }).then((r) => r.data ?? []), []);
  const doctorOptions = ["— not linked —", ...(doctors.data ?? []).map((d) => `${d.name} (${d.email || "no email"})`)];
  const doctorByLabel = (label: string) => (doctors.data ?? []).find((d) => `${d.name} (${d.email || "no email"})` === label)?._id ?? null;
  const doctorLabel = (id?: string | null) => { const d = (doctors.data ?? []).find((x) => x._id === id); return d ? `${d.name} (${d.email || "no email"})` : "— not linked —"; };

  const ROLES: AdminRole[] = ["super_admin", "staff", "doctor", "therapist"];
  const panelOf = (s: StaffRow) => (s.role === "doctor" ? "Dermatologist panel" : s.role === "therapist" ? "Floor panel" : "Admin panel");
  const centresOf = (s: StaffRow) => {
    const names = (s.assignments ?? []).map((a) => branchName(a.branchId)).filter(Boolean) as string[];
    return names.length ? Array.from(new Set(names)).join(", ") : "—";
  };

  const save = async () => {
    if (!sel) return;
    try {
      await api.staff.update(sel._id, {
        name: sel.name,
        jobTitle: sel.jobTitle ?? null,
        assignments: sel.assignments ?? [],
        doctorId: sel.role === "doctor" ? (sel.doctorId ?? null) : null,
        ...(sel.role === "staff" ? { customRoleId: sel.customRoleId ?? null, permissions: sel.permissions ?? [] } : {}),
      });
      audit("SETTINGS_UPDATED", `Staff ${sel.email} updated`, { staffId: sel._id });
      toast("Staff account updated"); q.reload(); setSel(null);
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Section title="Staff" blurb="Every panel account — super admins, staff, dermatologists and therapists."
      right={canManageStaff ? <StudioBtn onClick={() => setInvOpen(true)}>Add staff member</StudioBtn> : undefined}>
      <StudioHint id="roles-live" steps={[
        "Every panel account lives here — super admins, staff, dermatologists and therapists.",
        "A Staff account gets a custom role (a bundle of permissions) — build roles under Roles & permissions.",
        "Super admins hold every permission; dermatologists and therapists sign into their own panels.",
        "Deactivating blocks sign-in immediately but keeps every audit entry that person created.",
      ]} />

      {!canManageStaff && (
        <Note kind="warn">You can see the team, but only someone with the “manage staff” permission can add, change or remove accounts.</Note>
      )}

      {stats && (
        <StatGrid items={[
          { k: "Staff accounts", v: stats.total ?? rows.length },
          { k: "Active", v: stats.active ?? rows.filter((r) => r.isActive).length },
          ...ROLES.slice(0, 4).map((r) => ({ k: ROLE_LABEL[r], v: stats.byRole?.[r] ?? rows.filter((x) => x.role === r).length })),
        ]} />
      )}

      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email…" className="col-span-full max-w-[420px]" />

      <div className="col-span-full">
        <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />
        <Async q={q} label="Loading staff…" rows={5}>
          {() => rows.length === 0 ? (
            <StudioEmpty title="No staff accounts" hint="Add the people who need to sign into the panel."
              action={canManageStaff ? <StudioBtn onClick={() => setInvOpen(true)}>Add staff member</StudioBtn> : undefined} />
          ) : (
            <StudioTable minWidth={900} stickyFirst
              cols={["Name", "Email", "Role", "Centres", { label: "Sign-in", nowrap: true }, { label: "Last sign-in", nowrap: true }, "Status"]}
              onRow={(i) => setSel(rows[i])}
              rows={rows.map((s) => [
                <span key={s._id} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-[12.5px] font-bold text-white">
                    {initials(s.name || s.email)}
                  </span>
                  <CellStack primary={s.name || s.email.split("@")[0]} secondary={s.jobTitle || undefined} />
                </span>,
                <span key={`${s._id}e`} className="break-all">{s.email}</span>,
                <span key={`${s._id}r`} className="block">
                  {s.role === "staff"
                    ? (roleName(s.customRoleId) ? <RoleChip role={{ name: roleName(s.customRoleId)!, color: roles.find((r) => r._id === s.customRoleId)?.color }} /> : <StatusTag kind="warn">no role</StatusTag>)
                    : <StatusTag kind={s.role === "super_admin" ? "primary" : "info"}>{ROLE_LABEL[s.role]}</StatusTag>}
                  <span className="mt-1 block text-[12.5px] leading-5 text-ink3">{panelOf(s)}</span>
                </span>,
                centresOf(s),
                <StatusTag key={`${s._id}m`} kind={s.hasPassword ? "ok" : "info"}>{s.hasPassword ? "password" : "code"}</StatusTag>,
                s.lastLogin ? fmtWhen(s.lastLogin) : "Never",
                s.terminatedAt
                  ? <StatusTag key={`${s._id}s`} kind="mute">Left {fmtWhen(s.terminatedAt)}</StatusTag>
                  : !s.isActive
                  ? <StatusTag key={`${s._id}s`} kind="mute">Deactivated</StatusTag>
                  : s.canSignIn === false
                    ? <StatusTag key={`${s._id}s`} kind="warn">Not on allow-list</StatusTag>
                    : <StatusTag key={`${s._id}s`} kind="ok">Active</StatusTag>,
              ])} />
          )}
        </Async>
      </div>

      <StudioSheet open={!!sel} onClose={() => setSel(null)} title={sel?.name || sel?.email || ""} width={640}
        sub={sel ? `${sel.email} · ${ROLE_LABEL[sel.role]} · ${sel.isActive ? "active" : "deactivated"} · ${sel.lastLogin ? `last signed in ${fmtDateFull(sel.lastLogin)}` : "has never signed in"}` : undefined}
        footer={sel && canManageStaff ? <>
          <StudioBtn kind="ghost" onClick={() => setSel(null)}>Cancel</StudioBtn>
          <StudioBtn onClick={save}>Save changes</StudioBtn>
        </> : undefined}>
        {sel && (
          <div className="grid gap-6">
            {canManageStaff ? (
              <SignInControls accountId={sel._id} email={sel.email} phone={sel.phone} hasPassword={!!sel.hasPassword}
                onChanged={() => { q.reload(); }} />
            ) : (
              <Note>
                Signs into the {sel.role === "doctor" ? "dermatologist" : sel.role === "therapist" ? "therapist" : "admin"} panel with <B>{sel.email}</B> and {sel.hasPassword ? "a password or " : ""}a 6-digit code emailed at sign-in.
              </Note>
            )}

            {canManageStaff ? (
              <div className="grid gap-5 @lg/fields:grid-cols-2">
                <Field label="Display name"><Input value={sel.name ?? ""} onChange={(v) => setSel({ ...sel, name: v })} /></Field>
                <Field label="Job title" hint="For display and reports. What they can do is the role below.">
                  <Input value={sel.jobTitle ?? ""} onChange={(v) => setSel({ ...sel, jobTitle: v })} placeholder="Clinic Manager, Front desk, Accountant…" />
                </Field>
                {/*
                  * Account type is shown, not chosen. Each kind is created and
                  * retired where it belongs — super admins in ADMIN_EMAILS,
                  * dermatologists and therapists on their own pages — so a
                  * dropdown here would be a second, contradictory way to mint
                  * one. What a Staff account may do is the role below.
                  */}
                <Field label="Account type" full>
                  <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-[10px] border border-border bg-ivory px-3.5 py-2 text-[14px] leading-5 text-ink3">
                    <StatusTag kind={sel.role === "super_admin" ? "primary" : sel.role === "staff" ? "ok" : "info"}>{ROLE_LABEL[sel.role]}</StatusTag>
                    <span>
                      {sel.role === "super_admin"
                        ? <>Set by the server's <code>ADMIN_EMAILS</code> list</>
                        : sel.role === "doctor" ? "Managed on the Dermatologists page"
                        : sel.role === "therapist" ? "Managed on the Therapists page"
                        : "Admin panel access, defined by the role below"}
                    </span>
                  </div>
                </Field>
                {sel.role === "doctor" && (
                  <Field label="Dermatologist profile" full
                    hint={!sel.doctorId ? "Without a link the dermatologist panel matches on email; linking here is explicit and survives an email change." : undefined}>
                    <Select value={doctorLabel(sel.doctorId)} onChange={(v) => setSel({ ...sel, doctorId: doctorByLabel(v) })} options={doctorOptions} />
                  </Field>
                )}

                {sel.role === "staff" && (
                  <StaffAccessFields
                    roles={roles}
                    groups={catalog.data ?? []}
                    customRoleId={sel.customRoleId ?? null}
                    permissions={new Set(sel.permissions ?? [])}
                    onRole={(id) => setSel({ ...sel, customRoleId: id })}
                    onPermissions={(next) => setSel({ ...sel, permissions: [...next] })}
                  />
                )}
                {sel.role !== "super_admin" && (
                  <CentreRolesEditor roles={roles} branches={branches} value={sel.assignments ?? []}
                    onChange={(next) => setSel({ ...sel, assignments: next })} />
                )}

                {sel._id !== admin?._id && (
                  <>
                    <SubHeading title="Account" blurb="Deactivating blocks the next sign-in immediately. Removing the account keeps their audit history — actions never disappear with the person." />
                    <div className="col-span-full flex flex-wrap gap-2">
                      <StudioBtn kind="ghost" onClick={async () => {
                        try {
                          await api.staff.toggle(sel._id);
                          toast(sel.isActive ? "Sign-in blocked" : "Account reactivated");
                          q.reload(); setSel(null);
                        } catch (e) { toast((e as Error).message); }
                      }}>{sel.isActive ? "Deactivate login" : "Reactivate login"}</StudioBtn>
                      {(sel.role === "staff" || sel.role === "therapist") && (
                        <StudioBtn kind="ghost" onClick={() => { setCloneOf(sel); setSel(null); }}>Clone access</StudioBtn>
                      )}
                      {!sel.terminatedAt && <StudioBtn kind="ghost" onClick={() => { setEndOf(sel); setSel(null); }}>End employment…</StudioBtn>}
                      <StudioBtn kind="danger" onClick={() => { setSel(null); setDel(sel); }}>Remove staff</StudioBtn>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Note>Only someone with the “manage staff” permission can change staff accounts.</Note>
            )}
          </div>
        )}
      </StudioSheet>

      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="Add staff account" wide>
        <AddStaffForm roles={roles} groups={catalog.data ?? []} branches={branches} onDone={() => { setInvOpen(false); q.reload(); }} />
      </Modal>

      <CloneStaffModal source={cloneOf} onClose={() => setCloneOf(null)} onDone={() => { setCloneOf(null); q.reload(); }} />
      <EndEmploymentModal target={endOf} onClose={() => setEndOf(null)} onDone={() => { setEndOf(null); q.reload(); }} />

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `staff account "${del.email}"` : ""}
        onConfirm={async (reason) => {
          if (!del) return;
          try {
            await api.staff.remove(del._id);
            audit("SETTINGS_UPDATED", `Removed staff ${del.email} · reason: ${reason}`, { staffId: del._id });
            toast("Staff account removed"); q.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </Section>
  );
}


/**
 * Add an admin-panel staff account — the only kind this screen creates.
 *
 * The other three account types are not made here, so there is no account-type
 * picker to get wrong:
 *   · Super admins come from the server's ADMIN_EMAILS environment variable and
 *     are created on first sign-in. Nobody can mint one from the panel.
 *   · Dermatologists are created on the Dermatologists page, alongside the
 *     clinical profile the login belongs to.
 *   · Therapists are created on the Therapists page, with their centres.
 * Every account signs in with an emailed code; none has a password.
 */
function AddStaffForm({ roles, groups, branches, onDone }: { roles: Role[]; groups: PermissionGroup[]; branches: Branch[]; onDone: () => void }) {
  const { toast, audit } = useStore();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customRoleId, setCustomRoleId] = useState<string | null>(roles[0]?._id ?? null);
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set());
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [signIn, setSignIn] = useState<"code" | "generate" | "typed">("generate");
  const [password, setPassword] = useState("");
  const [notify, setNotify] = useState<"email" | "whatsapp" | "both">("email");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ password: string; email: string; delivery?: { email: string | null; whatsapp: string | null } | null } | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      // Always 'staff'; the server refuses any other account type here.
      const res = await api.staff.create({
        email: email.trim().toLowerCase(), name: name.trim() || undefined, phone: phone.trim() || null, role: "staff",
        jobTitle: jobTitle.trim() || null, customRoleId, permissions: [...perms], assignments,
        ...(signIn === "generate" ? { generatePassword: true, notify } : signIn === "typed" ? { password, notify } : {}),
      });
      const created = res.data as Admin;
      audit("SETTINGS_UPDATED", `Created staff ${created.email}`, { staffId: created._id });
      toast(`${created.email} added`);
      if (res.temporaryPassword) { setIssued({ password: res.temporaryPassword, email: created.email, delivery: res.delivery }); return; }
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (issued) {
    return (
      <div className="grid gap-4">
        <Note>Account created. This temporary password is shown once; they choose their own at first sign-in.</Note>
        <div className="text-[14px] leading-6 text-ink2">Sign-in email: <B>{issued.email}</B></div>
        <div className="rounded-[12px] border border-border bg-ivory px-4 py-4 text-center font-mono text-[22px] font-bold tracking-wide tabular-nums text-ink">{issued.password}</div>
        {issued.delivery && (
          <div className="text-[14px] leading-6 text-ink2">
            {issued.delivery.email && <div>Email: {issued.delivery.email}</div>}
            {issued.delivery.whatsapp && <div>WhatsApp: {issued.delivery.whatsapp}</div>}
          </div>
        )}
        <div className="flex justify-end"><StudioBtn onClick={onDone}>Done</StudioBtn></div>
      </div>
    );
  }

  return (
    <div className="@container/fields grid gap-5">
      <div className="grid gap-5 @lg/fields:grid-cols-2">
        <Field label="Work email" hint="Their sign-in address."><Input type="email" value={email} onChange={setEmail} placeholder="name@zennara.in" /></Field>
        <Field label="Display name"><Input value={name} onChange={setName} placeholder="Leave blank to use the email prefix" /></Field>
        <Field label="Phone" hint="Needed to send sign-in details by WhatsApp."><Input value={phone} onChange={setPhone} placeholder="10-digit mobile" /></Field>
        <Field label="Job title"><Input value={jobTitle} onChange={setJobTitle} placeholder="Front desk, Clinic Manager, Accountant…" /></Field>
      </div>
      <StaffAccessFields
        roles={roles} groups={groups}
        customRoleId={customRoleId} permissions={perms}
        onRole={setCustomRoleId} onPermissions={setPerms}
      />
      <CentreRolesEditor roles={roles} branches={branches} value={assignments} onChange={setAssignments} />

      <div className="grid gap-4 rounded-[12px] border border-border bg-ivory p-4">
        <div>
          <div className="text-[16px] font-semibold leading-6 text-ink">Sign-in</div>
          <div className="text-[14px] leading-5 text-ink2">How they get into the panel.</div>
        </div>
        <Field label="Password"
          hint={signIn === "code" ? "They sign in with a 6-digit code emailed at every sign-in. A password can be set later." : "A temporary password must be changed at first sign-in. The emailed code keeps working too."}>
          <ChoicePills<string> value={signIn} onChange={(v) => setSignIn(v as typeof signIn)}
            options={[{ value: "generate", label: "Generate a temporary password" }, { value: "typed", label: "Set a password now" }, { value: "code", label: "Emailed code only" }]} />
        </Field>
        {signIn === "typed" && (
          <Field label="Password" hint="At least 8 characters. Stored as a hash."><Input type="password" value={password} onChange={setPassword} /></Field>
        )}
        {signIn !== "code" && (
          <Field label="Send the details by" hint={!phone.trim() ? "Add a phone number to send by WhatsApp." : undefined}>
            <ChoicePills<string> value={notify} onChange={(v) => setNotify(v as typeof notify)}
              options={(["email", "whatsapp", "both"] as const).map((c) => ({
                value: c, label: c === "email" ? "Email" : c === "whatsapp" ? "WhatsApp" : "Email and WhatsApp", disabled: c !== "email" && !phone.trim(),
              }))} />
          </Field>
        )}
      </div>

      <Note>
        Adding a <B>dermatologist</B> or <B>therapist</B>? Create them on their own page instead — that is where their
        profile and centres live. <B>Super admins</B> come from the server's <code>ADMIN_EMAILS</code> list
        and appear here once they first sign in.
      </Note>
      {err && <Note kind="err">{err}</Note>}
      <div className="flex justify-end gap-2">
        <StudioBtn kind="ghost" onClick={onDone}>Cancel</StudioBtn>
        <StudioBtn disabled={busy || !/^\S+@\S+\.\S+$/.test(email) || (signIn === "typed" && password.length < 8)} onClick={submit}>{busy ? "Adding…" : "Add staff member"}</StudioBtn>
      </div>
    </div>
  );
}

/** Copy one account's access (role, job, centres) onto a new person. Never the password. */
function CloneStaffModal({ source, onClose, onDone }: { source: StaffRow | null; onClose: () => void; onDone: () => void }) {
  const { toast, audit } = useStore();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setEmail(""); setName(""); setPhone(""); setErr(null); }, [source?._id]);
  return (
    <Modal open={!!source} onClose={onClose} title={source ? `Clone ${source.name || source.email}'s access` : ""}>
      <div className="grid gap-4">
        <Note>Copies the role, job title, centres and centre roles onto a new account. The password and any dermatologist link are not copied.</Note>
        <Field label="New person's work email"><Input type="email" value={email} onChange={setEmail} placeholder="name@zennara.in" /></Field>
        <Field label="Display name"><Input value={name} onChange={setName} /></Field>
        <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="10-digit mobile" /></Field>
        {err && <Note kind="err">{err}</Note>}
        <div className="flex justify-end gap-2">
          <StudioBtn kind="ghost" onClick={onClose}>Cancel</StudioBtn>
          <StudioBtn disabled={busy || !/^\S+@\S+\.\S+$/.test(email)} onClick={async () => {
            if (!source) return;
            setBusy(true); setErr(null);
            try {
              const res = await api.staff.clone(source._id, { email: email.trim().toLowerCase(), name: name.trim() || undefined, phone: phone.trim() || null });
              audit("SETTINGS_UPDATED", `Cloned ${source.email} onto ${email}`, { staffId: (res.data as Admin)?._id });
              toast(res.message || "Cloned"); onDone();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Cloning…" : "Create account"}</StudioBtn>
        </div>
      </div>
    </Modal>
  );
}

/** Zenoti "Terminate": a dated end of employment with a reason; sign-in ends on that date. */
function EndEmploymentModal({ target, onClose, onDone }: { target: StaffRow | null; onClose: () => void; onDone: () => void }) {
  const { toast, audit } = useStore();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setReason(""); setDate(new Date().toISOString().slice(0, 10)); setErr(null); }, [target?._id]);
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `End employment — ${target.name || target.email}` : ""}>
      <div className="grid gap-4">
        <Note kind="err">Their sign-in stops on the date below and every open session is ended. Audit history is kept. A dermatologist is also removed from the app.</Note>
        <Field label="Last working day"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Reason"><Textarea value={reason} onChange={setReason} placeholder="Resigned, contract ended, …" /></Field>
        {err && <Note kind="err">{err}</Note>}
        <div className="flex justify-end gap-2">
          <StudioBtn kind="ghost" onClick={onClose}>Cancel</StudioBtn>
          <StudioBtn kind="danger" disabled={busy || reason.trim().length < 3} onClick={async () => {
            if (!target) return;
            setBusy(true); setErr(null);
            try {
              const res = await api.staff.terminate(target._id, { reason: reason.trim(), effectiveAt: date });
              audit("SETTINGS_UPDATED", `Ended employment for ${target.email} · ${reason.trim()}`, { staffId: target._id });
              toast(res.message || "Employment ended"); onDone();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "End employment"}</StudioBtn>
        </div>
      </div>
    </Modal>
  );
}

/* ================= AUDIT LOG ================= */
const AUDIT_SECTIONS: StudioSection[] = [
  { id: "all", title: "All entries" },
  { id: "suspicious", title: "Suspicious activity" },
];

export function AuditLog() {
  const [page, setPage] = useQueryPage();
  const [action, setAction] = useQueryString("action");
  const [resource, setResource] = useQueryString("resource");
  const [status, setStatus] = useQueryString("status");
  const [who, setWho] = useQueryString("who");
  const [from, setFrom] = useQueryString("from");
  const [to, setTo] = useQueryString("to");
  const [search, setSearch] = useQueryString("q");
  const [viewParam, setView] = useQueryString("view", "all");
  const view: "all" | "suspicious" = viewParam === "suspicious" ? "suspicious" : "all";
  const [sel, setSel] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebounced(search);

  const filters = useApi(() => api.audit.actions().catch(() => undefined), []);
  const params = () => ({
    action: action || undefined, resource: resource || undefined, status: status || undefined,
    adminEmail: who || undefined, startDate: from || undefined, endDate: to || undefined, search: debounced || undefined,
  });
  const q = useApi(
    () => (view === "suspicious" ? api.audit.suspicious({ hours: 72 }) : api.audit.list({ page, limit: 15, ...params() })),
    [page, action, resource, status, who, from, to, debounced, view],
  );

  useEffect(() => { setPage(1); }, [action, resource, status, who, from, to, debounced, view]);

  const rows = q.data?.data ?? [];
  const pagination = q.data?.pagination;
  const f = filters.data as { actions?: string[]; resources?: string[]; admins?: string[] } | undefined;
  const filtersActive = !!(action || resource || status || who || from || to || search);
  const clearFilters = () => { setSearch(""); setAction(""); setResource(""); setWho(""); setStatus(""); setFrom(""); setTo(""); };

  const detailOf = (d?: Record<string, unknown>) => {
    if (!d) return "—";
    if (typeof d.detail === "string" && d.detail) return d.detail;
    const parts: string[] = [];
    if (d.method && d.endpoint) parts.push(`${d.method} ${d.endpoint}`);
    if (d.description) parts.push(String(d.description));
    if (d.target) parts.push(String(d.target));
    if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
    return parts.join(" · ") || "—";
  };

  // Export the whole filtered set, not just the page on screen.
  const exportAll = async () => {
    setExporting(true);
    try {
      const out: AuditEntry[] = [];
      for (let p = 1; p <= 50; p++) {
        const r = await api.audit.list({ page: p, limit: 200, ...params() });
        out.push(...(r.data ?? []));
        if (!r.pagination || p >= (r.pagination.totalPages ?? 1)) break;
      }
      exportCsv("zennara-audit-log",
        ["When", "Who", "Action", "Resource", "Record", "Detail", "IP", "Status", "Error"],
        out.map((a) => [fmtDateFull(a.timestamp), a.adminEmail, a.action, a.resource, a.resourceId ?? "", detailOf(a.details), a.ipAddress ?? "", a.status, a.errorMessage ?? ""]));
    } finally { setExporting(false); }
  };

  const table = (
    <StudioTable minWidth={960}
      cols={[{ label: "When", nowrap: true }, "Who", { label: "Action", nowrap: true }, "Resource", { label: "Detail", width: "30%" }, { label: "IP", nowrap: true }, "Status"]}
      onRow={(i) => setSel(rows[i])}
      empty={view === "suspicious" ? "Nothing suspicious in the last 72 hours." : "No entries match."}
      {...(view === "all" && pagination ? { page: pagination.currentPage ?? page, pageSize: 15, total: pagination.total ?? rows.length, onPage: (p: number) => setPage(p) } : {})}
      rows={rows.map((a) => [
        fmtWhen(a.timestamp),
        <span key={`${a._id}w`} className="break-all font-semibold text-ink">{a.adminEmail}</span>,
        a.action,
        <StatusTag key={`${a._id}r`} kind="mute">{a.resource}</StatusTag>,
        <span key={`${a._id}d`} className="line-clamp-2 text-ink3">{detailOf(a.details)}</span>,
        <span key={`${a._id}i`} className="text-ink3">{a.ipAddress ?? "—"}</span>,
        a.status === "SUCCESS"
          ? <StatusTag key={`${a._id}s`} kind="ok">ok</StatusTag>
          : <StatusTag key={`${a._id}s`} kind="err">{a.status}</StatusTag>,
      ])} />
  );

  return (
    <StudioPage title="Audit log" wide intro="Every administrative change, with who, when and from where. Entries are written by the server and kept for 90 days."
      sections={AUDIT_SECTIONS} active={view} onSection={(id) => setView(id)}
      actions={<StudioBtn kind="ghost" disabled={!rows.length || exporting} onClick={exportAll}>{exporting ? "Exporting…" : "Export CSV (all matching)"}</StudioBtn>}>
      <StudioStale error={q.data ? q.error : null} onRetry={q.reload} />

      {view === "all" ? (
        <Section title="All entries" blurb="Sensitive routes write here automatically, and the panel adds an entry for decisions the route can't see — a cancellation reason, a stock adjustment, a role change.">
          <FilterBar onClear={filtersActive ? clearFilters : undefined}>
            <Field label="Search" className="min-w-[240px] flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder="Email, action or record id…" />
            </Field>
            <Field label="Action" className="w-[200px]">
              <Select value={action} onChange={setAction} options={[{ value: "", label: "All actions" }, ...(f?.actions ?? []).map((a) => ({ value: a, label: a }))]} />
            </Field>
            <Field label="Resource" className="w-[180px]">
              <Select value={resource} onChange={setResource} options={[{ value: "", label: "All resources" }, ...(f?.resources ?? []).map((r) => ({ value: r, label: r }))]} />
            </Field>
            <Field label="Who" className="w-[220px]">
              <Select value={who} onChange={setWho} options={[{ value: "", label: "Everyone" }, ...(f?.admins ?? []).map((a) => ({ value: a, label: a }))]} />
            </Field>
            <Field label="Outcome" className="w-[160px]">
              <Select value={status} onChange={setStatus} options={[{ value: "", label: "Any outcome" }, { value: "SUCCESS", label: "SUCCESS" }, { value: "FAILED", label: "FAILED" }, { value: "WARNING", label: "WARNING" }]} />
            </Field>
            <Field label="From" className="w-[170px]"><DateInput value={from} onChange={setFrom} max={to || undefined} /></Field>
            <Field label="To" className="w-[170px]"><DateInput value={to} onChange={setTo} min={from || undefined} /></Field>
          </FilterBar>
          <div className="col-span-full">
            <Async q={q} label="Loading the audit trail…" rows={10}>
              {() => rows.length === 0 ? (
                <StudioEmpty title="No entries match" hint="Try clearing the filters, or make a change in the panel and come back." />
              ) : table}
            </Async>
          </div>
          <Note>
            A failed or denied action is recorded too — that is often the more interesting row.
          </Note>
        </Section>
      ) : (
        <Section title="Suspicious activity" blurb="Repeated failures, denied access and off-hours changes from the last 72 hours.">
          <div className="col-span-full">
            <Async q={q} label="Loading the audit trail…" rows={10}>
              {() => rows.length === 0 ? (
                <StudioEmpty title="Nothing suspicious in the last 72 hours" hint="Repeated failures, denied access and off-hours changes show up here." />
              ) : table}
            </Async>
          </div>
        </Section>
      )}

      <StudioSheet open={!!sel} onClose={() => setSel(null)} title={sel ? sel.action : "Entry"}
        sub={sel ? `${fmtDateFull(sel.timestamp)} · ${sel.adminEmail}` : undefined} width={600}
        footer={<StudioBtn kind="ghost" onClick={() => setSel(null)}>Close</StudioBtn>}>
        {sel && (
          <div className="grid gap-5">
            <DetailList items={[
              ["When", fmtDateFull(sel.timestamp)],
              ["Who", <B key="who">{sel.adminEmail}</B>],
              ["Resource", <span key="res">{sel.resource}{sel.resourceId ? <span className="ml-2 break-all text-ink3">{sel.resourceId}</span> : null}</span>],
              ["Outcome", sel.status === "SUCCESS" ? <StatusTag key="st" kind="ok">ok</StatusTag> : <StatusTag key="st" kind="err">{sel.status}</StatusTag>],
              ["IP", sel.ipAddress ?? "—"],
              !!sel.userAgent && ["Browser", <span key="ua" className="break-all text-ink2">{sel.userAgent}</span>],
            ]} />
            {sel.errorMessage && <Note kind="err">{sel.errorMessage}</Note>}
            <div className="grid gap-3">
              <SubHeading title="Details" blurb="The record exactly as the server wrote it." />
              <pre className="st-json m-0 max-h-[50vh] overflow-auto rounded-[10px] border border-border bg-ivory p-4 text-ink">{JSON.stringify(sel.details ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </StudioSheet>
    </StudioPage>
  );
}


/* ------------------------------ staff sales ------------------------------ */
/** Zenoti's "Employee sales" report: who sold what, from closed bills (sale-by per line). */
function StaffSalesPanel() {
  const { branchId } = useStore();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(isoDay());
  const q = useApi(() => api.analytics.salesByStaff({ from, to, branchId: branchId || undefined }), [from, to, branchId]);
  const rows = (q.data?.data ?? []) as import("../lib/types").StaffSalesRow[];
  const totals = q.data?.totals;
  return (
    <>
      <FilterBar>
        <Field label="From" className="w-[170px]"><DateInput value={from} onChange={setFrom} max={to || undefined} /></Field>
        <Field label="To" className="w-[170px]"><DateInput value={to} onChange={setTo} min={from || undefined} /></Field>
        <StudioBtn kind="ghost" disabled={!rows.length} onClick={() => exportCsv(`staff-sales-${from}-${to}`, ["Staff", "Services", "Products", "Packages", "Memberships", "Other", "Total", "Items", "Bills"], rows.map((r) => [r.staff, r.services, r.products, r.packages, r.memberships, r.other, r.total, r.items, r.bills]))}>Export CSV</StudioBtn>
        {totals && <span className="self-center text-[14px] leading-5 text-ink2">{totals.staff} staff · {totals.invoices} bills · <B>{fmtINR(totals.total)}</B></span>}
      </FilterBar>
      <Async q={q} label="Adding up sales…" rows={4}>
        {() => rows.length === 0 ? <StudioEmpty title="No sales in this range" hint="Sales are attributed by the Sale-by on each bill line; visits paid without a bill go to their dermatologist." /> : (
          <StudioTable stickyFirst minWidth={980}
            cols={["Staff", { label: "Services", align: "right", nowrap: true }, { label: "Products", align: "right", nowrap: true }, { label: "Packages", align: "right", nowrap: true }, { label: "Memberships", align: "right", nowrap: true }, { label: "Other", align: "right", nowrap: true }, { label: "Total", align: "right", nowrap: true }, { label: "Items", align: "right" }, { label: "Bills", align: "right" }]}
            rows={rows.map((r) => [<B key="s">{r.staff}</B>, fmtINR(r.services), fmtINR(r.products), fmtINR(r.packages), fmtINR(r.memberships), fmtINR(r.other), <B key="t">{fmtINR(r.total)}</B>, String(r.items), String(r.bills)])} />
        )}
      </Async>
    </>
  );
}
