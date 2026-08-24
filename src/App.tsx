import { Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Banners, LegalEditor, DeletedAccounts, StockLedger } from "./pages/content";
import { StoreProvider } from "./store";
import { Shell, HOME } from "./shell";
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

const page = (el: React.ReactNode) => <Guarded>{el}</Guarded>;

export default function App() {
  return (
    <StoreProvider>
      <Tours />
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to={HOME} replace />} />

          <Route path="/overview" element={page(<Overview />)} />
          <Route path="/today" element={page(<Today />)} />
          <Route path="/bookings" element={page(<Bookings />)} />
          <Route path="/patients" element={page(<Patients />)} />
          <Route path="/patient" element={page(<PatientDetail />)} />
          <Route path="/deleted-accounts" element={page(<DeletedAccounts />)} />
          <Route path="/consultations" element={<Navigate to="/bookings?kind=consultation" replace />} />
          <Route path="/zenoti" element={page(<ClinicData />)} />
          <Route path="/contact-changes" element={page(<ContactChanges />)} />
          <Route path="/chat" element={page(<Chat />)} />
          <Route path="/support" element={page(<SupportInbox />)} />

          <Route path="/services" element={page(<Services />)} />
          <Route path="/service-editor" element={page(<ServiceEditor />)} />
          <Route path="/categories" element={page(<Categories />)} />
          <Route path="/packages" element={page(<Packages />)} />
          <Route path="/doctors" element={page(<Doctors />)} />
          <Route path="/dermatologist" element={page(<DermatologistDetail />)} />
          <Route path="/doctors/schedule" element={page(<AdminDoctorSchedule />)} />
          <Route path="/therapists" element={page(<Therapists />)} />

          <Route path="/products" element={page(<Products />)} />
          <Route path="/brands" element={page(<Brands />)} />
          <Route path="/coupons" element={page(<Coupons />)} />
          <Route path="/orders" element={page(<Orders />)} />

          <Route path="/inventory" element={page(<Inventory />)} />
          <Route path="/stock-ledger" element={page(<StockLedger />)} />
          <Route path="/vendors" element={page(<Vendors />)} />

          <Route path="/studio/home" element={page(<AppHome />)} />
          <Route path="/studio/app-control" element={page(<AppControl />)} />
          <Route path="/studio/banners" element={page(<Banners />)} />
          <Route path="/studio/legal" element={page(<LegalEditor />)} />
          <Route path="/studio/consultation" element={page(<ConsultPage />)} />
          <Route path="/studio/membership" element={page(<MembershipCard />)} />
          <Route path="/studio/announcements" element={page(<Announcements />)} />
          <Route path="/studio/toggles" element={page(<ScreenCopy />)} />

          <Route path="/branches" element={page(<Branches />)} />
          <Route path="/reviews" element={page(<Reviews />)} />
          <Route path="/analytics" element={page(<Analytics />)} />
          <Route path="/roles" element={page(<Roles />)} />
          <Route path="/audit" element={page(<AuditLog />)} />

          <Route path="*" element={<Navigate to={HOME} replace />} />
        </Routes>
      </Shell>
    </StoreProvider>
  );
}
