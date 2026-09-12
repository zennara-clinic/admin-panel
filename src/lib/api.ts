/**
 * Every backend call the unified panel makes, grouped by module.
 *
 * Paths are relative to `/api`. Anything returning `{ success, data }` is
 * unwrapped by `request`; endpoints that also carry `stats`/`count`/
 * `pagination` use `requestRaw` and return the whole envelope.
 */
import { request, requestRaw, type Envelope, type Query } from "./http";
import type {
  Admin, AppCustomization, AuditEntry, Banner, Booking, BookingSession, Branch, Brand, Category, Chat, ChatMessage, DeletedAccount, StockMovement,
  Consultation, ConsultationStage, ConsentForm, ConsultationNote, ConsultationReview, Coupon, DermatologistSchedule,
  Doctor, DoctorAvailability, WeeklyBlock,
  DoctorFeeRequest, Formulation, MyFee, ScheduleDay, SlotDay,
  Id, Inventory, Notification, Package, PackageAssignment, PreConsultForm, IntakeDetail, PreConsultSchema, Product, ProductOrder,
  BulkPreview, BulkResult, FormTemplate, FormSubmissionRow, PatientPhoto, ProductAvailability,
  PurchaseOrder, PurchaseOrderStatus, ProductReview, ServiceCard, ServiceReview, ServiceType, SupportMessage, TaxonomyTree, User, Vendor,
  Role, PermissionGroup, PermissionKey,
  StaffAssignment,
  DayBook,
  GuestStats,
  Invoice, InvoiceLine, GuestPackageBalance, PaymentMethod,
  AssignmentLedger, Membership, MembershipAssignment, GuestMembership,
  CurrentStockRow, StockSummary, StockCount, StockTransfer, StockValuation, StockImportResult,
  MessageTemplate, StaffSalesRow, InvoiceSummary, AppStockImportResult, ProductStockMovement,
  LifecycleAction, LifecycleState,
} from "./types";

/* ============================ auth ============================ */
export const auth = {
  /** Is this address a panel account, and does it have a password set? */
  checkEmail: (email: string) =>
    request<{ isAuthorized: boolean; hasPassword: boolean; methods: ("password" | "otp")[]; role?: string | null }>("/admin/auth/check-email", {
      method: "POST", body: { email }, anonymous: true,
    }),
  /** Email + password, for accounts an administrator has given a password. */
  loginPassword: (email: string, password: string) =>
    request<{ token: string; admin: Admin; expiresAt: string }>("/admin/auth/login-password", {
      method: "POST", body: { email, password }, anonymous: true,
    }),
  /** Pick or change my own password. Returns a fresh session (the old ones end). */
  changePassword: (body: { currentPassword?: string; newPassword: string }) =>
    request<{ token: string; admin: Admin; expiresAt: string }>("/admin/auth/me/password", { method: "PUT", body }),
  requestOtp: (email: string) =>
    requestRaw("/admin/auth/login", { method: "POST", body: { email }, anonymous: true }),
  resendOtp: (email: string) =>
    requestRaw("/admin/auth/resend-otp", { method: "POST", body: { email }, anonymous: true }),
  verifyOtp: (email: string, otp: string) =>
    request<{ token: string; admin: Admin; expiresAt: string }>("/admin/auth/verify-otp", {
      method: "POST", body: { email, otp }, anonymous: true,
    }),
  me: () => request<Admin>("/admin/auth/me"),
  /** Self-service profile: name, phone, photo. Returns the refreshed account. */
  updateMe: (body: { name?: string; phone?: string | null; photo?: string | null }) =>
    request<Admin>("/admin/auth/me", { method: "PUT", body }),
  logout: () => requestRaw("/admin/auth/logout", { method: "POST" }),
  /** End every session for this account, on every device. */
  logoutEverywhere: () => requestRaw("/admin/auth/me/logout-all", { method: "POST" }),
  /** Remember that this account finished a walkthrough. */
  markTourSeen: (key: string) =>
    requestRaw("/admin/auth/me/tours", { method: "PUT", body: { key } }),
  /** "View tutorial again" — omit `key` to replay every tour. */
  resetTours: (key?: string) =>
    requestRaw(`/admin/auth/me/tours${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE" }),
};

/* ============================ branches ============================ */
export const branches = {
  list: (q?: Query) => request<Branch[]>("/branches", { query: q }),
  get: (id: Id) => request<Branch>(`/branches/${id}`),
  slots: (id: Id, date: string) =>
    request<{ slots: string[]; branch?: string; date?: string }>(`/branches/${id}/slots`, { query: { date } }),
  create: (body: Partial<Branch>) => request<Branch>("/branches", { method: "POST", body }),
  update: (id: Id, body: Partial<Branch>) => request<Branch>(`/branches/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Branch>(`/branches/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id, permanent = false) =>
    requestRaw(`/branches/${id}`, { method: "DELETE", query: { permanent } }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/branches/reorder", { method: "PATCH", body: { branches: order } }),
};

/* ============================ patients (users) ============================ */
export type UserListEnvelope = Envelope<{
  users: User[];
  pagination: { currentPage: number; totalPages: number; totalUsers: number };
  statistics: { totalPatients: number; activePatients: number; [k: string]: number };
}>;

export const patients = {
  /**
   * `q` goes straight to the query string, so every filter the list drawer
   * knows — including `intake=digital|paper|none` — passes through untouched.
   */
  list: (q?: Query) =>
    requestRaw<{
      users: User[];
      pagination: { currentPage: number; totalPages: number; totalUsers: number };
      statistics: Record<string, number>;
    }>("/admin/users", { query: q }),
  get: (id: Id) => request<User>(`/admin/users/${id}`),
  create: (body: Partial<User>) => request<User>("/admin/users", { method: "POST", body }),
  update: (id: Id, body: Partial<User> | FormData) =>
    request<User>(`/admin/users/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/users/${id}`, { method: "DELETE" }),
  toggleStatus: (id: Id, isActive?: boolean) =>
    request<User>(`/admin/users/${id}/status`, { method: "PATCH", body: isActive === undefined ? {} : { isActive } }),
  /** Deleted accounts — restorable archive (see DeletedAccountArchive). */
  deleted: (q?: Query) => requestRaw<DeletedAccount[]>("/admin/users/deleted", { query: q }),
  restore: (archiveId: Id) =>
    request<{ userId: Id }>(`/admin/users/deleted/${archiveId}/restore`, { method: "POST", body: {} }),
  /** Grant/extend a Zen membership from the desk. Months + payment method + amount are required server-side. */
  assignMembership: (id: Id, body: { months: number; paymentMethod: string; amount?: number; paymentReceived?: boolean; startDate?: string; autoRenew?: boolean; plan?: string; notes?: string; transactionId?: string }) =>
    request<User>(`/admin/users/${id}/membership`, { method: "POST", body }),
  cancelMembership: (id: Id) => request<User>(`/admin/users/${id}/membership`, { method: "DELETE" }),
  markMembershipPaid: (id: Id, body?: { paymentMethod?: string; transactionId?: string; amount?: number }) => request<unknown>(`/admin/users/${id}/membership/paid`, { method: "POST", body }),
};

/* ============================ bookings ============================ */
export type NewBooking = {
  consultationId: Id;
  fullName: string;
  mobileNumber: string;
  email?: string;
  preferredLocation: string;
  preferredDate: string;
  preferredTimeSlots: string[];
  specialistId?: string;
  specialistName?: string;
  specialistTier?: string;
  amount?: number;
  paymentStatus?: string;
  notes?: string;
  confirmNow?: boolean;
  userId?: Id;
  gender?: string;
  dateOfBirth?: string;
  /** One visit, several services — each becomes its own booking sharing a visitGroupId. */
  services?: { consultationId: Id; specialistId?: string | null; specialistName?: string | null; specialistTier?: string | null; time: string; amount?: number | null; packageAssignmentId?: Id | null; packageSessionId?: Id | null }[];
  /** The desk saw "not working at this time" and chose Yes. */
  force?: boolean;
  referralSource?: string | null;
  referredByUserId?: Id | null;
  packageAssignmentId?: Id | null;
  packageSessionId?: Id | null;
};

/** Thrown shape when the server asks the desk to confirm an off-shift booking. */
export type BookingWarning = { code: "PROVIDER_NOT_WORKING" | "DERMATOLOGIST_SLOT_UNAVAILABLE"; reason?: string; message: string };

export type DermPick = { specialistId?: string; specialistName?: string };

export const bookings = {
  /** Move the consultation through its clinical lifecycle; never touches `status`. */
  setStage: (id: Id, body: { stage?: ConsultationStage | null; followUp?: { required?: boolean; dueDate?: string | null; notes?: string } }) =>
    request<{ _id: Id; consultationStage: ConsultationStage | null; followUp?: Booking["followUp"] }>(`/bookings/admin/${id}/stage`, { method: "PATCH", body }),
  /**
   * Run one desk action on an appointment: check_in, undo_check_in, start,
   * undo_start, complete, undo_complete, no_show, undo_no_show, cancel,
   * undo_cancel, confirm.
   *
   * The server owns which actions are legal from the current status, the
   * check-in time window, and the Zenoti call each one makes — the panel only
   * names the action. Send `force` with a `reason` to check a guest in before
   * the window opens; the override is recorded on the booking.
   */
  lifecycle: (id: Id, body: { action: LifecycleAction; reason?: string; force?: boolean; session?: BookingSession; notes?: string } & Partial<DermPick>) =>
    request<Booking>(`/bookings/admin/${id}/lifecycle`, { method: "POST", body }),
  /** What this appointment can do right now, plus its full status history. */
  lifecycleState: (id: Id) => request<LifecycleState>(`/bookings/admin/${id}/lifecycle`),
  /** Put a dermatologist on the booking — roster id or a custom name. */
  setDermatologist: (id: Id, derm: DermPick) => request<Booking>(`/bookings/admin/${id}/dermatologist`, { method: "PUT", body: derm }),
  /** Assign (or clear) the therapist who will run this session. */
  setTherapist: (id: Id, body: { therapistAdminId?: Id; clear?: boolean }) =>
    request<Booking>(`/bookings/admin/${id}/therapist`, { method: "PUT", body }),
  /**
   * Admin day-book / list. Filters: status, location|branchId, date (YYYY-MM-DD),
   * startDate/endDate, search, userId, specialistId, therapistId, page/limit.
   * The envelope carries `total` and `statusCounts` for the tab badges.
   */
  list: (q?: Query) =>
    requestRaw<Booking[]>("/bookings/admin/all", { query: q }) as Promise<
      Envelope<Booking[]> & {
        total?: number;
        statusCounts?: Record<string, number>;
        /** Sent only when `dueOnly` was asked for: the money behind this filter. */
        totals?: { dueCount: number; due: number };
      }
    >,
  get: (id: Id) => request<Booking>(`/bookings/admin/${id}`),
  /** Re-read this booking's appointment from Zenoti now (read-only towards Zenoti). */
  zenotiRefresh: (id: Id) => request<Booking>(`/bookings/admin/${id}/zenoti-refresh`, { method: "POST" }),
  /** Create the appointment in Zenoti (or write the desk state) now. */
  zenotiPush: (id: Id) => request<Booking>(`/bookings/admin/${id}/zenoti-push`, { method: "POST" }),
  create: (body: NewBooking) => request<Booking>("/bookings/admin", { method: "POST", body }),
  reschedule: (id: Id, body: { preferredDate: string; confirmedTime?: string; preferredTimeSlots?: string[]; reason?: string }) =>
    request<Booking>(`/bookings/admin/${id}/reschedule`, { method: "PUT", body }),
  /** Decline a guest's reschedule request → reverts to their original slot. */
  rejectReschedule: (id: Id) =>
    request<Booking>(`/bookings/admin/${id}/reject-reschedule`, { method: "PUT", body: {} }),
  confirm: (id: Id, body?: { confirmedDate?: string; confirmedTime?: string; adminNotes?: string }) =>
    request<Booking>(`/bookings/admin/${id}/confirm`, { method: "PUT", body: body ?? {} }),
  /** The guest has arrived. Blocked before the check-in window unless forced. */
  checkIn: (id: Id, body?: { reason?: string; force?: boolean } & Partial<DermPick>) =>
    request<Booking>(`/bookings/admin/${id}/lifecycle`, { method: "POST", body: { action: "check_in", ...(body ?? {}) } }),
  /** Close the service — Zenoti's "completed", the desk's "check out". */
  complete: (id: Id, body?: { notes?: string; session?: BookingSession }) =>
    request<Booking>(`/bookings/admin/${id}/lifecycle`, { method: "POST", body: { action: "complete", ...(body ?? {}) } }),
  noShow: (id: Id, body?: { adminNotes?: string }) =>
    request<Booking>(`/bookings/admin/${id}/no-show`, { method: "PUT", body: body ?? {} }),
  cancel: (id: Id, reason: string) =>
    request<Booking>(`/bookings/admin/${id}/cancel`, { method: "PUT", body: { reason } }),
  /** Desk payment — cash/card/UPI/package; `amount` overrides what the booking carries. */
  setPayment: (id: Id, body: { paymentStatus?: "pending" | "paid" | "failed" | "refunded"; paymentMethod?: string; amount?: number; note?: string }) =>
    request<Booking>(`/bookings/admin/${id}/payment`, { method: "PUT", body }),
  addNote: (id: Id, note: string) =>
    request<Booking>(`/bookings/admin/${id}/notes`, { method: "PUT", body: { note } }),
  /** Step the last desk status change back (undo check-in / check-out / no-show / cancel). */
  undo: (id: Id, reason?: string) =>
    request<Booking>(`/bookings/admin/${id}/undo`, { method: "POST", body: { reason } }),
  availableSlots: (q: Query) => request<{ slots?: string[]; availableSlots?: string[] }>("/bookings/available-slots", { query: q }),
  cleanupExpired: () => requestRaw("/bookings/admin/cleanup-expired", { method: "POST" }),
};

/* ============================ services (consultations) ============================ */
export const services = {
  list: (q?: Query) => requestRaw<Consultation[]>("/consultations", { query: q }),
  get: (idOrSlug: string) => request<Consultation>(`/consultations/${idOrSlug}`),
  featured: (limit = 6) => request<Consultation[]>("/consultations/featured", { query: { limit } }),
  categories: () => request<string[] | Category[]>("/consultations/categories/list"),
  byCategory: (category: string, limit = 50) =>
    request<Consultation[]>(`/consultations/category/${encodeURIComponent(category)}`, { query: { limit } }),
  search: (query: string, limit = 20) =>
    request<Consultation[]>(`/consultations/search/${encodeURIComponent(query)}`, { query: { limit } }),
  stats: () => request<Record<string, unknown>>("/consultations/stats/overview"),
  /** Publish services to the app catalogue, or take them back off. */
  setCatalog: (ids: Id[], inCatalog: boolean) =>
    requestRaw<{ count: number }>("/consultations/catalog", { method: "PATCH", body: { ids, inCatalog } }),
  create: (body: Partial<Consultation>) => request<Consultation>("/consultations", { method: "POST", body }),
  update: (id: Id, body: Partial<Consultation>) =>
    request<Consultation>(`/consultations/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/consultations/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Consultation>(`/consultations/${id}/toggle`, { method: "PATCH" }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/consultations/reorder", { method: "PATCH", body: { order } }),
};

/* ============================ service types ============================ */
export const serviceTypes = {
  list: (q?: Query) => requestRaw<ServiceType[]>("/service-types", { query: q }),
  /** Types → categories → sub-categories in one call. */
  tree: () => request<TaxonomyTree>("/service-types/tree"),
  create: (body: Partial<ServiceType>) => request<ServiceType>("/service-types", { method: "POST", body }),
  update: (id: Id, body: Partial<ServiceType>) =>
    request<ServiceType>(`/service-types/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/service-types/${id}`, { method: "DELETE" }),
  syncCounts: () => requestRaw("/service-types/sync-counts", { method: "POST" }),
};

/* ============================ categories ============================ */
export const categories = {
  list: () => requestRaw<Category[]>("/categories"),
  get: (id: Id) => request<Category>(`/categories/${id}`),
  create: (body: Partial<Category>) => request<Category>("/categories", { method: "POST", body }),
  update: (id: Id, body: Partial<Category>) => request<Category>(`/categories/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Category>(`/categories/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/categories/${id}`, { method: "DELETE" }),
  syncCounts: () => requestRaw("/categories/sync-counts", { method: "POST" }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/categories/reorder", { method: "PATCH", body: { order } }),
};

/* ============================ packages ============================ */
export const packages = {
  /** Envelope: `data` plus `buckets` (catalogue / sold / ours) for the tabs. */
  list: (q?: Query) => requestRaw<Package[]>("/packages", { query: q }) as Promise<Envelope<Package[]> & { total?: number; buckets?: { premade: number; custom: number } }>,
  stats: () => request<Record<string, number>>("/packages/stats"),
  get: (id: Id) => request<Package>(`/packages/${id}`),
  create: (body: Partial<Package>) => request<Package>("/packages", { method: "POST", body }),
  update: (id: Id, body: Partial<Package>) => request<Package>(`/packages/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/packages/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Package>(`/packages/${id}/toggle-status`, { method: "PATCH" }),
};

export const packageAssignments = {
  list: (q?: Query) => requestRaw<PackageAssignment[]>("/package-assignments", { query: q }),
  stats: () => request<{
    statusCounts?: { _id: string; count: number }[];
    memberTypeCounts?: { _id: string; count: number }[];
    paymentStats?: { _id: boolean; count: number; totalAmount: number }[];
    totalRevenue?: { _id: null; total: number }[];
  }>("/package-assignments/stats"),
  get: (id: Id) => request<PackageAssignment>(`/package-assignments/${id}`),
  zenotiPush: (id: Id) => request<PackageAssignment>(`/package-assignments/${id}/zenoti-push`, { method: "POST" }),
  create: (body: Record<string, unknown>) =>
    request<PackageAssignment>("/package-assignments", { method: "POST", body }),
  update: (id: Id, body: Record<string, unknown>) =>
    request<PackageAssignment>(`/package-assignments/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/package-assignments/${id}`, { method: "DELETE" }),
  uploadProof: (id: Id, form: FormData) =>
    request<PackageAssignment>(`/package-assignments/${id}/payment-proof`, { method: "POST", body: form }),
  /** Balances, redemptions, freeze / transfer history, refund, terms — the Zenoti package detail. */
  ledger: (id: Id) => request<AssignmentLedger>(`/package-assignments/${id}/ledger`),
  freeze: (id: Id, body: { reason?: string; resumeOn?: string | null }) => requestRaw<PackageAssignment>(`/package-assignments/${id}/freeze`, { method: "POST", body }),
  unfreeze: (id: Id) => requestRaw<PackageAssignment>(`/package-assignments/${id}/unfreeze`, { method: "POST" }),
  transfer: (id: Id, body: { toUserId: Id; services: { serviceId: string; qty: number }[]; reason?: string }) =>
    requestRaw<PackageAssignment>(`/package-assignments/${id}/transfer`, { method: "POST", body }),
  refundPreview: (id: Id) => request<{ paid: number; unitsTotal: number; unitsLeft: number; suggested: number; balances: AssignmentLedger["balances"] }>(`/package-assignments/${id}/refund-preview`),
  refund: (id: Id, body: { amount: number; method: string; reference?: string; reason: string }) => requestRaw<PackageAssignment>(`/package-assignments/${id}/refund`, { method: "POST", body }),
  /** Push the expiry out for a guest who still has sessions owed; mirrored to Zenoti. */
  extendExpiry: (id: Id, body: { validUntil?: string; days?: number; reason: string }) =>
    requestRaw<PackageAssignment>(`/package-assignments/${id}/extend-expiry`, { method: "POST", body }),
  saveServiceCard: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/service-card", { method: "POST", body }),
  sendServiceOtp: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/send-otp", { method: "POST", body }),
  verifyServiceOtp: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/verify-otp", { method: "POST", body }),
  cancelSendOtp: (id: Id) => requestRaw(`/package-assignments/${id}/cancel/send-otp`, { method: "POST", body: {} }),
  cancelVerifyOtp: (id: Id, body: { otp: string; reason?: string }) =>
    requestRaw(`/package-assignments/${id}/cancel/verify-otp`, { method: "POST", body }),
  uploadPrescription: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/package-assignments/${id}/prescription`, { method: "POST", body }),
};

/* ============================ doctors ============================ */
export type DoctorStats = {
  period: { startDate: string; endDate: string };
  summary: { bookings: number; consultations: number; treatments: number; completed: number; noShow: number; cancelled: number; upcoming: number; revenue: number; consultationRevenue: number; treatmentRevenue: number; patients: number; avgRating: number | null; ratings: number; avgSessionMinutes: number | null };
  allTime: { bookings: number; completed: number; revenue: number; patients: number };
  byMonth: { month: string; bookings: number; consultations: number; treatments: number; revenue: number }[];
  topServices: { name: string; bookings: number; revenue: number }[];
  byCentre: { centre: string; bookings: number }[];
  recent: { _id: string; guest: string; userId?: string; service?: string | null; kind: "consultation" | "treatment"; date: string; time: string; status: string; amount: number; paymentStatus?: string; rating?: number | null; source?: string }[];
  feedback: { guest: string; rating: number; feedback: string; date: string }[];
};
export type DoctorAccount = { _id: Id; email: string; phone?: string | null; role: string; isActive: boolean; lastLogin?: string | null; loginMethod: 'otp' | 'password'; loginMethods?: ('otp' | 'password')[]; hasPassword?: boolean; passwordSetAt?: string | null; mustChangePassword?: boolean; placeholderEmail: boolean; jobTitle?: string | null; terminatedAt?: string | null };

export const doctors = {
  list: (q?: Query) => requestRaw<Doctor[]>("/doctors", { query: q }),
  get: (id: string) => request<Doctor>(`/doctors/${id}`),
  /** `password` also creates the panel login — the server emails the credentials. */
  create: (body: Partial<Doctor> & { password?: string }) => requestRaw<Doctor>("/doctors", { method: "POST", body }),
  update: (id: string, body: Partial<Doctor>) => request<Doctor>(`/doctors/${id}`, { method: "PUT", body }),
  /** Performance + recent visits for one dermatologist. */
  stats: (id: string, q?: Query) => request<DoctorStats>(`/doctors/${id}/stats`, { query: q }),
  /** Panel login behind the profile (admin only). */
  account: (id: string) => request<DoctorAccount | null>(`/doctors/${id}/account`),
  remove: (id: string) => requestRaw(`/doctors/${id}`, { method: "DELETE" }),
  toggle: (id: string) => request<Doctor>(`/doctors/${id}/toggle-status`, { method: "PATCH" }),
  /** The Doctor profile behind the signed-in staff login (role doctor). */
  me: () => requestRaw<Doctor | null>("/doctors/me") as Promise<Envelope<Doctor | null> & { linked?: boolean }>,
  tiers: () => request<{ id: string; title: string; description?: string; fee: number }[]>("/doctors/tiers/list"),
  updateTier: (tierId: string, body: { title?: string; description?: string; fee?: number; isActive?: boolean }) =>
    requestRaw(`/doctors/tiers/${tierId}`, { method: "PUT", body }),
};

/* ====================== dermatologist availability ====================== */
/**
 * When a dermatologist is bookable. The weekly pattern is the normal week; an
 * override names one date and always beats it — leave, or a one-off clinic.
 *
 * Slots are never stored, only derived. The server applies the fixed one-hour
 * session policy to every saved range.
 */
export const schedules = {
  /** Every dermatologist's shift, leave and blocks for one date — the desk day book. */
  dayShifts: (date: string, branchId?: string | null) =>
    request<DayBook>("/dermatologists/day-shifts", { query: { date, ...(branchId ? { branchId } : {}) } }),
  get: (doctorId: string) =>
    request<{ dermatologist: Doctor; schedule: DermatologistSchedule; canEdit: boolean; scheduleAuthority?: "zenoti" | "local"; authorityMessage?: string }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule`,
    ),
  save: (doctorId: string, body: Partial<DermatologistSchedule>) =>
    request<DermatologistSchedule>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule`,
      { method: "PUT", body },
    ),
  /** The automatic week from the assigned centres' opening hours — for "Reset to centre hours". */
  defaultWeek: (doctorId: string) =>
    request<{ weekly: WeeklyBlock[]; centres: string[] }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule/default`,
    ),
  /** Day-level free counts, for painting the month. */
  days: (doctorId: string, from: string, to: string, branchId?: string | null) =>
    request<{ configured: boolean; slotMinutes?: number; days: ScheduleDay[] }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/availability`,
      { query: { from, to, ...(branchId ? { branchId } : {}) } },
    ),
  /** Every slot on one date, each flagged booked, too soon, or free. */
  slots: (doctorId: string, date: string, branchId?: string | null) =>
    request<SlotDay>(`/dermatologists/${encodeURIComponent(doctorId)}/slots`, {
      query: { date, ...(branchId ? { branchId } : {}) },
    }),
};

export const feeRequests = {
  list: (q?: Query) => requestRaw<DoctorFeeRequest[]>("/doctor-fee-requests", { query: q }),
  /** The signed-in doctor's own fee, standard fee and any open request. */
  myFee: () => request<MyFee>("/doctor-fee-requests/my-fee"),
  create: (body: { requestedFee: number; reason: string; doctorId?: string }) =>
    request<DoctorFeeRequest>("/doctor-fee-requests", { method: "POST", body }),
  approve: (id: Id, body: { approvedFee?: number; reviewNote?: string }) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/approve`, { method: "PATCH", body }),
  reject: (id: Id, reviewNote: string) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/reject`, { method: "PATCH", body: { reviewNote } }),
  withdraw: (id: Id) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/withdraw`, { method: "PATCH" }),
  /** Put a doctor back on the standard tier fee. */
  clearOverride: (doctorId: string) =>
    requestRaw(`/doctor-fee-requests/override/${doctorId}`, { method: "DELETE" }),
};

export const availability = {
  list: () => request<DoctorAvailability[]>("/dermatologist-availability"),
  get: (doctorId: string) => request<DoctorAvailability>(`/dermatologist-availability/${doctorId}`),
  set: (doctorId: string, branchIds: Id[], isActive = true) =>
    request<DoctorAvailability>(`/dermatologist-availability/${doctorId}`, {
      method: "PUT", body: { branchIds, isActive },
    }),
};

/* ============================ products & commerce ============================ */
export const products = {
  list: (q?: Query) => requestRaw<Product[]>("/admin/products", { query: q }),
  get: (id: Id) => request<Product>(`/admin/products/${id}`),
  statistics: () => request<{
    total: number; active: number; inactive: number; popular: number;
    lowStock: number; outOfStock: number; totalStock: number; totalValue: number; avgPrice: number;
    byFormulation?: Record<string, { count: number; stock: number; value: number }>;
  }>("/admin/products/statistics"),
  create: (body: Partial<Product>) => request<Product>("/admin/products", { method: "POST", body }),
  /** App Stock template: preview / apply an import, or download the current catalogue in the same shape. */
  stockMovements: (id: string, limit = 100) => request<{ success: boolean; data: ProductStockMovement[] }>(`/admin/products/${id}/stock-movements?limit=${limit}`).then((r) => r.data),
  appStockPreview: (file: File) => { const form = new FormData(); form.append("file", file); return request<AppStockImportResult>("/admin/products/app-stock/preview", { method: "POST", body: form }); },
  appStockImport: (file: File) => { const form = new FormData(); form.append("file", file); return requestRaw<AppStockImportResult>("/admin/products/app-stock/import", { method: "POST", body: form }); },
  appStockExportPath: (q?: Query) => `/admin/products/app-stock/export${q ? "?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString() : ""}`,
  update: (id: Id, body: Partial<Product>) => request<Product>(`/admin/products/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/products/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Product>(`/admin/products/${id}/toggle-status`, { method: "PATCH" }),
  setStock: (id: Id, stock: number) =>
    request<Product>(`/admin/products/${id}/stock`, { method: "PATCH", body: { stock } }),
  bulkUpdate: (productIds: Id[], updates: Partial<Product>) =>
    requestRaw("/admin/products/bulk-update", { method: "PATCH", body: { productIds, updates } }),
};

export const brands = {
  list: (q?: Query) => request<Brand[]>("/admin/brands", { query: q }),
  statistics: () => request<Record<string, number>>("/admin/brands/statistics"),
  create: (body: Partial<Brand>) => request<Brand>("/admin/brands", { method: "POST", body }),
  update: (id: Id, body: Partial<Brand>) => request<Brand>(`/admin/brands/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/brands/${id}`, { method: "DELETE" }),
};

export const formulations = {
  list: (q?: Query) => request<Formulation[]>("/admin/formulations", { query: q }),
  statistics: () => request<Record<string, number>>("/admin/formulations/statistics"),
  create: (body: Partial<Formulation>) => request<Formulation>("/admin/formulations", { method: "POST", body }),
  update: (id: Id, body: Partial<Formulation>) =>
    request<Formulation>(`/admin/formulations/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/formulations/${id}`, { method: "DELETE" }),
};

export const coupons = {
  list: (q?: Query) => request<Coupon[]>("/coupons", { query: q }),
  get: (id: Id) => request<Coupon>(`/coupons/${id}`),
  statistics: () => request<Record<string, number>>("/coupons/statistics"),
  create: (body: Partial<Coupon>) => request<Coupon>("/coupons", { method: "POST", body }),
  update: (id: Id, body: Partial<Coupon>) => request<Coupon>(`/coupons/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/coupons/${id}`, { method: "DELETE" }),
};

export const orders = {
  list: (q?: Query) => requestRaw<ProductOrder[]>("/admin/product-orders", { query: q }),
  get: (id: Id) => request<ProductOrder>(`/admin/product-orders/${id}`),
  stats: (q?: Query) => request<{
    totalOrders: number; newOrders: number; confirmedOrders: number; processingOrders: number;
    shippedOrders: number; deliveredOrders: number; cancelledOrders: number; failedDeliveryOrders: number;
    returnRequestedOrders: number; appOrders: number; clinicOrders: number; totalRevenue: number;
  }>("/admin/product-orders/stats", { query: q }),
  setStatus: (id: Id, orderStatus: string, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/status`, { method: "PUT", body: { status: orderStatus, note } }),
  approveReturn: (id: Id) => request<ProductOrder>(`/admin/product-orders/${id}/approve-return`, { method: "PUT" }),
  completeReturn: (id: Id, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/complete-return`, { method: "PUT", body: { note } }),
  rejectReturn: (id: Id, reason: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/reject-return`, {
      method: "PUT", body: { reason },
    }),
  remove: (id: Id) => requestRaw(`/admin/product-orders/${id}`, { method: "DELETE" }),
  initiateRefund: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/admin/product-orders/${id}/initiate-refund`, { method: "POST", body }),
  completeRefund: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/admin/product-orders/${id}/complete-refund`, { method: "PUT", body }),
  bankDetails: (userId: Id) => request<Record<string, string>>(`/admin/product-orders/user/${userId}/bank-details`),
  markDeliveryFailed: (id: Id, reason: string, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/delivery-failed`, {
      method: "PUT", body: { reason, note },
    }),
  assignDelivery: (id: Id, body: {
    deliveryPartner?: string; deliveryPartnerPhone?: string; courier?: string;
    trackingId?: string; expectedDeliveryTime?: string;
  }) => request<ProductOrder>(`/admin/product-orders/${id}/assign-delivery`, { method: "PUT", body }),
};

/* ============================ stock ============================ */
/**
 * Doctor-facing stock. Separate from `products` on purpose: that endpoint
 * returns prices and a dermatologist account is not permitted to call it.
 * Named `productAvailability` because `availability` already means the
 * dermatologist-centre availability above.
 */
export const productAvailability = {
  list: (q?: { search?: string; branchId?: Id; status?: string; limit?: number }) =>
    requestRaw<ProductAvailability[]>("/inventory/availability", { query: q as Query }),
};

/**
 * Clinical photographs. Multipart upload, because the browser must be able to
 * hand over a file straight from the device camera (capture="environment").
 */
export const patientPhotos = {
  list: (q: { userId?: Id; bookingId?: Id; phase?: string; limit?: number }) =>
    requestRaw<PatientPhoto[]>("/patient-photos", { query: q as Query }),
  upload: (files: File[], meta: { userId: Id; bookingId?: Id | null; phase?: string; bodyArea?: string; note?: string; takenAt?: string }) => {
    const form = new FormData();
    files.forEach((f) => form.append("photos", f));
    Object.entries(meta).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") form.append(k, String(v)); });
    return requestRaw<PatientPhoto[]>("/patient-photos", { method: "POST", body: form });
  },
  update: (id: Id, body: Partial<Pick<PatientPhoto, "phase" | "bodyArea" | "note">> & { bookingId?: Id | null }) =>
    request<PatientPhoto>(`/patient-photos/${id}`, { method: "PATCH", body }),
  remove: (id: Id) => requestRaw(`/patient-photos/${id}`, { method: "DELETE" }),
};

/**
 * Purchase orders. Receiving is what raises stock — see the backend controller;
 * nothing else on this path may increase a quantity.
 */
export const purchaseOrders = {
  list: (q?: { status?: string; vendorId?: Id; branchId?: Id; productId?: Id; search?: string; page?: number; limit?: number }) =>
    requestRaw<PurchaseOrder[]>("/purchase-orders", { query: q as Query }),
  get: (id: Id) => request<PurchaseOrder>(`/purchase-orders/${id}`),
  create: (body: {
    vendorId: Id; branchId?: Id | null; expectedDeliveryDate?: string | null; notes?: string;
    lines: { name: string; sku?: string; productId?: Id | null; inventoryId?: Id | null; requestedQuantity: number; unitCost?: number; taxPercent?: number; note?: string }[];
  }) => request<PurchaseOrder>("/purchase-orders", { method: "POST", body }),
  update: (id: Id, body: Record<string, unknown>) =>
    request<PurchaseOrder>(`/purchase-orders/${id}`, { method: "PUT", body }),
  setStatus: (id: Id, status: PurchaseOrderStatus, note?: string) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/status`, { method: "PATCH", body: { status, note } }),
  receive: (id: Id, receipts: { lineId: Id; quantity: number; rejectedQuantity?: number; rejectionReason?: string; batchNo?: string; expiryDate?: string | null; note?: string }[]) =>
    requestRaw<PurchaseOrder>(`/purchase-orders/${id}/receive`, { method: "POST", body: { receipts } }),
  productHistory: (productId: Id) => request<Record<string, unknown>[]>(`/purchase-orders/history/product/${productId}`),
  vendorHistory: (vendorId: Id) => request<{ summary: Record<string, number>; orders: PurchaseOrder[] }>(`/purchase-orders/history/vendor/${vendorId}`),
};

/**
 * Bulk import / export. Preview writes nothing; commit re-validates the file
 * rather than trusting the preview.
 */
export const bulk = {
  preview: (entity: "services" | "categories" | "products" | "packages", file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<BulkPreview>(`/bulk/${entity}/preview`, { method: "POST", body: form });
  },
  commit: (entity: "services" | "categories" | "products" | "packages", file: File, mode: "create" | "update" | "both") => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    return request<BulkResult>(`/bulk/${entity}/commit`, { method: "POST", body: form });
  },
  /** Export and template are plain downloads, so they bypass the JSON helper. */
  downloadUrl: (entity: string, kind: "export" | "template") => `/bulk/${entity}/${kind}`,
};

/** Admin-built consultation forms. */
export const formTemplates = {
  list: (q?: { isActive?: boolean; search?: string }) =>
    requestRaw<FormTemplate[]>("/form-templates", { query: q as Query }),
  get: (id: Id) => request<FormTemplate>(`/form-templates/${id}`),
  create: (body: Partial<FormTemplate>) => request<FormTemplate>("/form-templates", { method: "POST", body }),
  update: (id: Id, body: Partial<FormTemplate>) => request<FormTemplate>(`/form-templates/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/form-templates/${id}`, { method: "DELETE" }),
  submissions: (id: Id, q?: { page?: number; limit?: number; status?: string }) =>
    requestRaw<FormSubmissionRow[]>(`/form-templates/${id}/submissions`, { query: q as Query }),
};

export const inventory = {
  /** Pass `branchId` — stock is held per centre, so an unscoped list mixes them. */
  list: (q?: Query) => requestRaw<Inventory[]>("/admin/inventory", { query: q }),
  get: (id: Id) => request<Inventory>(`/admin/inventory/${id}`),
  statistics: () => request<Record<string, unknown>>("/admin/inventory/statistics"),
  create: (body: Partial<Inventory>) => request<Inventory>("/admin/inventory", { method: "POST", body }),
  update: (id: Id, body: Partial<Inventory>) => request<Inventory>(`/admin/inventory/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/inventory/${id}`, { method: "DELETE" }),
  bulkUpdateStock: (updates: { id: Id; qohAllBatches: number }[]) =>
    requestRaw("/admin/inventory/bulk-update-stock", { method: "POST", body: { updates } }),
  /** Atomic per-line consumption with a ledger row each — what a session uses. */
  consume: (body: { bookingId?: Id | null; branchId?: Id | null; lines: { inventoryId: Id; qty: number; wastedQty?: number; reason?: string; batchNo?: string }[] }) =>
    requestRaw<{ consumed: { inventoryId: Id; name: string; consumed: number; wasted: number; remaining: number }[]; failed: { inventoryId: Id; name: string; available: number; requested: number; message: string }[] }>("/admin/inventory/consume", { method: "POST", body }),
  movements: (q?: Query) => requestRaw<StockMovement[]>("/admin/inventory/movements", { query: q }),
};

export const vendors = {
  list: (q?: Query) => request<Vendor[]>("/vendors", { query: q }),
  get: (id: Id) => request<{ vendor: Vendor; productsCount?: number }>(`/vendors/${id}`),
  stats: () => request<Record<string, number>>("/vendors/stats"),
  create: (body: Partial<Vendor>) => request<Vendor>("/vendors", { method: "POST", body }),
  update: (id: Id, body: Partial<Vendor>) => request<Vendor>(`/vendors/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/vendors/${id}`, { method: "DELETE" }),
  /** Audited reveal — the list never carries bank details. */
  bankDetails: (id: Id) => request<Vendor["bankDetails"]>(`/vendors/${id}/bank-details`),
};

/* ============================ app studio ============================ */
export const appStudio = {
  get: () => request<AppCustomization>("/app-customization/admin"),
  update: (body: Partial<AppCustomization>) =>
    request<AppCustomization>("/app-customization/admin", { method: "PUT", body }),
  uploadImage: (imageType: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<{ url: string } & AppCustomization>(`/app-customization/admin/upload/${imageType}`, {
      method: "POST", body: form,
    });
  },
  reset: () => request<AppCustomization>("/app-customization/admin/reset", { method: "POST" }),
  addConsultationCard: (form: FormData) =>
    request<AppCustomization>("/app-customization/admin/consultation-card", { method: "POST", body: form }),
  updateConsultationCard: (cardId: string, form: FormData) =>
    request<AppCustomization>(`/app-customization/admin/consultation-card/${cardId}`, { method: "PUT", body: form }),
  deleteConsultationCard: (cardId: string) =>
    request<AppCustomization>(`/app-customization/admin/consultation-card/${cardId}`, { method: "DELETE" }),
  addReelVideo: (form: FormData) =>
    request<AppCustomization>("/app-customization/admin/reel-videos", { method: "POST", body: form }),
  updateReelVideo: (reelId: string, body: { permalink?: string; title?: string; poster?: string }) =>
    request<unknown>(`/app-customization/admin/reel-videos/${reelId}`, { method: "PUT", body }),
  deleteReelVideo: (reelId: string) =>
    request<AppCustomization>(`/app-customization/admin/reel-videos/${reelId}`, { method: "DELETE" }),
};

export const media = {
  list: (q?: Query) => request<{ resources?: unknown[] } | unknown[]>("/upload/media/all", { query: q }),
  stats: () => request<Record<string, unknown>>("/upload/stats"),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("media", f));
    return request<{ url: string; publicId: string; thumbnail?: string }[]>("/upload/media", { method: "POST", body: form });
  },
  addUrl: (url: string) => request<{ url: string }>("/upload/media-url", { method: "POST", body: { url } }),
  remove: (publicId: string) => requestRaw(`/upload/media/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
};

/* ============================ engagement ============================ */
export const chat = {
  byBranch: (branchId: Id, q?: Query) => requestRaw<Chat[]>(`/chat/admin/branch/${branchId}`, { query: q }),
  stats: (branchId?: Id) =>
    request<{
      overall: { _id: string; count: number; totalUnread: number }[];
      byBranch: { branchId: Id; branchName: string; activeChats: number; totalUnread: number }[];
    }>("/chat/admin/stats", { query: { branchId } }),
  messages: (chatId: Id, q?: Query) => requestRaw<ChatMessage[]>(`/chat/${chatId}/messages`, { query: q }),
  /** `kind: "note"` = staff-only private note; `templateId` sends a template (required on WhatsApp threads outside the 24h window). */
  send: (chatId: Id, content: string, opts?: { kind?: "note"; templateId?: Id; bookingId?: Id }) =>
    request<ChatMessage>(`/chat/${chatId}/messages`, { method: "POST", body: { content, ...(opts || {}) } }),
  setTags: (chatId: Id, body: { tags?: string[]; pinned?: boolean }) => request<Chat>(`/chat/admin/${chatId}/tags`, { method: "PUT", body }),
  /** Open the guest's WhatsApp thread from the desk by sending an approved template. */
  startWhatsApp: (body: { userId: Id; templateId: Id; bookingId?: Id; branchId?: Id | null }) => request<ChatMessage>("/chat/admin/start-whatsapp", { method: "POST", body }),
  sendAttachment: (chatId: Id, file: File, caption = "") => {
    const form = new FormData();
    form.append("file", file);
    if (caption.trim()) form.append("caption", caption.trim());
    return request<ChatMessage>(`/chat/${chatId}/attachments`, { method: "POST", body: form });
  },
  markRead: (chatId: Id) => requestRaw(`/chat/${chatId}/read`, { method: "PUT" }),
  close: (chatId: Id) => request<Chat>(`/chat/admin/${chatId}/close`, { method: "PUT" }),
  assign: (chatId: Id, adminId: Id | null) =>
    request<Chat>(`/chat/admin/${chatId}/assign`, { method: "PUT", body: { adminId } }),
  deleteMessage: (messageId: Id) => requestRaw(`/chat/messages/${messageId}`, { method: "DELETE" }),
};

export type NotificationPage = {
  notifications: Notification[];
  unreadCount?: number;
  pagination?: { currentPage: number; totalPages: number; total: number };
};

export const notifications = {
  // These endpoints nest the rows under `data.notifications`, not `data`.
  list: (q?: Query) => request<NotificationPage>("/notifications/admin", { query: q }),
  recent: (limit = 6) =>
    request<NotificationPage>("/notifications/admin/recent", { query: { limit } }),
  unreadCount: () => request<{ count: number } | number>("/notifications/admin/unread-count"),
  stats: () => request<{
    byType?: { _id: string; count: number }[];
    byPriority?: { _id: string; count: number }[];
    overall?: { total?: number; unread?: number; read?: number } | Record<string, number>;
  }>("/notifications/admin/stats"),
  markRead: (id: Id) => requestRaw(`/notifications/admin/${id}/read`, { method: "PATCH" }),
  markAllRead: () => requestRaw("/notifications/admin/mark-all-read", { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/notifications/admin/${id}`, { method: "DELETE" }),
  clearRead: () => requestRaw("/notifications/admin/read/all", { method: "DELETE" }),
};

export const reviews = {
  products: (q?: Query) => requestRaw<ProductReview[]>("/admin/product-reviews", { query: q }),
  approveProduct: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/product-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeProduct: (id: Id) => requestRaw(`/admin/product-reviews/${id}`, { method: "DELETE" }),

  consultations: (q?: Query) => requestRaw<ConsultationReview[]>("/admin/consultation-reviews", { query: q }),
  approveConsultation: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/consultation-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeConsultation: (id: Id) => requestRaw(`/admin/consultation-reviews/${id}`, { method: "DELETE" }),

  packageServices: (q?: Query) => requestRaw<ServiceReview[]>("/admin/package-service-reviews", { query: q }),
  approveServiceReview: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/package-service-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeServiceReview: (id: Id) => requestRaw(`/admin/package-service-reviews/${id}`, { method: "DELETE" }),
};

export const support = {
  list: (q?: Query) => requestRaw<SupportMessage[]>("/support/admin/all", { query: q }),
  setStatus: (id: Id, status: string, note?: string) =>
    request<SupportMessage>(`/support/admin/${id}/status`, { method: "PATCH", body: { status, note } }),
};

/* ============================ clinical forms ============================ */
export const preConsult = {
  /** "Pre-consultation form: Completed" for one appointment — one cheap call. */
  statusForBooking: (bookingId: Id) =>
    request<{ state: "not_started" | "draft" | "completed"; label: string; formId: Id | null; linked: boolean; status?: string; updatedAt?: string }>(
      `/pre-consult-forms/admin/by-booking/${bookingId}`,
    ),
  list: (q?: Query) => requestRaw<PreConsultForm[]>("/pre-consult-forms/admin/all", { query: q }),
  setStatus: (id: Id, status: string) =>
    request<PreConsultForm>(`/pre-consult-forms/admin/${id}/status`, { method: "PATCH", body: { status } }),
  /** Digital, on paper, or not yet — plus the evidence the desk saw this guest. */
  intake: (userId: Id) => request<IntakeDetail>(`/pre-consult-forms/admin/intake/${userId}`),
  /** The field list the digitise editor renders from; the backend owns the questions. */
  schema: () => request<PreConsultSchema>("/pre-consult-forms/admin/schema"),
  /**
   * Key a paper form into the record. Raw envelope on purpose: a 400 carries
   * `fieldErrors`, a 409 carries `code: 'INTAKE_ALREADY_DIGITAL'` — both are
   * thrown as ApiError with the payload, so the caller reads them from there.
   */
  digitise: (userId: Id, body: { values: Record<string, unknown>; paperDate: string; notes?: string; replace?: boolean }) =>
    requestRaw<{ _id: Id; status: string; createdAt?: string; dateOfVisit?: string; origin?: PreConsultForm["origin"] }>(
      `/pre-consult-forms/admin/digitise/${userId}`, { method: "POST", body },
    ),
};

export const consentForms = {
  list: (q?: Query) => requestRaw<ConsentForm[]>("/patient-consent-forms/admin/all", { query: q }),
  setStatus: (id: Id, status: string, clinicNotes?: string) =>
    request<ConsentForm>(`/patient-consent-forms/admin/${id}/status`, {
      method: "PATCH", body: { status, clinicNotes },
    }),
  doctorSign: (id: Id, doctorSignature: string) =>
    request<ConsentForm>(`/patient-consent-forms/admin/${id}/doctor-sign`, {
      method: "PATCH", body: { doctorSignature },
    }),
};

export const serviceCards = {
  list: (q?: Query) => requestRaw<ServiceCard[]>("/service-cards/admin/all", { query: q }),
  create: (body: Record<string, unknown>) =>
    request<ServiceCard>("/service-cards/admin/create", { method: "POST", body }),
  update: (id: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${id}`, { method: "PUT", body }),
  deactivate: (id: Id) => requestRaw(`/service-cards/admin/${id}/deactivate`, { method: "PATCH" }),
  addService: (id: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${id}/services`, { method: "POST", body }),
  updateService: (cardId: Id, serviceId: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${cardId}/services/${serviceId}`, { method: "PUT", body }),
  deleteService: (cardId: Id, serviceId: Id) =>
    requestRaw(`/service-cards/admin/${cardId}/services/${serviceId}`, { method: "DELETE" }),
};

export const consultationNotes = {
  list: (q?: Query) => requestRaw<ConsultationNote[]>("/consultation-notes", { query: q }),
  forBooking: (bookingId: Id) => request<ConsultationNote | null>(`/consultation-notes/booking/${bookingId}`),
  save: (body: Partial<ConsultationNote> & { bookingId: Id }) =>
    request<ConsultationNote>("/consultation-notes", { method: "POST", body }),
  remove: (id: Id) => requestRaw(`/consultation-notes/${id}`, { method: "DELETE" }),
};

/* ==================== sign-in security (super admin) ==================== */
export type SignInSecurity = {
  loginRateLimit: {
    /** True when throttling is doing its job. */
    active: boolean;
    pausedUntil: string | null;
    minutesRemaining: number;
    pausedByName: string | null;
    pausedReason: string | null;
    maxPauseMinutes: number;
  };
};

export type LockedAccount = {
  _id: Id;
  name?: string;
  email: string;
  role: string;
  failedLoginAttempts: number;
  /** Null when they are only part-way to a lock. */
  lockedUntil: string | null;
};

export const security = {
  get: () => request<SignInSecurity>("/admin/security-settings"),
  /** Pause throttling for a bounded window, or resume it now. */
  setLoginRateLimit: (body: { paused: boolean; minutes?: number; reason?: string }) =>
    requestRaw<SignInSecurity>("/admin/security-settings/login-rate-limit", { method: "PATCH", body }),
  lockedAccounts: () => request<LockedAccount[]>("/admin/security-settings/locked-accounts"),
  unlock: (id: Id) => requestRaw(`/admin/security-settings/unlock/${id}`, { method: "POST", body: {} }),
};

/* ============================ analytics ============================ */
export type FinancialAnalytics = {
  overview: {
    totalRevenue: number; consultationRevenue: number; productRevenue: number; packageRevenue: number;
    outstandingPayments: number; refundsLost: number; averageTransactionValue: number;
    totalTransactions: number; weekOverWeekGrowth: number;
  };
  // These three arrive as keyed maps ({ "Jubilee Hills": 2700 }), not arrays.
  paymentMethodDistribution: Record<string, number>;
  revenueByLocation: Record<string, number>;
  revenueByCategory: Record<string, number>;
  dailyRevenue: { date: string; revenue: number; consultations?: number; orders?: number; packages?: number }[];
  period: { startDate: string; endDate: string };
};

export type PatientAnalytics = {
  overview: {
    totalPatients: number; newPatients: number; returningPatients: number;
    newPatientRatio: number; returningPatientRatio: number; retentionRate: number;
  };
  birthdaysToday: { _id: string; fullName: string; email?: string; phone?: string }[];
  inactivePatients: { count: number; threshold: string };
  membershipStatus: { active: number; expired: number; pending: number };
};

export type AppointmentAnalytics = {
  overview: {
    totalBookings: number; completedBookings: number; cancelledBookings: number;
    noShowBookings: number; pendingBookings: number; conversionRate: number;
    cancellationRate: number; noShowRate: number;
  };
  averages: { perDay: number; perWeek: number; perMonth: number };
  peakHours: { hour: string; count: number }[];
  peakDays: { day: string; count: number }[];
  cancellationTrend: { date?: string; month?: string; count: number }[];
  noShowByService: { service: string; count: number }[];
  avgTimeBetweenBookings: number;
  upcomingThisWeek: number;
  pendingConfirmations: number;
};

export type ServiceAnalytics = {
  topServicesByRevenue?: { id: Id; name: string; category: string; revenue: number; bookings: number }[];
  topServicesByVolume?: { id: Id; name: string; category: string; revenue: number; bookings: number }[];
  serviceProfitMargin?: { id: Id; name: string; revenue: number; cost: number; profit: number; margin: number }[];
  leastPerformingServices?: { id: Id; name: string; category: string; price: number; bookings: number }[];
  categoryPerformance?: { category: string; revenue: number; bookings: number; avgPrice?: number }[];
  packageUtilization?: { name: string; used: number; total: number; utilizationRate?: number }[];
  summary: {
    totalRevenue: number; totalBookings: number; totalServices: number;
    activeServices: number; avgRevenuePerService: number;
  };
};

export type InventoryAnalytics = {
  summary: {
    totalItems: number; totalValue: number; lowStockCount: number;
    outOfStockCount?: number; reorderNeededCount: number; totalCost?: number; expiringIn30Days?: number; expired?: number;
  };
  lowStockAlerts: Inventory[];
  outOfStockItems: { id: Id; name?: string; inventoryName?: string }[];
  [key: string]: unknown;
};

export type DashboardStream = { key: string; label: string; revenue: number; count: number; app: number; clinic: number; unpriced?: number };
export type DashboardDerm = {
  doctorId: string; name: string; photo?: string | null; tier?: string | null; level: string;
  source: "app" | "zenoti" | "app+zenoti"; onboarded: boolean; zenotiEmployeeId?: string | null;
  bookings: number; consultations: number; treatments: number; completed: number; noShow: number; cancelled: number;
  revenue: number; patients: number; avgRating: number | null; completionRate: number;
};
export type Dashboard = {
  period: { startDate: string; endDate: string; days: number; branch: string; isAllTime?: boolean };
  revenue: { total: number; previous: number; previousHasData?: boolean; growthPercent: number | null; streams: DashboardStream[] };
  counts: {
    bookings: number; completed: number; cancelled: number; noShow: number; consultations: number; treatments: number; upcoming: number;
    awaitingConfirmation: number; noShowRate: number; cancellationRate: number; orders: number; paidOrders: number; ordersByStatus: Record<string, number>;
    openOrders: number; packagesAssigned: number; packagesPaid: number; packagesUnpaid: number; membershipsSold: number; activeZen: number; zenExpiring: number;
    newPatients: number; totalPatients: number; bookingsBySource: Record<string, number>; outstanding: number; averageTicket: number; membershipsUnpriced?: number;
    /** Fixed reference points, independent of the chosen window. */
    existingPatients?: number; newThisMonth?: number; treatmentsThisWeek?: number;
    upcomingAll?: number; appointmentsAllTime?: number; returningPatients?: number;
    completedConsultations?: number; completedTreatments?: number;
  };
  dermatologists: DashboardDerm[];
  topServices: { name: string; category?: string | null; kind: string; bookings: number; revenue: number }[];
  revenueByCentre: { centre: string; revenue: number; bookings: number }[];
  paymentMix: { method: string; amount: number }[];
  daily: { date: string; consultations: number; treatments: number; products: number; packages: number; memberships: number; total: number; bookings: number }[];
};

/** A row on the "Today's sales" register. */
export type SaleRow = { kind: "invoice" | "visit" | "order" | "package"; id: Id; ref: string | null; receipt?: string | null; customer: string | null; phone: string | null; patientId: string | null; guestCode?: string | null; userId?: Id | null; items: string[]; amount: number; due: number; method: string | null; methods?: Record<string, number>; at: string | null; status: string; source: string; staff: string | null };
export type TodaysSales = { date: string | null; totals: { count: number; amount: number; visits: number; products: number; packages: number; due: number; dueCount: number; open?: number; void?: number; byMethod: Record<string, number> }; rows: SaleRow[] };

/* ============================ billing ============================ */
export type NewInvoiceLine = {
  consultationId?: Id; productId?: Id; inventoryId?: Id; packageId?: Id; membershipId?: Id; bookingId?: Id | null;
  kind?: "custom"; name?: string; qty?: number; unitPrice?: number | string; taxPercent?: number; priceIncludesTax?: boolean;
  discount?: number; discountPercent?: number; soldById?: string | null; soldByName?: string | null; soldByModel?: "Doctor" | "Admin" | null;
  useMrp?: boolean; batchNo?: string; expiryDate?: string; hsn?: string; notes?: string;
};
/** Desk bills — Zenoti's POS. One open invoice per visit; closing settles the visits. */
export const invoices = {
  meta: () => request<{ methods: PaymentMethod[]; lineKinds: string[] }>("/invoices/meta"),
  list: (q?: Query) => requestRaw<Invoice[]>("/invoices", { query: q }) as Promise<Envelope<Invoice[]> & { totals?: { count: number; amount: number; paid: number; due: number; byStatus: Record<string, { count: number; amount: number; paid: number; due: number }> } }>,
  lookup: (number: string) => request<Invoice>("/invoices/lookup", { query: { number } }),
  get: (id: Id) => request<Invoice>(`/invoices/${id}`),
  /** Open (or return the live) bill for a visit / visit group / guest. */
  open: (body: { bookingId?: Id; bookingIds?: Id[]; visitGroupId?: string; userId?: Id; branchId?: Id | null; lines?: NewInvoiceLine[] }) =>
    requestRaw<Invoice>("/invoices", { method: "POST", body }) as Promise<Envelope<Invoice> & { existing?: boolean }>,
  update: (id: Id, body: { comments?: string; invoiceDiscount?: { percent?: number; amount?: number; reason?: string }; interState?: boolean; guest?: { name?: string; phone?: string; email?: string; gstin?: string; stateCode?: string } }) =>
    request<Invoice>(`/invoices/${id}`, { method: "PUT", body }),
  addLine: (id: Id, body: NewInvoiceLine) => request<Invoice>(`/invoices/${id}/lines`, { method: "POST", body }),
  updateLine: (id: Id, lineId: Id, body: Partial<Pick<InvoiceLine, "qty" | "unitPrice" | "taxPercent" | "priceIncludesTax" | "discount" | "discountPercent" | "soldById" | "soldByName" | "soldByModel" | "notes" | "hsn" | "batchNo" | "expiryDate">> & { restoreMembershipDiscount?: boolean }) =>
    request<Invoice>(`/invoices/${id}/lines/${lineId}`, { method: "PUT", body }),
  removeLine: (id: Id, lineId: Id) => request<Invoice>(`/invoices/${id}/lines/${lineId}`, { method: "DELETE" }),
  guestPackages: (id: Id) => requestRaw<GuestPackageBalance[]>(`/invoices/${id}/packages`) as Promise<Envelope<GuestPackageBalance[]> & { membership?: GuestMembership | null }>,
  applyMembershipCredits: (id: Id, body?: { lineIds?: Id[] }) =>
    requestRaw<Invoice>(`/invoices/${id}/redeem-membership`, { method: "POST", body: body || {} }) as Promise<Envelope<Invoice> & { applied?: number }>,
  applyPackage: (id: Id, body: { packageAssignmentId: Id; lineIds?: Id[] }) =>
    requestRaw<Invoice>(`/invoices/${id}/redeem`, { method: "POST", body }) as Promise<Envelope<Invoice> & { applied?: number }>,
  removeRedemption: (id: Id, lineId: Id) => request<Invoice>(`/invoices/${id}/redeem/${lineId}`, { method: "DELETE" }),
  addPayment: (id: Id, body: { method: PaymentMethod; amount: number; customName?: string; reference?: string; note?: string }) =>
    requestRaw<Invoice>(`/invoices/${id}/payments`, { method: "POST", body }) as Promise<Envelope<Invoice> & { closed?: boolean }>,
  voidPayment: (id: Id, paymentId: Id, reason?: string) => request<Invoice>(`/invoices/${id}/payments/${paymentId}`, { method: "DELETE", body: { reason } }),
  close: (id: Id, allowDue = false) => request<Invoice>(`/invoices/${id}/close`, { method: "POST", body: { allowDue } }),
  reopen: (id: Id) => request<Invoice>(`/invoices/${id}/reopen`, { method: "POST" }),
  void: (id: Id, reason: string) => request<Invoice>(`/invoices/${id}/void`, { method: "POST", body: { reason } }),
  summary: (q?: Query) => request<InvoiceSummary>("/invoices/summary", { query: q }),
  /** The bill behind a visit — a Zenoti visit is mirrored in full on first open. */
  forBooking: (bookingId: Id) => request<Invoice>(`/invoices/for-booking/${bookingId}`),
  /** Re-read a mirrored bill's lines and payments from Zenoti. */
  zenotiRefresh: (id: Id) => request<Invoice>(`/invoices/${id}/zenoti-refresh`, { method: "POST" }),
  /** Pull the line items for every un-expanded Zenoti bill on one guest. */
  hydrateGuest: (userId: Id) => request<{ fetched: number; pending: number }>(`/invoices/guest/${userId}/hydrate`, { method: "POST" }),
  receipt: (id: Id, print = false) => request<{ html: string; text: string; invoiceNumber: string; receiptNumber: string | null }>(`/invoices/${id}/receipt`, { query: print ? { print: 1 } : undefined }),
  send: (id: Id, body: { channel: "email" | "whatsapp" | "both"; email?: string; phone?: string }) =>
    requestRaw<{ email?: { ok: boolean; to?: string; error?: string }; whatsapp?: { ok: boolean; to?: string; error?: string } }>(`/invoices/${id}/send`, { method: "POST", body }),
};

/* ============================ message templates ============================ */
export const templates = {
  list: (q?: Query) => requestRaw<MessageTemplate[]>("/admin/message-templates", { query: q }) as Promise<Envelope<MessageTemplate[]> & { placeholders?: string[] }>,
  create: (body: Partial<MessageTemplate>) => request<MessageTemplate>("/admin/message-templates", { method: "POST", body }),
  update: (id: Id, body: Partial<MessageTemplate>) => request<MessageTemplate>(`/admin/message-templates/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/message-templates/${id}`, { method: "DELETE" }),
  preview: (id: Id, body: { userId?: Id; bookingId?: Id; invoiceId?: Id; assignmentId?: Id }) => request<{ body: string; subject: string; vars: Record<string, string> }>(`/admin/message-templates/${id}/preview`, { method: "POST", body }),
};

/* ============================ stock control ============================ */
/** Zenoti's Inventory module beyond the item list: current stock valued three ways, audits, transfers. */
export const stockControl = {
  current: (q?: Query) => requestRaw<CurrentStockRow[]>("/admin/stock/current", { query: q }) as Promise<Envelope<CurrentStockRow[]> & { totals?: StockSummary; basis?: string; lastReconcile?: { at: string; ref: string } | null }>,
  valuation: (q?: Query) => request<StockValuation>("/admin/stock/valuation", { query: q }),
  adjust: (body: { inventoryId: Id; newQty?: number; delta?: number; reason: string }) => requestRaw("/admin/stock/adjust", { method: "POST", body }),
  /** Zenoti's Current stock / Audit inventory export → this centre's shelf. */
  importPreview: (branchId: Id, file: File) => {
    const form = new FormData(); form.append("file", file); form.append("branchId", String(branchId));
    return request<StockImportResult>("/admin/stock/import/preview", { method: "POST", body: form });
  },
  importCommit: (branchId: Id, file: File, reason?: string) => {
    const form = new FormData(); form.append("file", file); form.append("branchId", String(branchId));
    if (reason) form.append("reason", reason);
    return requestRaw<StockImportResult>("/admin/stock/import", { method: "POST", body: form });
  },
  counts: (q?: Query) => request<StockCount[]>("/admin/stock/counts", { query: q }),
  count: (id: Id) => request<StockCount>(`/admin/stock/counts/${id}`),
  createCount: (body: { branchId?: Id | "none" | "all" | null; category?: string; vendorId?: Id; search?: string; title?: string }) => requestRaw<StockCount>("/admin/stock/counts", { method: "POST", body }),
  updateCount: (id: Id, body: { lines?: { lineId?: Id; inventoryId?: Id; counted: number | null; note?: string }[]; notes?: string; title?: string }) => request<StockCount>(`/admin/stock/counts/${id}`, { method: "PUT", body }),
  submitCount: (id: Id, allowMissing = false) => requestRaw<StockCount>(`/admin/stock/counts/${id}/submit`, { method: "POST", body: { allowMissing } }),
  reconcileCount: (id: Id) => requestRaw<StockCount>(`/admin/stock/counts/${id}/reconcile`, { method: "POST" }),
  cancelCount: (id: Id, reason?: string) => requestRaw<StockCount>(`/admin/stock/counts/${id}/cancel`, { method: "POST", body: { reason } }),
  transfers: (q?: Query) => request<StockTransfer[]>("/admin/stock/transfers", { query: q }),
  transfer: (id: Id) => request<StockTransfer>(`/admin/stock/transfers/${id}`),
  createTransfer: (body: { fromBranchId: Id; toBranchId: Id; kind?: "transfer" | "return"; lines: { inventoryId: Id; qty: number; note?: string }[]; notes?: string; send?: boolean }) => requestRaw<StockTransfer>("/admin/stock/transfers", { method: "POST", body }),
  sendTransfer: (id: Id) => requestRaw<StockTransfer>(`/admin/stock/transfers/${id}/send`, { method: "POST" }),
  receiveTransfer: (id: Id, lines?: { lineId: Id; receivedQty: number }[]) => requestRaw<StockTransfer>(`/admin/stock/transfers/${id}/receive`, { method: "POST", body: { lines } }),
  cancelTransfer: (id: Id, reason?: string) => requestRaw<StockTransfer>(`/admin/stock/transfers/${id}/cancel`, { method: "POST", body: { reason } }),
};

/* ============================ memberships ============================ */
export const memberships = {
  list: (q?: Query) => request<Membership[]>("/memberships", { query: q }),
  get: (id: Id) => request<Membership>(`/memberships/${id}`),
  create: (body: Partial<Membership>) => request<Membership>("/memberships", { method: "POST", body }),
  update: (id: Id, body: Partial<Membership>) => request<Membership>(`/memberships/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Membership>(`/memberships/${id}/toggle`, { method: "PATCH" }),
  members: (q?: Query) => request<MembershipAssignment[]>("/memberships/members", { query: q }),
  member: (id: Id) => request<MembershipAssignment>(`/memberships/members/${id}`),
  /** Grant / sell a plan from the desk without a bill (the bill path is an invoice line). */
  sell: (body: { userId: Id; membershipId: Id; branchId?: Id | null; startDate?: string; paymentMethod?: string; amount?: number; paymentReceived?: boolean; transactionId?: string; notes?: string; autoRenew?: boolean }) =>
    requestRaw<MembershipAssignment>("/memberships/members", { method: "POST", body }),
  updateMember: (id: Id, body: { validUntil?: string | null; notes?: string; autoRenew?: boolean; payment?: { isReceived?: boolean; paymentMethod?: string; transactionId?: string; amountPaid?: number; balanceDue?: number } }) =>
    request<MembershipAssignment>(`/memberships/members/${id}`, { method: "PUT", body }),
  cancelMember: (id: Id, body: { reason: string; refundAmount?: number; refundMethod?: string }) =>
    requestRaw<MembershipAssignment>(`/memberships/members/${id}/cancel`, { method: "POST", body }),
  currentForUser: (userId: Id) => request<GuestMembership | null>(`/memberships/current/${userId}`),
  /** Re-run the Zenoti sale sync for one member (app/desk sales that failed or never reached Zenoti). */
  zenotiPush: (id: Id) => requestRaw<MembershipAssignment>(`/memberships/members/${id}/zenoti-push`, { method: "POST" }),
};

/** Held time on a provider's diary (Zenoti block-outs and desk blocks). */
export const providerBlocks = {
  list: (q: { from: string; to?: string; branchId?: string | null; doctorId?: string | null }) =>
    requestRaw<import("./types").DayBookBlock[]>("/provider-blocks", { query: q as Query }),
  create: (body: { date: string; startTime: string; endTime: string; doctorId?: string | null; adminId?: Id | null; branchId?: Id | null; title?: string; notes?: string; color?: string | null }) =>
    request<import("./types").DayBookBlock>("/provider-blocks", { method: "POST", body }),
  update: (id: Id, body: { date?: string; startTime?: string; endTime?: string; title?: string; notes?: string; color?: string | null }) =>
    request<import("./types").DayBookBlock>(`/provider-blocks/${id}`, { method: "PUT", body }),
  remove: (id: Id) => request<import("./types").DayBookBlock>(`/provider-blocks/${id}`, { method: "DELETE" }),
};

export const analytics = {
  /** Zenoti's "Today's sales" register: every payment taken on a clinic day. */
  todaySales: (q?: { date?: string; branchId?: string | null }) =>
    request<TodaysSales>("/admin/analytics/sales/today", { query: (q || {}) as Query }),
  /** Zenoti's "Employee sales": sale-by per invoice line over a range. */
  salesByStaff: (q?: Query) => requestRaw<StaffSalesRow[]>("/admin/analytics/sales/by-staff", { query: q }) as Promise<Envelope<StaffSalesRow[]> & { totals?: { total: number; staff: number; invoices: number } }>,
  /** One-call clinic dashboard: revenue per stream, counts, dermatologist board. */
  dashboard: (q?: Query) => request<Dashboard>("/admin/analytics/dashboard", { query: q }),
  financial: (q?: Query) => request<FinancialAnalytics>("/admin/analytics/financial", { query: q }),
  monthlyRevenue: (q?: Query) => request<{ month: string; revenue: number }[]>("/admin/analytics/revenue/monthly", { query: q }),
  dailyTarget: () =>
    request<{ dailyTarget: number; todayCollection: number; progressPercentage: number; difference: number; achieved: boolean }>(
      "/admin/analytics/target/daily",
    ),
  patients: (q?: Query) => request<PatientAnalytics>("/admin/analytics/patients", { query: q }),
  patientAcquisition: () => request<{ month: string; count: number }[]>("/admin/analytics/patients/acquisition"),
  topPatients: (limit = 5, q?: Query) =>
    request<{ _id: Id; fullName: string; totalSpent: number; visits?: number }[]>("/admin/analytics/patients/top", {
      query: { limit, ...(q ?? {}) },
    }),
  demographics: () =>
    request<{ ageGroups: { group: string; count: number }[]; gender: Record<string, number> }>(
      "/admin/analytics/patients/demographics",
    ),
  sources: () => request<{ source: string; count: number; percentage: number }[]>("/admin/analytics/patients/sources"),
  sendBirthdayWish: (userId: Id) =>
    requestRaw(`/admin/analytics/patients/${userId}/birthday-wish`, { method: "POST" }),
  appointments: (q?: Query) => request<AppointmentAnalytics>("/admin/analytics/appointments", { query: q }),
  services: (q?: Query) => request<ServiceAnalytics>("/admin/analytics/services", { query: q }),
  inventory: (q?: Query) => request<InventoryAnalytics>("/admin/analytics/inventory", { query: q }),
};

/* ============================ governance ============================ */
export const audit = {
  list: (q?: Query) =>
    requestRaw<AuditEntry[]>("/admin/audit-logs", { query: q }),
  actions: () => request<{ actions: string[]; resources: string[]; admins: string[] }>("/admin/audit-logs/actions"),
  suspicious: (q?: Query) => requestRaw<AuditEntry[]>("/admin/audit-logs/suspicious", { query: q }),
  record: (body: { action: string; resource?: string; resourceId?: string; details?: Record<string, unknown> }) =>
    requestRaw("/admin/audit-logs", { method: "POST", body }),
};

/** Delivery report for sign-in details: 'sent', 'skipped: …' or 'failed: …' per channel. */
export type CredentialDelivery = { email: string | null; whatsapp: string | null };
export type CredentialChannel = "email" | "whatsapp" | "both" | "none";

export const staff = {
  list: (q?: Query) => requestRaw<Admin[]>("/admin/staff", { query: q }),
  roles: () => request<{ id: string; label: string; description?: string }[]>("/admin/staff/roles"),
  create: (body: {
    email: string; name?: string; role: string; doctorId?: Id | null; phone?: string | null; branchId?: Id | null; branchIds?: Id[];
    customRoleId?: Id | null; permissions?: PermissionKey[]; jobTitle?: string | null; assignments?: StaffAssignment[];
    password?: string; generatePassword?: boolean; mustChangePassword?: boolean; notify?: CredentialChannel;
  }) =>
    requestRaw<Admin>("/admin/staff", { method: "POST", body }) as Promise<Envelope<Admin> & { temporaryPassword?: string; delivery?: CredentialDelivery | null }>,
  update: (id: Id, body: Partial<Admin>) => request<Admin>(`/admin/staff/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Admin>(`/admin/staff/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/admin/staff/${id}`, { method: "DELETE" }),
  /** Zenoti "Update Password": set a chosen or generated password. A generated one comes back once. */
  setPassword: (id: Id, body: { password?: string; generate?: boolean; mustChange?: boolean; notify?: CredentialChannel }) =>
    requestRaw<Admin>(`/admin/staff/${id}/password`, { method: "PUT", body }) as Promise<Envelope<Admin> & { temporaryPassword?: string; delivery?: CredentialDelivery }>,
  /** Zenoti "Reset Password": issue a temporary password and send it by email / WhatsApp. */
  sendCredentials: (id: Id, channel: Exclude<CredentialChannel, "none">) =>
    requestRaw<Admin>(`/admin/staff/${id}/send-credentials`, { method: "POST", body: { channel } }) as Promise<Envelope<Admin> & { temporaryPassword?: string; delivery?: CredentialDelivery }>,
  /** Copy this account's access onto a new person. */
  clone: (id: Id, body: { email: string; name?: string; phone?: string | null }) =>
    requestRaw<Admin>(`/admin/staff/${id}/clone`, { method: "POST", body }),
  /** End employment on a date, with a reason; sign-in ends on that date. */
  terminate: (id: Id, body: { reason: string; effectiveAt?: string }) =>
    requestRaw<Admin>(`/admin/staff/${id}/terminate`, { method: "POST", body }),
};

/* ============================ zenoti (CRM) ============================ */
export type ZenotiServiceBalance = {
  name: string | null; total: number | null; used: number | null; balance: number | null; expiryDate?: string | null;
};
export type ZenotiOverview = {
  guestId: string;
  profile: {
    fullName: string; email: string | null; phone: string | null;
    gender: string; dateOfBirth: string | null;
    centerName: string | null; branchName: string; code: string | null;
    preferredName?: string | null; memberSince?: string | null; anniversaryDate?: string | null;
    isMinor?: boolean; isVirtualGuest?: boolean; isOnlineBookingBlocked?: boolean;
    isClassBookingBlocked?: boolean; isBlockedForNoShow?: boolean;
    preferences?: Record<string, unknown> | null; tags?: unknown; referral?: unknown;
    primaryEmployee?: unknown; guestPasses?: unknown; milestoneDetails?: unknown; additionalDetails?: unknown;
    emergencyContact?: { firstName?: string | null; lastName?: string | null; phone?: string | null };
    address?: { line1: string | null; city: string | null; state: string | null; zip: string | null };
  } | null;
  appointments: { serviceName: string | null; startTime: string | null; durationMinutes: number | null; therapistName: string | null; centerName: string | null; price: number | null; membershipApplied: boolean }[];
  orders: { name: string | null; quantity: number | null; saleDate: string | null; price: number | null; paymentType: string | null; soldBy: string | null; centerName: string | null; invoiceNumber: string | null }[];
  memberships: { name: string | null; code: string | null; status: number | string | null; memberSince: string | null; expiryDate: string | null; creditBalance: number | null; centerName: string | null; services: ZenotiServiceBalance[]; products?: ZenotiServiceBalance[]; isRefunded?: boolean; recurrenceStatus?: number | string | null; redeemable?: boolean | null; isAddonMember?: boolean; guestPassType?: string | null; guestPassTotal?: number | null; guestPassBalance?: number | null; htmlBenefits?: string | null }[];
  packages: { name: string | null; status: number | null; purchaseDate: string | null; startDate: string | null; endDate: string | null; neverExpires: boolean; price: number | null; centerName: string | null; services: ZenotiServiceBalance[]; products?: ZenotiServiceBalance[]; sessionsTotal: number | null; sessionsRemaining: number | null; redeemable?: boolean | null; totalPayment?: number | null; isFrozen?: boolean; restrictRedemptionToCenter?: boolean }[];
  notes: { id?: string | null; text: string | null; type?: string | number | null; isPrivate?: boolean; isProfileAlert?: boolean; createdAt?: string | null; createdBy?: string | null; centerName?: string | null }[];
  forms: { id?: string | null; name: string | null; status: number | string | null; isExpired?: boolean; lastFilledAt?: string | null; lastFilledBy?: string | null; formType?: number | string | null; viewOnly?: boolean; formUrl?: string | null; history?: unknown[] }[];
};

export type ZenotiAppointment = ZenotiOverview["appointments"][number] & {
  id?: string | null; endTime?: string | null; notes?: string | null;
  status?: number | string | null; packageName?: string | null; roomName?: string | null;
  equipmentName?: string | null; invoiceNumber?: string | null; hasServiceForm?: boolean;
};
export type ZenotiOrder = ZenotiOverview["orders"][number] & { id?: string | null };
export type ZenotiMembership = ZenotiOverview["memberships"][number] & { id?: string | null };
export type ZenotiPackage = ZenotiOverview["packages"][number] & { id?: string | null };
export type ZenotiNote = ZenotiOverview["notes"][number];
export type ZenotiForm = ZenotiOverview["forms"][number];

export type ZenotiStats = {
  treatmentsDone: number; upcoming: number; productsBought: number; notes?: number; forms?: number; activePackages: number;
  sessionsLeft: number; activeMemberships: number; lifetimeSpend: number;
  lastVisit?: string | null; nextVisit?: string | null;
};
/** The locally mirrored Zenoti history of one customer (ZenotiGuestData). */
export type ZenotiGuestDetails = {
  userId: Id; zenotiGuestId: string; centerId?: string | null; branchName?: string | null;
  profile?: ZenotiOverview["profile"];
  appointments: ZenotiAppointment[]; orders: ZenotiOrder[]; memberships: ZenotiMembership[]; packages: ZenotiPackage[];
  notes: ZenotiNote[]; forms: ZenotiForm[];
  sectionStatus?: Record<string, { syncedAt?: string | null; attemptedAt?: string | null; count?: number; error?: string | null }>;
  stats: ZenotiStats; syncedAt?: string | null; lastError?: string | null;
};
export type ZenotiUserData = { user: User; linked: boolean; details: ZenotiGuestDetails | null };
export type ZenotiSyncRun = {
  _id: Id; type: "roster" | "details" | "appointments"; mode?: "incremental" | "full"; status: "running" | "completed" | "failed"; trigger: string;
  startedAt: string; finishedAt?: string | null; total: number; processed: number; created: number;
  updated: number; skipped: number; failed: number; error?: string | null;
};
export type ZenotiCatalogService = { id: string; code?: string | null; name: string; canBook?: boolean | null; price?: number | null; durationMinutes?: number | null; categoryName?: string | null };
export type ZenotiCatalogPackage = { id: string; code?: string | null; name: string; type?: number | null; active?: boolean };
export type ZenotiReadiness = {
  writeMode: string; lifecycleWriteback: boolean; breaker: ZenotiWriteBreaker;
  updatedByConfigured: boolean; referralSourceConfigured: boolean;
  unmappedServices: string[]; unmappedPackages: string[];
  /** Active dermatologists with no Zenoti employee link — their bookings are refused. */
  unlinkedDermatologists?: string[];
  clinics: { centerId: string; name: string; schedulesPublished: boolean | null; shiftsWorking: number; shiftsTotal: number;
    servicesInCatalogue: number; bookableServices: number; servicesResolved: number; servicesTotal: number;
    packagesResolved: number; packagesTotal: number; zenotiPackages: number }[];
  checkedAt: string;
};
export type ZenotiWriteBreaker = {
  tripped: boolean; at?: string | null; reason?: string | null; lastAction?: string | null;
  writesLast15Min: number; writesLastHour: number; limit15Min: number; limitHour: number;
};
export type ZenotiSyncStatus = {
  configured: boolean; writeMode: string; lifecycleWriteback?: boolean; writeBreaker?: ZenotiWriteBreaker; linkedUsers: number; mirrored: number; freshWithin24h: number; withErrors: number;
  rosterRunning: boolean; detailsRunning: boolean; fullImportRunning: boolean; appointmentSyncRunning?: boolean;
  sectionCoverage: Record<string, number>; supportedDatasets: string[];
  providerLimitations: { key: string; label: string; reason: string }[];
  lastRoster: ZenotiSyncRun | null; lastDetails: ZenotiSyncRun | null; lastAppointments?: ZenotiSyncRun | null;
  running: ZenotiSyncRun[]; history: ZenotiSyncRun[];
};
/** One unwound row of a customer's mirrored history, with the owning customer attached. */
export type ZenotiListRow<T> = {
  userId: Id; branchName?: string | null; syncedAt?: string | null;
  user: Pick<User, "_id" | "patientId" | "fullName" | "email" | "phone" | "location" | "memberType" | "source">;
  item: T;
};
type ZenotiListEnvelope<T> = { success: boolean; data: ZenotiListRow<T>[]; total: number; page: number; limit: number };
export type ReportingPractitioner = {
  filterValue: string; name: string; source: "app" | "zenoti" | "app+zenoti"; onboarded: boolean;
  doctorId?: string | null; zenotiEmployeeId?: string | null; centers: string[]; historical?: boolean;
  bookings?: number; revenue?: number; lastVisit?: string | null;
};

/** A membership as Zenoti's catalog lists it. The Zen-family flags/fields arrive with the newer backend; older responses omit them. */
export type ZenotiCatalogMembership = {
  id: string; versionId: string | null; name: string; price: number | null; discountedPrice: number | null; description: string | null; imagePaths: string[];
  code?: string | null; isActive?: boolean | null; durationMonths?: number | null; htmlBenefits?: string | null; terms?: string | null; isZenFamily?: boolean;
};
export const zenoti = {
  /** Zenoti's membership products — name, price, images — for the membership card to pick from. */
  catalogMemberships: () => request<ZenotiCatalogMembership[]>("/admin/zenoti/catalog/memberships"),
  /** Mirror Zenoti products (attributes only; stock is not in the feed). */
  syncProducts: () => request<Record<string, unknown>>("/admin/zenoti/products/sync", { method: "POST" }),
  /** Mirror the clinics' address, phone, email and map pin from Zenoti. */
  syncCenters: () => request<Record<string, unknown>>("/admin/zenoti/centers/sync", { method: "POST" }),
  /** Mirror Zenoti's category list (linked by id; new ones arrive hidden). */
  syncCategories: () => request<Record<string, unknown>>("/admin/zenoti/categories/sync", { method: "POST" }),
  /** Mirror Zenoti services + packages now (read-only against Zenoti). */
  syncCatalog: () => request<Record<string, unknown>>("/admin/zenoti/catalog/sync", { method: "POST" }),
  /** Last run of every inbound mirror + the outbound backlog. */
  syncHealth: () => request<{
    checkedAt: string; writeMode: string; lifecycleWriteback: boolean;
    breaker?: Record<string, unknown>;
    inbound: { type: string; label: string; every: string; last: null | { status: string; startedAt: string; finishedAt?: string | null; created?: number; updated?: number; failed?: number; error?: string | null } }[];
    outbound: Record<string, number | string>;
  }>("/admin/zenoti/sync-health"),
  /** Legacy by-phone/email lookup of a live Zenoti record. */
  overview: (q: { phone?: string; email?: string; guestId?: string }) =>
    request<ZenotiOverview>("/admin/zenoti/overview", { query: q }),
  status: () => request<ZenotiSyncStatus>("/admin/zenoti/status"),
  /** Mirror every Zenoti guest into Patients (runs in the background). */
  import: () => request<unknown>("/admin/zenoti/import", { method: "POST" }),
  /** Refresh history for the N least-recently synced customers. */
  crawl: (limit?: number) => request<unknown>("/admin/zenoti/crawl", { method: "POST", body: { limit } }),
  syncAppointments: () => request<unknown>("/admin/zenoti/appointments/sync", { method: "POST" }),
  resetWriteBreaker: () => request<unknown>("/admin/zenoti/write-breaker/reset", { method: "POST" }),
  catalogServices: (q?: Query) => request<ZenotiCatalogService[]>("/admin/zenoti/catalog/services", { query: q }),
  catalogPackages: (q?: Query) => request<ZenotiCatalogPackage[]>("/admin/zenoti/catalog/packages", { query: q }),
  readiness: () => request<ZenotiReadiness>("/admin/zenoti/readiness"),
  /** Publish dermatologists' panel hours into Zenoti as Working shifts (dryRun returns the plan). */
  publishDoctorHours: (body?: { days?: number; doctorId?: string; dryRun?: boolean }) =>
    request<{ planned: number; written: number; alreadyWorking: number; failed: number; dryRun: boolean; wouldWrite?: number; errors: string[]; mode: string }>("/admin/zenoti/publish-doctor-hours", { method: "POST", body: body ?? {} }),
  /** App doctors + Zenoti-only doctors for reporting filters; never an app roster endpoint. */
  practitioners: () => request<ReportingPractitioner[]>("/admin/zenoti/practitioners"),
  syncPractitioners: () => request<unknown>("/admin/zenoti/practitioners/sync", { method: "POST" }),
  /** Create the app dermatologist for a Zenoti doctor and link the two. */
  onboardPractitioner: (employeeId: string, body?: { name?: string; tier?: string; availableCentres?: string[]; email?: string; password?: string }) =>
    request<unknown>(`/admin/zenoti/practitioners/${employeeId}/onboard`, { method: "POST", body: body ?? {} }),
  user: (userId: Id, refresh?: boolean) =>
    request<ZenotiUserData>(`/admin/zenoti/users/${userId}`, { query: refresh ? { refresh: "1" } : undefined }),
  syncUser: (userId: Id) => request<ZenotiUserData>(`/admin/zenoti/users/${userId}/sync`, { method: "POST" }),
  packages: (q?: Query) => requestRaw<ZenotiListRow<ZenotiPackage>[]>("/admin/zenoti/packages", { query: q }) as Promise<ZenotiListEnvelope<ZenotiPackage> & { summary?: { activePackages: number; sessionsLeft: number; customers: number } }>,
  appointments: (q?: Query) => requestRaw<ZenotiListRow<ZenotiAppointment>[]>("/admin/zenoti/appointments", { query: q }) as Promise<ZenotiListEnvelope<ZenotiAppointment>>,
  memberships: (q?: Query) => requestRaw<ZenotiListRow<ZenotiMembership>[]>("/admin/zenoti/memberships", { query: q }) as Promise<ZenotiListEnvelope<ZenotiMembership>>,
  orders: (q?: Query) => requestRaw<ZenotiListRow<ZenotiOrder>[]>("/admin/zenoti/orders", { query: q }) as Promise<ZenotiListEnvelope<ZenotiOrder>>,
  notes: (q?: Query) => requestRaw<ZenotiListRow<ZenotiNote>[]>("/admin/zenoti/notes", { query: q }) as Promise<ZenotiListEnvelope<ZenotiNote>>,
  forms: (q?: Query) => requestRaw<ZenotiListRow<ZenotiForm>[]>("/admin/zenoti/forms", { query: q }) as Promise<ZenotiListEnvelope<ZenotiForm>>,
};

/* ============================ contact-change (email/phone) ============================ */
export type ContactChangeRow = {
  id: string;
  customer: { id: string; fullName: string; patientId?: string } | null;
  type: "email" | "phone";
  status: "awaiting_verification" | "verified" | "scheduled" | "applied" | "cancelled" | "failed";
  from: string | null;
  to: string | null;
  scheduledApplyAt: string | null;
  appliedAt: string | null;
  failureReason: string | null;
  createdAt: string;
};
/* ============================ banners ============================ */
export const banners = {
  list: (q?: Query) => requestRaw<Banner[]>("/banners", { query: q }),
  get: (id: Id) => request<Banner>(`/banners/${id}`),
  create: (form: FormData) => request<Banner>("/banners", { method: "POST", body: form }),
  update: (id: Id, form: FormData) => request<Banner>(`/banners/${id}`, { method: "PUT", body: form }),
  remove: (id: Id) => requestRaw(`/banners/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Banner>(`/banners/${id}/toggle`, { method: "PATCH" }),
  reorder: (order: { id: Id; order: number }[]) => requestRaw("/banners/reorder", { method: "POST", body: { banners: order } }),
};

export const contactChange = {
  /** Read-only list of customer email/phone change requests (they auto-apply). */
  list: (q?: { status?: string; type?: string }) =>
    request<ContactChangeRow[]>("/admin/contact-change-requests", { query: q }),
};

/** RBAC — custom roles & the permission catalog. */
export const roles = {
  /** The permission catalog (groups + keys) the server enforces. */
  catalog: () => request<{ groups: PermissionGroup[] }>("/admin/roles/catalog"),
  list: () => request<Role[]>("/admin/roles"),
  create: (body: { name: string; description?: string; color?: string; permissions: PermissionKey[] }) =>
    requestRaw<Role>("/admin/roles", { method: "POST", body }),
  update: (id: Id, body: Partial<Pick<Role, "name" | "description" | "color" | "permissions" | "isActive">>) =>
    request<Role>(`/admin/roles/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/roles/${id}`, { method: "DELETE" }),
};

export const api = {
  auth, branches, patients, bookings, services, serviceTypes, categories, packages, packageAssignments, consultationNotes,
  doctors, availability, productAvailability, patientPhotos, purchaseOrders, bulk, formTemplates, schedules, feeRequests, products, brands, formulations, coupons, orders, inventory, vendors,
  appStudio, media, chat, notifications, reviews, support, preConsult, consentForms,
  serviceCards, analytics, audit, staff, zenoti, contactChange, banners, security, roles, providerBlocks, invoices, memberships, stockControl, templates,
};

export default api;
