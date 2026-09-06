import { useEffect, useState } from "react";
import { Btn, Tag, Modal, Note, In, Sel, Area, B, Page, DataTable, Async, Empty, Switch, DeleteModal } from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi } from "../lib/useApi";
import type { MessageTemplate } from "../lib/types";

/* ------------------------------------------------------------------------- *
 * Message templates — ezConnect's "Templates": reusable WhatsApp / email
 * texts with {{placeholders}} filled from the guest, booking, bill or
 * package. WhatsApp business templates approved by Meta carry a Twilio
 * Content SID; those are the only messages that can open a conversation
 * outside the 24-hour reply window.
 * ------------------------------------------------------------------------- */

const CHANNELS = ["whatsapp", "email", "sms", "note"] as const;
const CATEGORIES = ["appointment", "billing", "package", "membership", "marketing", "general"] as const;
const errMsg = (e: unknown) => (e as Error)?.message || "Something went wrong";

export function Templates() {
  const { can, toast } = useStore();
  const [channel, setChannel] = useState("all");
  const [edit, setEdit] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<MessageTemplate | null>(null);
  const q = useApi(() => api.templates.list({ channel, includeInactive: "true" }), [channel]);
  const rows = (q.data?.data ?? []) as MessageTemplate[];
  const placeholders = (q.data?.placeholders ?? []) as string[];
  const canManage = can("templates.manage") || can("chat.manage");
  return (
    <Page title="Message templates" sub="Ready-made guest messages for the chat, WhatsApp and email — placeholders fill from the booking, bill or package."
      actions={canManage ? <Btn onClick={() => setCreating(true)}>New template</Btn> : undefined}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Sel label="Channel" value={channel} onChange={setChannel} options={["all", ...CHANNELS]} />
        <div className="text-[11.5px] text-ink3">Placeholders: {placeholders.map((p) => <code key={p} className="mr-1 rounded bg-ivory px-1">{`{{${p}}}`}</code>)}</div>
      </div>
      <Async q={q} label="Loading templates…" rows={4}>
        {() => rows.length === 0 ? <Empty title="No templates yet" hint="Create the confirmations, reminders and thank-you notes the desk sends every day." /> : (
          <DataTable cols={["Name", "Channel", "Category", "Body", "WhatsApp approved", "Used", "Status"]}
            onRow={(i) => canManage && setEdit(rows[i])}
            rows={rows.map((t) => [
              <span key="n"><B>{t.name}</B><div className="font-mono text-[10.5px] text-ink3">{t.key}</div></span>,
              <Tag key="c" kind={t.channel === "whatsapp" ? "ok" : t.channel === "email" ? "info" : "mute"}>{t.channel}</Tag>,
              t.category,
              <span key="b" className="line-clamp-2 max-w-[420px] text-[12px] text-ink2">{t.body}</span>,
              t.twilioContentSid ? <Tag key="w" kind="gold">Content SID</Tag> : <span key="w" className="text-ink3">—</span>,
              String(t.usageCount ?? 0),
              <Tag key="s" kind={t.isActive ? "ok" : "mute"}>{t.isActive ? "Active" : "Off"}</Tag>,
            ])} />
        )}
      </Async>
      <TemplateEditor open={creating || !!edit} tpl={edit} placeholders={placeholders} onClose={() => { setCreating(false); setEdit(null); }} onSaved={() => { setCreating(false); setEdit(null); q.reload(); }} onDelete={(t) => { setEdit(null); setDel(t); }} />
      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `template “${del.name}”` : ""} onConfirm={async () => { if (!del) return; try { await api.templates.remove(del._id); toast("Template deleted"); setDel(null); q.reload(); } catch (e) { toast(errMsg(e)); } }} />
    </Page>
  );
}

function TemplateEditor({ open, tpl, placeholders, onClose, onSaved, onDelete }: { open: boolean; tpl: MessageTemplate | null; placeholders: string[]; onClose: () => void; onSaved: () => void; onDelete: (t: MessageTemplate) => void }) {
  const { toast } = useStore();
  const [f, setF] = useState<Partial<MessageTemplate>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setF(tpl ? { ...tpl } : { name: "", channel: "whatsapp", category: "appointment", subject: "", body: "Hi {{firstName}}, ", twilioContentSid: "", contentVariables: [], isActive: true }); setErr(null); } }, [open, tpl?._id]);
  const set = <K extends keyof MessageTemplate>(k: K) => (v: MessageTemplate[K]) => setF((s) => ({ ...s, [k]: v }));
  const used = [...String(f.body || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  return (
    <Modal open={open} onClose={onClose} title={tpl ? `Edit ${tpl.name}` : "New template"} wide>
      <div className="grid gap-3 md:grid-cols-3">
        <In label="Name" value={f.name ?? ""} onChange={set("name")} placeholder="e.g. Thank you after visit" />
        <Sel label="Channel" value={f.channel ?? "whatsapp"} onChange={(v) => set("channel")(v as MessageTemplate["channel"])} options={[...CHANNELS]} />
        <Sel label="Category" value={f.category ?? "general"} onChange={(v) => set("category")(v as MessageTemplate["category"])} options={[...CATEGORIES]} />
      </div>
      {f.channel === "email" && <div className="mt-3"><In label="Subject" value={f.subject ?? ""} onChange={set("subject")} /></div>}
      <div className="mt-3">
        <Area label="Body" value={f.body ?? ""} onChange={set("body")} rows={6} placeholder="Hi {{firstName}}, thank you for visiting us at {{centre}}…" />
        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">{placeholders.map((p) => <button key={p} className="rounded bg-ivory px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-border/60" onClick={() => set("body")(`${f.body ?? ""}{{${p}}}`)}>{`{{${p}}}`}</button>)}</div>
      </div>
      {f.channel === "whatsapp" && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <In label="Twilio Content SID (approved WhatsApp template)" value={f.twilioContentSid ?? ""} onChange={set("twilioContentSid")} placeholder="HXxxxxxxxx…" hint="Needed to message a guest who has not written in the last 24 hours" />
          <In label="Variable order for the Content template" value={(f.contentVariables ?? []).join(", ")} onChange={(v) => set("contentVariables")(v.split(",").map((x) => x.trim()).filter(Boolean))} placeholder={used.join(", ") || "firstName, date, time"} hint={`{{1}}, {{2}} … in the approved template map to these placeholders in order`} />
        </div>
      )}
      <div className="mt-3"><Switch label="Active" sub="Shown in the composer's template picker" on={f.isActive !== false} onChange={set("isActive")} /></div>
      {err && <Note kind="crit" className="mt-2">{err}</Note>}
      <div className="mt-4 flex justify-between gap-2">
        <div>{tpl && <Btn kind="danger" onClick={() => onDelete(tpl)}>Delete</Btn>}</div>
        <div className="flex gap-2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !f.name?.trim() || !f.body?.trim()} onClick={async () => { setBusy(true); setErr(null); try { if (tpl) await api.templates.update(tpl._id, f); else await api.templates.create(f); toast("Template saved"); onSaved(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save template"}</Btn></div>
      </div>
    </Modal>
  );
}

/** Pick a template and see it rendered for a guest / booking — used by the chat composer and the booking drawer. */
export function TemplatePicker({ open, onClose, onPick, channel = "whatsapp", context }: { open: boolean; onClose: () => void; onPick: (t: MessageTemplate, rendered: string) => void; channel?: "whatsapp" | "email"; context: { userId?: string; bookingId?: string; invoiceId?: string; assignmentId?: string }; }) {
  const q = useApi(() => (open ? api.templates.list({ channel }) : Promise.resolve(null)), [open, channel]);
  const [sel, setSel] = useState<MessageTemplate | null>(null);
  const preview = useApi(() => (open && sel ? api.templates.preview(sel._id, context) : Promise.resolve(null)), [open, sel?._id, context.userId, context.bookingId]);
  useEffect(() => { if (!open) setSel(null); }, [open]);
  const rows = (q.data?.data ?? []) as MessageTemplate[];
  return (
    <Modal open={open} onClose={onClose} title="Choose a template" wide>
      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
          {rows.length === 0 && <div className="px-3 py-3 text-[12px] text-ink3">No {channel} templates yet — add them under Operations › Message templates.</div>}
          {rows.map((t) => <button key={t._id} onClick={() => setSel(t)} className={`block w-full border-b border-border/60 px-3 py-2 text-left text-[12.5px] hover:bg-ivory ${sel?._id === t._id ? "bg-ivory font-bold" : ""}`}>{t.name}{t.twilioContentSid ? <Tag kind="gold">approved</Tag> : null}<div className="text-[10.5px] font-normal text-ink3">{t.category}</div></button>)}
        </div>
        <div>
          {!sel ? <div className="text-[12.5px] text-ink3">Pick a template to see it filled in for this guest.</div> : (
            <>
              <div className="whitespace-pre-wrap rounded-xl bg-ivory px-3 py-2 text-[12.5px]">{preview.data?.body ?? preview.error ?? "Rendering…"}</div>
              {!sel.twilioContentSid && channel === "whatsapp" && <Note className="mt-2 mb-0">No approved Content SID on this template — it can only be sent while the guest's 24-hour reply window is open.</Note>}
              <div className="mt-3 flex justify-end gap-2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={!preview.data} onClick={() => preview.data && onPick(sel, preview.data.body)}>Use template</Btn></div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
