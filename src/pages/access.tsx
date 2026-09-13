import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Tag, Card, B, Note, In, Sel, Area, Modal, Empty, Async, SecH, DataTable, DeleteModal } from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi } from "../lib/useApi";
import type { Admin, Branch, PermissionGroup, PermissionKey, Role, StaffAssignment } from "../lib/types";
import type { LockedAccount } from "../lib/api";
import { fmtDateTime, fmtTime } from "../lib/format";

/* ---------------- shared: permission catalog + matrix ---------------- */

/** Fetch the server's permission catalog (groups + keys). */
export function useCatalog() {
  return useApi(() => api.roles.catalog().then((r) => r.groups), []);
}

const ALL_KEYS = (groups: PermissionGroup[]) => groups.flatMap((g) => g.permissions.map((p) => p.key));

/**
 * The grid of permission checkboxes, grouped by sidebar section. Editable when
 * `onChange` is given; otherwise read-only. Each group has a select-all toggle.
 */
export function PermissionMatrix({
  groups, value, onChange, disabled,
}: {
  groups: PermissionGroup[];
  value: Set<PermissionKey>;
  onChange?: (next: Set<PermissionKey>) => void;
  disabled?: boolean;
}) {
  const editable = !!onChange && !disabled;
  const toggle = (key: PermissionKey) => {
    if (!onChange) return;
    const next = new Set(value);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(next);
  };
  const setGroup = (g: PermissionGroup, on: boolean) => {
    if (!onChange) return;
    const next = new Set(value);
    for (const p of g.permissions) on ? next.add(p.key) : next.delete(p.key);
    onChange(next);
  };

  return (
    <div className="grid gap-3">
      {groups.map((g) => {
        const on = g.permissions.filter((p) => value.has(p.key)).length;
        const all = on === g.permissions.length;
        return (
          <Card key={g.key} className="p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <B>{g.label}</B>
                <span className="font-mono text-[10.5px] text-ink3">{on}/{g.permissions.length}</span>
              </div>
              {editable && (
                <button
                  onClick={() => setGroup(g, !all)}
                  className="text-[11px] font-bold text-gold-dark hover:underline">
                  {all ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {g.permissions.map((p) => {
                const checked = value.has(p.key);
                return (
                  <label key={p.key}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${
                      editable ? "cursor-pointer hover:bg-ivory" : "cursor-default"
                    } ${checked ? "border-gold-dark bg-cream/60" : "border-border bg-surface"}`}>
                    <input type="checkbox" checked={checked} disabled={!editable}
                      onChange={() => toggle(p.key)}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                    <span className="flex-1">{p.label}</span>
                    {p.sensitive && <Tag kind="warn">sensitive</Tag>}
                  </label>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- staff assignment (role + direct overrides) ---------------- */

/**
 * The access controls for one 'staff' account: pick a role, then optionally
 * grant extra permissions on top of it. Effective access = the role's
 * permissions ∪ these direct grants, exactly as the server computes it. Shown
 * both when creating a staff member and when editing one.
 */
export function StaffAccessFields({
  roles, groups, customRoleId, permissions, onRole, onPermissions,
}: {
  roles: Role[];
  groups: PermissionGroup[];
  customRoleId: string | null;
  permissions: Set<PermissionKey>;
  onRole: (id: string | null) => void;
  onPermissions: (next: Set<PermissionKey>) => void;
}) {
  const [showExtra, setShowExtra] = useState(false);
  const role = roles.find((r) => r._id === customRoleId) || null;
  const rolePerms = new Set(role?.permissions ?? []);
  // What the person effectively gets: role permissions plus direct grants.
  const effective = useMemo(() => {
    const s = new Set(rolePerms);
    for (const p of permissions) s.add(p);
    return s;
  }, [role?._id, permissions]);

  return (
    <div className="grid gap-2.5 rounded-xl border border-border bg-ivory/60 p-3">
      <SecH t="Access" em="· what this staff member can do" />
      <div>
        <div className="mb-1 text-[11px] font-bold text-ink2">Role</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => onRole(null)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${customRoleId === null ? "border-primary bg-cream" : "border-border bg-surface hover:bg-ivory"}`}>
            No role
          </button>
          {roles.map((r) => (
            <button key={r._id} onClick={() => onRole(r._id)}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${customRoleId === r._id ? "border-primary bg-cream" : "border-border bg-surface hover:bg-ivory"}`}>
              {r.name}
            </button>
          ))}
        </div>
        {role && <div className="mt-1.5 text-[11px] text-ink3">{role.name} grants {rolePerms.size} permission{rolePerms.size === 1 ? "" : "s"}. {role.description}</div>}
        {!role && <div className="mt-1.5 text-[11px] text-ink3">With no role, this account can only do what you grant directly below.</div>}
      </div>

      <button onClick={() => setShowExtra((v) => !v)} className="text-left text-[11.5px] font-bold text-gold-dark hover:underline">
        {showExtra ? <><ChevronDown size={13} /> Hide extra permissions</> : <><ChevronRight size={13} /> Add extra permissions on top of the role</>}
        {permissions.size > 0 ? ` (${permissions.size})` : ""}
      </button>
      {showExtra && (
        <>
          <Note className="my-0">
            Ticks already covered by the role are shown for context; add extras here for just this person.
            Effective total: <B>{effective.size}</B> permissions.
          </Note>
          <PermissionMatrix groups={groups} value={permissions} onChange={onPermissions} />
        </>
      )}
    </div>
  );
}

/* ---------------- roles manager ---------------- */

const ROLE_COLORS: Record<string, string> = {
  green: "bg-ok-bg text-ok",
  blue: "bg-info-bg text-info",
  amber: "bg-warn-bg text-warn",
  red: "bg-err-bg text-err",
  gray: "bg-dis-bg text-dis",
};
export function RoleChip({ role }: { role: Pick<Role, "name" | "color"> }) {
  const cls = ROLE_COLORS[role.color ?? "green"] ?? ROLE_COLORS.green;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>{role.name}</span>;
}

/**
 * Create, edit and delete custom staff roles, and pick which granular
 * permissions each one grants. This is the heart of the RBAC screen; assigning
 * a role to a person happens on the Staff tab.
 */
export function RolesManager() {
  const { toast, audit, can } = useStore();
  const canManage = can("roles.manage");
  const catalog = useCatalog();
  const rolesQ = useApi(() => api.roles.list(), []);
  const roles = rolesQ.data ?? [];

  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Role | null>(null);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[12.5px] text-ink3">
          A role is a named bundle of permissions. Assign one to a staff account on the Staff tab.
        </div>
        {canManage && <Btn onClick={() => setCreating(true)}>+ New role</Btn>}
      </div>

      {!canManage && <Note kind="crit">You can view roles, but only someone with the “manage roles” permission can change them.</Note>}

      <Async q={rolesQ} label="Loading roles…" rows={4}>
        {() => roles.length === 0 ? (
          <Empty title="No roles yet" hint="Create your first role and choose what it can do."
            action={canManage ? <Btn onClick={() => setCreating(true)}>+ New role</Btn> : undefined} />
        ) : (
          <div className="grid gap-2.5">
            {roles.map((r) => (
              <Card key={r._id} className="flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <RoleChip role={r} />
                    {r.isSystem && <Tag kind="mute">starter</Tag>}
                    {r.isActive === false && <Tag kind="mute">disabled</Tag>}
                  </div>
                  {r.description && <div className="mt-1 truncate text-[12px] text-ink3">{r.description}</div>}
                  <div className="mt-1 font-mono text-[10.5px] text-ink3">
                    {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                    {typeof r.staffCount === "number" ? ` · ${r.staffCount} staff` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Btn kind="ghost" onClick={() => setEditing(r)}>{canManage ? "Edit" : "View"}</Btn>
                  {canManage && !r.isSystem && (
                    <Btn kind="danger" onClick={() => setDel(r)}>Delete</Btn>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Async>

      {(creating || editing) && (
        <RoleEditor
          role={editing}
          groups={catalog.data ?? []}
          canManage={canManage}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); rolesQ.reload(); }}
        />
      )}

      <DeleteModal open={!!del} onClose={() => setDel(null)} what={del ? `the role “${del.name}”` : ""}
        onConfirm={async () => {
          if (!del) return;
          try {
            await api.roles.remove(del._id);
            audit("SETTINGS_UPDATED", `Deleted role ${del.name}`, { roleId: del._id });
            toast("Role deleted"); setDel(null); rolesQ.reload();
          } catch (e) { toast((e as Error).message); }
        }} />
    </>
  );
}

const COLOR_OPTIONS = ["green", "blue", "amber", "red", "gray"];

function RoleEditor({ role, groups, canManage, onClose, onSaved }: {
  role: Role | null;
  groups: PermissionGroup[];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, audit } = useStore();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [color, setColor] = useState(role?.color ?? "green");
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = useMemo(() => ALL_KEYS(groups).length, [groups]);

  const save = async () => {
    if (!name.trim()) { setErr("Give the role a name"); return; }
    setBusy(true); setErr(null);
    try {
      const body = { name: name.trim(), description: description.trim(), color, permissions: Array.from(perms) };
      if (role) {
        await api.roles.update(role._id, body);
        audit("SETTINGS_UPDATED", `Updated role ${name.trim()}`, { roleId: role._id });
        toast("Role saved");
      } else {
        const res = await api.roles.create(body);
        audit("SETTINGS_UPDATED", `Created role ${name.trim()}`, { roleId: (res.data as Role)?._id });
        toast("Role created");
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} xl title={role ? `Edit role — ${role.name}` : "New role"}>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <In label="Role name" value={name} onChange={setName} placeholder="e.g. Front desk" readOnly={!canManage} />
          <div>
            <div className="mb-1 text-[11px] font-bold text-ink2">Colour</div>
            <div className="flex gap-1.5 pt-1">
              {COLOR_OPTIONS.map((c) => (
                <button key={c} disabled={!canManage} onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"} ${ROLE_COLORS[c]}`}
                  title={c} />
              ))}
            </div>
          </div>
        </div>
        <Area label="Description" value={description} onChange={setDescription} rows={2} placeholder="What is this role for?" />

        <div className="flex items-center justify-between">
          <SecH t="Permissions" em={`· ${perms.size}/${total} selected`} />
        </div>
        <PermissionMatrix groups={groups} value={perms} onChange={canManage ? setPerms : undefined} />

        {err && <Note kind="crit">{err}</Note>}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface pt-3">
          <Btn kind="ghost" onClick={onClose}>{canManage ? "Cancel" : "Close"}</Btn>
          {canManage && <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : role ? "Save role" : "Create role"}</Btn>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- centre assignments (role per centre, deputations) ---------------- */


const KIND_LABEL: Record<string, string> = { primary: "Regular", deputation: "Deputation (temporary)" };

/**
 * "Receptionist at Jubilee Hills, manager at Kondapur." One row per centre;
 * a deputation is the same row with a start and end date. Mirrors Zenoti's
 * Employee Roles tab (Center × Role) plus its Deputation screen.
 */
export function CentreRolesEditor({ value, onChange, roles, branches, disabled }: {
  value: StaffAssignment[];
  onChange: (next: StaffAssignment[]) => void;
  roles: Role[];
  branches: Branch[];
  disabled?: boolean;
}) {
  const branchName = (id?: string | null) => branches.find((b) => b._id === id)?.name ?? "— choose a centre —";
  const roleName = (id?: string | null) => roles.find((r) => r._id === id)?.name ?? "— no role at this centre —";
  const set = (i: number, patch: Partial<StaffAssignment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = (kind: "primary" | "deputation") => onChange([...value, {
    branchId: branches[0]?._id ?? "", roleId: null, kind,
    from: kind === "deputation" ? new Date().toISOString().slice(0, 10) : null,
    to: kind === "deputation" ? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) : null,
  }]);
  const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "");

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-ivory/60 p-3">
      <SecH t="Centres & roles" em="· what they do at each centre" />
      {value.length === 0 && <div className="text-[11.5px] text-ink3">No centre assignments yet. The role above applies everywhere; add rows to give a different role per centre or a temporary posting.</div>}
      {value.map((a, i) => (
        <div key={i} className={`grid gap-2 rounded-lg border p-2.5 ${a.kind === "deputation" ? "border-gold-dark/60 bg-cream/40" : "border-border bg-surface"}`}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Sel label="Centre" value={branchName(a.branchId)} options={["— choose a centre —", ...branches.map((b) => b.name)]}
              onChange={(v) => set(i, { branchId: branches.find((b) => b.name === v)?._id ?? "" })} />
            <Sel label="Role at this centre" value={roleName(a.roleId)} options={["— no role at this centre —", ...roles.map((r) => r.name)]}
              onChange={(v) => set(i, { roleId: roles.find((r) => r.name === v)?._id ?? null })} />
            <Sel label="Kind" value={KIND_LABEL[a.kind || "primary"]} options={Object.values(KIND_LABEL)}
              onChange={(v) => set(i, { kind: v === KIND_LABEL.deputation ? "deputation" : "primary", ...(v === KIND_LABEL.deputation ? {} : { from: null, to: null }) })} />
          </div>
          {a.kind === "deputation" && (
            <div className="grid gap-2 sm:grid-cols-3">
              <In label="From" type="date" value={day(a.from)} onChange={(v) => set(i, { from: v || null })} />
              <In label="To" type="date" value={day(a.to)} onChange={(v) => set(i, { to: v || null })} />
              <In label="Note" value={a.note ?? ""} onChange={(v) => set(i, { note: v })} placeholder="Covering for…" />
            </div>
          )}
          {!disabled && <button onClick={() => remove(i)} className="justify-self-end text-[11px] font-bold text-err hover:underline">Remove</button>}
        </div>
      ))}
      {!disabled && (
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={() => add("primary")}>+ Role at a centre</Btn>
          <Btn kind="ghost" onClick={() => add("deputation")}>+ Deputation</Btn>
        </div>
      )}
    </div>
  );
}

/* ---------------- sign-in controls (set / send password) ---------------- */

/**
 * Zenoti's Update Password and Reset Password, for one account. Passwords are
 * stored hashed and can never be read back; a generated temporary password is
 * shown ONCE here and the person must choose their own at first sign-in.
 */
export function SignInControls({ accountId, email, phone, hasPassword, onChanged }: {
  accountId: string; email: string; phone?: string | null; hasPassword?: boolean; onChanged?: () => void;
}) {
  const { toast, audit } = useStore();
  const [mode, setMode] = useState<null | "set" | "send">(null);
  const [pw, setPw] = useState("");
  const [generate, setGenerate] = useState(true);
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both" | "none">("email");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ email: string | null; whatsapp: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const close = () => { setMode(null); setPw(""); setIssued(null); setDelivery(null); setErr(null); };
  const chLabel: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", both: "Email and WhatsApp", none: "Don't send — I'll tell them" };

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const res = mode === "send"
        ? await api.staff.sendCredentials(accountId, channel === "none" ? "email" : channel)
        : await api.staff.setPassword(accountId, generate ? { generate: true, notify: channel } : { password: pw, notify: channel });
      setIssued(res.temporaryPassword ?? null);
      setDelivery(res.delivery ?? null);
      audit("SETTINGS_UPDATED", `${mode === "send" ? "Sent sign-in details to" : "Set password for"} ${email}`, { staffId: accountId });
      toast(res.message || "Done");
      onChanged?.();
      if (!res.temporaryPassword) close();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink3">
        <Tag kind={hasPassword ? "ok" : "info"}>{hasPassword ? "password set" : "code only"}</Tag>
        <span>Signs in with <B>{email}</B>{hasPassword ? " and a password, or an emailed code." : " and a 6-digit code emailed at sign-in."}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn kind="ghost" onClick={() => { setMode("set"); setGenerate(true); setChannel("email"); }}>{hasPassword ? "Update password" : "Set a password"}</Btn>
        <Btn kind="ghost" onClick={() => { setMode("send"); setChannel(phone ? "both" : "email"); }}>Send sign-in details</Btn>
      </div>

      <Modal open={mode !== null} onClose={close} title={mode === "send" ? "Send sign-in details" : hasPassword ? "Update password" : "Set a password"}>
        {issued ? (
          <div className="grid gap-3">
            <Note kind="gold">This temporary password is shown once. They will be asked to choose their own at first sign-in.</Note>
            <div className="rounded-xl border border-border bg-ivory px-4 py-3 text-center font-mono text-[20px] font-bold tracking-wide">{issued}</div>
            {delivery && (
              <div className="text-[11.5px] text-ink3">
                {delivery.email && <div>Email: {delivery.email}</div>}
                {delivery.whatsapp && <div>WhatsApp: {delivery.whatsapp}</div>}
              </div>
            )}
            <div className="flex justify-end"><Btn onClick={close}>Done</Btn></div>
          </div>
        ) : (
          <div className="grid gap-3">
            {mode === "send" ? (
              <Note className="my-0">A new temporary password is issued and sent. Their previous password (if any) stops working.</Note>
            ) : (
              <>
                <div className="flex gap-2">
                  <button onClick={() => setGenerate(true)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${generate ? "border-primary bg-cream" : "border-border bg-surface"}`}>Generate a temporary password</button>
                  <button onClick={() => setGenerate(false)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${!generate ? "border-primary bg-cream" : "border-border bg-surface"}`}>Type one</button>
                </div>
                {!generate && <In label="New password" type="password" value={pw} onChange={setPw} hint="At least 8 characters. Stored as a hash — it cannot be shown again." />}
              </>
            )}
            <div>
              <div className="mb-1 text-[11px] font-bold text-ink2">Send to them by</div>
              <div className="flex flex-wrap gap-1.5">
                {(mode === "set" ? (["email", "whatsapp", "both", "none"] as const) : (["email", "whatsapp", "both"] as const)).map((c) => (
                  <button key={c} onClick={() => setChannel(c)} disabled={(c === "whatsapp" || c === "both") && !phone}
                    className={`rounded-full border px-3 py-1 text-[12px] font-semibold disabled:opacity-40 ${channel === c ? "border-primary bg-cream" : "border-border bg-surface"}`}>
                    {chLabel[c]}
                  </button>
                ))}
              </div>
              {!phone && <div className="mt-1 text-[10.5px] text-ink3">Add a phone number to the account to send by WhatsApp.</div>}
            </div>
            {err && <Note kind="crit">{err}</Note>}
            <div className="flex justify-end gap-2">
              <Btn kind="ghost" onClick={close}>Cancel</Btn>
              <Btn disabled={busy || (mode === "set" && !generate && pw.length < 8)} onClick={run}>{busy ? "Working…" : mode === "send" ? "Send" : "Set password"}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------------- choose my own password (forced after a temporary one) ---------------- */

export function ChangePasswordForm({ requireCurrent, onDone }: { requireCurrent: boolean; onDone: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (next.length < 8) { setErr("Use at least 8 characters."); return; }
    if (next !== again) { setErr("The two passwords do not match."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await api.auth.changePassword({ currentPassword: requireCurrent ? current : undefined, newPassword: next });
      onDone(res.token, res.admin, res.expiresAt);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3">
      {requireCurrent && <In label="Current password" type="password" value={current} onChange={setCurrent} />}
      <In label="New password" type="password" value={next} onChange={setNext} hint="At least 8 characters." />
      <In label="New password again" type="password" value={again} onChange={setAgain} />
      {err && <Note kind="crit">{err}</Note>}
      <div className="flex justify-end"><Btn disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save password"}</Btn></div>
    </div>
  );
}

/* ===================== SIGN-IN SECURITY (super admin) ===================== */

/**
 * Staff sign-in throttling, and the un-sticking of a locked-out colleague.
 *
 * Testing a panel means signing in repeatedly, which is exactly what
 * brute-force protection is built to stop — so there has to be a way to hold it
 * off. What there must NOT be is an on/off switch: protection that can be
 * disabled indefinitely is protection that is eventually found off, months
 * later, by nobody in particular.
 *
 * So the control is a window. You choose how long, you say why, it goes in the
 * audit log as a warning, and it turns itself back on. The page stays loud
 * while it is off.
 */
const PAUSE_CHOICES: [number, string][] = [[30, "30 minutes"], [60, "1 hour"], [240, "4 hours"], [480, "8 hours"], [1440, "24 hours"]];

export function SignInSecurityTab() {
  const { toast } = useStore();
  const settings = useApi(() => api.security.get(), []);
  const locked = useApi(() => api.security.lockedAccounts().catch(() => [] as LockedAccount[]), []);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async (paused: boolean) => {
    setBusy(true);
    try {
      const r = await api.security.setLoginRateLimit(paused ? { paused, minutes, reason } : { paused });
      toast((r.message as string) ?? "Updated");
      setReason("");
      settings.reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const unlock = async (a: LockedAccount) => {
    try {
      const r = await api.security.unlock(a._id);
      toast((r.message as string) ?? "Unlocked");
      locked.reload();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="grid gap-3.5">
      <Async q={settings} label="Reading the security settings…" rows={3}>
        {(s) => {
          const rl = s.loginRateLimit;
          return (
            <Card className="p-4">
              <SecH t="Sign-in throttling"
                right={<Tag kind={rl.active ? "ok" : "err"}>{rl.active ? "On" : "Paused"}</Tag>} />

              {rl.active ? (
                <p className="mb-3 text-[12.5px] text-ink2">
                  After <B>10 failed</B> sign-in attempts in 15 minutes, that email is asked to wait.
                  Successful sign-ins are never counted, and each account has its own budget — one
                  person mistyping a password cannot lock out the centre.
                </p>
              ) : (
                <Note kind="crit" className="mb-3">
                  <B>Throttling is off.</B> Anyone can guess staff passwords as fast as they like until{" "}
                  <B>{fmtDateTime(rl.pausedUntil)}</B> ({rl.minutesRemaining} min left).
                  {rl.pausedByName ? <> Paused by {rl.pausedByName}.</> : null}
                  {rl.pausedReason ? <> Reason: “{rl.pausedReason}”.</> : null}
                </Note>
              )}

              {rl.active ? (
                <div className="rounded-xl border border-border bg-ivory p-3">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink3">Pause it while testing</div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {PAUSE_CHOICES.filter(([m]) => m <= rl.maxPauseMinutes).map(([m, label]) => (
                      <button key={m} onClick={() => setMinutes(m)}
                        className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${minutes === m ? "bg-primary text-white" : "border border-border bg-surface text-ink2"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <In label="Why (goes in the audit log)" value={reason} onChange={setReason}
                    placeholder="Testing the dermatologist panel sign-in" full />
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink3">It turns itself back on — there is no permanent off.</span>
                    <Btn kind="gold" disabled={busy || reason.trim().length < 3} onClick={() => apply(true)}>
                      {busy ? "Pausing…" : "Pause throttling"}
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn disabled={busy} onClick={() => apply(false)}>{busy ? "Turning it on…" : "Turn throttling back on now"}</Btn>
              )}
            </Card>
          );
        }}
      </Async>

      <Card className="p-4">
        <SecH t="Locked out" em="· 10 wrong passwords locks an account for an hour" />
        <Async q={locked} label="" rows={2}>
          {(rows) => rows.length === 0 ? (
            <div className="text-[12px] text-ink3">Nobody is locked out, and nobody has a failed attempt on record.</div>
          ) : (
            <DataTable cols={["Who", "Role", "Failed attempts", "Status", ""]}
              rows={rows.map((a) => [
                <span key={a._id}><B>{a.name ?? "—"}</B><br /><span className="text-[11px] text-ink3">{a.email}</span></span>,
                a.role,
                <span key={`${a._id}f`} className="tabular-nums">{a.failedLoginAttempts}</span>,
                a.lockedUntil
                  ? <Tag key={`${a._id}s`} kind="err">Locked until {fmtTime(a.lockedUntil)}</Tag>
                  : <Tag key={`${a._id}s`} kind="warn">Can still sign in</Tag>,
                <Btn key={`${a._id}b`} kind="ghost" className="!py-1 !text-[11.5px]" onClick={() => unlock(a)}>Clear</Btn>,
              ])} />
          )}
        </Async>
      </Card>
    </div>
  );
}
