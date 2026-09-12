import { useEffect, useMemo, useState } from "react";
import type { PreConsultForm, PreConsultOrigin, PreConsultSchema, PreConsultSchemaField, User } from "./lib/types";
import { fmtDate, fmtDateTime, guestCodeOf, isoDay } from "./lib/format";
import api from "./lib/api";
import { ApiError } from "./lib/http";
import { useStore } from "./store";
import { Btn, Chips, Modal, Note, Tabs, Tag } from "./ui";

/**
 * One pre-consult form, read in full.
 *
 * The panel used to show a guest's forms only as table rows — a date, the
 * words "Pre-consult form" and a status — with no way to open them. The
 * answers were readable in exactly one place, the consultation screen, and
 * only for a form attached to that appointment. A guest who filled the form on
 * the front-desk tablet has no appointment attached to it, so their answers
 * were unreachable everywhere. This is the view that fixes that; it is used
 * from the patient record and from the consultation.
 *
 * It is read-only on purpose. A form is what the guest attested to and signed;
 * the clinic's own reading of it belongs in the consultation note, not on top
 * of the patient's words.
 */

const on = (v: unknown) => v === true;

/** The chosen entries of a `{ label: boolean }` block, in the record's order. */
export function chosenLabels(block: Record<string, unknown> | undefined): string[] {
  return Object.entries(block ?? {})
    .filter(([, v]) => on(v))
    .map(([k]) => humanise(k));
}

/** `hairFallThinning` → `Hair fall thinning`; already-spaced labels pass through. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function Row({ k, v }: { k: string; v?: unknown }) {
  const text = v === null || v === undefined || v === "" ? "" : String(v);
  if (!text.trim()) return null;
  return (
    <div className="flex gap-2 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-[42%] shrink-0 text-ink3">{k}</span>
      <span className="flex-1 whitespace-pre-wrap text-ink2">{text}</span>
    </div>
  );
}

/** A block of questions, hidden entirely when the guest answered none of it. */
function Block({ t, children, empty }: { t: string; children: React.ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">{t}</div>
      {children}
    </div>
  );
}

const yesNo = (b: Record<string, unknown> | undefined, key: string) => {
  const block = b?.[key] as { used?: boolean; visited?: boolean; had?: boolean; details?: string } | undefined;
  if (!block) return null;
  const yes = on(block.used) || on(block.visited) || on(block.had);
  return `${yes ? "Yes" : "No"}${yes && block.details ? ` — ${block.details}` : ""}`;
};

/**
 * One line saying where a form came from, in the words the desk uses.
 *
 * Six thousand guests filled this form on paper before the app existed, and a
 * form keyed in from that paper is not the same thing as one the guest typed
 * on the tablet — the date on it is the paper's date, and the person who
 * attested to it is whoever entered it. So the provenance is always stated.
 */
export function originSummary(origin: PreConsultOrigin | null | undefined, form?: Pick<PreConsultForm, "createdAt" | "dateOfVisit"> | null): string | null {
  if (!origin) return null;
  const when = form?.createdAt ?? form?.dateOfVisit;
  if (origin.capturedOn === "paper") {
    const by = origin.enteredBy?.name ? ` by ${origin.enteredBy.name}` : "";
    const at = origin.enteredAt ? ` on ${fmtDate(origin.enteredAt)}` : "";
    return `Digitised from the paper form dated ${fmtDate(origin.paperDate)}${by}${at}`;
  }
  if (origin.inferred) {
    // The backend guessed the channel from older data; say so by leaving the date off.
    return origin.channel === "walkin" ? "Filled on the walk-in tablet" : "Filled in the app";
  }
  if (origin.channel === "walkin") return `Filled on the tablet on ${fmtDate(when)}`;
  if (origin.channel === "staff") {
    const by = origin.enteredBy?.name ? ` by ${origin.enteredBy.name}` : "";
    return `Entered at the desk${by} on ${fmtDate(origin.enteredAt ?? when)}`;
  }
  return `Filled in the app on ${fmtDate(when)}`;
}

function OriginBanner({ form }: { form: PreConsultForm }) {
  const line = originSummary(form.origin, form);
  if (!line) return null;
  const paper = form.origin?.capturedOn === "paper";
  return (
    <div className={`mb-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${paper ? "border-gold-dark/40 bg-cream text-gold-dark" : "border-border bg-ivory text-ink2"}`}>
      <Tag kind={paper ? "gold" : "info"}>{paper ? "From paper" : "Digital"}</Tag>
      <span>{line}</span>
      {paper && form.origin?.signatureOnPaper && <span className="text-ink3">· signed on the paper copy</span>}
      {form.origin?.inferred && <span className="text-ink3">· channel inferred</span>}
    </div>
  );
}

export function PreConsultBody({ form }: { form: PreConsultForm }) {
  const guest = typeof form.userId === "object" ? (form.userId as User) : null;
  const routine = Object.entries(form.dailyRoutine ?? {}).filter(([, v]) => v && String(v).trim());
  const medical = Object.entries(form.medicalHistory ?? {})
    // `thyroidDisorder` duplicates `thyroid`; menstrual history is its own row.
    .filter(([k, v]) => k !== "menstrualHistory" && k !== "thyroidDisorder" && on(v))
    .map(([k]) => humanise(k));
  const menstrual = String((form.medicalHistory ?? {}).menstrualHistory ?? "");
  const reasons = chosenLabels(form.reasonForVisit);
  const skin = chosenLabels(form.skinConcerns);
  const hair = chosenLabels(form.hairConcerns as Record<string, unknown>);
  const hairOther = (form.hairConcerns as Record<string, unknown> | undefined)?.others;
  const allergy = form.drugAllergies && !/^none/i.test(form.drugAllergies) ? form.drugAllergies : null;

  return (
    <div className="text-[12px] leading-relaxed">
      <OriginBanner form={form} />
      <div className="flex flex-wrap items-center gap-2">
        <Tag kind={form.status === "Approved" || form.status === "Reviewed" ? "ok" : form.status === "Rejected" ? "err" : "warn"}>{form.status}</Tag>
        <span className="text-ink3">Visit {fmtDate(form.dateOfVisit || form.createdAt)}</span>
        {guestCodeOf(guest) && <span className="font-mono text-[10.5px] text-ink3">{guestCodeOf(guest)}</span>}
      </div>

      <Block t="The guest">
        <Row k="Name" v={form.name ?? guest?.fullName} />
        <Row k="Date of birth" v={form.dateOfBirth ? fmtDate(form.dateOfBirth) : ""} />
        <Row k="Gender" v={form.gender} />
        <Row k="Phone" v={form.phoneNumber ?? guest?.phone} />
        <Row k="E-mail" v={form.email ?? guest?.email} />
        <Row k="Marital status" v={form.maritalStatus} />
        {/* 0 is the model default, not an answer — only show a real count. */}
        <Row k="Children" v={form.numberOfChildren ? form.numberOfChildren : ""} />
        <Row k="Planning pregnancy" v={form.planningForPregnancy ? "Yes" : ""} />
        <Row k="LMP" v={form.lastMenstrualPeriod ? fmtDate(form.lastMenstrualPeriod) : ""} />
        <Row k="Heard about Zennara" v={form.referralSource} />
        <Row k="Referred by" v={form.referredBy} />
      </Block>

      <Block t="Reason for visit" empty={!reasons.length && !skin.length && !hair.length && !hairOther}>
        <Row k="Here for" v={reasons.join(", ")} />
        <Row k="Skin concerns" v={skin.join(", ")} />
        <Row k="Hair concerns" v={hair.filter((h) => h !== "Others").join(", ")} />
        <Row k="Other concerns" v={hairOther} />
      </Block>

      <Block
        t="Presenting complaint"
        empty={!form.symptomDuration && !form.previousTreatments && !form.currentMedications && !form.patientNotes
          && (!form.pregnancyStatus || form.pregnancyStatus === "not_applicable")}
      >
        <Row k="Going on for" v={form.symptomDuration} />
        <Row k="Already tried" v={form.previousTreatments} />
        <Row k="Currently taking" v={form.currentMedications} />
        {form.pregnancyStatus && form.pregnancyStatus !== "not_applicable" && (
          <div className="flex gap-2 border-b border-border/60 py-1.5">
            <span className="w-[42%] shrink-0 text-ink3">Pregnancy</span>
            {/* Load-bearing: most lasers and peels and several drugs are
                contraindicated in pregnancy, so it reads as a warning. */}
            <span className="flex-1 font-semibold text-err">{humanise(form.pregnancyStatus)}</span>
          </div>
        )}
        <Row k="Anything else" v={form.patientNotes} />
      </Block>

      <Block t="Allergies & medical history" empty={!allergy && !form.otherAllergies && !medical.length && !menstrual}>
        <div className="flex gap-2 border-b border-border/60 py-1.5">
          <span className="w-[42%] shrink-0 text-ink3">Drug allergies</span>
          <span className={`flex-1 ${allergy ? "font-semibold text-err" : "text-ink2"}`}>{allergy ?? "None reported"}</span>
        </div>
        <Row k="Other allergies" v={form.otherAllergies} />
        <Row k="Conditions" v={medical.join(", ")} />
        <Row k="Menstrual history" v={menstrual && menstrual !== "N/A" ? menstrual : ""} />
      </Block>

      <Block t="Daily routine" empty={!routine.length && !form.diet?.type}>
        {routine.map(([k, v]) => <Row key={k} k={humanise(k)} v={v} />)}
        <Row k="Diet" v={form.diet?.type} />
        <Row k="Water intake" v={form.diet?.waterIntakeLiters ? `${form.diet.waterIntakeLiters} litres/day` : ""} />
      </Block>

      <Block t="Recent activity" empty={!form.additionalInfo || !Object.keys(form.additionalInfo).length}>
        <Row k="New skincare this week" v={yesNo(form.additionalInfo, "newSkincareProducts")} />
        <Row k="Salon visit this week" v={yesNo(form.additionalInfo, "recentSalonVisit")} />
        <Row k="Past treatments / surgery" v={yesNo(form.additionalInfo, "pastTreatmentsSurgeries")} />
      </Block>

      {!!(form.photos ?? []).length && (
        <Block t="Photos the guest attached">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(form.photos ?? []).map((ph, i) => (
              <a key={i} href={ph.url} target="_blank" rel="noreferrer">
                <img src={ph.url} alt={ph.caption || "Guest photo"} className="h-20 w-20 rounded-lg border border-border object-cover" />
              </a>
            ))}
          </div>
        </Block>
      )}

      <Block t="Declaration">
        <Row k="Consent given" v={form.healthDataConsent?.accepted ? "Yes — health data consent (DPDPA 2023)" : "Not recorded"} />
        <Row k="Signed" v={form.clientSignature ? (form.clientSignature.split("|")[0] || "Signed") : ""} />
        <Row k="Submitted" v={form.createdAt ? fmtDateTime(form.createdAt) : ""} />
        <Row k="Dermatologist" v={form.doctorName} />
      </Block>
    </div>
  );
}

/** The same, in a modal — what the patient record and the consultation open. */
export function PreConsultModal({ form, open, onClose }: { form: PreConsultForm | null; open: boolean; onClose: () => void }) {
  if (!form) return null;
  return (
    <Modal open={open} onClose={onClose} title="Pre-consult form" wide>
      <PreConsultBody form={form} />
    </Modal>
  );
}

/* ======================= digitising a paper form ======================= */

const INPUT = "rounded-lg border px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark bg-ivory";
const border = (bad: boolean) => (bad ? "border-err" : "border-border");

/** Label + required mark + hint + error, shared by every field type below. */
function FieldShell({ f, error, children, inline }: { f: PreConsultSchemaField; error?: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${f.type === "textarea" || f.type === "multichips" || f.type === "chips" ? "col-span-full" : ""}`}>
      <label className={`text-[11px] font-bold tracking-[0.02em] text-ink2 ${inline ? "sr-only" : ""}`}>
        {f.label}{f.required && <span className="ml-0.5 text-err">*</span>}
      </label>
      {children}
      {f.hint && !error && <div className="text-[10.5px] text-ink3">{f.hint}</div>}
      {error && <div className="text-[10.5px] font-semibold text-err">{error}</div>}
    </div>
  );
}

const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

/** Enter in a single-line input must never trigger anything mid-form. */
const swallowEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") e.preventDefault(); };

function Field({ f, value, onChange, error }: { f: PreConsultSchemaField; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const bad = !!error;
  switch (f.type) {
    case "textarea":
      return (
        <FieldShell f={f} error={error}>
          <textarea rows={3} value={asText(value)} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)}
            className={`${INPUT} resize-y ${border(bad)}`} />
          {f.maxLength && asText(value).length > f.maxLength * 0.8 && <div className="text-right text-[10px] text-ink3">{asText(value).length}/{f.maxLength}</div>}
        </FieldShell>
      );
    case "select":
      return (
        <FieldShell f={f} error={error}>
          <select value={asText(value)} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${border(bad)}`}>
            <option value="">—</option>
            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FieldShell>
      );
    case "chips":
      return (
        <FieldShell f={f} error={error}>
          <Chips options={(f.options ?? []).map((o) => [o.value, o.label] as [string, string])} value={asText(value)} onChange={(v) => onChange(v)} />
        </FieldShell>
      );
    case "multichips": {
      // Chips' multi mode is a searchable dropdown — too slow for a desk
      // keying in ten concerns off a sheet, so these are tap-to-toggle pills.
      const chosen = asList(value);
      return (
        <FieldShell f={f} error={error}>
          <div className="flex flex-wrap gap-1.5">
            {(f.options ?? []).map((o) => {
              const on = chosen.includes(o.value);
              return (
                <button key={o.value} type="button" onClick={() => onChange(on ? chosen.filter((c) => c !== o.value) : [...chosen, o.value])}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${on ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink2 hover:border-gold-dark"}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </FieldShell>
      );
    }
    case "yesno":
      return (
        <FieldShell f={f} error={error}>
          <Chips options={[["yes", "Yes"], ["no", "No"]]} value={value === true ? "yes" : value === false ? "no" : ""}
            onChange={(v) => onChange(v === "yes" ? true : v === "no" ? false : null)} />
        </FieldShell>
      );
    case "boolean":
      return (
        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${border(bad)} bg-ivory`}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />
          <span className="font-semibold text-ink2">{f.label}{f.required && <span className="ml-0.5 text-err">*</span>}</span>
          {error && <span className="text-[10.5px] font-semibold text-err">{error}</span>}
        </label>
      );
    default:
      return (
        <FieldShell f={f} error={error}>
          <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
            value={asText(value)} maxLength={f.maxLength} onKeyDown={swallowEnter}
            max={f.type === "date" ? isoDay() : undefined}
            onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
            className={`${INPUT} ${border(bad)}`} />
        </FieldShell>
      );
  }
}

const visible = (f: PreConsultSchemaField, values: Record<string, unknown>) =>
  !f.showIf || values[f.showIf.key] === f.showIf.equals;

const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Key a paper pre-consult form into the record, question by question.
 *
 * The questions come from the backend (`preConsult.schema()`), so this editor
 * never drifts from what the app and the walk-in tablet ask. What it adds is
 * the paper's own date and who typed it in — both stamped on the form's
 * `origin`, so nobody later mistakes a transcription for the guest's own words.
 */
export function DigitisePreConsultModal({ userId, guestName, open, onClose, onDone, replace }: {
  userId: string; guestName: string; open: boolean; onClose: () => void; onDone: () => void;
  /** Overwrite an existing digital form (the desk confirmed a newer paper one). */
  replace?: boolean;
}) {
  const { toast } = useStore();
  const [schema, setSchema] = useState<PreConsultSchema | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [paperDate, setPaperDate] = useState(isoDay());
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);

  // A fresh sheet every time it opens — the questions are re-read too, in
  // case the backend changed them since the last one was keyed in.
  useEffect(() => {
    if (!open) return;
    setStep(0); setErrors({}); setConflict(false); setTopErr(null); setNotes(""); setPaperDate(isoDay());
    setSchema(null); setLoadErr(null);
    let live = true;
    api.preConsult.schema()
      .then((s) => { if (!live) return; setSchema(s); setValues({ ...(s.empty ?? {}) }); })
      .catch((e) => { if (live) setLoadErr((e as Error).message || "The form questions could not be loaded."); });
    return () => { live = false; };
  }, [open, userId]);

  const steps = schema?.steps ?? [];
  const current = steps[step];
  const set = (key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  };

  const errorsPerStep = useMemo(
    () => steps.map((st) => st.fields.filter((f) => errors[f.key]).length),
    [steps, errors],
  );

  /** Move to the first step that owns any of these keys (the server's or ours). */
  const jumpToFirstError = (errs: Record<string, string>) => {
    const i = steps.findIndex((st) => st.fields.some((f) => errs[f.key]));
    if (i >= 0) setStep(i);
  };

  const submit = async (force?: boolean) => {
    if (!schema) return;
    setTopErr(null);
    // Required questions are checked here first so the desk gets sent to the
    // right step without a round trip; the server checks again regardless.
    const local: Record<string, string> = {};
    for (const st of steps) for (const f of st.fields) {
      if (f.required && visible(f, values) && blank(values[f.key])) local[f.key] = "Required";
    }
    if (!paperDate) { setTopErr("Enter the date written on the paper form."); return; }
    if (paperDate > isoDay()) { setTopErr("The paper form cannot be dated in the future."); return; }
    if (Object.keys(local).length) { setErrors(local); jumpToFirstError(local); return; }

    setBusy(true);
    try {
      await api.preConsult.digitise(userId, { values, paperDate, notes: notes.trim() || undefined, replace: !!(replace || force) });
      toast("Paper form digitised — the guest, the dermatologist and Zenoti can now see it");
      onDone();
      onClose();
    } catch (e) {
      const err = e as ApiError;
      const payload = (err.payload ?? {}) as { code?: string; fieldErrors?: Record<string, string>; message?: string };
      if (err.status === 409 || payload.code === "INTAKE_ALREADY_DIGITAL") {
        setConflict(true);
      } else if (err.status === 400 && payload.fieldErrors && Object.keys(payload.fieldErrors).length) {
        setErrors(payload.fieldErrors);
        jumpToFirstError(payload.fieldErrors);
        setTopErr("Some answers need attention — see the marked fields.");
      } else {
        setTopErr(err.message || "The form could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Digitise paper form · ${guestName}`} wide>
      {replace && <Note kind="crit">This replaces {guestName}'s existing digital form. The old answers stay in the audit trail but stop being the form the dermatologist reads.</Note>}

      {/* The paper's own date and who typed it in — the two facts that make a
          transcription honest. Always on top, on every step. */}
      <div className="mb-3 grid grid-cols-1 gap-3 rounded-xl border border-border bg-ivory p-3 sm:grid-cols-[180px_1fr]">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">Paper form date<span className="ml-0.5 text-err">*</span></label>
          <input type="date" value={paperDate} max={isoDay()} onKeyDown={swallowEnter} onChange={(e) => setPaperDate(e.target.value)}
            className={`${INPUT} ${border(!paperDate)}`} />
          <div className="text-[10.5px] text-ink3">As written on the sheet.</div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">Notes</label>
          <input value={notes} maxLength={300} onKeyDown={swallowEnter} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — e.g. handwriting unclear on allergies" className={`${INPUT} border-border`} />
        </div>
      </div>

      {loadErr && <Note kind="crit">{loadErr}</Note>}
      {!schema && !loadErr && <div className="py-6 text-center text-[12.5px] text-ink3">Loading the form questions…</div>}

      {schema && (
        <>
          <Tabs active={step} onChange={setStep}
            items={steps.map((st, i) => [errorsPerStep[i] ? `${st.title} !` : st.title, `${i + 1}/${steps.length}`] as [string, string])} />
          {current && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {current.fields.filter((f) => visible(f, values)).map((f) => (
                <Field key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} error={errors[f.key]} />
              ))}
            </div>
          )}
        </>
      )}

      {topErr && <Note kind="crit">{topErr}</Note>}
      {conflict && (
        <Note kind="crit">
          <div className="font-semibold">{guestName} already has a digital form.</div>
          <div className="mt-1">Replace it with this paper form? The answers you keyed in are kept as they are.</div>
          <div className="mt-2 flex gap-2">
            <Btn kind="danger" disabled={busy} onClick={() => submit(true)}>{busy ? "Replacing…" : "Replace the existing digital form"}</Btn>
            <Btn kind="ghost" onClick={() => setConflict(false)}>Keep the existing form</Btn>
          </div>
        </Note>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[11px] text-ink3">{schema ? `Step ${step + 1} of ${steps.length}` : ""}</span>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          {step > 0 && <Btn kind="ghost" onClick={() => setStep((s) => s - 1)}>← Back</Btn>}
          {schema && step < steps.length - 1 && <Btn kind="ghost" onClick={() => setStep((s) => s + 1)}>Next →</Btn>}
          {schema && <Btn disabled={busy || conflict} onClick={() => submit()}>{busy ? "Saving…" : replace ? "Replace with this form" : "Digitise form"}</Btn>}
        </div>
      </div>
    </Modal>
  );
}
