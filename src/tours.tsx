/* React Joyride tours — one 5-7 step walkthrough per panel on first login,
   plus short feature tours inside complex modules. */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Joyride, { STATUS, type Step, type CallBackProps } from "react-joyride";
import { useStore } from "./store";
import { api } from "./lib/api";

const styles = {
  options: {
    primaryColor: "#032F22",
    textColor: "#111714",
    backgroundColor: "#FFFFFF",
    arrowColor: "#FFFFFF",
    overlayColor: "rgba(3, 47, 34, 0.45)",
    zIndex: 200,
  },
  tooltip: { borderRadius: 16, fontFamily: "inherit", fontSize: 13.5, padding: 18 },
  buttonNext: { borderRadius: 10, fontWeight: 700, padding: "8px 16px" },
  buttonBack: { color: "#4F5853" },
};

const T = (target: string, title: string, content: string, placement?: Step["placement"]): Step =>
  ({ target, title, content, placement: placement ?? "auto", disableBeacon: true });
const C = (title: string, content: string): Step =>
  ({ target: "body", title, content, placement: "center", disableBeacon: true });

/* ---- panel walkthroughs (5–7 steps each) ---- */
const PANEL_TOURS: Record<string, Step[]> = {
  admin: [
    C("Welcome to Zennara", "This is your clinic's control room — bookings, guests, services, stock and the app, all from here."),
    T("[data-tour=nav]", "Everything lives in the sidebar", "Operations for the front desk, Care for services & dermatologists, Commerce for retail, Stock, App Studio to control the mobile app, and Organisation."),
    T("[data-tour=search]", "Search anything, from anywhere", "Press ⌘K any time — guests, treatments and products all come up in one box."),
    T("[data-tour=branch]", "You're viewing one centre", "Switch centres here — the list comes from your Branches page, and every screen follows the centre you pick."),
    T("[data-tour=bell]", "The bell tells you what needs you", "Unconfirmed bookings, low stock, unanswered reviews — click any alert to jump straight there."),
    T("[data-tour=nav-today]", "Start your day in Today", "The appointment book: confirm a booking, check the guest in, add walk-ins. Reception lives on this screen."),
    T("[data-tour=nav-audit]", "Everything is on the record", "Every change anyone makes — with name, time and IP — lands in the Audit log. Full transparency."),
  ],
};

/* ---- feature tours inside complex modules (3–4 steps) ---- */
const MODULE_TOURS: Record<string, { key: string; steps: Step[] }> = {
  "/inventory": {
    key: "m-inventory",
    steps: [
      T("[data-tour=inv-tabs]", "Four ways to look at stock", "All stock, low stock, expiring soon and re-order due — straight from the inventory the clinic keeps."),
      T("[data-tour=inv-table]", "Batch and expiry up front", "For injectables the batch column is the whole point — a recall question must be answerable at a glance."),
    ],
  },
  "/products": {
    key: "m-pharmacy",
    steps: [
      T("[data-tour=prod-tabs]", "The full catalogue", "The full retail catalogue with codes, formulation and GST. These categories mirror the app exactly."),
      T("[data-tour=prod-filters]", "Low stock before ordering day", "Filter to low stock, export the CSV, and that's your purchase list."),
      T("[data-tour=prod-table]", "Click to edit", "Any row opens on the right — name, price, stock, photo — and saves straight to the catalogue."),
    ],
  },
};

/**
 * A tour is "seen" when the account has completed it — the list lives on the
 * Admin record (`toursSeen`), not in localStorage, so switching browser or
 * clearing site data no longer replays the first-login walkthrough. The local
 * key is still written as a same-session cache so a slow /me round-trip can't
 * flash the tour a second time.
 */
const REPLAY_EVENT = "zennara:replay-tour";

/** Ask the Tours component to run the panel walkthrough again. */
export function replayTour() {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

export function Tours() {
  const { role, loggedIn, admin } = useStore();
  const loc = useLocation();
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tourKey, setTourKey] = useState("");
  const seen = (key: string) =>
    (admin?.toursSeen ?? []).includes(key) || Boolean(localStorage.getItem(key));

  // "View tutorial again" from the profile menu.
  useEffect(() => {
    const onReplay = () => {
      const panelKey = `tour-${role}`;
      localStorage.removeItem(panelKey);
      api.auth.resetTours().catch(() => undefined);
      setSteps(PANEL_TOURS[role] ?? []);
      setTourKey(panelKey);
      setRun(true);
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [role]);

  useEffect(() => {
    if (!loggedIn) { setRun(false); return; }
    const panelKey = `tour-${role}`;
    if (!seen(panelKey)) {
      setSteps(PANEL_TOURS[role] ?? []); setTourKey(panelKey);
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
    const mod = MODULE_TOURS[loc.pathname];
    // The consultation tour points at the open-consult screen, not the guest picker.
    const consultWithoutGuest = loc.pathname === "/doctor/consultation" && !(loc.state as { bookingId?: string } | null)?.bookingId;
    if (mod && !consultWithoutGuest && !seen(mod.key)) {
      setSteps(mod.steps); setTourKey(mod.key);
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
    setRun(false);
  }, [role, loggedIn, loc.pathname, admin?.toursSeen]);

  const cb = (data: CallBackProps) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      if (tourKey) {
        localStorage.setItem(tourKey, "1");
        // Persist against the account so this never replays on another device.
        api.auth.markTourSeen(tourKey).catch(() => undefined);
      }
      setRun(false);
    }
  };

  return (
    <Joyride
      steps={steps} run={run} callback={cb}
      continuous showSkipButton showProgress
      disableScrolling={false}
      locale={{ back: "Back", close: "Close", last: "Done", next: "Next", skip: "Skip tour" }}
      styles={styles}
    />
  );
}
