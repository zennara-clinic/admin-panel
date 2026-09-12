/**
 * Bulk import / export, and the consultation-form builder.
 *
 * The import flow is deliberately three steps — choose a file, read the
 * preview, then commit — because an import that writes on upload gives nobody
 * a chance to notice that the "price" column is in the wrong place.
 */
import { useMemo, useRef, useState } from "react";
import {
  Page, Btn, Tag, Card, Note, In, Sel, Area, Modal, Async, Empty, SecH, B, Toggle, DataTable, MultiSelect,
} from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { download } from "../lib/http";
import { useApi } from "../lib/useApi";
import { fmtDate, guestCodeOf } from "../lib/format";
import type { BulkPreview, BulkResult, FormTemplate, FormTemplateField, Id } from "../lib/types";

type Entity = "services" | "categories" | "products";

const ENTITY_LABEL: Record<Entity, string> = {
  services: "Services",
  categories: "Categories",
  products: "Products",
};

/* ======================= BULK IMPORT / EXPORT ======================= */


/* ============================ FORM BUILDER ============================ */

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "checkbox", "radio", "photo"] as const;

const blankField = (n: number): FormTemplateField => ({
  key: `field_${n + 1}`, label: "", type: "text", required: false, order: n, options: [],
});

export function Forms() {
  const { toast, can } = useStore();
  const [sel, setSel] = useState<FormTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [subsFor, setSubsFor] = useState<FormTemplate | null>(null);
  const [nonce, setNonce] = useState(0);

  const list = useApi(() => api.formTemplates.list().then((r) => r.data ?? []), [nonce]);
  const reload = () => setNonce((n) => n + 1);

  return (
    <Page title="Consultation forms" sub="Build the forms guests fill in, and read what they answered."
      actions={can("forms.manage") ? <Btn kind="gold" onClick={() => setCreateOpen(true)}>New form</Btn> : undefined}>
      <Async q={list} label="Loading forms…" rows={4}>
        {(forms) => forms.length === 0
          ? <Empty title="No forms yet" hint="Build one to ask guests whatever this clinic needs before a consultation." />
          : (
            <div className="grid gap-2">
              {forms.map((f) => (
                <Card key={f._id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <B>{f.name}</B>
                      {f.isActive ? <Tag kind="ok">Live</Tag> : <Tag kind="mute">Draft</Tag>}
                      {f.version > 1 && <Tag kind="info">v{f.version}</Tag>}
                    </div>
                    <div className="text-[11.5px] text-ink3">
                      {f.fields.length} question{f.fields.length === 1 ? "" : "s"} · {f.submissionCount} submission{f.submissionCount === 1 ? "" : "s"}
                      {f.description ? ` · ${f.description}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]" onClick={() => setSubsFor(f)}>Submissions</Btn>
                    <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]" onClick={() => setSel(f)}>Edit</Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}
      </Async>

      <FormEditor
        open={createOpen || !!sel}
        template={sel}
        onClose={() => { setCreateOpen(false); setSel(null); }}
        onDone={() => { setCreateOpen(false); setSel(null); reload(); toast("Saved"); }}
      />
      <Submissions template={subsFor} onClose={() => setSubsFor(null)} />
    </Page>
  );
}

function FormEditor({ open, template, onClose, onDone }: {
  open: boolean; template: FormTemplate | null; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [fields, setFields] = useState<FormTemplateField[]>([]);
  // Where the form is asked. Empty means everywhere — the sensible default.
  const [categories, setCategories] = useState<string[]>([]);
  const [treatmentIds, setTreatmentIds] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const catList = useApi(() => (open ? api.categories.list().then((r) => r.data ?? []) : Promise.resolve([])), [open]);
  const svcList = useApi(() => (open ? api.services.list({ limit: 500 }).then((r) => r.data ?? []) : Promise.resolve([])), [open]);
  const brList = useApi(() => (open ? api.branches.list({ kind: "clinic" }) : Promise.resolve([])), [open]);

  // Prime the editor when a different form is opened.
  const key = template?._id ?? (open ? "new" : "");
  if (open && key !== loadedFor) {
    setLoadedFor(key);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setIsActive(template?.isActive ?? false);
    setFields(template?.fields?.length ? [...template.fields] : [blankField(0)]);
    setCategories(template?.consultationCategories ?? []);
    setTreatmentIds((template?.treatmentIds ?? []).map(String));
    setBranchIds((template?.branchIds ?? []).map(String));
    setErr(null);
  }

  const setField = (i: number, patch: Partial<FormTemplateField>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const move = (i: number, by: number) =>
    setFields((fs) => {
      const j = i + by;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      // Order is stored, so it has to follow the move.
      return next.map((f, k) => ({ ...f, order: k }));
    });

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Give the form a name."); return; }
    const clean = fields
      .filter((f) => f.key.trim() && f.label.trim())
      .map((f, i) => ({ ...f, key: f.key.trim(), label: f.label.trim(), order: i }));
    if (!clean.length) { setErr("Add at least one question with a key and a label."); return; }

    setBusy(true);
    try {
      const body = {
        name: name.trim(), description, fields: clean, isActive,
        consultationCategories: categories, treatmentIds, branchIds,
      };
      if (template) await api.formTemplates.update(template._id, body);
      else await api.formTemplates.create(body);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={template ? `Edit — ${template.name}` : "New consultation form"} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <In label="Form name" value={name} onChange={setName} />
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-[12px] font-semibold text-ink2">
            <Toggle on={isActive} onChange={setIsActive} /> Live — guests can fill it in
          </label>
        </div>
      </div>
      <div className="mt-3"><Area label="Description" value={description} rows={2} onChange={setDescription} /></div>

      <SecH t="Where it is asked" em="· leave a list empty to mean everywhere" />
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <MultiSelect label="Consultation categories" value={categories} onChange={setCategories}
          options={[...new Set((catList.data ?? []).map((c) => c.name))].map((n) => [n, n] as [string, string])} />
        <MultiSelect label="Specific treatments" value={treatmentIds} onChange={setTreatmentIds}
          options={(svcList.data ?? []).map((sv) => [String(sv._id), sv.name] as [string, string])} />
        <MultiSelect label="Branches" value={branchIds} onChange={setBranchIds}
          options={(brList.data ?? []).map((b) => [String(b._id), b.name] as [string, string])} />
      </div>

      <SecH t="Questions" em={`· ${fields.length}`} />
      {fields.map((f, i) => (
        <div key={i} className="mb-2 rounded-xl border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1.2fr_1fr]">
            <In label="Question" value={f.label} onChange={(v) => setField(i, { label: v })} placeholder="What are we asking?" />
            <In label="Field key" value={f.key} onChange={(v) => setField(i, { key: v })}
              hint="Lowercase, no spaces. Answers are stored under this — don't change it later." />
            <Sel label="Type" value={f.type} onChange={(v) => setField(i, { type: v as FormTemplateField["type"] })}
              options={[...FIELD_TYPES]} />
          </div>
          {["select", "multiselect", "radio"].includes(f.type) && (
            <div className="mt-2">
              <In label="Choices (comma separated)"
                value={(f.options ?? []).map((o) => o.label).join(", ")}
                onChange={(v) => setField(i, {
                  options: v.split(",").map((s) => s.trim()).filter(Boolean)
                    .map((label) => ({ label, value: label.toLowerCase().replace(/\s+/g, "_") })),
                })} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-ink2">
              <Toggle on={!!f.required} onChange={(v) => setField(i, { required: v })} /> Required
            </label>
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-ink2">
              <Toggle on={!!f.sensitive} onChange={(v) => setField(i, { sensitive: v })} /> Clinical / sensitive
            </label>
            <div className="ml-auto flex gap-1.5">
              <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => move(i, -1)}>↑</Btn>
              <Btn kind="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => move(i, 1)}>↓</Btn>
              <button className="px-1.5 text-[15px] font-bold text-err"
                onClick={() => setFields((fs) => (fs.length === 1 ? [blankField(0)] : fs.filter((_, j) => j !== i)))}>×</button>
            </div>
          </div>
        </div>
      ))}
      <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]"
        onClick={() => setFields((fs) => [...fs, blankField(fs.length)])}>Add a question</Btn>

      {err && <Note kind="crit" className="mt-2 text-[12px]">{err}</Note>}
      {(template?.submissionCount ?? 0) > 0 && (
        <Note className="mt-2 text-[11.5px]">
          This form already has {template?.submissionCount} submission(s). Changing the questions publishes a new
          version — existing answers keep the version they were given, so nothing already collected is rewritten.
        </Note>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="gold" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Modal>
  );
}

function Submissions({ template, onClose }: { template: FormTemplate | null; onClose: () => void }) {
  const rows = useApi(
    () => (template ? api.formTemplates.submissions(template._id, { limit: 100 }).then((r) => r.data ?? []) : Promise.resolve([])),
    [template?._id],
  );

  const cols = useMemo(
    () => ["When", "Guest", "Appointment", "Version"],
    [],
  );

  return (
    <Modal open={!!template} onClose={onClose} title={template ? `Submissions — ${template.name}` : ""} wide>
      <Async q={rows} label="Loading submissions…" rows={4}>
        {(list) => list.length === 0
          ? <Empty title="No submissions yet" hint="They appear here as soon as guests start filling this form in." />
          : (
            <DataTable
              cols={cols}
              rows={list.map((s) => {
                const user = (s.userId ?? {}) as { fullName?: string; patientId?: string; guestCode?: string | null };
                const booking = (s.bookingId ?? {}) as { referenceNumber?: string };
                return [
                  fmtDate(s.submittedAt ?? s.createdAt ?? ""),
                  `${user.fullName ?? "—"}${guestCodeOf(user) ? ` · ${guestCodeOf(user)}` : ""}`,
                  booking.referenceNumber ?? "—",
                  `v${s.templateVersion}`,
                ];
              })}
            />
          )}
      </Async>
    </Modal>
  );
}
