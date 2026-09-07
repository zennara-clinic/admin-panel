import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import api from "./lib/api";
import { clearSession, getToken, hasLiveSession, onSessionExpired, setSession, storedAdmin } from "./lib/http";
import type { Admin, AdminRole, Branch, PermissionKey } from "./lib/types";

/**
 * This build is the standalone Admin panel. Super admins and granular 'staff'
 * accounts sign in here; dermatologists and therapists have their own panels.
 */
export type Role = "admin" | "doctor" | "therapist";

/** The panel this build renders. */
export const PANEL: Role = "admin";

/** Server-side roles allowed to sign in to this panel. */
const ACCEPTED_ROLES: AdminRole[] = ["super_admin", "staff"];

export const panelAccepts = (role: AdminRole | null | undefined): boolean =>
  !!role && ACCEPTED_ROLES.includes(role);

/** Tells a wrong-panel account where to go instead. */
export const wrongPanelMessage = (role: AdminRole): string => {
  const label = ROLE_LABEL[role] ?? role;
  const panel = role === "doctor" ? "Dermatologist" : role === "therapist" ? "Therapist" : "Admin";
  return `This account is a ${label}. Please sign in on the ${panel} panel instead.`;
};

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  doctor: "Dermatologist",
  therapist: "Therapist",
  staff: "Staff",
};

type Store = {
  /** Which panel to render. */
  role: Role;
  /** The signed-in account's server-side role — drives permissions. */
  adminRole: AdminRole | null;
  admin: Admin | null;
  isSuperAdmin: boolean;
  /** The account's effective permission keys (super admins hold everything). */
  permissions: Set<PermissionKey>;
  /**
   * The one gate the whole panel uses. Pass a permission key (or several, "any
   * of") and it returns whether the signed-in account may do it. Super admins
   * always pass. Nav visibility, page guards and every action button call this.
   */
  can: (perm: PermissionKey | PermissionKey[]) => boolean;
  /** Catalogue, pricing and stock edits. */
  canManageCatalogue: boolean;
  /** Staff accounts and roles. Mirrors requireRole on /api/admin/staff. */
  canManageStaff: boolean;

  /** Active branch. `branchId` is empty when "All branches" is selected. */
  branch: string;
  branchId: string;
  branches: Branch[];
  /**
   * The three clinics — Jubilee Hills, Kondapur and Financial District.
   *
   * These are the centres the business runs: everything a guest can be booked
   * into, sold, or assigned belongs to one of them. The pharmacies and the
   * training centre exist in Zenoti and hold stock, but they are not places a
   * guest attends, so they must never appear in a centre picker. Stock pages
   * are the exception and use `branches` deliberately.
   */
  clinics: Branch[];
  branchesLoading: boolean;
  setBranchById: (id: string) => void;
  reloadBranches: () => void;

  toasts: { id: number; msg: string }[];
  toast: (msg: string) => void;

  /** Writes an entry to the server audit trail. Failures are non-blocking. */
  audit: (action: AuditAction, detail?: string, extra?: Record<string, unknown>) => void;

  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;

  loggedIn: boolean;
  booting: boolean;
  signIn: (token: string, admin: Admin, expiresAt?: string) => void;
  logout: () => void;
  /** Replace the signed-in account after a self-service edit (profile, photo). */
  updateAdmin: (next: Admin) => void;
};

/** Actions the panel records itself, beyond what route middleware captures. */
export type AuditAction =
  | "BOOKING_CONFIRMED" | "BOOKING_CHECKED_IN" | "BOOKING_CHECKED_OUT"
  | "BOOKING_CANCELLED" | "BOOKING_NO_SHOW" | "BOOKING_CREATED" | "BOOKING_RESCHEDULED"
  | "CATALOGUE_CREATED" | "CATALOGUE_UPDATED" | "CATALOGUE_DELETED" | "CATALOGUE_STATUS_CHANGED"
  | "DOCTOR_CREATED" | "DOCTOR_UPDATED" | "DOCTOR_DELETED" | "DOCTOR_STATUS_CHANGED"
  | "DOCTOR_FEE_REQUESTED" | "DOCTOR_FEE_APPROVED" | "DOCTOR_FEE_REJECTED"
  | "BRANCH_CREATED" | "BRANCH_UPDATED" | "BRANCH_DELETED" | "BRANCH_STATUS_CHANGED"
  | "INVENTORY_CREATED" | "INVENTORY_UPDATED" | "INVENTORY_DELETED"
  | "VENDOR_CREATED" | "VENDOR_UPDATED" | "VENDOR_DELETED"
  | "REVIEW_APPROVED" | "REVIEW_REJECTED" | "REVIEW_DELETED" | "SUPPORT_UPDATED"
  | "PRESCRIPTION_SAVED" | "CONSENT_SIGNED" | "FORM_STATUS_CHANGED"
  | "USER_ACTIVATED" | "USER_DEACTIVATED" | "USER_DELETED"
  | "SETTINGS_UPDATED" | "APP_CUSTOMIZATION_UPDATED"
  | "PRODUCT_UPDATED" | "STOCK_UPDATED" | "ORDER_STATUS_UPDATED" | "BOOKING_UPDATED";

const RESOURCE_FOR = (action: AuditAction): string => {
  if (action.startsWith("BOOKING")) return "BOOKING";
  if (action.startsWith("CATALOGUE")) return "CATALOGUE";
  if (action.startsWith("DOCTOR")) return "DOCTOR";
  if (action.startsWith("BRANCH")) return "BRANCH";
  if (action.startsWith("INVENTORY")) return "INVENTORY";
  if (action.startsWith("VENDOR")) return "VENDOR";
  if (action.startsWith("REVIEW")) return "REVIEW";
  if (action.startsWith("SUPPORT")) return "SUPPORT";
  if (action.startsWith("USER")) return "USER";
  if (action.startsWith("PRODUCT") || action.startsWith("STOCK")) return "PRODUCT";
  if (action.startsWith("ORDER")) return "ORDER";
  if (action === "PRESCRIPTION_SAVED" || action === "CONSENT_SIGNED" || action === "FORM_STATUS_CHANGED")
    return "CLINICAL";
  return "SETTINGS";
};

const Ctx = createContext<Store>(null!);

const BRANCH_KEY = "zennara.admin.branchId";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(() => {
    const stored = storedAdmin<Admin>();
    return stored && panelAccepts(stored.role) ? stored : null;
  });
  const [loggedIn, setLoggedIn] = useState(() => {
    const stored = storedAdmin<Admin>();
    return hasLiveSession() && !!stored && panelAccepts(stored.role);
  });
  const [booting, setBooting] = useState(() => hasLiveSession());

  const [branches, setBranches] = useState<Branch[]>([]);

  // Only the clinics are centres in the operational sense — see the type above.

  const clinics = useMemo(() => branches.filter((b) => (b.centreType ?? "clinic") === "clinic"), [branches]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchId, setBranchId] = useState<string>(() => localStorage.getItem(BRANCH_KEY) ?? "");

  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  /* --- session --- */
  const signIn = useCallback((token: string, nextAdmin: Admin, expiresAt?: string) => {
    if (!panelAccepts(nextAdmin.role)) return; // wrong panel — never store the session
    setSession(token, nextAdmin, expiresAt);
    setAdmin(nextAdmin);
    setLoggedIn(true);
    setBooting(false);
  }, []);

  const logout = useCallback(() => {
    // Tell the server, but drop the local session either way.
    api.auth.logout().catch(() => undefined);
    clearSession();
    setAdmin(null);
    setLoggedIn(false);
    setBranches([]);
  }, []);

  const updateAdmin = useCallback((next: Admin) => {
    setAdmin(next);
    const token = getToken();
    if (token) setSession(token, next);
  }, []);

  // A stored token is only trustworthy once the server confirms it.
  useEffect(() => {
    if (!hasLiveSession()) {
      setBooting(false);
      return;
    }
    let live = true;
    api.auth
      .me()
      .then((me) => {
        if (!live) return;
        if (!panelAccepts(me.role)) {
          // A session from another panel's role does not belong here.
          clearSession();
          setAdmin(null);
          setLoggedIn(false);
          return;
        }
        setAdmin(me);
        setLoggedIn(true);
      })
      .catch(() => {
        if (!live) return;
        clearSession();
        setAdmin(null);
        setLoggedIn(false);
      })
      .finally(() => live && setBooting(false));
    return () => {
      live = false;
    };
  }, []);

  // Any 401 anywhere in the app drops us to the login screen.
  useEffect(
    () =>
      onSessionExpired(() => {
        setAdmin(null);
        setLoggedIn(false);
        setBooting(false);
      }),
    [],
  );

  /* --- branches --- */
  const reloadBranches = useCallback(() => {
    if (!loggedIn) return;
    setBranchesLoading(true);
    api.branches
      // Everything Zenoti has, so the stock pages can reach pharmacy shelves.
      // `clinics` below is what the rest of the panel works from.
      .list({ activeOnly: "false" })
      .then((list) => {
        setBranches(list ?? []);
        setBranchId((current) => {
          // Never leave the panel pointed at a pharmacy or the training centre.
          const clinicIds = new Set((list ?? []).filter((b) => (b.centreType ?? "clinic") === "clinic").map((b) => b._id));
          if (current && clinicIds.has(current)) return current;
          const first = (list ?? []).find((b) => (b.centreType ?? "clinic") === "clinic")?._id ?? (list ?? [])[0]?._id ?? "";
          if (first) localStorage.setItem(BRANCH_KEY, first);
          return first;
        });
      })
      .catch(() => setBranches([]))
      .finally(() => setBranchesLoading(false));
  }, [loggedIn]);

  useEffect(() => {
    reloadBranches();
  }, [reloadBranches]);

  const setBranchById = useCallback((id: string) => {
    setBranchId(id);
    if (id) localStorage.setItem(BRANCH_KEY, id);
    else localStorage.removeItem(BRANCH_KEY);
  }, []);

  const branchName = useMemo(
    () => branches.find((b) => b._id === branchId)?.name ?? (branchId ? "" : "All branches"),
    [branches, branchId],
  );

  /* --- audit --- */
  const audit = useCallback(
    (action: AuditAction, detail = "", extra: Record<string, unknown> = {}) => {
      api.audit
        .record({
          action,
          resource: RESOURCE_FOR(action),
          details: { detail, branch: branchName, ...extra },
        })
        .catch(() => undefined); // never block the action being audited
    },
    [branchName],
  );

  const adminRole = admin?.role ?? null;
  const role: Role = PANEL;

  const isSuperAdmin = adminRole === "super_admin" || admin?.isSuperAdmin === true;
  const permissions = useMemo(
    () => new Set<PermissionKey>(isSuperAdmin ? [] : admin?.permissions ?? []),
    [isSuperAdmin, admin?.permissions],
  );
  const can = useCallback(
    (perm: PermissionKey | PermissionKey[]) => {
      if (isSuperAdmin) return true;
      const list = Array.isArray(perm) ? perm : [perm];
      return list.some((p) => permissions.has(p));
    },
    [isSuperAdmin, permissions],
  );

  const value: Store = {
    role,
    adminRole,
    admin,
    isSuperAdmin,
    permissions,
    can,
    canManageCatalogue: can("services.manage"),
    canManageStaff: can("staff.manage"),
    branch: branchName,
    branchId,
    branches,
    clinics,
    branchesLoading,
    setBranchById,
    reloadBranches,
    toasts,
    toast,
    audit,
    searchOpen,
    setSearchOpen,
    loggedIn,
    booting,
    signIn,
    logout,
    updateAdmin,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useStore = () => useContext(Ctx);
