/** Shapes returned by the Zennara backend, mirrored from Backend/models. */

export type Id = string;

/* ---------------- auth ---------------- */
/**
 * Server-side roles. 'super_admin' holds every permission; 'doctor'/'therapist'
 * back their own panels; 'staff' is a general admin-panel account whose access
 * is defined by an assigned custom role + direct permission grants.
 */
export type AdminRole = "super_admin" | "doctor" | "therapist" | "staff";
export type Admin = {
  _id: Id;
  email: string;
  name: string;
  role: AdminRole;
  phone?: string | null;
  /** Profile photo (S3 URL) shown in the top bar. */
  photo?: string | null;
  /** Home centre for floor staff (therapists) — pins their panel to it. */
  branchId?: Id | null;
  /** Centres a therapist works at (like a dermatologist's availableCentres). */
  branchIds?: Id[];
  /** True once a password is set. */
  hasPassword?: boolean;
  /** False when a password is set but only as a hash — it can be reset, not shown. */
  canRevealPassword?: boolean;
  passwordSetAt?: string | null;
  isActive: boolean;
  lastLogin?: string;
  /** Explicit link to a Doctor profile for role `doctor` logins. */
  doctorId?: Id | null;
  /** False when the address is missing from the server's ADMIN_EMAILS allow-list. */
  canSignIn?: boolean;
  /** Walkthroughs this account has already completed (server-held, not per-browser). */
  toursSeen?: string[];
  createdAt?: string;
  /* ---- RBAC ---- */
  /** Super admins implicitly hold every permission. */
  isSuperAdmin?: boolean;
  /** Assigned custom role (staff accounts only). */
  customRoleId?: Id | null;
  roleKey?: string | null;
  roleName?: string | null;
  /** Effective permission keys the server resolved for this account. */
  permissions?: string[];
  /** Which centres each permission applies to, from per-centre assignments. */
  permissionsByBranch?: Record<string, string[]>;
  /* ---- staff record (Zenoti employee parity) ---- */
  /** Job title for display and reports — separate from what the account may do. */
  jobTitle?: string | null;
  /** Per-centre role assignments; a deputation is a dated temporary posting. */
  assignments?: StaffAssignment[];
  /** True after an admin-issued temporary password until the person picks their own. */
  mustChangePassword?: boolean;
  loginMethod?: "password" | "otp";
  loginMethods?: ("password" | "otp")[];
  terminatedAt?: string | null;
  terminationReason?: string | null;
};

/** "Receptionist at Jubilee Hills" — one row of a staff member's centre assignments. */
export type StaffAssignment = {
  branchId: Id;
  roleId?: Id | null;
  roleName?: string | null;
  kind?: "primary" | "deputation";
  from?: string | null;
  to?: string | null;
  note?: string;
};

/** A permission key like `bookings.manage`. */
export type PermissionKey = string;
/** One permission in the catalog. */
export type CatalogPermission = { key: PermissionKey; label: string; sensitive?: boolean };
/** A sidebar-aligned group of permissions. */
export type PermissionGroup = { key: string; label: string; permissions: CatalogPermission[] };
/** A custom staff role — a named bundle of permissions. */
export type Role = {
  _id: Id;
  key: string;
  name: string;
  description?: string;
  color?: string;
  permissions: PermissionKey[];
  isSystem?: boolean;
  isActive?: boolean;
  staffCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

/** A deleted customer account, kept in full so staff can restore it. */
export type DeletedAccount = {
  _id: Id;
  originalUserId: Id;
  email?: string;
  phone?: string;
  fullName?: string;
  patientId?: string;
  deletedAt: string;
  deletedBy: "user" | "admin";
  reason?: string;
  counts?: Record<string, number>;
  restoredAt?: string | null;
};

/** A home-screen banner managed from the panel (Banner model). */
export type Banner = {
  _id: Id;
  title: string;
  mediaType: "image" | "video";
  image?: string | null;
  videoFile?: string | null;
  videoUrl?: string | null;
  linkType?: "none" | "internal" | "external";
  internalScreen?: string | null;
  externalUrl?: string | null;
  order?: number;
  isActive: boolean;
  createdAt?: string;
};

/** One row of the stock ledger. */
export type StockMovement = {
  _id: Id;
  inventoryId: Id;
  inventoryName?: string;
  batchNo?: string;
  type: "consume" | "wastage" | "receive" | "adjust" | "sale" | "return";
  delta: number;
  before: number;
  after: number;
  reason?: string;
  bookingId?: Id | null;
  adminEmail?: string;
  createdAt: string;
};

/* ---------------- org ---------------- */
export type Branch = {
  _id: Id;
  name: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | string;
  /** `phone` is a list — a centre usually has more than one line. */
  contact?: { phone?: string[]; email?: string };
  location?: { type?: string; coordinates?: number[] };
  operatingHours?: Record<string, { open?: string; close?: string; openTime?: string; closeTime?: string; isOpen?: boolean }>;
  /** Holidays / "closed today" — YYYY-MM-DD, optional `to` for a range. */
  closures?: { _id?: Id; date: string; to?: string | null; reason?: string; createdBy?: string | null }[];
  slotDuration?: number;
  /** Organisation tree + the legal block printed on GST receipts. */
  zone?: string;
  isPharmacy?: boolean;
  invoicePrefix?: string | null;
  gstin?: string | null;
  pan?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  messaging?: { whatsappEnabled?: boolean; zenotiSendsGuestMessages?: boolean; whatsappNumber?: string | null };
  /** clinic = bookable; pharmacy = retail stock and pharmacy bills; training = Zenoti's practice centre. */
  centreType?: "clinic" | "pharmacy" | "training";
  parentBranchId?: Id | null;
  isActive: boolean;
  displayOrder?: number;
  description?: string;
  amenities?: string[];
  images?: string[];
  createdAt?: string;
  updatedAt?: string;
};

/* ---------------- people ---------------- */
/** The desk strip GET /users/:id returns: visits, last visit, usual doctor, open bookings, dues. */
export type GuestStats = {
  totalVisits: number;
  lastVisitAt?: string | null;
  lastVisitService?: string | null;
  usualDoctor?: { doctorId?: string | null; name?: string | null; visits: number } | null;
  openBookings: number;
  nextBookingAt?: string | null;
  amountDue: number;
  amountDueBreakdown?: { bookings: number; packages: number };
  activePackages: { name: string | null; remaining: number | null; total: number | null; validUntil: string | null }[];
  membership?: { active: boolean; expiresAt: string | null } | null;
  referralSource?: string | null;
  totalSpent?: number;
};

/** One dermatologist's row on the desk day book. */
export type DayBookProvider = {
  doctorId: string; name: string; tier?: string; designation?: string; photo?: string | null; displayOrder?: number;
  onlineBookingEnabled?: boolean; configured: boolean; onLeave: boolean; note?: string; source?: string | null;
  ranges: { start: string; end: string }[];
  blocks: DayBookBlock[];
};
export type DayBookBlock = { _id: Id; startTime: string; endTime: string; title: string; notes?: string; source: "zenoti" | "panel"; color?: string | null; providerName?: string; zenotiEmployeeId?: string | null };
export type DayBook = {
  date: string;
  branch: { _id: Id; name: string; open: string | null; close: string | null } | null;
  providers: DayBookProvider[];
  otherBlocks: DayBookBlock[];
};

export type User = {
  _id: Id;
  patientId?: string;
  /** How the guest found the clinic (asked once at the desk). */
  referralSource?: string | null;
  referredByUserId?: Id | null;
  lastVisitAt?: string | null;
  stats?: GuestStats | null;
  fullName: string;
  email: string;
  phone: string;
  location?: string;
  memberType?: "Zen Member" | "Regular Member";
  /** 'app' = registered in the app; 'zenoti' = mirrored from the clinic CRM. Both are app users. */
  source?: "app" | "zenoti" | "reception";
  zenotiGuestId?: string | null;
  /** Whether Zenoti holds this patient; 'review' = phone matched but the name did not. */
  zenotiSyncStatus?: "pending" | "synced" | "failed" | "review" | "skipped" | "dryrun" | null;
  zenotiSyncError?: string | null;
  zenotiSyncedAt?: string | null;
  zenMembershipStartDate?: string | null;
  zenMembershipExpiryDate?: string | null;
  zenMembershipAutoRenew?: boolean;
  zenMembershipSource?: "app" | "admin" | "zenoti" | null;
  zenMembershipPlan?: string | null;
  zenMembershipMonths?: number | null;
  zenMembershipAmount?: number | null;
  zenMembershipPaymentMethod?: string | null;
  zenMembershipPaymentStatus?: "paid" | "pending" | null;
  zenMembershipGrantedBy?: string | null;
  zenotiMembershipInvoiceId?: string | null;
  zenotiMembershipSyncStatus?: "pending" | "synced" | "dryrun" | "skipped" | "failed" | null;
  zenotiMembershipSyncError?: string | null;
  dateOfBirth?: string;
  gender?: string;
  medicalHistory?: string;
  /** Ticked by the guest on the app's Allergies screen. */
  hasDrugAllergy?: boolean;
  drugAllergies?: string;
  dietaryPreferences?: string[];
  smoking?: string;
  drinking?: string;
  additionalInfo?: string;
  profilePicture?: string | { url?: string };
  isVerified?: boolean;
  isActive?: boolean;
  totalVisits?: number;
  appOpenCount?: number;
  totalSpent?: number;
  upcomingAppointments?: number;
  createdAt?: string;
  lastLogin?: string | null;
};

/* ---------------- bookings ---------------- */
export type BookingStatus =
  | "Awaiting Confirmation"
  | "Confirmed"
  | "Rescheduled"
  | "In Progress"
  | "Cancelled"
  | "No Show"
  | "Completed";

export type VisitCodeLog = { kind: "checkin" | "checkout"; channels: string[]; failed?: string[]; at: string; byName?: string | null };
export type ManualCheck = { reason: string; byName?: string | null; at: string };

export type ConsultationStage =
  | "booked" | "confirmed" | "checked_in" | "waiting" | "consultation_started"
  | "consultation_completed" | "prescription_created" | "treatment_recommended"
  | "follow_up_required" | "no_follow_up";

export type Booking = {
  /** Several services booked as one desk visit share this id. */
  visitGroupId?: string | null;
  /** The desk bill that settles this visit, once one exists. */
  invoiceId?: Id | null;
  packageAssignmentId?: Id | null;
  packageSessionId?: Id | null;
  /** Therapist reception assigned to run this session (Admin login id + name). */
  assignedTherapistId?: Id | null;
  assignedTherapistName?: string | null;
  _id: Id;
  isPackageIncluded?: boolean;
  checkInCodeAt?: string | null;
  checkOutCodeAt?: string | null;
  checkInCodeSentAt?: string | null;
  checkOutCodeSentAt?: string | null;
  visitCodeLog?: VisitCodeLog[];
  manualCheckIn?: ManualCheck | null;
  manualCheckOut?: ManualCheck | null;
  referenceNumber?: string;
  userId: Id | User;
  consultationId?: Id | Consultation | null;
  externalServiceName?: string | null;
  externalServiceCategory?: string | null;
  fullName: string;
  mobileNumber: string;
  email: string;
  branchId?: Id | Branch | null;
  preferredLocation: string;
  preferredDate: string;
  preferredTimeSlots: string[];
  specialistId?: string;
  specialistName?: string;
  specialistTier?: string;
  status: BookingStatus;
  confirmedDate?: string;
  /** The appointment's own instant (confirmed → preferred, with time of day). Sort history on this. */
  eventAt?: string | null;
  /**
   * Clinical lifecycle, separate from `status` (see the API's Booking model):
   * waiting → consultation_started → consultation_completed → prescription_created
   * → treatment_recommended → follow_up_required | no_follow_up.
   */
  consultationStage?: ConsultationStage | null;
  consultationStageHistory?: { stage: ConsultationStage; at: string; byName?: string }[];
  followUp?: { required?: boolean; dueDate?: string | null; notes?: string; bookingId?: Id | null };

  confirmedTime?: string;
  checkInTime?: string;
  checkOutTime?: string;
  sessionDuration?: number;
  cancellationReason?: string;
  cancelledAt?: string;
  rescheduledAt?: string;
  rating?: number;
  feedback?: string;
  paymentStatus?: "pending" | "paid" | "failed" | "refunded";
  paymentMethod?: string;
  amount: number;
  paidAt?: string;
  source?: "app" | "reception" | "package" | "zenoti";
  zenotiAppointmentId?: string | null;
  zenotiAppointmentGroupId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "failed" | "skipped" | "dryrun" | null;
  zenotiSyncError?: string | null;
  zenotiInvoiceId?: string | null;
  zenotiTherapistName?: string;
  zenotiLastInboundAt?: string | null;
  /** Snapshot of the Zenoti diary row at the last read. */
  zenotiSource?: {
    status?: number | string | null; progress?: number | null; invoiceNumber?: string | null; receiptNumber?: string | null;
    packageName?: string | null; startTime?: string | null; endTime?: string | null; vanishedAt?: string | null;
    createdByName?: string | null; createdAt?: string | null;
    /** Zenoti's own status, in words, as the mirror recorded it. */
    statusLabel?: string | null;
    checkinTime?: string | null;
  } | null;
  therapistId?: Id | null;
  therapistName?: string;
  room?: string;
  /** What happened in the chair — written at checkout by the therapist. */
  session?: BookingSession;
  notes?: string;
  adminNotes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BookingSession = {
  items?: { inventoryId?: Id; name: string; batchNo?: string; qty: number; unit?: string; rate?: number; billable?: boolean }[];
  wastage?: { inventoryId?: Id; name: string; qty: number; reason?: string }[];
  serviceFee?: number;
  productTotal?: number;
  discount?: number;
  total?: number;
  grading?: string;
  notes?: string;
  therapist?: string;
  completedAt?: string;
};

/* ---------------- catalogue ---------------- */
export type Consultation = {
  _id: Id;
  id: string;
  slug: string;
  /** Level 3 — the sub-category. This document IS the bookable treatment. */
  name: string;
  /** Level 1 — ServiceType.name. */
  type?: string | null;
  /** Level 2 — the treatment category. */
  category: string;
  summary: string;
  about: string;
  key_benefits?: string[];
  ideal_for?: string[];
  price: number;
  /** Service master (mirrors Zenoti): code, timing, tax, per-centre price, prerequisites. */
  code?: string | null;
  duration_minutes?: number | null;
  recovery_minutes?: number | null;
  taxPercent?: number | null;
  priceIncludesTax?: boolean;
  centrePrices?: { branchId: Id; price?: number | null; taxPercent?: number | null; available?: boolean }[];
  eligibleDoctorIds?: string[];
  prerequisites?: { requiresConsultation?: boolean | null; serviceIds?: string[]; withinDays?: number; note?: string };
  consumables?: { inventoryId?: Id | null; productId?: Id | null; name?: string; quantity?: number; unit?: string; autoConsume?: boolean }[];
  addOnIds?: string[];
  packageOnly?: boolean;
  policy?: { cancellationWindowHours?: number | null; cancellationFee?: number | null; noShowFee?: number | null; depositAmount?: number | null };
  zenotiCanBook?: boolean | null;
  cta_label?: string;
  tags?: string[];
  /** Stored as `{ q, a }` — the app reads those keys. */
  faqs?: { q: string; a: string }[];
  pre_care?: string[];
  post_care?: string[];
  image: string;
  media?: { type: string; url: string }[];
  rating?: number | null;
  reviews?: number;
  isActive: boolean;
  /** Zenoti service this is booked as when an app/panel booking is written to Zenoti. */
  zenotiServiceId?: string | null;
  showPriceInApp?: boolean;
  chargeOnlineBooking?: boolean;
  isPopular?: boolean;
  createdAt?: string;
};

/** Level 1 of the service taxonomy — Skin, Hair, Skin & Hair, Wellness, … */
export type ServiceType = {
  _id: Id;
  name: string;
  slug: string;
  description?: string;
  displayOrder?: number;
  isActive: boolean;
  categoryCount?: number;
  treatmentCount?: number;
  /** Present when fetched with `withCategories`. */
  categories?: Category[];
};

/** Level 2 — the treatment category, filed under a type. */
export type Category = {
  _id: Id;
  name: string;
  slug: string;
  /** ServiceType.name this category sits under. */
  type?: string | null;
  displayOrder?: number;
  description?: string;
  isActive: boolean;
  consultationCount?: number;
  createdAt?: string;
};

/** The whole tree in one payload — what the app's treatment page browses. */
export type TaxonomyTree = {
  types: (ServiceType & {
    categories: (Category & { subCategories: Consultation[] })[];
  })[];
  totals: { types: number; categories: number; subCategories: number };
};

export type PackageService = {
  /** Consultation `id` (or `_id`) — the server resolves either. */
  serviceId?: string;
  serviceName?: string;
  servicePrice?: number;
  customPrice?: number;
  sessions?: number;
  /** Zenoti "Order": which benefit a redemption draws from first. */
  redemptionOrder?: number;
  /** Panel-side alias kept for older drafts. */
  name?: string;
  [key: string]: unknown;
};

export type Package = {
  _id: Id;
  id: string;
  name: string;
  description: string;
  /** Months a customer has to use the package after it is assigned (12 = one year). */
  validityMonths?: number;
  taxPercent?: number;
  priceIncludesTax?: boolean;
  benefits?: string[];
  services?: PackageService[];
  consultationServices?: PackageService[];
  price: number;
  originalPrice?: number;
  discount?: number;
  image?: string;
  media?: { type: string; url: string }[];
  isActive: boolean;
  isPopular?: boolean;
  bookingsCount?: number;
  /** Zenoti series package sold when this package is assigned. */
  zenotiPackageId?: string | null;
  /* Zenoti "Create package" terms (2026-09-06) */
  code?: string | null;
  category?: string;
  packageType?: "series" | "custom" | "day" | "offer";
  /** Where the row came from and whether Zenoti still lists it. */
  origin?: "zenoti" | "panel";
  inCatalogue?: boolean;
  contentsKnown?: boolean;
  centres?: { branchId: Id | null; zenotiCenterId?: string | null; branchName?: string }[];
  zenotiCategoryId?: string | null;
  neverExpires?: boolean;
  validityDays?: number | null;
  validityStartsAt?: "sale" | "firstRedemption";
  graceDays?: number;
  closeWhenConsumed?: boolean;
  redemption?: { scope: "organization" | "centres"; branchIds: Id[] };
  centrePrices?: { branchId: Id; price?: number | null; taxPercent?: number | null; available?: boolean }[];
  maxFreezes?: number;
  maxFreezeDays?: number;
  minPartialPaymentPercent?: number;
  agreementText?: string;
  version?: number;
  versions?: { version: number; at: string; by?: string | null; price?: number; validityMonths?: number }[];
  productBenefits?: { productId?: Id | null; name: string; qty: number }[];
  bundledProducts?: { productId?: Id | null; name: string; qty: number }[];
  createdAt?: string;
};

export type PackageAssignment = {
  _id: Id;
  assignmentId: string;
  userId: Id | User;
  packageId: Id | Package;
  packageDetails?: { packageName?: string; packagePrice?: number; originalPrice?: number; services?: PackageService[] };
  userDetails?: { fullName?: string; email?: string; phone?: string; patientId?: string; memberType?: string };
  pricing?: { originalAmount?: number; discountPercentage?: number; discountAmount?: number; finalAmount?: number };
  payment?: { isReceived?: boolean; receivedDate?: string; proofUrl?: string; paymentMethod?: string; transactionId?: string | null; amountPaid?: number | null; balanceDue?: number | null };
  status: "Active" | "Expired" | "Cancelled" | "Completed";
  invoiceId?: Id | null;
  terms?: { version?: number; code?: string | null; validityDays?: number | null; neverExpires?: boolean; validityStartsAt?: "sale" | "firstRedemption"; graceDays?: number; closeWhenConsumed?: boolean; redeemableScope?: "organization" | "centres"; redeemableBranchIds?: string[]; maxFreezes?: number; maxFreezeDays?: number; minPartialPaymentPercent?: number };
  graceUntil?: string | null;
  firstRedeemedAt?: string | null;
  freeze?: { isFrozen?: boolean; frozenAt?: string | null; frozenBy?: string | null; reason?: string | null; resumeOn?: string | null };
  freezeHistory?: { frozenAt: string; resumedAt: string; days: number; by?: string; resumedBy?: string; reason?: string | null }[];
  transfers?: { at: string; by?: string; toUserId?: Id; toUserName?: string; toAssignmentId?: Id; services: { serviceId: string; serviceName?: string; qty: number }[]; reason?: string | null }[];
  transferredFrom?: { assignmentId?: Id | null; userId?: Id | null; userName?: string | null; at?: string | null };
  redemptions?: { at: string; serviceId: string; serviceName?: string | null; sessionId?: Id; bookingId?: Id; invoiceId?: Id; invoiceNumber?: string; byName?: string; reversed?: boolean }[];
  refund?: { refundedAt?: string | null; amount?: number | null; method?: string | null; reference?: string | null; reason?: string | null; byName?: string | null };
  validFrom?: string;
  validUntil?: string | null;
  // Where the package's sessions run — clinic the auto-created appointments land at.
  preferredLocation?: string;
  branchId?: Id | null;
  // One entry per dated session. 24h before each `scheduledDate` the backend
  // auto-creates the appointment and links it here.
  sessions?: PackageSession[];
  usageTracking?: { totalSessions?: number; usedSessions?: number; remainingSessions?: number };
  notes?: string;
  assignedByName?: string;
  zenotiPackageId?: string | null;
  zenotiInvoiceId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "dryrun" | "skipped" | "failed" | "review" | null;
  zenotiSyncError?: string | null;
  completedServices?: { serviceId: string; completedAt: string; prescriptions?: string[] }[];
  createdAt?: string;
};

export type PackageSession = {
  _id?: Id;
  serviceId?: string;
  serviceName?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  /** Dermatologist the clinic picked for this session. */
  specialistId?: string | null;
  specialistName?: string | null;
  specialistTier?: string | null;
  status?: "Scheduled" | "Booked" | "Completed" | "Cancelled";
  bookingId?: Id | null;
  bookingCreatedAt?: string | null;
  completedAt?: string | null;
};

/* ---------------- doctors ---------------- */
export type DoctorTier = "senior-consultant" | "consultant-dermatologist";

export type Doctor = {
  _id: Id;
  /** Stable slug shared with the mobile app and DermatologistAvailability. */
  doctorId: string;
  name: string;
  photo?: string | null;
  tier: DoctorTier;
  /** Two levels only, mirroring the two fee tiers. */
  level?: "senior" | "dermatologist";
  designation?: string | null;
  /** Home branch name; `availableCentres` drives where they can be booked. */
  branch?: string | null;
  availableCentres?: string[];
  qualifications?: string[];
  experienceYears?: number;
  experienceNote?: string | null;
  expertise?: string[];
  achievements?: string[];
  /** Per-doctor consultation fee; falls back to the tier fee when 0/absent. */
  fee?: number;
  email?: string | null;
  phone?: string | null;
  displayOrder?: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type FeeRequestStatus = "Pending" | "Approved" | "Rejected" | "Withdrawn";

export type DoctorFeeRequest = {
  _id: Id;
  doctorId: string;
  doctorName: string;
  requestedByEmail?: string | null;
  /** What they were effectively charging when they asked. */
  currentFee: number;
  currentFeeWasTierFee?: boolean;
  requestedFee: number;
  reason: string;
  status: FeeRequestStatus;
  /** Set on approval — may differ from requestedFee if the admin adjusted it. */
  approvedFee?: number | null;
  reviewedByEmail?: string | null;
  reviewNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
};

/** The signed-in doctor's own pricing position. */
export type MyFee = {
  linked: boolean;
  doctorId?: string;
  doctorName?: string;
  tier?: DoctorTier;
  standardFee?: number | null;
  effectiveFee?: number | null;
  hasOverride?: boolean;
  pendingRequest?: DoctorFeeRequest | null;
};

export type SupportMessage = {
  _id: Id;
  userId?: Id | User | null;
  name: string;
  email: string;
  phone: string;
  location?: string;
  subject: string;
  message: string;
  status: "pending" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  adminNotes?: { note: string; addedAt: string }[];
  resolvedAt?: string;
  createdAt: string;
};

/* ---------------- commerce ---------------- */
export type Product = {
  _id: Id;
  name: string;
  description: string;
  formulation: string;
  OrgName: string;
  code?: string;
  price: number;
  gstPercentage: number;
  mrp?: number | null;
  hsn?: string | null;
  isRx?: boolean | null;
  rxReason?: string | null;
  trackStock?: boolean;
  isRetail?: boolean | null;
  productType?: string | null;
  productCategory?: string | null;
  productSubCategory?: string | null;
  packSize?: string | null;
  sku?: string | null;
  brand?: string | null;
  barcodes?: string[];
  isKit?: boolean;
  /** Centres that list this product, from Zenoti's per-centre feed. */
  centres?: { branchId: Id | null; zenotiCenterId?: string | null; branchName?: string }[];
  zenotiProductId?: string | null;
  image?: string;
  stock: number;
  rating?: number;
  reviews?: number;
  isActive: boolean;
  isPopular?: boolean;
  createdAt?: string;
};

/**
 * A product as a dermatologist may see it — availability, never money.
 * Served by GET /api/inventory/availability, which does not select the price
 * columns at all, so no price is present to leak.
 */
export type ProductAvailability = {
  _id: Id;
  source: "product" | "inventory";
  name: string;
  sku: string | null;
  category: string | null;
  productType: string | null;
  formulation: string | null;
  brand: string | null;
  image?: string;
  /** Across the business. */
  totalQuantity: number;
  /** At the selected branch; null when no branch was requested. */
  branchQuantity: number | null;
  quantity: number;
  /** available = stock is not counted for this item (Zenoti exposes none); orderable, check the shelf. */
  status: "in_stock" | "low_stock" | "out_of_stock" | "available";
  syncedFromZenoti: boolean;
  zenotiSyncedAt?: string | null;
};

/** A clinical photograph in a patient's timeline (before / during / after). */
export type PatientPhoto = {
  _id: Id;
  userId: Id;
  bookingId?: (Booking & { referenceNumber?: string }) | Id | null;
  consultationNoteId?: Id | null;
  branchId?: Id | null;
  phase: "before" | "during" | "after";
  bodyArea?: string;
  note?: string;
  url: string;
  takenAt: string;
  takenByName?: string;
  takenByRole?: string;
  createdAt?: string;
};

/** One item on a purchase order, with its delivery history. */
export type PurchaseOrderLine = {
  _id: Id;
  productId?: Id | null;
  inventoryId?: Id | null;
  name: string;
  sku?: string;
  requestedQuantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  pendingQuantity?: number;
  unitCost?: number;
  taxPercent?: number;
  note?: string;
  receipts?: {
    quantity: number;
    rejectedQuantity?: number;
    rejectionReason?: string;
    batchNo?: string;
    expiryDate?: string | null;
    receivedAt?: string;
    receivedByName?: string;
    note?: string;
  }[];
};

export type PurchaseOrderStatus =
  | "draft" | "raised" | "approved" | "ordered"
  | "partially_received" | "fully_received" | "cancelled";

export type PurchaseOrder = {
  _id: Id;
  poNumber: string;
  vendorId?: (Vendor & { _id: Id }) | Id | null;
  vendorName?: string;
  branchId?: (Branch & { _id: Id }) | Id | null;
  branchName?: string;
  lines: PurchaseOrderLine[];
  status: PurchaseOrderStatus;
  statusHistory?: { status: string; at: string; byName?: string; note?: string }[];
  raisedAt?: string | null;
  expectedDeliveryDate?: string | null;
  receivedAt?: string | null;
  fullyReceivedAt?: string | null;
  approvedByName?: string;
  approvedAt?: string | null;
  createdByName?: string;
  notes?: string;
  totals?: { requested: number; received: number; rejected: number; pending: number; estimatedValue: number };
  createdAt?: string;
};

/** A row as the bulk-import preview classifies it. */
export type BulkPreviewRow = {
  row: number;
  key: string;
  data: Record<string, string>;
  action: "create" | "update" | "error";
  existingId?: Id | null;
  existingName?: string | null;
  errors: string[];
};

export type BulkPreview = {
  total: number;
  creates: number;
  updates: number;
  errors: number;
  rows: BulkPreviewRow[];
};

export type BulkResult = {
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: { row: number; name: string; errors: string[] }[];
};

/** An admin-built consultation form. */
export type FormTemplateField = {
  key: string;
  label: string;
  helpText?: string;
  placeholder?: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "checkbox" | "radio" | "photo";
  options?: { label: string; value: string }[];
  required?: boolean;
  order?: number;
  sensitive?: boolean;
};

export type FormTemplate = {
  _id: Id;
  name: string;
  slug: string;
  description?: string;
  fields: FormTemplateField[];
  consultationCategories?: string[];
  treatmentIds?: Id[];
  branchIds?: Id[];
  isActive: boolean;
  displayOrder?: number;
  version: number;
  submissionCount: number;
  createdAt?: string;
};

export type FormSubmissionRow = {
  _id: Id;
  templateId: Id;
  templateVersion: number;
  userId?: { fullName?: string; email?: string; phone?: string; patientId?: string } | Id | null;
  bookingId?: { referenceNumber?: string; eventAt?: string } | Id | null;
  answers: Record<string, unknown>;
  status: "draft" | "submitted";
  submittedAt?: string | null;
  createdAt?: string;
};

export type Brand = {
  _id: Id;
  name: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  productsCount?: number;
};

export type Formulation = {
  _id: Id;
  name: string;
  description?: string;
  isActive: boolean;
  productsCount?: number;
};

export type Coupon = {
  _id: Id;
  code: string;
  description?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrderValue?: number;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  usageCount?: number;
  perUserLimit?: number | null;
  validFrom: string;
  validUntil: string;
  applicableProducts?: Id[];
  applicableCategories?: string[];
  isActive: boolean;
  isPublic?: boolean;
};

export type OrderStatus =
  | "Order Placed"
  | "Confirmed"
  | "Processing"
  | "Packed"
  | "Shipped"
  | "Out for Delivery"
  | "Delivery Failed"
  | "Delivered"
  | "Cancelled"
  | "Return Requested"
  | "Returned";

export type ProductOrder = {
  _id: Id;
  orderNumber: string;
  userId: Id | User;
  items: { productId?: Id | Product; productName?: string; productImage?: string; quantity: number; price: number; subtotal?: number }[];
  shippingAddress?: {
    addressId?: Id; fullName?: string; phone?: string; addressLine1?: string; addressLine2?: string;
    city?: string; state?: string; postalCode?: string; country?: string; landmark?: string;
  };
  pricing?: { subtotal?: number; gst?: number; deliveryFee?: number; discount?: number; total?: number };
  refundDetails?: {
    method?: string; amount?: number; status?: string; razorpayRefundId?: string; transactionProof?: string;
    refundInitiatedAt?: string; refundCompletedAt?: string; failureReason?: string; notes?: string;
    bankDetails?: { accountHolderName?: string; accountNumber?: string; ifscCode?: string; bankName?: string; upiId?: string };
  };
  coupon?: { code?: string; discount?: number };
  paymentMethod?: "COD" | "Razorpay" | "Online";
  paymentStatus?: "Pending" | "Paid" | "Failed" | "Refunded";
  orderStatus: OrderStatus;
  statusHistory?: { status: string; timestamp: string; note?: string }[];
  deliveryDate?: string;
  trackingId?: string;
  courier?: string;
  estimatedDelivery?: string;
  deliveryPartner?: string;
  deliveryPartnerPhone?: string;
  expectedDeliveryTime?: string;
  deliveryAttempt?: number;
  deliveryAssignedAt?: string;
  deliveryFailedAt?: string;
  deliveryFailureReason?: string;
  deliveryFailures?: {
    attempt?: number; failedAt?: string; reason?: string; note?: string;
    deliveryPartner?: string; deliveryPartnerPhone?: string; courier?: string; trackingId?: string;
  }[];
  cancelReason?: string;
  returnReason?: string;
  returnRequestedAt?: string;
  returnApproved?: boolean;
  returnRejected?: boolean;
  returnRejectionReason?: string;
  cancelledAt?: string;
  deliveredAt?: string;
  returnedAt?: string;
  stockRestoredAt?: string;
  notes?: string;
  createdAt?: string;
};

/* ---------------- stock ---------------- */
export type Inventory = {
  _id: Id;
  inventoryName: string;
  inventoryCategory: "Retail products" | "Consumables";
  code?: string;
  formulation?: string;
  orgName?: string;
  batchMaintenance?: "Batchable" | "Non Batchable";
  batchType?: "FIFO" | "ByExpiry";
  batchNo?: string;
  batchExpiryDate?: string;
  qohBatchWise?: number;
  qohAllBatches?: number;
  reOrderLevel?: number;
  targetLevel?: number;
  gstPercentage?: number;
  inventoryBuyingPrice?: number;
  inventorySellingPrice?: number;
  inventoryAfterTaxSellingPrice?: number;
  vendorName?: string;
  branchId?: Id | null;
  productId?: Id | { _id: Id; name: string; isRx?: boolean | null; mrp?: number | null; price?: number } | null;
  avgCost?: number | null;
  lastCountedAt?: string | null;
  packName?: string;
  packSize?: number;
  createdAt?: string;
};

export type Vendor = {
  _id: Id;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  panNumber?: string;
  status: "Active" | "Inactive";
  rating?: number;
  notes?: string;
  /** Items in stock naming this vendor. */
  productsSupplied?: number;
  productsCount?: number;
  hasBankDetails?: boolean;
  bankDetails?: { accountHolderName?: string; accountNumber?: string; ifscCode?: string; bankName?: string };
  createdAt?: string;
};

/* ---------------- engagement ---------------- */
export type Chat = {
  _id: Id;
  /** app = in-app chat; whatsapp = the guest's WhatsApp thread. */
  channel?: "app" | "whatsapp";
  waPhone?: string | null;
  lastInboundAt?: string | null;
  tags?: string[];
  pinned?: boolean;
  userId: Id | User;
  branchId: Id | Branch;
  branchName: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  status: "active" | "closed" | "archived";
  assignedAdmin?: Id | Admin | null;
  createdAt?: string;
};

export type ChatMessage = {
  _id: Id;
  chatId: Id;
  senderId: Id;
  senderModel: "User" | "Admin";
  senderName: string;
  messageType?: "text" | "image" | "file" | "system" | "note" | "template";
  metadata?: { channel?: string; sid?: string; status?: string; error?: string; private?: boolean; media?: { url: string; contentType?: string }[] };
  content: string;
  attachment?: {
    url: string;
    key?: string;
    fileName: string;
    mimeType: string;
    size: number;
    kind: "image" | "file";
  };
  isRead?: boolean;
  isDelivered?: boolean;
  createdAt: string;
};

export type Notification = {
  _id: Id;
  userId?: Id | null;
  type: "booking" | "order" | "consultation" | "product" | "inventory" | "promotion" | "reminder";
  title: string;
  message: string;
  relatedId?: Id;
  relatedModel?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  isRead?: boolean;
  actionUrl?: string;
  createdAt: string;
};

export type ProductReview = {
  _id: Id;
  userId?: Id | User;
  productId?: Id | Product;
  orderId?: Id;
  rating: number;
  reviewText: string;
  images?: string[];
  isApproved: boolean;
  isReported?: boolean;
  helpfulCount?: number;
  createdAt: string;
};

export type ConsultationReview = {
  _id: Id;
  userId?: Id | User;
  consultationId?: Id | Consultation;
  bookingId?: Id | Booking;
  rating: number;
  reviewText: string;
  isApproved: boolean;
  createdAt: string;
};

export type ServiceReview = {
  _id: Id;
  userId?: Id | User;
  packageAssignmentId: string;
  serviceId: string;
  serviceName: string;
  rating: number;
  reviewText: string;
  isApproved: boolean;
  createdAt: string;
};

export type AuditEntry = {
  _id: Id;
  adminId?: Id;
  adminEmail: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  status: "SUCCESS" | "FAILED" | "WARNING";
  errorMessage?: string | null;
  userAgent?: string;
  timestamp: string;
  createdAt?: string;
};

/* ---------------- clinical ---------------- */
export type DoctorAvailability = {
  _id: Id;
  doctorId: string;
  branches: (Id | Branch)[];
  isActive: boolean;
  updatedAt?: string;
};

export type PreConsultForm = {
  /** Presenting complaint, added 2026-09. Free text in the patient's own words. */
  symptomDuration?: string | null;
  previousTreatments?: string | null;
  currentMedications?: string | null;
  patientNotes?: string | null;
  pregnancyStatus?: "not_applicable" | "not_pregnant" | "pregnant" | "breastfeeding" | "planning" | "prefer_not_to_say";
  photos?: { url: string; caption?: string; uploadedAt?: string }[];
  _id: Id;
  userId: Id | User;
  bookingId?: Id | Booking;
  name?: string;
  dateOfBirth?: string;
  gender?: string;
  phoneNumber?: string;
  email?: string;
  reasonForVisit?: Record<string, boolean>;
  skinConcerns?: Record<string, boolean>;
  hairConcerns?: Record<string, boolean | string>;
  medicalHistory?: Record<string, unknown>;
  drugAllergies?: string | null;
  otherAllergies?: string | null;
  dailyRoutine?: Record<string, string | null>;
  diet?: { type?: string; [k: string]: unknown };
  planningForPregnancy?: boolean;
  lastMenstrualPeriod?: string | null;
  additionalInfo?: Record<string, unknown>;
  doctorName?: string | null;
  status: "Draft" | "Submitted" | "Approved" | "Reviewed" | "Rejected";
  dateOfVisit?: string;
  createdAt?: string;
};

export type ConsentForm = {
  _id: Id;
  userId: Id | User;
  bookingId?: Id | Booking;
  patientName: string;
  doctorName: string;
  treatmentProcedure: string;
  consentDate?: string;
  consentGiven: boolean;
  patientSignature?: string;
  doctorSignature?: string | null;
  status: "Pending" | "Signed" | "Approved" | "Archived";
  clinicNotes?: string | null;
  createdAt?: string;
};

export type PrescriptionItem = {
  medicine: string;
  /** "500 mg", "0.1%" — strength, kept apart from the dose. */
  strength?: string | null;
  /** Tablet, cream, serum — as the clinic dispenses it. */
  formulation?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  /** Morning / night / after food. */
  timing?: string | null;
  instructions?: string | null;
  /** Set when the line is a Zennara retail product rather than a drug. */
  productId?: Id | null;
  /** Availability when it was prescribed. Never a price. */
  availableQuantity?: number | null;
  isScheduleH?: boolean;
};

export type ConsultationNote = {
  /* Diagnosis and advice — the 2026-09 prescription builder. */
  primaryDiagnosis?: string;
  secondaryDiagnosis?: string;
  skinCareAdvice?: string;
  lifestyleAdvice?: string;
  precautions?: string;
  /** True only once a dermatologist has signed; sending requires it. */
  prescriptionSigned?: boolean;
  prescriptionSignedAt?: string | null;
  prescriptionSignedByName?: string | null;
  _id: Id;
  bookingId: Id | Booking;
  userId: Id | User;
  doctorId?: string | null;
  doctorName?: string | null;
  complaint?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
  sketch?: string | null;
  prescription?: PrescriptionItem[];
  assignedServices?: { serviceId?: Id | null; packageId?: Id | null; name: string; sessions?: number }[];
  followUpDate?: string | null;
  status: "Draft" | "Completed";
  completedAt?: string | null;
  zenotiNoteId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "failed" | "skipped" | "dryrun" | null;
  zenotiSyncError?: string | null;
  revisions?: { savedAt: string; savedByEmail?: string | null }[];
  createdAt?: string;
  updatedAt?: string;
};

export type ServiceRecord = {
  _id?: Id;
  serialNumber: number;
  date: string;
  service: string;
  grading?: string | null;
  doctorSign?: string | null;
  doctorName?: string | null;
  therapist?: string | null;
  notes?: string | null;
};

export type ServiceCard = {
  _id: Id;
  userId: Id | User;
  clientName: string;
  clientId: string;
  primaryDoctor: string;
  manager?: string | null;
  services: ServiceRecord[];
  totalSessions?: number;
  completedSessions?: number;
  isActive: boolean;
  lastServiceDate?: string | null;
  createdAt?: string;
};

/* ---------------- app studio ---------------- */
export type AppCustomization = {
  _id?: Id;
  /** Remote design system + copy overrides (App control). */
  appearance?: {
    colors?: Record<string, string>;
    typography?: { fontScale?: number; sizeOverrides?: Record<string, number> };
  } | null;
  copy?: Record<string, string> | null;
  /**
   * The Zen membership card. `priceInr` is the authoritative charge; base/sale
   * prices are presentation only (see AppCustomization.membership on the API).
   */
  membership?: {
    /** The Zenoti membership this card sells (invoiced in Zenoti on purchase). */
    zenotiMembershipVersionId?: string;
    zenotiMembershipName?: string;
    name?: string;
    tagline?: string;
    description?: string;
    discountPercent?: number;
    priceInr?: number;
    basePriceInr?: number;
    salePriceInr?: number;
    renewalPriceInr?: number;
    currency?: string;
    taxPercent?: number;
    durationMonths?: number;
    image?: string;
    icon?: string;
    ctaText?: string;
    ctaDestination?: string;
    featured?: boolean;
    isActive?: boolean;
    displayOrder?: number;
    terms?: string;
    branchAvailability?: string[];
    benefits?: { title: string; copy?: string }[];
  } | null;
  helpScreen?: { faqs?: { q: string; a: string }[] } | null;
  appLogo?: string;
  homeScreen?: Record<string, unknown>;
  consultationsScreen?: Record<string, unknown>;
  appointmentsScreen?: Record<string, unknown>;
  productsScreen?: Record<string, unknown>;
  profileScreen?: Record<string, unknown>;
  termsOfService?: string;
  privacyPolicy?: string;
  version?: number;
  isActive?: boolean;
  lastUpdatedAt?: string;
  lastUpdatedBy?: Id;
  createdAt?: string;
  updatedAt?: string;
};

/* =================== dermatologist availability =================== */

/** One block of clinic time, "HH:mm" on the clinic's own wall clock. */
export type TimeRange = { start: string; end: string };

/** The normal week. A day with no entry is a day they do not sit. */
export type WeeklyBlock = {
  day: number; // 0 = Sunday, matching Date.getDay()
  branchId?: string | null;
  ranges: TimeRange[];
};

/**
 * One named date, which always beats the weekly pattern.
 * `unavailable` clears the day; ranges replace it.
 */
export type ScheduleOverride = {
  date: string; // YYYY-MM-DD
  unavailable?: boolean;
  branchId?: string | null;
  ranges?: TimeRange[];
  note?: string;
};

export type DermatologistSchedule = {
  _id?: string;
  doctorId: string;
  slotMinutes: number;
  leadTimeHours: number;
  horizonDays: number;
  weekly: WeeklyBlock[];
  overrides: ScheduleOverride[];
  isActive: boolean;
  /** False when nobody has set this dermatologist up yet. */
  configured?: boolean;
  /** True while the week is still the automatic copy of the centres' opening hours. */
  seededFromBranchHours?: boolean;
};

export type ScheduleDay = {
  date: string;
  open: boolean;
  total: number;
  free: number;
  note?: string;
};

export type Slot = {
  time: string;
  label: string;
  minutes: number;
  booked: boolean;
  tooSoon: boolean;
  available: boolean;
};

export type SlotDay = {
  date: string;
  configured: boolean;
  slotMinutes?: number;
  note?: string;
  reason?: string;
  slots: Slot[];
};

/* ---------------- billing (desk invoices) ---------------- */
export type InvoiceStatus = "open" | "closed" | "void";
export type InvoiceLineKind = "service" | "product" | "package" | "membership" | "custom";
export type PaymentMethod = "Cash" | "Card" | "UPI" | "Custom" | "Razorpay" | "Membership" | "Prepaid" | "GiftCard" | "Points" | "BankTransfer" | "Cheque";
export type InvoiceLine = {
  _id: Id;
  kind: InvoiceLineKind;
  refId?: Id | null;
  refModel?: "Consultation" | "Product" | "Inventory" | "Package" | null;
  bookingId?: Id | null;
  name: string;
  code?: string | null;
  hsn?: string | null;
  qty: number;
  unitPrice: number;
  priceIncludesTax: boolean;
  taxPercent: number;
  discount: number;
  discountPercent: number;
  redeemed?: { kind: "package" | "membership" | null; packageAssignmentId?: Id | null; membershipAssignmentId?: Id | null; sessionId?: Id | null; label?: string | null };
  discountSource?: "membership" | "manual" | null;
  discountLabel?: string | null;
  membershipAssignmentId?: Id | null;
  soldById?: string | null;
  soldByName?: string | null;
  soldByModel?: "Doctor" | "Admin" | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  inventoryId?: Id | null;
  packageAssignmentId?: Id | null;
  notes?: string;
  listTotal: number;
  base: number;
  invoiceDiscountShare: number;
  net: number;
  tax: number;
  total: number;
};
export type InvoicePayment = {
  _id: Id;
  method: PaymentMethod;
  customName?: string | null;
  reference?: string | null;
  amount: number;
  paidAt: string;
  takenByName?: string | null;
  note?: string;
  voided?: boolean;
  voidedAt?: string | null;
  voidReason?: string | null;
};
export type InvoiceTotals = {
  listTotal: number; base: number; lineDiscount: number; invoiceDiscount: number; redeemed: number;
  net: number; tax: number; cgst: number; sgst: number; igst: number; rawTotal: number; rounding: number; total: number;
  paid: number; due: number; change: number;
};
export type Invoice = {
  _id: Id;
  invoiceNumber: string;
  receiptNumber?: string | null;
  branchId: Id | { _id: Id; name: string; invoicePrefix?: string | null };
  seller?: { name?: string | null; legalName?: string | null; gstin?: string | null; pan?: string | null; stateCode?: string | null; address?: string | null; phone?: string | null; email?: string | null };
  userId?: Id | (Pick<User, "_id" | "fullName" | "phone" | "email" | "patientId"> & { gender?: string; memberType?: string; zenMembershipExpiryDate?: string | null }) | null;
  guest: { name?: string | null; phone?: string | null; email?: string | null; patientId?: string | null; gender?: string | null; stateCode?: string | null; gstin?: string | null };
  visitGroupId?: string | null;
  status: InvoiceStatus;
  source: "desk" | "app" | "zenoti";
  membership?: { kind?: string | null; name?: string | null; memberNumber?: string | null; assignmentId?: Id | null };
  /** Set on bills mirrored from Zenoti (read-only here). */
  zenotiInvoiceId?: string | null;
  zenotiSource?: {
    invoiceNumber?: string | null; receiptNumber?: string | null; isClosed?: boolean | null; isRefund?: boolean | null;
    appointmentGroupId?: string | null; guestCode?: string | null; centerId?: string | null; invoiceDate?: string | null;
    detailFetchedAt?: string | null; syncedAt?: string | null;
  };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  invoiceDiscount: { percent: number; amount: number; reason?: string };
  coupon?: { code?: string | null; discount?: number };
  interState: boolean;
  totals: InvoiceTotals;
  taxSummary: { rate: number; taxable: number; tax: number }[];
  comments?: string;
  issuedAt: string;
  closedAt?: string | null;
  closedByName?: string | null;
  reopenedAt?: string | null;
  voidedAt?: string | null;
  voidedByName?: string | null;
  voidReason?: string | null;
  createdByName?: string | null;
  effectsAppliedAt?: string | null;
  printedCount?: number;
  emailedAt?: string | null;
  whatsappedAt?: string | null;
  bookingIds?: Id[];
  createdAt?: string;
  updatedAt?: string;
};
/** A guest's active package with what is left on it — the "Packages" dropdown on a bill. */
export type GuestPackageBalance = { _id: Id; assignmentId: string; name?: string; validUntil?: string | null; graceUntil?: string | null; frozen?: boolean; redeemable?: { ok: boolean; code?: string; message?: string; grace?: boolean }; balances: { serviceId: string; serviceName: string | null; entitled: number; used: number; balance: number }[] };

/* ---------------- package ledger / memberships ---------------- */
export type ServiceBalance = { serviceId: string; serviceName: string | null; order?: number; entitled: number; transferred?: number; used: number; balance: number };
export type AssignmentLedger = {
  balances: ServiceBalance[];
  redeemable: { ok: boolean; code?: string; message?: string; grace?: boolean };
  redemptions: NonNullable<PackageAssignment["redemptions"]>;
  freeze?: PackageAssignment["freeze"];
  freezeHistory: NonNullable<PackageAssignment["freezeHistory"]>;
  transfers: NonNullable<PackageAssignment["transfers"]>;
  transferredFrom?: PackageAssignment["transferredFrom"] | null;
  refund?: PackageAssignment["refund"] | null;
  terms?: PackageAssignment["terms"];
  graceUntil?: string | null;
  invoice?: { _id: Id; invoiceNumber: string; receiptNumber?: string | null; totals?: { total: number; paid: number; due: number }; status: string } | null;
  payment?: PackageAssignment["payment"];
};
export type Membership = {
  _id: Id;
  name: string;
  code: string;
  description?: string;
  membershipType: "non_recurring" | "recurring";
  prefix?: string;
  seed?: number;
  price: number;
  taxPercent?: number;
  priceIncludesTax?: boolean;
  validityMonths: number;
  discounts: { servicesPercent: number; productsPercent: number; packagesPercent: number };
  credits: { serviceId: string; serviceName?: string; qty: number }[];
  benefits?: string[];
  branchIds?: Id[];
  isActive: boolean;
  isAppDefault?: boolean;
  terms?: string;
  source?: "panel" | "zenoti";
  zenotiMembershipId?: string | null;
  membersCount?: number;
  createdAt?: string;
};
export type MembershipAssignment = {
  _id: Id;
  userId: Id | Pick<User, "_id" | "fullName" | "phone" | "email" | "patientId">;
  membershipId: Id | Pick<Membership, "_id" | "name" | "code" | "prefix">;
  memberNumber?: string | null;
  snapshot?: { name?: string; code?: string; discounts?: Membership["discounts"]; validityMonths?: number };
  credits: { serviceId: string; serviceName?: string; qty: number; used: number }[];
  price: number;
  payment?: { isReceived?: boolean; receivedDate?: string | null; paymentMethod?: string | null; transactionId?: string | null; amountPaid?: number | null; balanceDue?: number | null };
  invoiceId?: Id | null;
  status: "Active" | "Expired" | "Cancelled";
  validFrom?: string;
  validUntil?: string | null;
  autoRenew?: boolean;
  redemptions?: { at: string; kind: "credit" | "discount"; serviceId?: string; serviceName?: string; amount?: number; invoiceId?: Id; invoiceNumber?: string; byName?: string; reversed?: boolean }[];
  cancellation?: { cancelledAt?: string; byName?: string; reason?: string; refundAmount?: number; refundMethod?: string };
  notes?: string;
  source?: "panel" | "app" | "zenoti";
  soldByName?: string | null;
  createdAt?: string;
};
/** The guest's live membership as the bill and the profile see it (plan row or legacy Zen tier). */
export type GuestMembership = { kind: "plan" | "legacy"; name: string; memberNumber?: string | null; validUntil?: string | null; discounts: { servicesPercent?: number; productsPercent?: number; packagesPercent?: number }; credits: { serviceId: string; serviceName?: string | null; entitled: number; used: number; balance: number }[]; assignmentId?: Id | null };

/* ---------------- stock control ---------------- */
export type StockValue = { unit: number; cost: number; tax?: number; at?: string | null };
export type CurrentStockRow = {
  _id: Id; code: string | null; name: string; category: string; unit: string | null; batchNo: string | null; expiryDate: string | null;
  vendor: string | null; branch: string | null; branchId: Id | null; onHand: number; reOrderLevel: number; gstPercent: number;
  avg: StockValue; configured: StockValue; lastProcured: StockValue; lastCountedAt: string | null; lastReconciledAt: string | null;
};
export type StockSummary = { items: number; inStock: number; onHand: number; cost: number; tax: number; configured: number; lastProcured: number; byCategory: Record<string, { items: number; onHand: number; cost: number }> };
export type StockCountLine = { _id: Id; inventoryId: Id; name: string; code?: string | null; batchNo?: string | null; category?: string | null; unit?: string | null; expected: number; counted: number | null; unitCost: number; note?: string; countedByName?: string | null; countedAt?: string | null; shelfAtReconcile?: number | null; applied?: number | null };
export type StockCount = {
  _id: Id; ref: string; branchId: Id | null; branchName: string; title: string; scope?: { category?: string | null; vendorId?: Id | null; search?: string | null };
  status: "open" | "submitted" | "reconciled" | "cancelled"; lines?: StockCountLine[];
  totals: { items: number; counted: number; varianceQty: number; varianceValue: number; shortQty: number; excessQty: number; stockValueBefore: number; stockValueAfter: number | null };
  createdByName?: string | null; submittedAt?: string | null; submittedByName?: string | null; reconciledAt?: string | null; reconciledByName?: string | null; cancelledAt?: string | null; cancelReason?: string | null; notes?: string; createdAt: string;
};
export type StockTransferLine = { _id: Id; inventoryId: Id; toInventoryId?: Id | null; name: string; code?: string | null; batchNo?: string | null; expiryDate?: string | null; qty: number; receivedQty?: number | null; unitCost: number; note?: string };
export type StockTransfer = {
  _id: Id; ref: string; kind: "transfer" | "return"; fromBranchId: Id; fromBranchName: string; toBranchId: Id; toBranchName: string;
  status: "draft" | "sent" | "received" | "cancelled"; lines: StockTransferLine[]; totals: { qty: number; value: number }; notes?: string;
  createdByName?: string | null; sentAt?: string | null; sentByName?: string | null; receivedAt?: string | null; receivedByName?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
};
export type StockValuation = { total: StockSummary; perBranch: (StockSummary & { branchId: Id | null; branch: string })[]; history: { ref: string; branch: string; at: string; before: number; after: number | null; varianceValue: number }[] };

/* ---------------- message templates / staff sales ---------------- */
export type MessageTemplate = {
  _id: Id; name: string; key: string; channel: "whatsapp" | "email" | "sms" | "note"; category: "appointment" | "billing" | "package" | "membership" | "marketing" | "general";
  subject?: string; body: string; twilioContentSid?: string | null; contentVariables?: string[]; isActive: boolean; branchIds?: Id[]; usageCount?: number; lastUsedAt?: string | null; createdAt?: string;
};
export type StaffSalesRow = { staff: string; services: number; products: number; packages: number; memberships: number; other: number; total: number; items: number; bills: number };

/** Headline numbers for the invoice register. */
export type InvoiceSummary = {
  total: { count: number; amount: number; paid: number; due: number };
  byStatus: Record<string, { count: number; amount: number; due: number }>;
  bySource: Record<string, { count: number; amount: number }>;
};

/** What a Zenoti stock export would do (preview) or did (commit). */
export type StockImportResult = {
  branch?: string | null;
  headerMap?: Record<string, string>;
  rows: number; matched: number; unmatched: number; changed: number; unchanged: number;
  quantityDelta: number; valueAfter: number;
  applied?: number; created?: number; ledgerRows?: number;
  samples: { unmatched: string[]; changes: { name: string; code?: string | null; before: number; after: number; batchNo?: string | null; expiry?: string | null }[] };
};
