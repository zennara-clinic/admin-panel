import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, MapPin, Search, Stethoscope, User as UserIcon } from "lucide-react";
import { B, Btn, Empty, In, Loading, Modal, Note, Sel, Tag } from "./ui";
import { useStore } from "./store";
import api from "./lib/api";
import { useApi, useDebounced } from "./lib/useApi";
import { fmtDateFull, fmtINR, isoDay } from "./lib/format";
import type { Consultation, Doctor, User } from "./lib/types";

/**
 * Booking a dermatologist consultation at the desk.
 *
 * Four questions, one at a time: who is it for, when, which dermatologist,
 * and does it stand. Asking them all at once is what made the old form hard —
 * a guest, a service, a dermatologist, a time and a price all on screen
 * before any of them had been decided, most of which do not apply to a
 * consultation at all.
 *
 * Deliberately consultations only. Selling services and packages from here is
 * its own job (a till, really) and is not pretended at: no service picker, no
 * line items, no total to collect. The visit is written down and paid for at
 * the clinic.
 *
 * Everything offered comes from Zenoti's published roster — the dates the
 * centre can take, the times inside them, and which dermatologists are
 * actually free at the time chosen.
 */

/** The desk never creates a guest; the walk-in tablet and the app do. */
const NO_GUEST_MSG = "Pick a guest from the search. New guests check in on the walk-in tablet first, then book for them here.";
/** Emails the clinic synthesises for a guest who has not given one yet. */
const PLACEHOLDER_EMAIL = /@zennara\.local$|@guest\.zennara\.in$/i;

type Tier = "senior-consultant" | "consultant-dermatologist";
const TIER_LABEL: Record<Tier, string> = {
  "senior-consultant": "Senior Dermatologist",
  "consultant-dermatologist": "Dermatologist",
};
/** The catalogue rows the fee comes from — seeded by seedConsultationTiers.js. */
const TIER_SLUG: Record<Tier, string> = {
  "senior-consultant": "senior-dermatologist-consultation",
  "consultant-dermatologist": "dermatologist-consultation",
};

const STEPS = ["Guest", "When", "Dermatologist", "Confirm"] as const;

/** "14:00" out of whatever the slot list is written in. */
const to24 = (t: string) => {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return String(t).trim();
  let h = Number(m[1]);
  const suffix = m[3]?.toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
};
const pretty = (t: string) => {
  const [h, m] = to24(t).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function NewBookingModal({ open, onClose, onBooked, presetUser, preset }: {
  open: boolean; onClose: () => void; onBooked: () => void;
  presetUser?: Pick<User, "_id" | "fullName" | "phone" | "email"> | null;
  /** From the day book: a cell's dermatologist, time and date. */
  preset?: { date?: string; doctorId?: string; doctorName?: string; time?: string } | null;
}) {
  const { toast, audit, branch, branches, clinics } = useStore();

  const [step, setStep] = useState(0);
  const [guest, setGuest] = useState<User | null>(null);
  const [lookup, setLookup] = useState("");
  const debouncedLookup = useDebounced(lookup, 250);
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(isoDay());
  const [time, setTime] = useState("");
  const [tier, setTier] = useState<Tier | null>(null);
  /** Look past the chosen centre — "anyone, anywhere" for a guest who will travel. */
  const [anyClinic, setAnyClinic] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [confirmNow, setConfirmNow] = useState(true);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const centreList = clinics.length ? clinics : branches;

  useEffect(() => {
    if (!open) return;
    setStep(presetUser?._id ? 1 : 0);
    setGuest(null); setLookup("");
    setLocation(branch && branch !== "All branches" ? branch : centreList[0]?.name ?? "");
    setDate(preset?.date ?? isoDay());
    setTime(preset?.time ? to24(preset.time) : "");
    setTier(null); setDoctorId(""); setAnyClinic(false);
    setNotes(""); setErr(null); setWarn(null); setConfirmNow(true);
    if (presetUser?._id) {
      api.patients.get(presetUser._id)
        .then((u) => setGuest(u))
        .catch(() => setGuest({ ...presetUser } as User));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetUser?._id, branch, centreList.length, preset?.date, preset?.time]);

  /* ---------------------------- step 1: the guest ------------------------ */
  const found = useApi(async () => {
    const q = debouncedLookup.trim();
    if (!open || q.length < 3) return [] as User[];
    const res = await api.patients.list({ search: q, limit: 8 }).catch(() => null);
    return (res?.data as { users?: User[] } | undefined)?.users ?? [];
  }, [debouncedLookup, open]);

  /* ---------------------------- step 2: when ----------------------------- */
  const centre = centreList.find((b) => b.name === location);

  /** The centre's bookable days, so the date field cannot reach past the roster. */
  const horizon = useApi(async () => {
    if (!open || !centre?._id) return null;
    return api.branches
      .availability(centre._id, isoDay(), isoDay(new Date(Date.now() + 60 * 86_400_000)))
      .catch(() => null);
  }, [open, centre?._id]);
  const rosteredTo = horizon.data?.rosteredTo ?? null;
  const openDays = useMemo(() => {
    const m = new Map<string, boolean>();
    (horizon.data?.days ?? []).forEach((d) => m.set(d.date, d.open));
    return m;
  }, [horizon.data]);
  const dayClosed = openDays.size > 0 && openDays.get(date) === false;

  /** Every time the team has free that day — the desk picks from these. */
  const times = useApi(async () => {
    if (!open || step < 1 || !date) return [] as string[];
    const res = await api.schedules.anySlots(date, anyClinic ? null : location).catch(() => null);
    return (res?.slots ?? []).filter((s) => s.available !== false).map((s) => to24(s.time));
  }, [open, step, date, location, anyClinic]);
  const timeList = times.data ?? [];

  /* ------------------------ step 3: the dermatologist -------------------- */
  const roster = useApi(async () => {
    if (!open) return { doctors: [] as Doctor[], tiers: [] as { id: string; title: string; fee: number }[], services: [] as Consultation[] };
    const [docs, tiers, svc] = await Promise.all([
      api.doctors.list(),
      api.doctors.tiers().catch(() => []),
      api.services.list({ isActive: "true", limit: 500 }).catch(() => ({ data: [] })),
    ]);
    return {
      doctors: (docs.data ?? []) as Doctor[],
      tiers: tiers as { id: string; title: string; fee: number }[],
      services: ((svc as { data?: Consultation[] }).data ?? []) as Consultation[],
    };
  }, [open]);

  /** Who is genuinely free at the chosen moment, straight from Zenoti. */
  const free = useApi(async () => {
    if (!open || step < 2 || !date || !time) return null;
    return api.schedules.whoIsFree(date, to24(time), anyClinic ? null : location).catch(() => null);
  }, [open, step, date, time, location, anyClinic]);

  const doctors = roster.data?.doctors ?? [];
  const freeIds = new Set(free.data?.doctorIds ?? []);
  const centreOf = (id: string) => free.data?.matches.find((m) => m.doctorId === id)?.branchName ?? null;
  /** Free at that time, in the tier chosen. */
  const candidates = doctors.filter((d) => d.isActive !== false && freeIds.has(d.doctorId) && (!tier || d.tier === tier));
  const tierCount = (t: Tier) => doctors.filter((d) => d.isActive !== false && freeIds.has(d.doctorId) && d.tier === t).length;
  const picked = doctors.find((d) => d.doctorId === doctorId) ?? null;

  /** The catalogue row this tier bills from, and what it costs. */
  const service = useMemo(() => {
    const list = roster.data?.services ?? [];
    if (!tier) return null;
    return list.find((s) => s.slug === TIER_SLUG[tier])
      ?? list.find((s) => (tier === "senior-consultant" ? /senior/i : /^(?!.*senior).*consult/i).test(s.name))
      ?? null;
  }, [roster.data?.services, tier]);
  /*
   * A service with no Zenoti line cannot be booked into Zenoti.
   *
   * syncBooking records the push as `skipped` and the desk gets a 502 having
   * already filled in four steps — while the booking sits in our database
   * only, which is exactly the ghost this wizard exists to avoid. Say it at
   * the step where the tier is chosen, and name the one place it is fixed.
   */
  const unmapped = Boolean(tier && service && !service.zenotiServiceId);

  const fee = useMemo(() => {
    if (!tier) return 0;
    const t = roster.data?.tiers.find((x) => x.id === tier);
    return t?.fee || Number(service?.price) || 0;
  }, [tier, roster.data?.tiers, service]);

  /* ------------------------------ submitting ----------------------------- */
  const submit = async (force = false) => {
    setErr(null); setWarn(null);
    if (!guest) return setErr(NO_GUEST_MSG);
    if (!service?._id) return setErr("No consultation is set up in the catalogue for that tier. Add it under Care › Services.");
    if (!picked) return setErr("Pick a dermatologist");

    setBusy(true);
    try {
      await api.bookings.create({
        consultationId: service._id,
        fullName: guest.fullName,
        mobileNumber: guest.phone || "",
        email: guest.email && !PLACEHOLDER_EMAIL.test(guest.email) ? guest.email : undefined,
        // A booking made across clinics belongs to the centre they will visit.
        preferredLocation: centreOf(picked.doctorId) ?? location,
        preferredDate: date,
        preferredTimeSlots: [to24(time)],
        specialistId: picked.doctorId,
        specialistName: picked.name,
        specialistTier: picked.tier,
        amount: fee,
        notes: notes.trim() || undefined,
        confirmNow,
        force,
        userId: guest._id,
      });
      audit("BOOKING_CREATED", `${guest.fullName} · ${TIER_LABEL[tier!]} with ${picked.name} · ${date} ${to24(time)}`);
      toast(`${guest.fullName} is booked with ${picked.name}`);
      onBooked();
      onClose();
    } catch (e) {
      const ex = e as Error & { code?: string; body?: { code?: string } };
      const code = ex.code || ex.body?.code;
      if (code === "GUEST_NOT_FOUND") { setGuest(null); setStep(0); setErr(ex.message || NO_GUEST_MSG); }
      else if (code === "PROVIDER_NOT_WORKING" || /Do you want to add the appointment/i.test(ex.message)) setWarn(ex.message);
      else setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------- the steps ----------------------------- */
  const canAdvance =
    step === 0 ? !!guest
      : step === 1 ? !!date && !!time && !dayClosed
        // An unmapped service is a booking Zenoti will never see — stop here,
        // where the fix is one sentence away, not after the summary.
        : step === 2 ? !!tier && !!picked && !unmapped
          : true;

  const next = () => { setErr(null); setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const back = () => { setErr(null); setStep((s) => Math.max(0, s - 1)); };

  return (
    <Modal open={open} onClose={onClose} title="New consultation" xl>
      {/* Where we are. Past steps are clickable so a change is one tap, not a restart. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {STEPS.map((label, i) => {
          const done = i < step;
          const here = i === step;
          return (
            <button key={label} type="button" disabled={i > step}
              onClick={() => i < step && setStep(i)}
              className={[
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors",
                here ? "bg-primary text-white" : done ? "bg-sage text-primary hover:bg-primary/15" : "bg-ivory text-ink3",
              ].join(" ")}>
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${here ? "bg-white/25" : done ? "bg-primary text-white" : "bg-border text-ink3"}`}>
                {done ? <Check size={10} strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {/* ------------------------------ 1. guest ------------------------------ */}
      {step === 0 && (
        <div className="grid gap-3">
          <Note className="my-0">Consultations only. Services and packages are sold at the till, not here.</Note>
          {guest ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-sage text-primary"><UserIcon size={16} /></span>
                <div>
                  <B>{guest.fullName}</B>
                  <div className="text-[12px] text-ink3">{guest.phone}{guest.email && !PLACEHOLDER_EMAIL.test(guest.email) ? ` · ${guest.email}` : ""}</div>
                </div>
              </div>
              {!presetUser && <Btn kind="ghost" onClick={() => { setGuest(null); setLookup(""); }}>Change</Btn>}
            </div>
          ) : (
            <>
              <In label="Find by mobile, name or email" value={lookup} onChange={setLookup} placeholder="98765 43210" />
              {lookup.trim().length >= 3 && (
                found.loading ? <Loading label="Searching…" rows={2} />
                  : (found.data ?? []).length === 0
                    ? <Empty title="Nobody on file matches that" hint={NO_GUEST_MSG} />
                    : (
                      <div className="grid gap-1.5">
                        {(found.data ?? []).map((u) => (
                          <button key={u._id} type="button" onClick={() => { setGuest(u); setLookup(""); setStep(1); }}
                            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-gold-dark hover:bg-ivory">
                            <span className="grid h-8 w-8 place-items-center rounded-full bg-ivory text-ink3"><Search size={14} /></span>
                            <div className="min-w-0">
                              <B>{u.fullName}</B>
                              <div className="truncate text-[12px] text-ink3">{u.phone}{u.location ? ` · ${u.location}` : ""}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )
              )}
              {lookup.trim().length > 0 && lookup.trim().length < 3 && (
                <div className="text-[12px] text-ink3">Keep typing — at least three characters.</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ------------------------------- 2. when ------------------------------ */}
      {step === 1 && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Centre" value={location} onChange={(v) => { setLocation(v); setTime(""); setDoctorId(""); }}
              options={centreList.map((b) => b.name)} />
            <In label="Date" type="date" value={date}
              onChange={(v) => { setDate(v); setTime(""); setDoctorId(""); }}
              min={isoDay()} max={rosteredTo ?? undefined}
              hint={rosteredTo ? `Rostered to ${fmtDateFull(rosteredTo)}` : undefined} />
          </div>

          {horizon.loading && <Loading label="Reading the centre's diary…" rows={1} />}
          {!horizon.loading && rosteredTo && date > rosteredTo && (
            <Note kind="crit" className="my-0">
              Nobody is rostered on {fmtDateFull(date)} — {location} has planned its diary up to <B>{fmtDateFull(rosteredTo)}</B>. Pick an earlier day.
            </Note>
          )}
          {!horizon.loading && dayClosed && date <= (rosteredTo ?? date) && (
            <Note kind="crit" className="my-0">No dermatologist has a free time at {location} on {fmtDateFull(date)}.</Note>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.02em] text-ink2">Time</span>
              <label className="flex items-center gap-1.5 text-[12px] text-ink3">
                <input type="checkbox" checked={anyClinic} onChange={(e) => { setAnyClinic(e.target.checked); setTime(""); setDoctorId(""); }} />
                Look at every clinic
              </label>
            </div>
            {times.loading ? <Loading label="Checking free times…" rows={2} />
              : timeList.length === 0
                ? <Empty title="No free times that day" hint={anyClinic ? "Nobody is free at any clinic. Try another date." : "Try another date, or look at every clinic."} />
                : (
                  <div className="flex flex-wrap gap-1.5">
                    {timeList.map((t) => (
                      <button key={t} type="button" onClick={() => { setTime(t); setDoctorId(""); }}
                        className={[
                          "rounded-full border px-3.5 py-2 text-[12.5px] font-bold transition-colors",
                          time === t ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink2 hover:border-gold-dark",
                        ].join(" ")}>
                        {pretty(t)}
                      </button>
                    ))}
                  </div>
                )}
          </div>
        </div>
      )}

      {/* --------------------------- 3. dermatologist -------------------------- */}
      {step === 2 && (
        <div className="grid gap-3">
          <div className="text-[12px] text-ink3">
            Free at <B>{pretty(time)}</B> on {fmtDateFull(date)}{anyClinic ? ", across every clinic" : ` at ${location}`}.
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {(Object.keys(TIER_LABEL) as Tier[]).map((t) => {
              const n = tierCount(t);
              const on = tier === t;
              return (
                <button key={t} type="button" disabled={free.loading || n === 0}
                  onClick={() => { setTier(t); setDoctorId(""); }}
                  className={[
                    "rounded-xl border px-3.5 py-3 text-left transition-colors",
                    on ? "border-primary bg-sage" : "border-border bg-surface hover:border-gold-dark",
                    n === 0 ? "opacity-40" : "",
                  ].join(" ")}>
                  <div className="flex items-center gap-2">
                    <Stethoscope size={15} className={on ? "text-primary" : "text-ink3"} />
                    <B>{TIER_LABEL[t]}</B>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink3">
                    {free.loading ? "checking…" : n === 0 ? "none free at this time" : `${n} free`}
                  </div>
                </button>
              );
            })}
          </div>

          {unmapped && (
            <Note kind="crit" className="my-0">
              <B>{service?.name}</B> has no Zenoti service mapped to it, so an appointment booked here would never reach Zenoti. Set it once under <B>Care › Services › {service?.name} › Zenoti service</B> and this will work for every booking afterwards.
            </Note>
          )}

          {free.loading ? <Loading label="Asking Zenoti who is free…" rows={3} />
            : !tier ? <div className="text-[12px] text-ink3">Choose a tier to see who is free.</div>
              : candidates.length === 0
                ? <Empty title={`No ${TIER_LABEL[tier].toLowerCase()} is free then`} hint="Try the other tier, another time, or look at every clinic." />
                : (
                  <div className="grid gap-1.5">
                    {candidates.map((d) => (
                      <button key={d.doctorId} type="button" onClick={() => setDoctorId(d.doctorId)}
                        className={[
                          "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                          doctorId === d.doctorId ? "border-primary bg-sage" : "border-border bg-surface hover:border-gold-dark",
                        ].join(" ")}>
                        <div className="min-w-0">
                          <B>{d.name}</B>
                          <div className="text-[12px] text-ink3">{TIER_LABEL[d.tier as Tier] ?? d.tier}</div>
                        </div>
                        {centreOf(d.doctorId) && centreOf(d.doctorId) !== location && (
                          <Tag kind="gold"><MapPin size={10} className="inline" /> {centreOf(d.doctorId)}</Tag>
                        )}
                      </button>
                    ))}
                  </div>
                )}
        </div>
      )}

      {/* ------------------------------ 4. confirm ----------------------------- */}
      {step === 3 && guest && picked && (
        <div className="grid gap-3">
          <div className="grid gap-2 rounded-xl border border-border bg-surface p-3.5 text-[13px]">
            <Row k="Guest" v={`${guest.fullName}${guest.phone ? ` · ${guest.phone}` : ""}`} />
            <Row k="When" v={`${fmtDateFull(date)} at ${pretty(time)}`} />
            <Row k="Dermatologist" v={`${picked.name} · ${TIER_LABEL[picked.tier as Tier] ?? picked.tier}`} />
            <Row k="Centre" v={centreOf(picked.doctorId) ?? location} />
            <Row k="Consultation fee" v={fee > 0 ? fmtINR(fee) : "not priced"} />
          </div>

          <Note className="my-0">
            <B>Payable at the clinic.</B> Nothing is charged now — the visit is recorded as due, and the desk takes payment when the guest arrives.
          </Note>

          <In label="Desk notes (optional)" value={notes} onChange={setNotes} />

          <label className="flex items-start gap-2 rounded-xl border border-border bg-ivory px-3.5 py-2.5 text-[12.5px] text-ink2">
            <input type="checkbox" className="mt-0.5" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
            <span>Confirm immediately (the guest is at the desk). Leave off to send it for confirmation.</span>
          </label>
        </div>
      )}

      {err && <Note kind="crit">{err}</Note>}
      {warn && (
        <Note kind="crit">
          {warn}
          <div className="mt-2 flex gap-2">
            <Btn kind="ghost" onClick={() => setWarn(null)}>No, go back</Btn>
            <Btn kind="gold" disabled={busy} onClick={() => submit(true)}>Yes, book it anyway</Btn>
          </div>
        </Note>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <Btn kind="ghost" onClick={step === 0 ? onClose : back}>
          {step === 0 ? "Cancel" : <><ChevronLeft size={13} className="inline" /> Back</>}
        </Btn>
        {step < STEPS.length - 1 ? (
          <Btn disabled={!canAdvance} onClick={next}>Continue</Btn>
        ) : (
          <Btn disabled={busy || !canAdvance} onClick={() => submit(false)}>
            {busy ? "Booking…" : confirmNow ? "Book & confirm" : "Send for confirmation"}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5 last:border-0 last:pb-0">
    <span className="text-[12px] text-ink3">{k}</span>
    <span className="text-right text-[13px] font-bold">{v}</span>
  </div>
);
