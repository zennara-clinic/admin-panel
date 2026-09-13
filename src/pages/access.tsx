import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { B, Modal, Async, DeleteModal } from "../ui";
import {
  ChoicePills, Field, Input, Matrix, MatrixCheck, Note, Section, Select, StatusTag, StudioBtn, StudioEmpty, StudioTable, SubHeading, Textarea,
} from "../studio-ui";
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

  if (groups.length === 0) return <StudioEmpty title="No permissions to show" hint="The permission catalogue has not loaded yet." />;

  return (
    <Matrix
      firstLabel="Permission"
      columns={[{ key: "granted", label: "Granted", width: 120 }]}
      groups={groups.map((g) => {
        const on = g.permissions.filter((p) => value.has(p.key)).length;
        const all = on === g.permissions.length;
        return {
          key: g.key,
          label: g.label,
          meta: <span className="tabular-nums">{on}/{g.permissions.length}</span>,
          right: editable ? (
            <StudioBtn kind="link" small onClick={() => setGroup(g, !all)}>{all ? "Clear all" : "Select all"}</StudioBtn>
          ) : undefined,
          rows: g.permissions.map((p) => ({
            key: p.key,
            label: (
              <span className="flex flex-wrap items-center gap-2">
                <span>{p.label}</span>
                {p.sensitive && <StatusTag kind="warn">sensitive</StatusTag>}
              </span>
            ),
            cells: [<MatrixCheck key={p.key} checked={value.has(p.key)} disabled={!editable} label={p.label} onChange={() => toggle(p.key)} />],
          })),
        };
      })} />
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
    <div className="col-span-full grid gap-4 rounded-[12px] border border-border bg-ivory p-4">
      <div>
        <div className="text-[16px] font-semibold leading-6 text-ink">Access</div>
        <div className="text-[14px] leading-5 text-ink2">What this staff member can do.</div>
      </div>
      <Field label="Role"
        hint={role
          ? `${role.name} grants ${rolePerms.size} permission${rolePerms.size === 1 ? "" : "s"}. ${role.description ?? ""}`
          : "With no role, this account can only do what you grant directly below."}>
        <ChoicePills<string | null> value={customRoleId} onChange={onRole}
          options={[{ value: null, label: "No role" }, ...roles.map((r) => ({ value: r._id as string, label: r.name }))]} />
      </Field>

      <StudioBtn kind="link" small onClick={() => setShowExtra((v) => !v)} className="justify-self-start">
        {showExtra ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {showExtra ? "Hide extra permissions" : "Add extra permissions on top of the role"}
        {permissions.size > 0 ? ` (${permissions.size})` : ""}
      </StudioBtn>
      {showExtra && (
        <>
          <Note>
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
  gray: "bg-dis-bg text-ink2",
};
export function RoleChip({ role }: { role: Pick<Role, "name" | "color"> }) {
  const cls = ROLE_COLORS[role.color ?? "green"] ?? ROLE_COLORS.green;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[14px] font-semibold ${cls}`}>{role.name}</span>;
}

/**
 * Create, edit and delete custom staff roles, and pick which granular
 * permissions each one grants. This is the heart of the RBAC screen; assigning
 * a role to a person happens on the Staff section.
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
    <Section title="Roles & permissions"
      blurb="A role is a named bundle of permissions. Assign one to a staff account on the Staff section."
      right={canManage ? <StudioBtn onClick={() => setCreating(true)}>New role</StudioBtn> : undefined}>
      {!canManage && <Note kind="warn">You can view roles, but only someone with the “manage roles” permission can change them.</Note>}

      <div className="col-span-full">
        <Async q={rolesQ} label="Loading roles…" rows={4}>
          {() => roles.length === 0 ? (
            <StudioEmpty title="No roles yet" hint="Create your first role and choose what it can do."
              action={canManage ? <StudioBtn onClick={() => setCreating(true)}>New role</StudioBtn> : undefined} />
          ) : (
            <div className="grid gap-3">
              {roles.map((r) => (
                <div key={r._id} className="flex flex-wrap items-center gap-4 rounded-[12px] border border-border bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleChip role={r} />
                      {r.isSystem && <StatusTag kind="mute">starter</StatusTag>}
                      {r.isActive === false && <StatusTag kind="mute">disabled</StatusTag>}
                    </div>
                    {r.description && <div className="mt-1.5 text-[14px] leading-5 text-ink2">{r.description}</div>}
                    <div className="mt-1 text-[14px] leading-5 text-ink3">
                      {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                      {typeof r.staffCount === "number" ? ` · ${r.staffCount} staff` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <StudioBtn kind="ghost" onClick={() => setEditing(r)}>{canManage ? "Edit" : "View"}</StudioBtn>
                    {canManage && !r.isSystem && (
                      <StudioBtn kind="danger" onClick={() => setDel(r)}>Delete</StudioBtn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Async>
      </div>

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
    </Section>
  );
}

const COLOR_OPTIONS = ["green", "blue", "amber", "red", "gray"];
const COLOR_LABEL: Record<string, string> = { green: "Green", blue: "Blue", amber: "Amber", red: "Red", gray: "Grey" };

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
      <div className="@container/fields grid gap-5">
        <div className="grid gap-5 @lg/fields:grid-cols-2">
          <Field label="Role name">
            <Input value={name} onChange={setName} placeholder="e.g. Front desk" readOnly={!canManage} />
          </Field>
          <Field label="Colour" hint="How the role's chip looks on the staff list.">
            <div className="flex min-h-[44px] flex-wrap items-center gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button key={c} type="button" disabled={!canManage} onClick={() => setColor(c)} title={COLOR_LABEL[c]} aria-label={COLOR_LABEL[c]} aria-pressed={color === c}
                  className={`grid h-11 w-11 place-items-center rounded-full border-2 transition-colors disabled:cursor-default ${color === c ? "border-primary" : "border-transparent"}`}>
                  <span className={`block h-7 w-7 rounded-full ${ROLE_COLORS[c]}`} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Description" full>
            <Textarea value={description} onChange={setDescription} rows={2} placeholder="What is this role for?" />
          </Field>
        </div>

        <SubHeading title="Permissions" blurb={`${perms.size} of ${total} selected.`} />
        <PermissionMatrix groups={groups} value={perms} onChange={canManage ? setPerms : undefined} />

        {err && <Note kind="err">{err}</Note>}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">
          <StudioBtn kind="ghost" onClick={onClose}>{canManage ? "Cancel" : "Close"}</StudioBtn>
          {canManage && <StudioBtn disabled={busy} onClick={save}>{busy ? "Saving…" : role ? "Save role" : "Create role"}</StudioBtn>}
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
    <div className="col-span-full grid gap-4 rounded-[12px] border border-border bg-ivory p-4">
      <div>
        <div className="text-[16px] font-semibold leading-6 text-ink">Centres & roles</div>
        <div className="text-[14px] leading-5 text-ink2">What they do at each centre.</div>
      </div>
      {value.length === 0 && <div className="text-[14px] leading-6 text-ink3">No centre assignments yet. The role above applies everywhere; add rows to give a different role per centre or a temporary posting.</div>}
      {value.map((a, i) => (
        <div key={i} className={`grid gap-4 rounded-[12px] border p-4 ${a.kind === "deputation" ? "border-primary/30 bg-primary/[0.03]" : "border-border bg-surface"}`}>
          <div className="grid gap-4 @lg/fields:grid-cols-3">
            <Field label="Centre">
              <Select value={branchName(a.branchId)} options={["— choose a centre —", ...branches.map((b) => b.name)]}
                onChange={(v) => set(i, { branchId: branches.find((b) => b.name === v)?._id ?? "" })} />
            </Field>
            <Field label="Role at this centre">
              <Select value={roleName(a.roleId)} options={["— no role at this centre —", ...roles.map((r) => r.name)]}
                onChange={(v) => set(i, { roleId: roles.find((r) => r.name === v)?._id ?? null })} />
            </Field>
            <Field label="Kind">
              <Select value={KIND_LABEL[a.kind || "primary"]} options={Object.values(KIND_LABEL)}
                onChange={(v) => set(i, { kind: v === KIND_LABEL.deputation ? "deputation" : "primary", ...(v === KIND_LABEL.deputation ? {} : { from: null, to: null }) })} />
            </Field>
          </div>
          {a.kind === "deputation" && (
            <div className="grid gap-4 @lg/fields:grid-cols-3">
              <Field label="From"><Input type="date" value={day(a.from)} onChange={(v) => set(i, { from: v || null })} /></Field>
              <Field label="To"><Input type="date" value={day(a.to)} onChange={(v) => set(i, { to: v || null })} /></Field>
              <Field label="Note"><Input value={a.note ?? ""} onChange={(v) => set(i, { note: v })} placeholder="Covering for…" /></Field>
            </div>
          )}
          {!disabled && <StudioBtn kind="link" small className="justify-self-end !text-err" onClick={() => remove(i)}>Remove</StudioBtn>}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <StudioBtn kind="ghost" onClick={() => add("primary")}>Add a role at a centre</StudioBtn>
          <StudioBtn kind="ghost" onClick={() => add("deputation")}>Add a deputation</StudioBtn>
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
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[14px] leading-5 text-ink2">
        <StatusTag kind={hasPassword ? "ok" : "info"}>{hasPassword ? "password set" : "code only"}</StatusTag>
        <span>Signs in with <B>{email}</B>{hasPassword ? " and a password, or an emailed code." : " and a 6-digit code emailed at sign-in."}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <StudioBtn kind="ghost" onClick={() => { setMode("set"); setGenerate(true); setChannel("email"); }}>{hasPassword ? "Update password" : "Set a password"}</StudioBtn>
        <StudioBtn kind="ghost" onClick={() => { setMode("send"); setChannel(phone ? "both" : "email"); }}>Send sign-in details</StudioBtn>
      </div>

      <Modal open={mode !== null} onClose={close} title={mode === "send" ? "Send sign-in details" : hasPassword ? "Update password" : "Set a password"}>
        {issued ? (
          <div className="grid gap-4">
            <Note>This temporary password is shown once. They will be asked to choose their own at first sign-in.</Note>
            <div className="rounded-[12px] border border-border bg-ivory px-4 py-4 text-center font-mono text-[22px] font-bold tracking-wide tabular-nums text-ink">{issued}</div>
            {delivery && (
              <div className="text-[14px] leading-6 text-ink2">
                {delivery.email && <div>Email: {delivery.email}</div>}
                {delivery.whatsapp && <div>WhatsApp: {delivery.whatsapp}</div>}
              </div>
            )}
            <div className="flex justify-end"><StudioBtn onClick={close}>Done</StudioBtn></div>
          </div>
        ) : (
          <div className="grid gap-4">
            {mode === "send" ? (
              <Note>A new temporary password is issued and sent. Their previous password (if any) stops working.</Note>
            ) : (
              <>
                <Field label="Password">
                  <ChoicePills<string> value={generate ? "generate" : "typed"} onChange={(v) => setGenerate(v === "generate")}
                    options={[{ value: "generate", label: "Generate a temporary password" }, { value: "typed", label: "Type one" }]} />
                </Field>
                {!generate && (
                  <Field label="New password" hint="At least 8 characters. Stored as a hash — it cannot be shown again.">
                    <Input type="password" value={pw} onChange={setPw} />
                  </Field>
                )}
              </>
            )}
            <Field label="Send to them by" hint={!phone ? "Add a phone number to the account to send by WhatsApp." : undefined}>
              <ChoicePills<string> value={channel} onChange={(v) => setChannel(v as typeof channel)}
                options={(mode === "set" ? (["email", "whatsapp", "both", "none"] as const) : (["email", "whatsapp", "both"] as const)).map((c) => ({
                  value: c, label: chLabel[c], disabled: (c === "whatsapp" || c === "both") && !phone,
                }))} />
            </Field>
            {err && <Note kind="err">{err}</Note>}
            <div className="flex justify-end gap-2">
              <StudioBtn kind="ghost" onClick={close}>Cancel</StudioBtn>
              <StudioBtn disabled={busy || (mode === "set" && !generate && pw.length < 8)} onClick={run}>{busy ? "Working…" : mode === "send" ? "Send" : "Set password"}</StudioBtn>
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
    <div className="grid gap-4">
      {requireCurrent && <Field label="Current password"><Input type="password" value={current} onChange={setCurrent} /></Field>}
      <Field label="New password" hint="At least 8 characters."><Input type="password" value={next} onChange={setNext} /></Field>
      <Field label="New password again"><Input type="password" value={again} onChange={setAgain} /></Field>
      {err && <Note kind="err">{err}</Note>}
      <div className="flex justify-end"><StudioBtn disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save password"}</StudioBtn></div>
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
    <Section title="Sign-in security" blurb="Brute-force protection for every panel sign-in, and the way to un-stick a locked-out colleague.">
      <div className="col-span-full">
        <Async q={settings} label="Reading the security settings…" rows={3}>
          {(s) => {
            const rl = s.loginRateLimit;
            return (
              <div className="grid gap-5 rounded-[12px] border border-border bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[16px] font-semibold leading-6 text-ink">Sign-in throttling</h3>
                  <StatusTag kind={rl.active ? "ok" : "err"}>{rl.active ? "On" : "Paused"}</StatusTag>
                </div>

                {rl.active ? (
                  <p className="m-0 max-w-[640px] text-[14px] leading-6 text-ink2">
                    After <B>10 failed</B> sign-in attempts in 15 minutes, that email is asked to wait.
                    Successful sign-ins are never counted, and each account has its own budget — one
                    person mistyping a password cannot lock out the centre.
                  </p>
                ) : (
                  <Note kind="err">
                    <B>Throttling is off.</B> Anyone can guess staff passwords as fast as they like until{" "}
                    <B>{fmtDateTime(rl.pausedUntil)}</B> ({rl.minutesRemaining} min left).
                    {rl.pausedByName ? <> Paused by {rl.pausedByName}.</> : null}
                    {rl.pausedReason ? <> Reason: “{rl.pausedReason}”.</> : null}
                  </Note>
                )}

                {rl.active ? (
                  <div className="grid gap-4 rounded-[12px] border border-border bg-ivory p-4">
                    <div>
                      <div className="text-[15px] font-semibold leading-6 text-ink">Pause it while testing</div>
                      <div className="text-[14px] leading-5 text-ink2">A bounded window that turns itself back on — there is no permanent off.</div>
                    </div>
                    <Field label="For how long">
                      <ChoicePills<string> value={String(minutes)} onChange={(v) => setMinutes(Number(v))}
                        options={PAUSE_CHOICES.filter(([m]) => m <= rl.maxPauseMinutes).map(([m, label]) => ({ value: String(m), label }))} />
                    </Field>
                    <Field label="Why (goes in the audit log)">
                      <Input value={reason} onChange={setReason} placeholder="Testing the dermatologist panel sign-in" />
                    </Field>
                    <div className="flex justify-end">
                      <StudioBtn disabled={busy || reason.trim().length < 3} onClick={() => apply(true)}>
                        {busy ? "Pausing…" : "Pause throttling"}
                      </StudioBtn>
                    </div>
                  </div>
                ) : (
                  <div><StudioBtn disabled={busy} onClick={() => apply(false)}>{busy ? "Turning it on…" : "Turn throttling back on now"}</StudioBtn></div>
                )}
              </div>
            );
          }}
        </Async>
      </div>

      <SubHeading title="Locked out" blurb="10 wrong passwords locks an account for an hour." />
      <div className="col-span-full">
        <Async q={locked} label="" rows={2}>
          {(rows) => rows.length === 0 ? (
            <div className="text-[14px] leading-6 text-ink3">Nobody is locked out, and nobody has a failed attempt on record.</div>
          ) : (
            <StudioTable cols={["Who", "Role", { label: "Failed attempts", align: "right" }, "Status", ""]} minWidth={560}
              rows={rows.map((a) => [
                <span key={a._id} className="block"><span className="block font-semibold text-ink">{a.name ?? "—"}</span><span className="block text-[12.5px] leading-5 text-ink3">{a.email}</span></span>,
                a.role,
                <span key={`${a._id}f`} className="tabular-nums">{a.failedLoginAttempts}</span>,
                a.lockedUntil
                  ? <StatusTag key={`${a._id}s`} kind="err">Locked until {fmtTime(a.lockedUntil)}</StatusTag>
                  : <StatusTag key={`${a._id}s`} kind="warn">Can still sign in</StatusTag>,
                <StudioBtn key={`${a._id}b`} kind="ghost" small onClick={() => unlock(a)}>Clear</StudioBtn>,
              ])} />
          )}
        </Async>
      </div>
    </Section>
  );
}
