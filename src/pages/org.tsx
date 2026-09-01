import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Page, Btn, Tag, Stats, Card, DataTable, B, Note, Hint, In, Sel, Menu, Modal, SecH, Tabs,
  AreaChart, HBars, GBars, ChartCard, Stars, Drawer, Area, Switch, DeleteModal,
  Async, Empty, StaleBanner, exportCsv,
} from "../ui";
import { useStore, ROLE_LABEL } from "../store";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useQueryNumber, useQueryPage, useQueryString } from "../lib/useListState";
import {
  fmtCompactINR, fmtDate, fmtDateFull, fmtINR, fmtWhen, initials, isoDay, mapToRows, nameOf, pct,
} from "../lib/format";
import type { Admin, AdminRole, AuditEntry, Branch, ConsultationReview, PermissionGroup, PermissionKey, ProductReview, Role, ServiceReview } from "../lib/types";
import { SESSION_SLOT_MINUTES } from "../lib/scheduling";
import { RolesManager, StaffAccessFields, RoleChip, useCatalog } from "./access";

/* ================= BRANCHES ================= */
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const DAY_LABEL: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const dayKeyOf = (iso: string) => DAYS[(new Date(`${iso}T00:00:00+05:30`).getUTCDay() + 6) % 7]; // Monday-first

/** Today's status for a centre — closure first, then the weekly hours. */
function branchToday(b: Branch, iso = isoDay()) {
  const closure = (b.closures ?? []).find((c) => c.date <= iso && (c.to ? c.to >= iso : c.date === iso));
  if (!b.isActive) return { open: false, label: "Inactive", reason: "Centre inactive" };
  if (closure) return { open: false, label: "Closed today", reason: closure.reason || "Closed" };
  const h = (b.operatingHours ?? {})[dayKeyOf(iso)] ?? {};
  if (h.isOpen === false) return { open: false, label: "Closed today", reason: "Weekly off" };
  return { open: true, label: `Open ${h.openTime ?? h.open ?? "10:00"}–${h.closeTime ?? h.close ?? "19:00"}`, reason: "" };
}

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

  return (
    <Page title="Branches" sub={`${list.length} centre${list.length === 1 ? "" : "s"} · dermatologists, bookings, chat and the app's centre picker all follow this list`}
      actions={<>
        <Btn kind="ghost" disabled={!list.length} onClick={() => exportCsv("zennara-branches",
          ["Name", "Address", "Phone", "Email", "Today", "Active"],
          list.map((b) => [b.name, addressLine(b), (b.contact?.phone ?? []).join(" / "), b.contact?.email ?? "", branchToday(b).label, b.isActive ? "yes" : "no"]))}>Export CSV</Btn>
        <Btn onClick={() => setAddOpen(true)}>+ Branch</Btn>
      </>}>
      <Hint id="branches-live">Each centre's weekly hours and closures decide when dermatologists can be booked there — slots outside the centre's hours never appear in the app. Use “Close today” for a holiday or an unexpected shutdown.</Hint>
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Loading centres…" rows={4}>
        {() => list.length === 0 ? (
          <Empty title="No centres yet"
            hint="A branch is the unit everything routes by — dermatologists, bookings, chat and stock. Add the first one."
            action={<Btn onClick={() => setAddOpen(true)}>+ Branch</Btn>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((b) => {
              const today = branchToday(b);
              const upcoming = (b.closures ?? []).filter((c) => (c.to ?? c.date) >= isoDay()).sort((x, y) => x.date.localeCompare(y.date));
              return (
                <Card key={b._id} className={`overflow-hidden ${b.isActive ? "" : "opacity-60"}`}>
                  {b.images?.[0] ? <img src={b.images[0]} alt="" className="h-28 w-full object-cover" /> : <div className="h-3 bg-gradient-to-r from-primary to-gold" />}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <b className="block text-[15px] font-extrabold leading-tight">{b.name}</b>
                        <div className="mt-0.5 text-[11.5px] text-ink3">{addressLine(b)}</div>
                      </div>
                      <Tag kind={!b.isActive ? "mute" : today.open ? "ok" : "err"}>{today.label}</Tag>
                    </div>
                    {!today.open && today.reason && <div className="mt-1 text-[11.5px] text-err">{today.reason}</div>}
                    <div className="mt-3 grid grid-cols-7 gap-1">
                      {DAYS.map((d) => {
                        const h = (b.operatingHours ?? {})[d] ?? {};
                        const off = h.isOpen === false;
                        return (
                          <div key={d} className={`rounded-md px-1 py-1 text-center ${off ? "bg-ivory text-ink3" : "bg-sage text-primary"}`} title={off ? "Closed" : `${h.openTime ?? h.open ?? "10:00"}–${h.closeTime ?? h.close ?? "19:00"}`}>
                            <div className="text-[9.5px] font-bold uppercase">{DAY_LABEL[d]}</div>
                            <div className="text-[9px]">{off ? "—" : (h.openTime ?? h.open ?? "10:00").slice(0, 5)}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink3">
                      <span>{doctorCount(b)} dermatologist{doctorCount(b) === 1 ? "" : "s"}</span>
                      <span>{(b.contact?.phone ?? []).join(" / ") || "no phone"}</span>
                      {upcoming.length > 0 && <span className="text-warn">{upcoming.length} closure{upcoming.length === 1 ? "" : "s"} ahead</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                      <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setView(b)}>View details</Btn>
                      <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setSel(b)}>Edit</Btn>
                      {b.isActive && (today.open || today.reason === "Weekly off"
                        ? <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px] !text-err" onClick={() => { setCloseFor(b); setCloseDate(isoDay()); setCloseTo(""); setCloseReason(""); }}>Close today</Btn>
                        : <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px] !text-ok" onClick={() => saveClosures(b, (b.closures ?? []).filter((c) => !(c.date <= isoDay() && (c.to ? c.to >= isoDay() : c.date === isoDay()))), "Reopened today")}>Reopen today</Btn>)}
                      <Menu align="right" button={<button className="ml-auto px-1 text-ink3">⋯</button>} items={[
                        { label: b.isActive ? "Deactivate centre" : "Activate centre", onClick: async () => { try { await api.branches.toggle(b._id); audit("BRANCH_UPDATED", `${b.name} ${b.isActive ? "deactivated" : "activated"}`, { branchId: b._id }); toast(`${b.name} ${b.isActive ? "deactivated" : "activated"}`); q.reload(); reloadBranches(); } catch (e) { toast((e as Error).message); } } },
                        { label: <span className="text-err">Delete</span>, onClick: () => setDel(b) },
                      ]} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Async>

      {/* ---- detail modal ---- */}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.name ?? ""} wide>
        {view && (() => {
          const today = branchToday(view);
          const closures = [...(view.closures ?? [])].sort((x, y) => y.date.localeCompare(x.date));
          return (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Tag kind={!view.isActive ? "mute" : today.open ? "ok" : "err"}>{today.label}</Tag>{!today.open && today.reason && <span className="text-[12px] text-err">{today.reason}</span>}</div>
                <SecH t="Weekly hours" />
                <div className="grid gap-1">
                  {DAYS.map((d) => { const h = (view.operatingHours ?? {})[d] ?? {}; const off = h.isOpen === false; return (
                    <div key={d} className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[12.5px] ${d === dayKeyOf(isoDay()) ? "bg-gold/10" : "bg-ivory"}`}>
                      <span className="font-semibold">{DAY_LABEL[d]}</span>
                      <span className={off ? "text-ink3" : ""}>{off ? "Closed" : `${h.openTime ?? h.open ?? "10:00"} – ${h.closeTime ?? h.close ?? "19:00"}`}</span>
                    </div>); })}
                </div>
                <SecH t="Closures & holidays" em={`· ${closures.length}`} right={<Btn kind="ghost" className="!py-1 !text-[12px]" onClick={() => { setCloseFor(view); setCloseDate(isoDay()); setCloseTo(""); setCloseReason(""); }}>+ Add closure</Btn>} />
                {closures.length === 0 ? <div className="text-[12px] text-ink3">No closures recorded.</div> : closures.map((c, i) => (
                  <div key={`${c.date}-${i}`} className="flex items-center justify-between border-b border-border py-1.5 text-[12.5px] last:border-0">
                    <span><B>{fmtDateFull(c.date)}</B>{c.to ? ` → ${fmtDateFull(c.to)}` : ""}{c.reason ? <span className="text-ink3"> · {c.reason}</span> : ""}{(c.to ?? c.date) < isoDay() && <Tag kind="mute">past</Tag>}</span>
                    <button onClick={() => saveClosures(view, (view.closures ?? []).filter((x) => !(x.date === c.date && (x.to ?? null) === (c.to ?? null) && (x.reason ?? "") === (c.reason ?? ""))), "Closure removed")} className="text-[11.5px] text-ink3 hover:text-err">Remove</button>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 text-[12.5px]">
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Address</div><div>{addressLine(view)}</div></div>
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Phone</div><div>{(view.contact?.phone ?? []).join(" / ") || "—"}</div></div>
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Email</div><div>{view.contact?.email || "—"}</div></div>
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Dermatologists here</div><div>{(docs.data?.data ?? []).filter((d) => (d.availableCentres ?? []).includes(view.name)).map((d) => d.name).join(", ") || "—"}</div></div>
                {!!view.amenities?.length && <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Amenities</div><div>{view.amenities.join(", ")}</div></div>}
                {view.location?.coordinates?.length === 2 && <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink3">Map</div><a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${view.location.coordinates[1]},${view.location.coordinates[0]}`}>Open in Google Maps</a></div>}
                {!!view.images?.length && <div className="grid grid-cols-2 gap-1">{view.images.slice(0, 4).map((u) => <img key={u} src={u} alt="" className="h-16 w-full rounded-md object-cover" />)}</div>}
                <div className="mt-2 flex flex-col gap-2">
                  <Btn onClick={() => { setSel(view); setView(null); }}>Edit centre</Btn>
                  <Btn kind="ghost" onClick={() => setView(null)}>Close</Btn>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ---- close today / add closure ---- */}
      <Modal open={!!closeFor} onClose={() => setCloseFor(null)} title={closeFor ? `Close ${closeFor.name}` : ""}>
        <Note>No appointments can be booked at this centre for the closed day(s); existing bookings stay as they are — call those guests.</Note>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <In label="From" type="date" value={closeDate} onChange={setCloseDate} />
          <In label="To (optional)" type="date" value={closeTo} onChange={setCloseTo} hint="Leave empty for a single day" />
          <In label="Reason" value={closeReason} onChange={setCloseReason} placeholder="e.g. Public holiday, maintenance" full />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setCloseFor(null)}>Cancel</Btn>
          <Btn kind="danger" disabled={!closeDate} onClick={async () => {
            if (!closeFor) return;
            await saveClosures(closeFor, [...(closeFor.closures ?? []), { date: closeDate, to: closeTo || null, reason: closeReason.trim() }], closeTo ? `Closed ${closeDate} → ${closeTo}` : closeDate === isoDay() ? "Closed today" : `Closed on ${closeDate}`);
            setCloseFor(null);
          }}>Close centre</Btn>
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

      <Note>
        Deleting a branch <B>deactivates</B> it rather than erasing it, because bookings, chats and stock still point
        at it. An inactive centre disappears from the app's picker and from the branch switcher here.
        {can("branches.manage") ? (
          <label className="mt-2 flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} className="h-4 w-4" />
            Super admin: erase permanently on the next delete (cannot be undone; history keeps the name only)
          </label>
        ) : " Permanent deletion is a super-admin action."}
      </Note>
    </Page>
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
    <Drawer open={open} onClose={onClose} title={branch ? branch.name : "New branch"}>
      <div className="grid gap-3">
        <In label="Branch name" value={f.name ?? ""} onChange={set("name")} placeholder="e.g. Gachibowli" />
        <In label="Description (optional)" value={f.description ?? ""} onChange={set("description")} />

        <SecH t="Centre image" />
        {image && (
          <img src={image} alt="" className="h-36 w-full rounded-xl border border-border object-cover" />
        )}
        <In label="Image URL" value={image} onChange={setImage} placeholder="https://…"
          hint="Shown beside the centre in the app's centre picker" />
        <label className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-sage px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary hover:text-white ${uploadingImg ? "opacity-60" : ""}`}>
          <input type="file" accept="image/*" className="hidden" onChange={onPickImage} disabled={uploadingImg} />
          {uploadingImg ? "Uploading…" : image ? "Replace image" : "Upload an image"}
        </label>

        <SecH t="Address" />
        <In label="Address line 1 *" value={addr.line1 ?? ""} onChange={setAddr("line1")} />
        <In label="Address line 2" value={addr.line2 ?? ""} onChange={setAddr("line2")} />
        <div className="grid grid-cols-3 gap-3">
          <In label="City" value={addr.city ?? ""} onChange={setAddr("city")} />
          <In label="State" value={addr.state ?? ""} onChange={setAddr("state")} />
          <In label="Pincode *" value={addr.pincode ?? ""} onChange={setAddr("pincode")} />
        </div>

        <SecH t="Contact" />
        <div className="grid gap-2">
          {phones.map((ph, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1"><In label={i === 0 ? "Phone *" : `Phone ${i + 1}`} value={ph} onChange={(v) => setPhones(phones.map((x, j) => (j === i ? v : x)))} placeholder="+91 …" /></div>
              {phones.length > 1 && <Btn kind="ghost" onClick={() => setPhones(phones.filter((_, j) => j !== i))}>×</Btn>}
            </div>
          ))}
          <Btn kind="ghost" className="w-fit !py-1 !text-[12px]" onClick={() => setPhones([...phones, ""])}>+ Another line</Btn>
          <In label="Email *" type="email" value={contact.email ?? ""} onChange={setContact("email")} />
        </div>

        <SecH t="Map location" />
        <div className="grid grid-cols-2 gap-3">
          <In label="Latitude" type="number" value={String(coords[1] ?? 0)} onChange={setCoord(1)} hint="e.g. 17.4326" />
          <In label="Longitude" type="number" value={String(coords[0] ?? 0)} onChange={setCoord(0)} hint="e.g. 78.4071" />
        </div>
        <div className="-mt-1 text-[10.5px] text-ink3">Used by the app for directions and the nearest-centre order. Paste from Google Maps (right-click the pin → copy coordinates).</div>

        <SecH t="Booking" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-ink3">Session length</span>
            <div className="rounded-lg border border-border bg-ivory px-3 py-2 text-[12px] font-semibold text-primary">
              {SESSION_SLOT_MINUTES} minutes
            </div>
            <p className="mt-1 text-[10.5px] text-ink3">Fixed for consultations and treatments</p>
          </div>
          <In label="Display order" type="number" value={String(f.displayOrder ?? 0)}
            onChange={(v) => set("displayOrder")(Number(v) || 0)} />
        </div>

        <SecH t="Opening hours" />
        <div className="grid gap-1.5">
          {DAYS.map((day) => {
            const h = hours[day] ?? {};
            return (
              <div key={day} className="flex items-center gap-2 rounded-lg border border-border bg-ivory px-2.5 py-1.5">
                <span className="w-20 shrink-0 text-[11.5px] font-semibold capitalize">{day.slice(0, 3)}</span>
                <input type="time" value={h.open ?? "10:00"} onChange={(e) => setHours(day, { open: e.target.value })}
                  disabled={h.isOpen === false}
                  className="w-24 rounded border border-border bg-surface px-1.5 py-1 text-[11.5px] outline-none disabled:opacity-40" />
                <span className="text-[11px] text-ink3">to</span>
                <input type="time" value={h.close ?? "19:00"} onChange={(e) => setHours(day, { close: e.target.value })}
                  disabled={h.isOpen === false}
                  className="w-24 rounded border border-border bg-surface px-1.5 py-1 text-[11.5px] outline-none disabled:opacity-40" />
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink3">
                  <input type="checkbox" checked={h.isOpen !== false} onChange={(e) => setHours(day, { isOpen: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                  open
                </label>
              </div>
            );
          })}
        </div>

        <Switch on={!!f.isActive} onChange={set("isActive")} label="Centre active"
          sub="Inactive removes it from the app picker, the branch switcher and new bookings" />

        {err && <Note kind="crit">{err}</Note>}
        <div className="flex flex-wrap gap-2">
          <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : branch ? "Save branch" : "Create branch"}</Btn>
          {branch && <Btn kind="danger" onClick={() => onDelete(branch)}>Deactivate</Btn>}
        </div>
      </div>
    </Drawer>
  );
}

/* ================= REVIEWS ================= */
type ReviewKind = "products" | "consultations" | "services";

export function Reviews() {
  const { toast, audit } = useStore();
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
        <Menu button={<Btn kind="ghost">{pending ? "Awaiting approval" : "All reviews"} ▾</Btn>}
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
        { k: "5★", v: rows.filter((r) => r.rating === 5).length, tone: "up" },
        { k: "≤2★", v: lowScores.length, tone: lowScores.length ? "dn" : undefined },
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
              <Note kind="crit" className="my-0">
                A low score usually needs a call, not a reply. Open the guest's record and have the branch manager
                reach out before anything is published.
              </Note>
            )}

            {selected.isApproved
              ? <Btn kind="ghost" onClick={() => approve(selected._id, false)}>Hide from the app</Btn>
              : <Btn onClick={() => approve(selected._id, true)}>Publish to the app</Btn>}
            <Btn kind="danger" onClick={() => remove(selected._id)}>Delete review</Btn>
          </div>
        )}
      </Drawer>

      <Note>
        Approving publishes a review to the app and feeds the service or product's star rating. Hiding keeps it on
        record without showing it — nothing is silently edited.
      </Note>
    </Page>
  );
}

/* ================= ANALYTICS ================= */
const ANALYTICS_RANGES: Record<string, number> = { "7 days": 7, "30 days": 30, "90 days": 90, "6 months": 182, "This year": 365 };
const ANALYTICS_TABS: [string, (number | string)?][] = [["Revenue"], ["Appointments"], ["Dermatologists"], ["Services"], ["Patients"], ["Products & orders"], ["Packages & memberships"], ["Stock"]];

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
  for (let i = 0; i < rows.length; i += size) out.push(new Date(rows[i].date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  return out;
}

export function Analytics() {
  const { branches } = useStore();
  const [range, setRange] = useQueryString("range", "90 days");
  const [custom, setCustom] = useState<{ startDate: string; endDate: string } | null>(null);
  const [branchId, setBranchId] = useQueryString("branch", "");
  const [tab, setTab] = useQueryNumber("tab", 0, { min: 0, max: ANALYTICS_TABS.length - 1 });

  const window = useMemo(() => {
    if (custom) return custom;
    const end = new Date(); const start = new Date();
    if (range === "This year") start.setMonth(0, 1);
    else start.setDate(end.getDate() - (ANALYTICS_RANGES[range] ?? 90) + 1);
    return { startDate: isoDay(start), endDate: isoDay(end) };
  }, [range, custom]);
  const scope = { ...window, branchId: branchId || undefined };

  const q = useApi(async () => {
    const [dash, financial, appointments, patients, services, inventory, monthly, acquisition, demographics, sources, top, orders, products, pkgStats] =
      await Promise.all([
        api.analytics.dashboard(scope).catch((e) => { throw new Error(`Dashboard: ${(e as Error).message}`); }),
        api.analytics.financial(scope).catch(() => undefined),
        api.analytics.appointments(scope).catch((e) => { throw new Error(`Appointments: ${(e as Error).message}`); }),
        api.analytics.patients({ ...scope, days: ANALYTICS_RANGES[range] ?? 90 }).catch(() => undefined),
        api.analytics.services(scope).catch(() => undefined),
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
  const label = custom ? `${custom.startDate} → ${custom.endDate}` : range;

  return (
    <Page title="Analytics" sub={`${branchName} · ${label}`}
      actions={<>
        <Menu button={<Btn kind="ghost">{custom ? "Custom" : range} ▾</Btn>}
          items={[...Object.keys(ANALYTICS_RANGES).map((r) => ({ label: r, onClick: () => { setCustom(null); setRange(r); } })), { label: "Custom…", onClick: () => setCustom(window) }]} />
        {custom && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={custom.startDate} max={custom.endDate} onChange={(e) => setCustom({ ...custom, startDate: e.target.value })} className="rounded-lg border border-border bg-ivory px-2 py-1.5 text-[12px]" />
            <span className="text-ink3">→</span>
            <input type="date" value={custom.endDate} min={custom.startDate} onChange={(e) => setCustom({ ...custom, endDate: e.target.value })} className="rounded-lg border border-border bg-ivory px-2 py-1.5 text-[12px]" />
          </div>
        )}
        <Menu button={<Btn kind="ghost">{branchName} ▾</Btn>}
          items={[{ label: "All centres", onClick: () => setBranchId("") }, ...branches.map((b) => ({ label: b.name, onClick: () => setBranchId(b._id) }))]} />
        <Btn kind="ghost" disabled={!q.data} onClick={() => {
          if (!q.data) return;
          const d = q.data.dash, a = q.data.appointments.overview;
          exportCsv("zennara-analytics", ["Metric", "Value"], [
            ["Range", label], ["Centre", branchName], ["Total revenue", d.revenue.total], ["Previous period", d.revenue.previous],
            ...d.revenue.streams.map((s) => [`${s.label} revenue`, s.revenue] as [string, number]),
            ...d.revenue.streams.map((s) => [`${s.label} count`, s.count] as [string, number]),
            ["Bookings", a.totalBookings], ["Completed", a.completedBookings], ["Cancellation rate %", a.cancellationRate], ["No-show rate %", a.noShowRate],
            ["New patients", d.counts.newPatients], ["Active Zen members", d.counts.activeZen], ["Orders", d.counts.orders], ["Packages assigned", d.counts.packagesAssigned],
            ...d.dermatologists.map((x) => [`${x.name}`, `${x.bookings} bookings · ${x.completed} completed · ₹${x.revenue}`] as [string, string]),
            ...d.topServices.map((x) => [`Service: ${x.name}`, `${x.bookings} · ₹${x.revenue}`] as [string, string]),
          ]);
        }}>Export CSV</Btn>
      </>}>
      <Tabs active={tab} onChange={setTab} items={ANALYTICS_TABS} />
      <StaleBanner error={q.data ? q.error : null} onRetry={q.reload} />
      <Async q={q} label="Crunching the numbers…" rows={8}>
        {({ dash: d, financial, appointments, patients, services, inventory, monthly, acquisition, demographics, sources, top, orders, products, pkgStats }) => {
          const a = appointments.overview;
          const growth = d.revenue.growthPercent;
          const dailyLabels = d.daily.map((x) => new Date(x.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
          const streams = d.revenue.streams;
          const consultTrend = bucketSeries(d.daily, 10, (x) => x.consultations);
          const treatTrend = bucketSeries(d.daily, 10, (x) => x.treatments);
          const bookingsTrend = bucketSeries(d.daily, 10, (x) => x.bookings);
          const bl = bucketLabels(d.daily, 10);
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
                    <ChartCard title="Monthly revenue" sub="Last 12 months, all centres in scope">
                      {monthly.length > 1 ? <AreaChart pts={monthly.map((m) => Number((m as { totalRevenue?: number; revenue?: number }).totalRevenue ?? m.revenue) || 0)} labels={monthly.map((m) => String(m.month))} label="Monthly" format={fmtCompactINR} /> : <Empty title="Not enough history yet" />}
                    </ChartCard>
                    <ChartCard title="Revenue by centre" sub="Bookings — orders have no centre">
                      {d.revenueByCentre.length ? <HBars color="var(--color-c2)" rows={d.revenueByCentre.map((r) => [r.centre, r.revenue, `${r.bookings} bookings · ${fmtCompactINR(r.revenue)}`] as [string, number, string])} /> : <Empty title="No bookings" />}
                    </ChartCard>
                    <ChartCard title="Payment mix" sub="How the money came in">
                      {d.paymentMix.length ? <HBars color="var(--color-c3)" rows={d.paymentMix.map((p) => [p.method, p.amount, fmtCompactINR(p.amount)] as [string, number, string])} /> : <Empty title="No payments" />}
                      <div className="mt-3 grid gap-1.5 text-[12px]">
                        <Row k="Outstanding (bookings + packages)" v={fmtINR(d.counts.outstanding)} />
                        <Row k="Average ticket" v={fmtINR(d.counts.averageTicket)} />
                        {financial && <Row k="Refunded" v={fmtINR(financial.overview.refundsLost)} />}
                      </div>
                    </ChartCard>
                  </div>
                </>
              )}

              {tab === 1 && (
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
                        <Row k="Per day" v={String(appointments.averages?.perDay ?? 0)} />
                        <Row k="Per week" v={String(appointments.averages?.perWeek ?? 0)} />
                        <Row k="Per month" v={String(appointments.averages?.perMonth ?? 0)} />
                        <Row k="Upcoming this week" v={String(appointments.upcomingThisWeek ?? 0)} />
                        <Row k="Awaiting confirmation" v={String(d.counts.awaitingConfirmation)} />
                        <Row k="Avg days between visits" v={String(appointments.avgTimeBetweenBookings ?? 0)} />
                      </div>
                    </Card>
                    {!!(appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService?.length && (
                      <ChartCard title="No-shows by service">
                        <HBars color="var(--color-err)" rows={((appointments as { noShowByService?: { service: string; count: number }[] }).noShowByService ?? []).slice(0, 8).map((x) => [x.service, x.count] as [string, number])} />
                      </ChartCard>
                    )}
                  </div>
                </>
              )}

              {tab === 2 && (
                <>
                  <Stats items={[
                    { k: "Dermatologists", v: d.dermatologists.filter((x) => x.bookings > 0).length, d: `${d.dermatologists.length} on the roster`, hot: true },
                    { k: "Top earner", v: d.dermatologists[0]?.revenue ? d.dermatologists[0].name.split(" ")[0] : "—", d: d.dermatologists[0] ? fmtCompactINR(d.dermatologists[0].revenue) : "" },
                    { k: "Busiest", v: [...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.name.split(" ")[0] ?? "—", d: `${[...d.dermatologists].sort((x, y) => y.bookings - x.bookings)[0]?.bookings ?? 0} bookings` },
                    { k: "Best completion", v: `${Math.max(0, ...d.dermatologists.filter((x) => x.bookings >= 3).map((x) => x.completionRate))}%`, d: "min 3 bookings" },
                    { k: "Avg rating", v: (() => { const r = d.dermatologists.filter((x) => x.avgRating); return r.length ? `★ ${(r.reduce((n, x) => n + (x.avgRating ?? 0), 0) / r.length).toFixed(1)}` : "—"; })(), d: "across rated visits" },
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
                    <DataTable cols={["Dermatologist", "Level", "Bookings", "Consults", "Treatments", "Completed", "No-show", "Patients", "Rating", "Revenue", "Per booking"]}
                      rows={d.dermatologists.map((x, i) => [
                        <span key={x.doctorId} className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${i === 0 && x.revenue > 0 ? "bg-gold text-primary" : "bg-sage text-ink2"}`}>{i + 1}</span><B>{x.name}</B>{!x.onboarded && <Tag kind="info">Zenoti</Tag>}</span>,
                        <Tag key={`${x.doctorId}l`} kind={!x.onboarded ? "info" : x.level === "Senior Dermatologist" ? "gold" : "mute"}>{x.level}</Tag>,
                        x.bookings, x.consultations, x.treatments, `${x.completed} (${x.completionRate}%)`, x.noShow, x.patients, x.avgRating ? `★ ${x.avgRating}` : "—", <B key={`${x.doctorId}r`}>{fmtINR(x.revenue)}</B>, fmtINR(x.bookings ? Math.round(x.revenue / x.bookings) : 0),
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
                    { k: "Patients on file", v: d.counts.totalPatients.toLocaleString("en-IN"), hot: true, d: `${d.counts.newPatients} new in period` },
                    { k: "New patients", v: d.counts.newPatients, d: patients ? `${pct(patients.overview.newPatientRatio)} of bookers` : "" },
                    { k: "Retention", v: patients ? pct(patients.overview.retentionRate) : "—", d: patients ? `${patients.overview.returningPatients} returning` : "" },
                    { k: "Zen members", v: d.counts.activeZen, d: `${d.counts.zenExpiring} expiring in 30d`, tone: d.counts.zenExpiring ? "dn" : undefined },
                    { k: "Birthdays today", v: patients?.birthdaysToday?.length ?? 0, d: "send a wish from the patient page" },
                    { k: "Inactive", v: patients?.inactivePatients?.count ?? 0, d: `no visit in ${patients?.inactivePatients?.threshold ?? 90}d` },
                  ]} />
                  <div className="grid gap-3 xl:grid-cols-2">
                    <ChartCard title="New patients per month" hero={String(d.counts.newPatients)}>
                      {acquisition.length > 1 ? <AreaChart pts={acquisition.map((m) => Number(m.count) || 0)} labels={acquisition.map((m) => String(m.month))} label="New patients" /> : <Empty title="Not enough history yet" />}
                    </ChartCard>
                    <ChartCard title="By home centre" sub="Registered patients">
                      {sources.length ? <HBars color="var(--color-c2)" rows={sources.map((x) => [x.source || "Unknown", x.count, `${x.count} · ${pct(x.percentage)}`] as [string, number, string])} /> : <Empty title="No data" />}
                    </ChartCard>
                    {demographics && (
                      <>
                        <ChartCard title="Age groups" sub="Registered patients"><HBars rows={(demographics.ageGroups ?? []).map((g) => [(g as { range?: string; group?: string }).range ?? (g as { group?: string }).group ?? "—", g.count] as [string, number])} /></ChartCard>
                        <ChartCard title="Gender" sub="Registered patients"><HBars color="var(--color-c3)" rows={Object.entries(demographics.gender ?? {}).filter(([k]) => k !== "total").map(([k, v]) => [k, Number(v)] as [string, number])} /></ChartCard>
                      </>
                    )}
                    <Card className="p-4 xl:col-span-2">
                      <SecH t="Top patients by spend" em={`· ${label}`} />
                      {top.length === 0 ? <Empty title="No spend recorded" /> : <DataTable cols={["Patient", "Spend", "Visits"]} rows={top.map((t) => [<B key={t._id}>{t.fullName}</B>, fmtINR(t.totalSpent), t.visits ?? "—"])} />}
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
                          <Row k="New" v={String(orders.newOrders)} /><Row k="Confirmed" v={String(orders.confirmedOrders)} /><Row k="Processing" v={String(orders.processingOrders)} /><Row k="Shipped" v={String(orders.shippedOrders)} /><Row k="Delivered" v={String(orders.deliveredOrders)} /><Row k="Cancelled" v={String(orders.cancelledOrders)} />
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
                          <Row k="Active" v={String(patients.membershipStatus.active)} /><Row k="Expired" v={String(patients.membershipStatus.expired)} /><Row k="Pending" v={String(patients.membershipStatus.pending)} />
                        </div>
                      </Card>
                    )}
                  </div>
                </>
              )}

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
        }}
      </Async>
    </Page>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
    <span className="text-ink3">{k}</span><b className="font-semibold tabular-nums">{v}</b>
  </div>
);

/* ================= STAFF & ROLES ================= */
type StaffRow = Admin & { canSignIn?: boolean; isVerified?: boolean };

export function Roles() {
  const { can } = useStore();
  const canViewStaff = can("staff.view");
  const canViewRoles = can("roles.view");
  // Land on whichever tab the account can actually see.
  const [tab, setTab] = useState(canViewStaff ? 0 : 1);

  const rolesQ = useApi(() => (canViewRoles || canViewStaff ? api.roles.list() : Promise.resolve([] as Role[])), []);
  const roleCount = rolesQ.data?.length;

  const tabs: [string, (number | string)?][] = [];
  if (canViewStaff) tabs.push(["Staff"]);
  if (canViewRoles) tabs.push(["Roles & permissions", roleCount]);
  const showTabs = tabs.length > 1;
  // Map the visible tab index to which panel to render.
  const active = showTabs ? tab : (canViewStaff ? 0 : 1);

  return (
    <Page title="Staff & roles" sub="Who signs into the panel, and exactly what each person can do">
      {showTabs && <Tabs items={tabs} active={tab} onChange={setTab} />}
      {active === 0 ? <StaffTab roles={rolesQ.data ?? []} /> : <RolesManager />}
    </Page>
  );
}

function StaffTab({ roles }: { roles: Role[] }) {
  const { toast, audit, canManageStaff, admin } = useStore();
  const [invOpen, setInvOpen] = useState(false);
  const [sel, setSel] = useState<StaffRow | null>(null);
  const [del, setDel] = useState<StaffRow | null>(null);
  const [pwFor, setPwFor] = useState<StaffRow | null>(null);
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
        <Note kind="crit">You can see the team, but only someone with the “manage staff” permission can add, change or remove accounts.</Note>
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
          <DataTable cols={["Name", "Email", "Role", "Panel", "Last sign-in", "Status"]}
            onRow={(i) => setSel(rows[i])}
            rows={rows.map((s) => [
              <span key={s._id} className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-white">
                  {initials(s.name || s.email)}
                </span>
                <B>{s.name || s.email.split("@")[0]}</B>
              </span>,
              <span key={`${s._id}e`} className="text-[11.5px]">{s.email}</span>,
              s.role === "staff"
                ? (roleName(s.customRoleId) ? <RoleChip key={`${s._id}r`} role={{ name: roleName(s.customRoleId)!, color: roles.find((r) => r._id === s.customRoleId)?.color }} /> : <Tag key={`${s._id}r`} kind="warn">no role</Tag>)
                : <Tag key={`${s._id}r`} kind={s.role === "super_admin" ? "gold" : "info"}>{ROLE_LABEL[s.role]}</Tag>,
              s.role === "doctor" ? "Dermatologist panel" : s.role === "therapist" ? "Floor panel" : "Admin panel",
              s.lastLogin ? fmtWhen(s.lastLogin) : "Never",
              !s.isActive
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

            {sel.canSignIn === false && (
              <Note kind="crit" className="my-0">
                <B>{sel.email}</B> is not on the server's <code>ADMIN_EMAILS</code> allow-list, so sign-in will be
                refused. Add it to that environment variable and restart the API.
              </Note>
            )}

            {canManageStaff ? (
              <>
                <In label="Display name" value={sel.name ?? ""} onChange={(v) => setSel({ ...sel, name: v })} />
                <Sel label="Role" value={ROLE_LABEL[sel.role]}
                  onChange={(v) => {
                    const role = (Object.keys(ROLE_LABEL) as AdminRole[]).find((r) => ROLE_LABEL[r] === v);
                    if (role) setSel({ ...sel, role });
                  }}
                  options={ROLES.map((r) => ROLE_LABEL[r])} />
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

                <Btn onClick={async () => {
                  try {
                    await api.staff.update(sel._id, {
                      name: sel.name, role: sel.role,
                      doctorId: sel.role === "doctor" ? (sel.doctorId ?? null) : null,
                      ...(sel.role === "staff" ? { customRoleId: sel.customRoleId ?? null, permissions: sel.permissions ?? [] } : {}),
                    });
                    audit("SETTINGS_UPDATED", `Staff ${sel.email} → ${ROLE_LABEL[sel.role]}`, { staffId: sel._id });
                    toast("Staff account updated"); q.reload(); setSel(null);
                  } catch (e) { toast((e as Error).message); }
                }}>Save changes</Btn>

                {sel.role === "staff" && (
                  <Btn kind="ghost" onClick={() => setPwFor(sel)}>Set / reset password</Btn>
                )}

                {sel._id !== admin?._id && (
                  <>
                    <Btn kind="ghost" onClick={async () => {
                      try {
                        await api.staff.toggle(sel._id);
                        toast(sel.isActive ? "Sign-in blocked" : "Account reactivated");
                        q.reload(); setSel(null);
                      } catch (e) { toast((e as Error).message); }
                    }}>{sel.isActive ? "Deactivate login" : "Reactivate login"}</Btn>
                    <Btn kind="danger" onClick={() => { setSel(null); setDel(sel); }}>Remove staff</Btn>
                  </>
                )}
              </>
            ) : (
              <Note>Only someone with the “manage staff” permission can change staff accounts.</Note>
            )}

            <Note className="text-[11.5px]">
              Deactivating blocks the next sign-in immediately. Removing the account keeps their audit history —
              actions never disappear with the person.
            </Note>
          </div>
        )}
      </Drawer>

      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="Add staff account" wide>
        <AddStaffForm roles={roles} groups={catalog.data ?? []} onDone={() => { setInvOpen(false); q.reload(); }} />
      </Modal>

      <StaffPasswordModal staff={pwFor} onClose={() => setPwFor(null)} onSaved={() => { setPwFor(null); q.reload(); }} />

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

/** Set / reset a staff member's panel password (staff sign in with a password). */
function StaffPasswordModal({ staff, onClose, onSaved }: { staff: StaffRow | null; onClose: () => void; onSaved: () => void }) {
  const { toast, audit } = useStore();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!staff) return null;
  return (
    <Modal open onClose={onClose} title={`${staff.hasPassword ? "Reset" : "Set"} password — ${staff.name || staff.email}`}>
      <Note>They sign in at the admin panel with <B>{staff.email}</B> and this password. At least 8 characters.</Note>
      <div className="mt-3 grid gap-2.5">
        <In label="New password" type="password" value={pw} onChange={setPw} />
        <In label="Confirm" type="password" value={pw2} onChange={setPw2} />
        {err && <Note kind="crit" className="mb-0">{err}</Note>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy || pw.length < 8 || pw !== pw2} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await api.staff.setPassword(staff._id, pw);
            audit("SETTINGS_UPDATED", `${staff.email} · staff password ${staff.hasPassword ? "reset" : "set"}`, { staffId: staff._id });
            toast("Password saved"); onSaved();
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Save password"}</Btn>
      </div>
    </Modal>
  );
}

function AddStaffForm({ roles, groups, onDone }: { roles: Role[]; groups: PermissionGroup[]; onDone: () => void }) {
  const { toast, audit } = useStore();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("staff");
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [customRoleId, setCustomRoleId] = useState<string | null>(roles[0]?._id ?? null);
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set());
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doctors = useApi(() => api.doctors.list({ includeInactive: "true" }).then((r) => r.data ?? []), []);
  const doctorOptions = ["— not linked —", ...(doctors.data ?? []).map((d) => `${d.name} (${d.email || "no email"})`)];

  // 'staff' is the default — the new granular admin-panel account.
  const ROLES: AdminRole[] = ["staff", "super_admin", "doctor", "therapist"];
  const needsPassword = role === "staff";

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (needsPassword) {
        if (pw.length < 8) { setErr("Set a password of at least 8 characters"); setBusy(false); return; }
        if (pw !== pw2) { setErr("The passwords don't match"); setBusy(false); return; }
      }
      const res = await api.staff.create({
        email: email.trim().toLowerCase(), name: name.trim() || undefined, role,
        doctorId: role === "doctor" ? doctorId : null,
        ...(role === "staff" ? { customRoleId, permissions: [...perms], password: pw } : {}),
      });
      const created = res.data as Admin;
      audit("SETTINGS_UPDATED", `Created staff ${created.email} as ${ROLE_LABEL[role]}`, { staffId: created._id });
      toast(`${created.email} added as ${ROLE_LABEL[role]}`);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="grid gap-3">
        <In label="Work email" type="email" value={email} onChange={setEmail} placeholder="name@zennara.in"
          hint={needsPassword ? "Their sign-in address for the admin panel." : "A one-time code goes to this address at sign-in."} />
        <In label="Display name" value={name} onChange={setName} placeholder="Leave blank to use the email prefix" />
        <Sel label="Account type" value={ROLE_LABEL[role]}
          onChange={(v) => setRole((Object.keys(ROLE_LABEL) as AdminRole[]).find((r) => ROLE_LABEL[r] === v) ?? "staff")}
          options={ROLES.map((r) => ROLE_LABEL[r])} />

        {role === "staff" && (
          <>
            <StaffAccessFields
              roles={roles} groups={groups}
              customRoleId={customRoleId} permissions={perms}
              onRole={setCustomRoleId} onPermissions={setPerms}
            />
            <div className="grid grid-cols-2 gap-2">
              <In label="Password" type="password" value={pw} onChange={setPw} hint="At least 8 characters" />
              <In label="Confirm" type="password" value={pw2} onChange={setPw2} />
            </div>
          </>
        )}

        {role === "doctor" && (
          <Sel label="Dermatologist profile (optional)" value={doctorOptions.find((o) => o.startsWith((doctors.data ?? []).find((d) => d._id === doctorId)?.name ?? "\u0000")) ?? "— not linked —"}
            onChange={(v) => setDoctorId((doctors.data ?? []).find((d) => `${d.name} (${d.email || "no email"})` === v)?._id ?? null)}
            options={doctorOptions} />
        )}
      </div>

      {role !== "staff" && (
        <Note>
          {role === "super_admin"
            ? <>Super admins hold every permission and sign in with a one-time code — the email must be on the server's <code>ADMIN_EMAILS</code> allow-list.</>
            : <>Dermatologists and therapists sign into their own panels; set their password from the {role === "doctor" ? "Dermatologists" : "Therapists"} page.</>}
        </Note>
      )}
      {err && <Note kind="crit">{err}</Note>}
      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onDone}>Cancel</Btn>
        <Btn disabled={busy || !/^\S+@\S+\.\S+$/.test(email)} onClick={submit}>{busy ? "Adding…" : "Add staff"}</Btn>
      </div>
    </>
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
          <Menu button={<Btn kind="ghost">{action || "All actions"} ▾</Btn>}
            items={[{ label: "All actions", onClick: () => setAction("") },
              ...(f?.actions ?? []).map((a) => ({ label: a, onClick: () => setAction(a) }))]} />
          <Menu button={<Btn kind="ghost">{resource || "All resources"} ▾</Btn>}
            items={[{ label: "All resources", onClick: () => setResource("") },
              ...(f?.resources ?? []).map((r) => ({ label: r, onClick: () => setResource(r) }))]} />
          <Menu button={<Btn kind="ghost">{who || "Everyone"} ▾</Btn>}
            items={[{ label: "Everyone", onClick: () => setWho("") },
              ...(f?.admins ?? []).map((a) => ({ label: a, onClick: () => setWho(a) }))]} />
          <Menu button={<Btn kind="ghost">{status || "Any outcome"} ▾</Btn>}
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
            {sel.errorMessage && <Note kind="crit" className="my-0">{sel.errorMessage}</Note>}
            <div className="flex justify-between"><span className="text-ink3">IP</span><span className="font-mono text-[11px]">{sel.ipAddress ?? "—"}</span></div>
            {sel.userAgent && <div><span className="text-ink3">Browser</span><div className="break-all text-[11px] text-ink3">{sel.userAgent}</div></div>}
            <SecH t="Details" />
            <pre className="max-h-[50vh] overflow-auto rounded-lg bg-ivory p-2.5 font-mono text-[11px] leading-relaxed">{JSON.stringify(sel.details ?? {}, null, 2)}</pre>
          </div>
        )}
      </Drawer>

      <Note>
        Entries are written by the server, not the browser, and are kept for 90 days before they age out. A failed
        or denied action is recorded too — that is often the more interesting row.
      </Note>
    </Page>
  );
}
