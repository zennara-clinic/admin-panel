import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, CalendarDays, BookOpenCheck, Users, Stethoscope,
  MessagesSquare, Sparkles, FolderTree, Package, UserCog, ShoppingBag,
  Tags, TicketPercent, Truck, Boxes, Building2, Store, Star, BarChart3, ShieldCheck,
  Smartphone, MessageSquareText, CreditCard, BellRing, ToggleRight,
  ClipboardList, CalendarClock, MapPin, Search, Bell, ChevronDown,
  ScrollText, IdCard, Mic, Pill, Receipt, FlaskConical, LifeBuoy, Loader2, CheckCheck, ArrowRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore, ROLE_LABEL, panelAccepts, wrongPanelMessage, type Role } from "./store";
import { replayTour } from "./tours";
import { Menu } from "./ui";
import api from "./lib/api";
import { useApi, useDebounced, usePoll } from "./lib/useApi";
import { fmtAgo, initials } from "./lib/format";
import type { Admin, PermissionKey } from "./lib/types";
import { ApiError } from "./lib/http";
import logo from "./assets/zennara-logo.png";

// `perm` is the permission that reveals the item — a key, or several ("any of").
// Items a signed-in account lacks are hidden, and a group with no visible items
// disappears. Super admins hold everything, so they see the full menu.
type NavItem = { to: string; label: string; icon: ReactNode; perm?: PermissionKey | PermissionKey[]; badge?: "bookings" | "chat" | "orders" | "lowstock" | "reviews" };
type NavGroup = { g: string; items: NavItem[] };
const ic = "h-[16px] w-[16px]";

const NAV: NavGroup[] = [
  { g: "Home", items: [
    { to: "/overview", label: "Overview", icon: <LayoutDashboard className={ic} />, perm: "overview.view" },
    { to: "/today", label: "Today", icon: <CalendarDays className={ic} />, perm: "today.view" },
  ]},
  { g: "Operations", items: [
    { to: "/bookings", label: "Bookings", icon: <BookOpenCheck className={ic} />, badge: "bookings", perm: "bookings.view" },
    { to: "/patients", label: "Patients", icon: <Users className={ic} />, perm: "patients.view" },
    { to: "/deleted-accounts", label: "Deleted accounts", icon: <UserCog className={ic} />, perm: "patients.delete" },
    { to: "/contact-changes", label: "Contact changes", icon: <UserCog className={ic} />, perm: "contactChanges.view" },
    { to: "/chat", label: "Chat", icon: <MessagesSquare className={ic} />, badge: "chat", perm: "chat.view" },
    { to: "/support", label: "Support inbox", icon: <LifeBuoy className={ic} />, perm: "support.view" },
  ]},
  { g: "Care", items: [
    { to: "/services", label: "Services", icon: <Sparkles className={ic} />, perm: "services.view" },
    { to: "/categories", label: "Categories", icon: <FolderTree className={ic} />, perm: "categories.view" },
    { to: "/packages", label: "Packages", icon: <Package className={ic} />, perm: "packages.view" },
    { to: "/doctors", label: "Dermatologists", icon: <UserCog className={ic} />, perm: "dermatologists.view" },
    { to: "/therapists", label: "Therapists", icon: <Users className={ic} />, perm: "therapists.view" },
    { to: "/forms", label: "Consultation forms", icon: <ClipboardList className={ic} />, perm: "forms.view" },
  ]},
  { g: "Commerce", items: [
    { to: "/products", label: "Products", icon: <ShoppingBag className={ic} />, perm: "products.view" },
    { to: "/brands", label: "Brands & formulations", icon: <Tags className={ic} />, perm: "brands.view" },
    { to: "/coupons", label: "Coupons", icon: <TicketPercent className={ic} />, perm: "coupons.view" },
    { to: "/orders", label: "Orders", icon: <Truck className={ic} />, badge: "orders", perm: "orders.view" },
    { to: "/bulk", label: "Bulk import / export", icon: <FolderTree className={ic} />, perm: ["bulk.import", "bulk.export"] },
  ]},
  { g: "Stock", items: [
    { to: "/inventory", label: "Inventory", icon: <Boxes className={ic} />, badge: "lowstock", perm: "inventory.view" },
    { to: "/stock-ledger", label: "Stock ledger", icon: <ScrollText className={ic} />, perm: "stockLedger.view" },
    { to: "/vendors", label: "Vendors", icon: <Store className={ic} />, perm: "vendors.view" },
    { to: "/purchase-orders", label: "Purchase orders", icon: <ClipboardList className={ic} />, perm: "purchaseOrders.view" },
  ]},
  { g: "App Studio", items: [
    { to: "/studio/home", label: "App home", icon: <Smartphone className={ic} />, perm: "appStudio.view" },
    { to: "/studio/app-control", label: "App control", icon: <Smartphone className={ic} />, perm: "appStudio.view" },
    { to: "/studio/banners", label: "Banners", icon: <Smartphone className={ic} />, perm: "banners.manage" },
    { to: "/studio/consultation", label: "Consultation page", icon: <MessageSquareText className={ic} />, perm: "appStudio.view" },
    { to: "/studio/membership", label: "Membership card", icon: <CreditCard className={ic} />, perm: "appStudio.view" },
    { to: "/studio/announcements", label: "Announcements", icon: <BellRing className={ic} />, perm: "announcements.manage" },
    { to: "/studio/toggles", label: "Screen copy", icon: <ToggleRight className={ic} />, perm: "appStudio.view" },
    { to: "/studio/legal", label: "Terms & privacy", icon: <ScrollText className={ic} />, perm: "appContent.manage" },
  ]},
  { g: "Organisation", items: [
    { to: "/branches", label: "Branches", icon: <Building2 className={ic} />, perm: "branches.view" },
    { to: "/reviews", label: "Reviews", icon: <Star className={ic} />, badge: "reviews", perm: "reviews.view" },
    { to: "/analytics", label: "Analytics", icon: <BarChart3 className={ic} />, perm: "analytics.view" },
    { to: "/roles", label: "Staff & roles", icon: <ShieldCheck className={ic} />, perm: ["staff.view", "roles.view"] },
    { to: "/audit", label: "Audit log", icon: <ScrollText className={ic} />, perm: "audit.view" },
  ]},
];

export const HOME = "/overview";

/** The first nav route the account may open — its landing page after login. */
export function firstAllowedRoute(can: (p: PermissionKey | PermissionKey[]) => boolean): string {
  for (const grp of NAV) for (const it of grp.items) if (!it.perm || can(it.perm)) return it.to;
  return HOME;
}

/* ================= live sidebar badges ================= */
/**
 * Only ask for the counts this account is allowed to see. A badge belongs to a
 * nav item that is already hidden without its permission, so requesting it
 * anyway achieved nothing except a 403 and a PERMISSION_DENIED row in the audit
 * log on every page load.
 */
function useNavBadges(role: Role, branchId: string, can: (p: PermissionKey | PermissionKey[]) => boolean) {
  return useApi(async () => {
    if (role !== "admin") return {} as Record<string, number>;

    const skip = Promise.resolve(undefined);
    const settled = await Promise.allSettled([
      can("bookings.view") ? api.bookings.list({ status: "Awaiting Confirmation", limit: 1 }) : skip,
      can("chat.view") ? api.chat.stats(branchId || undefined) : skip,
      can("orders.view") ? api.orders.stats() : skip,
      can("inventory.view") ? api.analytics.inventory() : skip,
      can("reviews.view") ? api.reviews.products({ isApproved: "false", limit: 1 }) : skip,
    ]);

    const val = <T,>(i: number): T | undefined =>
      settled[i].status === "fulfilled" ? ((settled[i] as PromiseFulfilledResult<T>).value) : undefined;

    const pending = val<{ total?: number; count?: number; data?: unknown[] }>(0);
    const chatStats = val<{ overall?: { totalUnread?: number; activeChats?: number }; byBranch?: { branchId: string; totalUnread: number; activeChats: number }[] }>(1);
    const orderStats = val<{ newOrders?: number; processingOrders?: number; confirmedOrders?: number }>(2);
    const inv = val<{ summary?: { lowStockCount?: number } }>(3);
    const rev = val<{ count?: number; pagination?: { total?: number } }>(4);

    const mine = branchId
      ? (chatStats?.byBranch ?? []).find((b) => String(b.branchId) === branchId)
      : { totalUnread: (chatStats?.byBranch ?? []).reduce((a, b) => a + (b.totalUnread || 0), 0), activeChats: (chatStats?.byBranch ?? []).reduce((a, b) => a + (b.activeChats || 0), 0) };

    return {
      bookings: pending?.total ?? pending?.count ?? pending?.data?.length ?? 0,
      // Unread first; fall back to open threads so the badge still signals work.
      chat: mine?.totalUnread || mine?.activeChats || 0,
      orders: (orderStats?.newOrders ?? 0) + (orderStats?.confirmedOrders ?? 0) + (orderStats?.processingOrders ?? 0),
      lowstock: inv?.summary?.lowStockCount ?? 0,
      reviews: rev?.pagination?.total ?? rev?.count ?? 0,
    } as Record<string, number>;
  }, [role, branchId, can]);
}

/* ================= global search ================= */
function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useStore();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const nav = useNavigate();

  useEffect(() => { if (searchOpen) setQ(""); }, [searchOpen]);

  const { role, can } = useStore();
  const isAdmin = role === "admin";
  const results = useApi(async () => {
    const term = debounced.trim();
    if (!searchOpen || term.length < 2) return { patients: [], services: [], products: [], bookings: [] };

    // Search only the sections this account may open — otherwise it becomes a
    // side door into records the rest of the panel keeps hidden from them.
    const none = Promise.resolve({ data: [] });
    const settled = await Promise.allSettled([
      can("patients.view") ? api.patients.list({ search: term, limit: 4 }) : none,
      can("services.view") ? api.services.list({ search: term, limit: 4, includeInactive: "true" }) : none,
      isAdmin && can("products.view") ? api.products.list({ search: term }) : none,
      isAdmin && can("bookings.view") ? api.bookings.list({ search: term, limit: 5 }) : none,
    ]);
    const ok = <T,>(i: number, fallback: T): T =>
      settled[i].status === "fulfilled" ? ((settled[i] as PromiseFulfilledResult<T>).value) : fallback;

    const users = ok<{ data?: { users?: unknown[] } }>(0, {}).data?.users ?? [];
    const svcs = ok<{ data?: unknown[] }>(1, {}).data ?? [];
    const prods = ok<{ data?: unknown[] }>(2, {}).data ?? [];
    const bks = ok<{ data?: unknown[] }>(3, {}).data ?? [];

    return {
      patients: users.slice(0, 4) as { _id: string; fullName: string; phone: string; location?: string }[],
      services: svcs.slice(0, 4) as { _id: string; name: string; category: string }[],
      products: prods.slice(0, 4) as { _id: string; name: string; code?: string; stock: number }[],
      bookings: bks.slice(0, 5) as { _id: string; fullName: string; referenceNumber?: string; status: string; preferredDate?: string }[],
    };
  }, [debounced, searchOpen]);

  if (!searchOpen) return null;

  const go = (path: string, state?: object) => { setSearchOpen(false); nav(path, { state }); };
  const r = results.data ?? { patients: [], services: [], products: [], bookings: [] };
  const empty = !r.patients.length && !r.services.length && !r.products.length && !r.bookings.length;
  const patientPath = isAdmin ? "/patient" : "/doctor/patient";

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={() => setSearchOpen(false)} />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-(--radius-lg2) bg-surface shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-ink3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients, services, products…"
            className="flex-1 bg-transparent text-[14px] outline-none" />
          {results.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink3" />}
          <kbd className="rounded border border-border bg-ivory px-1.5 font-mono text-[10px] text-ink3">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-auto p-2">
          {q.trim().length < 2 && (
            <div className="px-3 py-6 text-center text-[12.5px] text-ink3">Type at least two characters to search across patients, services and products.</div>
          )}
          {q.trim().length >= 2 && empty && !results.loading && (
            <div className="px-3 py-6 text-center text-[12.5px] text-ink3">Nothing matched “{q}”.</div>
          )}
          {r.patients.length > 0 && <div className="px-3 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Patients</div>}
          {r.patients.map((p) => (
            <button key={p._id} onClick={() => go(patientPath, { id: p._id })}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ivory">
              <b className="font-semibold">{p.fullName}</b> <span className="text-ink3">· {p.phone}{p.location ? ` · ${p.location}` : ""}</span>
            </button>
          ))}
          {r.bookings.length > 0 && <div className="px-3 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Bookings</div>}
          {r.bookings.map((b) => (
            <button key={b._id} onClick={() => go("/bookings", { open: b._id })}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ivory">
              <b className="font-semibold">{b.fullName}</b> <span className="text-ink3">· {b.referenceNumber ?? ""} · {b.status}{b.preferredDate ? ` · ${fmtAgo(b.preferredDate)}` : ""}</span>
            </button>
          ))}
          {r.services.length > 0 && <div className="px-3 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Services</div>}
          {r.services.map((s) => (
            <button key={s._id} onClick={() => isAdmin ? go("/service-editor", { id: s._id }) : go("/doctor/catalogue")}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ivory">
              <b className="font-semibold">{s.name}</b> <span className="text-ink3">· {s.category}</span>
            </button>
          ))}
          {r.products.length > 0 && <div className="px-3 pt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink3">Products</div>}
          {r.products.map((p) => (
            <button key={p._id} onClick={() => go("/products", { id: p._id })}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ivory">
              <b className="font-semibold">{p.name}</b> <span className="text-ink3">{p.code ? `· ${p.code} ` : ""}· stock {p.stock}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= notifications bell ================= */
function NotificationBell() {
  const nav = useNavigate();
  const { toast } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const recent = useApi(() => api.notifications.recent(8), []);
  usePoll(recent.reload, 45000);
  const list = recent.data?.notifications ?? [];
  const unread = recent.data?.unreadCount ?? list.filter((n) => !n.isRead).length;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const open = (id: string, actionUrl?: string) => {
    setMenuOpen(false);
    api.notifications.markRead(id).then(() => recent.reload()).catch(() => undefined);
    if (actionUrl) nav(actionUrl);
  };

  const visual = (type: (typeof list)[number]["type"]) => {
    switch (type) {
      case "booking": return { icon: <CalendarDays className="h-4 w-4" />, tone: "bg-info-bg text-info" };
      case "order": return { icon: <Truck className="h-4 w-4" />, tone: "bg-warn-bg text-warn" };
      case "consultation": return { icon: <Stethoscope className="h-4 w-4" />, tone: "bg-ok-bg text-ok" };
      case "product": return { icon: <ShoppingBag className="h-4 w-4" />, tone: "bg-cream text-primary" };
      case "inventory": return { icon: <Boxes className="h-4 w-4" />, tone: "bg-err-bg text-err" };
      case "promotion": return { icon: <Sparkles className="h-4 w-4" />, tone: "bg-cream text-gold-dark" };
      default: return { icon: <BellRing className="h-4 w-4" />, tone: "bg-sage text-primary" };
    }
  };

  return (
    <div ref={panel} className="relative">
      <button type="button" data-tour="bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}
        className={`relative grid h-8 w-8 place-items-center rounded-full transition-colors ${menuOpen ? "bg-sage text-primary" : "text-ink3 hover:bg-ivory hover:text-ink"}`}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full border-2 border-surface bg-err px-0.5 font-mono text-[8px] font-extrabold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {menuOpen && (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-[94] cursor-default" onClick={() => setMenuOpen(false)} />
          <section role="dialog" aria-label="Recent notifications"
            className="absolute right-0 z-[95] mt-2 w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_55px_rgba(3,47,34,0.18)]">
            <div className="flex items-center justify-between border-b border-border bg-ivory/70 px-4 py-3.5">
              <div>
                <div className="text-[14px] font-extrabold text-ink">Notifications</div>
                <div className="mt-0.5 text-[10.5px] text-ink3">
                  {unread ? `${unread} unread update${unread === 1 ? "" : "s"}` : "You're all caught up"}
                </div>
              </div>
              <button type="button" disabled={!unread} title="Mark all as read"
                onClick={() => {
                  api.notifications.markAllRead().then(() => { recent.reload(); toast("All notifications marked read"); })
                    .catch(() => toast("Could not mark notifications read"));
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold text-primary hover:bg-sage disabled:cursor-default disabled:opacity-40">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {list.map((n) => {
                const meta = visual(n.type);
                return (
                  <button key={n._id} type="button" onClick={() => open(n._id, n.actionUrl)}
                    className={`group relative flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 ${n.isRead ? "bg-surface hover:bg-ivory" : "bg-sage/55 hover:bg-sage"}`}>
                    {!n.isRead && <span className="absolute left-1.5 top-[18px] h-1.5 w-1.5 rounded-full bg-primary" />}
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${meta.tone}`}>{meta.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className={`truncate text-[12.5px] ${n.isRead ? "font-semibold text-ink2" : "font-extrabold text-ink"}`}>{n.title}</span>
                        <span className="shrink-0 pt-0.5 font-mono text-[9.5px] text-ink3">{fmtAgo(n.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-[1.55] text-ink3">{n.message}</span>
                      <span className="mt-1 block font-mono text-[8.5px] font-bold uppercase tracking-[0.09em] text-ink3">{n.type}</span>
                    </span>
                  </button>
                );
              })}
              {!list.length && (
                <div className="grid place-items-center px-5 py-10 text-center">
                  {recent.loading ? <Loader2 className="h-5 w-5 animate-spin text-gold-dark" /> : <Bell className="h-6 w-6 text-ink3" />}
                  <div className="mt-2 text-[12.5px] font-bold text-ink2">{recent.loading ? "Loading updates…" : "No notifications yet"}</div>
                  {!recent.loading && <div className="mt-0.5 text-[10.5px] text-ink3">New clinic activity will appear here.</div>}
                </div>
              )}
            </div>

            <button type="button" onClick={() => { setMenuOpen(false); nav("/studio/announcements"); }}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-ivory px-4 py-3 text-[11.5px] font-bold text-primary hover:bg-sage">
              View all notifications <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </section>
        </>
      )}
    </div>
  );
}

/* ================= shell ================= */
export function Shell({ children }: { children: ReactNode }) {
  const {
    role, admin, adminRole, branch, branchId, branches, setBranchById,
    toast, setSearchOpen, loggedIn, booting, signIn, logout, can,
  } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  const badges = useNavBadges(role, branchId, can);

  // Show only the sections this account may open; hide groups left empty.
  const visibleNav = NAV
    .map((grp) => ({ ...grp, items: grp.items.filter((it) => !it.perm || can(it.perm)) }))
    .filter((grp) => grp.items.length > 0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setSearchOpen]);

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="Zennara" className="h-16 w-auto object-contain opacity-80" />
          <Loader2 className="h-5 w-5 animate-spin text-gold-dark" />
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginPage onSignedIn={(token, me, exp) => { signIn(token, me, exp); nav(HOME); }} />;
  }

  const who = {
    init: initials(admin?.name || admin?.email),
    name: admin?.name || admin?.email || "Signed in",
    role: adminRole ? ROLE_LABEL[adminRole] : "",
  };
  const badgeCounts = badges.data ?? {};

  return (
    <div className="flex min-h-screen items-start">
      <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col bg-side pb-2 pt-3 text-side-ink">
        <div data-tour="logo" className="shrink-0 flex justify-center border-b border-side-2 px-4 pb-2.5 pt-1">
          <img src={logo} alt="Zennara" className="h-16 w-auto object-contain" />
        </div>

        <div data-tour="nav" className="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-color:var(--color-gold-dark)_transparent] [scrollbar-width:thin]">
          {visibleNav.map((grp) => (
            <div key={grp.g}>
              <div className="px-4 pb-0.5 pt-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-side-mut">{grp.g}</div>
              {grp.items.map((it) => {
                const n = it.badge ? badgeCounts[it.badge] : undefined;
                return (
                  <NavLink key={it.to} to={it.to} data-tour={"nav-" + it.to.split("/").filter(Boolean).pop()}
                    className={({ isActive }) =>
                      `mx-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-[5px] text-[12.3px] font-medium transition-colors ${
                        isActive || loc.pathname === it.to
                          ? "bg-side-2 text-white shadow-[inset_2px_0_0_var(--color-gold)]"
                          : "hover:bg-side-2/50 hover:text-white"}`}>
                    <span className="flex items-center gap-2.5">{it.icon}{it.label}</span>
                    {!!n && n > 0 && (
                      <span className="rounded-full bg-gold px-1.5 font-mono text-[10px] font-bold text-primary">{n > 99 ? "99+" : n}</span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-side-2 px-4 pb-0.5 pt-2 text-[11px] leading-tight text-side-mut">
          <div className="mb-0.5 font-bold text-white">{who.name}</div>
          <div>{who.role}{branch ? ` · ${branch}` : ""}</div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-2.5">
          <Menu
            button={
              <button data-tour="branch" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] font-bold hover:bg-ivory">
                {branch || "Select branch"} <ChevronDown className="h-3.5 w-3.5 text-ink3" />
              </button>
            }
            items={
              branches.length
                ? [
                    { label: <span className={!branchId ? "font-bold text-primary" : ""}>All branches</span>,
                      onClick: () => { setBranchById(""); toast("Showing all branches"); } },
                    ...branches.map((b) => ({
                      label: <span className={b._id === branchId ? "font-bold text-primary" : ""}>{b.name}</span>,
                      onClick: () => { setBranchById(b._id); toast(`Switched to ${b.name}`); },
                    })),
                  ]
                : [{ label: <span className="text-ink3">No branches configured</span>, onClick: () => nav("/branches") }]
            }
          />
          <button data-tour="search" onClick={() => setSearchOpen(true)}
            className="mx-auto flex w-full min-w-[160px] max-w-[440px] flex-1 items-center justify-between rounded-(--radius-btn) border border-border bg-ivory px-3 py-1.5 text-[12.5px] text-ink3 hover:border-gold-dark">
            <span className="flex items-center gap-2"><Search className="h-3.5 w-3.5" /> Search patients, bookings, services…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Menu align="right"
              button={
                <button className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-[10.5px] font-bold text-white">
                  {who.init}
                </button>
              }
              items={[
                { label: <span><b>{who.name}</b><br /><span className="text-[11px] text-ink3">{who.role}{branch ? ` · ${branch}` : ""}</span></span> },
                { label: "My profile", onClick: () => nav(role === "doctor" ? "/doctor/profile" : role === "therapist" ? "/floor/schedule" : "/roles") },
                { label: "View tutorial again", onClick: () => { replayTour(); toast("Starting the walkthrough"); } },
                { label: "Sign out", onClick: () => { logout(); toast("Signed out"); } },
              ]}
            />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden bg-bg p-5">{children}</main>
      </div>
      <SearchOverlay />
    </div>
  );
}

/* ================= login ================= */
function LoginPage({ onSignedIn }: { onSignedIn: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");
  const addr = email.trim().toLowerCase();

  const sendOtp = async () => {
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError("Enter a valid email address"); return; }
    setBusy(true); setError(null);
    try { await api.auth.requestOtp(addr); setStep("otp"); setCooldown(30); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(null);
    try { await api.auth.resendOtp(addr); setCooldown(30); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (otp.length !== 6) { setError("The code is 6 digits"); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.auth.verifyOtp(addr, otp);
      if (!panelAccepts(res.admin.role)) { setError(wrongPanelMessage(res.admin.role)); setOtp(""); return; }
      onSignedIn(res.token, res.admin, res.expiresAt);
    } catch (err) { fail(err); setOtp(""); } finally { setBusy(false); }
  };

  // One quiet column on the clinic green: the white logo above a plain card.
  // No carousel, no notice bubbles, no footer copy — the field and the button.
  const field = "w-full rounded-xl border border-border bg-ivory px-4 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3/60 focus:border-primary focus:bg-surface";
  const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[14px] font-bold text-white transition-colors hover:bg-primary-hover disabled:bg-dis-bg disabled:text-dis";

  return (
    <div className="flex min-h-screen items-center justify-center bg-side px-6 py-12">
      <div className="w-full max-w-[380px]">
        <img src={logo} alt="Zennara" className="mx-auto h-20 w-auto object-contain" />
        <div className="mt-8 rounded-3xl bg-surface p-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Admin panel</div>
          <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight text-ink">
            {step === "email" ? "Sign in" : "Enter your code"}
          </h1>
          <p className="mt-1 text-[13px] text-ink3">
            {step === "email" ? "We’ll email you a one-time code." : <>Sent to <span className="font-semibold text-ink2">{addr}</span></>}
          </p>

          <div className="mt-6 grid gap-3">
            {step === "email" ? (
              <>
                <input id="login-email" autoFocus value={email} type="email" autoComplete="email" aria-label="Email"
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && sendOtp()}
                  placeholder="you@zennara.in" className={field} />
                <button onClick={sendOtp} disabled={busy} className={primary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue
                </button>
              </>
            ) : (
              <>
                <input id="login-otp" autoFocus value={otp} inputMode="numeric" maxLength={6} autoComplete="one-time-code" aria-label="6-digit code"
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && verify()}
                  placeholder="······"
                  className={`${field} text-center font-mono text-[24px] font-bold tracking-[0.45em]`} />
                <button onClick={verify} disabled={busy || otp.length !== 6} className={primary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
                </button>
                <div className="flex items-center justify-between pt-1 text-[12.5px]">
                  <button className="font-semibold text-ink3 transition-colors hover:text-ink"
                    onClick={() => { setStep("email"); setOtp(""); setError(null); }}>
                    Use another email
                  </button>
                  <button className="font-semibold text-primary disabled:text-dis" disabled={busy || cooldown > 0} onClick={resend}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
            {error && <p role="alert" className="text-[12.5px] font-semibold text-err">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
