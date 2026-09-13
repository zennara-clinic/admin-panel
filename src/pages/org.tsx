import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import {
  Area, AreaChart, Async, B, Btn, Card, ChartCard, DataTable, DateRange, DeleteModal, Drawer, Empty, ErrorState, GBars, HBars, Hint, In,
  Loading, Menu, MenuButton, Modal, Note as UiNote, Page, RatingValue, SecH, Sel, StaleBanner, Stars, Stats, Tabs, Tag, Toggle, exportCsv,
} from "../ui";
import {
  DateInput, DetailList, Field, ImageInput, Input, Note, NumberInput, RemoveButton, Row, Section, Select, StatusTag,
  StudioBtn, StudioEmpty, StudioPage, StudioSheet, StudioStale, SubHeading, ToggleRow, useStudioSection, type StudioSection,
} from "../studio-ui";
import { useStore, ROLE_LABEL } from "../store";
import { DEFAULT_METRIC_RANGE, customWindow, isMetricRange, metricWindow, type MetricRange } from "../lib/ranges";
import { RangeSwitch } from "../rangeSwitch";
import api, { type AppointmentAnalytics, type Dashboard, type FinancialAnalytics, type InventoryAnalytics, type PatientAnalytics, type ServiceAnalytics } from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import {
  clinicWeekday, fmtCompactINR, fmtDate, fmtDateFull, fmtDayKey, fmtINR, fmtWhen,
  initials, isoDay, nameOf, pct,
} from "../lib/format";
import type { Admin, AdminRole, AnalyticsSeries, AuditEntry, Branch, ConsultationReview, GuestDemographics, GuestSources, GuestWindow, MonthlyRevenueRow, PatientAcquisitionRow, PermissionGroup, PermissionKey, ProductReview, Role, ServiceReview, StaffAssignment } from "../lib/types";
import { SESSION_SLOT_MINUTES } from "../lib/scheduling";
import { RolesManager, SignInSecurityTab, StaffAccessFields, RoleChip, useCatalog, CentreRolesEditor, SignInControls } from "./access";

/*
 * The Organisation pages.
 *
 * Branches and Analytics use App Studio's layout (src/studio-ui.tsx) — a rail
 * of sections for Branches, top tabs for Analytics. Reviews, Staff & roles and
 * the Audit log were moved onto it too and the user asked for them back as
 * they were, so those three stay on the original primitives from src/ui.tsx
 * (Page/Card/DataTable/Drawer/Tabs). That is why this file imports both sets,
 * and why ui's Note arrives as `UiNote`: both modules export a `Note` and the
 * two halves of the file want different ones.
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

  return (
    <Page title="Reviews" sub="Guest reviews from the app — moderate what shows publicly"
      actions={<>
        <Menu button={<MenuButton kind="ghost">{pending ? "Awaiting approval" : "All reviews"}</MenuButton>}
          items={[
            { label: "All reviews", onClick: () => setPending(false) },
            { label: "Awaiting approval", onClick: () => setPending(true) },
          ]} />
        <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv(`zennara-${kind}-reviews`,
          ["Date", "Guest", "Subject", "Rating", "Review", "Approved"],
          rows.map((r) => [fmtDate(r.createdAt), nameOf(r.userId, "Anonymous"), subjectOf(r), r.rating, r.reviewText, r.isApproved ? "yes" : "no"]))}>
          Export CSV
        </Btn>
      </>}>
      <Tabs active={["consultations", "products", "services"].indexOf(kind)}
        onChange={(i) => setKind((["consultations", "products", "services"] as ReviewKind[])[i])}
        items={[["Consultations"], ["Products"], ["Package services"]]} />

      <Stats items={[
        { k: "Reviews", v: rows.length },
        { k: "Average rating", v: avg ? avg.toFixed(1) : "—", hot: avg >= 4.5 },
        { k: "5 star", v: rows.filter((r) => r.rating === 5).length, tone: "up" },
        { k: "2 star or less", v: lowScores.length, tone: lowScores.length ? "dn" : undefined },
        { k: "Awaiting approval", v: rows.filter((r) => !r.isApproved).length },
      ]} />

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading reviews…" rows={6}>
        {() => rows.length === 0 ? (
          <Empty title={pending ? "Nothing awaiting approval" : "No reviews yet"}
            hint="Guests are asked for a review after a completed visit or a delivered order." />
        ) : (
          <DataTable cols={["Date", "Guest", "Subject", "Rating", "Review", "Status"]}
            onRow={(i) => setSel(rows[i]._id)}
            rows={rows.map((r) => [
              fmtDate(r.createdAt),
              nameOf(r.userId, "Anonymous"),
              subjectOf(r),
              <Stars key={`${r._id}s`} n={r.rating} />,
              <span key={`${r._id}t`} className="line-clamp-2 text-[11.5px]">{r.reviewText}</span>,
              r.isApproved ? <Tag key={`${r._id}a`} kind="ok">Published</Tag> : <Tag key={`${r._id}a`} kind="warn">Hidden</Tag>,
            ])} />
        )}
      </Async>

      <Drawer open={!!selected} onClose={() => setSel(null)} title={selected ? nameOf(selected.userId, "Anonymous") : ""}>
        {selected && (
          <div className="grid gap-3">
            <Card className="p-3.5">
              <Stars n={selected.rating} />
              <div className="mt-1.5 text-[13px] leading-relaxed text-ink2">{selected.reviewText}</div>
              <div className="mt-2 text-[11px] text-ink3">{subjectOf(selected)} · {fmtDateFull(selected.createdAt)}</div>
              {"images" in selected && !!selected.images?.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.images.map((img, i) => <img key={i} src={img} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />)}
                </div>
              )}
            </Card>

            {selected.rating <= 2 && (
              <UiNote kind="crit" className="my-0">
                A low score usually needs a call, not a reply. Open the guest's record and have the branch manager
                reach out before anything is published.
              </UiNote>
            )}

            {canModerate ? (
              <>
                {selected.isApproved
                  ? <Btn kind="ghost" onClick={() => approve(selected._id, false)}>Hide from the app</Btn>
                  : <Btn onClick={() => approve(selected._id, true)}>Publish to the app</Btn>}
                <Btn kind="danger" onClick={() => remove(selected._id)}>Delete review</Btn>
              </>
            ) : (
              <UiNote className="my-0">You can read reviews, but only someone with the “moderate reviews” permission can publish, hide or delete them.</UiNote>
            )}
          </div>
        )}
      </Drawer>

      <UiNote>
        Approving publishes a review to the app and feeds the service or product's star rating. Hiding keeps it on
        record without showing it — nothing is silently edited.
      </UiNote>
    </Page>
  );
}

/* ================= ANALYTICS ================= */
/*
 * The period follows every metrics page (lib/ranges.ts): This month by
 * default — the 1st to today — then Last 90 days, All time, or custom dates.
 *
 * One convention for every endpoint: `startDate` / `endDate` are clinic day
 * keys, and "All time" sends NO start at all — an open window the backend
 * reads as "everything the clinic holds". (Some routes used to fall back to
 * their own last 30 days on a missing start, which is why a 2015 floor was
 * once sent to them; nothing here sends that floor any more.)
 *
 * Loading is per tab. TAB_NEEDS lists the responses each tab draws, and only
 * those are requested — in parallel — when the tab, the period or the centre
 * changes. Every response is kept per (endpoint, period, centre) for the life
 * of the page, so returning to a tab or a period already seen renders at once
 * with no request. Refresh forgets everything and re-reads the open tab.
 */
const ANALYTICS_TABS: [string, (number | string)?][] = [["Revenue"], ["Appointments"], ["Dermatologists"], ["Services"], ["Guests"], ["Products & orders"], ["Packages & memberships"], ["Stock"], ["Staff sales"]];

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

/** The fourteen responses the page can draw, by the name each is read as in the JSX. */
type AnalyticsKey = "dash" | "financial" | "appointments" | "patients" | "services" | "inventory" | "monthly" | "acquisition" | "demographics" | "sources" | "top" | "orders" | "products" | "pkgStats";

type AnalyticsData = {
  dash: Dashboard;
  financial: FinancialAnalytics | undefined;
  appointments: AppointmentAnalytics;
  patients: PatientAnalytics | undefined;
  services: ServiceAnalytics | undefined;
  inventory: InventoryAnalytics | undefined;
  monthly: AnalyticsSeries | MonthlyRevenueRow[];
  acquisition: AnalyticsSeries | PatientAcquisitionRow[];
  demographics: GuestDemographics | undefined;
  sources: GuestSources;
  top: Awaited<ReturnType<typeof api.analytics.topPatients>>;
  orders: Awaited<ReturnType<typeof api.orders.stats>> | undefined;
  products: Awaited<ReturnType<typeof api.products.statistics>> | undefined;
  pkgStats: Awaited<ReturnType<typeof api.packageAssignments.stats>> | undefined;
};

/** What is sent to every window-aware endpoint. `startDate` undefined = all time. */
type AnalyticsScope = { startDate?: string; endDate: string; branchId?: string; floorStart?: string; days?: number };

/*
 * What each endpoint is actually sent.
 *
 * "All time" is an OPEN start (no startDate). The API is being moved to read
 * that as all time everywhere, but financial / appointments / services used
 * to fall back to their own last-30-days when no start came — and the API is
 * deployed by hand, so the panel can be live before it. Those three get the
 * 2015 floor instead, which both versions read as "everything"; /patients
 * keeps its legacy `days` for the same reason. Everything else gets the clean
 * pair, with the helpers stripped off so the query strings stay honest.
 */
const plainScope = ({ floorStart: _f, days: _d, ...s }: AnalyticsScope) => s;
const flooredScope = ({ floorStart, days: _d, ...s }: AnalyticsScope) => ({ ...s, startDate: s.startDate ?? floorStart });
const legacyDaysScope = ({ floorStart: _f, ...s }: AnalyticsScope) => s;

/**
 * What each tab draws, worked out from the JSX below. `dash` carries the
 * revenue streams, counts, dermatologist board and the daily series, so most
 * tabs need it; Stock reads only the inventory summary and Staff sales fetches
 * for itself.
 */
const TAB_NEEDS: Record<number, AnalyticsKey[]> = {
  0: ["dash", "financial", "monthly"],                                            // Revenue
  1: ["dash", "appointments"],                                                    // Appointments
  2: ["dash"],                                                                    // Dermatologists
  3: ["dash", "services"],                                                        // Services
  4: ["dash", "patients", "acquisition", "demographics", "sources", "top"],       // Guests
  5: ["dash", "orders", "products"],                                              // Products & orders
  6: ["dash", "services", "patients", "pkgStats"],                                // Packages & memberships
  7: ["inventory"],                                                               // Stock
  8: [],                                                                          // Staff sales (StaffSalesPanel loads its own)
};

/** All-time counters that take no period or centre; kept once, not once per window. */
const UNSCOPED: ReadonlySet<AnalyticsKey> = new Set<AnalyticsKey>(["orders", "products", "pkgStats"]);

/**
 * One fetcher per response. `dash` and `appointments` are required by the
 * tabs that read them and surface their error; the rest degrade to "absent"
 * so one slow or broken report never blanks a whole tab.
 */
const ANALYTICS_FETCH: { [K in AnalyticsKey]: (scope: AnalyticsScope) => Promise<AnalyticsData[K]> } = {
  dash: (s) => api.analytics.dashboard(plainScope(s)).catch((e) => { throw new Error(`Dashboard: ${(e as Error).message}`); }),
  financial: (s) => api.analytics.financial(flooredScope(s)).catch(() => undefined),
  appointments: (s) => api.analytics.appointments(flooredScope(s)).catch((e) => { throw new Error(`Appointments: ${(e as Error).message}`); }),
  patients: (s) => api.analytics.patients(legacyDaysScope(s)).catch(() => undefined),
  services: (s) => api.analytics.services(flooredScope(s)).catch(() => undefined),
  inventory: ({ startDate, endDate }) => api.analytics.inventory({ startDate, endDate }).catch(() => undefined),
  monthly: (s) => api.analytics.monthlyRevenue(plainScope(s)).catch(() => []),
  acquisition: (s) => api.analytics.patientAcquisition(plainScope(s)).catch(() => []),
  demographics: (s) => api.analytics.demographics(plainScope(s)).catch(() => undefined),
  sources: (s) => api.analytics.sources(plainScope(s)).catch(() => ({ rows: [] })),
  top: (s) => api.analytics.topPatients(10, plainScope(s)).catch(() => []),
  orders: () => api.orders.stats().catch(() => undefined),
  products: () => api.products.statistics().catch(() => undefined),
  pkgStats: () => api.packageAssignments.stats().catch(() => undefined),
};

/** A dated series in one shape, whichever the backend answered. */
type DatedSeries = { granularity: "day" | "month"; points: { key: string; value: number }[]; windowed: boolean };
function seriesOf(input: AnalyticsSeries | { month: string; revenue?: number; totalRevenue?: number; count?: number }[] | undefined): DatedSeries {
  if (!input) return { granularity: "month", points: [], windowed: false };
  if (Array.isArray(input)) {
    return { granularity: "month", windowed: false, points: input.map((m) => ({ key: String(m.month), value: Number(m.totalRevenue ?? m.revenue ?? m.count) || 0 })) };
  }
  return {
    granularity: input.granularity === "day" ? "day" : "month",
    windowed: true,
    points: (input.points ?? []).map((p) => ({ key: String(p.key), value: Number(p.value) || 0 })),
  };
}
function seriesLabel(s: DatedSeries, key: string): string {
  if (s.granularity === "day") return fmtDayKey(key.slice(0, 10), { day: "numeric", month: "short", year: "2-digit" });
  return /^\d{4}-\d{2}$/.test(key) ? fmtDayKey(`${key}-01`, { month: "short", year: "numeric" }) : key;
}
/** Card subtitle for a guest-base breakdown: which guests the backend counted. */
const guestScope = (w: GuestWindow | undefined) => (w === undefined ? "Registered guests" : w === "all-time" ? "All guests" : "Guests joined in this period");

export function Analytics() {
  // Trade happens at the three clinics; a pharmacy filter would always be empty.
  const { clinics: branches } = useStore();
  const [rangeParam, setRange] = useQueryString("range", DEFAULT_METRIC_RANGE);
  // An old link can still carry "30 days" or "This year"; it opens on the default.
  const range: MetricRange = isMetricRange(rangeParam) ? rangeParam : DEFAULT_METRIC_RANGE;
  const [custom, setCustom] = useState<{ startDate: string; endDate: string } | null>(null);
  const [branchId, setBranchId] = useQueryString("branch", "");
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: ANALYTICS_TABS.length - 1 });

  const win = useMemo(() => (custom ? customWindow(custom.startDate, custom.endDate) : metricWindow(range)), [range, custom]);
  // The same window to every endpoint; All time is an open start, not a floor.
  const scope = useMemo<AnalyticsScope>(() => ({ startDate: win.startDate, endDate: win.endDate, branchId: branchId || undefined, floorStart: win.floorStart, days: win.days }), [win, branchId]);
  const sig = `${scope.startDate ?? ""}|${scope.endDate}|${scope.branchId ?? ""}`;

  // Everything fetched so far, by (response, period, centre). Lives as long as the page.
  const store = useRef({ values: new Map<string, unknown>(), inflight: new Map<string, Promise<unknown>>(), gen: 0 }).current;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const cacheKey = useCallback((k: AnalyticsKey) => (UNSCOPED.has(k) ? k : `${k}|${sig}`), [sig]);
  const fetchKey = useCallback(<K extends AnalyticsKey>(k: K): Promise<AnalyticsData[K]> => {
    const ck = cacheKey(k);
    if (store.values.has(ck)) return Promise.resolve(store.values.get(ck) as AnalyticsData[K]);
    let p = store.inflight.get(ck) as Promise<AnalyticsData[K]> | undefined;
    if (!p) {
      const gen = store.gen;
      p = (ANALYTICS_FETCH[k] as (s: AnalyticsScope) => Promise<AnalyticsData[K]>)(scope).then(
        (v) => { if (gen === store.gen) store.values.set(ck, v); store.inflight.delete(ck); return v; },
        (e: unknown) => { store.inflight.delete(ck); throw e; },
      );
      store.inflight.set(ck, p);
    }
    return p;
  }, [cacheKey, scope, store]);

  const needs = TAB_NEEDS[tab] ?? [];
  useEffect(() => {
    const missing = needs.filter((k) => !store.values.has(cacheKey(k)));
    setError(null);
    if (!missing.length) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    Promise.all(missing.map((k) => fetchKey(k)))
      .catch((e: unknown) => { if (live) setError((e as Error)?.message ?? "Something went wrong"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sig, attempt]);

  /** Forget everything and re-read the open tab. */
  const refresh = () => { store.gen += 1; store.values.clear(); store.inflight.clear(); setAttempt((n) => n + 1); };
  const retry = () => setAttempt((n) => n + 1);

  // What the open tab can draw right now: its own fresh set, or — while a new
  // period is on its way — what it showed last, dimmed, so nothing blinks out.
  const have = needs.every((k) => store.values.has(cacheKey(k)));
  const fresh = have ? (Object.fromEntries(needs.map((k) => [k, store.values.get(cacheKey(k))])) as Partial<AnalyticsData>) : null;
  const last = useRef<{ tab: number; data: Partial<AnalyticsData> } | null>(null);
  if (fresh) last.current = { tab, data: fresh };
  const data = fresh ?? (last.current?.tab === tab ? last.current.data : null);
  const stale = !fresh && !!data;

  const branchName = branches.find((b) => b._id === branchId)?.name ?? "All centres";
  const label = custom ? `Custom · ${win.label}` : range === "All time" ? "All time" : `${range} · ${win.label}`;

  const exportAll = async () => {
    setExporting(true);
    try {
      const [d, appts] = await Promise.all([fetchKey("dash"), fetchKey("appointments")]);
      const a = appts.overview;
      exportCsv("zennara-analytics", ["Metric", "Value"], [
        ["Range", label], ["Centre", branchName], ["Total revenue", d.revenue.total], ["Previous period", d.revenue.previous],
        ...d.revenue.streams.map((s) => [`${s.label} revenue`, s.revenue] as [string, number]),
        ...d.revenue.streams.map((s) => [`${s.label} count`, s.count] as [string, number]),
        ["Bookings", a.totalBookings], ["Completed", a.completedBookings], ["Cancellation rate %", a.cancellationRate], ["No-show rate %", a.noShowRate],
        ["New guests", d.counts.newPatients], ["Active Zen members", d.counts.activeZen], ["Orders", d.counts.orders], ["Packages assigned", d.counts.packagesAssigned],
        ...d.dermatologists.map((x) => [`${x.name}`, `${x.bookings} bookings · ${x.completed} completed · ₹${x.revenue}`] as [string, string]),
        ...d.topServices.map((x) => [`Service: ${x.name}`, `${x.bookings} · ₹${x.revenue}`] as [string, string]),
      ]);
    } catch (e) {
      setError((e as Error)?.message ?? "Something went wrong");
    } finally {
      setExporting(false);
    }
  };

  const body = ({ financial, patients, services, inventory, demographics, orders, products, pkgStats, ...rest }: Partial<AnalyticsData>) => {
    // `dash` is on every tab that reads it (TAB_NEEDS); `appointments` on the Appointments tab.
    const d = rest.dash as Dashboard;
    const appointments = rest.appointments as AppointmentAnalytics;
    const monthly = seriesOf(rest.monthly);
    const acquisition = seriesOf(rest.acquisition);
    const sources = rest.sources?.rows ?? [];
    const top = rest.top ?? [];
    const daily = rest.dash?.daily ?? [];
    const streams = rest.dash?.revenue.streams ?? [];
    const growth = rest.dash?.revenue.growthPercent ?? null;
    const dailyLabels = daily.map((x) => fmtDayKey(x.date.slice(0, 10), { day: "numeric", month: "short", year: "2-digit" }));
    const consultTrend = bucketSeries(daily, 10, (x) => x.consultations);
    const treatTrend = bucketSeries(daily, 10, (x) => x.treatments);
    const bl = bucketLabels(daily, 10);
    return (
      <>
        {tab === 0 && (
          <>
            <Stats items={[
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
            <Stats items={[
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

            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title="Revenue by day" sub="All streams, as paid" hero={fmtINR(d.revenue.total)}>
                {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.total)} labels={dailyLabels} label="Revenue" format={fmtCompactINR} /> : <Empty title="Pick a longer range" />}
              </ChartCard>
              <ChartCard title="Streams over time" sub="Consultations · treatments · products · packages · memberships">
                {bl.length > 1 ? <GBars cats={bl} series={[
                  { n: "Consultations", v: bucketSeries(d.daily, 10, (x) => x.consultations) }, { n: "Treatments", v: bucketSeries(d.daily, 10, (x) => x.treatments) },
                  { n: "Products", v: bucketSeries(d.daily, 10, (x) => x.products) }, { n: "Packages", v: bucketSeries(d.daily, 10, (x) => x.packages) }, { n: "Memberships", v: bucketSeries(d.daily, 10, (x) => x.memberships) },
                ]} /> : <Empty title="Pick a longer range" />}
              </ChartCard>
              <ChartCard title="Revenue mix" sub="Share by stream">
                <HBars rows={streams.map((s) => [s.label, s.revenue, `${d.revenue.total ? Math.round((s.revenue / d.revenue.total) * 100) : 0}% · ${fmtCompactINR(s.revenue)}`] as [string, number, string])} />
              </ChartCard>
              <ChartCard title={monthly.windowed ? "Revenue trend" : "Monthly revenue"}
                sub={monthly.windowed ? `${monthly.granularity === "day" ? "By day" : "By month"} · ${label}` : "Last 12 months, all centres in scope"}>
                {monthly.points.length > 1 ? <AreaChart pts={monthly.points.map((p) => p.value)} labels={monthly.points.map((p) => seriesLabel(monthly, p.key))} label={monthly.granularity === "day" ? "Day" : "Month"} format={fmtCompactINR} /> : <Empty title="Not enough history yet" />}
              </ChartCard>
              <ChartCard title="Revenue by centre" sub="Visits, packages and clinic sales — app orders have no centre">
                {d.revenueByCentre.length ? <HBars color="var(--color-c2)" rows={d.revenueByCentre.map((r) => [r.centre, r.revenue, `${r.bookings} bookings · ${fmtCompactINR(r.revenue)}`] as [string, number, string])} /> : <Empty title="No bookings" />}
              </ChartCard>
              <ChartCard title="Payment mix" sub="How the money came in">
                {d.paymentMix.length ? <HBars color="var(--color-c3)" rows={d.paymentMix.map((p) => [p.method, p.amount, fmtCompactINR(p.amount)] as [string, number, string])} /> : <Empty title="No payments" />}
                <div className="mt-3 grid gap-1.5 text-[12px]">
                  <KVRow k="Outstanding (bookings + packages)" v={fmtINR(d.counts.outstanding)} />
                  <KVRow k="Average ticket" v={fmtINR(d.counts.averageTicket)} />
                  {financial && <KVRow k="Cancelled (catalogue value)" v={fmtINR(financial.overview.refundsLost)} />}
                </div>
              </ChartCard>
            </div>
          </>
        )}

        {tab === 1 && (() => {
          const a = appointments.overview;
          return (
            <>
              <Stats items={[
                { k: "Bookings", v: d.counts.bookings, d: `${d.counts.upcoming} upcoming`, hot: true },
                { k: "Consultations", v: d.counts.consultations, d: `${Math.round((d.counts.consultations / Math.max(1, d.counts.bookings)) * 100)}% of bookings` },
                { k: "Treatments", v: d.counts.treatments, d: `${Math.round((d.counts.treatments / Math.max(1, d.counts.bookings)) * 100)}% of bookings` },
                { k: "Completed", v: d.counts.completed, d: `${pct(a.conversionRate)} conversion`, tone: "up" },
                { k: "No-show", v: `${d.counts.noShowRate}%`, d: `${d.counts.noShow} missed`, tone: d.counts.noShowRate > 8 ? "dn" : "up" },
                { k: "Cancelled", v: `${d.counts.cancellationRate}%`, d: `${d.counts.cancelled} cancelled`, tone: d.counts.cancellationRate > 10 ? "dn" : undefined },
              ]} />
              <div className="grid gap-3 xl:grid-cols-2">
                <ChartCard title="Consultations vs treatments" sub="Bookings over the period">
                  {bl.length > 1 ? <GBars cats={bl} series={[{ n: "Consultations", v: consultTrend }, { n: "Treatments", v: treatTrend }]} /> : <Empty title="Pick a longer range" />}
                </ChartCard>
                <ChartCard title="Bookings per day" hero={String(d.counts.bookings)}>
                  {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.bookings)} labels={dailyLabels} label="Bookings" /> : <Empty title="Pick a longer range" />}
                </ChartCard>
                <ChartCard title="Outcome mix" sub={label}>
                  <GBars cats={["Completed", "Upcoming", "Cancelled", "No-show"]} series={[{ n: "Bookings", v: [d.counts.completed, d.counts.upcoming, d.counts.cancelled, d.counts.noShow] }]} />
                </ChartCard>
                <ChartCard title="Where bookings come from" sub="App · reception · package · Zennara clinic">
                  <HBars color="var(--color-c4)" rows={Object.entries(d.counts.bookingsBySource).map(([k, v]) => [k, v] as [string, number])} />
                </ChartCard>
                <ChartCard title="Busiest days" sub="Bookings by weekday">
                  <HBars color="var(--color-c2)" rows={(appointments.peakDays ?? []).map((x) => [x.day, x.count] as [string, number])} />
                </ChartCard>
                <ChartCard title="Busiest hours" sub="Bookings by hour of day">
                  <HBars color="var(--color-c3)" rows={(appointments.peakHours ?? []).filter((h) => h.count > 0).map((h) => [h.hour, h.count] as [string, number])} />
                </ChartCard>
                <Card className="p-4">
                  <SecH t="Load & flow" />
                  <div className="grid gap-2 text-[12.5px]">
                    <KVRow k="Per day" v={String(appointments.averages?.perDay ?? 0)} />
                    <KVRow k="Per week" v={String(appointments.averages?.perWeek ?? 0)} />
                    <KVRow k="Per month" v={String(appointments.averages?.perMonth ?? 0)} />
                    <KVRow k="Upcoming this week" v={String(appointments.upcomingThisWeek ?? 0)} />
                    <KVRow k="Awaiting confirmation" v={String(d.counts.awaitingConfirmation)} />
                    <KVRow k="Avg days between visits" v={String(appointments.avgTimeBetweenBookings ?? 0)} />
                  </div>
                </Card>
                {!!(appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService?.length && (
                  <ChartCard title="No-shows by service">
                    <HBars color="var(--color-err)" rows={((appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService ?? []).slice(0, 8).map((x) => [x.service, x.count] as [string, number])} />
                  </ChartCard>
                )}
              </div>
            </>
          );
        })()}

        {tab === 2 && (
          <>
            <Stats items={[
              { k: "Dermatologists", v: d.dermatologists.filter((x) => x.bookings > 0).length, d: `${d.dermatologists.length} on the roster`, hot: true },
              { k: "Top earner", v: d.dermatologists[0]?.revenue ? d.dermatologists[0].name.split(" ")[0] : "—", d: d.dermatologists[0] ? fmtCompactINR(d.dermatologists[0].revenue) : "" },
              { k: "Busiest", v: [...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.name.split(" ")[0] ?? "—", d: `${[...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.bookings ?? 0} bookings` },
              { k: "Best completion", v: `${Math.max(0, ...d.dermatologists.filter((x) => x.bookings >= 3).map((x) => x.completionRate))}%`, d: "min 3 bookings" },
              { k: "Avg rating", v: (() => { const r = d.dermatologists.filter((x) => x.avgRating); return r.length ? <RatingValue value={Number((r.reduce((n, x) => n + (x.avgRating ?? 0), 0) / r.length).toFixed(1))} /> : "—"; })(), d: "across rated visits" },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title="Revenue by dermatologist" sub={label}>
                <HBars rows={d.dermatologists.filter((x) => x.revenue > 0).map((x) => [x.name, x.revenue, fmtCompactINR(x.revenue)] as [string, number, string])} />
              </ChartCard>
              <ChartCard title="Consultations vs treatments" sub="Per dermatologist">
                <GBars cats={d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.name.split(" ")[0])} series={[{ n: "Consultations", v: d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.consultations) }, { n: "Treatments", v: d.dermatologists.filter((x) => x.bookings > 0).map((x) => x.treatments) }]} />
              </ChartCard>
            </div>
            <div className="mt-3">
              <DataTable cols={["Dermatologist", "Level", "Bookings", "Consults", "Treatments", "Completed", "No-show", "Guests", "Rating", "Revenue", "Per booking"]}
                rows={d.dermatologists.map((x, i) => [
                  <span key={x.doctorId} className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${i === 0 && x.revenue > 0 ? "bg-gold text-primary" : "bg-sage text-ink2"}`}>{i + 1}</span><B>{x.name}</B>{!x.onboarded && <Tag kind="info">Zenoti</Tag>}</span>,
                  <Tag key={`${x.doctorId}l`} kind={!x.onboarded ? "info" : x.level === "Senior Dermatologist" ? "gold" : "mute"}>{x.level}</Tag>,
                  x.bookings, x.consultations, x.treatments, `${x.completed} (${x.completionRate}%)`, x.noShow, x.patients, x.avgRating ? <RatingValue value={x.avgRating} /> : "—", <B key={`${x.doctorId}r`}>{fmtINR(x.revenue)}</B>, fmtINR(x.bookings ? Math.round(x.revenue / x.bookings) : 0),
                ])} />
            </div>
          </>
        )}

        {tab === 3 && (
          <>
            <Stats items={[
              { k: "Services booked", v: d.topServices.length, d: `${services?.summary?.totalServices ?? "—"} in catalogue`, hot: true },
              { k: "Top service", v: d.topServices[0]?.name ?? "—", d: d.topServices[0] ? `${d.topServices[0].bookings} bookings · ${fmtCompactINR(d.topServices[0].revenue)}` : "" },
              { k: "Revenue / service", v: fmtINR(services?.summary?.avgRevenuePerService), d: "average" },
              { k: "Categories", v: services?.categoryPerformance?.length ?? 0, d: "with bookings" },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title="Top services by revenue" sub={label}>
                {d.topServices.length ? <HBars rows={d.topServices.slice(0, 10).map((x) => [x.name, x.revenue, `${x.bookings} · ${fmtCompactINR(x.revenue)}`] as [string, number, string])} /> : <Empty title="No services booked" />}
              </ChartCard>
              <ChartCard title="Top services by volume">
                {d.topServices.length ? <HBars color="var(--color-c2)" rows={[...d.topServices].sort((x, y) => y.bookings - x.bookings).slice(0, 10).map((x) => [x.name, x.bookings, x.kind] as [string, number, string])} /> : <Empty title="No services booked" />}
              </ChartCard>
              <ChartCard title="Category performance" sub={label}>
                {services?.categoryPerformance?.length ? <HBars color="var(--color-c3)" rows={services.categoryPerformance.slice(0, 10).map((c) => [c.category, c.revenue, fmtCompactINR(c.revenue)] as [string, number, string])} /> : <Empty title="No category data" />}
              </ChartCard>
              {!!services?.leastPerformingServices?.length && (
                <ChartCard title="Needs attention" sub="Least booked services in the catalogue">
                  <HBars color="var(--color-err)" rows={(services.leastPerformingServices as { name: string; bookings?: number }[]).slice(0, 8).map((x) => [x.name, x.bookings ?? 0] as [string, number])} />
                </ChartCard>
              )}
              {!!services?.packageUtilization?.length && (
                <ChartCard title="Package utilisation" sub="Sessions used of sessions sold">
                  <HBars color="var(--color-c4)" rows={services.packageUtilization.slice(0, 8).map((p2) => [p2.name, p2.used, `${p2.used}/${p2.total}`] as [string, number, string])} />
                </ChartCard>
              )}
            </div>
          </>
        )}

        {tab === 4 && (
          <>
            <Stats items={[
              { k: "Guests on file", v: d.counts.totalPatients.toLocaleString("en-IN"), hot: true, d: `${d.counts.newPatients} new in period` },
              { k: "New guests", v: d.counts.newPatients, d: patients ? `${pct(patients.overview.newPatientRatio)} of bookers` : "" },
              { k: "Retention", v: patients ? pct(patients.overview.retentionRate) : "—", d: patients ? `${patients.overview.returningPatients} returning` : "" },
              { k: "Zen members", v: d.counts.activeZen, d: `${d.counts.zenExpiring} expiring in 30d`, tone: d.counts.zenExpiring ? "dn" : undefined },
              { k: "Birthdays today", v: patients?.birthdaysToday?.length ?? 0, d: "send a wish from the guest page" },
              { k: "Inactive", v: patients?.inactivePatients?.count ?? 0, d: `no visit in ${patients?.inactivePatients?.threshold ?? 90}d` },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title={acquisition.windowed ? "New guests" : "New guests per month"}
                sub={acquisition.windowed ? `${acquisition.granularity === "day" ? "By day" : "By month"} · ${label}` : undefined}
                hero={String(d.counts.newPatients)}>
                {acquisition.points.length > 1 ? <AreaChart pts={acquisition.points.map((p) => p.value)} labels={acquisition.points.map((p) => seriesLabel(acquisition, p.key))} label="New guests" /> : <Empty title="Not enough history yet" />}
              </ChartCard>
              <ChartCard title="By home centre" sub={guestScope(rest.sources?.window)}>
                {sources.length ? <HBars color="var(--color-c2)" rows={sources.map((x) => [x.source || "Unknown", x.count, `${x.count} · ${pct(x.percentage)}`] as [string, number, string])} /> : <Empty title="No data" />}
              </ChartCard>
              {demographics && (
                <>
                  <ChartCard title="Age groups" sub={guestScope(demographics.window)}><HBars rows={(demographics.ageGroups ?? []).map((g) => [g.range ?? g.group ?? "—", g.count] as [string, number])} /></ChartCard>
                  <ChartCard title="Gender" sub={guestScope(demographics.window)}><HBars color="var(--color-c3)" rows={Object.entries(demographics.gender ?? {}).filter(([k]) => k !== "total").map(([k, v]) => [k, Number(v)] as [string, number])} /></ChartCard>
                </>
              )}
              <Card className="p-4 xl:col-span-2">
                <SecH t="Top guests by spend" em={`· ${label}`} />
                {top.length === 0 ? <Empty title="No spend recorded" /> : <DataTable cols={["Guest", "Spend", "Visits"]} rows={top.map((t) => [<B key={t._id}>{t.fullName}</B>, fmtINR(t.totalSpent), t.visits ?? "—"])} />}
              </Card>
            </div>
          </>
        )}

        {tab === 5 && (
          <>
            <Stats items={[
              { k: "Product revenue", v: fmtCompactINR(streams.find((s) => s.key === "products")?.revenue ?? 0), hot: true, d: `app ${fmtCompactINR(streams.find((s) => s.key === "products")?.app ?? 0)} · clinic ${fmtCompactINR(streams.find((s) => s.key === "products")?.clinic ?? 0)}` },
              { k: "Orders", v: d.counts.orders, d: `${d.counts.paidOrders} paid · ${d.counts.openOrders} open` },
              { k: "Delivered", v: d.counts.ordersByStatus["Delivered"] ?? 0, d: `${d.counts.ordersByStatus["Cancelled"] ?? 0} cancelled · ${d.counts.ordersByStatus["Returned"] ?? 0} returned` },
              { k: "All-time orders", v: orders?.totalOrders ?? "—", d: orders ? fmtCompactINR(orders.totalRevenue) : "" },
              { k: "Products", v: products?.total ?? "—", d: products ? `${products.active} live · ${products.lowStock} low stock` : "" },
              { k: "Stock value", v: products ? fmtCompactINR(products.totalValue) : "—", d: products ? `${products.totalStock} units` : "" },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title="Product revenue by day" hero={fmtINR(streams.find((s) => s.key === "products")?.app ?? 0)}>
                {d.daily.length > 1 ? <AreaChart pts={d.daily.map((x) => x.products)} labels={dailyLabels} label="Products" format={fmtCompactINR} /> : <Empty title="Pick a longer range" />}
              </ChartCard>
              <ChartCard title="Orders by status" sub={label}>
                {Object.keys(d.counts.ordersByStatus).length ? <HBars color="var(--color-c2)" rows={Object.entries(d.counts.ordersByStatus).map(([k, v]) => [k, v] as [string, number])} /> : <Empty title="No orders in this period" />}
              </ChartCard>
              {products?.byFormulation && Object.keys(products.byFormulation).length > 0 && (
                <ChartCard title="Stock value by formulation">
                  <HBars color="var(--color-c3)" rows={Object.entries(products.byFormulation).map(([k, v]) => [k, v.value, `${v.count} products · ${v.stock} units`] as [string, number, string])} />
                </ChartCard>
              )}
              {orders && (
                <Card className="p-4"><SecH t="Order pipeline (all time)" />
                  <div className="grid gap-2 text-[12.5px]">
                    <KVRow k="New" v={String(orders.newOrders)} /><KVRow k="Confirmed" v={String(orders.confirmedOrders)} /><KVRow k="Processing" v={String(orders.processingOrders)} /><KVRow k="Shipped" v={String(orders.shippedOrders)} /><KVRow k="Delivered" v={String(orders.deliveredOrders)} /><KVRow k="Cancelled" v={String(orders.cancelledOrders)} />
                  </div>
                </Card>
              )}
            </div>
          </>
        )}

        {tab === 6 && (
          <>
            <Stats items={[
              { k: "Package revenue", v: fmtCompactINR(streams.find((s) => s.key === "packages")?.revenue ?? 0), hot: true, d: `app ${fmtCompactINR(streams.find((s) => s.key === "packages")?.app ?? 0)} · clinic ${fmtCompactINR(streams.find((s) => s.key === "packages")?.clinic ?? 0)}` },
              { k: "Packages assigned", v: d.counts.packagesAssigned, d: `${d.counts.packagesPaid} paid · ${d.counts.packagesUnpaid} due` },
              { k: "Membership revenue", v: fmtCompactINR(streams.find((s) => s.key === "memberships")?.revenue ?? 0), d: d.counts.membershipsUnpriced ? `${d.counts.membershipsSold} sold · ${d.counts.membershipsUnpriced} unpriced` : `${d.counts.membershipsSold} sold` },
              { k: "Active Zen members", v: d.counts.activeZen, d: `${d.counts.zenExpiring} expiring in 30d`, tone: d.counts.zenExpiring ? "dn" : undefined },
              { k: "Active assignments", v: pkgStats?.statusCounts?.find((s) => s._id === "Active")?.count ?? "—", d: `${pkgStats?.statusCounts?.find((s) => s._id === "Completed")?.count ?? 0} completed` },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ChartCard title="Packages & memberships by day">
                {bl.length > 1 ? <GBars cats={bl} series={[{ n: "Packages", v: bucketSeries(d.daily, 10, (x) => x.packages) }, { n: "Memberships", v: bucketSeries(d.daily, 10, (x) => x.memberships) }]} /> : <Empty title="Pick a longer range" />}
              </ChartCard>
              {pkgStats?.statusCounts && (
                <ChartCard title="Assignments by status" sub="All time">
                  <HBars color="var(--color-c2)" rows={pkgStats.statusCounts.map((s) => [s._id, s.count] as [string, number])} />
                </ChartCard>
              )}
              {pkgStats?.paymentStats && (
                <ChartCard title="Package payments" sub="Received vs due (all time)">
                  <HBars color="var(--color-c3)" rows={pkgStats.paymentStats.map((s) => [s._id ? "Received" : "Due", s.totalAmount, `${s.count} · ${fmtCompactINR(s.totalAmount)}`] as [string, number, string])} />
                </ChartCard>
              )}
              {!!services?.packageUtilization?.length && (
                <ChartCard title="Package utilisation" sub="Sessions used of sessions sold">
                  <HBars color="var(--color-c4)" rows={services.packageUtilization.slice(0, 10).map((p2) => [p2.name, p2.used, `${p2.used}/${p2.total} · ${pct(p2.utilizationRate)}`] as [string, number, string])} />
                </ChartCard>
              )}
              {!!d.counts.membershipsUnpriced && (
                <Card className="p-4"><SecH t="Memberships without a recorded price" />
                  <div className="text-[12.5px] text-ink2">
                    <B>{d.counts.membershipsUnpriced}</B> of {d.counts.membershipsSold} memberships in this period have no amount on record — Zennara clinic (Zenoti) memberships carry no price in the CRM feed, and desk grants made before amounts were captured have none either.
                    They are counted here but contribute <B>₹0</B> to revenue rather than an invented figure. Open the guest and use <B>Record payment details</B> on their membership card to add what was charged.
                  </div>
                </Card>
              )}
              {patients?.membershipStatus && (
                <Card className="p-4"><SecH t="Membership base" />
                  <div className="grid gap-2 text-[12.5px]">
                    <KVRow k="Active" v={String(patients.membershipStatus.active)} /><KVRow k="Expired" v={String(patients.membershipStatus.expired)} /><KVRow k="Pending" v={String(patients.membershipStatus.pending)} />
                  </div>
                </Card>
              )}
            </div>
          </>
        )}

        {tab === 8 && <StaffSalesPanel />}
        {tab === 7 && (
          inventory ? (
            <>
              <Stats items={[
                { k: "Items tracked", v: inventory.summary?.totalItems ?? 0, hot: true },
                { k: "Stock value", v: fmtCompactINR(inventory.summary?.totalValue), d: `cost ${fmtCompactINR(inventory.summary?.totalCost)}` },
                { k: "Below re-order", v: inventory.summary?.lowStockCount ?? 0, tone: (inventory.summary?.lowStockCount ?? 0) ? "dn" : undefined },
                { k: "Out of stock", v: inventory.summary?.outOfStockCount ?? 0, tone: (inventory.summary?.outOfStockCount ?? 0) ? "dn" : undefined },
                { k: "Expiring in 30d", v: inventory.summary?.expiringIn30Days ?? 0, d: `${inventory.summary?.expired ?? 0} expired` },
              ]} />
              <div className="grid gap-3 xl:grid-cols-2">
                <Card className="p-4">
                  <SecH t="Low-stock alerts" />
                  {(inventory.lowStockAlerts ?? []).length === 0 ? <Empty title="Nothing below re-order level" /> : (
                    <DataTable cols={["Item", "On hand", "Re-order"]} rows={(inventory.lowStockAlerts ?? []).slice(0, 15).map((i) => [<B key={i._id}>{i.inventoryName}</B>, i.qohAllBatches ?? 0, i.reOrderLevel ?? 0])} />)}
                </Card>
                {!!(inventory as { fastMovingProducts?: { name?: string; inventoryName?: string; consumed?: number; quantity?: number }[] }).fastMovingProducts?.length && (
                  <ChartCard title="Fast-moving stock">
                    <HBars color="var(--color-c2)" rows={((inventory as { fastMovingProducts?: { name?: string; inventoryName?: string; consumed?: number; quantity?: number }[] }).fastMovingProducts ?? []).slice(0, 10).map((x) => [x.name ?? x.inventoryName ?? "—", x.consumed ?? x.quantity ?? 0] as [string, number])} />
                  </ChartCard>
                )}
              </div>
            </>
          ) : <Empty title="Stock analytics unavailable" hint="The inventory analytics endpoint did not respond." />
        )}
      </>
    );
  };

  return (
    <Page title="Analytics" sub={`${branchName} · ${label}`}
      actions={<>
        <RangeSwitch value={range} onChange={setRange} custom={custom} onCustom={setCustom}
          seed={{ startDate: win.startDate ?? metricWindow(DEFAULT_METRIC_RANGE).startDate!, endDate: win.endDate }} />
        <Menu button={<MenuButton kind="ghost">{branchName}</MenuButton>}
          items={[{ label: "All centres", onClick: () => setBranchId("") }, ...branches.map((b) => ({ label: b.name, onClick: () => setBranchId(b._id) }))]} />
        <Btn kind="ghost" disabled={loading} onClick={refresh}>Refresh</Btn>
        <Btn kind="ghost" disabled={exporting} onClick={() => { void exportAll(); }}>{exporting ? "Exporting…" : "Export CSV"}</Btn>
      </>}>
      <Tabs active={tab} onChange={setTab} items={ANALYTICS_TABS} />
      <StaleBanner error={data ? error : null} onRetry={retry} />
      {!data ? (
        error && !loading ? <ErrorState message={error} onRetry={retry} /> : <Loading label="Crunching the numbers…" rows={8} />
      ) : (
        <div className={stale && loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={stale && loading ? "true" : undefined}>
          {body(data)}
        </div>
      )}
    </Page>
  );
}

/** A labelled figure on an analytics card. (`Row` from studio-ui is the Branches table row.) */
const KVRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
    <span className="text-ink3">{k}</span><b className="font-semibold tabular-nums">{v}</b>
  </div>
);

/** Zenoti's "Employee sales" report: who sold what, from closed bills (sale-by per line). */
function StaffSalesPanel() {
  const { branchId } = useStore();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(isoDay());
  const q = useApi(() => api.analytics.salesByStaff({ from, to, branchId: branchId || undefined }), [from, to, branchId]);
  const rows = (q.data?.data ?? []) as import("../lib/types").StaffSalesRow[];
  const totals = q.data?.totals;
  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv(`staff-sales-${from}-${to}`, ["Staff", "Services", "Products", "Packages", "Memberships", "Other", "Total", "Items", "Bills"], rows.map((r) => [r.staff, r.services, r.products, r.packages, r.memberships, r.other, r.total, r.items, r.bills]))}>Export CSV</Btn>
        {totals && <span className="text-[12px] text-ink3">{totals.staff} staff · {totals.invoices} bills · <B>{fmtINR(totals.total)}</B></span>}
      </div>
      <Async q={q} label="Adding up sales…" rows={4}>
        {() => rows.length === 0 ? <Empty title="No sales in this range" hint="Sales are attributed by the Sale-by on each bill line; visits paid without a bill go to their dermatologist." /> : (
          <DataTable cols={["Staff", "Services", "Products", "Packages", "Memberships", "Other", "Total", "Items", "Bills"]}
            rows={rows.map((r) => [<B key="s">{r.staff}</B>, fmtINR(r.services), fmtINR(r.products), fmtINR(r.packages), fmtINR(r.memberships), fmtINR(r.other), <B key="t">{fmtINR(r.total)}</B>, String(r.items), String(r.bills)])} />
        )}
      </Async>
    </div>
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
  // Land on whichever tab the account can actually see.
  const [tab, setTab] = useState(canViewStaff ? 0 : 1);

  const rolesQ = useApi(() => (canViewRoles || canViewStaff ? api.roles.list() : Promise.resolve([] as Role[])), []);
  const roleCount = rolesQ.data?.length;

  /*
   * Sign-in security is super-admin-only and by ROLE, not permission: these
   * switches govern who can get into the panels at all, so they must not be
   * grantable through a custom role someone assembles later. The server
   * enforces the same rule.
   */
  const panels: { label: string; count?: number | string; render: () => ReactNode }[] = [];
  if (canViewStaff) panels.push({ label: "Staff", render: () => <StaffTab roles={rolesQ.data ?? []} /> });
  if (canViewRoles) panels.push({ label: "Roles & permissions", count: roleCount, render: () => <RolesManager /> });
  if (isSuperAdmin) panels.push({ label: "Sign-in security", render: () => <SignInSecurityTab /> });

  const showTabs = panels.length > 1;
  const active = Math.min(tab, panels.length - 1);

  return (
    <Page title="Staff & roles" sub="Who signs into the panel, and exactly what each person can do">
      {showTabs && <Tabs items={panels.map((p) => [p.label, p.count] as [string, (number | string)?])} active={active} onChange={setTab} />}
      {panels[active]?.render() ?? null}
    </Page>
  );
}

function StaffTab({ roles }: { roles: Role[] }) {
  // Staff are posted to clinics; stock locations have no roster.
  const { toast, audit, canManageStaff, admin, can, clinics: branches } = useStore();
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
  // Doctor profiles, for linking a `doctor` login to the profile it edits.
  const doctors = useApi(() => api.doctors.list({ includeInactive: "true" }).then((r) => r.data ?? []), []);
  const doctorOptions = ["— not linked —", ...(doctors.data ?? []).map((d) => `${d.name} (${d.email || "no email"})`)];
  const doctorByLabel = (label: string) => (doctors.data ?? []).find((d) => `${d.name} (${d.email || "no email"})` === label)?._id ?? null;
  const doctorLabel = (id?: string | null) => { const d = (doctors.data ?? []).find((x) => x._id === id); return d ? `${d.name} (${d.email || "no email"})` : "— not linked —"; };

  const ROLES: AdminRole[] = ["super_admin", "staff", "doctor", "therapist"];

  return (
    <>
      {canManageStaff && <div className="mb-3 flex justify-end"><Btn onClick={() => setInvOpen(true)}>+ Add staff</Btn></div>}
      <Hint id="roles-live" steps={[
        "Every panel account lives here — super admins, staff, dermatologists and therapists.",
        "A Staff account gets a custom role (a bundle of permissions) — build roles on the Roles & permissions tab.",
        "Super admins hold every permission; dermatologists and therapists sign into their own panels.",
        "Deactivating blocks sign-in immediately but keeps every audit entry that person created.",
      ]} />

      {!canManageStaff && (
        <UiNote kind="crit">You can see the team, but only someone with the “manage staff” permission can add, change or remove accounts.</UiNote>
      )}

      {stats && (
        <Stats items={[
          { k: "Staff accounts", v: stats.total ?? rows.length },
          { k: "Active", v: stats.active ?? rows.filter((r) => r.isActive).length },
          ...ROLES.slice(0, 4).map((r) => ({ k: ROLE_LABEL[r], v: stats.byRole?.[r] ?? rows.filter((x) => x.role === r).length })),
        ]} />
      )}

      <div className="mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…"
          className="w-full max-w-[380px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
      </div>

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading staff…" rows={5}>
        {() => rows.length === 0 ? (
          <Empty title="No staff accounts" hint="Add the people who need to sign into the panel."
            action={canManageStaff ? <Btn onClick={() => setInvOpen(true)}>+ Add staff</Btn> : undefined} />
        ) : (
          <DataTable cols={["Name", "Email", "Job", "Role", "Panel", "Sign-in", "Last sign-in", "Status"]}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((s) => [
              <span key={s._id} className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-white">
                  {initials(s.name || s.email)}
                </span>
                <B>{s.name || s.email.split("@")[0]}</B>
              </span>,
              <span key={`${s._id}e`} className="text-[11.5px]">{s.email}</span>,
              <span key={`${s._id}j`} className="text-[11.5px] text-ink2">{s.jobTitle || "—"}</span>,
              s.role === "staff"
                ? (roleName(s.customRoleId) ? <RoleChip key={`${s._id}r`} role={{ name: roleName(s.customRoleId)!, color: roles.find((r) => r._id === s.customRoleId)?.color }} /> : <Tag key={`${s._id}r`} kind="warn">no role</Tag>)
                : <Tag key={`${s._id}r`} kind={s.role === "super_admin" ? "gold" : "info"}>{ROLE_LABEL[s.role]}</Tag>,
              s.role === "doctor" ? "Dermatologist panel" : s.role === "therapist" ? "Floor panel" : "Admin panel",
              <Tag key={`${s._id}m`} kind={s.hasPassword ? "ok" : "info"}>{s.hasPassword ? "password" : "code"}</Tag>,
              s.lastLogin ? fmtWhen(s.lastLogin) : "Never",
              s.terminatedAt
                ? <Tag key={`${s._id}s`} kind="mute">Left {fmtWhen(s.terminatedAt)}</Tag>
                : !s.isActive
                ? <Tag key={`${s._id}s`} kind="mute">Deactivated</Tag>
                : s.canSignIn === false
                  ? <Tag key={`${s._id}s`} kind="warn">Not on allow-list</Tag>
                  : <Tag key={`${s._id}s`} kind="ok">Active</Tag>,
            ])} />
        )}
      </Async>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.name || sel?.email || ""}>
        {sel && (
          <div className="grid gap-3">
            <div className="rounded-xl bg-ivory px-3.5 py-2.5 text-[12.5px] text-ink2">
              {sel.email}<br />
              {ROLE_LABEL[sel.role]} · {sel.isActive ? "active" : "deactivated"}<br />
              {sel.lastLogin ? `Last signed in ${fmtDateFull(sel.lastLogin)}` : "Has never signed in"}
            </div>

            {canManageStaff ? (
              <SignInControls accountId={sel._id} email={sel.email} phone={sel.phone} hasPassword={!!sel.hasPassword}
                onChanged={() => { q.reload(); }} />
            ) : (
              <UiNote className="my-0 text-[11.5px]">
                Signs into the {sel.role === "doctor" ? "dermatologist" : sel.role === "therapist" ? "therapist" : "admin"} panel with <B>{sel.email}</B> and {sel.hasPassword ? "a password or " : ""}a 6-digit code emailed at sign-in.
              </UiNote>
            )}

            {canManageStaff ? (
              <>
                <In label="Display name" value={sel.name ?? ""} onChange={(v) => setSel({ ...sel, name: v })} />
                <In label="Job title" value={sel.jobTitle ?? ""} onChange={(v) => setSel({ ...sel, jobTitle: v })}
                  placeholder="Clinic Manager, Front desk, Accountant…" hint="For display and reports. What they can do is the role below." />
                {/*
                  * Account type is shown, not chosen. Each kind is created and
                  * retired where it belongs — super admins in ADMIN_EMAILS,
                  * dermatologists and therapists on their own pages — so a
                  * dropdown here would be a second, contradictory way to mint
                  * one. What a Staff account may do is the role below.
                  */}
                <div>
                  <div className="mb-1.5 text-[11px] font-bold text-ink2">Account type</div>
                  <div className="flex items-center gap-2 rounded-(--radius-btn) border border-border bg-ivory px-3 py-2.5">
                    <Tag kind={sel.role === "super_admin" ? "gold" : sel.role === "staff" ? "ok" : "info"}>{ROLE_LABEL[sel.role]}</Tag>
                    <span className="text-[11.5px] text-ink3">
                      {sel.role === "super_admin"
                        ? <>Set by the server's <code>ADMIN_EMAILS</code> list</>
                        : sel.role === "doctor" ? "Managed on the Dermatologists page"
                        : sel.role === "therapist" ? "Managed on the Therapists page"
                        : "Admin panel access, defined by the role below"}
                    </span>
                  </div>
                </div>
                {sel.role === "doctor" && (
                  <Sel label="Dermatologist profile" value={doctorLabel(sel.doctorId)}
                    onChange={(v) => setSel({ ...sel, doctorId: doctorByLabel(v) })}
                    options={doctorOptions} />
                )}
                {sel.role === "doctor" && !sel.doctorId && (
                  <div className="-mt-2 text-[10.5px] text-ink3">Without a link the dermatologist panel matches on email; linking here is explicit and survives an email change.</div>
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

                <Btn onClick={async () => {
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
                }}>Save changes</Btn>

                {sel._id !== admin?._id && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Btn kind="ghost" onClick={async () => {
                        try {
                          await api.staff.toggle(sel._id);
                          toast(sel.isActive ? "Sign-in blocked" : "Account reactivated");
                          q.reload(); setSel(null);
                        } catch (e) { toast((e as Error).message); }
                      }}>{sel.isActive ? "Deactivate login" : "Reactivate login"}</Btn>
                      {(sel.role === "staff" || sel.role === "therapist") && (
                        <Btn kind="ghost" onClick={() => { setCloneOf(sel); setSel(null); }}>Clone access</Btn>
                      )}
                    </div>
                    {!sel.terminatedAt && <Btn kind="ghost" onClick={() => { setEndOf(sel); setSel(null); }}>End employment…</Btn>}
                    <Btn kind="danger" onClick={() => { setSel(null); setDel(sel); }}>Remove staff</Btn>
                  </>
                )}
              </>
            ) : (
              <UiNote>Only someone with the “manage staff” permission can change staff accounts.</UiNote>
            )}

            <UiNote className="text-[11.5px]">
              Deactivating blocks the next sign-in immediately. Removing the account keeps their audit history —
              actions never disappear with the person.
            </UiNote>
          </div>
        )}
      </Drawer>

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
    </>
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
      <div className="grid gap-3">
        <UiNote kind="gold">Account created. This temporary password is shown once; they choose their own at first sign-in.</UiNote>
        <div className="text-[12.5px]">Sign-in email: <B>{issued.email}</B></div>
        <div className="rounded-xl border border-border bg-ivory px-4 py-3 text-center font-mono text-[20px] font-bold tracking-wide">{issued.password}</div>
        {issued.delivery && (
          <div className="text-[11.5px] text-ink3">
            {issued.delivery.email && <div>Email: {issued.delivery.email}</div>}
            {issued.delivery.whatsapp && <div>WhatsApp: {issued.delivery.whatsapp}</div>}
          </div>
        )}
        <div className="flex justify-end"><Btn onClick={onDone}>Done</Btn></div>
      </div>
    );
  }

  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-[12px] font-semibold ${on ? "border-primary bg-cream" : "border-border bg-surface hover:bg-ivory"}`;

  return (
    <>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <In label="Work email" type="email" value={email} onChange={setEmail} placeholder="name@zennara.in" hint="Their sign-in address." />
          <In label="Display name" value={name} onChange={setName} placeholder="Leave blank to use the email prefix" />
          <In label="Phone" value={phone} onChange={setPhone} placeholder="10-digit mobile" hint="Needed to send sign-in details by WhatsApp." />
          <In label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Front desk, Clinic Manager, Accountant…" />
        </div>
        <StaffAccessFields
          roles={roles} groups={groups}
          customRoleId={customRoleId} permissions={perms}
          onRole={setCustomRoleId} onPermissions={setPerms}
        />
        <CentreRolesEditor roles={roles} branches={branches} value={assignments} onChange={setAssignments} />

        <div className="grid gap-2 rounded-xl border border-border bg-ivory/60 p-3">
          <SecH t="Sign-in" em="· how they get into the panel" />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setSignIn("generate")} className={pill(signIn === "generate")}>Generate a temporary password</button>
            <button onClick={() => setSignIn("typed")} className={pill(signIn === "typed")}>Set a password now</button>
            <button onClick={() => setSignIn("code")} className={pill(signIn === "code")}>Emailed code only</button>
          </div>
          {signIn === "typed" && <In label="Password" type="password" value={password} onChange={setPassword} hint="At least 8 characters. Stored as a hash." />}
          {signIn !== "code" && (
            <div>
              <div className="mb-1 text-[11px] font-bold text-ink2">Send the details by</div>
              <div className="flex flex-wrap gap-1.5">
                {(["email", "whatsapp", "both"] as const).map((c) => (
                  <button key={c} onClick={() => setNotify(c)} disabled={c !== "email" && !phone.trim()} className={`${pill(notify === c)} disabled:opacity-40`}>
                    {c === "email" ? "Email" : c === "whatsapp" ? "WhatsApp" : "Email and WhatsApp"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="text-[11px] text-ink3">
            {signIn === "code" ? "They sign in with a 6-digit code emailed at every sign-in. A password can be set later." : "A temporary password must be changed at first sign-in. The emailed code keeps working too."}
          </div>
        </div>
      </div>

      <UiNote className="text-[11.5px]">
        Adding a <B>dermatologist</B> or <B>therapist</B>? Create them on their own page instead — that is where their
        profile and centres live. <B>Super admins</B> come from the server's <code>ADMIN_EMAILS</code> list
        and appear here once they first sign in.
      </UiNote>
      {err && <UiNote kind="crit">{err}</UiNote>}
      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onDone}>Cancel</Btn>
        <Btn disabled={busy || !/^\S+@\S+\.\S+$/.test(email) || (signIn === "typed" && password.length < 8)} onClick={submit}>{busy ? "Adding…" : "Add staff"}</Btn>
      </div>
    </>
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
      <div className="grid gap-3">
        <UiNote className="my-0">Copies the role, job title, centres and centre roles onto a new account. The password and any doctor link are not copied.</UiNote>
        <In label="New person's work email" type="email" value={email} onChange={setEmail} placeholder="name@zennara.in" />
        <In label="Display name" value={name} onChange={setName} />
        <In label="Phone" value={phone} onChange={setPhone} placeholder="10-digit mobile" />
        {err && <UiNote kind="crit">{err}</UiNote>}
        <div className="flex justify-end gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={busy || !/^\S+@\S+\.\S+$/.test(email)} onClick={async () => {
            if (!source) return;
            setBusy(true); setErr(null);
            try {
              const res = await api.staff.clone(source._id, { email: email.trim().toLowerCase(), name: name.trim() || undefined, phone: phone.trim() || null });
              audit("SETTINGS_UPDATED", `Cloned ${source.email} onto ${email}`, { staffId: (res.data as Admin)?._id });
              toast(res.message || "Cloned"); onDone();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Cloning…" : "Create account"}</Btn>
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
      <div className="grid gap-3">
        <UiNote className="my-0" kind="crit">Their sign-in stops on the date below and every open session is ended. Audit history is kept. A dermatologist is also removed from the app.</UiNote>
        <In label="Last working day" type="date" value={date} onChange={setDate} />
        <Area label="Reason" value={reason} onChange={setReason} placeholder="Resigned, contract ended, …" />
        {err && <UiNote kind="crit">{err}</UiNote>}
        <div className="flex justify-end gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="danger" disabled={busy || reason.trim().length < 3} onClick={async () => {
            if (!target) return;
            setBusy(true); setErr(null);
            try {
              const res = await api.staff.terminate(target._id, { reason: reason.trim(), effectiveAt: date });
              audit("SETTINGS_UPDATED", `Ended employment for ${target.email} · ${reason.trim()}`, { staffId: target._id });
              toast(res.message || "Employment ended"); onDone();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "End employment"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ================= AUDIT LOG ================= */
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

  return (
    <Page title="Audit log" sub="Every administrative change, with who, when and from where"
      actions={<>
        <Btn kind="ghost" onClick={() => setView(view === "all" ? "suspicious" : "all")}>{view === "all" ? "Suspicious activity (72h)" : "← All entries"}</Btn>
        <Btn kind="ghost" disabled={!rows.length || exporting} onClick={exportAll}>{exporting ? "Exporting…" : "Export CSV (all matching)"}</Btn>
      </>}>
      <Hint id="audit-live">Sensitive routes write here automatically, and the panel adds an entry for decisions the route can't see — a cancellation reason, a stock adjustment, a role change. Entries are kept for 90 days.</Hint>

      {view === "all" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email, action or record id…"
            className="w-64 rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
          <Menu button={<MenuButton kind="ghost">{action || "All actions"}</MenuButton>}
            items={[{ label: "All actions", onClick: () => setAction("") },
              ...(f?.actions ?? []).map((a) => ({ label: a, onClick: () => setAction(a) }))]} />
          <Menu button={<MenuButton kind="ghost">{resource || "All resources"}</MenuButton>}
            items={[{ label: "All resources", onClick: () => setResource("") },
              ...(f?.resources ?? []).map((r) => ({ label: r, onClick: () => setResource(r) }))]} />
          <Menu button={<MenuButton kind="ghost">{who || "Everyone"}</MenuButton>}
            items={[{ label: "Everyone", onClick: () => setWho("") },
              ...(f?.admins ?? []).map((a) => ({ label: a, onClick: () => setWho(a) }))]} />
          <Menu button={<MenuButton kind="ghost">{status || "Any outcome"}</MenuButton>}
            items={[{ label: "Any outcome", onClick: () => setStatus("") },
              { label: "SUCCESS", onClick: () => setStatus("SUCCESS") },
              { label: "FAILED", onClick: () => setStatus("FAILED") },
              { label: "WARNING", onClick: () => setStatus("WARNING") }]} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-(--radius-btn) border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none" />
          <span className="text-[12px] text-ink3">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-(--radius-btn) border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none" />
        </div>
      )}

      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading the audit trail…" rows={10}>
        {() => rows.length === 0 ? (
          <Empty title={view === "suspicious" ? "Nothing suspicious in the last 72 hours" : "No entries match"}
            hint={view === "suspicious" ? "Repeated failures, denied access and off-hours changes show up here." : "Try clearing the filters, or make a change in the panel and come back."} />
        ) : (
          <>
            <DataTable cols={["When", "Who", "Action", "Resource", "Detail", "IP", "Status"]}
              onRow={(i) => setSel(rows[i])}
              rows={rows.map((a) => [
                <span key={a._id} className="whitespace-nowrap font-mono text-[11.5px]">{fmtWhen(a.timestamp)}</span>,
                <B key={`${a._id}w`}>{a.adminEmail}</B>,
                <span key={`${a._id}a`} className="font-mono text-[11px]">{a.action}</span>,
                <Tag key={`${a._id}r`} kind="mute">{a.resource}</Tag>,
                <span key={`${a._id}d`} className="line-clamp-2 text-[11.5px] text-ink3">{detailOf(a.details)}</span>,
                <span key={`${a._id}i`} className="font-mono text-[10.5px] text-ink3">{a.ipAddress ?? "—"}</span>,
                a.status === "SUCCESS"
                  ? <Tag key={`${a._id}s`} kind="ok">ok</Tag>
                  : <Tag key={`${a._id}s`} kind="err">{a.status}</Tag>,
              ])} />
            {view === "all" && pagination && pagination.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink3">
                <span>Page {pagination.currentPage} of {pagination.totalPages} · {(pagination.total ?? 0).toLocaleString("en-IN")} entries</span>
                <div className="flex gap-2">
                  <Btn kind="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Btn>
                  <Btn kind="ghost" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Async>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? sel.action : "Entry"}>
        {sel && (
          <div className="grid gap-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink3">When</span><span className="font-mono">{fmtDateFull(sel.timestamp)}</span></div>
            <div className="flex justify-between"><span className="text-ink3">Who</span><B>{sel.adminEmail}</B></div>
            <div className="flex justify-between"><span className="text-ink3">Resource</span><span>{sel.resource}{sel.resourceId ? <span className="ml-1 font-mono text-[10.5px] text-ink3">{sel.resourceId}</span> : null}</span></div>
            <div className="flex justify-between"><span className="text-ink3">Outcome</span>{sel.status === "SUCCESS" ? <Tag kind="ok">ok</Tag> : <Tag kind="err">{sel.status}</Tag>}</div>
            {sel.errorMessage && <UiNote kind="crit" className="my-0">{sel.errorMessage}</UiNote>}
            <div className="flex justify-between"><span className="text-ink3">IP</span><span className="font-mono text-[11px]">{sel.ipAddress ?? "—"}</span></div>
            {sel.userAgent && <div><span className="text-ink3">Browser</span><div className="break-all text-[11px] text-ink3">{sel.userAgent}</div></div>}
            <SecH t="Details" />
            <pre className="max-h-[50vh] overflow-auto rounded-lg bg-ivory p-2.5 font-mono text-[11px] leading-relaxed">{JSON.stringify(sel.details ?? {}, null, 2)}</pre>
          </div>
        )}
      </Drawer>

      <UiNote>
        Entries are written by the server, not the browser, and are kept for 90 days before they age out. A failed
        or denied action is recorded too — that is often the more interesting row.
      </UiNote>
    </Page>
  );
}