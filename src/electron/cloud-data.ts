import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { calculateInvoiceTotals, money } from "../shared/billing-math";
import { BUSINESS_SETTINGS_SYNC_ID, JOB_CARD_SETTINGS_SYNC_ID } from "../shared/types";
import type { CloudSyncEngine } from "./sync-engine";
import type {
  AccessRole,
  AppUser,
  AuthStatus,
  BackupCloudSnapshotStatus,
  BusinessSettings,
  ChangePasswordInput,
  Customer,
  CustomerWithVehicles,
  DateRangePreset,
  Enquiry,
  EnquiryFollowup,
  EnquiryFollowupInput,
  EnquiryInput,
  EnquiryStatus,
  Expense,
  ExpenseInput,
  InventoryBatch,
  InventoryDashboardData,
  InventoryItem,
  InventoryMovement,
  InventoryMovementInput,
  InventoryPurchaseInput,
  InvoiceCreateInput,
  InvoiceDetail,
  InvoiceSummary,
  JobCardChecklistItem,
  JobCardDashboardData,
  JobCardDetail,
  JobCardInput,
  JobCardItem,
  JobCardPhoto,
  JobCardPhotoType,
  JobCardStatus,
  JobCardStatusHistory,
  Payment,
  PaymentMode,
  ProfitReportData,
  PurchaseRecord,
  PurchaseRecordDocument,
  PurchaseRecordInput,
  QuotationDetail,
  QuotationItem,
  QuotationSaveInput,
  QuotationStatusInput,
  QuotationSummary,
  RecordPaymentInput,
  ReportExportKind,
  ReportData,
  ReportDateFilter,
  SaveAccessRoleInput,
  SaveUserInput,
  ServiceConsumable,
  ServiceItem,
  Supplier,
  TaxScope,
  Vehicle,
  VehicleType,
  WhatsAppBusinessStatus,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppSendMessageInput,
  WhatsAppSendMessageResult,
  WhatsAppTemplate
} from "../shared/types";

type RecordResponse<T> = { record?: T; data?: T; revision?: number };
type ListResponse<T> = { items?: T[]; records?: Array<{ recordId?: string; revision?: number; data: T }> };
type SnapshotRecord = { recordId: string; revision: number; data: unknown };
type CloudSnapshotExport = {
  data: Buffer;
  status: BackupCloudSnapshotStatus;
};

const nowIso = () => new Date().toISOString();
const localDate = (date = new Date()) => {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
};
const requiredText = (value: unknown, label: string) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
};
const normalizeVehicleType = (value: unknown): VehicleType => {
  const text = String(value || "");
  return text === "bike" || text === "other" ? text : "car";
};
const normalizeTaxScope = (value: unknown): TaxScope => String(value || "") === "inter" ? "inter" : "intra";
const isActive = (value: { active?: boolean }) => value.active !== false;
const searchBlob = (value: unknown) => JSON.stringify(value || {}).toLowerCase();
const JOB_CARD_PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_JOB_CARD_PHOTO_BYTES = 10 * 1024 * 1024;
const PURCHASE_DOCUMENT_EXTENSIONS = new Set([".pdf", ...JOB_CARD_PHOTO_EXTENSIONS]);
const MAX_PURCHASE_DOCUMENT_BYTES = 15 * 1024 * 1024;
const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const CLOUD_SNAPSHOT_RECORD_ENTITIES = [
  "settings",
  "customers",
  "vehicles",
  "services",
  "inventory_items",
  "inventory_batches",
  "inventory_movements",
  "suppliers",
  "service_consumables",
  "enquiries",
  "enquiry_followups",
  "job_cards",
  "job_card_items",
  "job_card_photos",
  "job_card_checklist_items",
  "job_card_status_history",
  "invoices",
  "invoice_items",
  "payments",
  "quotations",
  "quotation_items",
  "purchase_records",
  "expenses"
] as const;
const CLOUD_SNAPSHOT_PROTECTED_ENTITIES = ["users", "access_roles"] as const;
const SNAPSHOT_SECRET_KEY = /(password|secret|token|salt|hash|credential)/i;
const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const rowsToCsv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
};
const sanitizeSnapshotData = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value ?? null, (key, currentValue) => (key && SNAPSHOT_SECRET_KEY.test(key) ? undefined : currentValue))
  );
const cloudSafeSettingsPayload = (settings: Record<string, unknown>) => {
  const next = { ...settings };
  delete next.googleDriveClientSecret;
  return next;
};
const fileMime = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".pdf") return "application/pdf";
  return "application/octet-stream";
};
const safePathSegment = (value: string) => String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "document";
const validateJobCardPhotoSource = (filePath: string) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error("Selected photo was not found.");
  const extension = path.extname(resolved).toLowerCase();
  if (!JOB_CARD_PHOTO_EXTENSIONS.has(extension)) throw new Error("Only image files can be attached to a job card.");
  const size = fs.statSync(resolved).size;
  if (size <= 0) throw new Error("Selected photo is empty.");
  if (size > MAX_JOB_CARD_PHOTO_BYTES) throw new Error("Each job card photo must be 10 MB or smaller.");
  return { resolved, size };
};
const validatePurchaseDocumentSource = (filePath: string) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error("Selected purchase document was not found.");
  const extension = path.extname(resolved).toLowerCase();
  if (!PURCHASE_DOCUMENT_EXTENSIONS.has(extension)) throw new Error("Only PDF and image files can be attached to a purchase record.");
  const size = fs.statSync(resolved).size;
  if (size <= 0) throw new Error("Selected purchase document is empty.");
  if (size > MAX_PURCHASE_DOCUMENT_BYTES) throw new Error("Each purchase document must be 15 MB or smaller.");
  return { resolved, size };
};
const normalizePaymentMode = (value: unknown): PaymentMode => {
  const text = String(value || "");
  return PAYMENT_MODES.includes(text as PaymentMode) ? (text as PaymentMode) : "UPI";
};
const normalizeQuotationDraftItems = (items: QuotationSaveInput["items"] = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) =>
      Boolean(
        String(item.serviceId || "").trim() ||
          String(item.inventoryItemId || "").trim() ||
          String(item.description || "").trim() ||
          Number(item.unitPrice || 0) > 0
      )
    )
    .map((item) => ({
      serviceId: item.serviceId || "",
      inventoryItemId: item.inventoryItemId || "",
      description: String(item.description || "").trim(),
      quantity: money(Math.max(0, Number(item.quantity || 0))),
      unitPrice: money(Math.max(0, Number(item.unitPrice || 0))),
      gstRate: money(Math.max(0, Number(item.gstRate || 0))),
      sacCode: item.sacCode || "9987"
    }));

export class CloudDataClient {
  private readonly sessionCache = new Map<string, unknown[]>();
  private readonly purchaseDocumentRoot: string;

  constructor(private readonly cloud: CloudSyncEngine, options: { purchaseDocumentRoot?: string } = {}) {
    this.purchaseDocumentRoot = options.purchaseDocumentRoot || "";
  }

  private cacheKey(entity: string, params: Record<string, unknown> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return `${entity}?${query.toString()}`;
  }

  private async list<T>(entity: string, params: Record<string, unknown> = {}, options: { allowCacheFallback?: boolean } = {}): Promise<T[]> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    const path = `/api/v1/records/${entity}${query.toString() ? `?${query.toString()}` : ""}`;
    const key = this.cacheKey(entity, params);
    try {
      const response = await this.cloud.cloudRequest<ListResponse<T>>(path);
      const items = response.items || (response.records || []).map((row) => row.data);
      this.sessionCache.set(key, items);
      return items;
    } catch (error) {
      if (options.allowCacheFallback !== false) {
        const cached = this.sessionCache.get(key) as T[] | undefined;
        if (cached) return cached;
      }
      throw error;
    }
  }

  private async listSnapshotRecords(entity: string): Promise<SnapshotRecord[]> {
    const response = await this.cloud.cloudRequest<ListResponse<unknown>>(`/api/v1/records/${entity}?includeInactive=true`);
    if (response.records) {
      return response.records.map((row) => ({
        recordId: String(row.recordId || (row.data as { id?: string })?.id || ""),
        revision: Number(row.revision || 0),
        data: sanitizeSnapshotData(row.data)
      }));
    }
    return (response.items || []).map((data) => ({
      recordId: String((data as { id?: string })?.id || ""),
      revision: 0,
      data: sanitizeSnapshotData(data)
    }));
  }

  private async save<T extends { id: string }>(entity: string, data: Partial<T> & { id?: string }): Promise<T> {
    const response = await this.cloud.cloudRequest<RecordResponse<T>>(`/api/v1/records/${entity}`, {
      method: "POST",
      body: { data }
    });
    this.invalidate(entity);
    return (response.record || response.data) as T;
  }

  private async patch<T extends { id: string }>(entity: string, id: string, data: Partial<T>): Promise<T> {
    const response = await this.cloud.cloudRequest<RecordResponse<T>>(`/api/v1/records/${entity}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { data }
    });
    this.invalidate(entity);
    return (response.record || response.data) as T;
  }

  private async remove(entity: string, id: string) {
    await this.cloud.cloudRequest(`/api/v1/records/${entity}/${encodeURIComponent(id)}`, { method: "DELETE" });
    this.invalidate(entity);
    return true;
  }

  private invalidate(entity?: string) {
    [...this.sessionCache.keys()].forEach((key) => {
      if (!entity || key.startsWith(`${entity}?`)) this.sessionCache.delete(key);
    });
  }

  async authStatus(): Promise<AuthStatus> {
    return this.cloud.cloudRequest<AuthStatus>("/api/v1/auth/status");
  }

  async setupOwner(input: { displayName: string; username: string; password: string }): Promise<AppUser> {
    const response = await this.cloud.cloudRequest<{ user: AppUser }>("/api/v1/auth/setup-owner", { method: "POST", body: input });
    this.invalidate("users");
    this.invalidate("access_roles");
    return response.user;
  }

  async login(input: { username: string; password: string }): Promise<AppUser> {
    const response = await this.cloud.cloudRequest<{ user: AppUser }>("/api/v1/auth/login", { method: "POST", body: input });
    return response.user;
  }

  async listUsers(): Promise<AppUser[]> {
    const response = await this.cloud.cloudRequest<{ users: AppUser[] }>("/api/v1/users");
    return response.users;
  }

  async getUserById(id: string): Promise<AppUser | null> {
    const users = await this.listUsers();
    return users.find((user) => user.id === id) || null;
  }

  async saveUser(input: SaveUserInput): Promise<AppUser> {
    const response = await this.cloud.cloudRequest<{ user: AppUser }>("/api/v1/users", { method: "POST", body: input });
    this.invalidate("users");
    return response.user;
  }

  async deactivateUser(id: string) {
    await this.cloud.cloudRequest(`/api/v1/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    this.invalidate("users");
    return true;
  }

  async changePassword(input: ChangePasswordInput) {
    await this.cloud.cloudRequest(`/api/v1/users/${encodeURIComponent(input.userId)}/change-password`, { method: "POST", body: input });
    return true;
  }

  async listAccessRoles(): Promise<AccessRole[]> {
    const response = await this.cloud.cloudRequest<{ roles: AccessRole[] }>("/api/v1/access-roles");
    return response.roles;
  }

  async saveAccessRole(input: SaveAccessRoleInput): Promise<AccessRole> {
    const response = await this.cloud.cloudRequest<{ role: AccessRole }>("/api/v1/access-roles", { method: "POST", body: input });
    this.invalidate("access_roles");
    return response.role;
  }

  async deactivateAccessRole(id: string) {
    await this.cloud.cloudRequest(`/api/v1/access-roles/${encodeURIComponent(id)}`, { method: "DELETE" });
    this.invalidate("access_roles");
    return true;
  }

  async exportCloudSnapshot(): Promise<CloudSnapshotExport> {
    const exportedAt = nowIso();
    const entities: Record<string, SnapshotRecord[]> = {};
    const [users, accessRoles] = await Promise.all([this.listUsers(), this.listAccessRoles()]);
    entities.users = users.map((user) => ({
      recordId: user.id,
      revision: 0,
      data: sanitizeSnapshotData(user)
    }));
    entities.access_roles = accessRoles.map((role) => ({
      recordId: role.id,
      revision: 0,
      data: sanitizeSnapshotData(role)
    }));

    await Promise.all(
      CLOUD_SNAPSHOT_RECORD_ENTITIES.map(async (entity) => {
        entities[entity] = await this.listSnapshotRecords(entity);
      })
    );

    const entityCounts = Object.fromEntries(Object.entries(entities).map(([entity, records]) => [entity, records.length]));
    const recordCount = Object.values(entityCounts).reduce((total, count) => total + Number(count || 0), 0);
    const invoiceCount = entityCounts.invoices || 0;
    const snapshot = {
      app: "Autocare24 Billing",
      format: "autocare24-cloud-snapshot",
      version: 1,
      exportedAt,
      source: "cloud-api",
      protectedEntities: CLOUD_SNAPSHOT_PROTECTED_ENTITIES,
      entityCounts,
      recordCount,
      invoiceCount,
      entities
    };
    return {
      data: Buffer.from(JSON.stringify(snapshot, null, 2), "utf8"),
      status: {
        included: true,
        exportedAt,
        entityCount: Object.keys(entities).length,
        recordCount,
        invoiceCount,
        error: ""
      }
    };
  }

  async dashboard() {
    const response = await this.cloud.cloudRequest<{ dashboard: unknown }>("/api/v1/dashboard");
    return response.dashboard;
  }

  async getSettings(fallback: BusinessSettings): Promise<BusinessSettings> {
    try {
      const settings = await this.list<BusinessSettings>("settings");
      const cloudSettings = settings.find((row) => (row as unknown as { id?: string }).id === BUSINESS_SETTINGS_SYNC_ID) || settings[0] || {};
      return {
        ...fallback,
        ...cloudSafeSettingsPayload(cloudSettings as unknown as Record<string, unknown>),
        googleDriveClientSecret: ""
      } as BusinessSettings;
    } catch {
      return { ...fallback, googleDriveClientSecret: "" };
    }
  }

  saveSettings(settings: Partial<BusinessSettings>) {
    return this.save<BusinessSettings & { id: string }>(
      "settings",
      cloudSafeSettingsPayload({ id: BUSINESS_SETTINGS_SYNC_ID, ...settings }) as Partial<BusinessSettings> & { id: string }
    );
  }

  listServices(includeInactive = false) {
    return this.list<ServiceItem>("services", { includeInactive }).then((rows) =>
      rows.filter((row) => includeInactive || isActive(row)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    );
  }

  saveService(service: Partial<ServiceItem> & Pick<ServiceItem, "name">) {
    return this.save<ServiceItem>("services", {
      id: service.id || randomUUID(),
      name: requiredText(service.name, "Service name"),
      category: service.category || "Detailing",
      defaultPrice: money(Number(service.defaultPrice || 0)),
      gstRate: money(Number(service.gstRate || 0)),
      sacCode: service.sacCode || "9987",
      active: service.active !== false,
      createdAt: service.createdAt || nowIso()
    });
  }

  deactivateService(id: string) {
    return this.patch<ServiceItem>("services", id, { active: false }).then(() => true);
  }

  async listCustomers(): Promise<CustomerWithVehicles[]> {
    const [customers, vehicles] = await Promise.all([this.list<Customer>("customers"), this.list<Vehicle>("vehicles")]);
    return customers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((customer) => ({
        ...customer,
        vehicles: vehicles.filter((vehicle) => vehicle.customerId === customer.id).sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber))
      }));
  }

  async getWhatsAppStatus(): Promise<WhatsAppBusinessStatus> {
    const response = await this.cloud.cloudRequest<{ status: WhatsAppBusinessStatus }>("/api/v1/whatsapp/status");
    return response.status;
  }

  async listWhatsAppConversations(query = ""): Promise<WhatsAppConversation[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const response = await this.cloud.cloudRequest<{ conversations: WhatsAppConversation[] }>(
      `/api/v1/whatsapp/conversations${params.toString() ? `?${params}` : ""}`
    );
    return response.conversations || [];
  }

  async listWhatsAppMessages(conversationId: string): Promise<{ conversation: WhatsAppConversation; messages: WhatsAppMessage[] }> {
    const response = await this.cloud.cloudRequest<{ conversation: WhatsAppConversation; messages: WhatsAppMessage[] }>(
      `/api/v1/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`
    );
    return { conversation: response.conversation, messages: response.messages || [] };
  }

  async listWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
    const response = await this.cloud.cloudRequest<{ templates: WhatsAppTemplate[] }>("/api/v1/whatsapp/templates");
    return response.templates || [];
  }

  async syncWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
    const response = await this.cloud.cloudRequest<{ templates: WhatsAppTemplate[] }>("/api/v1/whatsapp/templates/sync", { method: "POST" });
    return response.templates || [];
  }

  sendWhatsAppMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppSendMessageResult> {
    return this.cloud.cloudRequest<WhatsAppSendMessageResult>("/api/v1/whatsapp/messages", {
      method: "POST",
      body: input
    });
  }

  saveCustomer(customer: Partial<Customer> & Pick<Customer, "name">) {
    return this.save<Customer>("customers", {
      id: customer.id || randomUUID(),
      name: requiredText(customer.name, "Customer name"),
      phone: customer.phone || "",
      email: customer.email || "",
      gstin: customer.gstin || "",
      address: customer.address || "",
      createdAt: customer.createdAt || nowIso()
    });
  }

  saveVehicle(vehicle: Partial<Vehicle> & Pick<Vehicle, "customerId" | "registrationNumber">) {
    return this.save<Vehicle>("vehicles", {
      id: vehicle.id || randomUUID(),
      customerId: requiredText(vehicle.customerId, "Customer"),
      vehicleType: normalizeVehicleType(vehicle.vehicleType),
      registrationNumber: requiredText(vehicle.registrationNumber, "Vehicle number").toUpperCase(),
      make: vehicle.make || "",
      model: vehicle.model || "",
      color: vehicle.color || "",
      createdAt: vehicle.createdAt || nowIso()
    });
  }

  async inventoryDashboard(): Promise<InventoryDashboardData> {
    const response = await this.cloud.cloudRequest<{ dashboard: InventoryDashboardData }>("/api/v1/inventory/dashboard");
    this.sessionCache.set(this.cacheKey("inventory_items", { includeInactive: true }), response.dashboard.items);
    return response.dashboard;
  }

  async listInventoryItems(includeInactive = false) {
    const dashboard = await this.inventoryDashboard();
    return dashboard.items.filter((item) => includeInactive || item.active);
  }

  saveInventoryItem(item: Partial<InventoryItem> & Pick<InventoryItem, "name">) {
    return this.save<InventoryItem>("inventory_items", {
      id: item.id || randomUUID(),
      name: requiredText(item.name, "Inventory item name"),
      type: item.type === "retail" ? "retail" : "consumable",
      unit: item.unit || "piece",
      sku: item.sku || "",
      category: item.category || "Studio stock",
      retailPrice: money(Number(item.retailPrice || 0)),
      gstRate: money(Number(item.gstRate || 0)),
      lowStockLevel: money(Number(item.lowStockLevel || 0)),
      active: item.active !== false,
      currentQuantity: money(Number(item.currentQuantity || 0)),
      stockValue: money(Number(item.stockValue || 0)),
      createdAt: item.createdAt || nowIso()
    });
  }

  deactivateInventoryItem(id: string) {
    return this.patch<InventoryItem>("inventory_items", id, { active: false }).then(() => true);
  }

  listSuppliers() {
    return this.list<Supplier>("suppliers").then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
  }

  saveSupplier(supplier: Partial<Supplier> & Pick<Supplier, "name">) {
    return this.save<Supplier>("suppliers", {
      id: supplier.id || randomUUID(),
      name: requiredText(supplier.name, "Supplier name"),
      phone: supplier.phone || "",
      gstin: supplier.gstin || "",
      address: supplier.address || "",
      createdAt: supplier.createdAt || nowIso()
    });
  }

  async addInventoryPurchase(input: InventoryPurchaseInput) {
    const response = await this.cloud.cloudRequest<{ batch: InventoryBatch }>("/api/v1/inventory/purchases", { method: "POST", body: input });
    this.invalidate();
    return response.batch;
  }

  async addInventoryMovement(input: InventoryMovementInput) {
    const response = await this.cloud.cloudRequest<{ movements: InventoryMovement[] }>("/api/v1/inventory/movements", { method: "POST", body: input });
    this.invalidate();
    return response.movements;
  }

  async listPurchaseRecords(query = "") {
    const q = query.trim().toLowerCase();
    const rows = await this.list<PurchaseRecord>("purchase_records", { includeInactive: true });
    return rows
      .filter((row) => !q || searchBlob(row).includes(q))
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt));
  }

  async listPayments() {
    return this.list<Payment>("payments", { includeInactive: true }).then((rows) =>
      rows.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt))
    );
  }

  async listAllInvoices() {
    return this.list<InvoiceSummary>("invoices", { includeInactive: true }).then((rows) =>
      rows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.createdAt.localeCompare(a.createdAt))
    );
  }

  async savePurchaseRecord(input: PurchaseRecordInput, documentPaths: string[] = []) {
    const id = input.id || randomUUID();
    const createdAt = input.createdAt || nowIso();
    const suppliers = input.supplierId ? await this.listSuppliers() : [];
    const supplier = suppliers.find((row) => row.id === input.supplierId);
    const supplierName = supplier?.name || input.supplierName || "";
    const vendorName = supplierName || requiredText(input.vendorName, "Vendor name");
    const documents: PurchaseRecordDocument[] = Array.isArray(input.documents) ? [...input.documents] : [];

    for (const filePath of documentPaths) {
      const { resolved } = validatePurchaseDocumentSource(filePath);
      const uploaded = await this.uploadCloudFile(resolved, "purchase_records", id, "DOCUMENT");
      documents.push({
        id: uploaded.fileId,
        fileId: uploaded.fileId,
        originalName: uploaded.originalName || path.basename(resolved),
        mimeType: uploaded.mimeType || fileMime(filePath),
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
        uploadedAt: nowIso(),
        localPath: this.copyPurchaseDocumentToLocalStore(id, uploaded.fileId, resolved)
      });
    }

    return this.save<PurchaseRecord>("purchase_records", {
      id,
      purchaseDate: input.purchaseDate || localDate(),
      supplierId: input.supplierId || "",
      supplierName,
      vendorName,
      billNumber: input.billNumber || "",
      amount: money(Math.max(0, Number(input.amount || 0))),
      paymentMode: normalizePaymentMode(input.paymentMode),
      notes: input.notes || "",
      documents,
      createdAt,
      updatedAt: nowIso()
    });
  }

  deletePurchaseRecord(id: string) {
    return this.remove("purchase_records", id);
  }

  async purchaseDocumentDataUrl(fileId: string, localPath = "") {
    try {
      return await this.cloud.cloudBinaryDataUrl(`/api/v1/files/${encodeURIComponent(fileId)}`);
    } catch (error) {
      const fallback = this.localPurchaseDocumentDataUrl(localPath);
      if (fallback) return fallback;
      throw error;
    }
  }

  async listInventoryBatches(itemId?: string) {
    const dashboard = await this.inventoryDashboard() as InventoryDashboardData & { batches?: Array<InventoryBatch & { itemName: string; unit: string }> };
    const batches = dashboard.batches || [];
    return itemId ? batches.filter((batch) => batch.itemId === itemId) : batches;
  }

  async listInventoryMovements(itemId?: string) {
    const dashboard = await this.inventoryDashboard() as InventoryDashboardData & { movements?: InventoryMovement[] };
    const movements = dashboard.movements || dashboard.recentMovements || [];
    return itemId ? movements.filter((movement) => movement.itemId === itemId) : movements;
  }

  async getServiceRecipe(serviceId: string) {
    const [recipe, inventory] = await Promise.all([this.list<ServiceConsumable>("service_consumables"), this.listInventoryItems(true)]);
    const itemMap = new Map(inventory.map((item) => [item.id, item]));
    return recipe
      .filter((row) => row.serviceId === serviceId)
      .map((row) => ({ ...row, itemName: row.itemName || itemMap.get(row.inventoryItemId)?.name || "", unit: row.unit || itemMap.get(row.inventoryItemId)?.unit || "" }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  }

  async saveServiceRecipe(serviceId: string, rows: Array<{ inventoryItemId: string; quantity: number }>) {
    const current = await this.getServiceRecipe(serviceId);
    await Promise.all(current.map((row) => this.remove("service_consumables", row.id)));
    const saved: ServiceConsumable[] = [];
    for (const row of rows.filter((item) => item.inventoryItemId && Number(item.quantity) > 0)) {
      saved.push(await this.save<ServiceConsumable>("service_consumables", {
        id: randomUUID(),
        serviceId,
        inventoryItemId: row.inventoryItemId,
        quantity: money(Number(row.quantity)),
        itemName: "",
        unit: ""
      } as Partial<ServiceConsumable> & { id: string }));
    }
    return this.getServiceRecipe(serviceId).then((latest) => latest.length ? latest : saved);
  }

  async createInvoice(input: InvoiceCreateInput, source = "invoice", localId = ""): Promise<InvoiceDetail> {
    const settings = await this.getSettings({ invoicePrefix: "INV" } as BusinessSettings);
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>("/api/v1/invoices/finalize", {
      method: "POST",
      body: {
        source,
        localId,
        idempotencyKey: localId ? `invoice-finalize:${source}:${localId}` : randomUUID(),
        payload: { ...input, invoicePrefix: settings.invoicePrefix || "INV" }
      }
    });
    this.invalidate();
    return response.invoice;
  }

  async listInvoices(query = "") {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    const response = await this.cloud.cloudRequest<{ invoices: InvoiceSummary[] }>(`/api/v1/invoices${params.toString() ? `?${params}` : ""}`);
    return response.invoices;
  }

  async getInvoice(id: string) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/invoices/${encodeURIComponent(id)}`);
    return response.invoice;
  }

  async recordPayment(input: RecordPaymentInput) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/payments`, {
      method: "POST",
      body: input
    });
    this.invalidate();
    return response.invoice;
  }

  async cancelInvoice(input: { invoiceId: string; reason: string; cancelledByUserId?: string }) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/cancel`, {
      method: "POST",
      body: input
    });
    this.invalidate();
    return response.invoice;
  }

  async appendInvoiceItem(input: { invoiceId: string; item: InvoiceCreateInput["items"][number] }) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/items`, {
      method: "POST",
      body: { item: input.item }
    });
    this.invalidate();
    return response.invoice;
  }

  async saveQuotation(input: QuotationSaveInput): Promise<QuotationDetail> {
    const draftItems = normalizeQuotationDraftItems(input.items);
    const totals = calculateInvoiceTotals(input.invoiceMode, normalizeTaxScope(input.taxScope), draftItems, input.discount);
    const quotationId = input.id || randomUUID();
    const customerId = input.customerId || input.customer?.id || "";
    const vehicleId = input.vehicleId || input.vehicle?.id || "";
    const vehicleType = normalizeVehicleType(input.vehicle?.vehicleType);
    const quotation = await this.save<QuotationSummary>("quotations", {
      id: quotationId,
      quotationNumber: "",
      quotationStatus: input.status || "draft",
      invoiceMode: input.invoiceMode,
      taxScope: normalizeTaxScope(input.taxScope),
      quotationDate: input.quotationDate || localDate(),
      validUntil: input.validUntil || "",
      customerId,
      vehicleId,
      vehicleType,
      customerName: input.customer?.name || "",
      customerPhone: input.customer?.phone || "",
      customerEmail: input.customer?.email || "",
      customerGstin: input.customer?.gstin || "",
      customerAddress: input.customer?.address || "",
      vehicleNumber: input.vehicle?.registrationNumber || "",
      vehicleMake: input.vehicle?.make || "",
      vehicleModel: input.vehicle?.model || "",
      vehicleColor: input.vehicle?.color || "",
      subTotal: totals.subTotal,
      discount: totals.discount,
      taxableValue: totals.taxableValue,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      notes: input.notes || "",
      convertedInvoiceId: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const oldItems = (await this.list<QuotationItem>("quotation_items")).filter((row) => row.quotationId === quotationId);
    await Promise.all(oldItems.map((row) => this.remove("quotation_items", row.id)));
    for (const item of totals.items) {
      await this.save<QuotationItem>("quotation_items", { id: randomUUID(), quotationId, ...item });
    }
    return this.getQuotation(quotation.id);
  }

  async listQuotations(query = "") {
    const rows = await this.list<QuotationSummary>("quotations", { includeInactive: true });
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => !q || searchBlob(row).includes(q))
      .sort((a, b) => String(b.quotationDate).localeCompare(String(a.quotationDate)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 300);
  }

  async getQuotation(id: string): Promise<QuotationDetail> {
    const [quotations, customers, vehicles, items, invoices] = await Promise.all([
      this.list<QuotationSummary>("quotations", { includeInactive: true }),
      this.list<Customer>("customers"),
      this.list<Vehicle>("vehicles"),
      this.list<QuotationItem>("quotation_items"),
      this.listInvoices("")
    ]);
    const quotation = quotations.find((row) => row.id === id);
    if (!quotation) throw new Error("Quotation not found.");
    const customer = customers.find((row) => row.id === quotation.customerId) || ({
      id: quotation.customerId,
      name: quotation.customerName || "",
      phone: quotation.customerPhone || "",
      email: quotation.customerEmail || "",
      gstin: quotation.customerGstin || "",
      address: quotation.customerAddress || "",
      createdAt: quotation.createdAt || localDate()
    } as Customer);
    const vehicle = vehicles.find((row) => row.id === quotation.vehicleId) || ({
      id: quotation.vehicleId,
      customerId: quotation.customerId,
      vehicleType: quotation.vehicleType || "car",
      registrationNumber: quotation.vehicleNumber || "",
      make: quotation.vehicleMake || "",
      model: quotation.vehicleModel || "",
      color: quotation.vehicleColor || "",
      createdAt: quotation.createdAt || localDate()
    } as Vehicle);
    return {
      ...quotation,
      customer,
      vehicle,
      items: items.filter((row) => row.quotationId === id),
      convertedInvoice: quotation.convertedInvoiceId ? invoices.find((row) => row.id === quotation.convertedInvoiceId) : undefined
    };
  }

  updateQuotationStatus(input: QuotationStatusInput) {
    return this.patch<QuotationSummary>("quotations", input.quotationId, { quotationStatus: input.status, updatedAt: nowIso() }).then((row) => this.getQuotation(row.id));
  }

  async convertQuotationToInvoice(id: string) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/quotations/${encodeURIComponent(id)}/convert-to-invoice`, {
      method: "POST"
    });
    const invoice = response.invoice;
    this.invalidate();
    return invoice;
  }

  listExpenses(filter: DateRangePreset | ReportDateFilter = "30d") {
    return this.list<Expense>("expenses", { includeInactive: true }).then((rows) => rows.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)));
  }

  saveExpense(input: ExpenseInput, userId: string) {
    return this.save<Expense>("expenses", {
      id: input.id || randomUUID(),
      expenseDate: input.expenseDate || localDate(),
      category: requiredText(input.category, "Expense category"),
      amount: money(Number(input.amount || 0)),
      paymentMode: input.paymentMode || "UPI",
      vendor: input.vendor || "",
      reference: input.reference || "",
      notes: input.notes || "",
      createdByUserId: userId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  deleteExpense(id: string) {
    return this.remove("expenses", id);
  }

  async reports(filter: DateRangePreset | ReportDateFilter) {
    const query = typeof filter === "string" ? `preset=${encodeURIComponent(filter)}` : `filterJson=${encodeURIComponent(JSON.stringify(filter || "30d"))}`;
    const response = await this.cloud.cloudRequest<{ report: ReportData }>(`/api/v1/reports?${query}`);
    return response.report;
  }

  async profit(filter: DateRangePreset | ReportDateFilter) {
    const query = typeof filter === "string" ? `preset=${encodeURIComponent(filter)}` : `filterJson=${encodeURIComponent(JSON.stringify(filter || "30d"))}`;
    const response = await this.cloud.cloudRequest<{ profit: ProfitReportData }>(`/api/v1/profit?${query}`);
    return response.profit;
  }

  async exportReportCsv(kind: ReportExportKind, filter: DateRangePreset | ReportDateFilter = "30d") {
    const [report, profit] = await Promise.all([
      this.reports(filter),
      kind === "profit" || kind === "full" ? this.profit(filter) : Promise.resolve(null)
    ]);
    const sections: string[] = [];
    const include = (section: ReportExportKind) => kind === "full" || kind === section;
    const addSection = (title: string, rows: Array<Record<string, unknown>>) => {
      if (!rows.length) return;
      sections.push(title, rowsToCsv(rows));
    };

    if (include("sales")) {
      addSection("Sales Summary", [{
        range: report.rangeLabel,
        invoices: report.invoiceCount,
        invoiceBilled: report.invoiceRevenue ?? report.revenue,
        quickStockSales: report.quickStockSales ?? 0,
        totalSales: report.totalSales ?? report.revenue,
        collected: report.paidAmount,
        due: report.balanceDue,
        cancelled: report.cancelledCount
      }]);
      addSection("Daily Sales Trend", report.salesTrend || []);
      addSection("Top Services", report.topServices || []);
    }
    if (include("gst")) {
      addSection("GST Tax Summary", [{
        taxableValue: report.taxableValue,
        cgst: report.cgst,
        sgst: report.sgst,
        igst: report.igst,
        totalTax: report.totalTax
      }]);
    }
    if (include("payments")) {
      addSection("Payment Modes", report.paymentModes || []);
      addSection("Pending Dues", (report.dues || []).map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        customer: invoice.customerName,
        phone: invoice.customerPhone,
        vehicle: invoice.vehicleNumber,
        grandTotal: invoice.grandTotal,
        paidAmount: invoice.paidAmount,
        balanceDue: invoice.balanceDue,
        paymentStatus: invoice.paymentStatus
      })));
    }
    if (include("stock")) {
      addSection("Stock Summary", [{
        stockValue: report.inventory.totalStockValue,
        lowStock: report.inventory.lowStockCount,
        expiringBatches: report.inventory.expiringCount,
        retailProducts: report.inventory.retailCount
      }]);
      addSection("Stock Items", report.inventory.items.map((item) => ({
        name: item.name,
        type: item.type,
        category: item.category,
        available: item.currentQuantity,
        unit: item.unit,
        lowStockLevel: item.lowStockLevel,
        stockValue: item.stockValue,
        sellingPrice: item.retailPrice,
        active: item.active ? "yes" : "no"
      })));
      addSection("Recent Stock Movements", report.inventory.recentMovements.map((movement) => ({
        date: movement.movementDate,
        item: movement.itemName,
        type: movement.type,
        quantity: movement.quantity,
        unit: movement.itemUnit,
        costValue: money(movement.quantity * movement.unitCost),
        saleValue: movement.saleAmount || 0,
        paymentMode: movement.paymentMode || "",
        reference: movement.reference,
        notes: movement.notes
      })));
    }
    if (include("enquiries")) {
      addSection("Enquiry Summary", [{
        total: report.enquiries.total,
        open: report.enquiries.open,
        converted: report.enquiries.converted,
        lost: report.enquiries.lost
      }]);
      addSection("Enquiries By Source", report.enquiries.bySource || []);
      addSection("Enquiries By Status", report.enquiries.byStatus || []);
    }
    if (include("jobCards")) {
      addSection("Job Card Summary", [{
        total: report.jobCards.total,
        open: report.jobCards.open,
        approvalPending: report.jobCards.approvalPending,
        inProgress: report.jobCards.inProgress,
        completed: report.jobCards.completed,
        billed: report.jobCards.billed,
        billedRevenue: report.jobCards.billedRevenue
      }]);
      addSection("Job Cards By Status", report.jobCards.byStatus || []);
    }
    if (include("profit") && profit) {
      addSection("Profit Summary", [{
        range: profit.rangeLabel,
        paidRevenue: profit.paidRevenue,
        stockCost: profit.stockCost,
        expenses: profit.expenseTotal,
        cashProfit: profit.cashProfit,
        profitMargin: profit.profitMargin
      }]);
      addSection("Expenses By Category", profit.expensesByCategory || []);
      addSection("Expenses", (profit.expenses || []).map((expense) => ({ ...expense })));
    }
    return sections.join("\n\n");
  }

  async exportCsv(kind: "invoices" | "customers" | "services" | "inventory" | "enquiries" | "jobCards") {
    const rows =
      kind === "invoices"
        ? (await this.listInvoices("")).map((invoice) => ({
            invoiceNumber: invoice.invoiceNumber,
            date: invoice.invoiceDate,
            customer: invoice.customerName,
            vehicleType: invoice.vehicleType,
            vehicle: invoice.vehicleNumber,
            mode: invoice.invoiceMode,
            total: invoice.grandTotal,
            paid: invoice.paidAmount,
            balance: invoice.balanceDue,
            invoiceStatus: invoice.invoiceStatus,
            paymentStatus: invoice.paymentStatus,
            cancelReason: invoice.cancelReason,
            sourceInvoiceId: invoice.sourceInvoiceId,
            replacementInvoiceId: invoice.replacementInvoiceId
          }))
        : kind === "customers"
          ? (await this.listCustomers()).map((customer) => ({
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              gstin: customer.gstin,
              address: customer.address,
              vehicles: customer.vehicles.map((vehicle) => `${vehicle.vehicleType} ${vehicle.registrationNumber}`.trim()).join(" | ")
            }))
          : kind === "services"
            ? (await this.listServices(true)).map((service) => ({
                name: service.name,
                category: service.category,
                price: service.defaultPrice,
                gstRate: service.gstRate,
                sacCode: service.sacCode,
                active: service.active ? "yes" : "no"
              }))
            : kind === "inventory"
              ? (await this.listInventoryItems(true)).map((item) => ({
                  name: item.name,
                  type: item.type,
                  unit: item.unit,
                  category: item.category,
                  currentQuantity: item.currentQuantity,
                  lowStockLevel: item.lowStockLevel,
                  stockValue: item.stockValue,
                  retailPrice: item.retailPrice,
                  active: item.active ? "yes" : "no"
                }))
              : kind === "enquiries"
                ? (await this.listEnquiries()).map((enquiry) => ({
                    customerName: enquiry.customerName,
                    phone: enquiry.phone,
                    vehicleType: enquiry.vehicleType,
                    vehicleNumber: enquiry.vehicleNumber,
                    interestedService: enquiry.interestedService,
                    source: enquiry.source,
                    status: enquiry.status,
                    followUpDate: enquiry.followUpDate,
                    expectedBudget: enquiry.expectedBudget,
                    createdAt: enquiry.createdAt
                  }))
                : (await this.listJobCards()).map((jobCard) => ({
                    jobNumber: jobCard.jobNumber,
                    status: jobCard.status,
                    jobDate: jobCard.jobDate,
                    customer: jobCard.customerName,
                    phone: jobCard.customerPhone,
                    vehicleType: jobCard.vehicleType,
                    vehicleNumber: jobCard.vehicleNumber,
                    expectedDelivery: [jobCard.expectedDeliveryDate, jobCard.expectedDeliveryTime].filter(Boolean).join(" "),
                    grandTotal: jobCard.grandTotal,
                    invoiceId: jobCard.invoiceId
                  }));
    return rowsToCsv(rows);
  }

  async listEnquiries(filter: { query?: string; status?: EnquiryStatus | "open" | "followups" } = {}) {
    const rows = await this.list<Enquiry>("enquiries", { includeInactive: true });
    const q = String(filter.query || "").trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !searchBlob(row).includes(q)) return false;
      if (!filter.status) return true;
      if (filter.status === "open") return !["converted", "lost"].includes(row.status);
      if (filter.status === "followups") return row.followUpDate;
      return row.status === filter.status;
    });
  }

  saveEnquiry(input: EnquiryInput) {
    return this.save<Enquiry>("enquiries", { id: input.id || randomUUID(), ...input, createdAt: nowIso(), updatedAt: nowIso() });
  }

  listEnquiryFollowups(enquiryId: string) {
    return this.list<EnquiryFollowup>("enquiry_followups", { includeInactive: true }).then((rows) => rows.filter((row) => row.enquiryId === enquiryId));
  }

  async addEnquiryFollowup(input: EnquiryFollowupInput) {
    await this.save<EnquiryFollowup>("enquiry_followups", { id: randomUUID(), ...input, createdAt: nowIso() });
    return this.patch<Enquiry>("enquiries", input.enquiryId, { status: input.status, followUpDate: input.nextFollowUpDate, updatedAt: nowIso() });
  }

  async convertEnquiryToCustomer(enquiryId: string) {
    const enquiries = await this.list<Enquiry>("enquiries", { includeInactive: true });
    const enquiry = enquiries.find((row) => row.id === enquiryId);
    if (!enquiry) throw new Error("Enquiry not found.");
    const customer = await this.saveCustomer({ name: enquiry.customerName, phone: enquiry.phone, email: enquiry.email, address: enquiry.address });
    const vehicle = await this.saveVehicle({
      customerId: customer.id,
      vehicleType: enquiry.vehicleType,
      registrationNumber: enquiry.vehicleNumber || "NEW",
      make: enquiry.vehicleMake,
      model: enquiry.vehicleModel,
      color: enquiry.vehicleColor
    });
    const updated = await this.patch<Enquiry>("enquiries", enquiry.id, { status: "converted", customerId: customer.id, vehicleId: vehicle.id, convertedAt: nowIso(), updatedAt: nowIso() });
    return { enquiry: updated, customer, vehicle };
  }

  async enquiryDashboard() {
    const enquiries = await this.listEnquiries();
    const today = localDate();
    const open = enquiries.filter((row) => !["converted", "lost"].includes(row.status));
    return {
      todayFollowups: open.filter((row) => row.followUpDate === today).length,
      overdueFollowups: open.filter((row) => row.followUpDate && row.followUpDate < today).length,
      newEnquiries: enquiries.filter((row) => row.status === "new").length,
      convertedEnquiries: enquiries.filter((row) => row.status === "converted").length,
      dueToday: open.filter((row) => row.followUpDate === today),
      overdue: open.filter((row) => row.followUpDate && row.followUpDate < today),
      recentOpen: open.slice(0, 8)
    };
  }

  private async uploadCloudFile(filePath: string, entity: string, entityId: string, fileType: "PHOTO" | "LOGO" | "SIGNATURE" | "WATERMARK" | "DOCUMENT" = "PHOTO") {
    const { resolved } = fileType === "DOCUMENT" ? validatePurchaseDocumentSource(filePath) : validateJobCardPhotoSource(filePath);
    const bytes = fs.readFileSync(resolved);
    const digest = createHash("sha256").update(bytes).digest("hex");
    return this.cloud.cloudRequest<{ fileId: string; sha256: string; sizeBytes: number; originalName?: string; mimeType?: string }>("/api/v1/files", {
      method: "POST",
      body: {
        entity,
        entityId,
        fileType,
        originalName: path.basename(resolved),
        mimeType: fileMime(resolved),
        sha256: digest,
        dataBase64: bytes.toString("base64")
      }
    });
  }

  private copyPurchaseDocumentToLocalStore(recordId: string, fileId: string, filePath: string) {
    if (!this.purchaseDocumentRoot) return "";
    const extension = path.extname(filePath).toLowerCase();
    const directory = path.join(this.purchaseDocumentRoot, safePathSegment(recordId));
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${safePathSegment(fileId)}${extension}`);
    fs.copyFileSync(filePath, target);
    return target;
  }

  private localPurchaseDocumentDataUrl(localPath: string) {
    if (!this.purchaseDocumentRoot || !localPath) return "";
    const root = path.resolve(this.purchaseDocumentRoot);
    const resolved = path.resolve(localPath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return "";
    if (!fs.existsSync(resolved)) return "";
    const data = fs.readFileSync(resolved).toString("base64");
    return `data:${fileMime(resolved)};base64,${data}`;
  }

  async uploadInvoiceAsset(filePath: string, kind: "logo" | "signature" | "watermark") {
    const fileType = kind === "logo" ? "LOGO" : kind === "signature" ? "SIGNATURE" : "WATERMARK";
    const uploaded = await this.uploadCloudFile(filePath, "settings", `invoice-${kind}`, fileType);
    return `cloud:${uploaded.fileId}`;
  }

  private photoFileId(photo: JobCardPhoto) {
    const raw = (photo as JobCardPhoto & { fileId?: string }).fileId || "";
    if (raw) return raw;
    const pathValue = String(photo.path || "");
    return pathValue.startsWith("cloud:") ? pathValue.slice("cloud:".length) : "";
  }

  private async hydrateJobCardPhotos(photos: JobCardPhoto[]): Promise<JobCardPhoto[]> {
    return Promise.all(photos.map(async (photo) => {
      const fileId = this.photoFileId(photo);
      if (!fileId || photo.url) return photo;
      try {
        return { ...photo, url: await this.cloud.cloudBinaryDataUrl(`/api/v1/files/${encodeURIComponent(fileId)}`) };
      } catch {
        return { ...photo, url: "" };
      }
    }));
  }

  async listJobCards(filter: { query?: string; status?: JobCardStatus | "today" | "open" | "approval" | "progress" | "ready" | "closed" } = {}) {
    const rows = await this.list<JobCardDetail>("job_cards", { includeInactive: true });
    const q = String(filter.query || "").trim().toLowerCase();
    return rows.filter((row) => !q || searchBlob(row).includes(q));
  }

  async getJobCard(id: string): Promise<JobCardDetail> {
    const [jobs, customers, vehicles, items, checklist, photos, history, invoices] = await Promise.all([
      this.list<JobCardDetail>("job_cards", { includeInactive: true }),
      this.list<Customer>("customers"),
      this.list<Vehicle>("vehicles"),
      this.list<JobCardItem>("job_card_items", { includeInactive: true }),
      this.list<JobCardChecklistItem>("job_card_checklist_items", { includeInactive: true }),
      this.list<JobCardPhoto>("job_card_photos", { includeInactive: true }),
      this.list<JobCardStatusHistory>("job_card_status_history", { includeInactive: true }),
      this.listInvoices("")
    ]);
    const job = jobs.find((row) => row.id === id);
    if (!job) throw new Error("Job card not found.");
    const jobPhotos = await this.hydrateJobCardPhotos(photos.filter((row) => row.jobCardId === id));
    return {
      ...job,
      customer: customers.find((row) => row.id === job.customerId) || ({ id: job.customerId, name: job.customerName } as Customer),
      vehicle: vehicles.find((row) => row.id === job.vehicleId) || ({ id: job.vehicleId, customerId: job.customerId, registrationNumber: job.vehicleNumber, vehicleType: job.vehicleType } as Vehicle),
      items: items.filter((row) => row.jobCardId === id),
      checklist: checklist.filter((row) => row.jobCardId === id),
      photos: jobPhotos,
      history: history.filter((row) => row.jobCardId === id),
      invoice: job.invoiceId ? invoices.find((row) => row.id === job.invoiceId) : undefined
    };
  }

  async addJobCardPhotos(jobCardId: string, type: JobCardPhotoType, filePaths: string[]): Promise<JobCardPhoto[]> {
    await this.getJobCard(jobCardId);
    const photos: JobCardPhoto[] = [];
    for (const filePath of filePaths) {
      const photoId = randomUUID();
      const uploaded = await this.uploadCloudFile(filePath, "job_card_photos", photoId, "PHOTO");
      const photo = await this.save<JobCardPhoto>("job_card_photos", {
        id: photoId,
        jobCardId,
        type,
        path: `cloud:${uploaded.fileId}`,
        fileId: uploaded.fileId,
        caption: "",
        createdAt: nowIso()
      } as Partial<JobCardPhoto> & { id: string; fileId: string });
      photos.push(photo);
    }
    return this.hydrateJobCardPhotos(photos);
  }

  removeJobCardPhoto(photoId: string) {
    return this.remove("job_card_photos", photoId);
  }

  updateJobCardPhotoCaption(photoId: string, caption: string) {
    return this.patch<JobCardPhoto>("job_card_photos", photoId, { caption: caption.trim() }).then((photo) =>
      this.hydrateJobCardPhotos([photo]).then((rows) => rows[0])
    );
  }

  async jobCardDashboard(): Promise<JobCardDashboardData> {
    const rows = await this.listJobCards();
    const today = localDate();
    const open = rows.filter((row) => !["delivered", "billed", "cancelled"].includes(row.status));
    return {
      todayJobs: rows.filter((row) => row.jobDate === today).length,
      openJobs: open.length,
      approvalPending: rows.filter((row) => row.status === "estimate_pending").length,
      inProgress: rows.filter((row) => ["approved", "in_progress", "quality_check"].includes(row.status)).length,
      readyDelivery: rows.filter((row) => row.status === "ready_delivery").length,
      completedToday: rows.filter((row) => row.actualDeliveryDate === today && ["delivered", "billed"].includes(row.status)).length,
      recentOpen: open.slice(0, 8)
    };
  }

  async saveJobCard(input: JobCardInput): Promise<JobCardDetail> {
    const totals = calculateInvoiceTotals("gst", "intra", input.items, input.discount);
    const customer = await this.saveCustomer({ id: input.customerId || input.customer.id, ...input.customer });
    const vehicle = await this.saveVehicle({ id: input.vehicleId || input.vehicle.id, customerId: customer.id, ...input.vehicle });
    const jobCardId = input.id || randomUUID();
    const job = await this.save<JobCardDetail>("job_cards", {
      id: jobCardId,
      jobNumber: "",
      status: input.status || "draft",
      jobDate: input.jobDate || localDate(),
      expectedDeliveryDate: input.expectedDeliveryDate || "",
      expectedDeliveryTime: input.expectedDeliveryTime || "",
      actualDeliveryDate: input.actualDeliveryDate || "",
      actualDeliveryTime: input.actualDeliveryTime || "",
      customerId: customer.id,
      vehicleId: vehicle.id,
      invoiceId: "",
      customerName: customer.name,
      customerPhone: customer.phone,
      vehicleType: vehicle.vehicleType,
      vehicleNumber: vehicle.registrationNumber,
      odometer: input.odometer || "",
      fuelLevel: input.fuelLevel || "",
      keyReceived: Boolean(input.keyReceived),
      belongingsNote: input.belongingsNote || "",
      approvalName: input.approvalName || "",
      approvalDate: input.approvalDate || "",
      approvalNotes: input.approvalNotes || "",
      workNotes: input.workNotes || "",
      internalNotes: input.internalNotes || "",
      deliveryNotes: input.deliveryNotes || "",
      subTotal: totals.subTotal,
      discount: totals.discount,
      taxableValue: totals.taxableValue,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const oldItems = (await this.list<JobCardItem>("job_card_items", { includeInactive: true })).filter((row) => row.jobCardId === jobCardId);
    await Promise.all(oldItems.map((row) => this.remove("job_card_items", row.id)));
    for (const item of totals.items) {
      await this.save<JobCardItem>("job_card_items", { id: randomUUID(), jobCardId, ...item });
    }
    const existingChecklist = (await this.list<JobCardChecklistItem>("job_card_checklist_items", { includeInactive: true })).filter((row) => row.jobCardId === jobCardId);
    if (!existingChecklist.length) {
      const settings = await this.getJobCardSettings();
      const defaultChecklist = settings.defaultChecklist.length
        ? settings.defaultChecklist
        : ["Vehicle condition checked", "Customer belongings noted", "Service work completed", "Quality checked"];
      for (const [index, label] of defaultChecklist.entries()) {
        await this.save<JobCardChecklistItem>("job_card_checklist_items", {
          id: randomUUID(),
          jobCardId,
          label,
          checked: false,
          sortOrder: index + 1,
          createdAt: nowIso()
        });
      }
    }
    return this.getJobCard(job.id);
  }

  async updateJobCardStatus(input: { jobCardId: string; status: JobCardStatus; note?: string }) {
    await this.patch<JobCardDetail>("job_cards", input.jobCardId, { status: input.status, updatedAt: nowIso() });
    await this.save<JobCardStatusHistory>("job_card_status_history", {
      id: randomUUID(),
      jobCardId: input.jobCardId,
      status: input.status,
      note: input.note || "",
      createdAt: nowIso()
    });
    return this.getJobCard(input.jobCardId);
  }

  async saveJobCardChecklist(jobCardId: string, rows: Array<{ id: string; checked: boolean }>) {
    const current = (await this.list<JobCardChecklistItem>("job_card_checklist_items", { includeInactive: true })).filter((row) => row.jobCardId === jobCardId);
    for (const row of rows) {
      const existing = current.find((item) => item.id === row.id);
      if (existing) await this.patch<JobCardChecklistItem>("job_card_checklist_items", row.id, { checked: row.checked });
    }
    return this.getJobCard(jobCardId);
  }

  async convertJobCardToInvoice(jobCardId: string) {
    const response = await this.cloud.cloudRequest<{ invoice: InvoiceDetail }>(`/api/v1/job-cards/${encodeURIComponent(jobCardId)}/convert-to-invoice`, {
      method: "POST"
    });
    const invoice = response.invoice;
    this.invalidate();
    return invoice;
  }

  getJobCardSettings() {
    return this.list<{ id?: string; defaultChecklist: string[] }>("settings").then((rows) =>
      rows.find((row) => row.id === JOB_CARD_SETTINGS_SYNC_ID) || { defaultChecklist: [] }
    );
  }

  saveJobCardSettings(input: { defaultChecklist: string[] }) {
    return this.save<{ id: string; defaultChecklist: string[] }>("settings", { id: JOB_CARD_SETTINGS_SYNC_ID, defaultChecklist: input.defaultChecklist });
  }
}
