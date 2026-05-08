export type DateRangePreset = "7d" | "30d" | "90d" | "all";
export type ReportDateFilter = DateRangePreset | { fromDate?: string; toDate?: string; preset?: "" };
export type CloudDeviceApprovalStatus = "APPROVED" | "PENDING" | "REVOKED";
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
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceStatus: string;
  invoiceMode: string;
  taxScope: string;
  customerName: string;
  customerPhone: string;
  vehicleNumber: string;
  vehicleType: string;
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
  cancelledAt: string;
  cancelReason: string;
  createdAt: string;
}

export interface InvoiceCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
}

export interface InvoiceVehicle {
  id: string;
  registrationNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  color: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  sacCode: string;
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
  enquiries: Record<string, unknown>;
  jobCards: Record<string, unknown>;
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
