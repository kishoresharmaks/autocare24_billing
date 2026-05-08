export type InvoiceMode = "gst" | "simple";
export type InvoiceStatus = "finalized" | "cancelled";
export type InvoiceDraftCorrectionType = "normal" | "replacement" | "addon";
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";
export type PaymentStatus = "paid" | "partial" | "unpaid";
export type PaymentMode = "Cash" | "UPI" | "Card" | "Bank Transfer" | "Other";
export type TaxScope = "intra" | "inter";
export type DateRangePreset = "7d" | "30d" | "90d" | "all";
export type ReportExportKind = "full" | "sales" | "gst" | "payments" | "stock" | "enquiries" | "jobCards" | "profit";
export type InvoicePaperSize = "A4" | "Letter" | "Legal";
export type InvoiceFontStyle = "modern" | "classic" | "system";
export type InvoiceTextSize = "compact" | "standard" | "large";
export type InvoiceDensity = "compact" | "standard" | "comfortable";
export type InvoiceLogoSize = "small" | "medium" | "large";
export type InvoiceWatermarkPlacement = "bottom-right" | "center" | "top-right";
export type InventoryItemType = "consumable" | "retail";
export type InventoryMovementType = "purchase" | "usage" | "sale" | "adjustment" | "return" | "damage" | "invoice_cancel_reversal";
export type EnquiryStatus = "new" | "contacted" | "follow_up" | "visited" | "converted" | "lost";
export type EnquirySource = "Walk-in" | "Phone" | "WhatsApp" | "Instagram" | "Google" | "Referral" | "Other";
export type VehicleType = "car" | "bike" | "other";
export type UserRole = "owner" | "staff";
export type CloudSyncRecordStatus = "local_only" | "pending_cloud" | "synced" | "conflict" | "failed";
export type CloudDeviceApprovalStatus = "APPROVED" | "PENDING" | "REVOKED";
export type SyncConnectionState = "disconnected" | "connected" | "syncing" | "pending_approval" | "error";
export type SyncOutboxStatus = "PENDING" | "PUSHED" | "FAILED" | "CONFLICT";
export type SyncOperationType = "UPSERT" | "DELETE";
export type SyncConflictResolution = "KEEP_LOCAL" | "KEEP_SERVER" | "MANUAL";
export type SyncFileType = "LOGO" | "SIGNATURE" | "WATERMARK" | "PHOTO" | "DOCUMENT";
export const BUSINESS_SETTINGS_SYNC_ID = "00000000-0000-4000-8000-000000000001";
export const JOB_CARD_SETTINGS_SYNC_ID = "00000000-0000-4000-8000-000000000002";
export type SyncEntity =
  | "settings"
  | "users"
  | "access_roles"
  | "customers"
  | "vehicles"
  | "services"
  | "inventory_items"
  | "inventory_batches"
  | "inventory_movements"
  | "suppliers"
  | "service_consumables"
  | "enquiries"
  | "enquiry_followups"
  | "job_cards"
  | "job_card_items"
  | "job_card_photos"
  | "job_card_checklist_items"
  | "job_card_status_history"
  | "invoices"
  | "invoice_items"
  | "invoice_drafts"
  | "payments"
  | "quotations"
  | "quotation_items"
  | "purchase_records"
  | "expenses";
export const ALL_PERMISSION_KEYS = [
  "dashboard.view",
  "billing.view",
  "billing.create",
  "billing.manageInvoices",
  "billing.recordPayments",
  "billing.cancelInvoices",
  "quotations.view",
  "quotations.manage",
  "quotations.convert",
  "customers.view",
  "customers.manage",
  "jobCards.view",
  "jobCards.manage",
  "jobCards.photos",
  "jobCards.settings",
  "enquiries.view",
  "enquiries.manage",
  "enquiries.convert",
  "services.view",
  "services.manage",
  "stock.view",
  "stock.manageItems",
  "stock.purchase",
  "stock.adjust",
  "stock.suppliers",
  "reports.view",
  "reports.export",
  "expenses.manage",
  "documents.printPdf",
  "sharing.whatsapp",
  "exports.csv",
  "settings.manage",
  "users.manage",
  "backup.manage",
  "developer.access"
] as const;
export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];
export type DataHealthSeverity = "info" | "warning" | "critical";
export type SafeRepairCode =
  | "restore_settings_defaults"
  | "clean_job_card_invoice_links"
  | "clear_broken_logo_path"
  | "clean_optional_item_links";
export type JobCardStatus =
  | "draft"
  | "estimate_pending"
  | "approved"
  | "in_progress"
  | "quality_check"
  | "ready_delivery"
  | "delivered"
  | "billed"
  | "cancelled";
export type JobCardPhotoType = "before" | "after" | "damage" | "work_progress" | "delivery";

export interface AppUser {
  id: string;
  displayName: string;
  username: string;
  role: UserRole;
  accessRoleId: string;
  accessRoleName: string;
  permissions: PermissionKey[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessRole {
  id: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  locked: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthStatus {
  hasUsers: boolean;
  currentUser?: AppUser | null;
}

export interface SetupOwnerInput {
  displayName: string;
  username: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface SaveUserInput {
  id?: string;
  displayName: string;
  username: string;
  role: UserRole;
  accessRoleId?: string;
  password?: string;
  active?: boolean;
}

export interface SaveAccessRoleInput {
  id?: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
  active?: boolean;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword?: string;
  newPassword: string;
}

export interface BusinessSettings {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  state: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  quotationPrefix: string;
  nextQuotationNumber: number;
  defaultGstRate: number;
  defaultTaxScope: TaxScope;
  invoicePaperSize: InvoicePaperSize;
  backupDirectory: string;
  invoiceLogoPath: string;
  invoiceSignaturePath: string;
  invoiceWatermarkPath: string;
  invoiceAccentColor: string;
  invoiceSecondaryColor: string;
  invoiceFontStyle: InvoiceFontStyle;
  invoiceTextSize: InvoiceTextSize;
  invoiceDensity: InvoiceDensity;
  invoiceLogoSize: InvoiceLogoSize;
  invoiceWatermarkOpacity: number;
  invoiceWatermarkPlacement: InvoiceWatermarkPlacement;
  gstInvoiceTitle: string;
  simpleReceiptTitle: string;
  quotationTitle: string;
  invoiceTerms: string;
  invoiceFooterNote: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  upiId: string;
  signatureLabel: string;
  showLogo: boolean;
  showGstin: boolean;
  showVehicleDetails: boolean;
  showPaymentDetails: boolean;
  showTerms: boolean;
  showSignature: boolean;
  showBusinessPhone: boolean;
  showBusinessEmail: boolean;
  showBusinessAddress: boolean;
  showCustomerPhone: boolean;
  showCustomerAddress: boolean;
  showCustomerGstin: boolean;
  showInvoiceStatus: boolean;
  showPaymentMode: boolean;
  showPaidAmount: boolean;
  showBalanceDue: boolean;
  showSacCode: boolean;
  showItemGstRate: boolean;
  showFooterContactBar: boolean;
  showUpiQr: boolean;
  invoiceNumberLabel: string;
  invoiceDateLabel: string;
  quotationNumberLabel: string;
  quotationDateLabel: string;
  billToLabel: string;
  vehicleDetailsLabel: string;
  paymentDetailsLabel: string;
  bankDetailsLabel: string;
  termsLabel: string;
  subtotalLabel: string;
  grandTotalLabel: string;
  paidLabel: string;
  balanceDueLabel: string;
  paymentInstructions: string;
  googleDriveClientId: string;
  googleDriveClientSecret: string;
}

export interface SyncDeviceStatus {
  configured: boolean;
  connected: boolean;
  state: SyncConnectionState;
  approvalStatus: CloudDeviceApprovalStatus | "";
  cloudUrl: string;
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastRevision: number;
  lastPushAt: string;
  lastPullAt: string;
  lastError: string;
}

export interface SyncConnectInput {
  cloudUrl: string;
  deviceName: string;
  registrationKey?: string;
}

export interface CloudDeviceSummary {
  id: string;
  name: string;
  deviceCode: string;
  approvalStatus: CloudDeviceApprovalStatus;
  approvalRequestedAt: string;
  approvedAt: string;
  approvedByUserId: string;
  registrationIp: string;
  isRevoked: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface CloudDeviceOwnerCredentials {
  ownerUsername: string;
  ownerPassword: string;
}

export interface CloudDeviceApprovalInput extends CloudDeviceOwnerCredentials {
  deviceId: string;
}

export interface CloudDeviceListResult {
  devices: CloudDeviceSummary[];
  currentDeviceId: string;
}

export interface SyncOutboxEntry {
  id: number;
  idempotencyKey: string;
  operationType: SyncOperationType;
  entity: SyncEntity;
  localId: string;
  payload: Record<string, unknown>;
  fileRefs: string[];
  baseRevision: number;
  attemptCount: number;
  lastError: string;
  createdAt: string;
  pushedAt: string;
  status: SyncOutboxStatus;
}

export interface SyncConflictSummary {
  id: number;
  conflictId: string;
  entity: SyncEntity;
  localId: string;
  localVersion: Record<string, unknown>;
  serverVersion: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string;
  resolution: SyncConflictResolution | "";
  status: "OPEN" | "RESOLVED";
}

export interface SyncTriggerResult extends SaveResult {
  status: SyncDeviceStatus;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
  vehicleType: VehicleType;
  registrationNumber: string;
  make: string;
  model: string;
  color: string;
  createdAt: string;
}

export interface CustomerWithVehicles extends Customer {
  vehicles: Vehicle[];
}

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  defaultPrice: number;
  gstRate: number;
  sacCode: string;
  active: boolean;
  createdAt: string;
}

export interface InvoiceItemInput {
  serviceId?: string;
  inventoryItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  sacCode: string;
}

export interface InvoiceItem extends InvoiceItemInput {
  id: string;
  invoiceId: string;
  lineSubTotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface InvoiceCreateInput {
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  invoiceDate: string;
  jobCardId?: string;
  sourceInvoiceId?: string;
  sourceQuotationId?: string;
  customerId?: string;
  customer: Partial<Customer> & Pick<Customer, "name">;
  vehicleId?: string;
  vehicle: Partial<Vehicle> & Pick<Vehicle, "registrationNumber">;
  items: InvoiceItemInput[];
  discount: number;
  paidAmount: number;
  paymentMode: PaymentMode;
  paymentReference: string;
  notes: string;
}

export interface InvoiceDraftPayload extends InvoiceCreateInput {
  selectedCustomerId?: string;
  selectedVehicleId?: string;
}

export interface InvoiceDraft {
  id: string;
  name: string;
  sourceInvoiceId: string;
  correctionType: InvoiceDraftCorrectionType;
  payload: InvoiceDraftPayload;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDraftSaveInput {
  id?: string;
  name?: string;
  sourceInvoiceId?: string;
  correctionType?: InvoiceDraftCorrectionType;
  payload: InvoiceDraftPayload;
}

export interface InvoiceCancelInput {
  invoiceId: string;
  reason: string;
}

export interface InvoiceAppendItemInput {
  invoiceId: string;
  item: InvoiceItemInput;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceStatus: InvoiceStatus;
  cloudSyncStatus: CloudSyncRecordStatus;
  cloudRevision: number;
  cloudSyncedAt: string;
  cloudConflictId: string;
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  invoiceDate: string;
  customerId: string;
  vehicleId: string;
  jobCardId: string;
  vehicleType: VehicleType;
  customerName: string;
  customerPhone: string;
  vehicleNumber: string;
  subTotal: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  paymentReference: string;
  notes: string;
  cancelledAt: string;
  cancelledByUserId: string;
  cancelReason: string;
  replacementInvoiceId: string;
  sourceInvoiceId: string;
  sourceQuotationId: string;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  customer: Customer;
  vehicle: Vehicle;
  items: InvoiceItem[];
  payments: Payment[];
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  mode: PaymentMode;
  reference: string;
  paymentDate: string;
  createdAt: string;
}

export interface QuotationItemInput extends InvoiceItemInput {}

export interface QuotationItem extends QuotationItemInput {
  id: string;
  quotationId: string;
  lineSubTotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface QuotationSaveInput {
  id?: string;
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  quotationDate: string;
  validUntil?: string;
  status?: QuotationStatus;
  customerId?: string;
  customer: Partial<Customer>;
  vehicleId?: string;
  vehicle: Partial<Vehicle>;
  items: QuotationItemInput[];
  discount: number;
  notes: string;
}

export interface QuotationStatusInput {
  quotationId: string;
  status: QuotationStatus;
}

export interface QuotationSummary {
  id: string;
  quotationNumber: string;
  quotationStatus: QuotationStatus;
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  quotationDate: string;
  validUntil: string;
  customerId: string;
  vehicleId: string;
  vehicleType: VehicleType;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerGstin: string;
  customerAddress: string;
  vehicleNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  subTotal: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  convertedInvoiceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationDetail extends QuotationSummary {
  customer: Customer;
  vehicle: Vehicle;
  items: QuotationItem[];
  convertedInvoice?: InvoiceSummary;
}

export interface DashboardData {
  todayRevenue: number;
  monthRevenue: number;
  pendingDues: number;
  todayInvoices: number;
  recentInvoices: InvoiceSummary[];
  topServices: Array<{ name: string; quantity: number; revenue: number }>;
  enquiries: EnquiryDashboardData;
  jobCards: JobCardDashboardData;
}

export interface ReportDateFilter {
  preset?: DateRangePreset;
  fromDate?: string;
  toDate?: string;
}

export interface ReportData {
  rangeLabel: string;
  revenue: number;
  invoiceCount: number;
  paidAmount: number;
  balanceDue: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  cancelledCount: number;
  dues: InvoiceSummary[];
  topServices: Array<{ name: string; quantity: number; revenue: number }>;
  paymentModes: Array<{ mode: PaymentMode; amount: number }>;
  salesTrend: Array<{ date: string; label: string; billedValue: number; paidAmount: number; balanceDue: number }>;
  inventory: InventoryDashboardData;
  enquiries: EnquiryReportData;
  jobCards: JobCardReportData;
}

export interface Expense {
  id: string;
  expenseDate: string;
  category: string;
  amount: number;
  paymentMode: PaymentMode;
  vendor: string;
  reference: string;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseInput {
  id?: string;
  expenseDate: string;
  category: string;
  amount: number;
  paymentMode: PaymentMode;
  vendor?: string;
  reference?: string;
  notes?: string;
}

export interface ProfitReportData {
  rangeLabel: string;
  paidRevenue: number;
  stockCost: number;
  expenseTotal: number;
  cashProfit: number;
  profitMargin: number;
  trend: Array<{ date: string; label: string; paidRevenue: number; stockCost: number; expenses: number; cashProfit: number }>;
  expensesByCategory: Array<{ category: string; amount: number }>;
  expenses: Expense[];
}

export interface RecordPaymentInput {
  invoiceId: string;
  amount: number;
  mode: PaymentMode;
  reference: string;
  paymentDate: string;
}

export interface SaveResult {
  ok: boolean;
  message: string;
  path?: string;
}

export interface PrintInput {
  pageSize?: InvoicePaperSize;
  requiredPermission?: PermissionKey;
}

export interface SavePdfInput extends PrintInput {
  title?: string;
  defaultFileName?: string;
  successMessage?: string;
  saveMode?: "dialog" | "documents";
  documentsSubfolder?: string;
}

export interface CloudBackupRecord {
  id: string;
  name: string;
  sizeBytes: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface DriveConnectionStatus {
  configured: boolean;
  connected: boolean;
  clientId: string;
  accountEmail: string;
  folderName: string;
  folderId: string;
  lastUploadAt: string;
  lastUploadName: string;
  lastUploadSizeBytes: number;
  backupCount: number;
  lastError: string;
}

export interface DriveBackupResult extends SaveResult {
  fileId?: string;
  fileName?: string;
  uploadedAt?: string;
  sizeBytes?: number;
}

export interface BackupCloudSnapshotStatus {
  included: boolean;
  exportedAt: string;
  entityCount: number;
  recordCount: number;
  invoiceCount: number;
  error: string;
}

export interface BackupResult extends SaveResult {
  cloudSnapshot: BackupCloudSnapshotStatus;
}

export interface BackupScheduleStatus {
  scheduledTime: string;
  nextRunAt: string;
  lastLocalBackupAt: string;
  lastLocalBackupPath: string;
  lastDriveUploadAt: string;
  lastDriveUploadName: string;
  lastCloudSnapshot: BackupCloudSnapshotStatus;
  lastError: string;
}

export type WhatsAppShareKind = "invoice" | "due_reminder" | "job_card_status" | "job_card_pdf" | "quotation";

export interface WhatsAppShareInput {
  kind: WhatsAppShareKind;
  phone: string;
  customerName: string;
  businessName: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  quotationNumber?: string;
  quotationDate?: string;
  validUntil?: string;
  jobNumber?: string;
  status?: string;
  vehicleNumber?: string;
  grandTotal?: number;
  balanceDue?: number;
  expectedDeliveryDate?: string;
  expectedDeliveryTime?: string;
}

export interface DataHealthIssue {
  id: string;
  code: string;
  title: string;
  severity: DataHealthSeverity;
  message: string;
  count: number;
  repairable: boolean;
  repairCode?: SafeRepairCode;
  details?: string[];
}

export interface DataHealthReport {
  generatedAt: string;
  integrityStatus: string;
  foreignKeyIssues: string[];
  tableCounts: Record<string, number>;
  issues: DataHealthIssue[];
}

export interface DeveloperDiagnostics {
  generatedAt: string;
  appId: string;
  appName: string;
  productName: string;
  appVersion: string;
  packaged: boolean;
  organizationName: string;
  developerName: string;
  developerProfileUrl: string;
  platform: string;
  arch: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  databasePath: string;
  databaseSizeBytes: number;
  userDataPath: string;
  backupDirectory: string;
  logPath: string;
  tableCounts: Record<string, number>;
}

export interface AppInfo {
  generatedAt: string;
  appId: string;
  appName: string;
  productName: string;
  description: string;
  version: string;
  copyright: string;
  packaged: boolean;
  releaseMode: string;
  organization: {
    name: string;
    shortName: string;
    category: string;
    country: string;
    dataOwner: string;
    configuredBusinessName: string;
    phone: string;
    email: string;
    gstin: string;
    state: string;
    address: string;
  };
  developer: {
    name: string;
    role: string;
    profileUrl: string;
    credit: string;
  };
  storage: {
    mode: string;
    cloudSync: string;
    databasePath: string;
    userDataPath: string;
    backupDirectory: string;
    cloudBackup: string;
  };
  modules: Array<{ name: string; description: string }>;
  readiness: Array<{ label: string; status: string; detail: string }>;
}

export interface SafeRepairResult extends SaveResult {
  repairCode: SafeRepairCode;
  backupPath: string;
  fixedCount: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  gstin: string;
  address: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  type: InventoryItemType;
  unit: string;
  sku: string;
  category: string;
  retailPrice: number;
  gstRate: number;
  lowStockLevel: number;
  active: boolean;
  currentQuantity: number;
  stockValue: number;
  createdAt: string;
}

export interface InventoryBatch {
  id: string;
  itemId: string;
  supplierId: string;
  batchNumber: string;
  expiryDate: string;
  purchaseDate: string;
  billNumber: string;
  quantityPurchased: number;
  quantityRemaining: number;
  unitCost: number;
  gstRate: number;
  subtotal: number;
  gstAmount: number;
  totalCost: number;
  createdAt: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  itemType: InventoryItemType;
  itemUnit: string;
  batchId: string;
  type: InventoryMovementType;
  quantity: number;
  unitCost: number;
  reference: string;
  notes: string;
  movementDate: string;
  createdAt: string;
}

export interface InventoryPurchaseInput {
  itemId: string;
  supplierId?: string;
  supplier?: Partial<Supplier> & Pick<Supplier, "name">;
  batchNumber: string;
  expiryDate: string;
  purchaseDate: string;
  billNumber: string;
  quantity: number;
  unitCost: number;
  gstRate: number;
}

export interface PurchaseRecordDocument {
  id: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  localPath?: string;
}

export interface PurchaseRecord {
  id: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  vendorName: string;
  billNumber: string;
  amount: number;
  paymentMode: PaymentMode;
  notes: string;
  documents: PurchaseRecordDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRecordInput {
  id?: string;
  purchaseDate: string;
  supplierId?: string;
  supplierName?: string;
  vendorName: string;
  billNumber: string;
  amount: number;
  paymentMode: PaymentMode;
  notes: string;
  documents?: PurchaseRecordDocument[];
  createdAt?: string;
}

export interface InventoryMovementInput {
  itemId: string;
  type: Exclude<InventoryMovementType, "purchase" | "sale" | "invoice_cancel_reversal">;
  quantity: number;
  reference: string;
  notes: string;
  movementDate: string;
}

export interface ServiceConsumable {
  id: string;
  serviceId: string;
  inventoryItemId: string;
  itemName: string;
  unit: string;
  quantity: number;
}

export interface InventoryDashboardData {
  totalStockValue: number;
  lowStockCount: number;
  expiringCount: number;
  retailCount: number;
  items: InventoryItem[];
  lowStockItems: InventoryItem[];
  expiringBatches: Array<InventoryBatch & { itemName: string; unit: string }>;
  recentMovements: InventoryMovement[];
}

export interface Enquiry {
  id: string;
  status: EnquiryStatus;
  source: EnquirySource;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  interestedService: string;
  expectedBudget: number;
  preferredVisitDate: string;
  followUpDate: string;
  notes: string;
  lostReason: string;
  customerId: string;
  vehicleId: string;
  convertedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnquiryInput {
  id?: string;
  status: EnquiryStatus;
  source: EnquirySource;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  interestedService: string;
  expectedBudget: number;
  preferredVisitDate: string;
  followUpDate: string;
  notes: string;
  lostReason: string;
}

export interface EnquiryFollowup {
  id: string;
  enquiryId: string;
  followupDate: string;
  note: string;
  nextFollowUpDate: string;
  status: EnquiryStatus;
  createdAt: string;
}

export interface EnquiryFollowupInput {
  enquiryId: string;
  note: string;
  nextFollowUpDate: string;
  status: EnquiryStatus;
  followupDate: string;
}

export interface EnquiryDashboardData {
  todayFollowups: number;
  overdueFollowups: number;
  newEnquiries: number;
  convertedEnquiries: number;
  dueToday: Enquiry[];
  overdue: Enquiry[];
  recentOpen: Enquiry[];
}

export interface EnquiryReportData {
  total: number;
  converted: number;
  lost: number;
  open: number;
  byStatus: Array<{ status: EnquiryStatus; count: number }>;
  bySource: Array<{ source: EnquirySource; count: number }>;
}

export interface JobCardItemInput {
  id?: string;
  serviceId?: string;
  inventoryItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  sacCode: string;
}

export interface JobCardItem extends JobCardItemInput {
  id: string;
  jobCardId: string;
  lineSubTotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface JobCardChecklistItem {
  id: string;
  jobCardId: string;
  label: string;
  checked: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface JobCardPhoto {
  id: string;
  jobCardId: string;
  type: JobCardPhotoType;
  path: string;
  url?: string;
  caption: string;
  createdAt: string;
}

export interface JobCardStatusHistory {
  id: string;
  jobCardId: string;
  status: JobCardStatus;
  note: string;
  createdAt: string;
}

export interface JobCardInput {
  id?: string;
  status: JobCardStatus;
  jobDate: string;
  expectedDeliveryDate: string;
  expectedDeliveryTime: string;
  actualDeliveryDate: string;
  actualDeliveryTime: string;
  customerId?: string;
  customer: Partial<Customer> & Pick<Customer, "name">;
  vehicleId?: string;
  vehicle: Partial<Vehicle> & Pick<Vehicle, "registrationNumber">;
  odometer: string;
  fuelLevel: string;
  keyReceived: boolean;
  belongingsNote: string;
  approvalName: string;
  approvalDate: string;
  approvalNotes: string;
  workNotes: string;
  internalNotes: string;
  deliveryNotes: string;
  discount: number;
  items: JobCardItemInput[];
}

export interface JobCardSummary {
  id: string;
  jobNumber: string;
  status: JobCardStatus;
  jobDate: string;
  expectedDeliveryDate: string;
  expectedDeliveryTime: string;
  actualDeliveryDate: string;
  actualDeliveryTime: string;
  customerId: string;
  vehicleId: string;
  invoiceId: string;
  customerName: string;
  customerPhone: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  odometer: string;
  fuelLevel: string;
  keyReceived: boolean;
  belongingsNote: string;
  approvalName: string;
  approvalDate: string;
  approvalNotes: string;
  workNotes: string;
  internalNotes: string;
  deliveryNotes: string;
  subTotal: number;
  discount: number;
  taxableValue: number;
  totalTax: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobCardDetail extends JobCardSummary {
  customer: Customer;
  vehicle: Vehicle;
  items: JobCardItem[];
  checklist: JobCardChecklistItem[];
  photos: JobCardPhoto[];
  history: JobCardStatusHistory[];
  invoice?: InvoiceSummary;
}

export interface JobCardDashboardData {
  todayJobs: number;
  openJobs: number;
  approvalPending: number;
  inProgress: number;
  readyDelivery: number;
  completedToday: number;
  recentOpen: JobCardSummary[];
}

export interface JobCardReportData {
  total: number;
  open: number;
  approvalPending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  billed: number;
  billedRevenue: number;
  averageTurnaroundDays: number;
  byStatus: Array<{ status: JobCardStatus; count: number }>;
}
