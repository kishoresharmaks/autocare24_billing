"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { URL } = require("node:url");
const mysql = require("mysql2/promise");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8080);
const REGISTRATION_KEY = process.env.SYNC_REGISTRATION_KEY || "";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"));
const API_VERSION = "v1";
const envPositiveInt = (name, fallback) => {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
const MAX_BODY_BYTES = envPositiveInt("MAX_BODY_BYTES", 24 * 1024 * 1024);
const AUTH_RATE_LIMIT_WINDOW_MS = envPositiveInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = envPositiveInt("AUTH_RATE_LIMIT_MAX", 10);
const DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS = envPositiveInt("DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const DEVICE_REGISTRATION_RATE_LIMIT_MAX = envPositiveInt("DEVICE_REGISTRATION_RATE_LIMIT_MAX", 10);
const TOKEN_HASH_SECRET = process.env.TOKEN_HASH_SECRET || "";
const TRUSTED_PROXY_IPS = new Set([
  "127.0.0.1",
  "::1",
  ...String(process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
]);
const rateLimitBuckets = new Map();

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains"
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "autocare24_sync",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 6),
  namedPlaceholders: true
});

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
};

const ok = (res, data, status = 200, headers = {}) => json(res, status, { data }, headers);
const error = (res, status, code, message, details) => json(res, status, { error: { code, message, details } });
const errorFromThrown = (res, err) => {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const code = err?.code || (status === 400 ? "invalid_request" : status === 413 ? "request_body_too_large" : status === 429 ? "rate_limited" : "internal_error");
  const message = status >= 500 ? "Unexpected API error." : err?.message || "Request could not be processed.";
  return error(res, status, code, message);
};
const noContent = (res) => {
  res.writeHead(204, SECURITY_HEADERS);
  res.end();
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmacSha256 = (value) => crypto.createHmac("sha256", TOKEN_HASH_SECRET).update(value).digest("hex");
const hashToken = (value) => TOKEN_HASH_SECRET ? hmacSha256(value) : sha256(value);
const tokenHashCandidates = (value) => {
  const primary = hashToken(value);
  const legacy = sha256(value);
  return primary === legacy ? [primary] : [primary, legacy];
};
const token = () => crypto.randomBytes(32).toString("base64url");
const uuid = () => crypto.randomUUID();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const isRecordId = (value) => {
  const text = String(value || "");
  return text.length > 0 && text.length <= 36 && /^[A-Za-z0-9_.:-]+$/.test(text);
};
const parseJsonColumn = (value, fallback = {}) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};
const safeSequencePrefix = (value, fallback) => {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 20);
  return cleaned || fallback;
};
const sequenceSuffix = (value, prefix) => {
  const text = String(value || "");
  const token = `${prefix}-`;
  if (!text.startsWith(token)) return 0;
  const suffix = text.slice(token.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : 0;
};
const money = (value) => Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * 100) / 100;
const nowIso = () => new Date().toISOString();
const localDate = (date = new Date()) => {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
};
const dateOnly = (value) => String(value || "").slice(0, 10);
const ALLOWED_RECORD_ENTITIES = new Set([
  "settings",
  "users",
  "access_roles",
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
]);
const PROTECTED_RECORD_ENTITIES = new Set(["users", "access_roles"]);
const PAYMENT_MODES = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Other"]);
const FILE_TYPES = new Set(["LOGO", "SIGNATURE", "WATERMARK", "PHOTO", "DOCUMENT"]);
const DEVICE_APPROVAL_STATUS = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  REVOKED: "REVOKED"
};
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const QUOTATION_STATUSES = new Set(["draft", "sent", "accepted", "rejected", "expired", "converted"]);
const ENQUIRY_STATUSES = new Set(["new", "contacted", "follow_up", "visited", "converted", "lost"]);
const ENQUIRY_SOURCES = new Set(["Walk-in", "Phone", "WhatsApp", "Instagram", "Google", "Referral", "Other"]);
const JOB_CARD_STATUSES = new Set(["draft", "estimate_pending", "approved", "in_progress", "quality_check", "ready_delivery", "delivered", "billed", "cancelled"]);
const OPEN_JOB_CARD_STATUSES = new Set(["draft", "estimate_pending", "approved", "in_progress", "quality_check", "ready_delivery"]);
const IN_PROGRESS_JOB_CARD_STATUSES = new Set(["approved", "in_progress", "quality_check"]);
const COMPLETED_JOB_CARD_STATUSES = new Set(["delivered", "billed"]);
const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const OWNER_ACCESS_ROLE_ID = "owner";
const STAFF_OPERATIONS_ROLE_ID = "staff-operations";
const ALL_PERMISSION_KEYS = [
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
];
const ALL_PERMISSIONS = [...ALL_PERMISSION_KEYS];
const DEFAULT_ACCESS_ROLES = [
  {
    id: OWNER_ACCESS_ROLE_ID,
    name: "Owner",
    description: "Full access to every workspace, setting, report, backup, and developer tool.",
    permissions: ALL_PERMISSIONS,
    locked: true,
    active: true
  },
  {
    id: STAFF_OPERATIONS_ROLE_ID,
    name: "Staff Operations",
    description: "Preserves the previous staff access for billing, enquiries, services, and stock operations.",
    permissions: [
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
      "documents.printPdf",
      "sharing.whatsapp"
    ],
    locked: false,
    active: true
  },
  {
    id: "billing-staff",
    name: "Billing Staff",
    description: "Counter billing, customers, job cards, print/PDF, and WhatsApp sharing.",
    permissions: [
      "dashboard.view",
      "billing.view",
      "billing.create",
      "billing.recordPayments",
      "quotations.view",
      "quotations.manage",
      "quotations.convert",
      "customers.view",
      "customers.manage",
      "jobCards.view",
      "jobCards.manage",
      "enquiries.view",
      "enquiries.manage",
      "services.view",
      "stock.view",
      "documents.printPdf",
      "sharing.whatsapp"
    ],
    locked: false,
    active: true
  },
  {
    id: "stock-staff",
    name: "Stock Staff",
    description: "Stock viewing, item management, stock purchases, purchase records, adjustments, suppliers, and basic dashboard access.",
    permissions: ["dashboard.view", "stock.view", "stock.manageItems", "stock.purchase", "stock.adjust", "stock.suppliers"],
    locked: false,
    active: true
  }
];

const requiredText = (value, label) => {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(`${label} is required.`), { status: 422 });
  return text;
};
const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const positiveNumber = (value, label) => {
  const number = finiteNumber(value);
  if (number <= 0) throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 422 });
  return number;
};
const nonNegativeNumber = (value, label) => {
  const number = finiteNumber(value);
  if (number < 0) throw Object.assign(new Error(`${label} cannot be negative.`), { status: 422 });
  return number;
};
const normalizePaymentMode = (value) => PAYMENT_MODES.has(String(value || "")) ? String(value) : "UPI";
const normalizeTaxScope = (value) => String(value || "") === "inter" ? "inter" : "intra";
const normalizeInvoiceMode = (value) => String(value || "") === "simple" ? "simple" : "gst";
const normalizeVehicleType = (value) => ["car", "bike", "other"].includes(String(value || "")) ? String(value) : "car";
const normalizeQuotationStatus = (value) => QUOTATION_STATUSES.has(String(value || "")) ? String(value) : "draft";
const normalizeEnquiryStatus = (value) => ENQUIRY_STATUSES.has(String(value || "")) ? String(value) : "new";
const normalizeEnquirySource = (value) => ENQUIRY_SOURCES.has(String(value || "")) ? String(value) : "Other";
const normalizeJobCardStatus = (value) => JOB_CARD_STATUSES.has(String(value || "")) ? String(value) : "draft";
const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
const normalizeDeviceApprovalStatus = (device = {}) => {
  const status = String(device.approval_status || device.approvalStatus || "").toUpperCase();
  if (Object.values(DEVICE_APPROVAL_STATUS).includes(status)) return status;
  return device.is_revoked || device.isRevoked ? DEVICE_APPROVAL_STATUS.REVOKED : DEVICE_APPROVAL_STATUS.APPROVED;
};
const normalizeIp = (value) => String(value || "").trim().replace(/^::ffff:/, "").slice(0, 45);
const isPlausibleIp = (value) => net.isIP(value) > 0;
const firstForwardedIp = (req) => {
  const candidates = [
    String(req.headers["x-forwarded-for"] || "").split(",")[0],
    req.headers["x-real-ip"],
    req.headers["cf-connecting-ip"]
  ];
  for (const candidate of candidates) {
    const ip = normalizeIp(candidate);
    if (ip && isPlausibleIp(ip)) return ip;
  }
  return "";
};
const getRequestIp = (req) => {
  const remote = normalizeIp(req.socket.remoteAddress || "");
  if (remote && TRUSTED_PROXY_IPS.has(remote)) {
    const forwarded = firstForwardedIp(req);
    if (forwarded) return forwarded;
  }
  return remote;
};
const firstReportedDeviceIp = (body) => {
  const candidates = [
    body.reportedIp,
    body.clientIp,
    body.systemIp,
    ...(Array.isArray(body.reportedIps) ? body.reportedIps : [])
  ];
  for (const candidate of candidates) {
    const ip = normalizeIp(candidate);
    if (ip && isPlausibleIp(ip)) return ip;
  }
  return "";
};
const throwHttpError = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};
const rateLimitKey = (scope, req) => `${scope}:${getRequestIp(req) || "unknown"}`;
const enforceRateLimit = (req, scope, options = {}) => {
  const limit = options.limit || AUTH_RATE_LIMIT_MAX;
  const windowMs = options.windowMs || AUTH_RATE_LIMIT_WINDOW_MS;
  const now = Date.now();
  const key = rateLimitKey(scope, req);
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throwHttpError(429, "rate_limited", "Too many attempts. Try again later.");
  }
};
const cleanupRateLimits = () => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
};
setInterval(cleanupRateLimits, 5 * 60 * 1000).unref?.();

function validateFinalInvoicePayload(payload) {
  requiredText(payload.customer?.name || payload.customerName, "Customer name");
  requiredText(payload.vehicle?.registrationNumber || payload.vehicleNumber, "Vehicle number");
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw Object.assign(new Error("Add at least one service item."), { status: 422 });
  const invoiceMode = normalizeInvoiceMode(payload.invoiceMode);
  let subTotal = 0;
  for (const item of items) {
    requiredText(item.description, "Item description");
    const quantity = positiveNumber(item.quantity, "Item quantity");
    const unitPrice = nonNegativeNumber(item.unitPrice, "Item price");
    if (invoiceMode === "gst") nonNegativeNumber(item.gstRate, "GST rate");
    subTotal += quantity * unitPrice;
  }
  const discount = nonNegativeNumber(payload.discount || 0, "Discount");
  if (money(discount) > money(subTotal)) throw Object.assign(new Error("Discount cannot be greater than subtotal."), { status: 422 });
  nonNegativeNumber(payload.paidAmount || 0, "Paid amount");
}
const normalizePermissions = (permissions) => {
  const rows = Array.isArray(permissions) ? permissions : [];
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return Array.from(new Set(rows.filter((permission) => allowed.has(permission))));
};
const validatePassword = (password) => {
  const text = String(password || "");
  if (text.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { status: 422 });
  return text;
};
const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  passwordHash: crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("hex")
});
const verifyPassword = (password, salt, expectedHash) => {
  const actual = Buffer.from(hashPassword(password, salt).passwordHash, "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const stripUserSecrets = (user) => {
  const { passwordHash, salt, ...safeUser } = user || {};
  return safeUser;
};
const paymentStatus = (total, paid) => {
  if (paid >= total) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
};

const toCents = (value) => Math.round(money(value) * 100);
const fromCents = (value) => money(value / 100);
const allocateProportionalCents = (amountCents, weights) => {
  const normalizedAmount = Math.max(0, Math.round(amountCents));
  const totalWeight = weights.reduce((total, weight) => total + Math.max(0, Math.round(weight)), 0);
  if (!normalizedAmount || !totalWeight) return weights.map(() => 0);
  const allocations = weights.map((weight, index) => {
    const normalizedWeight = Math.max(0, Math.round(weight));
    const exact = (normalizedAmount * normalizedWeight) / totalWeight;
    return { index, base: Math.floor(exact), remainder: exact - Math.floor(exact), weight: normalizedWeight };
  });
  let remaining = normalizedAmount - allocations.reduce((total, item) => total + item.base, 0);
  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index)
    .forEach((item) => {
      if (remaining <= 0) return;
      item.base += 1;
      remaining -= 1;
    });
  return allocations.sort((a, b) => a.index - b.index).map((item) => item.base);
};
const calculateInvoiceTotals = (invoiceMode, taxScope, items, rawDiscount) => {
  const normalizedMode = normalizeInvoiceMode(invoiceMode);
  const normalizedTaxScope = normalizeTaxScope(taxScope);
  const normalized = (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    description: String(item.description || "").trim(),
    quantity: money(finiteNumber(item.quantity)),
    unitPrice: money(finiteNumber(item.unitPrice)),
    gstRate: normalizedMode === "gst" ? money(finiteNumber(item.gstRate || 0)) : 0,
    sacCode: String(item.sacCode || "9987").trim() || "9987",
    lineSubTotal: money(finiteNumber(item.quantity) * finiteNumber(item.unitPrice))
  })).filter((item) => item.description || item.serviceId || item.inventoryItemId || item.lineSubTotal > 0);
  if (!normalized.length) throw Object.assign(new Error("Add at least one invoice item."), { status: 422 });
  const subTotal = money(normalized.reduce((sum, item) => sum + item.lineSubTotal, 0));
  const discount = money(Math.min(Math.max(finiteNumber(rawDiscount), 0), subTotal));
  const taxableBase = money(subTotal - discount);
  const taxableLineCents = allocateProportionalCents(
    toCents(taxableBase),
    normalized.map((item) => toCents(item.lineSubTotal))
  );
  const calculatedItems = normalized.map((item, index) => {
    const lineTaxable = fromCents(taxableLineCents[index] || 0);
    const lineTax = normalizedMode === "gst" ? money((lineTaxable * item.gstRate) / 100) : 0;
    return { ...item, lineTax, lineTotal: money(lineTaxable + lineTax) };
  });
  const totalTax = money(calculatedItems.reduce((sum, item) => sum + item.lineTax, 0));
  const cgst = normalizedMode === "gst" && normalizedTaxScope === "intra" ? money(totalTax / 2) : 0;
  const sgst = normalizedMode === "gst" && normalizedTaxScope === "intra" ? money(totalTax - cgst) : 0;
  const igst = normalizedMode === "gst" && normalizedTaxScope === "inter" ? totalTax : 0;
  return {
    items: calculatedItems,
    subTotal,
    discount,
    taxableValue: normalizedMode === "gst" ? taxableBase : 0,
    cgst,
    sgst,
    igst,
    totalTax,
    grandTotal: money(taxableBase + totalTax)
  };
};

async function readBody(req) {
  const rawContentLength = req.headers["content-length"];
  if (rawContentLength !== undefined) {
    const contentLength = Number(rawContentLength);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throwHttpError(400, "invalid_request", "Invalid Content-Length header.");
    }
    if (contentLength > MAX_BODY_BYTES) {
      throwHttpError(413, "request_body_too_large", "Request body is too large.");
    }
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throwHttpError(413, "request_body_too_large", "Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throwHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

const detectUploadSignature = (data) => {
  if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { mimeType: "application/pdf", extensions: new Set([".pdf"]) };
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return { mimeType: "image/png", extensions: new Set([".png"]) };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: "image/jpeg", extensions: new Set([".jpg", ".jpeg"]) };
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extensions: new Set([".webp"]) };
  }
  if (data.length >= 6) {
    const gifHeader = data.subarray(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
      return { mimeType: "image/gif", extensions: new Set([".gif"]) };
    }
  }
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) {
    return { mimeType: "image/bmp", extensions: new Set([".bmp"]) };
  }
  return null;
};

const validateUpload = (fileType, originalName, data) => {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  const allowedExtensions = fileType === "DOCUMENT" ? DOCUMENT_EXTENSIONS : IMAGE_EXTENSIONS;
  const label = fileType === "DOCUMENT" ? "Only PDF and image purchase documents are allowed." : "Only image files are allowed.";
  if (!ext || !allowedExtensions.has(ext)) {
    throwHttpError(422, "validation_error", label);
  }
  if (fileType === "DOCUMENT" && data.length > MAX_DOCUMENT_BYTES) {
    throwHttpError(422, "validation_error", "Purchase document must be 15 MB or smaller.");
  }
  if (fileType !== "DOCUMENT" && data.length > MAX_IMAGE_BYTES) {
    throwHttpError(422, "validation_error", "Image upload must be 10 MB or smaller.");
  }
  const signature = detectUploadSignature(data);
  if (!signature || !signature.extensions.has(ext)) {
    throwHttpError(422, "validation_error", "Uploaded file content does not match an allowed file type.");
  }
  if (fileType !== "DOCUMENT" && signature.mimeType === "application/pdf") {
    throwHttpError(422, "validation_error", "Only image files are allowed.");
  }
  return { ext, mimeType: signature.mimeType };
};

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  if (rows.length) return false;
  await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

async function migrate() {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
  const connection = await pool.getConnection();
  try {
    for (const statement of statements) await connection.query(statement);
    const addedApprovalStatus = await ensureColumn(connection, "devices", "approval_status", "ENUM('APPROVED','PENDING','REVOKED') NOT NULL DEFAULT 'APPROVED'");
    await ensureColumn(connection, "devices", "approval_requested_at", "DATETIME DEFAULT NULL");
    await ensureColumn(connection, "devices", "approved_at", "DATETIME DEFAULT NULL");
    await ensureColumn(connection, "devices", "approved_by_user_id", "VARCHAR(36) DEFAULT NULL");
    await ensureColumn(connection, "devices", "registration_ip", "VARCHAR(45) DEFAULT NULL");
    if (addedApprovalStatus) {
      await connection.query(
        `UPDATE devices
         SET approval_status = CASE WHEN is_revoked THEN 'REVOKED' ELSE 'APPROVED' END`
      );
    } else {
      await connection.query(
        `UPDATE devices
         SET approval_status = CASE WHEN is_revoked THEN 'REVOKED' ELSE 'APPROVED' END
         WHERE approval_status IS NULL OR approval_status = ''`
      );
    }
    await connection.query(
      `UPDATE devices
       SET approval_requested_at = COALESCE(approval_requested_at, created_at)
       WHERE approval_requested_at IS NULL`
    );
    await connection.query(
      `UPDATE devices
       SET approved_at = COALESCE(approved_at, last_seen_at, created_at)
       WHERE approval_status = 'APPROVED' AND approved_at IS NULL`
    );
    await connection.query("UPDATE devices SET is_revoked = FALSE WHERE approval_status = 'PENDING'");
    await connection.query("ALTER TABLE file_metadata MODIFY file_type ENUM('LOGO','SIGNATURE','WATERMARK','PHOTO','DOCUMENT') NOT NULL");
    await connection.query("INSERT IGNORE INTO businesses (id, name) VALUES (1, 'Autocare24')");
    await connection.query("INSERT IGNORE INTO number_sequences (business_id, sequence_key, prefix, last_number) VALUES (1, 'invoice', 'INV', 0), (1, 'quotation', 'QT', 0), (1, 'job_card', 'JC', 0)");
  } finally {
    connection.release();
  }
}

async function authenticate(req, options = {}) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const tokenHash = hashToken(match[1]);
  const candidates = tokenHashCandidates(match[1]);
  const placeholders = candidates.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT * FROM devices WHERE token_hash IN (${placeholders}) LIMIT 1`,
    candidates
  );
  const device = rows[0] || null;
  if (!device) return null;
  if (TOKEN_HASH_SECRET && device.token_hash !== tokenHash) {
    await pool.query("UPDATE devices SET token_hash = ? WHERE id = ?", [tokenHash, device.id]);
    device.token_hash = tokenHash;
  }
  const approvalStatus = normalizeDeviceApprovalStatus(device);
  device.approval_status = approvalStatus;
  const revoked = Boolean(device.is_revoked) || approvalStatus === DEVICE_APPROVAL_STATUS.REVOKED;
  if (revoked) return options.allowPending ? device : null;
  if (!options.allowPending && approvalStatus !== DEVICE_APPROVAL_STATUS.APPROVED) return null;
  if (approvalStatus === DEVICE_APPROVAL_STATUS.APPROVED) {
    await pool.query("UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?", [device.id]);
  }
  return device;
}

async function requireDevice(req, res) {
  const device = await authenticate(req);
  if (!device) {
    error(res, 401, "DEVICE_NOT_APPROVED", "Device token is missing, invalid, pending approval, or revoked.");
    return null;
  }
  return device;
}

async function handleCurrentDeviceDisconnect(req, res) {
  const device = await authenticate(req, { allowPending: true });
  if (!device) return error(res, 401, "DEVICE_NOT_FOUND", "Device token is missing or invalid.");
  const approvalStatus = normalizeDeviceApprovalStatus(device);
  if (Boolean(device.is_revoked) || approvalStatus === DEVICE_APPROVAL_STATUS.REVOKED) {
    await pool.query(
      `UPDATE devices
       SET token_hash = '',
           is_revoked = TRUE,
           approval_status = 'REVOKED'
       WHERE id = ?`,
      [device.id]
    );
    return noContent(res);
  }
  await pool.query(
    `UPDATE devices
     SET token_hash = '',
         is_revoked = FALSE,
         approval_status = 'PENDING',
         approval_requested_at = CURRENT_TIMESTAMP,
         approved_at = NULL,
         approved_by_user_id = NULL
     WHERE id = ?`,
    [device.id]
  );
  return noContent(res);
}

function operationKind(type, existed) {
  if (type === "DELETE") return "DELETE";
  return existed ? "UPDATE" : "INSERT";
}

async function nextNumber(connection, businessId, key, fallbackPrefix) {
  const [rows] = await connection.query(
    "SELECT sequence_key, prefix, last_number FROM number_sequences WHERE business_id = ? AND sequence_key = ? FOR UPDATE",
    [businessId, key]
  );
  if (!rows.length) {
    await connection.query(
      "INSERT INTO number_sequences (business_id, sequence_key, prefix, last_number) VALUES (?, ?, ?, 0)",
      [businessId, key, fallbackPrefix]
    );
    return nextNumber(connection, businessId, key, fallbackPrefix);
  }
  const next = Number(rows[0].last_number || 0) + 1;
  await connection.query(
    "UPDATE number_sequences SET last_number = ? WHERE business_id = ? AND sequence_key = ?",
    [next, businessId, key]
  );
  return `${rows[0].prefix || fallbackPrefix}-${String(next).padStart(5, "0")}`;
}

async function alignNumberSequence(connection, businessId, key, prefix, floor) {
  const safeFloor = Math.max(0, Math.floor(Number(floor) || 0));
  const [rows] = await connection.query(
    "SELECT sequence_key, prefix, last_number FROM number_sequences WHERE business_id = ? AND sequence_key = ? FOR UPDATE",
    [businessId, key]
  );
  if (!rows.length) {
    await connection.query(
      "INSERT INTO number_sequences (business_id, sequence_key, prefix, last_number) VALUES (?, ?, ?, ?)",
      [businessId, key, prefix, safeFloor]
    );
    return;
  }
  const current = Number(rows[0].last_number || 0);
  const currentPrefix = String(rows[0].prefix || "");
  await connection.query(
    "UPDATE number_sequences SET prefix = ?, last_number = ? WHERE business_id = ? AND sequence_key = ?",
    [currentPrefix && currentPrefix !== "INV" ? currentPrefix : prefix, Math.max(current, safeFloor), businessId, key]
  );
}

async function loadBusinessRecords(connection, businessId, entity, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT id AS rowId, record_id AS recordId, data, revision
     FROM business_records
     WHERE business_id = ? AND entity = ? AND deleted_at IS NULL
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [businessId, entity]
  );
  return rows.map((row) => ({
    rowId: row.rowId,
    recordId: row.recordId,
    revision: Number(row.revision || 0),
    data: parseJsonColumn(row.data, {})
  }));
}

async function loadBusinessRecord(connection, businessId, entity, recordId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT id AS rowId, record_id AS recordId, data, revision, deleted_at AS deletedAt
     FROM business_records
     WHERE business_id = ? AND entity = ? AND record_id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [businessId, entity, recordId]
  );
  const row = rows[0] || null;
  if (!row || row.deletedAt) return null;
  return {
    rowId: row.rowId,
    recordId: row.recordId,
    revision: Number(row.revision || 0),
    data: parseJsonColumn(row.data, {})
  };
}

async function insertAuditLog(connection, input) {
  await connection.query(
    `INSERT INTO audit_log (business_id, device_id, user_label, action, entity, entity_id, before_state, after_state, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.businessId || 1,
      input.deviceId || null,
      input.userLabel || null,
      input.action,
      input.entity || null,
      input.entityId || null,
      JSON.stringify(input.beforeState ?? null),
      JSON.stringify(input.afterState ?? null),
      String(input.ipAddress || "").slice(0, 45)
    ]
  );
}

const dateColumnIso = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const publicDeviceFromRow = (row = {}) => ({
  id: String(row.id || ""),
  name: String(row.name || ""),
  deviceCode: String(row.device_code || row.deviceCode || ""),
  approvalStatus: normalizeDeviceApprovalStatus(row),
  approvalRequestedAt: dateColumnIso(row.approval_requested_at),
  approvedAt: dateColumnIso(row.approved_at),
  approvedByUserId: String(row.approved_by_user_id || ""),
  registrationIp: String(row.registration_ip || ""),
  isRevoked: Boolean(row.is_revoked) || normalizeDeviceApprovalStatus(row) === DEVICE_APPROVAL_STATUS.REVOKED,
  lastSeenAt: dateColumnIso(row.last_seen_at),
  createdAt: dateColumnIso(row.created_at)
});

async function persistBusinessRecord(connection, device, req, entity, recordId, data, operation = "UPSERT", actionPrefix = "") {
  if (!ALLOWED_RECORD_ENTITIES.has(entity) || !isRecordId(recordId)) {
    throw Object.assign(new Error("Invalid cloud record."), { status: 422 });
  }
  const [records] = await connection.query(
    "SELECT * FROM business_records WHERE business_id = ? AND entity = ? AND record_id = ? LIMIT 1 FOR UPDATE",
    [device.business_id, entity, recordId]
  );
  const current = records[0] || null;
  const revisionOperation = operation === "DELETE" ? "DELETE" : current ? "UPDATE" : "INSERT";
  const canonicalData = operation === "DELETE"
    ? data
    : await canonicalizeOperation(connection, device.business_id, { entity, data: { ...(data || {}), id: data?.id || recordId } });
  const [revisionResult] = await connection.query(
    `INSERT INTO sync_revisions (business_id, device_id, entity, operation, record_id, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [device.business_id, device.id, entity, revisionOperation, recordId, JSON.stringify(canonicalData)]
  );
  const revision = Number(revisionResult.insertId);
  const deletedAt = operation === "DELETE" ? new Date() : null;
  await connection.query(
    `INSERT INTO business_records (business_id, entity, record_id, data, revision, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), revision = VALUES(revision), deleted_at = VALUES(deleted_at)`,
    [device.business_id, entity, recordId, JSON.stringify(canonicalData), revision, deletedAt]
  );
  await connection.query(
    `INSERT INTO audit_log (business_id, device_id, action, entity, entity_id, before_state, after_state, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      device.business_id,
      device.id,
      actionPrefix || `${entity.toUpperCase()}_${revisionOperation}`,
      entity,
      recordId,
      JSON.stringify(current ? parseJsonColumn(current.data, null) : null),
      JSON.stringify(canonicalData),
      req.socket.remoteAddress || ""
    ]
  );
  return { entity, recordId, revision, data: canonicalData };
}

async function ensureDefaultAccessRoles(connection, device, req) {
  const existing = byId(await loadBusinessRecords(connection, device.business_id, "access_roles"));
  for (const role of DEFAULT_ACCESS_ROLES) {
    const current = existing.get(role.id);
    if (current && role.id !== OWNER_ACCESS_ROLE_ID) continue;
    const nextPermissions = role.id === OWNER_ACCESS_ROLE_ID ? ALL_PERMISSIONS : normalizePermissions(role.permissions);
    if (
      current &&
      current.name === role.name &&
      current.description === role.description &&
      current.locked === role.locked &&
      current.active !== false &&
      JSON.stringify(normalizePermissions(current.permissions)) === JSON.stringify(nextPermissions)
    ) {
      continue;
    }
    const data = {
      ...(current || {}),
      ...role,
      permissions: nextPermissions,
      active: role.active !== false,
      locked: role.locked === true,
      createdAt: current?.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    if (!current || role.id === OWNER_ACCESS_ROLE_ID) {
      await persistBusinessRecord(connection, device, req, "access_roles", role.id, data, "UPSERT", "ACCESS_ROLE_SEEDED");
    }
  }
}

const mapCloudAccessRole = (role = {}) => ({
  id: String(role.id || ""),
  name: String(role.name || ""),
  description: String(role.description || ""),
  permissions: normalizePermissions(role.permissions),
  locked: role.locked === true,
  active: role.active !== false,
  createdAt: String(role.createdAt || ""),
  updatedAt: String(role.updatedAt || "")
});

async function listCloudAccessRoles(connection, businessId) {
  const rows = await loadBusinessRecords(connection, businessId, "access_roles");
  return rows
    .map((row) => mapCloudAccessRole(row.data))
    .sort((a, b) => Number(b.locked) - Number(a.locked) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

const publicUserFromData = (user, roleMap) => {
  const role = String(user.role || "") === "owner" ? "owner" : "staff";
  const accessRoleId = role === "owner" ? OWNER_ACCESS_ROLE_ID : String(user.accessRoleId || STAFF_OPERATIONS_ROLE_ID);
  const accessRole = roleMap.get(accessRoleId) || null;
  const permissions = role === "owner" ? ALL_PERMISSIONS : accessRole?.active ? accessRole.permissions : [];
  return {
    id: String(user.id || ""),
    displayName: String(user.displayName || ""),
    username: normalizeUsername(user.username),
    role,
    accessRoleId,
    accessRoleName: role === "owner" ? "Owner" : accessRole?.name || "Staff Operations",
    permissions,
    active: user.active !== false,
    createdAt: String(user.createdAt || ""),
    updatedAt: String(user.updatedAt || "")
  };
};

async function listCloudUsers(connection, businessId) {
  const [users, roles] = await Promise.all([
    loadBusinessRecords(connection, businessId, "users"),
    listCloudAccessRoles(connection, businessId)
  ]);
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  return users
    .map((row) => publicUserFromData(row.data, roleMap))
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.displayName.localeCompare(b.displayName));
}

async function resolveCloudAccessRole(connection, businessId, role, requestedRoleId) {
  if (role === "owner") return OWNER_ACCESS_ROLE_ID;
  const accessRoleId = String(requestedRoleId || STAFF_OPERATIONS_ROLE_ID);
  if (accessRoleId === OWNER_ACCESS_ROLE_ID) throw Object.assign(new Error("Staff users cannot be assigned the owner role."), { status: 422 });
  const accessRole = await loadBusinessRecord(connection, businessId, "access_roles", accessRoleId);
  if (!accessRole || accessRole.data.active === false) throw Object.assign(new Error("Select an active access role for this staff user."), { status: 422 });
  return accessRoleId;
}

const rowList = (rows) => rows.map((row) => row.data);
const byId = (rows) => new Map(rows.map((row) => [row.recordId, row.data]));

async function cloudInvoiceSequenceFloor(connection, businessId, prefix) {
  const records = await loadBusinessRecords(connection, businessId, "invoices");
  return records.reduce((max, row) => Math.max(max, sequenceSuffix(row.data.invoiceNumber, prefix)), 0);
}

const addStockRequirement = (requirements, itemId, quantity, movementType = "sale") => {
  const safeItemId = String(itemId || "");
  const safeQuantity = money(quantity);
  if (!safeItemId || safeQuantity <= 0) return;
  const safeMovementType = movementType === "usage" ? "usage" : "sale";
  const current = requirements.get(safeItemId) || { itemId: safeItemId, quantity: 0, parts: [] };
  const currentPart = current.parts.find((part) => part.type === safeMovementType);
  if (currentPart) {
    currentPart.quantity = money(currentPart.quantity + safeQuantity);
  } else {
    current.parts.push({ type: safeMovementType, quantity: safeQuantity });
  }
  current.quantity = money(current.quantity + safeQuantity);
  requirements.set(safeItemId, current);
};

async function collectStockRequirements(connection, businessId, payload) {
  const requirements = new Map();
  const items = Array.isArray(payload.items) ? payload.items : [];
  items.forEach((item) => addStockRequirement(requirements, item.inventoryItemId, Number(item.quantity || 0), "sale"));

  const serviceItems = items.filter((item) => item.serviceId);
  if (serviceItems.length) {
    const consumables = await loadBusinessRecords(connection, businessId, "service_consumables");
    serviceItems.forEach((item) => {
      const itemQuantity = Number(item.quantity || 0);
      consumables
        .filter((row) => String(row.data.serviceId || "") === String(item.serviceId || ""))
        .forEach((row) => addStockRequirement(requirements, row.data.inventoryItemId, Number(row.data.quantity || 0) * itemQuantity, "usage"));
    });
  }
  return requirements;
}

async function validateAndReserveStock(connection, device, payload, req) {
  const requirements = await collectStockRequirements(connection, device.business_id, payload);
  if (!requirements.size) return;

  const inventoryItems = await loadBusinessRecords(connection, device.business_id, "inventory_items");
  const itemMeta = new Map(inventoryItems.map((row) => [row.recordId, row.data]));
  const batches = await loadBusinessRecords(connection, device.business_id, "inventory_batches", true);
  const plannedUpdates = [];

  for (const requirement of requirements.values()) {
    const itemId = requirement.itemId;
    const requiredQuantity = requirement.quantity;
    const itemBatches = batches
      .filter((row) => String(row.data.itemId || "") === itemId && money(row.data.quantityRemaining) > 0)
      .sort((a, b) => {
        const expiryA = String(a.data.expiryDate || "9999-12-31");
        const expiryB = String(b.data.expiryDate || "9999-12-31");
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
        const purchaseA = String(a.data.purchaseDate || "");
        const purchaseB = String(b.data.purchaseDate || "");
        if (purchaseA !== purchaseB) return purchaseA.localeCompare(purchaseB);
        return String(a.data.createdAt || "").localeCompare(String(b.data.createdAt || ""));
      });
    const available = money(itemBatches.reduce((sum, row) => sum + money(row.data.quantityRemaining), 0));
    if (available < requiredQuantity) {
      const item = itemMeta.get(itemId) || {};
      const name = item.name || itemId;
      const unit = item.unit || "unit";
      throw Object.assign(new Error(`Stock not available for ${name}. Available: ${available} ${unit}, requested: ${requiredQuantity} ${unit}.`), {
        status: 422
      });
    }

    let remaining = requiredQuantity;
    for (const batch of itemBatches) {
      if (remaining <= 0) break;
      const used = money(Math.min(money(batch.data.quantityRemaining), remaining));
      remaining = money(remaining - used);
      const nextData = { ...batch.data, quantityRemaining: money(money(batch.data.quantityRemaining) - used) };
      plannedUpdates.push({ batch, nextData });
    }
  }

  for (const update of plannedUpdates) {
    const [revisionResult] = await connection.query(
      `INSERT INTO sync_revisions (business_id, device_id, entity, operation, record_id, payload)
       VALUES (?, ?, 'inventory_batches', 'UPDATE', ?, ?)`,
      [device.business_id, device.id, update.batch.recordId, JSON.stringify(update.nextData)]
    );
    const revision = Number(revisionResult.insertId);
    await connection.query(
      "UPDATE business_records SET data = ?, revision = ? WHERE id = ?",
      [JSON.stringify(update.nextData), revision, update.batch.rowId]
    );
    await connection.query(
      `INSERT INTO audit_log (business_id, device_id, action, entity, entity_id, before_state, after_state, ip_address)
       VALUES (?, ?, 'STOCK_RESERVED_FOR_INVOICE', 'inventory_batches', ?, ?, ?, ?)`,
      [
        device.business_id,
        device.id,
        update.batch.recordId,
        JSON.stringify(update.batch.data),
        JSON.stringify(update.nextData),
        req.socket.remoteAddress || ""
      ]
    );
  }
}

async function reserveStockForReference(connection, device, payload, req, reference, movementDate, notes = "Invoice stock deduction") {
  const requirements = await collectStockRequirements(connection, device.business_id, payload);
  if (!requirements.size) return [];

  const inventoryItems = await loadBusinessRecords(connection, device.business_id, "inventory_items");
  const itemMeta = new Map(inventoryItems.map((row) => [row.recordId, row.data]));
  const batches = await loadBusinessRecords(connection, device.business_id, "inventory_batches", true);
  const plannedBatchUpdates = new Map();
  const plannedMovements = [];

  for (const requirement of requirements.values()) {
    const itemId = requirement.itemId;
    const requiredQuantity = requirement.quantity;
    const itemBatches = batches
      .filter((row) => String(row.data.itemId || "") === itemId && money(row.data.quantityRemaining) > 0)
      .map((row) => ({ ...row, workingQuantity: money(row.data.quantityRemaining) }))
      .sort((a, b) => {
        const expiryA = String(a.data.expiryDate || "9999-12-31");
        const expiryB = String(b.data.expiryDate || "9999-12-31");
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
        const purchaseA = String(a.data.purchaseDate || "");
        const purchaseB = String(b.data.purchaseDate || "");
        if (purchaseA !== purchaseB) return purchaseA.localeCompare(purchaseB);
        return String(a.data.createdAt || "").localeCompare(String(b.data.createdAt || ""));
      });
    const available = money(itemBatches.reduce((sum, row) => sum + money(row.data.quantityRemaining), 0));
    if (available < requiredQuantity) {
      const item = itemMeta.get(itemId) || {};
      const name = item.name || itemId;
      const unit = item.unit || "unit";
      throw Object.assign(new Error(`Stock not available for ${name}. Available: ${available} ${unit}, requested: ${requiredQuantity} ${unit}.`), {
        status: 422
      });
    }

    const item = itemMeta.get(itemId) || {};
    for (const part of requirement.parts) {
      let remaining = money(part.quantity);
      for (const batch of itemBatches) {
        if (remaining <= 0) break;
        if (money(batch.workingQuantity) <= 0) continue;
        const used = money(Math.min(money(batch.workingQuantity), remaining));
        remaining = money(remaining - used);
        batch.workingQuantity = money(money(batch.workingQuantity) - used);
        const nextData = { ...batch.data, quantityRemaining: batch.workingQuantity };
        plannedBatchUpdates.set(batch.recordId, { batch, nextData });
        plannedMovements.push({
          id: uuid(),
          itemId,
          itemName: item.name || itemId,
          itemType: item.type === "retail" ? "retail" : "consumable",
          itemUnit: item.unit || "unit",
          batchId: batch.recordId,
          type: part.type,
          quantity: used,
          unitCost: money(batch.data.unitCost),
          reference,
          notes,
          movementDate: movementDate || localDate(),
          createdAt: nowIso()
        });
      }
    }
  }

  const movements = [];
  for (const update of plannedBatchUpdates.values()) {
    await persistBusinessRecord(connection, device, req, "inventory_batches", update.batch.recordId, update.nextData, "UPSERT", "STOCK_RESERVED_FOR_INVOICE");
  }
  for (const plannedMovement of plannedMovements) {
    const movement = await persistBusinessRecord(connection, device, req, "inventory_movements", plannedMovement.id, plannedMovement, "UPSERT", "INVENTORY_MOVEMENT_INSERT");
    movements.push(movement.data);
  }
  return movements;
}

async function reverseStockForCancelledInvoice(connection, device, req, invoice) {
  const invoiceNumber = String(invoice.invoiceNumber || "");
  if (!invoiceNumber) return [];

  const movements = (await loadBusinessRecords(connection, device.business_id, "inventory_movements", true))
    .filter((row) => String(row.data.reference || "") === invoiceNumber && ["sale", "usage"].includes(String(row.data.type || "")))
    .sort((a, b) => String(a.data.createdAt || "").localeCompare(String(b.data.createdAt || "")));
  const reversals = [];

  for (const movementRow of movements) {
    const movement = movementRow.data;
    const batchId = String(movement.batchId || "");
    const itemId = String(movement.itemId || "");
    const quantity = money(movement.quantity);
    if (!batchId || !itemId || quantity <= 0) continue;

    const batchRecord = await loadBusinessRecord(connection, device.business_id, "inventory_batches", batchId, true);
    if (!batchRecord) {
      throw Object.assign(new Error(`Cannot restore stock for invoice ${invoiceNumber}. Stock batch ${batchId} is missing.`), { status: 422 });
    }

    const nextBatch = {
      ...batchRecord.data,
      quantityRemaining: money(money(batchRecord.data.quantityRemaining) + quantity)
    };
    await persistBusinessRecord(connection, device, req, "inventory_batches", batchId, nextBatch, "UPSERT", "STOCK_RESTORED_FOR_CANCELLED_INVOICE");

    const reversal = {
      id: uuid(),
      itemId,
      itemName: String(movement.itemName || ""),
      itemType: String(movement.itemType || ""),
      itemUnit: String(movement.itemUnit || ""),
      batchId,
      type: "invoice_cancel_reversal",
      quantity,
      unitCost: money(movement.unitCost),
      reference: invoiceNumber,
      notes: `Stock reversal for cancelled invoice ${invoiceNumber}`,
      movementDate: localDate(),
      createdAt: nowIso()
    };
    await persistBusinessRecord(connection, device, req, "inventory_movements", reversal.id, reversal, "UPSERT", "INVENTORY_CANCEL_REVERSAL_INSERT");
    reversals.push(reversal);
  }

  return reversals;
}

async function buildInventorySnapshot(connection, businessId) {
  const items = rowList(await loadBusinessRecords(connection, businessId, "inventory_items"));
  const batches = rowList(await loadBusinessRecords(connection, businessId, "inventory_batches"));
  const movements = rowList(await loadBusinessRecords(connection, businessId, "inventory_movements"));
  const enrichedItems = items.map((item) => {
    const itemBatches = batches.filter((batch) => String(batch.itemId || "") === String(item.id || ""));
    const currentQuantity = money(itemBatches.reduce((sum, batch) => sum + money(batch.quantityRemaining), 0));
    const stockValue = money(itemBatches.reduce((sum, batch) => sum + money(batch.quantityRemaining) * money(batch.unitCost), 0));
    return { ...item, currentQuantity, stockValue, active: item.active !== false };
  }).sort((a, b) => Number(b.active) - Number(a.active) || String(a.name || "").localeCompare(String(b.name || "")));
  const itemMap = new Map(enrichedItems.map((item) => [String(item.id || ""), item]));
  const enrichedBatches = batches.map((batch) => {
    const item = itemMap.get(String(batch.itemId || "")) || {};
    return { ...batch, itemName: item.name || "", unit: item.unit || "" };
  });
  const enrichedMovements = movements.map((movement) => {
    const item = itemMap.get(String(movement.itemId || "")) || {};
    return {
      ...movement,
      itemName: movement.itemName || item.name || "",
      itemType: movement.itemType || item.type || "consumable",
      itemUnit: movement.itemUnit || item.unit || ""
    };
  }).sort((a, b) => String(b.movementDate || "").localeCompare(String(a.movementDate || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const expiryLimit = new Date();
  expiryLimit.setDate(expiryLimit.getDate() + 30);
  const expiryCutoff = localDate(expiryLimit);
  const lowStockItems = enrichedItems.filter((item) => item.active !== false && money(item.lowStockLevel) > 0 && money(item.currentQuantity) <= money(item.lowStockLevel));
  const expiringBatches = enrichedBatches.filter((batch) => money(batch.quantityRemaining) > 0 && batch.expiryDate && String(batch.expiryDate) <= expiryCutoff);
  return {
    totalStockValue: money(enrichedItems.reduce((sum, item) => sum + money(item.stockValue), 0)),
    lowStockCount: lowStockItems.length,
    expiringCount: expiringBatches.length,
    retailCount: enrichedItems.filter((item) => item.type === "retail" && item.active !== false).length,
    items: enrichedItems,
    lowStockItems,
    expiringBatches,
    recentMovements: enrichedMovements.slice(0, 20),
    batches: enrichedBatches,
    movements: enrichedMovements
  };
}

async function buildInvoiceDetail(connection, businessId, invoiceId) {
  const invoice = await loadBusinessRecord(connection, businessId, "invoices", invoiceId);
  if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
  const customer = invoice.data.customer || (await loadBusinessRecord(connection, businessId, "customers", invoice.data.customerId))?.data || {};
  const vehicle = invoice.data.vehicle || (await loadBusinessRecord(connection, businessId, "vehicles", invoice.data.vehicleId))?.data || {};
  const items = rowList(await loadBusinessRecords(connection, businessId, "invoice_items"))
    .filter((item) => String(item.invoiceId || "") === invoiceId);
  const payments = rowList(await loadBusinessRecords(connection, businessId, "payments"))
    .filter((payment) => String(payment.invoiceId || "") === invoiceId)
    .sort((a, b) => String(a.paymentDate || "").localeCompare(String(b.paymentDate || "")));
  return { ...invoice.data, customer, vehicle, items, payments };
}

async function buildQuotationDetail(connection, businessId, quotationId) {
  const quotation = await loadBusinessRecord(connection, businessId, "quotations", quotationId);
  if (!quotation) throw Object.assign(new Error("Quotation not found."), { status: 404 });
  const customer = (await loadBusinessRecord(connection, businessId, "customers", quotation.data.customerId))?.data || {
    id: quotation.data.customerId,
    name: quotation.data.customerName || "",
    phone: quotation.data.customerPhone || "",
    email: quotation.data.customerEmail || "",
    gstin: quotation.data.customerGstin || "",
    address: quotation.data.customerAddress || "",
    createdAt: quotation.data.createdAt || nowIso()
  };
  const vehicle = (await loadBusinessRecord(connection, businessId, "vehicles", quotation.data.vehicleId))?.data || {
    id: quotation.data.vehicleId,
    customerId: quotation.data.customerId,
    registrationNumber: quotation.data.vehicleNumber || "",
    vehicleType: quotation.data.vehicleType || "car",
    make: quotation.data.vehicleMake || "",
    model: quotation.data.vehicleModel || "",
    color: quotation.data.vehicleColor || "",
    createdAt: quotation.data.createdAt || nowIso()
  };
  const items = rowList(await loadBusinessRecords(connection, businessId, "quotation_items"))
    .filter((item) => String(item.quotationId || "") === quotationId);
  return { ...quotation.data, customer, vehicle, items };
}

async function buildJobCardDetail(connection, businessId, jobCardId) {
  const job = await loadBusinessRecord(connection, businessId, "job_cards", jobCardId);
  if (!job) throw Object.assign(new Error("Job card not found."), { status: 404 });
  const customer = (await loadBusinessRecord(connection, businessId, "customers", job.data.customerId))?.data || {
    id: job.data.customerId,
    name: job.data.customerName || ""
  };
  const vehicle = (await loadBusinessRecord(connection, businessId, "vehicles", job.data.vehicleId))?.data || {
    id: job.data.vehicleId,
    customerId: job.data.customerId,
    registrationNumber: job.data.vehicleNumber || "",
    vehicleType: job.data.vehicleType || "car"
  };
  const items = rowList(await loadBusinessRecords(connection, businessId, "job_card_items"))
    .filter((item) => String(item.jobCardId || "") === jobCardId);
  const checklist = rowList(await loadBusinessRecords(connection, businessId, "job_card_checklist_items"))
    .filter((item) => String(item.jobCardId || "") === jobCardId);
  const photos = rowList(await loadBusinessRecords(connection, businessId, "job_card_photos"))
    .filter((photo) => String(photo.jobCardId || "") === jobCardId);
  const history = rowList(await loadBusinessRecords(connection, businessId, "job_card_status_history"))
    .filter((item) => String(item.jobCardId || "") === jobCardId);
  return { ...job.data, customer, vehicle, items, checklist, photos, history };
}

async function listInvoiceSummaries(connection, businessId, query = "", limit = 300) {
  const q = String(query || "").trim().toLowerCase();
  const invoices = rowList(await loadBusinessRecords(connection, businessId, "invoices"))
    .map((invoice) => ({
      ...invoice,
      customerName: invoice.customerName || invoice.customer?.name || "",
      customerPhone: invoice.customerPhone || invoice.customer?.phone || "",
      vehicleNumber: invoice.vehicleNumber || invoice.vehicle?.registrationNumber || "",
      vehicleType: normalizeVehicleType(invoice.vehicleType || invoice.vehicle?.vehicleType)
    }))
    .filter((invoice) => {
      if (!q) return true;
      return [invoice.invoiceNumber, invoice.customerName, invoice.customerPhone, invoice.vehicleNumber, invoice.vehicleType]
        .some((value) => String(value || "").toLowerCase().includes(q));
    })
    .sort((a, b) => String(b.invoiceDate || "").localeCompare(String(a.invoiceDate || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return limit > 0 ? invoices.slice(0, limit) : invoices;
}

const recentRecordDate = (record = {}) => String(record.updatedAt || record.createdAt || record.jobDate || record.invoiceDate || "");
const sortRecentRecords = (a, b) => recentRecordDate(b).localeCompare(recentRecordDate(a));

const mapCloudEnquiry = (enquiry = {}) => ({
  id: String(enquiry.id || ""),
  status: normalizeEnquiryStatus(enquiry.status),
  source: normalizeEnquirySource(enquiry.source),
  customerName: String(enquiry.customerName || ""),
  phone: String(enquiry.phone || ""),
  email: String(enquiry.email || ""),
  address: String(enquiry.address || ""),
  vehicleType: normalizeVehicleType(enquiry.vehicleType),
  vehicleNumber: String(enquiry.vehicleNumber || ""),
  vehicleMake: String(enquiry.vehicleMake || ""),
  vehicleModel: String(enquiry.vehicleModel || ""),
  vehicleColor: String(enquiry.vehicleColor || ""),
  interestedService: String(enquiry.interestedService || ""),
  expectedBudget: money(enquiry.expectedBudget),
  preferredVisitDate: String(enquiry.preferredVisitDate || ""),
  followUpDate: String(enquiry.followUpDate || ""),
  notes: String(enquiry.notes || ""),
  lostReason: String(enquiry.lostReason || ""),
  customerId: String(enquiry.customerId || ""),
  vehicleId: String(enquiry.vehicleId || ""),
  convertedAt: String(enquiry.convertedAt || ""),
  createdAt: String(enquiry.createdAt || ""),
  updatedAt: String(enquiry.updatedAt || "")
});

const mapCloudJobCardSummary = (job = {}) => ({
  id: String(job.id || ""),
  jobNumber: String(job.jobNumber || ""),
  status: normalizeJobCardStatus(job.status),
  jobDate: String(job.jobDate || ""),
  expectedDeliveryDate: String(job.expectedDeliveryDate || ""),
  expectedDeliveryTime: String(job.expectedDeliveryTime || ""),
  actualDeliveryDate: String(job.actualDeliveryDate || ""),
  actualDeliveryTime: String(job.actualDeliveryTime || ""),
  customerId: String(job.customerId || ""),
  vehicleId: String(job.vehicleId || ""),
  invoiceId: String(job.invoiceId || ""),
  customerName: String(job.customerName || job.customer?.name || ""),
  customerPhone: String(job.customerPhone || job.customer?.phone || ""),
  vehicleType: normalizeVehicleType(job.vehicleType || job.vehicle?.vehicleType),
  vehicleNumber: String(job.vehicleNumber || job.vehicle?.registrationNumber || ""),
  odometer: String(job.odometer || ""),
  fuelLevel: String(job.fuelLevel || ""),
  keyReceived: job.keyReceived === true || job.keyReceived === 1,
  belongingsNote: String(job.belongingsNote || ""),
  approvalName: String(job.approvalName || ""),
  approvalDate: String(job.approvalDate || ""),
  approvalNotes: String(job.approvalNotes || ""),
  workNotes: String(job.workNotes || ""),
  internalNotes: String(job.internalNotes || ""),
  deliveryNotes: String(job.deliveryNotes || ""),
  subTotal: money(job.subTotal),
  discount: money(job.discount),
  taxableValue: money(job.taxableValue),
  totalTax: money(job.totalTax),
  grandTotal: money(job.grandTotal),
  createdAt: String(job.createdAt || ""),
  updatedAt: String(job.updatedAt || "")
});

async function listCloudEnquiries(connection, businessId) {
  return rowList(await loadBusinessRecords(connection, businessId, "enquiries"))
    .map(mapCloudEnquiry)
    .sort(sortRecentRecords);
}

async function listCloudJobCards(connection, businessId) {
  return rowList(await loadBusinessRecords(connection, businessId, "job_cards"))
    .map(mapCloudJobCardSummary)
    .sort((a, b) => String(b.jobDate || "").localeCompare(String(a.jobDate || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function buildTopServices(connection, businessId, invoices) {
  const activeInvoiceIds = new Set(
    invoices
      .filter((invoice) => invoice.invoiceStatus !== "cancelled")
      .map((invoice) => String(invoice.id || ""))
  );
  if (!activeInvoiceIds.size) return [];

  const totals = new Map();
  const items = rowList(await loadBusinessRecords(connection, businessId, "invoice_items"));
  items.forEach((item) => {
    if (!activeInvoiceIds.has(String(item.invoiceId || ""))) return;
    const name = String(item.description || "").trim() || "Unnamed service";
    const current = totals.get(name) || { name, quantity: 0, revenue: 0 };
    const quantity = money(item.quantity);
    const revenue = money(item.lineTotal === undefined || item.lineTotal === null ? finiteNumber(item.quantity) * finiteNumber(item.unitPrice) : item.lineTotal);
    current.quantity = money(current.quantity + quantity);
    current.revenue = money(current.revenue + revenue);
    totals.set(name, current);
  });

  return [...totals.values()]
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 6);
}

async function buildEnquiryDashboard(connection, businessId) {
  const today = localDate();
  const enquiries = await listCloudEnquiries(connection, businessId);
  const open = enquiries.filter((enquiry) => !["converted", "lost"].includes(enquiry.status));
  const dueToday = open.filter((enquiry) => enquiry.followUpDate === today);
  const overdue = open.filter((enquiry) => enquiry.followUpDate && enquiry.followUpDate < today);
  return {
    todayFollowups: dueToday.length,
    overdueFollowups: overdue.length,
    newEnquiries: enquiries.filter((enquiry) => enquiry.status === "new").length,
    convertedEnquiries: enquiries.filter((enquiry) => enquiry.status === "converted").length,
    dueToday: dueToday.slice(0, 8),
    overdue: overdue.slice(0, 8),
    recentOpen: open.slice(0, 8)
  };
}

async function buildJobCardDashboard(connection, businessId) {
  const today = localDate();
  const jobs = await listCloudJobCards(connection, businessId);
  const open = jobs.filter((job) => OPEN_JOB_CARD_STATUSES.has(job.status));
  return {
    todayJobs: jobs.filter((job) => job.jobDate === today).length,
    openJobs: open.length,
    approvalPending: jobs.filter((job) => job.status === "estimate_pending").length,
    inProgress: jobs.filter((job) => IN_PROGRESS_JOB_CARD_STATUSES.has(job.status)).length,
    readyDelivery: jobs.filter((job) => job.status === "ready_delivery").length,
    completedToday: jobs.filter((job) => job.actualDeliveryDate === today && COMPLETED_JOB_CARD_STATUSES.has(job.status)).length,
    recentOpen: open.slice(0, 8)
  };
}

function buildSalesTrend(invoices, payments) {
  const rows = new Map();
  const ensure = (date) => {
    const key = dateOnly(date);
    if (!key) return null;
    if (!rows.has(key)) rows.set(key, { date: key, label: key.slice(5), billedValue: 0, paidAmount: 0, balanceDue: 0 });
    return rows.get(key);
  };
  invoices
    .filter((invoice) => invoice.invoiceStatus !== "cancelled")
    .forEach((invoice) => {
      const row = ensure(invoice.invoiceDate);
      if (!row) return;
      row.billedValue = money(row.billedValue + money(invoice.grandTotal));
      row.balanceDue = money(row.balanceDue + money(invoice.balanceDue));
    });
  payments.forEach((payment) => {
    const row = ensure(payment.paymentDate);
    if (!row) return;
    row.paidAmount = money(row.paidAmount + money(payment.amount));
  });
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function buildEnquiryReport(connection, businessId, range) {
  const enquiries = (await listCloudEnquiries(connection, businessId)).filter((enquiry) => inDateRange(dateOnly(enquiry.createdAt), range));
  const byStatus = new Map();
  const bySource = new Map();
  enquiries.forEach((enquiry) => {
    byStatus.set(enquiry.status, (byStatus.get(enquiry.status) || 0) + 1);
    bySource.set(enquiry.source, (bySource.get(enquiry.source) || 0) + 1);
  });
  return {
    total: enquiries.length,
    converted: enquiries.filter((enquiry) => enquiry.status === "converted").length,
    lost: enquiries.filter((enquiry) => enquiry.status === "lost").length,
    open: enquiries.filter((enquiry) => !["converted", "lost"].includes(enquiry.status)).length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
  };
}

async function buildJobCardReport(connection, businessId, range, activeInvoices) {
  const jobs = (await listCloudJobCards(connection, businessId)).filter((job) => inDateRange(job.jobDate, range));
  const byStatus = new Map();
  jobs.forEach((job) => byStatus.set(job.status, (byStatus.get(job.status) || 0) + 1));
  const completed = jobs.filter((job) => COMPLETED_JOB_CARD_STATUSES.has(job.status));
  const turnaroundDays = completed
    .filter((job) => job.actualDeliveryDate && job.jobDate)
    .map((job) => {
      const start = new Date(`${job.jobDate}T00:00:00`).getTime();
      const end = new Date(`${job.actualDeliveryDate}T00:00:00`).getTime();
      return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : -1;
    })
    .filter((value) => value >= 0);

  return {
    total: jobs.length,
    open: jobs.filter((job) => OPEN_JOB_CARD_STATUSES.has(job.status)).length,
    approvalPending: jobs.filter((job) => job.status === "estimate_pending").length,
    inProgress: jobs.filter((job) => IN_PROGRESS_JOB_CARD_STATUSES.has(job.status)).length,
    completed: completed.length,
    cancelled: jobs.filter((job) => job.status === "cancelled").length,
    billed: jobs.filter((job) => job.status === "billed").length,
    billedRevenue: money(activeInvoices.filter((invoice) => String(invoice.jobCardId || "")).reduce((sum, invoice) => sum + money(invoice.grandTotal), 0)),
    averageTurnaroundDays: turnaroundDays.length ? money(turnaroundDays.reduce((sum, value) => sum + value, 0) / turnaroundDays.length) : 0,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
  };
}

async function createFinalInvoiceGraph(connection, device, req, input) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  validateFinalInvoicePayload(payload);
  const invoicePrefix = safeSequencePrefix(payload.invoicePrefix || input.invoicePrefix || process.env.INVOICE_PREFIX, "INV");
  const localSequenceFloor = Math.max(0, Math.floor(Number(payload.invoiceSequenceFloor || input.invoiceSequenceFloor || 0)));
  const sequenceFloor = Math.max(localSequenceFloor, await cloudInvoiceSequenceFloor(connection, device.business_id, invoicePrefix));
  await alignNumberSequence(connection, device.business_id, "invoice", invoicePrefix, sequenceFloor);

  const taxScope = normalizeTaxScope(payload.taxScope);
  const invoiceMode = normalizeInvoiceMode(payload.invoiceMode);
  const totals = calculateInvoiceTotals(invoiceMode, taxScope, payload.items, payload.discount);
  const invoiceDate = String(payload.invoiceDate || localDate());
  const paidAmount = money(Math.min(Math.max(finiteNumber(payload.paidAmount), 0), totals.grandTotal));
  const balanceDue = money(totals.grandTotal - paidAmount);

  const stockMovements = await reserveStockForReference(connection, device, payload, req, "__PENDING_INVOICE__", invoiceDate);
  const invoiceNumber = await nextNumber(connection, device.business_id, "invoice", invoicePrefix);
  for (const movement of stockMovements) {
    await persistBusinessRecord(
      connection,
      device,
      req,
      "inventory_movements",
      movement.id,
      { ...movement, reference: invoiceNumber },
      "UPSERT",
      "INVENTORY_MOVEMENT_REFERENCE_UPDATED"
    );
  }

  const customerId = String(payload.customerId || payload.customer?.id || uuid()).slice(0, 36);
  const customer = {
    id: customerId,
    name: requiredText(payload.customer?.name || payload.customerName, "Customer name"),
    phone: String(payload.customer?.phone || payload.customerPhone || ""),
    email: String(payload.customer?.email || ""),
    gstin: String(payload.customer?.gstin || ""),
    address: String(payload.customer?.address || ""),
    createdAt: String(payload.customer?.createdAt || nowIso())
  };
  const vehicleId = String(payload.vehicleId || payload.vehicle?.id || uuid()).slice(0, 36);
  const vehicle = {
    id: vehicleId,
    customerId,
    vehicleType: normalizeVehicleType(payload.vehicle?.vehicleType),
    registrationNumber: requiredText(payload.vehicle?.registrationNumber || payload.vehicleNumber, "Vehicle number").toUpperCase(),
    make: String(payload.vehicle?.make || ""),
    model: String(payload.vehicle?.model || ""),
    color: String(payload.vehicle?.color || ""),
    createdAt: String(payload.vehicle?.createdAt || nowIso())
  };
  await persistBusinessRecord(connection, device, req, "customers", customerId, customer);
  await persistBusinessRecord(connection, device, req, "vehicles", vehicleId, vehicle);

  const invoiceId = String(payload.id || uuid()).slice(0, 36);
  const createdAt = nowIso();
  const invoice = {
    id: invoiceId,
    invoiceNumber,
    invoiceStatus: "finalized",
    cloudSyncStatus: "synced",
    cloudRevision: 0,
    cloudSyncedAt: createdAt,
    cloudConflictId: "",
    invoiceMode,
    taxScope,
    invoiceDate,
    customerId,
    vehicleId,
    jobCardId: String(payload.jobCardId || ""),
    vehicleType: vehicle.vehicleType,
    customerName: customer.name,
    customerPhone: customer.phone,
    vehicleNumber: vehicle.registrationNumber,
    subTotal: totals.subTotal,
    discount: totals.discount,
    taxableValue: totals.taxableValue,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    totalTax: totals.totalTax,
    grandTotal: totals.grandTotal,
    paidAmount,
    balanceDue,
    paymentStatus: paymentStatus(totals.grandTotal, paidAmount),
    paymentMode: normalizePaymentMode(payload.paymentMode),
    paymentReference: String(payload.paymentReference || ""),
    notes: String(payload.notes || ""),
    cancelledAt: "",
    cancelledByUserId: "",
    cancelReason: "",
    replacementInvoiceId: "",
    sourceInvoiceId: String(payload.sourceInvoiceId || ""),
    sourceQuotationId: String(payload.sourceQuotationId || ""),
    createdAt,
    customer,
    vehicle
  };
  await persistBusinessRecord(connection, device, req, "invoices", invoiceId, invoice, "UPSERT", "INVOICE_FINALIZED");

  const items = [];
  for (const item of totals.items) {
    const invoiceItem = {
      id: uuid(),
      invoiceId,
      serviceId: String(item.serviceId || ""),
      inventoryItemId: String(item.inventoryItemId || ""),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate,
      sacCode: item.sacCode,
      lineSubTotal: item.lineSubTotal,
      lineTax: item.lineTax,
      lineTotal: item.lineTotal
    };
    await persistBusinessRecord(connection, device, req, "invoice_items", invoiceItem.id, invoiceItem, "UPSERT", "INVOICE_ITEM_INSERT");
    items.push(invoiceItem);
  }
  const payments = [];
  if (paidAmount > 0) {
    const payment = {
      id: uuid(),
      invoiceId,
      amount: paidAmount,
      mode: invoice.paymentMode,
      reference: invoice.paymentReference,
      paymentDate: invoiceDate,
      createdAt
    };
    await persistBusinessRecord(connection, device, req, "payments", payment.id, payment, "UPSERT", "PAYMENT_INSERT");
    payments.push(payment);
  }

  await connection.query(
    `INSERT INTO audit_log (business_id, device_id, action, entity, entity_id, before_state, after_state, ip_address)
     VALUES (?, ?, 'INVOICE_NUMBER_ASSIGNED', 'invoices', ?, NULL, ?, ?)`,
    [
      device.business_id,
      device.id,
      invoiceId,
      JSON.stringify({ invoiceNumber, source: input.source || "invoice", localId: input.localId || "", customer: customer.name }),
      req.socket.remoteAddress || ""
    ]
  );
  return { invoiceNumber, assignedAt: createdAt, invoice: { ...invoice, items, payments } };
}

async function handleRecordsList(req, res, device, url, entity) {
  if (!ALLOWED_RECORD_ENTITIES.has(entity)) return error(res, 404, "not_found", "Record entity was not found.");
  const rows = await loadBusinessRecords(pool, device.business_id, entity);
  const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const filtered = rows.filter((row) => {
    if (!includeInactive && row.data.active === false) return false;
    if (!query) return true;
    return JSON.stringify(row.data).toLowerCase().includes(query);
  });
  const safeRows = filtered.map((row) => ({ ...row, data: entity === "users" ? stripUserSecrets(row.data) : row.data }));
  ok(res, {
    entity,
    records: safeRows.map((row) => ({ recordId: row.recordId, data: row.data, revision: row.revision })),
    items: safeRows.map((row) => row.data)
  });
}

async function handleRecordGet(req, res, device, entity, recordId) {
  if (!ALLOWED_RECORD_ENTITIES.has(entity) || !isRecordId(recordId)) return error(res, 404, "not_found", "Record was not found.");
  const record = await loadBusinessRecord(pool, device.business_id, entity, recordId);
  if (!record) return error(res, 404, "not_found", "Record was not found.");
  const data = entity === "users" ? stripUserSecrets(record.data) : record.data;
  ok(res, { entity, recordId: record.recordId, record: data, data, revision: record.revision });
}

async function handleRecordCreate(req, res, device, entity) {
  if (!ALLOWED_RECORD_ENTITIES.has(entity)) return error(res, 404, "not_found", "Record entity was not found.");
  if (PROTECTED_RECORD_ENTITIES.has(entity)) return error(res, 403, "protected_record", "Use the dedicated cloud user and role endpoints.");
  const body = await readBody(req);
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const recordId = String(body.recordId || data.id || uuid()).slice(0, 36);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await persistBusinessRecord(connection, device, req, entity, recordId, { ...data, id: data.id || recordId });
    await connection.commit();
    ok(res, { entity, recordId, record: row.data, data: row.data, revision: row.revision }, 201, { location: `/api/v1/records/${entity}/${recordId}` });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to save cloud record.");
  } finally {
    connection.release();
  }
}

async function handleRecordPatch(req, res, device, entity, recordId) {
  if (!ALLOWED_RECORD_ENTITIES.has(entity) || !isRecordId(recordId)) return error(res, 404, "not_found", "Record was not found.");
  if (PROTECTED_RECORD_ENTITIES.has(entity)) return error(res, 403, "protected_record", "Use the dedicated cloud user and role endpoints.");
  const body = await readBody(req);
  const patch = body.data && typeof body.data === "object" ? body.data : body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, entity, recordId, true);
    if (!current) throw Object.assign(new Error("Record was not found."), { status: 404 });
    const row = await persistBusinessRecord(connection, device, req, entity, recordId, { ...current.data, ...patch, id: recordId });
    await connection.commit();
    ok(res, { entity, recordId, record: row.data, data: row.data, revision: row.revision });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to update cloud record.");
  } finally {
    connection.release();
  }
}

async function handleRecordDelete(req, res, device, entity, recordId) {
  if (!ALLOWED_RECORD_ENTITIES.has(entity) || !isRecordId(recordId)) return error(res, 404, "not_found", "Record was not found.");
  if (PROTECTED_RECORD_ENTITIES.has(entity)) return error(res, 403, "protected_record", "Use the dedicated cloud user and role endpoints.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await persistBusinessRecord(connection, device, req, entity, recordId, { id: recordId, deleted: true }, "DELETE");
    await connection.commit();
    noContent(res);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to delete cloud record.");
  } finally {
    connection.release();
  }
}

async function handleInvoicesList(req, res, device, url) {
  const connection = await pool.getConnection();
  try {
    const invoices = await listInvoiceSummaries(connection, device.business_id, url.searchParams.get("query") || "");
    ok(res, { invoices });
  } finally {
    connection.release();
  }
}

async function handleInvoiceGet(res, device, invoiceId) {
  const connection = await pool.getConnection();
  try {
    const invoice = await buildInvoiceDetail(connection, device.business_id, invoiceId);
    ok(res, { invoice });
  } catch (err) {
    error(res, err.status || 500, err.status === 404 ? "not_found" : "internal_error", err.message || "Unable to load invoice.");
  } finally {
    connection.release();
  }
}

async function handleInvoicePayment(req, res, device, invoiceId) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const invoiceRecord = await loadBusinessRecord(connection, device.business_id, "invoices", invoiceId, true);
    if (!invoiceRecord) throw Object.assign(new Error("Invoice not found."), { status: 404 });
    const invoice = invoiceRecord.data;
    if (invoice.invoiceStatus === "cancelled") throw Object.assign(new Error("Cancelled invoices cannot receive payments."), { status: 422 });
    const amount = money(Math.min(Math.max(positiveNumber(body.amount, "Payment amount"), 0), money(invoice.balanceDue)));
    const paidAmount = money(money(invoice.paidAmount) + amount);
    const balanceDue = money(money(invoice.grandTotal) - paidAmount);
    const payment = {
      id: uuid(),
      invoiceId,
      amount,
      mode: normalizePaymentMode(body.mode),
      reference: String(body.reference || ""),
      paymentDate: String(body.paymentDate || localDate()),
      createdAt: nowIso()
    };
    await persistBusinessRecord(connection, device, req, "payments", payment.id, payment, "UPSERT", "PAYMENT_INSERT");
    await persistBusinessRecord(connection, device, req, "invoices", invoiceId, {
      ...invoice,
      paidAmount,
      balanceDue,
      paymentStatus: paymentStatus(money(invoice.grandTotal), paidAmount),
      paymentMode: payment.mode,
      paymentReference: payment.reference
    }, "UPSERT", "INVOICE_PAYMENT_RECORDED");
    await connection.commit();
    ok(res, { invoice: await buildInvoiceDetail(connection, device.business_id, invoiceId) });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to record payment.");
  } finally {
    connection.release();
  }
}

async function handleInvoiceCancel(req, res, device, invoiceId) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const invoiceRecord = await loadBusinessRecord(connection, device.business_id, "invoices", invoiceId, true);
    if (!invoiceRecord) throw Object.assign(new Error("Invoice not found."), { status: 404 });
    if (invoiceRecord.data.invoiceStatus === "cancelled") {
      throw Object.assign(new Error("Invoice is already cancelled."), { status: 422 });
    }
    await reverseStockForCancelledInvoice(connection, device, req, invoiceRecord.data);
    const invoice = {
      ...invoiceRecord.data,
      invoiceStatus: "cancelled",
      cancelledAt: nowIso(),
      cancelledByUserId: String(body.cancelledByUserId || device.id),
      cancelReason: requiredText(body.reason, "Cancellation reason"),
      balanceDue: 0,
      paymentStatus: "paid"
    };
    await persistBusinessRecord(connection, device, req, "invoices", invoiceId, invoice, "UPSERT", "INVOICE_CANCELLED");
    await connection.commit();
    ok(res, { invoice: await buildInvoiceDetail(connection, device.business_id, invoiceId) });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to cancel invoice.");
  } finally {
    connection.release();
  }
}

async function handleInvoiceAppendItem(req, res, device, invoiceId) {
  const body = await readBody(req);
  const appendItem = body.item && typeof body.item === "object" ? body.item : body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await buildInvoiceDetail(connection, device.business_id, invoiceId);
    if (current.invoiceStatus === "cancelled") throw Object.assign(new Error("Cancelled invoices cannot be edited."), { status: 422 });
    await reserveStockForReference(connection, device, { items: [appendItem] }, req, current.invoiceNumber, localDate(), "Invoice extra item");
    const existingInputs = current.items.map((item) => ({
      serviceId: item.serviceId || "",
      inventoryItemId: item.inventoryItemId || "",
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate,
      sacCode: item.sacCode
    }));
    const totals = calculateInvoiceTotals(current.invoiceMode, current.taxScope, [...existingInputs, appendItem], current.discount);
    const paidAmount = money(current.paidAmount);
    const balanceDue = money(totals.grandTotal - paidAmount);
    const nextInvoice = {
      ...current,
      subTotal: totals.subTotal,
      discount: totals.discount,
      taxableValue: totals.taxableValue,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      paidAmount,
      balanceDue,
      paymentStatus: paymentStatus(totals.grandTotal, paidAmount)
    };
    delete nextInvoice.items;
    delete nextInvoice.payments;
    await persistBusinessRecord(connection, device, req, "invoices", invoiceId, nextInvoice, "UPSERT", "INVOICE_ITEM_APPENDED");
    const allItemIds = [...current.items.map((item) => item.id), uuid()];
    for (let index = 0; index < totals.items.length; index += 1) {
      const item = totals.items[index];
      const invoiceItem = {
        id: allItemIds[index],
        invoiceId,
        serviceId: String(item.serviceId || ""),
        inventoryItemId: String(item.inventoryItemId || ""),
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        sacCode: item.sacCode,
        lineSubTotal: item.lineSubTotal,
        lineTax: item.lineTax,
        lineTotal: item.lineTotal
      };
      await persistBusinessRecord(connection, device, req, "invoice_items", invoiceItem.id, invoiceItem, "UPSERT", "INVOICE_ITEM_UPSERT");
    }
    await connection.commit();
    ok(res, { invoice: await buildInvoiceDetail(connection, device.business_id, invoiceId) });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to append invoice item.");
  } finally {
    connection.release();
  }
}

const actionItemInput = (item) => ({
  serviceId: String(item.serviceId || ""),
  inventoryItemId: String(item.inventoryItemId || ""),
  description: String(item.description || ""),
  quantity: money(item.quantity),
  unitPrice: money(item.unitPrice),
  gstRate: money(item.gstRate),
  sacCode: String(item.sacCode || "9987")
});

async function handleQuotationConvertToInvoice(req, res, device, quotationId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const quotation = await buildQuotationDetail(connection, device.business_id, quotationId);
    if (quotation.convertedInvoiceId) throw Object.assign(new Error("Quotation is already converted."), { status: 422 });
    if (!["draft", "sent", "accepted"].includes(String(quotation.quotationStatus || ""))) {
      throw Object.assign(new Error("Only Draft, Sent, or Accepted quotations can be converted to a bill."), { status: 422 });
    }
    const responseBody = await createFinalInvoiceGraph(connection, device, req, {
      source: "quotation",
      localId: quotationId,
      payload: {
        invoiceMode: quotation.invoiceMode,
        taxScope: quotation.taxScope,
        invoiceDate: localDate(),
        sourceQuotationId: quotation.id,
        customerId: quotation.customerId,
        customer: quotation.customer,
        vehicleId: quotation.vehicleId,
        vehicle: quotation.vehicle,
        items: quotation.items.map(actionItemInput),
        discount: quotation.discount,
        paidAmount: 0,
        paymentMode: "UPI",
        paymentReference: "",
        notes: quotation.notes || ""
      }
    });
    const { customer, vehicle, items, ...quotationRecord } = quotation;
    await persistBusinessRecord(connection, device, req, "quotations", quotationId, {
      ...quotationRecord,
      quotationStatus: "converted",
      convertedInvoiceId: responseBody.invoice.id,
      updatedAt: nowIso()
    }, "UPSERT", "QUOTATION_CONVERTED");
    await connection.commit();
    ok(res, responseBody, 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to convert quotation.");
  } finally {
    connection.release();
  }
}

async function handleJobCardConvertToInvoice(req, res, device, jobCardId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const job = await buildJobCardDetail(connection, device.business_id, jobCardId);
    if (job.invoiceId) throw Object.assign(new Error("This job card is already linked to an invoice."), { status: 422 });
    if (["draft", "estimate_pending", "cancelled"].includes(job.status)) {
      throw Object.assign(new Error("Only approved or completed job cards can be converted to invoices."), { status: 422 });
    }
    const responseBody = await createFinalInvoiceGraph(connection, device, req, {
      source: "job_card",
      localId: jobCardId,
      payload: {
        invoiceMode: "gst",
        taxScope: "intra",
        invoiceDate: localDate(),
        jobCardId,
        customerId: job.customerId,
        customer: job.customer,
        vehicleId: job.vehicleId,
        vehicle: job.vehicle,
        items: job.items.map(actionItemInput),
        discount: job.discount,
        paidAmount: 0,
        paymentMode: "Cash",
        paymentReference: "",
        notes: ""
      }
    });
    const { customer, vehicle, items, checklist, photos, history, ...jobRecord } = job;
    await persistBusinessRecord(connection, device, req, "job_cards", jobCardId, {
      ...jobRecord,
      status: "billed",
      invoiceId: responseBody.invoice.id,
      updatedAt: nowIso()
    }, "UPSERT", "JOB_CARD_CONVERTED");
    const historyId = uuid();
    await persistBusinessRecord(connection, device, req, "job_card_status_history", historyId, {
      id: historyId,
      jobCardId,
      status: "billed",
      note: `Invoice ${responseBody.invoiceNumber} created.`,
      createdAt: nowIso()
    }, "UPSERT", "JOB_CARD_STATUS_HISTORY_INSERT");
    await connection.commit();
    ok(res, responseBody, 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to convert job card.");
  } finally {
    connection.release();
  }
}

async function handleInventoryDashboard(res, device) {
  const connection = await pool.getConnection();
  try {
    const dashboard = await buildInventorySnapshot(connection, device.business_id);
    ok(res, { dashboard });
  } finally {
    connection.release();
  }
}

async function handleInventoryPurchase(req, res, device) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let supplierId = String(body.supplierId || "");
    if (!supplierId && body.supplier?.name) {
      supplierId = String(body.supplier.id || uuid()).slice(0, 36);
      await persistBusinessRecord(connection, device, req, "suppliers", supplierId, {
        id: supplierId,
        name: requiredText(body.supplier.name, "Supplier name"),
        phone: String(body.supplier.phone || ""),
        gstin: String(body.supplier.gstin || ""),
        address: String(body.supplier.address || ""),
        createdAt: nowIso()
      });
    }
    const quantity = money(positiveNumber(body.quantity, "Purchase quantity"));
    const unitCost = money(Math.max(0, finiteNumber(body.unitCost)));
    const subtotal = money(quantity * unitCost);
    const gstRate = money(Math.max(0, finiteNumber(body.gstRate)));
    const gstAmount = money((subtotal * gstRate) / 100);
    const batch = {
      id: uuid(),
      itemId: requiredText(body.itemId, "Inventory item"),
      supplierId,
      batchNumber: String(body.batchNumber || ""),
      expiryDate: String(body.expiryDate || ""),
      purchaseDate: String(body.purchaseDate || localDate()),
      billNumber: String(body.billNumber || ""),
      quantityPurchased: quantity,
      quantityRemaining: quantity,
      unitCost,
      gstRate,
      subtotal,
      gstAmount,
      totalCost: money(subtotal + gstAmount),
      createdAt: nowIso()
    };
    const item = (await loadBusinessRecord(connection, device.business_id, "inventory_items", batch.itemId))?.data || {};
    const movement = {
      id: uuid(),
      itemId: batch.itemId,
      itemName: item.name || "",
      itemType: item.type === "retail" ? "retail" : "consumable",
      itemUnit: item.unit || "",
      batchId: batch.id,
      type: "purchase",
      quantity,
      unitCost,
      reference: batch.billNumber,
      notes: "Purchase stock added",
      movementDate: batch.purchaseDate,
      createdAt: nowIso()
    };
    await persistBusinessRecord(connection, device, req, "inventory_batches", batch.id, batch, "UPSERT", "INVENTORY_PURCHASE_INSERT");
    await persistBusinessRecord(connection, device, req, "inventory_movements", movement.id, movement, "UPSERT", "INVENTORY_MOVEMENT_INSERT");
    await connection.commit();
    ok(res, { batch, movement }, 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to add stock purchase.");
  } finally {
    connection.release();
  }
}

async function handleInventoryMovement(req, res, device) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const itemId = requiredText(body.itemId, "Inventory item");
    const type = String(body.type || "");
    if (!["usage", "adjustment", "return", "damage"].includes(type)) throw Object.assign(new Error("Unsupported manual stock movement."), { status: 422 });
    const quantity = money(positiveNumber(body.quantity, "Quantity"));
    const item = (await loadBusinessRecord(connection, device.business_id, "inventory_items", itemId))?.data;
    if (!item) throw Object.assign(new Error("Inventory item not found."), { status: 404 });
    const movementDate = String(body.movementDate || localDate());
    const reference = String(body.reference || "");
    const notes = String(body.notes || "");
    const batches = await loadBusinessRecords(connection, device.business_id, "inventory_batches", true);
    const itemBatches = batches
      .filter((row) => String(row.data.itemId || "") === itemId && money(row.data.quantityRemaining) > 0)
      .sort((a, b) => String(a.data.expiryDate || "9999-12-31").localeCompare(String(b.data.expiryDate || "9999-12-31")));
    if (!itemBatches.length) throw Object.assign(new Error("Add a purchase batch before recording this movement."), { status: 422 });
    const movements = [];
    if (type === "adjustment" || type === "return") {
      const batch = itemBatches[0];
      const nextBatch = { ...batch.data, quantityRemaining: money(money(batch.data.quantityRemaining) + quantity) };
      await persistBusinessRecord(connection, device, req, "inventory_batches", batch.recordId, nextBatch, "UPSERT", "INVENTORY_BATCH_ADJUSTED");
      const movement = {
        id: uuid(),
        itemId,
        itemName: item.name || "",
        itemType: item.type === "retail" ? "retail" : "consumable",
        itemUnit: item.unit || "",
        batchId: batch.recordId,
        type,
        quantity,
        unitCost: money(batch.data.unitCost),
        reference,
        notes,
        movementDate,
        createdAt: nowIso()
      };
      await persistBusinessRecord(connection, device, req, "inventory_movements", movement.id, movement, "UPSERT", "INVENTORY_MOVEMENT_INSERT");
      movements.push(movement);
    } else {
      const available = money(itemBatches.reduce((sum, row) => sum + money(row.data.quantityRemaining), 0));
      if (available < quantity) throw Object.assign(new Error(`Stock not available for ${item.name || itemId}. Available: ${available} ${item.unit || "unit"}, requested: ${quantity} ${item.unit || "unit"}.`), { status: 422 });
      let remaining = quantity;
      for (const batch of itemBatches) {
        if (remaining <= 0) break;
        const used = money(Math.min(money(batch.data.quantityRemaining), remaining));
        remaining = money(remaining - used);
        await persistBusinessRecord(connection, device, req, "inventory_batches", batch.recordId, {
          ...batch.data,
          quantityRemaining: money(money(batch.data.quantityRemaining) - used)
        }, "UPSERT", "INVENTORY_BATCH_DEDUCTED");
        const movement = {
          id: uuid(),
          itemId,
          itemName: item.name || "",
          itemType: item.type === "retail" ? "retail" : "consumable",
          itemUnit: item.unit || "",
          batchId: batch.recordId,
          type,
          quantity: used,
          unitCost: money(batch.data.unitCost),
          reference,
          notes,
          movementDate,
          createdAt: nowIso()
        };
        await persistBusinessRecord(connection, device, req, "inventory_movements", movement.id, movement, "UPSERT", "INVENTORY_MOVEMENT_INSERT");
        movements.push(movement);
      }
    }
    await connection.commit();
    ok(res, { movements });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to record stock movement.");
  } finally {
    connection.release();
  }
}

async function handleDashboard(res, device) {
  const connection = await pool.getConnection();
  try {
    const invoices = await listInvoiceSummaries(connection, device.business_id, "", 0);
    const today = localDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const active = invoices.filter((invoice) => invoice.invoiceStatus !== "cancelled");
    const activeInvoiceIds = new Set(active.map((invoice) => String(invoice.id || "")));
    const payments = rowList(await loadBusinessRecords(connection, device.business_id, "payments"))
      .filter((payment) => activeInvoiceIds.has(String(payment.invoiceId || "")));
    ok(res, {
      dashboard: {
        todayRevenue: money(payments.filter((payment) => payment.paymentDate === today).reduce((sum, payment) => sum + money(payment.amount), 0)),
        monthRevenue: money(payments.filter((payment) => String(payment.paymentDate || "") >= monthStart).reduce((sum, payment) => sum + money(payment.amount), 0)),
        pendingDues: money(active.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0)),
        todayInvoices: active.filter((invoice) => invoice.invoiceDate === today).length,
        recentInvoices: invoices.slice(0, 8),
        topServices: await buildTopServices(connection, device.business_id, active),
        enquiries: await buildEnquiryDashboard(connection, device.business_id),
        jobCards: await buildJobCardDashboard(connection, device.business_id)
      }
    });
  } finally {
    connection.release();
  }
}

const normalizeReportFilter = (filter = "30d") => {
  if (typeof filter === "string") return { preset: filter, fromDate: "", toDate: "" };
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filter?.fromDate || "")) ? String(filter.fromDate) : "";
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filter?.toDate || "")) ? String(filter.toDate) : "";
  return { preset: filter?.preset || (fromDate || toDate ? "" : "30d"), fromDate, toDate };
};
const reportRange = (filter) => {
  const normalized = normalizeReportFilter(filter);
  if (normalized.fromDate || normalized.toDate) {
    const fromDate = normalized.fromDate && normalized.toDate && normalized.fromDate > normalized.toDate ? normalized.toDate : normalized.fromDate;
    const toDate = normalized.fromDate && normalized.toDate && normalized.fromDate > normalized.toDate ? normalized.fromDate : normalized.toDate;
    return {
      fromDate,
      toDate,
      label: fromDate && toDate ? `${fromDate} to ${toDate}` : fromDate ? `From ${fromDate}` : `Until ${toDate}`
    };
  }
  const preset = normalized.preset || "30d";
  if (preset === "all") return { fromDate: "", toDate: "", label: "All time" };
  const days = preset === "90d" ? 90 : preset === "7d" ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return { fromDate: localDate(date), toDate: "", label: `Last ${days} days` };
};
const inDateRange = (date, range) => {
  const value = String(date || "");
  if (range.fromDate && value < range.fromDate) return false;
  if (range.toDate && value > range.toDate) return false;
  return true;
};

async function handleReports(req, res, device) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filter = url.searchParams.get("filterJson") ? parseJsonColumn(url.searchParams.get("filterJson"), "30d") : (url.searchParams.get("preset") || "30d");
  const range = reportRange(filter);
  const connection = await pool.getConnection();
  try {
    const allInvoices = await listInvoiceSummaries(connection, device.business_id, "", 0);
    const invoices = allInvoices.filter((invoice) => inDateRange(invoice.invoiceDate, range));
    const active = invoices.filter((invoice) => invoice.invoiceStatus !== "cancelled");
    const allActiveInvoiceIds = new Set(allInvoices.filter((invoice) => invoice.invoiceStatus !== "cancelled").map((invoice) => String(invoice.id || "")));
    const payments = rowList(await loadBusinessRecords(connection, device.business_id, "payments"))
      .filter((payment) => allActiveInvoiceIds.has(String(payment.invoiceId || "")) && inDateRange(payment.paymentDate, range));
    const paymentModes = [...PAYMENT_MODES].map((mode) => ({
      mode,
      amount: money(payments.filter((payment) => payment.mode === mode).reduce((sum, payment) => sum + money(payment.amount), 0))
    })).filter((row) => row.amount > 0);
    const inventory = await buildInventorySnapshot(connection, device.business_id);
    ok(res, {
      report: {
        rangeLabel: range.label,
        revenue: money(active.reduce((sum, invoice) => sum + money(invoice.grandTotal), 0)),
        invoiceCount: active.length,
        paidAmount: money(payments.reduce((sum, payment) => sum + money(payment.amount), 0)),
        balanceDue: money(active.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0)),
        taxableValue: money(active.reduce((sum, invoice) => sum + money(invoice.taxableValue), 0)),
        cgst: money(active.reduce((sum, invoice) => sum + money(invoice.cgst), 0)),
        sgst: money(active.reduce((sum, invoice) => sum + money(invoice.sgst), 0)),
        igst: money(active.reduce((sum, invoice) => sum + money(invoice.igst), 0)),
        totalTax: money(active.reduce((sum, invoice) => sum + money(invoice.totalTax), 0)),
        cancelledCount: invoices.length - active.length,
        dues: active.filter((invoice) => money(invoice.balanceDue) > 0),
        topServices: await buildTopServices(connection, device.business_id, active),
        paymentModes,
        salesTrend: buildSalesTrend(active, payments),
        inventory,
        enquiries: await buildEnquiryReport(connection, device.business_id, range),
        jobCards: await buildJobCardReport(connection, device.business_id, range, active)
      }
    });
  } finally {
    connection.release();
  }
}

async function handleProfit(req, res, device) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filter = url.searchParams.get("filterJson") ? parseJsonColumn(url.searchParams.get("filterJson"), "30d") : (url.searchParams.get("preset") || "30d");
  const range = reportRange(filter);
  const connection = await pool.getConnection();
  try {
    const invoices = rowList(await loadBusinessRecords(connection, device.business_id, "invoices"));
    const activeInvoiceIds = new Set(invoices.filter((invoice) => invoice.invoiceStatus !== "cancelled").map((invoice) => String(invoice.id || "")));
    const activeInvoiceNumbers = new Set(invoices.filter((invoice) => invoice.invoiceStatus !== "cancelled").map((invoice) => String(invoice.invoiceNumber || "")));
    const payments = rowList(await loadBusinessRecords(connection, device.business_id, "payments"))
      .filter((payment) => activeInvoiceIds.has(String(payment.invoiceId || "")) && inDateRange(payment.paymentDate, range));
    const movements = rowList(await loadBusinessRecords(connection, device.business_id, "inventory_movements"))
      .filter((movement) => activeInvoiceNumbers.has(String(movement.reference || "")) && inDateRange(movement.movementDate, range));
    const expenses = rowList(await loadBusinessRecords(connection, device.business_id, "expenses")).filter((expense) => inDateRange(expense.expenseDate, range));
    const paidRevenue = money(payments.reduce((sum, payment) => sum + money(payment.amount), 0));
    const stockCost = money(movements.filter((movement) => ["sale", "usage"].includes(String(movement.type || ""))).reduce((sum, movement) => sum + money(movement.quantity) * money(movement.unitCost), 0));
    const expenseTotal = money(expenses.reduce((sum, expense) => sum + money(expense.amount), 0));
    const cashProfit = money(paidRevenue - stockCost - expenseTotal);
    const categories = new Map();
    expenses.forEach((expense) => categories.set(expense.category || "Other", money((categories.get(expense.category || "Other") || 0) + money(expense.amount))));
    ok(res, {
      profit: {
        rangeLabel: range.label,
        paidRevenue,
        stockCost,
        expenseTotal,
        cashProfit,
        profitMargin: paidRevenue > 0 ? money((cashProfit / paidRevenue) * 100) : 0,
        trend: [],
        expensesByCategory: [...categories.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
        expenses
      }
    });
  } finally {
    connection.release();
  }
}

async function canonicalizeOperation(connection, businessId, op) {
  const data = { ...(op.data || {}) };
  if (op.entity === "invoices" && (!data.invoiceNumber || String(data.invoiceNumber).startsWith("LOCAL-"))) {
    data.invoiceNumber = await nextNumber(connection, businessId, "invoice", "INV");
    data.cloudSyncStatus = "synced";
  }
  if (op.entity === "quotations" && (!data.quotationNumber || String(data.quotationNumber).startsWith("LOCAL-"))) {
    data.quotationNumber = await nextNumber(connection, businessId, "quotation", "QT");
  }
  if (op.entity === "job_cards" && (!data.jobNumber || String(data.jobNumber).startsWith("LOCAL-"))) {
    data.jobNumber = await nextNumber(connection, businessId, "job_card", "JC");
  }
  return data;
}

async function handleDeviceRegistration(req, res) {
  enforceRateLimit(req, "device-registration", {
    limit: DEVICE_REGISTRATION_RATE_LIMIT_MAX,
    windowMs: DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS
  });
  const body = await readBody(req);
  const requestIp = getRequestIp(req);
  const deviceDisplayIp = firstReportedDeviceIp(body) || requestIp;
  if (!REGISTRATION_KEY) {
    const connection = await pool.getConnection();
    try {
      await insertAuditLog(connection, {
        businessId: 1,
        action: "DEVICE_REGISTRATION_KEY_MISSING",
        entity: "devices",
        afterState: {
          deviceId: String(body.deviceId || ""),
          deviceName: String(body.deviceName || body.deviceCode || ""),
          deviceCode: String(body.deviceCode || "")
        },
        ipAddress: requestIp
      });
    } finally {
      connection.release();
    }
    return error(res, 503, "registration_not_configured", "Cloud device registration is not configured. Set SYNC_REGISTRATION_KEY and restart the Node app.");
  }
  if (REGISTRATION_KEY && body.registrationKey !== REGISTRATION_KEY) {
    const connection = await pool.getConnection();
    try {
      await insertAuditLog(connection, {
        businessId: 1,
        action: "DEVICE_REGISTRATION_KEY_FAILED",
        entity: "devices",
        afterState: {
          deviceId: String(body.deviceId || ""),
          deviceName: String(body.deviceName || body.deviceCode || ""),
          deviceCode: String(body.deviceCode || "")
        },
        ipAddress: requestIp
      });
    } finally {
      connection.release();
    }
    return error(res, 403, "registration_denied", "Registration key is invalid.");
  }
  const deviceId = String(body.deviceId || "");
  if (!isUuid(deviceId)) return error(res, 422, "validation_error", "A valid deviceId is required.");
  const deviceName = String(body.deviceName || body.deviceCode || "Autocare24 PC").slice(0, 100);
  const deviceCode = String(body.deviceCode || "").slice(0, 32);
  const rawToken = token();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM businesses WHERE id = 1 FOR UPDATE");
    const users = await loadBusinessRecords(connection, 1, "users");
    const [deviceRows] = await connection.query("SELECT * FROM devices WHERE business_id = 1 FOR UPDATE");
    const existing = deviceRows.find((row) => String(row.id || "") === deviceId) || null;
    const existingStatus = existing ? normalizeDeviceApprovalStatus(existing) : "";
    const existingApprovedDevice = deviceRows.find((row) => !row.is_revoked && normalizeDeviceApprovalStatus(row) === DEVICE_APPROVAL_STATUS.APPROVED);
    if (users.length > 0 && existing && !existing.is_revoked && existingStatus === DEVICE_APPROVAL_STATUS.APPROVED) {
      await connection.query(
        `UPDATE devices
         SET name = ?,
             device_code = ?,
             token_hash = ?,
             is_revoked = FALSE,
             approval_status = 'APPROVED',
             last_seen_at = CURRENT_TIMESTAMP,
             registration_ip = ?
         WHERE id = ? AND business_id = 1`,
        [deviceName, deviceCode, hashToken(rawToken), deviceDisplayIp, deviceId]
      );
      const [updatedRows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = 1 LIMIT 1", [deviceId]);
      const device = publicDeviceFromRow(updatedRows[0] || existing);
      await insertAuditLog(connection, {
        businessId: 1,
        deviceId,
        action: "DEVICE_REGISTRATION_APPROVED_DEVICE_RECONNECTED",
        entity: "devices",
        entityId: deviceId,
        beforeState: publicDeviceFromRow(existing),
        afterState: device,
        ipAddress: requestIp
      });
      await connection.commit();
      return ok(res, {
        token: rawToken,
        device,
        approvalStatus: DEVICE_APPROVAL_STATUS.APPROVED,
        pendingApproval: false
      }, 200, { location: `/api/v1/auth/devices/${deviceId}` });
    }
    const shouldApprove = users.length === 0 && (!existingApprovedDevice || String(existingApprovedDevice.id || "") === deviceId);
    const approvalStatus = shouldApprove ? DEVICE_APPROVAL_STATUS.APPROVED : DEVICE_APPROVAL_STATUS.PENDING;
    const revoked = approvalStatus === DEVICE_APPROVAL_STATUS.REVOKED;
    await connection.query(
      `INSERT INTO devices
        (id, business_id, name, device_code, token_hash, is_revoked, last_seen_at, approval_status, approval_requested_at, approved_at, approved_by_user_id, registration_ip)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        device_code = VALUES(device_code),
        token_hash = VALUES(token_hash),
        is_revoked = VALUES(is_revoked),
        last_seen_at = VALUES(last_seen_at),
        approval_status = VALUES(approval_status),
        approval_requested_at = CURRENT_TIMESTAMP,
        approved_at = VALUES(approved_at),
        approved_by_user_id = VALUES(approved_by_user_id),
        registration_ip = VALUES(registration_ip)`,
      [
        deviceId,
        deviceName,
        deviceCode,
        hashToken(rawToken),
        revoked,
        shouldApprove ? new Date() : null,
        approvalStatus,
        shouldApprove ? new Date() : null,
        deviceDisplayIp
      ]
    );
    const [rows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = 1 LIMIT 1", [deviceId]);
    const device = publicDeviceFromRow(rows[0] || { id: deviceId, name: deviceName, device_code: deviceCode, approval_status: approvalStatus });
    await insertAuditLog(connection, {
      businessId: 1,
      deviceId,
      action: shouldApprove ? "DEVICE_REGISTRATION_APPROVED" : "DEVICE_REGISTRATION_PENDING",
      entity: "devices",
      entityId: deviceId,
      beforeState: existing ? publicDeviceFromRow(existing) : null,
      afterState: device,
      ipAddress: requestIp
    });
    await connection.commit();
    ok(res, {
      token: rawToken,
      device,
      approvalStatus,
      pendingApproval: approvalStatus === DEVICE_APPROVAL_STATUS.PENDING
    }, shouldApprove ? 201 : 202, { location: `/api/v1/auth/devices/${deviceId}` });
  } catch (err) {
    await connection.rollback();
    error(res, 500, "internal_error", "Unable to register device.");
  } finally {
    connection.release();
  }
}

async function handleCurrentDeviceApprovalStatus(req, res) {
  const device = await authenticate(req, { allowPending: true });
  if (!device) return error(res, 401, "DEVICE_NOT_FOUND", "Device token is missing or invalid.");
  const approvalStatus = normalizeDeviceApprovalStatus(device);
  ok(res, {
    device: publicDeviceFromRow(device),
    approvalStatus,
    pendingApproval: approvalStatus === DEVICE_APPROVAL_STATUS.PENDING,
    approved: approvalStatus === DEVICE_APPROVAL_STATUS.APPROVED && !device.is_revoked,
    revoked: approvalStatus === DEVICE_APPROVAL_STATUS.REVOKED || Boolean(device.is_revoked)
  });
}

async function verifyCloudOwner(connection, device, req, body) {
  const username = normalizeUsername(body.ownerUsername || body.username);
  const password = String(body.ownerPassword || body.password || "");
  const rows = await loadBusinessRecords(connection, device.business_id, "users");
  const matched = rows.map((row) => row.data).find((user) =>
    user.active !== false &&
    user.role === "owner" &&
    normalizeUsername(user.username) === username
  );
  if (!matched || !password || !verifyPassword(password, matched.salt, matched.passwordHash)) {
    await insertAuditLog(connection, {
      businessId: device.business_id,
      deviceId: device.id,
      userLabel: username,
      action: "DEVICE_OWNER_VERIFY_FAILED",
      entity: "devices",
      afterState: { username },
      ipAddress: getRequestIp(req)
    });
    throw Object.assign(new Error("Owner username or password is incorrect."), { status: 403 });
  }
  return matched;
}

async function handleAdminDevicesList(req, res, device) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await verifyCloudOwner(connection, device, req, body);
    const [rows] = await connection.query("SELECT * FROM devices WHERE business_id = ? ORDER BY created_at DESC", [device.business_id]);
    const devices = rows
      .map(publicDeviceFromRow)
      .filter((deviceRow) => deviceRow.approvalStatus !== DEVICE_APPROVAL_STATUS.REVOKED && !deviceRow.isRevoked)
      .sort((a, b) => {
        const order = { PENDING: 0, APPROVED: 1 };
        return (order[a.approvalStatus] ?? 9) - (order[b.approvalStatus] ?? 9) || b.createdAt.localeCompare(a.createdAt);
      });
    ok(res, { devices, currentDeviceId: device.id });
  } catch (err) {
    error(res, err.status || 500, err.status === 403 ? "owner_verification_failed" : "internal_error", err.message || "Unable to load cloud devices.");
  } finally {
    connection.release();
  }
}

async function handleAdminDeviceApprove(req, res, device, deviceId) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    const owner = await verifyCloudOwner(connection, device, req, body);
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE", [deviceId, device.business_id]);
    const current = rows[0] || null;
    if (!current) throw Object.assign(new Error("Device was not found."), { status: 404 });
    await connection.query(
      `UPDATE devices
       SET is_revoked = FALSE,
           approval_status = 'APPROVED',
           approved_at = CURRENT_TIMESTAMP,
           approved_by_user_id = ?,
           last_seen_at = COALESCE(last_seen_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND business_id = ?`,
      [owner.id, deviceId, device.business_id]
    );
    const [updatedRows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = ? LIMIT 1", [deviceId, device.business_id]);
    const updated = publicDeviceFromRow(updatedRows[0] || current);
    await insertAuditLog(connection, {
      businessId: device.business_id,
      deviceId: device.id,
      userLabel: normalizeUsername(owner.username),
      action: "DEVICE_APPROVED",
      entity: "devices",
      entityId: deviceId,
      beforeState: publicDeviceFromRow(current),
      afterState: updated,
      ipAddress: getRequestIp(req)
    });
    await connection.commit();
    ok(res, { device: updated });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 403 ? "owner_verification_failed" : err.status === 404 ? "not_found" : "internal_error", err.message || "Unable to approve device.");
  } finally {
    connection.release();
  }
}

async function handleAdminDeviceRevoke(req, res, device, deviceId) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    const owner = await verifyCloudOwner(connection, device, req, body);
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE", [deviceId, device.business_id]);
    const current = rows[0] || null;
    if (!current) throw Object.assign(new Error("Device was not found."), { status: 404 });
    await connection.query(
      `UPDATE devices
       SET token_hash = '',
           is_revoked = TRUE,
           approval_status = 'REVOKED'
       WHERE id = ? AND business_id = ?`,
      [deviceId, device.business_id]
    );
    const [updatedRows] = await connection.query("SELECT * FROM devices WHERE id = ? AND business_id = ? LIMIT 1", [deviceId, device.business_id]);
    const updated = publicDeviceFromRow(updatedRows[0] || current);
    await insertAuditLog(connection, {
      businessId: device.business_id,
      deviceId: device.id,
      userLabel: normalizeUsername(owner.username),
      action: "DEVICE_REVOKED",
      entity: "devices",
      entityId: deviceId,
      beforeState: publicDeviceFromRow(current),
      afterState: updated,
      ipAddress: getRequestIp(req)
    });
    await connection.commit();
    ok(res, { device: updated });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 403 ? "owner_verification_failed" : err.status === 404 ? "not_found" : "internal_error", err.message || "Unable to revoke device.");
  } finally {
    connection.release();
  }
}

async function handleCloudAuthStatus(req, res, device) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const users = await listCloudUsers(connection, device.business_id);
    await connection.commit();
    ok(res, { hasUsers: users.length > 0 });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to load cloud auth status.");
  } finally {
    connection.release();
  }
}

async function handleCloudSetupOwner(req, res, device) {
  enforceRateLimit(req, "auth-setup-owner");
  const body = await readBody(req);
  const displayName = requiredText(body.displayName, "Display name").slice(0, 100);
  const username = normalizeUsername(body.username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return error(res, 422, "validation_error", "Username must be 3-32 characters using letters, numbers, dot, underscore, or hyphen.");
  const password = validatePassword(body.password);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const existingUsers = await loadBusinessRecords(connection, device.business_id, "users", true);
    if (existingUsers.length) throw Object.assign(new Error("Owner account is already configured."), { status: 422 });
    const now = nowIso();
    const secret = hashPassword(password);
    const user = {
      id: uuid(),
      displayName,
      username,
      role: "owner",
      accessRoleId: OWNER_ACCESS_ROLE_ID,
      passwordHash: secret.passwordHash,
      salt: secret.salt,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    await persistBusinessRecord(connection, device, req, "users", user.id, user, "UPSERT", "USER_OWNER_SETUP");
    const roleMap = new Map((await listCloudAccessRoles(connection, device.business_id)).map((role) => [role.id, role]));
    await connection.commit();
    ok(res, { user: publicUserFromData(user, roleMap) }, 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to create owner account.");
  } finally {
    connection.release();
  }
}

async function handleCloudLogin(req, res, device) {
  enforceRateLimit(req, "auth-login");
  const body = await readBody(req);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const connection = await pool.getConnection();
  try {
    await ensureDefaultAccessRoles(connection, device, req);
    const rows = await loadBusinessRecords(connection, device.business_id, "users");
    const matched = rows.map((row) => row.data).find((user) => user.active !== false && normalizeUsername(user.username) === username);
    if (!matched || !verifyPassword(password, matched.salt, matched.passwordHash)) throw Object.assign(new Error("Invalid username or password."), { status: 401 });
    const roleMap = new Map((await listCloudAccessRoles(connection, device.business_id)).map((role) => [role.id, role]));
    ok(res, { user: publicUserFromData(matched, roleMap) });
  } catch (err) {
    error(res, err.status || 500, err.status === 401 ? "invalid_login" : "internal_error", err.message || "Unable to login.");
  } finally {
    connection.release();
  }
}

async function handleCloudUsersList(req, res, device) {
  const connection = await pool.getConnection();
  try {
    await ensureDefaultAccessRoles(connection, device, req);
    ok(res, { users: await listCloudUsers(connection, device.business_id) });
  } finally {
    connection.release();
  }
}

async function handleCloudUserSave(req, res, device) {
  const body = await readBody(req);
  const displayName = requiredText(body.displayName, "Display name").slice(0, 100);
  const username = normalizeUsername(body.username);
  const role = body.role === "owner" ? "owner" : "staff";
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return error(res, 422, "validation_error", "Username must be 3-32 characters using letters, numbers, dot, underscore, or hyphen.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const userId = String(body.id || uuid()).slice(0, 36);
    const current = await loadBusinessRecord(connection, device.business_id, "users", userId, true);
    if (!current && !body.password) throw Object.assign(new Error("Password is required for new users."), { status: 422 });
    const duplicate = (await loadBusinessRecords(connection, device.business_id, "users"))
      .find((row) => row.recordId !== userId && normalizeUsername(row.data.username) === username);
    if (duplicate) throw Object.assign(new Error("Username is already used by another account."), { status: 422 });
    if (current?.data.role === "owner" && (role !== "owner" || body.active === false)) {
      const activeOwners = (await loadBusinessRecords(connection, device.business_id, "users")).filter((row) => row.recordId !== userId && row.data.role === "owner" && row.data.active !== false);
      if (!activeOwners.length) throw Object.assign(new Error("At least one active owner account is required."), { status: 422 });
    }
    const now = nowIso();
    const secret = body.password ? hashPassword(validatePassword(body.password)) : { passwordHash: current.data.passwordHash, salt: current.data.salt };
    const user = {
      ...(current?.data || {}),
      id: userId,
      displayName,
      username,
      role,
      accessRoleId: await resolveCloudAccessRole(connection, device.business_id, role, body.accessRoleId),
      passwordHash: secret.passwordHash,
      salt: secret.salt,
      active: body.active === false ? false : true,
      createdAt: current?.data.createdAt || now,
      updatedAt: now
    };
    await persistBusinessRecord(connection, device, req, "users", userId, user, "UPSERT", current ? "USER_UPDATED" : "USER_INSERTED");
    const roleMap = new Map((await listCloudAccessRoles(connection, device.business_id)).map((roleRow) => [roleRow.id, roleRow]));
    await connection.commit();
    ok(res, { user: publicUserFromData(user, roleMap) }, current ? 200 : 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to save user.");
  } finally {
    connection.release();
  }
}

async function handleCloudUserDeactivate(req, res, device, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, "users", userId, true);
    if (!current) throw Object.assign(new Error("User account not found."), { status: 404 });
    if (current.data.role === "owner") {
      const activeOwners = (await loadBusinessRecords(connection, device.business_id, "users")).filter((row) => row.recordId !== userId && row.data.role === "owner" && row.data.active !== false);
      if (!activeOwners.length) throw Object.assign(new Error("At least one active owner account is required."), { status: 422 });
    }
    await persistBusinessRecord(connection, device, req, "users", userId, { ...current.data, active: false, updatedAt: nowIso() }, "UPSERT", "USER_DEACTIVATED");
    await connection.commit();
    noContent(res);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to deactivate user.");
  } finally {
    connection.release();
  }
}

async function handleCloudUserChangePassword(req, res, device, userId) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, "users", userId, true);
    if (!current) throw Object.assign(new Error("User account not found."), { status: 404 });
    if (body.currentPassword && !verifyPassword(body.currentPassword, current.data.salt, current.data.passwordHash)) {
      throw Object.assign(new Error("Current password is incorrect."), { status: 422 });
    }
    const secret = hashPassword(validatePassword(body.newPassword));
    await persistBusinessRecord(connection, device, req, "users", userId, { ...current.data, ...secret, updatedAt: nowIso() }, "UPSERT", "USER_PASSWORD_CHANGED");
    await connection.commit();
    ok(res, { ok: true });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to change password.");
  } finally {
    connection.release();
  }
}

async function handleCloudRolesList(req, res, device) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const roles = await listCloudAccessRoles(connection, device.business_id);
    await connection.commit();
    ok(res, { roles });
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, "internal_error", err.message || "Unable to load roles.");
  } finally {
    connection.release();
  }
}

async function handleCloudRoleSave(req, res, device) {
  const body = await readBody(req);
  const name = requiredText(body.name, "Role name").slice(0, 100);
  const permissions = normalizePermissions(body.permissions);
  if (!permissions.length) return error(res, 422, "validation_error", "Select at least one permission for this role.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const roleId = String(body.id || uuid()).slice(0, 36);
    const current = await loadBusinessRecord(connection, device.business_id, "access_roles", roleId, true);
    if (current?.data.locked) throw Object.assign(new Error("This role is locked and cannot be edited."), { status: 422 });
    const duplicate = (await loadBusinessRecords(connection, device.business_id, "access_roles"))
      .find((row) => row.recordId !== roleId && String(row.data.name || "").toLowerCase() === name.toLowerCase());
    if (duplicate) throw Object.assign(new Error("A role with this name already exists."), { status: 422 });
    const now = nowIso();
    const role = {
      id: roleId,
      name,
      description: String(body.description || ""),
      permissions,
      locked: false,
      active: body.active === false ? false : true,
      createdAt: current?.data.createdAt || now,
      updatedAt: now
    };
    if (current && role.active === false) {
      const assigned = (await loadBusinessRecords(connection, device.business_id, "users")).filter((row) => row.data.accessRoleId === roleId && row.data.active !== false);
      if (assigned.length) throw Object.assign(new Error("This role is assigned to active staff. Move those users to another role first."), { status: 422 });
    }
    await persistBusinessRecord(connection, device, req, "access_roles", roleId, role, "UPSERT", current ? "ACCESS_ROLE_UPDATED" : "ACCESS_ROLE_INSERTED");
    await connection.commit();
    ok(res, { role: mapCloudAccessRole(role) }, current ? 200 : 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to save role.");
  } finally {
    connection.release();
  }
}

async function handleCloudRoleDeactivate(req, res, device, roleId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, "access_roles", roleId, true);
    if (!current) throw Object.assign(new Error("Role not found."), { status: 404 });
    if (current.data.locked) throw Object.assign(new Error("This role is locked and cannot be deactivated."), { status: 422 });
    const assigned = (await loadBusinessRecords(connection, device.business_id, "users")).filter((row) => row.data.accessRoleId === roleId && row.data.active !== false);
    if (assigned.length) throw Object.assign(new Error("This role is assigned to active staff. Move those users to another role first."), { status: 422 });
    await persistBusinessRecord(connection, device, req, "access_roles", roleId, { ...current.data, active: false, updatedAt: nowIso() }, "UPSERT", "ACCESS_ROLE_DEACTIVATED");
    await connection.commit();
    noContent(res);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to deactivate role.");
  } finally {
    connection.release();
  }
}

async function handlePush(req, res, device) {
  const body = await readBody(req);
  const operations = Array.isArray(body.operations) ? body.operations : [];
  if (!operations.length) return error(res, 422, "validation_error", "At least one sync operation is required.");
  const connection = await pool.getConnection();
  const canonicalRows = [];
  let newRevision = 0;
  try {
    await connection.beginTransaction();
    for (const op of operations) {
      const idempotencyKey = String(op.idempotencyKey || "");
      const entity = String(op.entity || "");
      const recordId = String(op.localId || op.recordId || "");
      const type = op.type === "DELETE" ? "DELETE" : "UPSERT";
      if (!idempotencyKey || !entity || !isRecordId(recordId)) throw Object.assign(new Error("Invalid sync operation."), { status: 422 });

      const [existingIdempotency] = await connection.query(
        "SELECT response_json FROM idempotency_keys WHERE idempotency_key = ? AND business_id = ? LIMIT 1",
        [idempotencyKey, device.business_id]
      );
      if (existingIdempotency.length) {
        const idempotentResponse = parseJsonColumn(existingIdempotency[0].response_json, { canonicalRows: [], newRevision: 0 });
        canonicalRows.push(...(idempotentResponse.canonicalRows || []));
        newRevision = Math.max(newRevision, Number(idempotentResponse.newRevision || 0));
        continue;
      }

      const [records] = await connection.query(
        "SELECT * FROM business_records WHERE business_id = ? AND entity = ? AND record_id = ? LIMIT 1 FOR UPDATE",
        [device.business_id, entity, recordId]
      );
      const current = records[0] || null;
      if (current && Number(current.revision) > Number(op.baseRevision || 0)) {
        const conflictId = uuid();
        const serverVersion = parseJsonColumn(current.data, {});
        await connection.rollback();
        await pool.query(
          `INSERT INTO sync_conflicts (id, business_id, device_id, entity, record_id, local_version, server_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [conflictId, device.business_id, device.id, entity, recordId, JSON.stringify(op.data || {}), JSON.stringify(serverVersion)]
        );
        return json(res, 409, {
          error: { code: "sync_conflict", message: "Cloud has a newer version of this record." },
          data: { conflictId, entity, localId: recordId, localVersion: op.data || {}, serverVersion }
        });
      }

      const canonicalData = await canonicalizeOperation(connection, device.business_id, { ...op, entity, data: op.data || {} });
      const revisionOperation = operationKind(type, Boolean(current));
      const deletedAt = type === "DELETE" ? new Date() : null;
      const [revisionResult] = await connection.query(
        `INSERT INTO sync_revisions (business_id, device_id, entity, operation, record_id, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [device.business_id, device.id, entity, revisionOperation, recordId, JSON.stringify(canonicalData)]
      );
      const revision = Number(revisionResult.insertId);
      await connection.query(
        `INSERT INTO business_records (business_id, entity, record_id, data, revision, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), revision = VALUES(revision), deleted_at = VALUES(deleted_at)`,
        [device.business_id, entity, recordId, JSON.stringify(canonicalData), revision, deletedAt]
      );
      await connection.query(
        `INSERT INTO audit_log (business_id, device_id, action, entity, entity_id, before_state, after_state, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          device.business_id,
          device.id,
          `${entity.toUpperCase()}_${revisionOperation}`,
          entity,
          recordId,
          JSON.stringify(current ? parseJsonColumn(current.data, null) : null),
          JSON.stringify(canonicalData),
          req.socket.remoteAddress || ""
        ]
      );
      const row = { entity, localId: recordId, recordId, revision };
      if (canonicalData.invoiceNumber) row.invoiceNumber = canonicalData.invoiceNumber;
      if (canonicalData.quotationNumber) row.quotationNumber = canonicalData.quotationNumber;
      if (canonicalData.jobNumber) row.jobNumber = canonicalData.jobNumber;
      canonicalRows.push(row);
      newRevision = Math.max(newRevision, revision);
      await connection.query(
        "INSERT INTO idempotency_keys (idempotency_key, business_id, device_id, response_json) VALUES (?, ?, ?, ?)",
        [idempotencyKey, device.business_id, device.id, JSON.stringify({ newRevision, canonicalRows: [row] })]
      );
    }
    await connection.commit();
    ok(res, { newRevision, canonicalRows });
  } catch (err) {
    await connection.rollback();
    const status = err.status || 500;
    error(res, status, status === 422 ? "validation_error" : "internal_error", status === 422 ? err.message : "Cloud sync push failed.");
  } finally {
    connection.release();
  }
}

async function handlePull(req, res, device, url) {
  const sinceRevision = Math.max(0, Number(url.searchParams.get("sinceRevision") || 0));
  const [records] = await pool.query(
    `SELECT br.entity, br.record_id AS recordId, br.data, br.revision, br.deleted_at AS deletedAt
     FROM business_records br
     WHERE br.business_id = ? AND br.revision > ?
     ORDER BY br.revision ASC
     LIMIT 500`,
    [device.business_id, sinceRevision]
  );
  const newRevision = records.reduce((max, row) => Math.max(max, Number(row.revision || 0)), sinceRevision);
  ok(res, { newRevision, records });
}

async function handleInvoiceFinalize(req, res, device) {
  const body = await readBody(req);
  const idempotencyKey = String(body.idempotencyKey || "").slice(0, 80);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (idempotencyKey) {
      const [existingIdempotency] = await connection.query(
        "SELECT response_json FROM idempotency_keys WHERE idempotency_key = ? AND business_id = ? LIMIT 1",
        [idempotencyKey, device.business_id]
      );
      if (existingIdempotency.length) {
        await connection.commit();
        return ok(res, parseJsonColumn(existingIdempotency[0].response_json, {}));
      }
    }
    const responseBody = await createFinalInvoiceGraph(connection, device, req, body);
    if (idempotencyKey) {
      await connection.query(
        "INSERT INTO idempotency_keys (idempotency_key, business_id, device_id, response_json) VALUES (?, ?, ?, ?)",
        [idempotencyKey, device.business_id, device.id, JSON.stringify(responseBody)]
      );
    }
    await connection.commit();
    ok(res, responseBody, 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.status === 422 ? "validation_error" : "internal_error", err.message || "Unable to finalize invoice.");
  } finally {
    connection.release();
  }
}

async function handleFileUpload(req, res, device) {
  const body = await readBody(req);
  const dataBase64 = String(body.dataBase64 || "").replace(/\s/g, "");
  if (!dataBase64) return error(res, 422, "validation_error", "dataBase64 is required.");
  if (dataBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
    return error(res, 422, "validation_error", "dataBase64 must be valid base64.");
  }
  const data = Buffer.from(dataBase64, "base64");
  if (!data.length) return error(res, 422, "validation_error", "dataBase64 is required.");
  const fileType = String(body.fileType || "PHOTO").toUpperCase();
  if (!FILE_TYPES.has(fileType)) return error(res, 422, "validation_error", "Unsupported file type.");
  const fileId = uuid();
  const { ext, mimeType } = validateUpload(fileType, body.originalName, data);
  const businessDir = path.join(UPLOAD_DIR, String(device.business_id));
  fs.mkdirSync(businessDir, { recursive: true });
  const storagePath = path.join(businessDir, `${fileId}${ext}`);
  fs.writeFileSync(storagePath, data);
  const digest = sha256(data);
  if (body.sha256 && body.sha256 !== digest) {
    fs.unlinkSync(storagePath);
    return error(res, 422, "hash_mismatch", "Uploaded file hash does not match.");
  }
  await pool.query(
    `INSERT INTO file_metadata
      (id, business_id, entity, entity_id, file_type, original_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      device.business_id,
      String(body.entity || ""),
      String(body.entityId || ""),
      fileType,
      String(body.originalName || ""),
      mimeType,
      data.length,
      digest,
      storagePath,
      device.id
    ]
  );
  ok(res, { fileId, sha256: digest, sizeBytes: data.length, originalName: String(body.originalName || ""), mimeType }, 201, { location: `/api/v1/files/${fileId}` });
}

async function handleFileDownload(res, device, fileId) {
  const [rows] = await pool.query("SELECT * FROM file_metadata WHERE id = ? AND business_id = ? LIMIT 1", [fileId, device.business_id]);
  const file = rows[0];
  if (!file || !fs.existsSync(file.storage_path)) return error(res, 404, "not_found", "File was not found.");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": file.mime_type || "application/octet-stream",
    "x-file-sha256": file.sha256 || "",
    "cache-control": "private, no-store"
  });
  fs.createReadStream(file.storage_path).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      return ok(res, { ok: true, version: API_VERSION, serverTime: new Date().toISOString() });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/auth/devices") return handleDeviceRegistration(req, res);
    if (req.method === "GET" && url.pathname === "/api/v1/auth/devices/current/status") return handleCurrentDeviceApprovalStatus(req, res);
    if (req.method === "DELETE" && url.pathname === "/api/v1/auth/devices/current") return handleCurrentDeviceDisconnect(req, res);
    const device = await requireDevice(req, res);
    if (!device) return;
    if (req.method === "POST" && url.pathname === "/api/v1/admin/devices/list") return handleAdminDevicesList(req, res, device);
    const adminDeviceApproveMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/approve$/.exec(url.pathname);
    if (adminDeviceApproveMatch && req.method === "POST") return handleAdminDeviceApprove(req, res, device, adminDeviceApproveMatch[1]);
    const adminDeviceRevokeMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/revoke$/.exec(url.pathname);
    if (adminDeviceRevokeMatch && req.method === "POST") return handleAdminDeviceRevoke(req, res, device, adminDeviceRevokeMatch[1]);
    if (req.method === "GET" && url.pathname === "/api/v1/auth/status") return handleCloudAuthStatus(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/auth/setup-owner") return handleCloudSetupOwner(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/auth/login") return handleCloudLogin(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/users") return handleCloudUsersList(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/users") return handleCloudUserSave(req, res, device);
    const userMatch = /^\/api\/v1\/users\/([^/]+)$/.exec(url.pathname);
    if (userMatch && req.method === "DELETE") return handleCloudUserDeactivate(req, res, device, userMatch[1]);
    const userPasswordMatch = /^\/api\/v1\/users\/([^/]+)\/change-password$/.exec(url.pathname);
    if (userPasswordMatch && req.method === "POST") return handleCloudUserChangePassword(req, res, device, userPasswordMatch[1]);
    if (req.method === "GET" && url.pathname === "/api/v1/access-roles") return handleCloudRolesList(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/access-roles") return handleCloudRoleSave(req, res, device);
    const roleMatch = /^\/api\/v1\/access-roles\/([^/]+)$/.exec(url.pathname);
    if (roleMatch && req.method === "DELETE") return handleCloudRoleDeactivate(req, res, device, roleMatch[1]);
    if (req.method === "POST" && url.pathname === "/api/v1/sync/push") return handlePush(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/sync/pull") return handlePull(req, res, device, url);
    const recordCollectionMatch = /^\/api\/v1\/records\/([^/]+)$/.exec(url.pathname);
    if (recordCollectionMatch && req.method === "GET") return handleRecordsList(req, res, device, url, recordCollectionMatch[1]);
    if (recordCollectionMatch && req.method === "POST") return handleRecordCreate(req, res, device, recordCollectionMatch[1]);
    const recordItemMatch = /^\/api\/v1\/records\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (recordItemMatch && req.method === "GET") return handleRecordGet(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    if (recordItemMatch && req.method === "PATCH") return handleRecordPatch(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    if (recordItemMatch && req.method === "DELETE") return handleRecordDelete(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    if (req.method === "GET" && url.pathname === "/api/v1/dashboard") return handleDashboard(res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/reports") return handleReports(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/profit") return handleProfit(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/invoices") return handleInvoicesList(req, res, device, url);
    if (req.method === "POST" && url.pathname === "/api/v1/invoices/finalize") return handleInvoiceFinalize(req, res, device);
    const invoiceMatch = /^\/api\/v1\/invoices\/([^/]+)$/.exec(url.pathname);
    if (invoiceMatch && req.method === "GET") return handleInvoiceGet(res, device, invoiceMatch[1]);
    const invoicePaymentMatch = /^\/api\/v1\/invoices\/([^/]+)\/payments$/.exec(url.pathname);
    if (invoicePaymentMatch && req.method === "POST") return handleInvoicePayment(req, res, device, invoicePaymentMatch[1]);
    const invoiceCancelMatch = /^\/api\/v1\/invoices\/([^/]+)\/cancel$/.exec(url.pathname);
    if (invoiceCancelMatch && req.method === "POST") return handleInvoiceCancel(req, res, device, invoiceCancelMatch[1]);
    const invoiceItemMatch = /^\/api\/v1\/invoices\/([^/]+)\/items$/.exec(url.pathname);
    if (invoiceItemMatch && req.method === "POST") return handleInvoiceAppendItem(req, res, device, invoiceItemMatch[1]);
    const quotationConvertMatch = /^\/api\/v1\/quotations\/([^/]+)\/convert-to-invoice$/.exec(url.pathname);
    if (quotationConvertMatch && req.method === "POST") return handleQuotationConvertToInvoice(req, res, device, quotationConvertMatch[1]);
    const jobCardConvertMatch = /^\/api\/v1\/job-cards\/([^/]+)\/convert-to-invoice$/.exec(url.pathname);
    if (jobCardConvertMatch && req.method === "POST") return handleJobCardConvertToInvoice(req, res, device, jobCardConvertMatch[1]);
    if (req.method === "GET" && url.pathname === "/api/v1/inventory/dashboard") return handleInventoryDashboard(res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/inventory/purchases") return handleInventoryPurchase(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/inventory/movements") return handleInventoryMovement(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/sync/conflicts") {
      const [rows] = await pool.query("SELECT * FROM sync_conflicts WHERE business_id = ? AND device_id = ? AND status = 'OPEN' ORDER BY created_at DESC", [device.business_id, device.id]);
      return ok(res, { conflicts: rows });
    }
    const conflictMatch = /^\/api\/v1\/sync\/conflicts\/([^/]+)\/resolve$/.exec(url.pathname);
    if (req.method === "POST" && conflictMatch) {
      const body = await readBody(req);
      await pool.query("UPDATE sync_conflicts SET status = 'RESOLVED', resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?", [body.resolution || "MANUAL", conflictMatch[1], device.business_id]);
      return ok(res, { conflictId: conflictMatch[1], status: "RESOLVED", resolution: body.resolution || "MANUAL" });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/files") return handleFileUpload(req, res, device);
    const fileMatch = /^\/api\/v1\/files\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && fileMatch) return handleFileDownload(res, device, fileMatch[1]);
    return error(res, 404, "not_found", "Endpoint was not found.");
  } catch (err) {
    return errorFromThrown(res, err);
  }
}

(async () => {
  await migrate();
  if (process.argv.includes("--migrate")) {
    console.log("Cloud sync schema migrated.");
    await pool.end();
    return;
  }
  http.createServer((req, res) => void route(req, res)).listen(PORT, () => {
    console.log(`Autocare24 cloud sync API listening on port ${PORT}`);
  });
})();
