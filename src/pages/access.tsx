import { useMemo, useState } from "react";
import { Btn, Tag, Card, B, Note, In, Area, Modal, Empty, Async, SecH, DeleteModal } from "../ui";
import { useStore } from "../store";
import api from "../lib/api";
import { useApi } from "../lib/useApi";
import type { PermissionGroup, PermissionKey, Role } from "../lib/types";

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
        {showExtra ? "▾ Hide extra permissions" : "▸ Add extra permissions on top of the role"}
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
