import { useEffect, useState } from "react";
import { Building2, ClipboardList, Cloud, Download, FileText, MessageCircle, Paperclip, Plug, RefreshCw, Save, Shield, UploadCloud, type LucideIcon } from "lucide-react";
import type {
  AccessRole,
  AppUser,
  BackupScheduleStatus,
  BusinessSettings,
  CloudBackupRecord,
  CloudDeviceSummary,
  DriveConnectionStatus,
  CustomerWithVehicles,
  InvoiceDensity,
  InvoiceDetail,
  InvoiceFontStyle,
  InvoiceLogoSize,
  InvoicePaperSize,
  InvoiceSummary,
  InvoiceTextSize,
  InvoiceWatermarkPlacement,
  PermissionKey,
  SaveAccessRoleInput,
  SaveWhatsAppTemplateDraftInput,
  SaveUserInput,
  SyncConflictResolution,
  SyncConflictSummary,
  SyncDeviceStatus,
  TaxScope,
  WhatsAppBusinessStatus,
  WhatsAppProvider,
  WhatsAppProviderConfig,
  WhatsAppTemplateDraft,
  WhatsAppTemplateHeaderType,
  WhatsAppTemplateManagerData,
  WhatsAppTemplateUseCase,
  WhatsAppUnsentDraft
} from "../../../shared/types";
import { OWNER_ACCESS_ROLE_ID, PERMISSION_GROUPS, STAFF_OPERATIONS_ROLE_ID, hasAnyPermission, hasPermission } from "../../../shared/access-control";
import { DEFAULT_SAC_CODE } from "../../../shared/billing-math";
import { InvoicePreview } from "../billing/InvoicePreview";

type InvoiceAssetKind = "logo" | "signature" | "watermark";
type SettingsTab = "business" | "invoice" | "jobCards" | "whatsapp" | "security" | "backup" | "cloudSync" | "exports";
type InvoiceEditorTab = "brand" | "layout" | "fields" | "payment" | "text" | "preview";
type SettingsTabItem = {
  id: SettingsTab;
  label: string;
  description: string;
  icon: LucideIcon;
  permissions: PermissionKey[];
};

const settingsTabs: SettingsTabItem[] = [
  { id: "business", label: "Business", description: "Company, GST and numbering", icon: Building2, permissions: ["settings.manage"] },
  { id: "invoice", label: "Invoice", description: "Template and payment display", icon: FileText, permissions: ["settings.manage"] },
  { id: "jobCards", label: "Job Cards", description: "Default checklist", icon: ClipboardList, permissions: ["jobCards.settings"] },
  { id: "whatsapp", label: "WhatsApp", description: "Business API provider", icon: MessageCircle, permissions: ["settings.manage"] },
  { id: "security", label: "Users & Roles", description: "Accounts and access control", icon: Shield, permissions: ["users.manage"] },
  { id: "backup", label: "Backup", description: "Local and Google Drive", icon: Cloud, permissions: ["backup.manage"] },
  { id: "cloudSync", label: "Cloud Status", description: "Online business data connection", icon: UploadCloud, permissions: ["backup.manage"] },
  { id: "exports", label: "Exports", description: "CSV data downloads", icon: Download, permissions: ["exports.csv"] }
];

const invoicePaperSizes: InvoicePaperSize[] = ["A4", "Letter", "Legal"];
const invoiceEditorTabs: { id: InvoiceEditorTab; label: string }[] = [
  { id: "brand", label: "Brand" },
  { id: "layout", label: "Layout" },
  { id: "fields", label: "Fields" },
  { id: "payment", label: "Payment" },
  { id: "text", label: "Text" },
  { id: "preview", label: "Preview" }
];
const invoiceFontStyles: { value: InvoiceFontStyle; label: string }[] = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "system", label: "System" }
];
const invoiceTextSizes: { value: InvoiceTextSize; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" }
];
const invoiceDensities: { value: InvoiceDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "comfortable", label: "Comfortable" }
];
const invoiceLogoSizes: { value: InvoiceLogoSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" }
];

const visibleCloudDevices = (devices: CloudDeviceSummary[]) =>
  devices.filter((device) => device.approvalStatus !== "REVOKED" && !device.isRevoked);
const invoiceWatermarkPlacements: { value: InvoiceWatermarkPlacement; label: string }[] = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "center", label: "Center" },
  { value: "top-right", label: "Top right" }
];

const emptyDriveStatus: DriveConnectionStatus = {
  configured: false,
  connected: false,
  clientId: "",
  accountEmail: "",
  folderName: "Autocare24 Backups",
  folderId: "",
  lastUploadAt: "",
  lastUploadName: "",
  lastUploadSizeBytes: 0,
  backupCount: 0,
  lastError: ""
};

const emptyBackupScheduleStatus: BackupScheduleStatus = {
  scheduledTime: "7:00 PM",
  nextRunAt: "",
  lastLocalBackupAt: "",
  lastLocalBackupPath: "",
  lastDriveUploadAt: "",
  lastDriveUploadName: "",
  lastCloudSnapshot: {
    included: false,
    exportedAt: "",
    entityCount: 0,
    recordCount: 0,
    invoiceCount: 0,
    error: ""
  },
  lastError: ""
};

const emptySyncStatus: SyncDeviceStatus = {
  configured: false,
  connected: false,
  state: "disconnected",
  approvalStatus: "",
  cloudUrl: "",
  deviceId: "",
  deviceName: "",
  deviceCode: "",
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastRevision: 0,
  lastPushAt: "",
  lastPullAt: "",
  lastError: ""
};

const emptyWhatsAppConfig: WhatsAppProviderConfig = {
  enabled: false,
  provider: "ycloud",
  graphBaseUrl: "https://graph.facebook.com",
  graphVersion: "v20.0",
  accessToken: "",
  phoneNumberId: "",
  businessAccountId: "",
  webhookVerifyToken: "",
  appSecret: "",
  displayPhoneNumber: "",
  ycloudApiBaseUrl: "https://api.ycloud.com",
  ycloudApiKey: "",
  ycloudFromPhone: "",
  ycloudWabaId: "",
  ycloudWebhookSecret: ""
};

type WhatsAppDraftForm = SaveWhatsAppTemplateDraftInput & {
  buttonsText: string;
};

const whatsappTemplateUseCases: Array<{ id: WhatsAppTemplateUseCase; label: string; pdf?: boolean; help?: string }> = [
  { id: "invoice", label: "Invoice message", help: "Text-only invoice notification. No PDF is attached." },
  { id: "invoice_pdf", label: "Invoice PDF attachment", pdf: true, help: "Sends the generated invoice PDF with the message." },
  { id: "due_reminder", label: "Payment reminder" },
  { id: "quotation", label: "Quotation" },
  { id: "job_card_status", label: "Job-card update", help: "Text-only service status update." },
  { id: "job_card_pdf", label: "Job-card PDF attachment", pdf: true, help: "Sends the generated job-card PDF with the message." },
  { id: "customer_chat", label: "Customer chat" },
  { id: "custom", label: "Custom" }
];

const whatsAppPdfUseCases = new Set<WhatsAppTemplateUseCase>(["invoice_pdf", "job_card_pdf"]);

const whatsappReadyTemplatePresets: Record<Exclude<WhatsAppTemplateUseCase, "custom">, Omit<WhatsAppDraftForm, "buttonsText">> = {
  invoice: {
    useCase: "invoice",
    templateName: "invoice_ready",
    languageCode: "en",
    category: "UTILITY",
    headerType: "none",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, your invoice {{invoice_number}} from {{business_name}} is ready for review.",
      "The total invoice amount is {{amount}} and the current balance due is {{due_amount}}.",
      "Vehicle reference: {{vehicle_number}}.",
      "Please check the invoice details and contact our team if any correction is needed before payment or delivery."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  invoice_pdf: {
    useCase: "invoice_pdf",
    templateName: "invoice_pdf_ready",
    languageCode: "en",
    category: "UTILITY",
    headerType: "document",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, your invoice PDF for invoice {{invoice_number}} from {{business_name}} is attached.",
      "The invoice total is {{amount}} and the current balance due is {{due_amount}} for vehicle {{vehicle_number}}.",
      "Please review the document and keep it for your service and payment records."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  due_reminder: {
    useCase: "due_reminder",
    templateName: "payment_reminder",
    languageCode: "en",
    category: "UTILITY",
    headerType: "none",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, this is a payment reminder from {{business_name}} for invoice {{invoice_number}}.",
      "The pending amount is {{due_amount}} from the total invoice amount {{amount}}.",
      "Please complete the payment when convenient or contact our team if you need any clarification."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  quotation: {
    useCase: "quotation",
    templateName: "quotation_ready",
    languageCode: "en",
    category: "UTILITY",
    headerType: "none",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, your quotation {{quotation_number}} from {{business_name}} is ready for review.",
      "The estimated amount is {{amount}} for vehicle {{vehicle_number}}.",
      "Please check the details and confirm approval so our team can plan the work."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  job_card_status: {
    useCase: "job_card_status",
    templateName: "job_card_update",
    languageCode: "en",
    category: "UTILITY",
    headerType: "none",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, here is an update from {{business_name}} for job card {{job_number}}.",
      "Vehicle reference: {{vehicle_number}}.",
      "Current status: {{status}}.",
      "Expected delivery: {{delivery_time}}.",
      "Please contact our team if you need any change or clarification."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  job_card_pdf: {
    useCase: "job_card_pdf",
    templateName: "job_card_pdf_ready",
    languageCode: "en",
    category: "UTILITY",
    headerType: "document",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, your job card document from {{business_name}} for job card {{job_number}} is attached.",
      "Vehicle reference: {{vehicle_number}}.",
      "The estimated amount is {{amount}} and the expected delivery time is {{delivery_time}}.",
      "Please review the document for service details."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  },
  customer_chat: {
    useCase: "customer_chat",
    templateName: "customer_chat",
    languageCode: "en",
    category: "UTILITY",
    headerType: "none",
    headerText: "",
    bodyText: [
      "Hi {{customer_name}}, this is {{business_name}} from customer support.",
      "We are contacting you with an update: {{message}}",
      "Please reply here if you need help."
    ].join("\n"),
    footerText: "Autocare24",
    buttons: [],
    variableTokens: [],
    replacementOfName: ""
  }
};

const emptyWhatsAppTemplateManager: WhatsAppTemplateManagerData = {
  variables: [],
  drafts: [],
  mappings: [],
  templates: [],
  submissionHistory: [],
  mappingHistory: [],
  syncEvents: []
};

const emptyWhatsAppDraftForm = (): WhatsAppDraftForm => ({
  ...whatsappReadyTemplatePresets.invoice,
  buttonsText: ""
});

const whatsappUseCaseLabel = (useCase: WhatsAppTemplateUseCase | string) =>
  whatsappTemplateUseCases.find((item) => item.id === useCase)?.label || statusLabel(String(useCase || ""));
const whatsappUseCaseHelp = (useCase: WhatsAppTemplateUseCase | string) =>
  whatsappTemplateUseCases.find((item) => item.id === useCase)?.help || "";
const whatsappReadyTemplateForUseCase = (useCase: WhatsAppTemplateUseCase): WhatsAppDraftForm => {
  if (useCase === "custom") {
    return {
      useCase: "custom",
      templateName: "custom_message",
      languageCode: "en",
      category: "UTILITY",
      headerType: "none",
      headerText: "",
      bodyText: [
        "Hi {{customer_name}}, this is {{business_name}}.",
        "We are contacting you with an update: {{message}}",
        "Please reply here if you need help."
      ].join("\n"),
      footerText: "Autocare24",
      buttons: [],
      variableTokens: [],
      replacementOfName: "",
      buttonsText: ""
    };
  }
  return { ...whatsappReadyTemplatePresets[useCase], buttonsText: "" };
};
const normalizeWhatsAppDraftHeaderTypeForUseCase = (
  useCase: WhatsAppTemplateUseCase,
  headerType: WhatsAppTemplateHeaderType
): WhatsAppTemplateHeaderType => {
  if (whatsAppPdfUseCases.has(useCase)) return "document";
  if (useCase !== "custom" && headerType === "document") return "none";
  return headerType;
};
const whatsappTemplateVariableSlotCount = (text: string) => (text.match(/{{\s*[^{}\s]+\s*}}/g) || []).length;
const whatsappTemplateStaticWordCount = (text: string) => {
  const words = text.replace(/{{\s*[^{}\s]+\s*}}/g, " ").match(/[A-Za-z0-9][A-Za-z0-9'/-]*/g);
  return words ? words.length : 0;
};

const secretPlaceholder = (saved?: boolean, label = "secret") => saved ? `Saved - leave blank to keep current ${label}` : "";

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const conflictEntityLabels: Partial<Record<SyncConflictSummary["entity"], string>> = {
  invoice_drafts: "Invoice draft",
  invoices: "Invoice",
  invoice_items: "Invoice item",
  payments: "Payment",
  quotations: "Quotation",
  quotation_items: "Quotation item",
  customers: "Customer",
  vehicles: "Vehicle",
  job_cards: "Job card",
  job_card_photos: "Job card photo",
  inventory_items: "Stock item",
  inventory_batches: "Stock purchase",
  inventory_movements: "Stock movement",
  services: "Service",
  expenses: "Expense",
  settings: "Settings",
  users: "User",
  access_roles: "Role"
};

const conflictFieldLabels: Record<string, string> = {
  draftName: "Draft name",
  draftType: "Draft type",
  name: "Name",
  invoiceNumber: "Invoice number",
  quotationNumber: "Quotation number",
  jobNumber: "Job card number",
  invoiceStatus: "Invoice status",
  quotationStatus: "Quotation status",
  status: "Status",
  paymentStatus: "Payment status",
  customerName: "Customer",
  customerPhone: "Customer phone",
  phone: "Phone",
  registrationNumber: "Vehicle number",
  vehicleNumber: "Vehicle number",
  invoiceDate: "Invoice date",
  quotationDate: "Quotation date",
  jobDate: "Job date",
  itemCount: "No. of items",
  items: "Items",
  invoiceMode: "Bill type",
  taxScope: "Tax type",
  totalAmount: "Total",
  grandTotal: "Total amount",
  paidAmount: "Paid amount",
  balanceDue: "Balance due",
  quantity: "Quantity",
  quantityRemaining: "Stock left",
  currentQuantity: "Stock left",
  notes: "Notes",
  updatedAt: "Last edited",
  createdAt: "Created"
};

const hiddenConflictKeys = new Set([
  "id",
  "localId",
  "cloudRevision",
  "cloudSyncedAt",
  "cloudConflictId",
  "cloudSyncStatus",
  "payloadJson",
  "sourceInvoiceId",
  "sourceQuotationId",
  "selectedCustomerId",
  "selectedVehicleId"
]);

const conflictEntityLabel = (entity: SyncConflictSummary["entity"]) => conflictEntityLabels[entity] || statusLabel(entity);

const parseConflictObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const conflictObjectField = (value: unknown, field: string) => parseConflictObject(value)[field];

const describeConflictItems = (value: unknown) => {
  if (!Array.isArray(value)) return "";
  const descriptions = value
    .map((item) => conflictObjectField(item, "description"))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!descriptions.length) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  const shown = descriptions.slice(0, 3).join(", ");
  return descriptions.length > 3 ? `${shown} +${descriptions.length - 3} more` : shown;
};

const conflictComparableData = (version: Record<string, unknown>, entity: SyncConflictSummary["entity"]) => {
  const payload = parseConflictObject(version.payloadJson || version.payload);
  const customer = parseConflictObject(payload.customer || version.customer);
  const vehicle = parseConflictObject(payload.vehicle || version.vehicle);
  const data: Record<string, unknown> = { ...version };

  if (entity === "invoice_drafts") {
    data.draftName = version.name;
    data.draftType = version.correctionType || payload.correctionType;
    data.customerName = customer.name || version.customerName;
    data.customerPhone = customer.phone || version.customerPhone || version.phone;
    data.vehicleNumber = vehicle.registrationNumber || version.vehicleNumber;
    data.invoiceDate = payload.invoiceDate;
    data.invoiceMode = payload.invoiceMode;
    data.taxScope = payload.taxScope;
    data.itemCount = Array.isArray(payload.items) ? payload.items.length : "";
    data.items = describeConflictItems(payload.items);
    data.discount = payload.discount;
    data.paidAmount = payload.paidAmount;
    data.paymentMode = payload.paymentMode;
    data.notes = payload.notes;
    return data;
  }

  if (payload && Object.keys(payload).length) {
    data.customerName = customer.name || version.customerName;
    data.customerPhone = customer.phone || version.customerPhone || version.phone;
    data.vehicleNumber = vehicle.registrationNumber || version.vehicleNumber;
    data.invoiceDate = payload.invoiceDate || version.invoiceDate;
    data.quotationDate = payload.quotationDate || version.quotationDate;
    data.jobDate = payload.jobDate || version.jobDate;
    data.itemCount = Array.isArray(payload.items) ? payload.items.length : version.itemCount;
    data.items = describeConflictItems(payload.items) || version.items;
    data.notes = payload.notes || version.notes;
  }

  return data;
};

const conflictValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "Blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Blank";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "Details changed";
  const text = String(value);
  const date = new Date(text);
  if (/^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(date.getTime())) return date.toLocaleString();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

const conflictTitle = (conflict: SyncConflictSummary) => {
  const data = {
    ...conflictComparableData(conflict.serverVersion, conflict.entity),
    ...conflictComparableData(conflict.localVersion, conflict.entity)
  };
  const title =
    data.invoiceNumber ||
    data.quotationNumber ||
    data.jobNumber ||
    data.name ||
    data.customerName ||
    data.registrationNumber ||
    data.vehicleNumber ||
    data.description ||
    data.draftName;
  return title ? `${conflictEntityLabel(conflict.entity)} - ${conflictValue(title)}` : conflictEntityLabel(conflict.entity);
};

const conflictDiffs = (conflict: SyncConflictSummary) => {
  const localData = conflictComparableData(conflict.localVersion, conflict.entity);
  const cloudData = conflictComparableData(conflict.serverVersion, conflict.entity);
  const keys = Array.from(new Set([...Object.keys(localData), ...Object.keys(cloudData)]))
    .filter((key) => !hiddenConflictKeys.has(key))
    .filter((key) => JSON.stringify(localData[key] ?? "") !== JSON.stringify(cloudData[key] ?? ""));
  return keys.slice(0, 8).map((key) => ({
    key,
    label: conflictFieldLabels[key] || statusLabel(key),
    local: conflictValue(localData[key]),
    cloud: conflictValue(cloudData[key])
  }));
};

const conflictIssueTitle = (conflict: SyncConflictSummary) => {
  const diffs = conflictDiffs(conflict);
  if (conflict.entity.includes("inventory") || diffs.some((diff) => /stock|quantity/i.test(diff.label))) return "Stock needs checking";
  if (conflict.entity === "invoice_drafts") return "Invoice draft changed in two places";
  if (conflict.entity === "invoices") return "Invoice changed in two places";
  if (conflict.entity === "quotations") return "Quotation changed in two places";
  return "Same record changed on more than one PC";
};

const conflictSummaryText = (conflict: SyncConflictSummary) => {
  const diffs = conflictDiffs(conflict);
  if (conflict.entity.includes("inventory") || diffs.some((diff) => /stock|quantity/i.test(diff.label))) {
    return "This PC changed stock, but the cloud already has a newer stock change. Check the quantity before choosing.";
  }
  if (!diffs.length) {
    return "This PC tried to sync the record, but the cloud already has a newer copy. No clear business field difference is visible.";
  }
  return `Changed fields: ${diffs.map((diff) => diff.label).join(", ")}.`;
};

const conflictRecommendation = (conflict: SyncConflictSummary) => {
  const localUpdated = Date.parse(String(conflict.localVersion.updatedAt || conflict.localVersion.createdAt || ""));
  const cloudUpdated = Date.parse(String(conflict.serverVersion.updatedAt || conflict.serverVersion.createdAt || ""));
  if (Number.isFinite(localUpdated) && Number.isFinite(cloudUpdated) && localUpdated > cloudUpdated) {
    return "Suggested: Keep local if this PC has the correct latest work.";
  }
  return "Suggested: Keep cloud when unsure. It keeps the version already accepted by the server.";
};

const groupConflicts = (conflicts: SyncConflictSummary[]) => {
  const groups = new Map<string, { conflict: SyncConflictSummary; conflicts: SyncConflictSummary[]; count: number }>();
  conflicts.forEach((conflict) => {
    const key = `${conflict.entity}:${conflict.localId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { conflict, conflicts: [conflict], count: 1 });
      return;
    }
    existing.conflicts.push(conflict);
    existing.count += 1;
    if (new Date(conflict.detectedAt).getTime() > new Date(existing.conflict.detectedAt).getTime()) {
      existing.conflict = conflict;
    }
  });
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.conflict.detectedAt).getTime() - new Date(a.conflict.detectedAt).getTime()
  );
};

const formatDateTime = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatBytes = (value: number) => {
  if (!value) return "-";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const fileNameFromPath = (filePath: string) => filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;

const sampleInvoice: InvoiceDetail = {
  id: "preview",
  invoiceNumber: "AUTOCARE24-00004",
  invoiceStatus: "finalized",
  cloudSyncStatus: "local_only",
  cloudRevision: 0,
  cloudSyncedAt: "",
  cloudConflictId: "",
  invoiceMode: "gst",
  taxScope: "intra",
  invoiceDate: todayLocal(),
  customerId: "preview-customer",
  vehicleId: "preview-vehicle",
  jobCardId: "",
  vehicleType: "car",
  customerCode: "CUS-00001",
  customerName: "Kishore",
  customerPhone: "9876543210",
  vehicleNumber: "TN54YY67N",
  subTotal: 6895,
  discount: 0,
  taxableValue: 6895,
  cgst: 620.55,
  sgst: 620.55,
  igst: 0,
  totalTax: 1241.1,
  grandTotal: 8136.1,
  paidAmount: 0,
  balanceDue: 8136.1,
  paymentStatus: "unpaid",
  paymentMode: "Cash",
  paymentReference: "",
  notes: "Created from job card JC-00001.",
  cancelledAt: "",
  cancelledByUserId: "",
  cancelReason: "",
  replacementInvoiceId: "",
  sourceInvoiceId: "",
  sourceQuotationId: "",
  createdAt: todayLocal(),
  customer: {
    id: "preview-customer",
    customerCode: "CUS-00001",
    name: "Kishore",
    phone: "9876543210",
    email: "",
    gstin: "",
    address: "31/A, Thumbal Main Road, Chennai, Tamil Nadu - 600045",
    createdAt: todayLocal()
  },
  vehicle: {
    id: "preview-vehicle",
    customerId: "preview-customer",
    vehicleType: "car",
    registrationNumber: "TN54YY67N",
    make: "Hyundai",
    model: "i20 Asta",
    color: "White",
    createdAt: todayLocal()
  },
  items: [
    { id: "preview-item-1", invoiceId: "preview", serviceId: "", inventoryItemId: "", description: "Full Vehicle Detailing", quantity: 1, unitPrice: 4999, gstRate: 18, sacCode: DEFAULT_SAC_CODE, lineSubTotal: 4999, lineTax: 899.82, lineTotal: 5898.82 },
    { id: "preview-item-2", invoiceId: "preview", serviceId: "", inventoryItemId: "", description: "Interior Vacuum Cleaning", quantity: 1, unitPrice: 799, gstRate: 18, sacCode: DEFAULT_SAC_CODE, lineSubTotal: 799, lineTax: 143.82, lineTotal: 942.82 },
    { id: "preview-item-3", invoiceId: "preview", serviceId: "", inventoryItemId: "", description: "Dashboard Polishing", quantity: 1, unitPrice: 499, gstRate: 18, sacCode: DEFAULT_SAC_CODE, lineSubTotal: 499, lineTax: 89.82, lineTotal: 588.82 },
    { id: "preview-item-4", invoiceId: "preview", serviceId: "", inventoryItemId: "", description: "Tyre & Rim Cleaning", quantity: 1, unitPrice: 399, gstRate: 18, sacCode: DEFAULT_SAC_CODE, lineSubTotal: 399, lineTax: 71.82, lineTotal: 470.82 },
    { id: "preview-item-5", invoiceId: "preview", serviceId: "", inventoryItemId: "", description: "Vehicle Perfume", quantity: 1, unitPrice: 199, gstRate: 18, sacCode: "330749", lineSubTotal: 199, lineTax: 35.82, lineTotal: 234.82 }
  ],
  payments: []
};


export function SettingsPage({
  settings,
  setSettings,
  notify,
  currentUser,
  onLogout,
  onChanged
}: {
  settings: BusinessSettings;
  setSettings: (settings: BusinessSettings) => void;
  notify: (message: string) => void;
  currentUser: AppUser;
  onLogout: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [userForm, setUserForm] = useState<SaveUserInput>({
    displayName: "",
    username: "",
    role: "staff",
    accessRoleId: STAFF_OPERATIONS_ROLE_ID,
    password: "",
    active: true
  });
  const [roleForm, setRoleForm] = useState<SaveAccessRoleInput>({
    name: "",
    description: "",
    permissions: [],
    active: true
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [jobChecklist, setJobChecklist] = useState<string[]>([]);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>(emptyDriveStatus);
  const [backupScheduleStatus, setBackupScheduleStatus] = useState<BackupScheduleStatus>(emptyBackupScheduleStatus);
  const [driveBackups, setDriveBackups] = useState<CloudBackupRecord[]>([]);
  const [selectedDriveBackupId, setSelectedDriveBackupId] = useState("");
  const [driveBusy, setDriveBusy] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncDeviceStatus>(emptySyncStatus);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictSummary[]>([]);
  const [syncForm, setSyncForm] = useState({ cloudUrl: "", deviceName: "", registrationKey: "" });
  const [cloudDeviceCredentials, setCloudDeviceCredentials] = useState({ ownerUsername: "", ownerPassword: "" });
  const [cloudDevices, setCloudDevices] = useState<CloudDeviceSummary[]>([]);
  const [cloudDevicesBusy, setCloudDevicesBusy] = useState("");
  const [syncBusy, setSyncBusy] = useState("");
  const [whatsappConfig, setWhatsAppConfig] = useState<WhatsAppProviderConfig>(emptyWhatsAppConfig);
  const [whatsappStatus, setWhatsAppStatus] = useState<WhatsAppBusinessStatus | null>(null);
  const [whatsappBusy, setWhatsAppBusy] = useState("");
  const [whatsappTemplateData, setWhatsAppTemplateData] = useState<WhatsAppTemplateManagerData>(emptyWhatsAppTemplateManager);
  const [whatsappTemplateBusy, setWhatsAppTemplateBusy] = useState("");
  const [whatsappDraftForm, setWhatsAppDraftForm] = useState<WhatsAppDraftForm>(emptyWhatsAppDraftForm);
  const [selectedWhatsAppDraftId, setSelectedWhatsAppDraftId] = useState("");
  const [previewCustomers, setPreviewCustomers] = useState<CustomerWithVehicles[]>([]);
  const [previewInvoices, setPreviewInvoices] = useState<InvoiceSummary[]>([]);
  const [previewCustomerId, setPreviewCustomerId] = useState("");
  const [previewInvoiceId, setPreviewInvoiceId] = useState("");
  const [whatsappUnsentDrafts, setWhatsAppUnsentDrafts] = useState<WhatsAppUnsentDraft[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>("business");
  const [activeInvoiceTab, setActiveInvoiceTab] = useState<InvoiceEditorTab>("brand");

  useEffect(() => setForm(settings), [settings]);

  const loadUsers = () =>
    window.autocare
      .listUsers()
      .then(setUsers)
      .catch((error) => notify(error.message));

  const loadRoles = () =>
    window.autocare
      .listAccessRoles()
      .then((rows) => {
        setRoles(rows);
        setUserForm((current) => ({
          ...current,
          accessRoleId: current.accessRoleId || rows.find((role) => role.id === STAFF_OPERATIONS_ROLE_ID)?.id || rows.find((role) => role.active && !role.locked)?.id || ""
        }));
      })
      .catch((error) => notify(error.message));

  const refreshDriveStatus = async () => {
    try {
      setDriveStatus(await window.autocare.driveStatus());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load Drive status.");
    }
  };

  const refreshBackupScheduleStatus = async () => {
    try {
      setBackupScheduleStatus(await window.autocare.backupStatus());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load backup status.");
    }
  };

  const refreshSyncStatus = async () => {
    try {
      const status = await window.autocare.syncStatus();
      setSyncStatus(status);
      setSyncForm((current) => ({
        ...current,
        cloudUrl: current.cloudUrl || status.cloudUrl,
        deviceName: current.deviceName || status.deviceName
      }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load sync status.");
    }
  };

  const loadSyncConflicts = async () => {
    try {
      setSyncConflicts(await window.autocare.listSyncConflicts());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load sync conflicts.");
    }
  };

  const refreshWhatsAppConfig = async () => {
    try {
      const result = await window.autocare.getWhatsAppConfig();
      setWhatsAppConfig({ ...emptyWhatsAppConfig, ...result.config });
      setWhatsAppStatus(result.status);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load WhatsApp settings.");
    }
  };

  const loadWhatsAppTemplateManager = async () => {
    try {
      setWhatsAppTemplateBusy("load");
      const data = await window.autocare.getWhatsAppTemplateManager();
      setWhatsAppTemplateData(data);
      return data;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load WhatsApp templates.");
      return null;
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  const loadWhatsAppPreviewData = async () => {
    try {
      const [customers, invoices, unsentDrafts] = await Promise.all([
        window.autocare.listCustomers(),
        window.autocare.listInvoices(""),
        window.autocare.listWhatsAppUnsentDrafts()
      ]);
      setPreviewCustomers(customers);
      setPreviewInvoices(invoices);
      setWhatsAppUnsentDrafts(unsentDrafts);
      setPreviewCustomerId((current) => current || customers[0]?.id || "");
      setPreviewInvoiceId((current) => current || invoices[0]?.id || "");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load WhatsApp preview data.");
    }
  };

  useEffect(() => {
    if (hasPermission(currentUser, "users.manage")) {
      void loadUsers();
      void loadRoles();
    }
    if (hasPermission(currentUser, "jobCards.settings")) {
      window.autocare.getJobCardSettings().then((rows) => setJobChecklist(rows.defaultChecklist)).catch((error) => notify(error.message));
    }
    if (hasPermission(currentUser, "backup.manage")) {
      void refreshDriveStatus();
      void refreshBackupScheduleStatus();
      void refreshSyncStatus();
      void loadSyncConflicts();
    }
    if (hasPermission(currentUser, "settings.manage")) {
      void refreshWhatsAppConfig();
      void loadWhatsAppTemplateManager();
      void loadWhatsAppPreviewData();
    }
    const offSync = window.autocare.onSyncStatus((status) => {
      setSyncStatus(status);
      if (status.conflictCount > 0) void loadSyncConflicts();
    });
    const offBackup = hasPermission(currentUser, "backup.manage")
      ? window.autocare.onBackupScheduleStatus(setBackupScheduleStatus)
      : () => undefined;
    return () => {
      offSync();
      offBackup();
    };
  }, [currentUser.id, currentUser.permissions.join("|")]);

  const visibleTabs = settingsTabs.filter((tab) => hasAnyPermission(currentUser, tab.permissions));
  const groupedSyncConflicts = groupConflicts(syncConflicts);
  const whatsappWebhookUrl = syncStatus.cloudUrl ? `${syncStatus.cloudUrl.replace(/\/+$/, "")}/api/v1/whatsapp/webhook` : "/api/v1/whatsapp/webhook";
  const whatsappProviderLabel = whatsappConfig.provider === "ycloud" ? "YCloud" : "Meta Cloud API";
  const selectedPreviewInvoice = previewInvoices.find((invoice) => invoice.id === previewInvoiceId) || previewInvoices[0];
  const selectedPreviewCustomer = previewCustomers.find((customer) => customer.id === previewCustomerId) || previewCustomers[0];
  const selectedWhatsAppDraft = whatsappTemplateData.drafts.find((draft) => draft.id === selectedWhatsAppDraftId);
  const selectedUseCaseMapping = whatsappTemplateData.mappings.find((mapping) => mapping.useCase === whatsappDraftForm.useCase);
  const selectedUseCaseRequiresDocument = whatsAppPdfUseCases.has(whatsappDraftForm.useCase);
  const selectedHeaderType = normalizeWhatsAppDraftHeaderTypeForUseCase(whatsappDraftForm.useCase, whatsappDraftForm.headerType);
  const selectedHeaderText = selectedHeaderType === "text" ? whatsappDraftForm.headerText || "" : "";
  const bodyCounterOk = whatsappDraftForm.bodyText.length <= 1024;
  const footerCounterOk = (whatsappDraftForm.footerText || "").length <= 60;
  const headerCounterOk = selectedHeaderText.length <= 60;
  const buttonsCounterOk = whatsappDraftForm.buttonsText.split(/\r?\n/).map((row) => row.trim()).filter(Boolean).length <= 10;
  const templateVariableSlots = whatsappTemplateVariableSlotCount(whatsappDraftForm.bodyText);
  const templateStaticWords = whatsappTemplateStaticWordCount(whatsappDraftForm.bodyText);
  const variableDensityOk = templateVariableSlots === 0 || templateStaticWords >= templateVariableSlots * 5;
  const selectedTemplateDraftOk = bodyCounterOk && footerCounterOk && headerCounterOk && buttonsCounterOk && variableDensityOk;
  const approvedTemplateNames = new Set(
    whatsappTemplateData.templates
      .filter((template) => String(template.status || "").toUpperCase() === "APPROVED")
      .map((template) => `${template.name}:${template.languageCode}`)
  );
  const approvedWhatsAppTemplates = whatsappTemplateData.templates.filter((template) =>
    String(template.status || "").toUpperCase() === "APPROVED"
  );
  const moneyPreview = (value: number | undefined) =>
    value === undefined ? "-" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
  const whatsappPreviewTokens: Record<string, string> = {
    customer_name: selectedPreviewInvoice?.customerName || selectedPreviewCustomer?.name || "Customer",
    invoice_number: selectedPreviewInvoice?.invoiceNumber || "INV-1001",
    quotation_number: "QT-1001",
    amount: moneyPreview(selectedPreviewInvoice?.grandTotal ?? 4500),
    due_amount: moneyPreview(selectedPreviewInvoice?.balanceDue ?? 1200),
    vehicle_number: selectedPreviewInvoice?.vehicleNumber || selectedPreviewCustomer?.vehicles?.[0]?.registrationNumber || "TN 01 AB 1234",
    business_name: form.businessName || "Autocare24",
    job_number: "JC-1001",
    delivery_time: "Today 6:00 PM",
    status: "Ready for delivery",
    message: "Please check the details."
  };
  const whatsappPreviewBody = whatsappDraftForm.bodyText.replace(/{{\s*([^{}\s]+)\s*}}/g, (_match, token) =>
    whatsappPreviewTokens[String(token || "").trim()] || `{{${token}}}`
  );

  const applyWhatsAppReadyTemplate = (useCase: WhatsAppTemplateUseCase = whatsappDraftForm.useCase) => {
    const mapping = whatsappTemplateData.mappings.find((item) => item.useCase === useCase);
    const preset = whatsappReadyTemplateForUseCase(useCase);
    setSelectedWhatsAppDraftId("");
    setWhatsAppDraftForm({
      ...preset,
      templateName: mapping?.templateName || preset.templateName,
      languageCode: mapping?.languageCode || preset.languageCode,
      headerType: whatsAppPdfUseCases.has(useCase) ? "document" : preset.headerType,
      headerText: whatsAppPdfUseCases.has(useCase) ? "" : preset.headerText
    });
  };

  const selectWhatsAppUseCaseDraft = (useCase: WhatsAppTemplateUseCase) => {
    const mapping = whatsappTemplateData.mappings.find((item) => item.useCase === useCase);
    const existingDraft = whatsappTemplateData.drafts.find((draft) =>
      draft.useCase === useCase &&
      draft.templateName === (mapping?.templateName || whatsappReadyTemplateForUseCase(useCase).templateName) &&
      draft.languageCode === (mapping?.languageCode || "en")
    ) || whatsappTemplateData.drafts.find((draft) => draft.useCase === useCase);
    if (existingDraft) {
      selectWhatsAppDraft(existingDraft);
      return;
    }
    applyWhatsAppReadyTemplate(useCase);
  };

  const setWhatsAppUseCase = (useCase: WhatsAppTemplateUseCase) => {
    const mapping = whatsappTemplateData.mappings.find((item) => item.useCase === useCase);
    const preset = whatsappReadyTemplateForUseCase(useCase);
    if (whatsappDraftForm.useCase !== useCase) setSelectedWhatsAppDraftId("");
    setWhatsAppDraftForm((current) => ({
      ...current,
      useCase,
      templateName: mapping?.templateName || preset.templateName || current.templateName,
      bodyText: current.useCase === useCase ? current.bodyText : preset.bodyText,
      footerText: current.useCase === useCase ? current.footerText : preset.footerText,
      headerType: whatsAppPdfUseCases.has(useCase) ? "document" : preset.headerType,
      headerText: whatsAppPdfUseCases.has(useCase) ? "" : preset.headerText
    }));
  };

  const selectWhatsAppDraft = (draft: WhatsAppTemplateDraft) => {
    const normalizedHeaderType = normalizeWhatsAppDraftHeaderTypeForUseCase(draft.useCase, draft.headerType);
    setSelectedWhatsAppDraftId(draft.id);
    setWhatsAppDraftForm({
      useCase: draft.useCase,
      templateName: draft.templateName,
      languageCode: draft.languageCode,
      category: draft.category,
      headerType: normalizedHeaderType,
      headerText: normalizedHeaderType === "text" ? draft.headerText : "",
      bodyText: draft.bodyText,
      footerText: draft.footerText,
      buttons: draft.buttons,
      variableTokens: draft.variableTokens,
      replacementOfName: draft.replacementOfName,
      buttonsText: draft.buttons.map((button) => button.text).join("\n")
    });
  };

  const whatsAppDraftPayload = (): SaveWhatsAppTemplateDraftInput => {
    const headerType = normalizeWhatsAppDraftHeaderTypeForUseCase(whatsappDraftForm.useCase, whatsappDraftForm.headerType);
    return {
      ...(selectedWhatsAppDraftId ? { id: selectedWhatsAppDraftId } : {}),
      useCase: whatsappDraftForm.useCase,
      templateName: whatsappDraftForm.templateName,
      languageCode: whatsappDraftForm.languageCode || "en",
      category: whatsappDraftForm.category,
      headerType,
      headerText: headerType === "text" ? whatsappDraftForm.headerText || "" : "",
      bodyText: whatsappDraftForm.bodyText,
      footerText: whatsappDraftForm.footerText || "",
      buttons: whatsappDraftForm.buttonsText
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((text) => ({ type: "QUICK_REPLY" as const, text })),
      replacementOfName: whatsappDraftForm.replacementOfName || ""
    };
  };

  const saveWhatsAppTemplateDraft = async () => {
    try {
      setWhatsAppTemplateBusy("draft");
      const payload = whatsAppDraftPayload();
      const data = selectedWhatsAppDraftId
        ? await window.autocare.updateWhatsAppTemplateDraft(selectedWhatsAppDraftId, payload)
        : await window.autocare.saveWhatsAppTemplateDraft(payload);
      setWhatsAppTemplateData(data);
      const returnedDraft = (data as WhatsAppTemplateManagerData & { draft?: WhatsAppTemplateDraft }).draft;
      const draft = returnedDraft?.id ? returnedDraft : data.drafts.find((item) =>
        item.useCase === payload.useCase &&
        item.templateName === payload.templateName &&
        item.languageCode === payload.languageCode
      );
      if (draft) selectWhatsAppDraft(draft);
      notify("WhatsApp template draft saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save WhatsApp template draft.");
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  const submitWhatsAppTemplateDraft = async () => {
    if (!selectedWhatsAppDraftId) return notify("Save the WhatsApp template draft before submitting.");
    try {
      setWhatsAppTemplateBusy("submit");
      const data = await window.autocare.submitWhatsAppTemplateDraft(selectedWhatsAppDraftId);
      setWhatsAppTemplateData(data);
      notify(data.message || "WhatsApp template submitted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to submit WhatsApp template.");
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  const syncWhatsAppTemplateManager = async () => {
    try {
      setWhatsAppTemplateBusy("sync");
      const templates = await window.autocare.syncWhatsAppTemplates();
      const data = await window.autocare.getWhatsAppTemplateManager();
      setWhatsAppTemplateData(data);
      setWhatsAppStatus((current) => current ? { ...current, templatesCount: templates.length } : current);
      notify(`Synced ${templates.length} WhatsApp templates.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to sync WhatsApp templates.");
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  const mapApprovedWhatsAppTemplate = async (useCase: WhatsAppTemplateUseCase, templateName: string, languageCode: string) => {
    try {
      setWhatsAppTemplateBusy(`mapping-${useCase}`);
      await window.autocare.saveWhatsAppTemplateMapping({ useCase, templateName, languageCode });
      await loadWhatsAppTemplateManager();
      notify("WhatsApp template mapping updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update template mapping.");
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  const retryWhatsAppDraft = async (id: string) => {
    try {
      setWhatsAppTemplateBusy(`retry-${id}`);
      const result = await window.autocare.retryWhatsAppUnsentDraft(id);
      notify(result.message);
      await loadWhatsAppPreviewData();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to retry WhatsApp draft.");
    } finally {
      setWhatsAppTemplateBusy("");
    }
  };

  useEffect(() => {
    const firstTab = visibleTabs[0];
    if (firstTab && !visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab(firstTab.id);
  }, [activeTab, visibleTabs.map((tab) => tab.id).join("|")]);

  if (!visibleTabs.length) {
    return (
      <div className="page-grid">
        <section className="panel wide-panel access-panel">
          <h2>Owner access required</h2>
          <p className="muted">Settings, backup restore, invoice customization, and user security are protected for the owner account.</p>
          <div className="mini-metrics">
            <div><span>Signed in</span><strong>{currentUser.displayName}</strong></div>
            <div><span>Role</span><strong>Staff</strong></div>
            <div><span>Mode</span><strong>Billing access</strong></div>
          </div>
        </section>
      </div>
    );
  }

  const save = async () => {
    try {
      const saved = await window.autocare.saveSettings(form);
      setSettings(saved);
      notify("Settings saved.");
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save settings.");
    }
  };

  const saveWhatsAppConfig = async () => {
    try {
      setWhatsAppBusy("save");
      const result = await window.autocare.saveWhatsAppConfig(whatsappConfig);
      setWhatsAppConfig({ ...emptyWhatsAppConfig, ...result.config });
      setWhatsAppStatus(result.status);
      notify("WhatsApp settings saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save WhatsApp settings.");
    } finally {
      setWhatsAppBusy("");
    }
  };

  const backup = async () => {
    const result = await window.autocare.createBackup();
    notify(result.path ? `${result.message} ${result.path}` : result.message);
    await refreshBackupScheduleStatus();
  };

  const restore = async () => {
    const result = await window.autocare.restoreBackup();
    notify(result.message);
    if (result.ok) onChanged();
    await refreshBackupScheduleStatus();
  };

  const runDriveAction = async (label: string, action: () => Promise<void>) => {
    setDriveBusy(label);
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Drive action failed.");
    } finally {
      setDriveBusy("");
    }
  };

  const runSyncAction = async (label: string, action: () => Promise<void>) => {
    setSyncBusy(label);
    try {
      await action();
      await Promise.all([refreshSyncStatus(), loadSyncConflicts()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Cloud sync action failed.");
    } finally {
      setSyncBusy("");
    }
  };

  const connectDrive = () =>
    runDriveAction("connect", async () => {
      const status = await window.autocare.connectDrive({
        clientId: form.googleDriveClientId,
        clientSecret: form.googleDriveClientSecret
      });
      setDriveStatus(status);
      const latest = await window.autocare.getSettings();
      setSettings(latest);
      setForm(latest);
      await refreshBackupScheduleStatus();
      notify(status.connected ? "Google Drive connected." : "Google Drive connection incomplete.");
    });

  const disconnectDrive = () =>
    runDriveAction("disconnect", async () => {
      const result = await window.autocare.disconnectDrive();
      notify(result.message);
      setDriveBackups([]);
      setSelectedDriveBackupId("");
      await refreshDriveStatus();
      await refreshBackupScheduleStatus();
    });

  const testDriveConnection = () =>
    runDriveAction("test", async () => {
      const result = await window.autocare.testDriveConnection();
      notify(result.message);
      await refreshDriveStatus();
      await refreshBackupScheduleStatus();
    });

  const loadDriveBackups = async () => {
    const backups = await window.autocare.listDriveBackups();
    setDriveBackups(backups);
    setSelectedDriveBackupId((current) => current || backups[0]?.id || "");
    await refreshDriveStatus();
    await refreshBackupScheduleStatus();
  };

  const backupToDriveNow = () =>
    runDriveAction("backup", async () => {
      const result = await window.autocare.backupToDriveNow();
      notify(result.fileName ? `${result.message} ${result.fileName}` : result.message);
      await refreshDriveStatus();
      await refreshBackupScheduleStatus();
      await loadDriveBackups();
    });

  const restoreDriveBackup = () =>
    runDriveAction("restore", async () => {
      if (!selectedDriveBackupId) return notify("Select a cloud backup first.");
      const result = await window.autocare.restoreDriveBackup(selectedDriveBackupId);
      notify(result.message);
      if (result.ok) onChanged();
      await refreshBackupScheduleStatus();
    });

  const connectSyncDevice = () =>
    runSyncAction("connect", async () => {
      const status = await window.autocare.connectSyncDevice(syncForm);
      setSyncStatus(status);
      setSyncForm((current) => ({ ...current, registrationKey: "" }));
      notify(status.state === "pending_approval" ? "Waiting for owner approval." : status.connected ? "Cloud data connected." : "Cloud data connection incomplete.");
    });

  const disconnectSyncDevice = () =>
    runSyncAction("disconnect", async () => {
      const result = await window.autocare.disconnectSyncDevice();
      setSyncStatus(result.status);
      notify(result.message);
    });

  const checkSyncApproval = () =>
    runSyncAction("approval", async () => {
      const status = await window.autocare.checkSyncApproval();
      setSyncStatus(status);
      notify(status.connected ? "Device approved. Cloud data connected." : status.state === "pending_approval" ? "Waiting for owner approval." : status.lastError || "Approval is not active.");
    });

  const triggerCloudSync = () =>
    runSyncAction("sync", async () => {
      const result = await window.autocare.triggerSync();
      setSyncStatus(result.status);
      notify(result.message);
    });

  const requireCloudOwnerCredentials = () => {
    if (!cloudDeviceCredentials.ownerUsername.trim() || !cloudDeviceCredentials.ownerPassword) {
      notify("Enter cloud owner username and password.");
      return false;
    }
    return true;
  };

  const runCloudDeviceAction = async (label: string, action: () => Promise<void>) => {
    if (!requireCloudOwnerCredentials()) return;
    setCloudDevicesBusy(label);
    try {
      await action();
      await refreshSyncStatus();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Cloud device action failed.");
    } finally {
      setCloudDevicesBusy("");
    }
  };

  const loadCloudDevices = () =>
    runCloudDeviceAction("list", async () => {
      const result = await window.autocare.listCloudDevices(cloudDeviceCredentials);
      setCloudDevices(visibleCloudDevices(result.devices));
      notify("Cloud devices loaded.");
    });

  const approveCloudDevice = (deviceId: string) =>
    runCloudDeviceAction(`approve:${deviceId}`, async () => {
      await window.autocare.approveCloudDevice({ ...cloudDeviceCredentials, deviceId });
      const result = await window.autocare.listCloudDevices(cloudDeviceCredentials);
      setCloudDevices(visibleCloudDevices(result.devices));
      notify("Device approved.");
    });

  const revokeCloudDevice = (deviceId: string) =>
    runCloudDeviceAction(`revoke:${deviceId}`, async () => {
      await window.autocare.revokeCloudDevice({ ...cloudDeviceCredentials, deviceId });
      const result = await window.autocare.listCloudDevices(cloudDeviceCredentials);
      setCloudDevices(visibleCloudDevices(result.devices));
      notify("Device revoked.");
    });

  const resolveSyncConflictGroup = (conflicts: SyncConflictSummary[], resolution: SyncConflictResolution) =>
    runSyncAction("conflict", async () => {
      await Promise.all(conflicts.map((conflict) => window.autocare.resolveSyncConflict({ conflictId: conflict.conflictId, resolution })));
      notify(conflicts.length > 1 ? `${conflicts.length} related sync alerts updated.` : "Sync conflict updated.");
    });

  const pickInvoiceAsset = async (kind: InvoiceAssetKind) => {
    const result = await window.autocare.pickInvoiceAsset(kind);
    notify(result.message);
    if (!result.ok || !result.path) return;
    const field =
      kind === "signature"
        ? "invoiceSignaturePath"
        : kind === "watermark"
          ? "invoiceWatermarkPath"
          : "invoiceLogoPath";
    setForm((current) => ({ ...current, [field]: result.path }));
  };

  const exportCsv = async (kind: "invoices" | "customers" | "services" | "inventory" | "enquiries" | "jobCards") => {
    const result = await window.autocare.exportCsv(kind);
    notify(result.path ? `${result.message} ${result.path}` : result.message);
  };

  const saveChecklistSettings = async () => {
    try {
      const saved = await window.autocare.saveJobCardSettings({ defaultChecklist: jobChecklist });
      setJobChecklist(saved.defaultChecklist);
      notify("Job card checklist saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save job card checklist.");
    }
  };

  const saveUser = async () => {
    try {
      const input: SaveUserInput = {
        id: userForm.id,
        displayName: userForm.displayName,
        username: userForm.username,
        role: userForm.role,
        accessRoleId: userForm.role === "staff" ? userForm.accessRoleId : OWNER_ACCESS_ROLE_ID,
        active: userForm.active !== false
      };
      if (userForm.password?.trim()) input.password = userForm.password;
      await window.autocare.saveUser(input);
      notify(userForm.id ? "User account updated." : "User account created.");
      setUserForm({ displayName: "", username: "", role: "staff", accessRoleId: STAFF_OPERATIONS_ROLE_ID, password: "", active: true });
      await loadUsers();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save user.");
    }
  };

  const deactivateUser = async (user: AppUser) => {
    try {
      await window.autocare.deactivateUser(user.id);
      notify("User account deactivated.");
      await loadUsers();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to deactivate user.");
    }
  };

  const editRole = (role: AccessRole) => {
    setRoleForm({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      active: role.active
    });
  };

  const toggleRolePermission = (permission: PermissionKey) => {
    setRoleForm((current) => {
      const permissions = current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission];
      return { ...current, permissions };
    });
  };

  const saveRole = async () => {
    try {
      await window.autocare.saveAccessRole(roleForm);
      notify(roleForm.id ? "Access role updated." : "Access role created.");
      setRoleForm({ name: "", description: "", permissions: [], active: true });
      await Promise.all([loadRoles(), loadUsers()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save access role.");
    }
  };

  const deactivateRole = async (role: AccessRole) => {
    try {
      await window.autocare.deactivateAccessRole(role.id);
      notify("Access role deactivated.");
      await loadRoles();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to deactivate access role.");
    }
  };

  const changeOwnPassword = async () => {
    if (newPassword !== confirmNewPassword) return notify("New passwords do not match.");
    try {
      await window.autocare.changePassword({
        userId: currentUser.id,
        currentPassword,
        newPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      notify("Password changed. Login again with the new password.");
      onLogout();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to change password.");
    }
  };

  return (
    <div className="settings-workspace">
      <nav className="settings-tabs" aria-label="Settings sections">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
              <Icon size={19} />
              <span>{tab.label}</span>
              <em>{tab.description}</em>
            </button>
          );
        })}
      </nav>

      <div className="settings-tab-content">
        {activeTab === "business" && (
      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Business details</h2>
            <p>Used on invoice and receipt print layouts.</p>
          </div>
          <button className="primary-action" onClick={save}><Save size={18} /> Save settings</button>
        </div>
        <div className="form-grid two">
          <label>Business name<input value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.currentTarget.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} /></label>
          <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.currentTarget.value })} /></label>
          <label>GSTIN<input value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.currentTarget.value.toUpperCase() })} /></label>
          <label>State<input value={form.state} onChange={(event) => setForm({ ...form, state: event.currentTarget.value })} /></label>
          <label>Invoice prefix<input value={form.invoicePrefix} onChange={(event) => setForm({ ...form, invoicePrefix: event.currentTarget.value.toUpperCase() })} /></label>
          <label>Next invoice number<input type="number" min="1" value={form.nextInvoiceNumber} onChange={(event) => setForm({ ...form, nextInvoiceNumber: Number(event.currentTarget.value) })} /></label>
          <label>Quotation prefix<input value={form.quotationPrefix} onChange={(event) => setForm({ ...form, quotationPrefix: event.currentTarget.value.toUpperCase() })} /></label>
          <label>Next quotation number<input type="number" min="1" value={form.nextQuotationNumber} onChange={(event) => setForm({ ...form, nextQuotationNumber: Number(event.currentTarget.value) })} /></label>
          <label>Default GST rate<input type="number" min="0" value={form.defaultGstRate} onChange={(event) => setForm({ ...form, defaultGstRate: Number(event.currentTarget.value) })} /></label>
          <label>Default tax type<select value={form.defaultTaxScope} onChange={(event) => setForm({ ...form, defaultTaxScope: event.currentTarget.value as TaxScope })}><option value="intra">CGST + SGST</option><option value="inter">IGST</option></select></label>
          <label className="wide-input">Address<input value={form.address} onChange={(event) => setForm({ ...form, address: event.currentTarget.value })} /></label>
          <label className="wide-input">Backup directory<input value={form.backupDirectory} onChange={(event) => setForm({ ...form, backupDirectory: event.currentTarget.value })} /></label>
        </div>
      </section>
        )}

        {activeTab === "jobCards" && (
      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Job card checklist</h2>
            <p>Default checklist copied into every new job card.</p>
          </div>
          <button className="primary-action" onClick={saveChecklistSettings}><Save size={18} /> Save checklist</button>
        </div>
        <div className="form-stack">
          {jobChecklist.map((item, index) => (
            <div className="inline-actions" key={index}>
              <input
                value={item}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setJobChecklist((rows) => rows.map((row, rowIndex) => rowIndex === index ? value : row));
                }}
              />
              <button className="ghost-button small" onClick={() => setJobChecklist((rows) => rows.filter((_row, rowIndex) => rowIndex !== index))}>Remove</button>
            </div>
          ))}
          <button className="ghost-button" onClick={() => setJobChecklist((rows) => [...rows, ""])}>Add checklist item</button>
        </div>
      </section>

        )}

        {activeTab === "whatsapp" && (
          <section className="panel wide-panel cloud-panel">
            <div className="panel-heading">
              <div>
                <h2>WhatsApp Business API</h2>
                <p>Provider credentials are stored on the cloud API database and are not read from server env files.</p>
              </div>
              <div className="inline-actions">
                <button className="ghost-button" disabled={Boolean(whatsappBusy)} onClick={() => void refreshWhatsAppConfig()}><RefreshCw size={17} /> Refresh</button>
                <button className="primary-action" disabled={Boolean(whatsappBusy)} onClick={() => void saveWhatsAppConfig()}><Save size={18} /> {whatsappBusy === "save" ? "Saving..." : "Save WhatsApp"}</button>
              </div>
            </div>

            <div className="mini-metrics cloud-metrics">
              <div><span>Provider</span><strong>{whatsappProviderLabel}</strong></div>
              <div><span>API</span><strong>{whatsappStatus?.configured ? "Configured" : "Not configured"}</strong></div>
              <div><span>Webhook</span><strong>{whatsappStatus?.webhookReady ? "Ready" : "Pending"}</strong></div>
              <div><span>Templates</span><strong>{whatsappStatus?.templatesCount ?? 0}</strong></div>
            </div>
            {whatsappStatus?.message && <p className={whatsappStatus.configured ? "muted" : "cloud-error"}>{whatsappStatus.message}</p>}

            <div className="form-grid two">
              <label className="inline-check wide-input">
                <input type="checkbox" checked={whatsappConfig.enabled} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, enabled: event.currentTarget.checked })} />
                Enable WhatsApp Business API
              </label>
              <label>Provider<select value={whatsappConfig.provider} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, provider: event.currentTarget.value as WhatsAppProvider })}><option value="ycloud">YCloud</option><option value="meta">Meta Cloud API</option></select></label>
              <label className="wide-input">Webhook URL<input readOnly value={whatsappWebhookUrl} /></label>
            </div>

            {whatsappConfig.provider === "ycloud" ? (
              <div className="form-grid two">
                <label>Sender phone<input value={whatsappConfig.ycloudFromPhone} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, ycloudFromPhone: event.currentTarget.value })} placeholder="+919000000000" /></label>
                <label>YCloud WABA ID<input value={whatsappConfig.ycloudWabaId} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, ycloudWabaId: event.currentTarget.value })} /></label>
                <label className="wide-input">YCloud API base URL<input value={whatsappConfig.ycloudApiBaseUrl} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, ycloudApiBaseUrl: event.currentTarget.value })} /></label>
                <label>YCloud API key<input type="password" value={whatsappConfig.ycloudApiKey} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, ycloudApiKey: event.currentTarget.value })} placeholder={secretPlaceholder(whatsappConfig.hasYCloudApiKey, "API key")} /></label>
                <label>Webhook secret<input type="password" value={whatsappConfig.ycloudWebhookSecret} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, ycloudWebhookSecret: event.currentTarget.value })} placeholder={secretPlaceholder(whatsappConfig.hasYCloudWebhookSecret, "webhook secret")} /></label>
              </div>
            ) : (
              <div className="form-grid two">
                <label>Phone number ID<input value={whatsappConfig.phoneNumberId} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, phoneNumberId: event.currentTarget.value })} /></label>
                <label>Business account ID<input value={whatsappConfig.businessAccountId} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, businessAccountId: event.currentTarget.value })} /></label>
                <label>Display phone<input value={whatsappConfig.displayPhoneNumber} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, displayPhoneNumber: event.currentTarget.value })} /></label>
                <label>Graph version<input value={whatsappConfig.graphVersion} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, graphVersion: event.currentTarget.value })} /></label>
                <label className="wide-input">Graph base URL<input value={whatsappConfig.graphBaseUrl} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, graphBaseUrl: event.currentTarget.value })} /></label>
                <label>Access token<input type="password" value={whatsappConfig.accessToken} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, accessToken: event.currentTarget.value })} placeholder={secretPlaceholder(whatsappConfig.hasAccessToken, "access token")} /></label>
                <label>Verify token<input type="password" value={whatsappConfig.webhookVerifyToken} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, webhookVerifyToken: event.currentTarget.value })} placeholder={secretPlaceholder(whatsappConfig.hasWebhookVerifyToken, "verify token")} /></label>
                <label>App secret<input type="password" value={whatsappConfig.appSecret} onChange={(event) => setWhatsAppConfig({ ...whatsappConfig, appSecret: event.currentTarget.value })} placeholder={secretPlaceholder(whatsappConfig.hasAppSecret, "app secret")} /></label>
              </div>
            )}

            <div className="whatsapp-template-manager">
              <div className="panel-heading compact">
                <div>
                  <h2>Templates</h2>
                  <p>Draft, submit, sync, and map approved WhatsApp templates.</p>
                </div>
                <div className="inline-actions">
                  <button className="ghost-button" disabled={Boolean(whatsappTemplateBusy)} onClick={() => void loadWhatsAppTemplateManager()}><RefreshCw size={17} /> Load</button>
                  <button className="primary-action" disabled={Boolean(whatsappTemplateBusy)} onClick={() => void syncWhatsAppTemplateManager()}><RefreshCw size={17} /> {whatsappTemplateBusy === "sync" ? "Syncing..." : "Sync templates"}</button>
                </div>
              </div>

              <div className="mini-metrics cloud-metrics">
                <div><span>Registry</span><strong>{whatsappTemplateData.variables.filter((item) => item.active).length}</strong></div>
                <div><span>Drafts</span><strong>{whatsappTemplateData.drafts.length}</strong></div>
                <div><span>Approved</span><strong>{approvedWhatsAppTemplates.length}</strong></div>
                <div><span>Unsent</span><strong>{whatsappUnsentDrafts.length}</strong></div>
              </div>

              <div className="whatsapp-template-grid">
                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Required mappings</h3>
                  </div>
                  <div className="whatsapp-mapping-list">
                    {whatsappTemplateUseCases.filter((item) => item.id !== "custom").map((item) => {
                      const mapping = whatsappTemplateData.mappings.find((row) => row.useCase === item.id);
                      const activeKey = `${mapping?.templateName || ""}:${mapping?.languageCode || "en"}`;
                      const approved = approvedTemplateNames.has(activeKey);
                      const draftReady = whatsappTemplateData.drafts.some((draft) =>
                        draft.useCase === item.id &&
                        draft.templateName === mapping?.templateName &&
                        draft.languageCode === (mapping?.languageCode || "en")
                      );
                      return (
                        <div className={item.pdf ? "whatsapp-mapping-row document-template" : "whatsapp-mapping-row"} key={item.id}>
                          <div className="mapping-main">
                            <strong>{item.label}</strong>
                            {item.help && <span>{item.help}</span>}
                            <span>{mapping?.templateName || "Not mapped"} - {mapping?.languageCode || "en"}</span>
                          </div>
                          <span className={`status-pill ${approved ? "success" : mapping?.pendingTemplateName || draftReady ? "warning" : "danger"}`}>
                            {approved ? "Approved" : mapping?.pendingTemplateName ? "Pending" : draftReady ? "Draft ready" : "Needs template"}
                          </span>
                          <button className="ghost-button small" disabled={Boolean(whatsappTemplateBusy)} onClick={() => selectWhatsAppUseCaseDraft(item.id)}>
                            <FileText size={15} /> Edit
                          </button>
                          <select
                            value={activeKey}
                            onChange={(event) => {
                              const [name, languageCode] = event.currentTarget.value.split(":");
                              if (name) void mapApprovedWhatsAppTemplate(item.id, name, languageCode || "en");
                            }}
                          >
                            {mapping?.templateName && <option value={activeKey}>{mapping.templateName} ({mapping.languageCode || "en"})</option>}
                            <option value="">Select approved</option>
                            {approvedWhatsAppTemplates.map((template) => (
                              <option key={`${item.id}-${template.name}-${template.languageCode}`} value={`${template.name}:${template.languageCode}`}>
                                {template.name} ({template.languageCode})
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Draft editor</h3>
                    <button className="ghost-button small" onClick={() => { setSelectedWhatsAppDraftId(""); setWhatsAppDraftForm(emptyWhatsAppDraftForm()); }}>New draft</button>
                  </div>
                  <div className="template-guidance-card">
                    <div>
                      <strong>{whatsappUseCaseLabel(whatsappDraftForm.useCase)}</strong>
                      <span>{whatsappUseCaseHelp(whatsappDraftForm.useCase) || "Write a customer-friendly WhatsApp template and submit it for Meta approval."}</span>
                    </div>
                    <button className="ghost-button small" disabled={Boolean(whatsappTemplateBusy)} onClick={() => applyWhatsAppReadyTemplate()}>
                      <FileText size={15} /> Use ready-made text
                    </button>
                  </div>
                  <div className="form-grid two">
                    <label>Use case<select value={whatsappDraftForm.useCase} onChange={(event) => setWhatsAppUseCase(event.currentTarget.value as WhatsAppTemplateUseCase)}>{whatsappTemplateUseCases.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    <label>Template name<input value={whatsappDraftForm.templateName} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, templateName: event.currentTarget.value })} /></label>
                    <label>Language<input value={whatsappDraftForm.languageCode} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, languageCode: event.currentTarget.value })} /></label>
                    <label>Category<select value={whatsappDraftForm.category} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, category: event.currentTarget.value as SaveWhatsAppTemplateDraftInput["category"] })}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></select></label>
                    <div className={selectedUseCaseRequiresDocument ? "attachment-choice active wide-input" : "attachment-choice wide-input"}>
                      <div>
                        <Paperclip size={18} />
                        <div>
                          <strong>{selectedUseCaseRequiresDocument ? "PDF attachment enabled" : "Attachment"}</strong>
                          <span>
                            {selectedUseCaseRequiresDocument
                              ? "This template uses a Document header. The app attaches the generated PDF when sending."
                              : "Most normal reminders and chat messages should stay as no attachment."}
                          </span>
                        </div>
                      </div>
                      <label>
                        Attachment mode
                        <select
                          value={selectedHeaderType}
                          disabled={selectedUseCaseRequiresDocument}
                          onChange={(event) => {
                            const headerType = event.currentTarget.value as WhatsAppTemplateHeaderType;
                            setWhatsAppDraftForm({ ...whatsappDraftForm, headerType, headerText: headerType === "text" ? whatsappDraftForm.headerText : "" });
                          }}
                        >
                          <option value="none">No attachment</option>
                          <option value="text">Text title only</option>
                          {(selectedUseCaseRequiresDocument || whatsappDraftForm.useCase === "custom") && <option value="document">PDF/document attachment</option>}
                        </select>
                      </label>
                    </div>
                    {selectedHeaderType === "text" && !selectedUseCaseRequiresDocument && (
                      <label className="wide-input">Title shown at top<input value={whatsappDraftForm.headerText || ""} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, headerText: event.currentTarget.value })} /></label>
                    )}
                    <label className="wide-input">Message body<textarea rows={8} value={whatsappDraftForm.bodyText} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, bodyText: event.currentTarget.value })} /></label>
                    <label>Footer<input value={whatsappDraftForm.footerText || ""} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, footerText: event.currentTarget.value })} /></label>
                    <label>Replacing approved template<input value={whatsappDraftForm.replacementOfName || ""} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, replacementOfName: event.currentTarget.value })} placeholder="Leave blank for new template" /></label>
                    <label className="wide-input">Quick reply buttons<textarea rows={3} value={whatsappDraftForm.buttonsText} onChange={(event) => setWhatsAppDraftForm({ ...whatsappDraftForm, buttonsText: event.currentTarget.value })} placeholder="One button label per line" /></label>
                  </div>
                  <div className="template-token-row">
                    {whatsappTemplateData.variables.filter((item) => item.active).map((variable) => (
                      <button
                        className="token-chip"
                        key={variable.token}
                        onClick={() => setWhatsAppDraftForm((current) => ({ ...current, bodyText: `${current.bodyText}${current.bodyText.endsWith(" ") || !current.bodyText ? "" : " "}{{${variable.token}}}` }))}
                        title={variable.sampleValue}
                      >
                        <strong>{variable.label}</strong>
                        <span>{`{{${variable.token}}}`}</span>
                      </button>
                    ))}
                  </div>
                  {!variableDensityOk && (
                    <div className="inline-warning">
                      This message has {templateVariableSlots} variable(s) but only {templateStaticWords} fixed word(s). Add more normal words or remove variables before submitting.
                    </div>
                  )}
                  <div className="template-counters">
                    <span className={bodyCounterOk ? "" : "danger-text"}>Body {whatsappDraftForm.bodyText.length}/1024</span>
                    <span className={footerCounterOk ? "" : "danger-text"}>Footer {(whatsappDraftForm.footerText || "").length}/60</span>
                    <span className={headerCounterOk ? "" : "danger-text"}>Title {selectedHeaderText.length}/60</span>
                    <span className={buttonsCounterOk ? "" : "danger-text"}>Buttons {whatsappDraftForm.buttonsText.split(/\r?\n/).filter((row) => row.trim()).length}/10</span>
                  </div>
                  <div className="inline-actions">
                    <button className="ghost-button" disabled={Boolean(whatsappTemplateBusy || !selectedTemplateDraftOk)} onClick={() => void saveWhatsAppTemplateDraft()}><Save size={17} /> Save draft</button>
                    <button className="primary-action" disabled={Boolean(whatsappTemplateBusy || !selectedWhatsAppDraftId || !selectedTemplateDraftOk)} onClick={() => void submitWhatsAppTemplateDraft()}>Submit to YCloud</button>
                  </div>
                </section>
              </div>

              <div className="whatsapp-template-grid">
                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Preview</h3>
                  </div>
                  <div className="form-grid two">
                    <label>Customer<select value={previewCustomerId} onChange={(event) => setPreviewCustomerId(event.currentTarget.value)}>{previewCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                    <label>Invoice<select value={previewInvoiceId} onChange={(event) => setPreviewInvoiceId(event.currentTarget.value)}>{previewInvoices.slice(0, 50).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {invoice.customerName}</option>)}</select></label>
                  </div>
                  <div className="whatsapp-preview-box">
                    <strong>{selectedUseCaseRequiresDocument || selectedHeaderType === "document" ? "PDF/document attachment" : selectedHeaderText || selectedUseCaseMapping?.templateName || "WhatsApp template"}</strong>
                    {(selectedUseCaseRequiresDocument || selectedHeaderType === "document") && <span>Generated document will be attached by the app during send.</span>}
                    <p>{whatsappPreviewBody}</p>
                    {whatsappDraftForm.footerText && <span>{whatsappDraftForm.footerText}</span>}
                  </div>
                </section>

                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Drafts</h3>
                  </div>
                  <div className="whatsapp-history-list">
                    {whatsappTemplateData.drafts.slice(0, 8).map((draft) => (
                      <button className={draft.id === selectedWhatsAppDraft?.id ? "history-row active" : "history-row"} key={draft.id} onClick={() => selectWhatsAppDraft(draft)}>
                        <strong>{draft.templateName}</strong>
                        <span>{whatsappUseCaseLabel(draft.useCase)} - {draft.status || "DRAFT"} {draft.rejectionReason ? `- ${draft.rejectionReason}` : ""}</span>
                      </button>
                    ))}
                    {!whatsappTemplateData.drafts.length && <p className="muted">No drafts yet.</p>}
                  </div>
                </section>
              </div>

              <div className="whatsapp-template-grid">
                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Submission history</h3>
                  </div>
                  <div className="whatsapp-history-list">
                    {whatsappTemplateData.submissionHistory.slice(0, 6).map((history) => (
                      <div className="history-row" key={history.id}>
                        <strong>{history.templateName}</strong>
                        <span>{history.providerStatus || "Submitted"} - {formatDateTime(history.createdAt)} {history.errorMessage ? `- ${history.errorMessage}` : ""}</span>
                      </div>
                    ))}
                    {!whatsappTemplateData.submissionHistory.length && <p className="muted">No submissions yet.</p>}
                  </div>
                </section>

                <section className="whatsapp-template-pane">
                  <div className="template-section-head">
                    <h3>Sync events</h3>
                  </div>
                  <div className="whatsapp-history-list">
                    {whatsappTemplateData.syncEvents.slice(0, 6).map((event) => (
                      <div className="history-row" key={event.id}>
                        <strong>{event.eventType}</strong>
                        <span>{event.message || event.status} - {formatDateTime(event.createdAt)}</span>
                      </div>
                    ))}
                    {!whatsappTemplateData.syncEvents.length && <p className="muted">No sync events yet.</p>}
                  </div>
                </section>
              </div>

              {whatsappUnsentDrafts.length > 0 && (
                <section className="whatsapp-template-pane unsent-drafts-pane">
                  <div className="template-section-head">
                    <h3>Unsent drafts</h3>
                  </div>
                  <div className="whatsapp-history-list">
                    {whatsappUnsentDrafts.slice(0, 6).map((draft) => (
                      <div className="history-row split" key={draft.id}>
                        <div>
                          <strong>{draft.customerName || draft.phone}</strong>
                          <span>{draft.templateName || "WhatsApp message"} - {draft.reason}</span>
                        </div>
                        <button className="ghost-button small" disabled={Boolean(whatsappTemplateBusy)} onClick={() => void retryWhatsAppDraft(draft.id)}>Retry</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </section>
        )}

        {activeTab === "invoice" && (
      <section className="panel wide-panel settings-invoice-panel">
        <div className="panel-heading">
          <div>
            <h2>Invoice template editor</h2>
            <p>Design, payment, notes, and print controls used by invoice PDF output.</p>
          </div>
          <button className="primary-action" onClick={save}><Save size={18} /> Save template</button>
        </div>

        <div className={`invoice-customization-grid ${activeInvoiceTab === "preview" ? "preview-focus" : ""}`}>
          <div className="template-editor">
            <nav className="invoice-editor-tabs" aria-label="Invoice customization sections">
              {invoiceEditorTabs.map((tab) => (
                <button key={tab.id} className={activeInvoiceTab === tab.id ? "active" : ""} onClick={() => setActiveInvoiceTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeInvoiceTab === "brand" && (
              <section className="template-editor-section">
                <div className="template-section-head">
                  <h3>Brand</h3>
                </div>
                <div className="form-grid three">
                  <label>Accent color<input type="color" value={form.invoiceAccentColor} onChange={(event) => setForm({ ...form, invoiceAccentColor: event.currentTarget.value })} /></label>
                  <label>Secondary color<input type="color" value={form.invoiceSecondaryColor} onChange={(event) => setForm({ ...form, invoiceSecondaryColor: event.currentTarget.value })} /></label>
                  <label>Logo size<select value={form.invoiceLogoSize} onChange={(event) => setForm({ ...form, invoiceLogoSize: event.currentTarget.value as InvoiceLogoSize })}>{invoiceLogoSizes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label>GST invoice title<input value={form.gstInvoiceTitle} onChange={(event) => setForm({ ...form, gstInvoiceTitle: event.currentTarget.value })} /></label>
                  <label>Simple receipt title<input value={form.simpleReceiptTitle} onChange={(event) => setForm({ ...form, simpleReceiptTitle: event.currentTarget.value })} /></label>
                  <label>Quotation title<input value={form.quotationTitle} onChange={(event) => setForm({ ...form, quotationTitle: event.currentTarget.value })} /></label>
                  <label className="inline-check template-inline-control"><input type="checkbox" checked={form.showLogo} onChange={(event) => setForm({ ...form, showLogo: event.currentTarget.checked })} /> Show logo</label>
                </div>
                <div className="template-asset-row">
                  <label>Logo path<input readOnly value={form.invoiceLogoPath} /></label>
                  <div className="inline-actions">
                    <button className="ghost-button small" onClick={() => pickInvoiceAsset("logo")}>Browse</button>
                    <button className="ghost-button small" onClick={() => setForm({ ...form, invoiceLogoPath: "" })}>Clear</button>
                  </div>
                </div>
              </section>
            )}

            {activeInvoiceTab === "layout" && (
              <section className="template-editor-section">
                <div className="template-section-head">
                  <h3>Layout</h3>
                </div>
                <div className="form-grid three">
                  <label>Paper size<select value={form.invoicePaperSize} onChange={(event) => setForm({ ...form, invoicePaperSize: event.currentTarget.value as InvoicePaperSize })}>{invoicePaperSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                  <label>Font style<select value={form.invoiceFontStyle} onChange={(event) => setForm({ ...form, invoiceFontStyle: event.currentTarget.value as InvoiceFontStyle })}>{invoiceFontStyles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label>Text size<select value={form.invoiceTextSize} onChange={(event) => setForm({ ...form, invoiceTextSize: event.currentTarget.value as InvoiceTextSize })}>{invoiceTextSizes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label>Density<select value={form.invoiceDensity} onChange={(event) => setForm({ ...form, invoiceDensity: event.currentTarget.value as InvoiceDensity })}>{invoiceDensities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label>Watermark placement<select value={form.invoiceWatermarkPlacement} onChange={(event) => setForm({ ...form, invoiceWatermarkPlacement: event.currentTarget.value as InvoiceWatermarkPlacement })}>{invoiceWatermarkPlacements.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="range-control">Watermark opacity<span>{Math.round(form.invoiceWatermarkOpacity * 100)}%</span><input type="range" min="0" max="0.3" step="0.01" value={form.invoiceWatermarkOpacity} onChange={(event) => setForm({ ...form, invoiceWatermarkOpacity: Number(event.currentTarget.value) })} /></label>
                </div>
                <div className="template-switch-grid">
                  <label className="inline-check"><input type="checkbox" checked={form.showFooterContactBar} onChange={(event) => setForm({ ...form, showFooterContactBar: event.currentTarget.checked })} /> Footer contact bar</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showSignature} onChange={(event) => setForm({ ...form, showSignature: event.currentTarget.checked })} /> Signature</label>
                </div>
                <div className="template-asset-list">
                  <div className="template-asset-row">
                    <label>Watermark image path<input readOnly value={form.invoiceWatermarkPath} /></label>
                    <div className="inline-actions">
                      <button className="ghost-button small" onClick={() => pickInvoiceAsset("watermark")}>Browse</button>
                      <button className="ghost-button small" onClick={() => setForm({ ...form, invoiceWatermarkPath: "" })}>Clear</button>
                    </div>
                  </div>
                  <div className="template-asset-row">
                    <label>Signature image path<input readOnly value={form.invoiceSignaturePath} /></label>
                    <div className="inline-actions">
                      <button className="ghost-button small" onClick={() => pickInvoiceAsset("signature")}>Browse</button>
                      <button className="ghost-button small" onClick={() => setForm({ ...form, invoiceSignaturePath: "" })}>Clear</button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeInvoiceTab === "fields" && (
              <section className="template-editor-section">
                <div className="template-section-head">
                  <h3>Fields</h3>
                </div>
                <div className="template-switch-grid">
                  <label className="inline-check"><input type="checkbox" checked={form.showGstin} onChange={(event) => setForm({ ...form, showGstin: event.currentTarget.checked })} /> Business GSTIN</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showBusinessPhone} onChange={(event) => setForm({ ...form, showBusinessPhone: event.currentTarget.checked })} /> Business phone</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showBusinessEmail} onChange={(event) => setForm({ ...form, showBusinessEmail: event.currentTarget.checked })} /> Business email</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showBusinessAddress} onChange={(event) => setForm({ ...form, showBusinessAddress: event.currentTarget.checked })} /> Business address</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showCustomerPhone} onChange={(event) => setForm({ ...form, showCustomerPhone: event.currentTarget.checked })} /> Customer phone</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showCustomerAddress} onChange={(event) => setForm({ ...form, showCustomerAddress: event.currentTarget.checked })} /> Customer address</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showCustomerGstin} onChange={(event) => setForm({ ...form, showCustomerGstin: event.currentTarget.checked })} /> Customer GSTIN</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showVehicleDetails} onChange={(event) => setForm({ ...form, showVehicleDetails: event.currentTarget.checked })} /> Vehicle details</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showInvoiceStatus} onChange={(event) => setForm({ ...form, showInvoiceStatus: event.currentTarget.checked })} /> Invoice status</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showPaymentMode} onChange={(event) => setForm({ ...form, showPaymentMode: event.currentTarget.checked })} /> Payment mode</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showPaidAmount} onChange={(event) => setForm({ ...form, showPaidAmount: event.currentTarget.checked })} /> Paid amount</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showBalanceDue} onChange={(event) => setForm({ ...form, showBalanceDue: event.currentTarget.checked })} /> Balance due</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showItemGstRate} onChange={(event) => setForm({ ...form, showItemGstRate: event.currentTarget.checked })} /> Item GST rate</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showSacCode} onChange={(event) => setForm({ ...form, showSacCode: event.currentTarget.checked })} /> SAC code</label>
                </div>
              </section>
            )}

            {activeInvoiceTab === "payment" && (
              <section className="template-editor-section">
                <div className="template-section-head">
                  <h3>Payment</h3>
                </div>
                <div className="template-switch-grid">
                  <label className="inline-check"><input type="checkbox" checked={form.showPaymentDetails} onChange={(event) => setForm({ ...form, showPaymentDetails: event.currentTarget.checked })} /> Payment details</label>
                  <label className="inline-check"><input type="checkbox" checked={form.showUpiQr} onChange={(event) => setForm({ ...form, showUpiQr: event.currentTarget.checked })} /> UPI QR</label>
                </div>
                <div className="form-grid two">
                  <label>Bank name<input value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.currentTarget.value })} /></label>
                  <label>Account name<input value={form.bankAccountName} onChange={(event) => setForm({ ...form, bankAccountName: event.currentTarget.value })} /></label>
                  <label>Account number<input value={form.bankAccountNumber} onChange={(event) => setForm({ ...form, bankAccountNumber: event.currentTarget.value })} /></label>
                  <label>IFSC<input value={form.bankIfsc} onChange={(event) => setForm({ ...form, bankIfsc: event.currentTarget.value.toUpperCase() })} /></label>
                  <label className="wide-input">UPI ID<input value={form.upiId} onChange={(event) => setForm({ ...form, upiId: event.currentTarget.value })} /></label>
                  <label className="wide-input">Payment instructions<textarea value={form.paymentInstructions} onChange={(event) => setForm({ ...form, paymentInstructions: event.currentTarget.value })} /></label>
                </div>
              </section>
            )}

            {activeInvoiceTab === "text" && (
              <section className="template-editor-section">
                <div className="template-section-head">
                  <h3>Labels & text</h3>
                </div>
                <div className="form-grid three">
                  <label>Invoice number label<input value={form.invoiceNumberLabel} onChange={(event) => setForm({ ...form, invoiceNumberLabel: event.currentTarget.value })} /></label>
                  <label>Date label<input value={form.invoiceDateLabel} onChange={(event) => setForm({ ...form, invoiceDateLabel: event.currentTarget.value })} /></label>
                  <label>Quotation number label<input value={form.quotationNumberLabel} onChange={(event) => setForm({ ...form, quotationNumberLabel: event.currentTarget.value })} /></label>
                  <label>Quotation date label<input value={form.quotationDateLabel} onChange={(event) => setForm({ ...form, quotationDateLabel: event.currentTarget.value })} /></label>
                  <label>Bill-to label<input value={form.billToLabel} onChange={(event) => setForm({ ...form, billToLabel: event.currentTarget.value })} /></label>
                  <label>Vehicle label<input value={form.vehicleDetailsLabel} onChange={(event) => setForm({ ...form, vehicleDetailsLabel: event.currentTarget.value })} /></label>
                  <label>Payment label<input value={form.paymentDetailsLabel} onChange={(event) => setForm({ ...form, paymentDetailsLabel: event.currentTarget.value })} /></label>
                  <label>Bank label<input value={form.bankDetailsLabel} onChange={(event) => setForm({ ...form, bankDetailsLabel: event.currentTarget.value })} /></label>
                  <label>Terms label<input value={form.termsLabel} onChange={(event) => setForm({ ...form, termsLabel: event.currentTarget.value })} /></label>
                  <label>Subtotal label<input value={form.subtotalLabel} onChange={(event) => setForm({ ...form, subtotalLabel: event.currentTarget.value })} /></label>
                  <label>Grand total label<input value={form.grandTotalLabel} onChange={(event) => setForm({ ...form, grandTotalLabel: event.currentTarget.value })} /></label>
                  <label>Paid label<input value={form.paidLabel} onChange={(event) => setForm({ ...form, paidLabel: event.currentTarget.value })} /></label>
                  <label>Balance label<input value={form.balanceDueLabel} onChange={(event) => setForm({ ...form, balanceDueLabel: event.currentTarget.value })} /></label>
                  <label>Signature label<input value={form.signatureLabel} onChange={(event) => setForm({ ...form, signatureLabel: event.currentTarget.value })} /></label>
                  <label className="wide-input inline-check"><input type="checkbox" checked={form.showTerms} onChange={(event) => setForm({ ...form, showTerms: event.currentTarget.checked })} /> Terms</label>
                  <label className="wide-input">Terms<textarea value={form.invoiceTerms} onChange={(event) => setForm({ ...form, invoiceTerms: event.currentTarget.value })} /></label>
                  <label className="wide-input">Invoice note<textarea value={form.invoiceFooterNote} onChange={(event) => setForm({ ...form, invoiceFooterNote: event.currentTarget.value })} /></label>
                </div>
              </section>
            )}

            {activeInvoiceTab === "preview" && (
              <div className="invoice-preview-pane invoice-preview-pane-inline">
                <div className="invoice-preview-heading">
                  <div>
                    <h3>Live preview</h3>
                    <p>{form.invoicePaperSize} print layout</p>
                  </div>
                </div>
                <div className="invoice-preview-frame">
                  <InvoicePreview settings={form} invoice={sampleInvoice} />
                </div>
              </div>
            )}
          </div>

          {activeInvoiceTab !== "preview" && <div className="invoice-preview-pane">
            <div className="invoice-preview-heading">
              <div>
                <h3>Live preview</h3>
                <p>{form.invoicePaperSize} print layout</p>
              </div>
            </div>
            <div className="invoice-preview-frame">
              <InvoicePreview settings={form} invoice={sampleInvoice} />
            </div>
          </div>}
        </div>
      </section>

        )}

        {activeTab === "security" && (
      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Users & roles</h2>
            <p>Create reusable access roles and assign staff to the right workspace permissions.</p>
          </div>
          <button
            className="ghost-button"
            onClick={() => setUserForm({ displayName: "", username: "", role: "staff", accessRoleId: STAFF_OPERATIONS_ROLE_ID, password: "", active: true })}
          >
            New staff user
          </button>
        </div>

        <div className="security-grid">
          <section className="security-list">
            <h3>Accounts</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Username</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.displayName}</td>
                      <td>{user.username}</td>
                      <td>{statusLabel(user.role)}</td>
                      <td>{user.accessRoleName || "-"}</td>
                      <td><span className={`status ${user.active ? "active" : "lost"}`}>{user.active ? "Active" : "Inactive"}</span></td>
                      <td className="actions-cell">
                        <button
                          className="ghost-button small"
                          onClick={() =>
                            setUserForm({
                              id: user.id,
                              displayName: user.displayName,
                              username: user.username,
                              role: user.role,
                              accessRoleId: user.accessRoleId || STAFF_OPERATIONS_ROLE_ID,
                              password: "",
                              active: user.active
                            })
                          }
                        >
                          Edit
                        </button>
                        {user.id !== currentUser.id && user.active && (
                          <button className="ghost-button small" onClick={() => deactivateUser(user)}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="security-editor">
            <h3>{userForm.id ? "Edit account" : "Add account"}</h3>
            <div className="form-stack">
              <label>Name<input value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.currentTarget.value })} /></label>
              <label>Username<input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.currentTarget.value })} /></label>
              <label>Role<select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.currentTarget.value as SaveUserInput["role"], accessRoleId: event.currentTarget.value === "owner" ? OWNER_ACCESS_ROLE_ID : userForm.accessRoleId || STAFF_OPERATIONS_ROLE_ID })}><option value="staff">Staff</option><option value="owner">Owner</option></select></label>
              {userForm.role === "staff" && (
                <label>Access role<select value={userForm.accessRoleId || STAFF_OPERATIONS_ROLE_ID} onChange={(event) => setUserForm({ ...userForm, accessRoleId: event.currentTarget.value })}>
                  {roles.filter((role) => role.active && !role.locked).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select></label>
              )}
              <label>Password / PIN<input type="password" placeholder={userForm.id ? "Leave blank to keep current" : "Required"} value={userForm.password ?? ""} onChange={(event) => setUserForm({ ...userForm, password: event.currentTarget.value })} /></label>
              <label className="inline-check"><input type="checkbox" checked={userForm.active !== false} onChange={(event) => setUserForm({ ...userForm, active: event.currentTarget.checked })} /> Active account</label>
              <button className="primary-action" onClick={saveUser}><Save size={18} /> Save user</button>
            </div>
          </aside>
        </div>

        <div className="role-management-grid">
          <section className="security-list">
            <div className="panel-heading compact">
              <div>
                <h3>Access roles</h3>
                <p>Owner is locked. Staff roles can be edited and assigned to users.</p>
              </div>
              <button className="ghost-button small" onClick={() => setRoleForm({ name: "", description: "", permissions: [], active: true })}>New role</button>
            </div>
            <div className="stack-list">
              {roles.map((role) => (
                <div className="stack-row role-row" key={role.id}>
                  <div>
                    <strong>{role.name}</strong>
                    <span>{role.description || `${role.permissions.length} permissions`}</span>
                    <small>{role.locked ? "Locked system role" : `${role.permissions.length} permissions selected`}</small>
                  </div>
                  <div className="actions-cell">
                    <span className={`status ${role.active ? "active" : "lost"}`}>{role.active ? "Active" : "Inactive"}</span>
                    <button className="ghost-button small" onClick={() => editRole(role)}>Edit</button>
                    {!role.locked && role.active && <button className="ghost-button small" onClick={() => deactivateRole(role)}>Deactivate</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="security-editor role-editor">
            <h3>{roleForm.id ? "Edit role" : "Add role"}</h3>
            <div className="form-stack">
              <label>Role name<input disabled={roleForm.id === OWNER_ACCESS_ROLE_ID} value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.currentTarget.value })} /></label>
              <label>Description<input disabled={roleForm.id === OWNER_ACCESS_ROLE_ID} value={roleForm.description || ""} onChange={(event) => setRoleForm({ ...roleForm, description: event.currentTarget.value })} /></label>
              <label className="inline-check"><input disabled={roleForm.id === OWNER_ACCESS_ROLE_ID} type="checkbox" checked={roleForm.active !== false} onChange={(event) => setRoleForm({ ...roleForm, active: event.currentTarget.checked })} /> Active role</label>
              <div className="permission-groups">
                {PERMISSION_GROUPS.map((group) => (
                  <section className="permission-group" key={group.id}>
                    <h4>{group.label}</h4>
                    <div className="permission-grid">
                      {group.permissions.map((permission) => (
                        <label className="permission-check" key={permission.key}>
                          <input
                            type="checkbox"
                            disabled={roleForm.id === OWNER_ACCESS_ROLE_ID}
                            checked={roleForm.id === OWNER_ACCESS_ROLE_ID || roleForm.permissions.includes(permission.key)}
                            onChange={() => toggleRolePermission(permission.key)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <button className="primary-action" disabled={roleForm.id === OWNER_ACCESS_ROLE_ID} onClick={saveRole}><Save size={18} /> Save role</button>
            </div>
          </aside>
        </div>

        <div className="password-panel">
          <h3>Change your password</h3>
          <div className="form-grid three">
            <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
            <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} /></label>
            <label>Confirm new password<input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.currentTarget.value)} /></label>
            <button className="ghost-button align-bottom" onClick={changeOwnPassword}>Change password</button>
          </div>
        </div>
      </section>
        )}

        {activeTab === "backup" && (
          <>
      <section className="panel">
        <h2>Backup and restore</h2>
        <p className="muted">Backups are saved as one Autocare24 bundle with database, invoice assets, job-card photos, and purchase documents.</p>
        <div className="button-stack">
          <button className="ghost-button" onClick={backup}>Create manual backup</button>
          <button className="ghost-button" onClick={restore}>Restore from backup</button>
        </div>
        <div className="mini-metrics cloud-metrics">
          <div><span>Daily schedule</span><strong>{backupScheduleStatus.scheduledTime}</strong></div>
          <div><span>Next run</span><strong>{formatDateTime(backupScheduleStatus.nextRunAt)}</strong></div>
          <div><span>Last local backup</span><strong>{formatDateTime(backupScheduleStatus.lastLocalBackupAt)}</strong></div>
          <div title={backupScheduleStatus.lastLocalBackupPath}><span>Local file</span><strong>{backupScheduleStatus.lastLocalBackupPath ? fileNameFromPath(backupScheduleStatus.lastLocalBackupPath) : "-"}</strong></div>
          <div><span>Cloud snapshot</span><strong>{backupScheduleStatus.lastCloudSnapshot.included ? "Included" : "Missing"}</strong></div>
          <div><span>Snapshot time</span><strong>{formatDateTime(backupScheduleStatus.lastCloudSnapshot.exportedAt)}</strong></div>
          <div><span>Cloud records</span><strong>{backupScheduleStatus.lastCloudSnapshot.recordCount || "-"}</strong></div>
          <div><span>Cloud invoices</span><strong>{backupScheduleStatus.lastCloudSnapshot.invoiceCount || "-"}</strong></div>
          <div><span>Last Drive upload</span><strong>{formatDateTime(backupScheduleStatus.lastDriveUploadAt)}</strong></div>
          <div><span>Drive file</span><strong>{backupScheduleStatus.lastDriveUploadName || "-"}</strong></div>
        </div>
        {backupScheduleStatus.lastError && <p className="cloud-error">{backupScheduleStatus.lastError}</p>}
      </section>

      <section className="panel wide-panel cloud-panel">
        <div className="panel-heading">
          <div>
            <h2>Network & Cloud</h2>
            <p>Google Drive uses the same full backup bundle as local backup.</p>
          </div>
          <button className="ghost-button" disabled={Boolean(driveBusy)} onClick={() => void Promise.all([refreshDriveStatus(), refreshBackupScheduleStatus()])}><RefreshCw size={17} /> Refresh</button>
        </div>

        <div className="form-grid two">
          <label className="wide-input">Google Drive OAuth Client ID<input value={form.googleDriveClientId} onChange={(event) => setForm({ ...form, googleDriveClientId: event.currentTarget.value })} placeholder="Desktop OAuth client ID" /></label>
          <label className="wide-input">Google Drive OAuth Client Secret<input type="password" value={form.googleDriveClientSecret} onChange={(event) => setForm({ ...form, googleDriveClientSecret: event.currentTarget.value })} placeholder={driveStatus.configured ? "Leave blank to keep the secure local secret" : "Desktop OAuth client secret"} /></label>
          <div className="inline-actions align-bottom">
            <button className="primary-action" disabled={Boolean(driveBusy)} onClick={connectDrive}><Plug size={18} /> {driveBusy === "connect" ? "Connecting..." : "Connect Drive"}</button>
            <button className="ghost-button" disabled={!driveStatus.connected || Boolean(driveBusy)} onClick={testDriveConnection}><Cloud size={18} /> Test</button>
            <button className="ghost-button danger-action" disabled={!driveStatus.connected || Boolean(driveBusy)} onClick={disconnectDrive}>Disconnect</button>
          </div>
        </div>

        <div className="mini-metrics cloud-metrics">
          <div><span>Status</span><strong>{driveStatus.connected ? "Connected" : driveStatus.configured ? "Configured" : "Not set"}</strong></div>
          <div><span>Drive account</span><strong>{driveStatus.accountEmail || "-"}</strong></div>
          <div><span>Folder</span><strong>{driveStatus.folderName || "Autocare24 Backups"}</strong></div>
          <div><span>Last upload</span><strong>{formatDateTime(driveStatus.lastUploadAt)}</strong></div>
          <div><span>Latest file</span><strong>{driveStatus.lastUploadName || "-"}</strong></div>
          <div><span>Cloud backups</span><strong>{driveStatus.backupCount}</strong></div>
        </div>
        {driveStatus.lastError && <p className="cloud-error">{driveStatus.lastError}</p>}

        <div className="cloud-actions">
          <button className="primary-action" disabled={!driveStatus.connected || Boolean(driveBusy)} onClick={backupToDriveNow}><UploadCloud size={18} /> {driveBusy === "backup" ? "Uploading..." : "Back up to Google Drive now"}</button>
          <button className="ghost-button" disabled={!driveStatus.connected || Boolean(driveBusy)} onClick={() => void runDriveAction("list", loadDriveBackups)}>Load cloud backups</button>
          <button className="ghost-button danger-action" disabled={!driveStatus.connected || !selectedDriveBackupId || Boolean(driveBusy)} onClick={restoreDriveBackup}>{driveBusy === "restore" ? "Restoring..." : "Restore selected cloud backup"}</button>
        </div>

        <div className="table-wrap cloud-backup-table">
          <table>
            <thead><tr><th></th><th>Backup file</th><th>Created</th><th>Size</th></tr></thead>
            <tbody>
              {driveBackups.map((backup) => (
                <tr key={backup.id}>
                  <td><input type="radio" checked={selectedDriveBackupId === backup.id} onChange={() => setSelectedDriveBackupId(backup.id)} /></td>
                  <td>{backup.name}</td>
                  <td>{formatDateTime(backup.createdTime)}</td>
                  <td>{formatBytes(backup.sizeBytes)}</td>
                </tr>
              ))}
              {!driveBackups.length && <tr><td colSpan={4}>No cloud backups loaded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
          </>
        )}

        {activeTab === "cloudSync" && (
          <section className="panel wide-panel cloud-sync-panel">
            <div className="panel-heading">
              <div>
                <h2>Cloud Status</h2>
                <p>Business records are loaded from your hosted API. Only invoice drafts stay on this PC.</p>
              </div>
              <button className="ghost-button" disabled={Boolean(syncBusy)} onClick={() => void refreshSyncStatus()}><RefreshCw size={17} /> Refresh</button>
            </div>

            <div className="mini-metrics cloud-metrics">
              <div><span>Status</span><strong>{statusLabel(syncStatus.state)}</strong></div>
              <div><span>Approval</span><strong>{syncStatus.approvalStatus ? statusLabel(syncStatus.approvalStatus) : "-"}</strong></div>
              <div><span>Device</span><strong>{syncStatus.deviceName || syncStatus.deviceCode || "-"}</strong></div>
              <div><span>Pending</span><strong>{syncStatus.pendingCount}</strong></div>
              <div><span>Conflicts</span><strong>{syncStatus.conflictCount}</strong></div>
              <div><span>Last push</span><strong>{formatDateTime(syncStatus.lastPushAt)}</strong></div>
              <div><span>Last pull</span><strong>{formatDateTime(syncStatus.lastPullAt)}</strong></div>
            </div>
            {syncStatus.lastError && <p className="cloud-error">{syncStatus.lastError}</p>}
            {syncStatus.state === "pending_approval" && (
              <div className="cloud-error">
                Waiting for owner approval. This PC cannot read or sync cloud data until an approved owner approves this device.
              </div>
            )}

            <div className="form-grid two">
              <label className="wide-input">Cloud API URL<input value={syncForm.cloudUrl} onChange={(event) => setSyncForm({ ...syncForm, cloudUrl: event.currentTarget.value })} placeholder="https://your-domain.com" /></label>
              <label>Device name<input value={syncForm.deviceName} onChange={(event) => setSyncForm({ ...syncForm, deviceName: event.currentTarget.value })} placeholder="Front desk PC" /></label>
              <label>Registration key<input type="password" value={syncForm.registrationKey} onChange={(event) => setSyncForm({ ...syncForm, registrationKey: event.currentTarget.value })} placeholder="Cloud setup key" /></label>
              <div className="inline-actions align-bottom">
                <button className="primary-action" disabled={Boolean(syncBusy)} onClick={connectSyncDevice}><Plug size={18} /> {syncBusy === "connect" ? "Connecting..." : "Connect device"}</button>
                <button className="ghost-button" disabled={!syncStatus.configured || Boolean(syncBusy)} onClick={checkSyncApproval}><RefreshCw size={18} /> {syncBusy === "approval" ? "Checking..." : "Check approval"}</button>
                <button className="ghost-button" disabled={!syncStatus.connected || Boolean(syncBusy)} onClick={triggerCloudSync}><RefreshCw size={18} /> {syncBusy === "sync" ? "Importing..." : "Import local data"}</button>
                <button className="ghost-button danger-action" disabled={!syncStatus.configured || syncStatus.state === "disconnected" || Boolean(syncBusy)} onClick={disconnectSyncDevice}>Disconnect</button>
              </div>
            </div>

            <div className="cloud-sync-grid">
              <section className="developer-info-card">
                <span>Cloud URL</span>
                <code>{syncStatus.cloudUrl || "Not connected"}</code>
              </section>
              <section className="developer-info-card">
                <span>Device ID</span>
                <code>{syncStatus.deviceId || "-"}</code>
              </section>
            </div>

            <div className="panel-heading compact">
              <div>
                <h3>Cloud Devices</h3>
                <p>Approve new PCs and revoke unknown devices. Owner password is checked by the cloud API and is not saved.</p>
              </div>
              <button className="ghost-button small" disabled={!syncStatus.connected || Boolean(cloudDevicesBusy)} onClick={loadCloudDevices}>Refresh devices</button>
            </div>
            <div className="form-grid three">
              <label>Owner username<input value={cloudDeviceCredentials.ownerUsername} onChange={(event) => setCloudDeviceCredentials({ ...cloudDeviceCredentials, ownerUsername: event.currentTarget.value })} placeholder="owner username" /></label>
              <label>Owner password<input type="password" value={cloudDeviceCredentials.ownerPassword} onChange={(event) => setCloudDeviceCredentials({ ...cloudDeviceCredentials, ownerPassword: event.currentTarget.value })} placeholder="owner password" /></label>
              <div className="inline-actions align-bottom">
                <button className="primary-action" disabled={!syncStatus.connected || Boolean(cloudDevicesBusy)} onClick={loadCloudDevices}>{cloudDevicesBusy === "list" ? "Loading..." : "Load devices"}</button>
              </div>
            </div>
            <div className="table-wrap cloud-device-table">
              <table>
                <thead><tr><th>Device</th><th>Status</th><th>Code</th><th>Created</th><th>Last seen</th><th>IP</th><th>Actions</th></tr></thead>
                <tbody>
                  {cloudDevices.map((device) => (
                    <tr key={device.id}>
                      <td>{device.name || device.id}</td>
                      <td>{statusLabel(device.approvalStatus)}</td>
                      <td>{device.deviceCode || "-"}</td>
                      <td>{formatDateTime(device.createdAt)}</td>
                      <td>{formatDateTime(device.lastSeenAt)}</td>
                      <td>{device.registrationIp || "-"}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="ghost-button small" disabled={device.approvalStatus !== "PENDING" || Boolean(cloudDevicesBusy)} onClick={() => approveCloudDevice(device.id)}>{cloudDevicesBusy === `approve:${device.id}` ? "Approving..." : "Approve"}</button>
                          <button className="ghost-button small danger-action" disabled={device.approvalStatus === "REVOKED" || Boolean(cloudDevicesBusy)} onClick={() => revokeCloudDevice(device.id)}>{cloudDevicesBusy === `revoke:${device.id}` ? "Revoking..." : "Revoke"}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!cloudDevices.length && <tr><td colSpan={7}>Enter owner credentials and load pending or approved cloud devices.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="panel-heading compact">
              <div>
                <h3>Sync Issues</h3>
                <p>Shows plain actions needed when this PC and another PC changed the same record.</p>
              </div>
              <button className="ghost-button small" disabled={Boolean(syncBusy)} onClick={() => void loadSyncConflicts()}>Load issues</button>
            </div>
            <div className="conflict-list">
              {groupedSyncConflicts.map(({ conflict, conflicts, count }) => {
                const diffs = conflictDiffs(conflict);
                return (
                  <article className="conflict-card" key={conflict.conflictId}>
                    <div className="conflict-card-head">
                      <div>
                        <span className="conflict-type">{conflictEntityLabel(conflict.entity)}</span>
                        <h4>{conflictTitle(conflict)}</h4>
                        <div className="conflict-issue">
                          <span>Issue</span>
                          <strong>{conflictIssueTitle(conflict)}</strong>
                        </div>
                        <p>{conflictSummaryText(conflict)}</p>
                        <small>Detected {formatDateTime(conflict.detectedAt)}{count > 1 ? ` - ${count} repeated sync alerts grouped` : ""}</small>
                      </div>
                      <strong className="conflict-badge">Needs decision</strong>
                    </div>

                    <div className="conflict-guidance">
                      <strong>{conflictRecommendation(conflict)}</strong>
                      <span>Keep local uses this PC's copy. Keep cloud uses the server copy already synced from another PC. Manual marks it for owner review.</span>
                    </div>

                    {diffs.length > 0 ? (
                      <div className="conflict-diff-grid">
                        <div className="conflict-diff-heading">Field</div>
                        <div className="conflict-diff-heading">This PC</div>
                        <div className="conflict-diff-heading">Cloud / Other PC</div>
                        {diffs.map((diff) => (
                          <div className="conflict-diff-row" key={diff.key}>
                            <strong>{diff.label}</strong>
                            <span>{diff.local}</span>
                            <span>{diff.cloud}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="conflict-guidance neutral">
                        <span>No important field difference is visible. This usually means the same draft was retried after the cloud already accepted a newer copy.</span>
                      </div>
                    )}

                    <details className="conflict-technical">
                      <summary>Technical details</summary>
                      <div>
                        <code>Record ID: {conflict.localId}</code>
                        <code>This PC: {JSON.stringify(conflict.localVersion).slice(0, 500)}</code>
                        <code>Cloud: {JSON.stringify(conflict.serverVersion).slice(0, 500)}</code>
                      </div>
                    </details>

                    <div className="conflict-actions">
                      <button className="primary-action" onClick={() => resolveSyncConflictGroup(conflicts, "KEEP_SERVER")}>Keep cloud copy</button>
                      <button className="ghost-button" onClick={() => resolveSyncConflictGroup(conflicts, "KEEP_LOCAL")}>Keep this PC copy</button>
                      <button className="ghost-button" onClick={() => resolveSyncConflictGroup(conflicts, "MANUAL")}>Owner review</button>
                    </div>
                  </article>
                );
              })}
              {!groupedSyncConflicts.length && <div className="empty-state">No unresolved sync issues.</div>}
            </div>
          </section>
        )}

        {activeTab === "exports" && (
      <section className="panel">
        <h2>CSV exports</h2>
        <p className="muted">Export operational data for accountant review or spreadsheet checks.</p>
        <div className="button-stack">
          <button className="ghost-button" onClick={() => exportCsv("invoices")}>Export invoices</button>
          <button className="ghost-button" onClick={() => exportCsv("customers")}>Export customers</button>
          <button className="ghost-button" onClick={() => exportCsv("enquiries")}>Export enquiries</button>
          <button className="ghost-button" onClick={() => exportCsv("jobCards")}>Export job cards</button>
          <button className="ghost-button" onClick={() => exportCsv("services")}>Export services</button>
          <button className="ghost-button" onClick={() => exportCsv("inventory")}>Export inventory</button>
        </div>
      </section>
        )}
      </div>
    </div>
  );
}

