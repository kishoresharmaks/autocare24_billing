export type DateRangePreset = "7d" | "30d" | "90d" | "month" | "all";
export type ReportDateFilter = DateRangePreset | { fromDate?: string; toDate?: string; preset?: "" };
export type CloudDeviceApprovalStatus = "APPROVED" | "PENDING" | "REVOKED";
export type PaymentMode = "Cash" | "UPI" | "Card" | "Bank Transfer" | "Other";
export type InvoiceMode = "gst" | "simple";
export type TaxScope = "intra" | "inter";
export type VehicleType = "car" | "bike" | "other";
export type InventoryItemType = "consumable" | "retail";
export type InventoryMovementType = "purchase" | "usage" | "sale" | "adjustment" | "return" | "damage" | "invoice_cancel_reversal";

export interface ApiEnvelope<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
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

export interface DeviceRegistrationResult {
  token: string;
  device: CloudDeviceSummary;
  approvalStatus: CloudDeviceApprovalStatus;
  pendingApproval: boolean;
}

export interface DeviceApprovalStatusResult {
  device: CloudDeviceSummary;
  approvalStatus: CloudDeviceApprovalStatus;
  pendingApproval: boolean;
  approved: boolean;
  revoked: boolean;
}

export interface CloudUser {
  id: string;
  displayName: string;
  username: string;
  role: "owner" | "staff";
  accessRoleId: string;
  accessRoleName: string;
  permissions: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  user: CloudUser;
  userToken: string;
  expiresAt?: string;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface BusinessSettings {
  id?: string;
  businessName?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  state?: string;
  invoicePrefix?: string;
  defaultGstRate?: number;
  defaultTaxScope?: TaxScope;
  invoicePaperSize?: "A4" | "Letter" | "Legal";
  invoiceLogoPath?: string;
  invoiceSignaturePath?: string;
  invoiceWatermarkPath?: string;
  invoiceAccentColor?: string;
  invoiceSecondaryColor?: string;
  invoiceFontStyle?: "modern" | "classic" | "system";
  invoiceTextSize?: "compact" | "standard" | "large";
  invoiceDensity?: "compact" | "standard" | "comfortable";
  invoiceLogoSize?: "small" | "medium" | "large";
  invoiceWatermarkOpacity?: number;
  invoiceWatermarkPlacement?: "bottom-right" | "center" | "top-right";
  gstInvoiceTitle?: string;
  simpleReceiptTitle?: string;
  quotationTitle?: string;
  invoiceTerms?: string;
  invoiceFooterNote?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
  signatureLabel?: string;
  showGstin?: boolean;
  showVehicleDetails?: boolean;
  showPaymentDetails?: boolean;
  showTerms?: boolean;
  showBusinessPhone?: boolean;
  showBusinessEmail?: boolean;
  showBusinessAddress?: boolean;
  showCustomerPhone?: boolean;
  showCustomerAddress?: boolean;
  showCustomerGstin?: boolean;
  showInvoiceStatus?: boolean;
  showPaymentMode?: boolean;
  showPaidAmount?: boolean;
  showBalanceDue?: boolean;
  showSacCode?: boolean;
  showItemGstRate?: boolean;
  showFooterContactBar?: boolean;
  invoiceNumberLabel?: string;
  invoiceDateLabel?: string;
  billToLabel?: string;
  vehicleDetailsLabel?: string;
  paymentDetailsLabel?: string;
  bankDetailsLabel?: string;
  termsLabel?: string;
  subtotalLabel?: string;
  grandTotalLabel?: string;
  paidLabel?: string;
  balanceDueLabel?: string;
  paymentInstructions?: string;
  showLogo?: boolean;
  showSignature?: boolean;
  showUpiQr?: boolean;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceStatus: string;
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  customerId: string;
  customerCode: string;
  vehicleId: string;
  jobCardId: string;
  customerName: string;
  customerPhone: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
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
  paymentStatus: string;
  paymentMode: string;
  paymentReference: string;
  notes: string;
  cloudSyncStatus?: string;
  cancelledAt: string;
  cancelReason: string;
  createdAt: string;
}

export interface InvoiceCustomer {
  id: string;
  customerCode?: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
}

export interface InvoiceVehicle {
  id: string;
  customerId?: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  color: string;
}

export interface InvoiceItem {
  id: string;
  serviceId?: string;
  inventoryItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  sacCode: string;
  warrantyIncluded?: boolean;
  warrantyDurationMonths?: number;
  warrantyText?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  lineSubTotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface Payment {
  id: string;
  amount: number;
  mode: string;
  reference: string;
  paymentDate: string;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  customer: InvoiceCustomer;
  vehicle: InvoiceVehicle;
  items: InvoiceItem[];
  payments: Payment[];
}

export interface Customer {
  id: string;
  customerCode: string;
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

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  defaultPrice: number;
  gstRate: number;
  sacCode: string;
  warrantyEnabled: boolean;
  warrantyDurationMonths: number;
  warrantyText: string;
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
  warrantyIncluded?: boolean;
  warrantyDurationMonths?: number;
  warrantyText?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
}

export interface InvoiceCreateInput {
  invoiceMode: InvoiceMode;
  taxScope: TaxScope;
  invoiceDate: string;
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

export interface InvoicePaymentInput {
  invoiceId: string;
  amount: number;
  mode: PaymentMode;
  reference: string;
  paymentDate: string;
}

export interface InvoiceAppendItemInput {
  invoiceId: string;
  item: InvoiceItemInput;
}

export interface InvoiceCancelInput {
  invoiceId: string;
  reason: string;
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

export interface InventoryDashboardData {
  totalStockValue: number;
  lowStockCount: number;
  expiringCount: number;
  retailCount: number;
  items: InventoryItem[];
  lowStockItems: InventoryItem[];
  expiringBatches: Array<InventoryBatch & { itemName: string; unit: string }>;
  recentMovements: InventoryMovement[];
  batches?: Array<InventoryBatch & { itemName: string; unit: string }>;
  movements?: InventoryMovement[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  gstin: string;
  address: string;
  createdAt: string;
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

export interface EnquiryReportData {
  total: number;
  converted: number;
  lost: number;
  open: number;
  byStatus: Array<{ status: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
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
  byStatus: Array<{ status: string; count: number }>;
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
  paymentModes: Array<{ mode: string; amount: number }>;
  salesTrend: Array<{ date: string; label: string; billedValue: number; paidAmount: number; balanceDue: number }>;
  inventory: InventoryDashboardData;
  enquiries: EnquiryReportData;
  jobCards: JobCardReportData;
}

export interface DashboardData {
  todayRevenue: number;
  monthRevenue: number;
  pendingDues: number;
  todayInvoices: number;
  recentInvoices: InvoiceSummary[];
  topServices: Array<{ name: string; quantity: number; revenue: number }>;
  enquiries: {
    todayFollowups: number;
    overdueFollowups: number;
    newEnquiries: number;
    convertedEnquiries: number;
    dueToday?: unknown[];
    overdue?: unknown[];
    recentOpen?: unknown[];
  };
  jobCards: {
    todayJobs: number;
    openJobs: number;
    approvalPending: number;
    inProgress: number;
    readyDelivery: number;
    completedToday: number;
    recentOpen?: unknown[];
  };
}

export interface Expense {
  id: string;
  expenseDate: string;
  category: string;
  amount: number;
  paymentMode: string;
  vendor: string;
  reference: string;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
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

export interface DevicesListResult {
  devices: CloudDeviceSummary[];
  currentDeviceId: string;
}
