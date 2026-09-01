import { Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Banners, LegalEditor, DeletedAccounts, StockLedger } from "./pages/content";
import { StoreProvider, useStore } from "./store";
import { Shell, firstAllowedRoute } from "./shell";
import type { PermissionKey } from "./lib/types";
import { Tours } from "./tours";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { Overview, Today, Bookings, Patients, PatientDetail, Chat, SupportInbox } from "./pages/reception";
import { Services, ServiceEditor, Categories, Packages, Doctors, DermatologistDetail, Therapists } from "./pages/care";
import { Products, Brands, Coupons, Orders } from "./pages/commerce";
import { Inventory, Vendors } from "./pages/stock";
import { AppHome, ConsultPage, MembershipCard, Announcements, ScreenCopy, AppControl } from "./pages/studio";
import { Branches, Reviews, Analytics, Roles, AuditLog } from "./pages/org";
import { ClinicData } from "./pages/zenoti";
import { ContactChanges } from "./pages/contact-change";
import { Schedule as DermatologistSchedule } from "./pages/availability";

/**
 * Admin-side working-hours editor. The Schedule component takes a `doctorId`
 * and the backend's `canEdit` already lets an admin save anyone's hours — this
 * just gives that an admin route, so the clinic can configure a doctor's slots
 * without needing to sign in as the doctor. Reached from the Doctors page.
 */
function AdminDoctorSchedule() {
  const [params] = useSearchParams();
  const doctorId = params.get("doctorId") ?? "";
  return <DermatologistSchedule doctorId={doctorId} />;
}

/**
 * One boundary per route, keyed on the path so navigating away from a screen
 * that errored clears the error rather than leaving it stuck.
 */
function Guarded({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>;
}

/**
 * Blocks a route the account lacks the permission for — a defence-in-depth
 * layer behind the hidden nav item, so a hand-typed URL can't reach a screen
 * whose data the server would refuse anyway. Super admins pass everything.
 */
function RequirePermission({ perm, children }: { perm?: PermissionKey | PermissionKey[]; children: React.ReactNode }) {
  const { can } = useStore();
  if (perm && !can(perm)) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-8 text-center">
        <div className="max-w-sm">
          <div className="text-[15px] font-bold text-ink">You don't have access to this page</div>
          <div className="mt-1 text-[12.5px] text-ink3">
            Ask a super admin to grant the matching permission on your role, then reload.
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const page = (el: React.ReactNode) => <Guarded>{el}</Guarded>;
/** A guarded, permission-gated route element. */
const gated = (perm: PermissionKey | PermissionKey[], el: React.ReactNode) => (
  <Guarded><RequirePermission perm={perm}>{el}</RequirePermission></Guarded>
);

/** Sends "/" and unknown paths to the first page the account may actually open. */
function Landing() {
  const { can } = useStore();
  return <Navigate to={firstAllowedRoute(can)} replace />;
}

export default function App() {
  return (
    <StoreProvider>
      <Tours />
      <Shell>
        <Routes>
          <Route path="/" element={<Landing />} />

          <Route path="/overview" element={gated("overview.view", <Overview />)} />
          <Route path="/today" element={gated("today.view", <Today />)} />
          <Route path="/bookings" element={gated("bookings.view", <Bookings />)} />
          <Route path="/patients" element={gated("patients.view", <Patients />)} />
          <Route path="/patient" element={gated("patients.view", <PatientDetail />)} />
          <Route path="/deleted-accounts" element={gated("patients.delete", <DeletedAccounts />)} />
          <Route path="/consultations" element={<Navigate to="/bookings?kind=consultation" replace />} />
          <Route path="/zenoti" element={gated("zenoti.view", <ClinicData />)} />
          <Route path="/contact-changes" element={gated("contactChanges.view", <ContactChanges />)} />
          <Route path="/chat" element={gated("chat.view", <Chat />)} />
          <Route path="/support" element={gated("support.view", <SupportInbox />)} />

          <Route path="/services" element={gated("services.view", <Services />)} />
          <Route path="/service-editor" element={gated("services.manage", <ServiceEditor />)} />
          <Route path="/categories" element={gated("categories.view", <Categories />)} />
          <Route path="/packages" element={gated("packages.view", <Packages />)} />
          <Route path="/doctors" element={gated("dermatologists.view", <Doctors />)} />
          <Route path="/dermatologist" element={gated("dermatologists.view", <DermatologistDetail />)} />
          <Route path="/doctors/schedule" element={gated("dermatologists.manage", <AdminDoctorSchedule />)} />
          <Route path="/therapists" element={gated("therapists.view", <Therapists />)} />

          <Route path="/products" element={gated("products.view", <Products />)} />
          <Route path="/brands" element={gated("brands.view", <Brands />)} />
          <Route path="/coupons" element={gated("coupons.view", <Coupons />)} />
          <Route path="/orders" element={gated("orders.view", <Orders />)} />

          <Route path="/inventory" element={gated("inventory.view", <Inventory />)} />
          <Route path="/stock-ledger" element={gated("stockLedger.view", <StockLedger />)} />
          <Route path="/vendors" element={gated("vendors.view", <Vendors />)} />

          <Route path="/studio/home" element={gated("appStudio.view", <AppHome />)} />
          <Route path="/studio/app-control" element={gated("appStudio.view", <AppControl />)} />
          <Route path="/studio/banners" element={gated("banners.manage", <Banners />)} />
          <Route path="/studio/legal" element={gated("appContent.manage", <LegalEditor />)} />
          <Route path="/studio/consultation" element={gated("appStudio.view", <ConsultPage />)} />
          <Route path="/studio/membership" element={gated("appStudio.view", <MembershipCard />)} />
          <Route path="/studio/announcements" element={gated("announcements.manage", <Announcements />)} />
          <Route path="/studio/toggles" element={gated("appStudio.view", <ScreenCopy />)} />

          <Route path="/branches" element={gated("branches.view", <Branches />)} />
          <Route path="/reviews" element={gated("reviews.view", <Reviews />)} />
          <Route path="/analytics" element={gated("analytics.view", <Analytics />)} />
          <Route path="/roles" element={gated(["staff.view", "roles.view"], <Roles />)} />
          <Route path="/audit" element={gated("audit.view", <AuditLog />)} />

          <Route path="*" element={<Landing />} />
        </Routes>
      </Shell>
    </StoreProvider>
  );
}
