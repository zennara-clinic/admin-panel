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
import { Menu } from "./ui";
import api from "./lib/api";
import { useApi, useDebounced, usePoll } from "./lib/useApi";
import { fmtAgo, initials } from "./lib/format";
import type { Admin } from "./lib/types";
import { ApiError } from "./lib/http";
import logo from "./assets/zennara-logo.png";

type NavItem = { to: string; label: string; icon: ReactNode; badge?: "bookings" | "chat" | "orders" | "lowstock" | "reviews" };
type NavGroup = { g: string; items: NavItem[] };
const ic = "h-[16px] w-[16px]";

const NAV: NavGroup[] = [
  { g: "Home", items: [
    { to: "/overview", label: "Overview", icon: <LayoutDashboard className={ic} /> },
    { to: "/today", label: "Today", icon: <CalendarDays className={ic} /> },
  ]},
  { g: "Operations", items: [
    { to: "/bookings", label: "Bookings", icon: <BookOpenCheck className={ic} />, badge: "bookings" },
    { to: "/patients", label: "Patients", icon: <Users className={ic} /> },
    { to: "/deleted-accounts", label: "Deleted accounts", icon: <UserCog className={ic} /> },
    { to: "/contact-changes", label: "Contact changes", icon: <UserCog className={ic} /> },
    { to: "/chat", label: "Chat", icon: <MessagesSquare className={ic} />, badge: "chat" },
    { to: "/support", label: "Support inbox", icon: <LifeBuoy className={ic} /> },
  ]},
  { g: "Care", items: [
    { to: "/services", label: "Services", icon: <Sparkles className={ic} /> },
    { to: "/categories", label: "Categories", icon: <FolderTree className={ic} /> },
    { to: "/packages", label: "Packages", icon: <Package className={ic} /> },
    { to: "/doctors", label: "Dermatologists", icon: <UserCog className={ic} /> },
    { to: "/therapists", label: "Therapists", icon: <Users className={ic} /> },
  ]},
  { g: "Commerce", items: [
    { to: "/products", label: "Products", icon: <ShoppingBag className={ic} /> },
    { to: "/brands", label: "Brands & formulations", icon: <Tags className={ic} /> },
    { to: "/coupons", label: "Coupons", icon: <TicketPercent className={ic} /> },
    { to: "/orders", label: "Orders", icon: <Truck className={ic} />, badge: "orders" },
  ]},
  { g: "Stock", items: [
    { to: "/inventory", label: "Inventory", icon: <Boxes className={ic} />, badge: "lowstock" },
    { to: "/stock-ledger", label: "Stock ledger", icon: <ScrollText className={ic} /> },
    { to: "/vendors", label: "Vendors", icon: <Store className={ic} /> },
  ]},
  { g: "App Studio", items: [
    { to: "/studio/home", label: "App home", icon: <Smartphone className={ic} /> },
    { to: "/studio/app-control", label: "App control", icon: <Smartphone className={ic} /> },
    { to: "/studio/banners", label: "Banners", icon: <Smartphone className={ic} /> },
    { to: "/studio/consultation", label: "Consultation page", icon: <MessageSquareText className={ic} /> },
    { to: "/studio/membership", label: "Membership card", icon: <CreditCard className={ic} /> },
    { to: "/studio/announcements", label: "Announcements", icon: <BellRing className={ic} /> },
    { to: "/studio/toggles", label: "Screen copy", icon: <ToggleRight className={ic} /> },
    { to: "/studio/legal", label: "Terms & privacy", icon: <ScrollText className={ic} /> },
  ]},
  { g: "Organisation", items: [
    { to: "/branches", label: "Branches", icon: <Building2 className={ic} /> },
    { to: "/reviews", label: "Reviews", icon: <Star className={ic} />, badge: "reviews" },
    { to: "/analytics", label: "Analytics", icon: <BarChart3 className={ic} /> },
    { to: "/roles", label: "Staff & roles", icon: <ShieldCheck className={ic} /> },
    { to: "/audit", label: "Audit log", icon: <ScrollText className={ic} /> },
  ]},
];

export const HOME = "/overview";

/* ================= live sidebar badges ================= */
function useNavBadges(role: Role, branchId: string) {
  return useApi(async () => {
    if (role !== "admin") return {} as Record<string, number>;

    const settled = await Promise.allSettled([
      api.bookings.list({ status: "Awaiting Confirmation", limit: 1 }),
      api.chat.stats(branchId || undefined),
      api.orders.stats(),
      api.analytics.inventory(),
      api.reviews.products({ isApproved: "false", limit: 1 }),
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
  }, [role, branchId]);
}

/* ================= global search ================= */
function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useStore();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const nav = useNavigate();

  useEffect(() => { if (searchOpen) setQ(""); }, [searchOpen]);

  const { role } = useStore();
  const isAdmin = role === "admin";
  const results = useApi(async () => {
    const term = debounced.trim();
    if (!searchOpen || term.length < 2) return { patients: [], services: [], products: [], bookings: [] };

    const settled = await Promise.allSettled([
      api.patients.list({ search: term, limit: 4 }),
      api.services.list({ search: term, limit: 4, includeInactive: "true" }),
      isAdmin ? api.products.list({ search: term }) : Promise.resolve({ data: [] }),
      isAdmin ? api.bookings.list({ search: term, limit: 5 }) : Promise.resolve({ data: [] }),
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
    toast, setSearchOpen, loggedIn, booting, signIn, logout,
  } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  const badges = useNavBadges(role, branchId);

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
          {NAV.map((grp) => (
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
const LICONS: Record<string, ReactNode> = {
  cal: <CalendarDays className="h-8 w-8 text-gold" />, app: <Smartphone className="h-8 w-8 text-gold" />,
  stock: <Boxes className="h-8 w-8 text-gold" />, stet: <Stethoscope className="h-8 w-8 text-gold" />,
  mic: <Mic className="h-8 w-8 text-gold" />, rx: <Pill className="h-8 w-8 text-gold" />,
  spa: <Sparkles className="h-8 w-8 text-gold" />, bottle: <FlaskConical className="h-8 w-8 text-gold" />,
  bill: <Receipt className="h-8 w-8 text-gold" />,
};

const SLIDES = [
  { icon: "cal", title: "A front desk that runs itself", lines: ["Live appointment book for every centre", "OTP check-in for every guest", "Walk-ins booked in three steps"] },
  { icon: "app", title: "Your app, controlled from here", lines: ["Banners, copy and cards — no app release", "Consultation catalogue and pricing", "Every change audited with a name"] },
  { icon: "stock", title: "Stock that watches itself", lines: ["Live on-hand across every centre", "Re-order and expiry alerts", "Vendor and batch costs in one place"] },
  { icon: "stet", title: "The consult room, on one screen", lines: ["Full guest history the moment you open", "Allergy flags where they matter", "Pre-consult forms already filled in"] },
];

/**
 * Sign-in is the backend's admin OTP flow: the address is checked against the
 * server's allow-list, a 6-digit code is emailed, and verifying it returns the
 * bearer token. Which panel you land on comes from your account's role.
 */
function LoginPage({ onSignedIn }: { onSignedIn: (token: string, admin: Admin, expiresAt?: string) => void }) {
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState<"email" | "otp">("email");
  const [mode, setMode] = useState<"code" | "password">("code");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSlide((x) => (x + 1) % SLIDES.length), 4200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");

  const loginWithPassword = async () => {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError("Enter a valid email address"); return; }
    if (!password) { setError("Enter your password"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.auth.loginPassword(addr, password);
      if (!panelAccepts(r.admin.role)) { setError(wrongPanelMessage(r.admin.role)); return; }
      onSignedIn(r.token, r.admin, r.expiresAt);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const sendOtp = async () => {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError("Enter a valid email address"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.auth.requestOtp(addr);
      setStep("otp");
      setCooldown(30);
      setNotice(`We emailed a 6-digit code to ${addr}.`);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(null);
    try {
      await api.auth.resendOtp(email.trim().toLowerCase());
      setCooldown(30);
      setNotice("A new code is on its way.");
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (otp.length !== 6) { setError("The code is 6 digits"); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.auth.verifyOtp(email.trim().toLowerCase(), otp);
      if (!panelAccepts(res.admin.role)) { setError(wrongPanelMessage(res.admin.role)); setOtp(""); return; }
      onSignedIn(res.token, res.admin, res.expiresAt);
    } catch (err) { fail(err); setOtp(""); } finally { setBusy(false); }
  };

  const sl = SLIDES[slide];

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-side p-10 md:flex">
        <img src={logo} alt="Zennara" className="h-28 w-auto self-start object-contain" />
        <div className="relative">
          <div className="overflow-hidden">
            <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${slide * 100}%)` }}>
              {SLIDES.map((s) => (
                <div key={s.title} className="w-full shrink-0 pr-6">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-side-2">{LICONS[s.icon]}</div>
                  <h2 className="mt-5 max-w-[420px] text-[30px] font-extrabold leading-tight text-white">{s.title}</h2>
                  <div className="mt-4 grid gap-2.5">
                    {s.lines.map((l) => (
                      <div key={l} className="flex items-center gap-2.5 text-[14.5px] text-side-ink">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold text-[10px] font-extrabold text-primary">✓</span>{l}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 flex gap-2">
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)} aria-label={`Slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === slide ? "w-7 bg-gold" : "w-2.5 bg-side-2 hover:bg-side-mut"}`} />
            ))}
          </div>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.2em] text-gold">Skin · Aesthetics · Wellness</div>
      </div>

      <div className="flex flex-col items-center justify-center bg-bg p-8">
        <div className="w-full max-w-[400px]">
          <div className="mx-auto mb-4 grid w-fit place-items-center rounded-2xl bg-side px-6 py-4 md:hidden">
            <img src={logo} alt="Zennara" className="h-24 w-auto object-contain" />
          </div>
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-side">
              <LayoutDashboard className="h-6 w-6 text-gold" />
            </span>
            <div>
              <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">Zennara Admin</h1>
              <div className="text-[12.5px] text-ink3">
                {step === "email" ? (mode === "password" ? "Sign in with your email and password" : "Sign in with your Zennara email") : "Enter the code we emailed you"}
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-[0_4px_16px_rgba(3,47,34,0.05)]">
            {step === "email" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-ink2" htmlFor="login-email">Email</label>
                  <input id="login-email" autoFocus value={email} type="email" autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && sendOtp()}
                    placeholder="you@zennara.in"
                    className="rounded-lg border border-border bg-ivory px-3 py-2.5 text-[13.5px] outline-none focus:border-gold-dark" />
                </div>
                {mode === "password" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-ink2" htmlFor="login-password">Password</label>
                    <input id="login-password" value={password} type="password" autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && loginWithPassword()}
                      placeholder="••••••••"
                      className="rounded-lg border border-border bg-ivory px-3 py-2.5 text-[13.5px] outline-none focus:border-gold-dark" />
                  </div>
                )}
                <button onClick={mode === "password" ? loginWithPassword : sendOtp} disabled={busy}
                  className="mt-1 flex items-center justify-center gap-2 rounded-(--radius-btn) bg-primary py-3 text-[14px] font-bold text-white transition-colors hover:bg-primary-hover disabled:bg-dis-bg disabled:text-dis">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} {mode === "password" ? "Sign in" : "Send code"}
                </button>
                <button onClick={() => { setMode(mode === "password" ? "code" : "password"); setError(null); }} className="text-center text-[12px] text-ink3 hover:text-primary">
                  {mode === "password" ? "Use an emailed code instead" : "Have a password? Sign in with it"}
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-ink2" htmlFor="login-otp">6-digit code</label>
                  <input id="login-otp" autoFocus value={otp} inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && verify()}
                    placeholder="••••••"
                    className="rounded-xl border-2 border-border bg-ivory px-4 py-3 text-center font-mono text-[22px] font-bold tracking-[0.5em] outline-none focus:border-gold-dark" />
                </div>
                <button onClick={verify} disabled={busy || otp.length !== 6}
                  className="mt-1 flex items-center justify-center gap-2 rounded-(--radius-btn) bg-primary py-3 text-[14px] font-bold text-white transition-colors hover:bg-primary-hover disabled:bg-dis-bg disabled:text-dis">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify &amp; sign in
                </button>
                <div className="flex items-center justify-between text-[12px]">
                  <button className="font-semibold text-ink3 hover:text-ink"
                    onClick={() => { setStep("email"); setOtp(""); setError(null); setNotice(null); }}>
                    ← Change email
                  </button>
                  <button className="font-semibold text-primary disabled:text-dis" disabled={busy || cooldown > 0} onClick={resend}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}

            {notice && !error && <div className="rounded-lg bg-ok-bg px-3 py-2 text-[12px] text-ok">{notice}</div>}
            {error && <div className="rounded-lg bg-err-bg px-3 py-2 text-[12px] font-semibold text-err">{error}</div>}
          </div>

          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink3">
            Access is limited to addresses the clinic has authorised.<br />
            This panel is for clinic super-admin accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
