"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { Readable } = require("node:stream");
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

const RUNTIME_ENV = String(process.env.NODE_ENV || process.env.APP_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = RUNTIME_ENV === "production" || RUNTIME_ENV === "prod";
const envFlag = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
};
const isFilesystemRoot = (value) => {
  const parsed = path.parse(value);
  return Boolean(value && parsed.root && path.resolve(value) === path.resolve(parsed.root));
};
const resolveUploadDir = () => {
  const configured = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
  const resolved = path.resolve(configured);
  if (isFilesystemRoot(resolved)) {
    throw new Error("UPLOAD_DIR must point to a dedicated directory, not the filesystem root.");
  }
  return resolved;
};

const PORT = Number(process.env.PORT || 8080);
const REGISTRATION_KEY = process.env.SYNC_REGISTRATION_KEY || "";
const UPLOAD_DIR = resolveUploadDir();
const API_VERSION = "v1";
const envPositiveInt = (name, fallback) => {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_BODY_BYTES = envPositiveInt("MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);
const AUTH_RATE_LIMIT_WINDOW_MS = envPositiveInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = envPositiveInt("AUTH_RATE_LIMIT_MAX", 10);
const RATE_LIMIT_MAX_BUCKETS = envPositiveInt("RATE_LIMIT_MAX_BUCKETS", 50_000);
const DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS = envPositiveInt("DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const DEVICE_REGISTRATION_RATE_LIMIT_MAX = envPositiveInt("DEVICE_REGISTRATION_RATE_LIMIT_MAX", 10);
const HEALTHCHECK_DB_TIMEOUT_MS = envPositiveInt("HEALTHCHECK_DB_TIMEOUT_MS", 3000);
const USER_SESSION_TTL_MS = envPositiveInt("USER_SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000);
const USER_SESSION_HEADER = "x-autocare-user-token";
const TOKEN_HASH_SECRET = String(process.env.TOKEN_HASH_SECRET || "").trim();
const ALLOW_LEGACY_TOKEN_MIGRATION = envFlag("ALLOW_LEGACY_TOKEN_MIGRATION", !IS_PRODUCTION);
const WHATSAPP_GRAPH_BASE_URL = String(process.env.WHATSAPP_API_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");
const WHATSAPP_GRAPH_VERSION = String(process.env.WHATSAPP_GRAPH_VERSION || "v20.0").replace(/^\/+/, "");
const WHATSAPP_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_DOCUMENT_MAX_BYTES = envPositiveInt("WHATSAPP_DOCUMENT_MAX_BYTES", 18 * 1024 * 1024);
const UPDATE_FEED_PREFIX = "/updates/win";
const GITHUB_RELEASE_TOKEN = String(process.env.GITHUB_RELEASE_TOKEN || process.env.GH_TOKEN || "").trim();
const GITHUB_RELEASE_OWNER = String(process.env.GITHUB_RELEASE_OWNER || "kishoresharmaks").trim();
const GITHUB_RELEASE_REPO = String(process.env.GITHUB_RELEASE_REPO || "autocare24_billing").trim();
const GITHUB_RELEASE_TAG = String(process.env.GITHUB_RELEASE_TAG || "").trim();
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

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_NAME = process.env.DB_NAME || (IS_PRODUCTION ? "" : "autocare24_sync");
const DB_USER = process.env.DB_USER || (IS_PRODUCTION ? "" : "root");
const DB_PASSWORD = process.env.DB_PASSWORD || "";

const validateRuntimeConfig = () => {
  const warnings = [];
  if (!TOKEN_HASH_SECRET) {
    if (IS_PRODUCTION) {
      throw new Error("TOKEN_HASH_SECRET is required when NODE_ENV=production.");
    }
    warnings.push("TOKEN_HASH_SECRET is not set; device tokens will use legacy SHA-256 hashes in non-production only.");
  }
  if (IS_PRODUCTION) {
    if (!DB_HOST) throw new Error("DB_HOST is required when NODE_ENV=production.");
    if (!DB_NAME) throw new Error("DB_NAME is required when NODE_ENV=production.");
    if (!DB_USER) throw new Error("DB_USER is required when NODE_ENV=production.");
    if (DB_USER.toLowerCase() === "root" && !envFlag("ALLOW_DB_ROOT_USER", false)) {
      throw new Error("DB_USER=root is not allowed in production. Use a dedicated database user.");
    }
    if (!DB_PASSWORD) throw new Error("DB_PASSWORD is required when NODE_ENV=production.");
    if (ALLOW_LEGACY_TOKEN_MIGRATION) {
      warnings.push("ALLOW_LEGACY_TOKEN_MIGRATION is enabled in production; keep it temporary and turn it off after devices reconnect.");
    }
  }
  warnings.forEach((message) => console.warn(`[config] ${message}`));
};

validateRuntimeConfig();

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
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
const rejectBrowserOrigin = (req, res) => {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return false;
  error(res, 403, "browser_origin_not_allowed", "This API is desktop-only and does not accept browser Origin requests.");
  return true;
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmacSha256 = (value) => crypto.createHmac("sha256", TOKEN_HASH_SECRET).update(value).digest("hex");
const hashToken = (value) => TOKEN_HASH_SECRET ? hmacSha256(value) : sha256(value);
const tokenHashCandidates = (value) => {
  const primary = hashToken(value);
  if (!TOKEN_HASH_SECRET || !ALLOW_LEGACY_TOKEN_MIGRATION) return [primary];
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
const MONEY_SCALE = 100n;
const GST_RATE_SCALE = 10000n;
const DEFAULT_SAC_CODE = "9987";
const normalizeSacCode = (value, fallback = DEFAULT_SAC_CODE) => {
  const code = String(value ?? "").trim();
  return /^\d{4,8}$/.test(code) ? code : fallback;
};
const expandExponential = (value) => {
  const [coefficient, exponentValue] = value.toLowerCase().split("e");
  const exponent = Number(exponentValue);
  if (!Number.isInteger(exponent)) return value;
  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsignedCoefficient = coefficient.replace(/^-/, "");
  const [integerPart, fractionalPart = ""] = unsignedCoefficient.split(".");
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalIndex = integerPart.length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
};
const toScaledInteger = (value, decimals) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0n;
  const normalized = expandExponential(number.toString());
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsignedValue = normalized.replace(/^-/, "");
  const [integerPart = "0", fractionalPart = ""] = unsignedValue.split(".");
  const scale = 10n ** BigInt(decimals);
  const normalizedInteger = integerPart.replace(/\D/g, "") || "0";
  const normalizedFraction = fractionalPart.replace(/\D/g, "");
  const scaledFraction = normalizedFraction.padEnd(decimals + 1, "0");
  const baseFraction = scaledFraction.slice(0, decimals) || "0";
  const roundingDigit = Number(scaledFraction[decimals] || "0");
  const base = BigInt(normalizedInteger) * scale + BigInt(baseFraction);
  return sign * (base + (roundingDigit >= 5 ? 1n : 0n));
};
const divideRounded = (numerator, denominator) => {
  if (denominator === 0n) return 0n;
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return sign * rounded;
};
const compareBigIntDescending = (left, right) => (left === right ? 0 : left > right ? -1 : 1);
const money = (value) => Number(toScaledInteger(value, 2)) / Number(MONEY_SCALE);
const nowIso = () => new Date().toISOString();
const localDate = (date = new Date()) => {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
};
const dateOnly = (value) => String(value || "").slice(0, 10);
const CUSTOMER_CODE_PREFIX = "CUS";
const CUSTOMER_CODE_PAD_LENGTH = 5;
const formatCustomerCode = (number) => `${CUSTOMER_CODE_PREFIX}-${String(number).padStart(CUSTOMER_CODE_PAD_LENGTH, "0")}`;
const customerCodeNumber = (code) => {
  const match = /^CUS-(\d+)$/i.exec(String(code || "").trim());
  return match ? Number(match[1]) : 0;
};
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
const OPERATOR_ACCESS_ROLE_ID = "operator";
const BUSINESS_DIRECTOR_ACCESS_ROLE_ID = "business-director";
const INVESTOR_ACCESS_ROLE_ID = "investor";
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
const OPERATOR_PERMISSIONS = [
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
  "jobCards.photos",
  "enquiries.view",
  "enquiries.manage",
  "enquiries.convert",
  "services.view",
  "stock.view",
  "stock.adjust",
  "documents.printPdf",
  "sharing.whatsapp"
];
const BUSINESS_DIRECTOR_PERMISSIONS = ALL_PERMISSION_KEYS.filter((permission) => permission !== "developer.access");
const INVESTOR_PERMISSIONS = ["dashboard.view", "reports.view", "reports.export"];
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
    description: "Broad daily operations access for billing, job cards, enquiries, services, stock, reports, document sharing, and CSV exports.",
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
      "reports.view",
      "reports.export",
      "documents.printPdf",
      "sharing.whatsapp",
      "exports.csv"
    ],
    locked: false,
    active: true
  },
  {
    id: OPERATOR_ACCESS_ROLE_ID,
    name: "Operator",
    description: "Daily counter and operations access for billing, customers, job cards, enquiries, stock removal, documents, and WhatsApp.",
    permissions: OPERATOR_PERMISSIONS,
    locked: false,
    active: true
  },
  {
    id: BUSINESS_DIRECTOR_ACCESS_ROLE_ID,
    name: "Business Director",
    description: "Business management access for operations, reports, expenses, settings, users, backups, and exports without developer repair tools.",
    permissions: BUSINESS_DIRECTOR_PERMISSIONS,
    locked: false,
    active: true
  },
  {
    id: INVESTOR_ACCESS_ROLE_ID,
    name: "Investor",
    description: "Read-only business visibility for dashboards and report exports.",
    permissions: INVESTOR_PERMISSIONS,
    locked: false,
    active: true
  },
  {
    id: "billing-staff",
    name: "Billing Staff",
    description: "Counter billing access for bills, corrections, cancellations, payments, quotations, customers, job cards, print/PDF, and WhatsApp.",
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
    description: "Stock control access for inventory, purchases, purchase records, adjustments, suppliers, stock reports, and inventory exports.",
    permissions: ["dashboard.view", "stock.view", "stock.manageItems", "stock.purchase", "stock.adjust", "stock.suppliers", "reports.view", "reports.export", "exports.csv"],
    locked: false,
    active: true
  }
];
const DEFAULT_ROLE_PERMISSION_REFRESH_IDS = new Set([STAFF_OPERATIONS_ROLE_ID, "billing-staff", "stock-staff"]);

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
const PAID_AMOUNT_EXCEEDS_TOTAL_MESSAGE = "Entered paid amount is greater than billed amount.";
const rateLimitKey = (scope, req) => `${scope}:${getRequestIp(req) || "unknown"}`;
const enforceRateLimit = (req, scope, options = {}) => {
  const limit = options.limit || AUTH_RATE_LIMIT_MAX;
  const windowMs = options.windowMs || AUTH_RATE_LIMIT_WINDOW_MS;
  const now = Date.now();
  const key = rateLimitKey(scope, req);
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      cleanupRateLimits();
      if (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
        throwHttpError(429, "rate_limited", "Too many clients are attempting requests. Try again later.");
      }
    }
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
const rolePermissionsFromData = (role = {}, fallback = []) => {
  const direct = normalizePermissions(role.permissions);
  if (direct.length) return direct;
  const json = role.permissionsJson ?? role.permissions_json;
  if (Array.isArray(json)) return normalizePermissions(json);
  if (typeof json === "string" && json.trim()) return normalizePermissions(parseJsonColumn(json, []));
  return normalizePermissions(fallback);
};
const recordFlag = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};
const validatePassword = (password) => {
  const text = String(password || "");
  if (text.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { status: 422 });
  if (text.length > 128) throw Object.assign(new Error("Password must be 128 characters or fewer."), { status: 422 });
  if (!/[A-Za-z]/.test(text) || !/\d/.test(text)) {
    throw Object.assign(new Error("Password must include at least one letter and one number."), { status: 422 });
  }
  if (/^(.)\1+$/.test(text)) throw Object.assign(new Error("Password is too easy to guess."), { status: 422 });
  const commonPasswords = new Set(["password", "password1", "password123", "admin123", "autocare123", "qwerty123", "welcome123"]);
  if (commonPasswords.has(text.toLowerCase())) throw Object.assign(new Error("Password is too common."), { status: 422 });
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

const toCents = (value) => toScaledInteger(value, 2);
const fromCents = (value) => Number(value) / Number(MONEY_SCALE);
const toGstRateUnits = (value) => toScaledInteger(value, 4);
const calculatePercentCents = (amountCents, ratePercent) =>
  divideRounded(amountCents * toGstRateUnits(ratePercent), 100n * GST_RATE_SCALE);
const allocateProportionalCents = (amountCents, weights) => {
  const normalizedAmount = amountCents > 0n ? amountCents : 0n;
  const normalizedWeights = weights.map((weight) => (weight > 0n ? weight : 0n));
  const totalWeight = normalizedWeights.reduce((total, weight) => total + weight, 0n);
  if (!normalizedAmount || !totalWeight) return weights.map(() => 0n);
  const allocations = normalizedWeights.map((weight, index) => {
    const weightedAmount = normalizedAmount * weight;
    return { index, base: weightedAmount / totalWeight, remainder: weightedAmount % totalWeight, weight };
  });
  let remaining = normalizedAmount - allocations.reduce((total, item) => total + item.base, 0n);
  allocations
    .slice()
    .sort((a, b) => compareBigIntDescending(a.remainder, b.remainder) || compareBigIntDescending(a.weight, b.weight) || a.index - b.index)
    .forEach((item) => {
      if (remaining <= 0n) return;
      item.base += 1n;
      remaining -= 1n;
    });
  return allocations.sort((a, b) => a.index - b.index).map((item) => item.base);
};
const calculateInvoiceTotals = (invoiceMode, taxScope, items, rawDiscount) => {
  const normalizedMode = normalizeInvoiceMode(invoiceMode);
  const normalizedTaxScope = normalizeTaxScope(taxScope);
  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    const quantityCents = toCents(finiteNumber(item.quantity));
    const unitPriceCents = toCents(finiteNumber(item.unitPrice));
    const lineSubTotalCents = divideRounded(quantityCents * unitPriceCents, MONEY_SCALE);
    return {
      ...item,
      description: String(item.description || "").trim(),
      quantity: fromCents(quantityCents),
      unitPrice: fromCents(unitPriceCents),
      gstRate: normalizedMode === "gst" ? money(finiteNumber(item.gstRate || 0)) : 0,
      sacCode: normalizeSacCode(item.sacCode),
      lineSubTotal: fromCents(lineSubTotalCents),
      lineSubTotalCents
    };
  }).filter((item) => item.description || item.serviceId || item.inventoryItemId || item.lineSubTotalCents > 0n);
  if (!normalized.length) throw Object.assign(new Error("Add at least one invoice item."), { status: 422 });
  const subTotalCents = normalized.reduce((sum, item) => sum + item.lineSubTotalCents, 0n);
  const subTotal = fromCents(subTotalCents);
  const discountCents = toCents(Math.min(Math.max(finiteNumber(rawDiscount), 0), subTotal));
  const taxableBaseCents = subTotalCents - discountCents;
  const taxableBase = fromCents(taxableBaseCents);
  const taxableLineCents = allocateProportionalCents(
    taxableBaseCents,
    normalized.map((item) => item.lineSubTotalCents)
  );
  const calculatedItems = normalized.map((item, index) => {
    const lineTaxableCents = taxableLineCents[index] || 0n;
    const lineTaxCents = normalizedMode === "gst" ? calculatePercentCents(lineTaxableCents, item.gstRate) : 0n;
    const { lineSubTotalCents, ...publicItem } = item;
    return { ...publicItem, lineTax: fromCents(lineTaxCents), lineTotal: fromCents(lineTaxableCents + lineTaxCents) };
  });
  const totalTaxCents = calculatedItems.reduce((sum, item) => sum + toCents(item.lineTax), 0n);
  const cgstCents = normalizedMode === "gst" && normalizedTaxScope === "intra" ? divideRounded(totalTaxCents, 2n) : 0n;
  const sgstCents = normalizedMode === "gst" && normalizedTaxScope === "intra" ? totalTaxCents - cgstCents : 0n;
  const igstCents = normalizedMode === "gst" && normalizedTaxScope === "inter" ? totalTaxCents : 0n;
  return {
    items: calculatedItems,
    subTotal,
    discount: fromCents(discountCents),
    taxableValue: normalizedMode === "gst" ? taxableBase : 0,
    cgst: fromCents(cgstCents),
    sgst: fromCents(sgstCents),
    igst: fromCents(igstCents),
    totalTax: fromCents(totalTaxCents),
    grandTotal: fromCents(taxableBaseCents + totalTaxCents)
  };
};

async function readRawBody(req) {
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
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  const text = raw.toString("utf8");
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

const isInsideDirectory = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
};

const businessUploadDirectory = (businessId) => {
  const safeBusinessId = String(businessId || "").trim();
  if (!/^\d{1,20}$/.test(safeBusinessId)) {
    throwHttpError(500, "server_misconfigured", "Business upload directory could not be resolved safely.");
  }
  const resolved = path.resolve(UPLOAD_DIR, safeBusinessId);
  if (!isInsideDirectory(UPLOAD_DIR, resolved)) {
    throwHttpError(500, "server_misconfigured", "Business upload directory escaped the configured upload root.");
  }
  return resolved;
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

async function ensureIndex(connection, table, indexName, definition) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  if (rows.length) return false;
  await connection.query(`ALTER TABLE ${table} ADD INDEX ${indexName} ${definition}`);
  return true;
}

async function ensurePrimaryKey(connection, table, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    [table]
  );
  const currentColumns = rows.map((row) => String(row.COLUMN_NAME || row.column_name || ""));
  if (JSON.stringify(currentColumns) === JSON.stringify(columns)) return false;
  const columnList = columns.join(", ");
  await connection.query(
    currentColumns.length
      ? `ALTER TABLE ${table} DROP PRIMARY KEY, ADD PRIMARY KEY (${columnList})`
      : `ALTER TABLE ${table} ADD PRIMARY KEY (${columnList})`
  );
  return true;
}

const findSqlDelimiterIndex = (sql, delimiter) => {
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] || "";
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        if ((quote === "'" || quote === "\"") && next === quote) {
          index += 1;
          continue;
        }
        quote = "";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      const after = sql[index + 2] || "";
      if (!after || /\s/.test(after)) {
        lineComment = true;
        index += 1;
        continue;
      }
    }
    if (char === "#") {
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (sql.startsWith(delimiter, index)) return index;
  }
  return -1;
};

const splitSqlStatements = (sql) => {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    const directive = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (directive && !buffer.trim()) {
      delimiter = directive[1];
      continue;
    }
    buffer += `${line}\n`;
    let delimiterIndex = findSqlDelimiterIndex(buffer, delimiter);
    while (delimiterIndex >= 0) {
      const statement = buffer.slice(0, delimiterIndex).trim();
      if (statement) statements.push(statement);
      buffer = buffer.slice(delimiterIndex + delimiter.length);
      delimiterIndex = findSqlDelimiterIndex(buffer, delimiter);
    }
  }
  const trailing = buffer.trim();
  if (trailing) statements.push(trailing);
  return statements;
};

async function backfillCustomerCodes(connection) {
  const [businessRows] = await connection.query(
    "SELECT DISTINCT business_id AS businessId FROM business_records WHERE entity = 'customers' AND deleted_at IS NULL"
  );
  for (const business of businessRows) {
    const businessId = Number(business.businessId || business.business_id || 0);
    if (!businessId) continue;
    const [rows] = await connection.query(
      `SELECT id AS rowId, record_id AS recordId, data, revision
       FROM business_records
       WHERE business_id = ? AND entity = 'customers' AND deleted_at IS NULL
       ORDER BY
         COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.createdAt')), ''),
         COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')), ''),
         record_id`,
      [businessId]
    );
    const parsedRows = rows.map((row) => ({ ...row, data: parseJsonColumn(row.data, {}) }));
    const [revisionRows] = await connection.query("SELECT COALESCE(MAX(revision), 0) AS maxRevision FROM business_records WHERE business_id = ?", [businessId]);
    const usedCodes = new Set(parsedRows.map((row) => String(row.data.customerCode || "").trim().toUpperCase()).filter(Boolean));
    let nextNumber = Math.max(0, ...[...usedCodes].map(customerCodeNumber)) + 1;
    let maxAssignedNumber = nextNumber - 1;
    let nextRevision = Number(revisionRows[0]?.maxRevision || 0);
    for (const row of parsedRows) {
      if (String(row.data.customerCode || "").trim()) continue;
      let customerCode = formatCustomerCode(nextNumber);
      while (usedCodes.has(customerCode)) {
        nextNumber += 1;
        customerCode = formatCustomerCode(nextNumber);
      }
      const nextData = { ...row.data, customerCode };
      nextRevision += 1;
      await connection.query("UPDATE business_records SET data = ?, revision = ? WHERE id = ?", [
        JSON.stringify(nextData),
        nextRevision,
        row.rowId
      ]);
      usedCodes.add(customerCode);
      maxAssignedNumber = Math.max(maxAssignedNumber, nextNumber);
      nextNumber += 1;
    }
    const floor = Math.max(maxAssignedNumber, ...[...usedCodes].map(customerCodeNumber));
    await alignNumberSequence(connection, businessId, "customer", CUSTOMER_CODE_PREFIX, floor);
  }
}

async function alignSyncRevisionAutoIncrement(connection) {
  const [rows] = await connection.query("SELECT COALESCE(MAX(revision), 0) AS maxRevision FROM business_records");
  const nextRevision = Math.max(1, Math.floor(Number(rows[0]?.maxRevision || 0)) + 1);
  await connection.query(`ALTER TABLE sync_revisions AUTO_INCREMENT = ${nextRevision}`);
}

async function migrate() {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = splitSqlStatements(sql);
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
    await ensureIndex(connection, "devices", "idx_devices_token_hash", "(token_hash)");
    await ensureIndex(connection, "devices", "idx_devices_business_created", "(business_id, created_at)");
    await ensureIndex(connection, "user_sessions", "idx_user_sessions_user", "(business_id, user_id, revoked_at, expires_at)");
    await ensureIndex(connection, "user_sessions", "idx_user_sessions_device", "(business_id, device_id, revoked_at, expires_at)");
    await ensureIndex(connection, "business_records", "idx_business_records_entity_active", "(business_id, entity, deleted_at, revision)");
    await ensureIndex(connection, "sync_revisions", "idx_sync_revisions_record", "(business_id, entity, record_id, id)");
    await ensureIndex(connection, "file_metadata", "idx_file_metadata_entity", "(business_id, entity, entity_id, created_at)");
    await ensurePrimaryKey(connection, "idempotency_keys", ["business_id", "idempotency_key"]);
    await ensureIndex(connection, "idempotency_keys", "idx_idempotency_business_created", "(business_id, created_at)");
    await ensureIndex(connection, "sync_conflicts", "idx_conflicts_device_created", "(business_id, device_id, status, created_at)");
    await ensureIndex(connection, "audit_log", "idx_audit_log_business_created", "(business_id, created_at)");
    await ensureIndex(connection, "audit_log", "idx_audit_log_entity", "(business_id, entity, entity_id, created_at)");
    await connection.query("INSERT IGNORE INTO businesses (id, name) VALUES (1, 'Autocare24')");
    await connection.query("INSERT IGNORE INTO number_sequences (business_id, sequence_key, prefix, last_number) VALUES (1, 'invoice', 'INV', 0), (1, 'quotation', 'QT', 0), (1, 'job_card', 'JC', 0), (1, 'customer', 'CUS', 0)");
    await backfillCustomerCodes(connection);
    await alignSyncRevisionAutoIncrement(connection);
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
    try {
      await insertAuditLog(pool, {
        businessId: device.business_id,
        deviceId: device.id,
        userLabel: "cloud-api",
        action: "DEVICE_TOKEN_HASH_MIGRATED",
        entity: "devices",
        entityId: device.id,
        beforeState: { tokenHashAlgorithm: "sha256" },
        afterState: { tokenHashAlgorithm: "hmac-sha256", migratedAt: new Date().toISOString() },
        ipAddress: getRequestIp(req)
      });
    } catch (auditError) {
      console.warn("[security] Failed to audit legacy token hash migration:", auditError?.message || auditError);
    }
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
  const currentData = current ? parseJsonColumn(current.data, {}) : {};
  const canonicalData = operation === "DELETE"
    ? data
    : await canonicalizeOperation(connection, device.business_id, { entity, currentData, data: { ...(data || {}), id: data?.id || recordId } });
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
    if (current && role.id !== OWNER_ACCESS_ROLE_ID) {
      if (!DEFAULT_ROLE_PERMISSION_REFRESH_IDS.has(role.id)) continue;
      const currentPermissions = rolePermissionsFromData(current);
      const nextPermissions = normalizePermissions([...currentPermissions, ...role.permissions]);
      if (JSON.stringify(currentPermissions) === JSON.stringify(nextPermissions)) continue;
      await persistBusinessRecord(
        connection,
        device,
        req,
        "access_roles",
        role.id,
        {
          ...current,
          permissions: nextPermissions,
          active: recordFlag(current.active, true),
          locked: recordFlag(current.locked, false),
          updatedAt: nowIso()
        },
        "UPSERT",
        "ACCESS_ROLE_PERMISSIONS_REFRESHED"
      );
      continue;
    }
    const nextPermissions = role.id === OWNER_ACCESS_ROLE_ID ? ALL_PERMISSIONS : normalizePermissions(role.permissions);
    if (
      current &&
      current.name === role.name &&
      current.description === role.description &&
      recordFlag(current.locked, false) === role.locked &&
      recordFlag(current.active, true) &&
      JSON.stringify(rolePermissionsFromData(current)) === JSON.stringify(nextPermissions)
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
  permissions: rolePermissionsFromData(role),
  locked: recordFlag(role.locked, false),
  active: recordFlag(role.active, true),
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

const userSessionTokenFromRequest = (req) => String(req.headers[USER_SESSION_HEADER] || "").trim();
const userSessionExpiresAt = () => new Date(Date.now() + USER_SESSION_TTL_MS);
const cloudUserHasPermission = (user, permission) =>
  Boolean(user && (user.role === "owner" || (Array.isArray(user.permissions) && user.permissions.includes(permission))));
const cloudUserHasAnyPermission = (user, permissions) => {
  const required = Array.isArray(permissions) ? permissions : [permissions];
  return required.filter(Boolean).some((permission) => cloudUserHasPermission(user, permission));
};

async function issueCloudUserSession(connection, device, user) {
  const userToken = token();
  const expiresAt = userSessionExpiresAt();
  await connection.query(
    `INSERT INTO user_sessions (id, business_id, device_id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), device.business_id, device.id, String(user.id || ""), hashToken(userToken), expiresAt]
  );
  return { userToken, expiresAt: expiresAt.toISOString() };
}

async function publicCloudUserById(connection, businessId, userId) {
  const record = await loadBusinessRecord(connection, businessId, "users", userId);
  if (!record || record.data.active === false) {
    throwHttpError(401, "user_session_invalid", "Cloud user session is no longer valid. Please log in again.");
  }
  const roleMap = new Map((await listCloudAccessRoles(connection, businessId)).map((role) => [role.id, role]));
  return publicUserFromData(record.data, roleMap);
}

async function authenticateCloudUser(req, device) {
  const userToken = userSessionTokenFromRequest(req);
  if (!userToken) return null;
  const [rows] = await pool.query(
    `SELECT *
     FROM user_sessions
     WHERE business_id = ?
       AND device_id = ?
       AND token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [device.business_id, device.id, hashToken(userToken)]
  );
  const session = rows[0] || null;
  if (!session) {
    throwHttpError(401, "user_session_invalid", "Cloud user session is expired or invalid. Please log in again.");
  }
  const connection = await pool.getConnection();
  try {
    const user = await publicCloudUserById(connection, device.business_id, session.user_id);
    await connection.query("UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?", [session.id]);
    return user;
  } finally {
    connection.release();
  }
}

async function requireCloudUser(req, device, permissions = []) {
  const user = await authenticateCloudUser(req, device);
  if (!user) {
    throwHttpError(401, "user_session_required", "Login with a cloud user before accessing this data.");
  }
  const required = Array.isArray(permissions) ? permissions : [permissions];
  if (required.length && !cloudUserHasAnyPermission(user, required)) {
    throwHttpError(403, "permission_denied", "No access for this role.");
  }
  return user;
}

async function optionalCloudUserForPermission(req, device, permissions) {
  if (!userSessionTokenFromRequest(req)) return null;
  return requireCloudUser(req, device, permissions);
}

const RECORD_READ_PERMISSIONS = {
  settings: ["settings.manage", "documents.printPdf", "sharing.whatsapp", "billing.view", "reports.view"],
  customers: ["customers.view"],
  vehicles: ["customers.view", "billing.view", "jobCards.view"],
  services: ["services.view"],
  inventory_items: ["stock.view"],
  inventory_batches: ["stock.view"],
  inventory_movements: ["stock.view"],
  suppliers: ["stock.view"],
  purchase_records: ["stock.view"],
  enquiries: ["enquiries.view"],
  enquiry_followups: ["enquiries.view"],
  job_cards: ["jobCards.view"],
  job_card_items: ["jobCards.view"],
  job_card_photos: ["jobCards.view", "jobCards.photos"],
  job_card_checklist_items: ["jobCards.view"],
  job_card_status_history: ["jobCards.view"],
  invoices: ["billing.view"],
  invoice_items: ["billing.view"],
  payments: ["billing.view", "reports.view"],
  quotations: ["quotations.view"],
  quotation_items: ["quotations.view"],
  expenses: ["expenses.manage", "reports.view"]
};

const RECORD_WRITE_PERMISSIONS = {
  settings: ["settings.manage"],
  customers: ["customers.manage"],
  vehicles: ["customers.manage", "billing.create", "jobCards.manage"],
  services: ["services.manage"],
  inventory_items: ["stock.manageItems"],
  inventory_batches: ["stock.purchase", "stock.adjust"],
  inventory_movements: ["stock.adjust"],
  suppliers: ["stock.suppliers"],
  purchase_records: ["stock.purchase"],
  enquiries: ["enquiries.manage"],
  enquiry_followups: ["enquiries.manage"],
  job_cards: ["jobCards.manage"],
  job_card_items: ["jobCards.manage"],
  job_card_photos: ["jobCards.photos"],
  job_card_checklist_items: ["jobCards.manage"],
  job_card_status_history: ["jobCards.manage"],
  invoices: ["billing.manageInvoices", "billing.create"],
  invoice_items: ["billing.manageInvoices", "billing.create"],
  payments: ["billing.recordPayments"],
  quotations: ["quotations.manage"],
  quotation_items: ["quotations.manage"],
  expenses: ["expenses.manage"]
};

const recordPermissionsFor = (entity, method) =>
  method === "GET"
    ? RECORD_READ_PERMISSIONS[entity] || ["developer.access"]
    : RECORD_WRITE_PERMISSIONS[entity] || ["developer.access"];

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
          saleAmount: 0,
          saleUnitPrice: 0,
          paymentMode: "",
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
      saleAmount: 0,
      saleUnitPrice: 0,
      paymentMode: "",
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
      itemUnit: movement.itemUnit || item.unit || "",
      saleAmount: money(movement.saleAmount),
      saleUnitPrice: money(movement.saleUnitPrice),
      paymentMode: movement.paymentMode || ""
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

const objectData = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeInvoiceCustomer = (invoice = {}, customer = {}) => {
  const embedded = objectData(invoice.customer);
  return {
    id: String(customer.id || embedded.id || invoice.customerId || ""),
    customerCode: String(embedded.customerCode || invoice.customerCode || customer.customerCode || ""),
    name: String(embedded.name || invoice.customerName || customer.name || ""),
    phone: String(embedded.phone || invoice.customerPhone || customer.phone || ""),
    email: String(embedded.email || invoice.customerEmail || customer.email || ""),
    gstin: String(embedded.gstin || invoice.customerGstin || customer.gstin || ""),
    address: String(embedded.address || invoice.customerAddress || customer.address || ""),
    createdAt: String(embedded.createdAt || customer.createdAt || invoice.createdAt || "")
  };
};

const normalizeInvoiceVehicle = (invoice = {}, vehicle = {}) => {
  const embedded = objectData(invoice.vehicle);
  return {
    id: String(embedded.id || invoice.vehicleId || vehicle.id || ""),
    customerId: String(embedded.customerId || invoice.customerId || vehicle.customerId || ""),
    registrationNumber: String(embedded.registrationNumber || invoice.vehicleNumber || vehicle.registrationNumber || "").toUpperCase(),
    vehicleType: normalizeVehicleType(embedded.vehicleType || invoice.vehicleType || vehicle.vehicleType),
    make: String(embedded.make || invoice.vehicleMake || vehicle.make || ""),
    model: String(embedded.model || invoice.vehicleModel || vehicle.model || ""),
    color: String(embedded.color || invoice.vehicleColor || vehicle.color || ""),
    createdAt: String(embedded.createdAt || vehicle.createdAt || invoice.createdAt || "")
  };
};

const customerCodeKey = (value) => String(value || "").trim().toUpperCase();

async function loadCustomerByIdOrCode(connection, businessId, customerIdOrCode, customerCode = "") {
  const idOrCode = String(customerIdOrCode || "").trim();
  if (idOrCode) {
    const direct = await loadBusinessRecord(connection, businessId, "customers", idOrCode);
    if (direct) return direct;
  }
  const code = customerCodeKey(customerCode || idOrCode);
  if (!code) return null;
  const rows = await loadBusinessRecords(connection, businessId, "customers");
  return rows.find((row) => customerCodeKey(row.data.customerCode) === code) || null;
}

async function resolveCustomerIdentity(connection, businessId, payload) {
  const requestedId = String(payload.customerId || payload.customer?.id || "").trim().slice(0, 36);
  const requestedCode = String(payload.customer?.customerCode || payload.customerCode || "").trim();
  const existing = await loadCustomerByIdOrCode(connection, businessId, requestedId, requestedCode);
  if (existing) return { customerId: existing.recordId, existingCustomer: existing.data };
  return { customerId: requestedId || uuid(), existingCustomer: null };
}

async function buildInvoiceDetail(connection, businessId, invoiceId) {
  const invoice = await loadBusinessRecord(connection, businessId, "invoices", invoiceId);
  if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
  const customerRecord = await loadCustomerByIdOrCode(
    connection,
    businessId,
    invoice.data.customerId || invoice.data.customer?.id,
    invoice.data.customerCode || invoice.data.customer?.customerCode
  );
  const vehicleRecord = await loadBusinessRecord(connection, businessId, "vehicles", invoice.data.vehicleId || invoice.data.vehicle?.id);
  const customer = normalizeInvoiceCustomer(invoice.data, customerRecord?.data || {});
  const vehicle = normalizeInvoiceVehicle(invoice.data, vehicleRecord?.data || {});
  const items = rowList(await loadBusinessRecords(connection, businessId, "invoice_items"))
    .filter((item) => String(item.invoiceId || "") === invoiceId);
  const payments = rowList(await loadBusinessRecords(connection, businessId, "payments"))
    .filter((payment) => String(payment.invoiceId || "") === invoiceId)
    .sort((a, b) => String(a.paymentDate || "").localeCompare(String(b.paymentDate || "")));
  return {
    ...invoice.data,
    id: invoice.data.id || invoice.recordId,
    customerId: customer.id || invoice.data.customerId,
    vehicleId: invoice.data.vehicleId || vehicle.id,
    customerCode: invoice.data.customerCode || customer.customerCode || "",
    customerName: invoice.data.customerName || customer.name || "",
    customerPhone: invoice.data.customerPhone || customer.phone || "",
    vehicleType: normalizeVehicleType(invoice.data.vehicleType || vehicle.vehicleType),
    vehicleNumber: invoice.data.vehicleNumber || vehicle.registrationNumber || "",
    customer,
    vehicle,
    items,
    payments
  };
}

async function buildQuotationDetail(connection, businessId, quotationId) {
  const quotation = await loadBusinessRecord(connection, businessId, "quotations", quotationId);
  if (!quotation) throw Object.assign(new Error("Quotation not found."), { status: 404 });
  const customer = (await loadBusinessRecord(connection, businessId, "customers", quotation.data.customerId))?.data || {
    id: quotation.data.customerId,
    customerCode: quotation.data.customerCode || "",
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
  return { ...quotation.data, customerCode: quotation.data.customerCode || customer.customerCode || "", customer, vehicle, items };
}

async function buildJobCardDetail(connection, businessId, jobCardId) {
  const job = await loadBusinessRecord(connection, businessId, "job_cards", jobCardId);
  if (!job) throw Object.assign(new Error("Job card not found."), { status: 404 });
  const customer = (await loadBusinessRecord(connection, businessId, "customers", job.data.customerId))?.data || {
    id: job.data.customerId,
    customerCode: job.data.customerCode || "",
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
  return { ...job.data, customerCode: job.data.customerCode || customer.customerCode || "", customer, vehicle, items, checklist, photos, history };
}

async function listInvoiceSummaries(connection, businessId, query = "", limit = 300) {
  const q = String(query || "").trim().toLowerCase();
  const [invoiceRows, customerRows, vehicleRows] = await Promise.all([
    loadBusinessRecords(connection, businessId, "invoices"),
    loadBusinessRecords(connection, businessId, "customers"),
    loadBusinessRecords(connection, businessId, "vehicles")
  ]);
  const customersById = new Map(customerRows.map((row) => [row.recordId, row.data]));
  const customersByCode = new Map(
    customerRows
      .map((row) => [customerCodeKey(row.data.customerCode), row.data])
      .filter(([code]) => Boolean(code))
  );
  const vehiclesById = new Map(vehicleRows.map((row) => [row.recordId, row.data]));
  const invoices = invoiceRows
    .map((row) => {
      const invoice = row.data || {};
      const customer = normalizeInvoiceCustomer(
        invoice,
        customersById.get(String(invoice.customerId || invoice.customer?.id || "")) ||
          customersByCode.get(customerCodeKey(invoice.customerCode || invoice.customer?.customerCode || invoice.customerId)) ||
          {}
      );
      const vehicle = normalizeInvoiceVehicle(invoice, vehiclesById.get(String(invoice.vehicleId || invoice.vehicle?.id || "")) || {});
      return {
        ...invoice,
        id: invoice.id || row.recordId,
        customerId: customer.id || invoice.customerId,
        vehicleId: invoice.vehicleId || vehicle.id,
        customerCode: invoice.customerCode || customer.customerCode || "",
        customerName: invoice.customerName || customer.name || "",
        customerPhone: invoice.customerPhone || customer.phone || "",
        vehicleNumber: invoice.vehicleNumber || vehicle.registrationNumber || "",
        vehicleType: normalizeVehicleType(invoice.vehicleType || vehicle.vehicleType)
      };
    })
    .filter((invoice) => {
      if (!q) return true;
      return [invoice.invoiceNumber, invoice.customerCode, invoice.customerName, invoice.customerPhone, invoice.vehicleNumber, invoice.vehicleType]
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
  customerCode: String(job.customerCode || job.customer?.customerCode || ""),
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
  const customersById = new Map(rowList(await loadBusinessRecords(connection, businessId, "customers")).map((customer) => [String(customer.id || ""), customer]));
  return rowList(await loadBusinessRecords(connection, businessId, "job_cards"))
    .map((job) => {
      const customer = customersById.get(String(job.customerId || ""));
      return mapCloudJobCardSummary({ ...job, customerCode: job.customerCode || customer?.customerCode || "" });
    })
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

function quickStockSaleMovements(movements, range) {
  return movements.filter((movement) => movement.type === "stock_sale" && money(movement.saleAmount) > 0 && inDateRange(movement.movementDate, range));
}

function stockSaleRevenue(movements) {
  return money(movements.reduce((sum, movement) => sum + money(movement.saleAmount), 0));
}

function stockSaleCost(movements) {
  return money(movements.reduce((sum, movement) => sum + money(movement.quantity) * money(movement.unitCost), 0));
}

function buildPaymentModeTotals(payments, stockSales) {
  const totals = new Map();
  const add = (mode, amount) => {
    const paymentMode = normalizePaymentMode(mode || "Cash");
    totals.set(paymentMode, money((totals.get(paymentMode) || 0) + money(amount)));
  };
  payments.forEach((payment) => add(payment.mode, payment.amount));
  stockSales.forEach((movement) => add(movement.paymentMode || "Cash", movement.saleAmount));
  return [...totals.entries()]
    .map(([mode, amount]) => ({ mode, amount }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.mode.localeCompare(b.mode));
}

function buildSalesTrend(invoices, payments, stockSales = []) {
  const rows = new Map();
  const ensure = (date) => {
    const key = dateOnly(date);
    if (!key) return null;
    if (!rows.has(key)) rows.set(key, { date: key, label: key.slice(5), billedValue: 0, quickStockSales: 0, totalSales: 0, paidAmount: 0, balanceDue: 0 });
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
  stockSales.forEach((movement) => {
    const row = ensure(movement.movementDate);
    if (!row) return;
    const amount = money(movement.saleAmount);
    row.quickStockSales = money(row.quickStockSales + amount);
    row.paidAmount = money(row.paidAmount + amount);
  });
  return [...rows.values()]
    .map((row) => ({ ...row, totalSales: money(row.billedValue + row.quickStockSales) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function buildDailyReportRows(connection, businessId, invoices, allInvoices, payments, stockSales = []) {
  const rows = new Map();
  const ensure = (date) => {
    const key = dateOnly(date);
    if (!key) return null;
    if (!rows.has(key)) {
      rows.set(key, {
        date: key,
        label: key.slice(5),
        invoiceCount: 0,
        cancelledCount: 0,
        serviceAmount: 0,
        productAmount: 0,
        quickStockSales: 0,
        invoiceBilled: 0,
        totalSales: 0,
        collected: 0,
        pendingReceived: 0,
        balanceCreated: 0,
        tax: 0,
        grandSales: 0
      });
    }
    return rows.get(key);
  };

  const activeInvoices = invoices.filter((invoice) => invoice.invoiceStatus !== "cancelled");
  const activeInvoiceIds = new Set(activeInvoices.map((invoice) => String(invoice.id || "")));
  const invoicesById = new Map(invoices.map((invoice) => [String(invoice.id || ""), invoice]));
  const allInvoicesById = new Map(allInvoices.map((invoice) => [String(invoice.id || ""), invoice]));

  activeInvoices.forEach((invoice) => {
    const row = ensure(invoice.invoiceDate);
    if (!row) return;
    row.invoiceCount += 1;
    row.invoiceBilled = money(row.invoiceBilled + money(invoice.grandTotal));
    row.balanceCreated = money(row.balanceCreated + money(invoice.balanceDue));
    row.tax = money(row.tax + money(invoice.totalTax));
  });

  invoices
    .filter((invoice) => invoice.invoiceStatus === "cancelled")
    .forEach((invoice) => {
      const row = ensure(invoice.invoiceDate);
      if (row) row.cancelledCount += 1;
    });

  rowList(await loadBusinessRecords(connection, businessId, "invoice_items")).forEach((item) => {
    const invoiceId = String(item.invoiceId || "");
    if (!activeInvoiceIds.has(invoiceId)) return;
    const invoice = invoicesById.get(invoiceId);
    const row = ensure(invoice?.invoiceDate);
    if (!row) return;
    const lineTotal = money(item.lineTotal === undefined || item.lineTotal === null ? finiteNumber(item.quantity) * finiteNumber(item.unitPrice) : item.lineTotal);
    if (String(item.inventoryItemId || "").trim()) {
      row.productAmount = money(row.productAmount + lineTotal);
      return;
    }
    row.serviceAmount = money(row.serviceAmount + lineTotal);
  });

  payments.forEach((payment) => {
    const row = ensure(payment.paymentDate);
    if (!row) return;
    const invoice = allInvoicesById.get(String(payment.invoiceId || ""));
    const amount = money(payment.amount);
    row.collected = money(row.collected + amount);
    if (invoice?.invoiceDate && invoice.invoiceDate < payment.paymentDate) {
      row.pendingReceived = money(row.pendingReceived + amount);
    }
  });

  stockSales.forEach((movement) => {
    const row = ensure(movement.movementDate);
    if (!row) return;
    const amount = money(movement.saleAmount);
    row.quickStockSales = money(row.quickStockSales + amount);
    row.collected = money(row.collected + amount);
  });

  return [...rows.values()]
    .map((row) => {
      const totalSales = money(row.invoiceBilled + row.quickStockSales);
      return { ...row, totalSales, grandSales: totalSales };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function buildPendingPaymentRows(invoices, payments) {
  const invoicesById = new Map(invoices.map((invoice) => [String(invoice.id || ""), invoice]));
  return payments
    .map((payment) => ({ payment, invoice: invoicesById.get(String(payment.invoiceId || "")) }))
    .filter(({ payment, invoice }) => invoice?.invoiceDate && invoice.invoiceDate < payment.paymentDate)
    .map(({ payment, invoice }) => ({
      id: String(payment.id || ""),
      paymentDate: String(payment.paymentDate || ""),
      invoiceDate: String(invoice.invoiceDate || ""),
      invoiceNumber: String(invoice.invoiceNumber || ""),
      customerName: String(invoice.customerName || ""),
      customerPhone: String(invoice.customerPhone || ""),
      vehicleNumber: String(invoice.vehicleNumber || ""),
      amount: money(payment.amount),
      mode: normalizePaymentMode(payment.mode || "Cash"),
      reference: String(payment.reference || ""),
      invoiceBalanceDue: money(invoice.balanceDue)
    }))
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.invoiceDate.localeCompare(a.invoiceDate));
}

function buildProfitTrend(payments, invoiceStockMovements, expenses, stockSales) {
  const rows = new Map();
  const ensure = (date) => {
    const key = dateOnly(date);
    if (!key) return null;
    if (!rows.has(key)) rows.set(key, { date: key, label: key.slice(5), paidRevenue: 0, stockCost: 0, expenses: 0, cashProfit: 0 });
    return rows.get(key);
  };
  payments.forEach((payment) => {
    const row = ensure(payment.paymentDate);
    if (!row) return;
    row.paidRevenue = money(row.paidRevenue + money(payment.amount));
  });
  invoiceStockMovements.forEach((movement) => {
    const row = ensure(movement.movementDate);
    if (!row) return;
    row.stockCost = money(row.stockCost + money(movement.quantity) * money(movement.unitCost));
  });
  stockSales.forEach((movement) => {
    const row = ensure(movement.movementDate);
    if (!row) return;
    row.paidRevenue = money(row.paidRevenue + money(movement.saleAmount));
    row.stockCost = money(row.stockCost + money(movement.quantity) * money(movement.unitCost));
  });
  expenses.forEach((expense) => {
    const row = ensure(expense.expenseDate);
    if (!row) return;
    row.expenses = money(row.expenses + money(expense.amount));
  });
  return [...rows.values()]
    .map((row) => ({ ...row, cashProfit: money(row.paidRevenue - row.stockCost - row.expenses) }))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  const paidAmount = money(nonNegativeNumber(payload.paidAmount || 0, "Paid amount"));
  if (paidAmount > totals.grandTotal) throw Object.assign(new Error(PAID_AMOUNT_EXCEEDS_TOTAL_MESSAGE), { status: 422 });
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

  const customerIdentity = await resolveCustomerIdentity(connection, device.business_id, payload);
  const customerId = customerIdentity.customerId;
  const existingCustomer = customerIdentity.existingCustomer;
  const customer = {
    id: customerId,
    customerCode: String(payload.customer?.customerCode || existingCustomer?.customerCode || await nextNumber(connection, device.business_id, "customer", CUSTOMER_CODE_PREFIX)),
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
    customerCode: customer.customerCode,
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
  sacCode: normalizeSacCode(item.sacCode)
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
      saleAmount: 0,
      saleUnitPrice: 0,
      paymentMode: "",
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
    if (!["usage", "stock_sale", "adjustment", "return", "damage"].includes(type)) throw Object.assign(new Error("Unsupported manual stock movement."), { status: 422 });
    const quantity = money(positiveNumber(body.quantity, "Quantity"));
    const item = (await loadBusinessRecord(connection, device.business_id, "inventory_items", itemId))?.data;
    if (!item) throw Object.assign(new Error("Inventory item not found."), { status: 404 });
    const movementDate = String(body.movementDate || localDate());
    const reference = String(body.reference || "");
    const notes = String(body.notes || "");
    const saleAmount = type === "stock_sale" ? money(positiveNumber(body.saleAmount, "Sale amount")) : 0;
    const paymentMode = type === "stock_sale" ? normalizePaymentMode(body.paymentMode || "Cash") : "";
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
        saleAmount: 0,
        saleUnitPrice: 0,
        paymentMode: "",
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
      let remainingSaleAmount = saleAmount;
      for (const batch of itemBatches) {
        if (remaining <= 0) break;
        const used = money(Math.min(money(batch.data.quantityRemaining), remaining));
        remaining = money(remaining - used);
        const movementSaleAmount = type === "stock_sale"
          ? money(remaining <= 0 ? remainingSaleAmount : Math.min(remainingSaleAmount, money((saleAmount * used) / quantity)))
          : 0;
        remainingSaleAmount = money(remainingSaleAmount - movementSaleAmount);
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
          saleAmount: movementSaleAmount,
          saleUnitPrice: used > 0 ? money(movementSaleAmount / used) : 0,
          paymentMode,
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
    const movements = rowList(await loadBusinessRecords(connection, device.business_id, "inventory_movements"));
    const todayQuickStockSales = stockSaleRevenue(quickStockSaleMovements(movements, { fromDate: today, toDate: today }));
    const monthQuickStockSales = stockSaleRevenue(quickStockSaleMovements(movements, { fromDate: monthStart, toDate: "" }));
    ok(res, {
      dashboard: {
        todayRevenue: money(payments.filter((payment) => payment.paymentDate === today).reduce((sum, payment) => sum + money(payment.amount), 0) + todayQuickStockSales),
        monthRevenue: money(payments.filter((payment) => String(payment.paymentDate || "") >= monthStart).reduce((sum, payment) => sum + money(payment.amount), 0) + monthQuickStockSales),
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
    const movements = rowList(await loadBusinessRecords(connection, device.business_id, "inventory_movements"));
    const stockSales = quickStockSaleMovements(movements, range);
    const quickStockSales = stockSaleRevenue(stockSales);
    const invoiceRevenue = money(active.reduce((sum, invoice) => sum + money(invoice.grandTotal), 0));
    const paymentModes = buildPaymentModeTotals(payments, stockSales);
    const inventory = await buildInventorySnapshot(connection, device.business_id);
    const pendingPayments = buildPendingPaymentRows(allInvoices, payments);
    const dailyRows = await buildDailyReportRows(connection, device.business_id, invoices, allInvoices, payments, stockSales);
    ok(res, {
      report: {
        rangeLabel: range.label,
        revenue: invoiceRevenue,
        invoiceRevenue,
        quickStockSales,
        totalSales: money(invoiceRevenue + quickStockSales),
        invoiceCount: active.length,
        paidAmount: money(payments.reduce((sum, payment) => sum + money(payment.amount), 0) + quickStockSales),
        balanceDue: money(active.reduce((sum, invoice) => sum + money(invoice.balanceDue), 0)),
        taxableValue: money(active.reduce((sum, invoice) => sum + money(invoice.taxableValue), 0)),
        cgst: money(active.reduce((sum, invoice) => sum + money(invoice.cgst), 0)),
        sgst: money(active.reduce((sum, invoice) => sum + money(invoice.sgst), 0)),
        igst: money(active.reduce((sum, invoice) => sum + money(invoice.igst), 0)),
        totalTax: money(active.reduce((sum, invoice) => sum + money(invoice.totalTax), 0)),
        cancelledCount: invoices.length - active.length,
        dues: active.filter((invoice) => money(invoice.balanceDue) > 0),
        pendingPayments,
        dailyRows,
        topServices: await buildTopServices(connection, device.business_id, active),
        paymentModes,
        salesTrend: buildSalesTrend(active, payments, stockSales),
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
    const allMovements = rowList(await loadBusinessRecords(connection, device.business_id, "inventory_movements"));
    const movements = allMovements
      .filter((movement) => activeInvoiceNumbers.has(String(movement.reference || "")) && inDateRange(movement.movementDate, range));
    const stockSales = quickStockSaleMovements(allMovements, range);
    const expenses = rowList(await loadBusinessRecords(connection, device.business_id, "expenses")).filter((expense) => inDateRange(expense.expenseDate, range));
    const paidRevenue = money(payments.reduce((sum, payment) => sum + money(payment.amount), 0) + stockSaleRevenue(stockSales));
    const invoiceStockMovements = movements.filter((movement) => ["sale", "usage"].includes(String(movement.type || "")));
    const invoiceStockCost = money(invoiceStockMovements.reduce((sum, movement) => sum + money(movement.quantity) * money(movement.unitCost), 0));
    const stockCost = money(invoiceStockCost + stockSaleCost(stockSales));
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
        trend: buildProfitTrend(payments, invoiceStockMovements, expenses, stockSales),
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
  if (op.entity === "customers" && !String(data.customerCode || "").trim()) {
    data.customerCode = String(op.currentData?.customerCode || "").trim() || await nextNumber(connection, businessId, "customer", CUSTOMER_CODE_PREFIX);
  }
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
  if (op.entity === "access_roles") {
    const defaultRole = DEFAULT_ACCESS_ROLES.find((role) => role.id === String(data.id || op.recordId || ""));
    data.name = requiredText(data.name || defaultRole?.name, "Role name").slice(0, 100);
    data.description = String(data.description || defaultRole?.description || "");
    data.permissions = rolePermissionsFromData(data, defaultRole?.permissions || []);
    if (!data.permissions.length) throw Object.assign(new Error("Role permissions are required."), { status: 422 });
    data.locked = recordFlag(data.locked, defaultRole?.locked === true);
    data.active = recordFlag(data.active, defaultRole?.active !== false);
    data.createdAt = String(data.createdAt || nowIso());
    data.updatedAt = String(data.updatedAt || nowIso());
  }
  if (op.entity === "inventory_items") {
    data.name = requiredText(data.name, "Inventory item name");
    data.type = data.type === "retail" ? "retail" : "consumable";
    data.unit = String(data.unit || "piece").trim() || "piece";
    data.sku = String(data.sku || "").trim();
    data.category = String(data.category || "Studio stock").trim() || "Studio stock";
    data.retailPrice = money(nonNegativeNumber(data.retailPrice ?? 0, "Selling price"));
    data.gstRate = money(nonNegativeNumber(data.gstRate ?? 0, "GST rate"));
    data.lowStockLevel = money(nonNegativeNumber(data.lowStockLevel ?? 0, "Low stock level"));
    data.currentQuantity = money(nonNegativeNumber(data.currentQuantity ?? 0, "Current quantity"));
    data.stockValue = money(nonNegativeNumber(data.stockValue ?? 0, "Stock value"));
    data.active = data.active !== false;
    data.createdAt = String(data.createdAt || nowIso());
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

async function handleAdminDevicesList(req, res, device, actor = null) {
  const body = actor ? null : await readBody(req);
  const connection = await pool.getConnection();
  try {
    if (!actor) await verifyCloudOwner(connection, device, req, body);
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

async function handleAdminDeviceApprove(req, res, device, deviceId, actor = null) {
  const body = actor ? null : await readBody(req);
  const connection = await pool.getConnection();
  try {
    const owner = actor || await verifyCloudOwner(connection, device, req, body);
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

async function handleAdminDeviceRevoke(req, res, device, deviceId, actor = null) {
  const body = actor ? null : await readBody(req);
  const connection = await pool.getConnection();
  try {
    const owner = actor || await verifyCloudOwner(connection, device, req, body);
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
    const session = await issueCloudUserSession(connection, device, user);
    await connection.commit();
    ok(res, { user: publicUserFromData(user, roleMap), ...session }, 201);
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
    await connection.beginTransaction();
    await ensureDefaultAccessRoles(connection, device, req);
    const rows = await loadBusinessRecords(connection, device.business_id, "users");
    const matched = rows.map((row) => row.data).find((user) => user.active !== false && normalizeUsername(user.username) === username);
    if (!matched || !verifyPassword(password, matched.salt, matched.passwordHash)) throw Object.assign(new Error("Invalid username or password."), { status: 401 });
    const roleMap = new Map((await listCloudAccessRoles(connection, device.business_id)).map((role) => [role.id, role]));
    const session = await issueCloudUserSession(connection, device, matched);
    await connection.commit();
    ok(res, { user: publicUserFromData(matched, roleMap), ...session });
  } catch (err) {
    await connection.rollback();
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

async function handleCloudUserSave(req, res, device, actor) {
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
    const actorIsOwner = actor?.role === "owner";
    if ((role === "owner" || current?.data.role === "owner") && !actorIsOwner) {
      throwHttpError(403, "permission_denied", "Only an owner can create or edit owner accounts.");
    }
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
    if (current && (body.password || user.active === false)) {
      await connection.query(
        "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND user_id = ? AND revoked_at IS NULL",
        [device.business_id, userId]
      );
    }
    const roleMap = new Map((await listCloudAccessRoles(connection, device.business_id)).map((roleRow) => [roleRow.id, roleRow]));
    await connection.commit();
    ok(res, { user: publicUserFromData(user, roleMap) }, current ? 200 : 201);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.code || (err.status === 422 ? "validation_error" : err.status === 403 ? "permission_denied" : "internal_error"), err.message || "Unable to save user.");
  } finally {
    connection.release();
  }
}

async function handleCloudUserDeactivate(req, res, device, userId, actor) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, "users", userId, true);
    if (!current) throw Object.assign(new Error("User account not found."), { status: 404 });
    if (current.data.role === "owner") {
      if (actor?.role !== "owner") {
        throwHttpError(403, "permission_denied", "Only an owner can deactivate owner accounts.");
      }
      const activeOwners = (await loadBusinessRecords(connection, device.business_id, "users")).filter((row) => row.recordId !== userId && row.data.role === "owner" && row.data.active !== false);
      if (!activeOwners.length) throw Object.assign(new Error("At least one active owner account is required."), { status: 422 });
    }
    await persistBusinessRecord(connection, device, req, "users", userId, { ...current.data, active: false, updatedAt: nowIso() }, "UPSERT", "USER_DEACTIVATED");
    await connection.query(
      "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND user_id = ? AND revoked_at IS NULL",
      [device.business_id, userId]
    );
    await connection.commit();
    noContent(res);
  } catch (err) {
    await connection.rollback();
    error(res, err.status || 500, err.code || (err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : err.status === 403 ? "permission_denied" : "internal_error"), err.message || "Unable to deactivate user.");
  } finally {
    connection.release();
  }
}

async function handleCloudUserChangePassword(req, res, device, userId, actor) {
  const body = await readBody(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await loadBusinessRecord(connection, device.business_id, "users", userId, true);
    if (!current) throw Object.assign(new Error("User account not found."), { status: 404 });
    const isSelf = String(actor?.id || "") === String(userId || "");
    if (!isSelf && current.data.role === "owner" && actor?.role !== "owner") {
      throwHttpError(403, "permission_denied", "Only an owner can reset owner passwords.");
    }
    if (!isSelf && !cloudUserHasPermission(actor, "users.manage")) {
      throwHttpError(403, "permission_denied", "No access for this role.");
    }
    if (isSelf && !body.currentPassword) {
      throw Object.assign(new Error("Current password is required."), { status: 422 });
    }
    if (isSelf && !verifyPassword(body.currentPassword, current.data.salt, current.data.passwordHash)) {
      throw Object.assign(new Error("Current password is incorrect."), { status: 422 });
    }
    const secret = hashPassword(validatePassword(body.newPassword));
    await persistBusinessRecord(connection, device, req, "users", userId, { ...current.data, ...secret, updatedAt: nowIso() }, "UPSERT", "USER_PASSWORD_CHANGED");
    await connection.query(
      "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND user_id = ? AND revoked_at IS NULL",
      [device.business_id, userId]
    );
    await connection.commit();
    ok(res, { ok: true });
  } catch (err) {
    await connection.rollback();
    error(
      res,
      err.status || 500,
      err.code || (err.status === 404 ? "not_found" : err.status === 422 ? "validation_error" : err.status === 403 ? "permission_denied" : "internal_error"),
      err.message || "Unable to change password."
    );
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

      const currentData = current ? parseJsonColumn(current.data, {}) : {};
      const canonicalData = await canonicalizeOperation(connection, device.business_id, { ...op, entity, currentData, data: op.data || {} });
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
  const digest = sha256(data);
  if (body.sha256 && body.sha256 !== digest) {
    return error(res, 422, "hash_mismatch", "Uploaded file hash does not match.");
  }
  const businessDir = businessUploadDirectory(device.business_id);
  fs.mkdirSync(businessDir, { recursive: true });
  const storagePath = path.resolve(businessDir, `${fileId}${ext}`);
  if (!isInsideDirectory(businessDir, storagePath)) {
    return error(res, 500, "server_misconfigured", "Upload file path could not be resolved safely.");
  }
  fs.writeFileSync(storagePath, data);
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

async function handleHealth(res) {
  try {
    await pool.query({ sql: "SELECT 1 AS ok", timeout: HEALTHCHECK_DB_TIMEOUT_MS });
    return ok(res, { ok: true, version: API_VERSION, serverTime: new Date().toISOString(), database: "ok" });
  } catch {
    return error(res, 503, "database_unavailable", "Cloud database is not reachable.");
  }
}

const textResponse = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(String(body ?? ""));
};

const githubReleaseHeaders = (extra = {}) => ({
  "accept": "application/vnd.github+json",
  "authorization": `Bearer ${GITHUB_RELEASE_TOKEN}`,
  "user-agent": "autocare24-cloud-update-proxy",
  "x-github-api-version": "2022-11-28",
  ...extra
});

const safeUpdateAssetName = (value) => {
  const decoded = decodeURIComponent(String(value || ""));
  const baseName = path.basename(decoded);
  if (!baseName || baseName !== decoded || decoded.length > 180 || !/^[A-Za-z0-9 ._()'-]+$/.test(decoded)) {
    throwHttpError(400, "invalid_update_asset", "Update asset name is invalid.");
  }
  return decoded;
};

const updateAssetContentType = (fileName) => {
  if (/\.ya?ml$/i.test(fileName)) return "application/x-yaml; charset=utf-8";
  if (/\.exe$/i.test(fileName)) return "application/vnd.microsoft.portable-executable";
  return "application/octet-stream";
};

const comparableUpdateAssetName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const findUpdateReleaseAsset = (release, assetName) => {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exact = assets.find((candidate) => candidate.name === assetName);
  if (exact) return exact;
  const comparable = comparableUpdateAssetName(assetName);
  return assets.find((candidate) => comparableUpdateAssetName(candidate.name) === comparable) || null;
};

async function getGitHubAssetRedirectUrl(asset) {
  const response = await fetch(asset.url, {
    redirect: "manual",
    headers: githubReleaseHeaders({ accept: "application/octet-stream" })
  });
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) return location;
  if (response.body) await response.body.cancel().catch(() => {});
  return "";
}

async function getPrivateGitHubRelease() {
  if (!GITHUB_RELEASE_TOKEN || !GITHUB_RELEASE_OWNER || !GITHUB_RELEASE_REPO) {
    throwHttpError(503, "updates_not_configured", "Update feed is not configured on the server.");
  }
  const releasePath = GITHUB_RELEASE_TAG
    ? `/releases/tags/${encodeURIComponent(GITHUB_RELEASE_TAG)}`
    : "/releases/latest";
  const response = await fetch(`https://api.github.com/repos/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}${releasePath}`, {
    headers: githubReleaseHeaders()
  });
  const text = await response.text();
  if (!response.ok) {
    const message = response.status === 404
      ? "No published update release was found for this private repository."
      : "Could not read private GitHub release metadata.";
    throwHttpError(response.status === 404 ? 404 : 502, "update_release_unavailable", `${message} ${text}`.trim());
  }
  return JSON.parse(text);
}

async function handleUpdateAsset(req, res, url) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return textResponse(res, 405, "Method not allowed.", { allow: "GET, HEAD" });
    }
    const rawAssetName = url.pathname.slice(`${UPDATE_FEED_PREFIX}/`.length);
    const assetName = safeUpdateAssetName(rawAssetName || "latest.yml");
    const release = await getPrivateGitHubRelease();
    const asset = findUpdateReleaseAsset(release, assetName);
    if (!asset) {
      return textResponse(res, 404, `Update asset was not found: ${assetName}`);
    }

    if (assetName !== "latest.yml") {
      const redirectUrl = await getGitHubAssetRedirectUrl(asset);
      if (redirectUrl) {
        res.writeHead(307, {
          ...SECURITY_HEADERS,
          location: redirectUrl,
          "cache-control": "private, no-store"
        });
        res.end();
        return;
      }
    }

    const headers = githubReleaseHeaders({ accept: "application/octet-stream" });
    if (req.headers.range) headers.range = req.headers.range;
    const response = await fetch(asset.url, { headers });
    if (!response.ok) {
      const text = await response.text();
      return textResponse(res, response.status === 404 ? 404 : 502, `Could not download update asset. ${text}`.trim());
    }

    const passthroughHeaders = {
      ...SECURITY_HEADERS,
      "content-type": updateAssetContentType(assetName),
      "cache-control": assetName === "latest.yml" ? "no-store" : "private, max-age=300"
    };
    for (const headerName of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = response.headers.get(headerName);
      if (value) passthroughHeaders[headerName] = value;
    }
    res.writeHead(response.status, passthroughHeaders);
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
  } catch (err) {
    return textResponse(res, err.status || 500, err.status >= 500 ? "Update feed error." : err.message || "Update feed request failed.");
  }
}

const isTruthyEnv = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const whatsappRuntimeConfig = () => {
  const enabled = isTruthyEnv(process.env.WHATSAPP_ENABLED);
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const businessAccountId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "").trim();
  const verifyToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
  return {
    enabled,
    configured: enabled && Boolean(accessToken && phoneNumberId),
    webhookReady: enabled && Boolean(verifyToken && appSecret),
    accessToken,
    phoneNumberId,
    businessAccountId,
    verifyToken,
    appSecret,
    graphVersion: WHATSAPP_GRAPH_VERSION,
    graphBaseUrl: WHATSAPP_GRAPH_BASE_URL,
    displayPhoneNumber: String(process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "").trim()
  };
};

const normalizeWhatsAppPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  throwHttpError(422, "validation_error", "A valid WhatsApp phone number is required.");
};

const normalizeWhatsAppPhoneOptional = (phone) => {
  try {
    return normalizeWhatsAppPhone(phone);
  } catch {
    return "";
  }
};

const whatsappDateIso = (value) => dateColumnIso(value);
const mysqlDateFromUnix = (value) => {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
};

const canSendWhatsAppFreeform = (lastInboundAt) => {
  if (!lastInboundAt) return false;
  const time = new Date(lastInboundAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= WHATSAPP_CUSTOMER_WINDOW_MS;
};

const mapWhatsAppConversation = (row = {}, customer = null) => ({
  id: String(row.id || ""),
  customerId: String(row.customer_id || row.customerId || customer?.id || ""),
  customerName: String(customer?.name || row.display_name || ""),
  phone: String(row.phone || ""),
  displayName: String(row.display_name || customer?.name || row.phone || ""),
  lastMessagePreview: String(row.last_message_preview || ""),
  lastMessageAt: whatsappDateIso(row.last_message_at),
  lastInboundAt: whatsappDateIso(row.last_inbound_at),
  unreadCount: Number(row.unread_count || 0),
  status: String(row.status || "open"),
  canSendFreeform: canSendWhatsAppFreeform(row.last_inbound_at),
  createdAt: whatsappDateIso(row.created_at),
  updatedAt: whatsappDateIso(row.updated_at)
});

const mapWhatsAppMessage = (row = {}) => ({
  id: String(row.id || ""),
  conversationId: String(row.conversation_id || ""),
  whatsappMessageId: String(row.whatsapp_message_id || ""),
  direction: String(row.direction || "outbound"),
  messageType: String(row.message_type || "text"),
  status: String(row.status || "queued"),
  phone: String(row.phone || ""),
  textBody: String(row.text_body || ""),
  templateName: String(row.template_name || ""),
  sourceType: String(row.source_type || ""),
  sourceId: String(row.source_id || ""),
  errorMessage: String(row.error_message || ""),
  payload: parseJsonColumn(row.payload, {}),
  timestamp: whatsappDateIso(row.timestamp),
  createdAt: whatsappDateIso(row.created_at),
  updatedAt: whatsappDateIso(row.updated_at)
});

const mapWhatsAppTemplate = (row = {}) => ({
  name: String(row.name || ""),
  languageCode: String(row.language_code || row.languageCode || ""),
  status: String(row.status || ""),
  category: String(row.category || ""),
  components: parseJsonColumn(row.components, []),
  updatedAt: whatsappDateIso(row.updated_at)
});

async function ensureWhatsAppSettings(connection, businessId) {
  const config = whatsappRuntimeConfig();
  await connection.query(
    `INSERT INTO whatsapp_settings
       (business_id, enabled, phone_number_id, business_account_id, display_phone_number, graph_version)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       phone_number_id = VALUES(phone_number_id),
       business_account_id = VALUES(business_account_id),
       display_phone_number = VALUES(display_phone_number),
       graph_version = VALUES(graph_version)`,
    [
      businessId,
      config.enabled,
      config.phoneNumberId,
      config.businessAccountId,
      config.displayPhoneNumber,
      config.graphVersion
    ]
  );
  const [rows] = await connection.query("SELECT * FROM whatsapp_settings WHERE business_id = ? LIMIT 1", [businessId]);
  return rows[0] || null;
}

async function whatsappCustomerByPhone(connection, businessId, phone) {
  const customers = await loadBusinessRecords(connection, businessId, "customers");
  for (const row of customers) {
    if (normalizeWhatsAppPhoneOptional(row.data?.phone) === phone) return row.data;
  }
  return null;
}

async function getWhatsAppConversationById(connection, businessId, conversationId) {
  const [rows] = await connection.query(
    "SELECT * FROM whatsapp_conversations WHERE business_id = ? AND id = ? LIMIT 1",
    [businessId, conversationId]
  );
  return rows[0] || null;
}

async function getOrCreateWhatsAppConversation(connection, businessId, input, options = {}) {
  const phone = normalizeWhatsAppPhone(input.phone);
  const customer = input.customerId ? (await loadBusinessRecord(connection, businessId, "customers", input.customerId))?.data : await whatsappCustomerByPhone(connection, businessId, phone);
  const customerId = String(input.customerId || customer?.id || "");
  const displayName = String(input.displayName || input.customerName || customer?.name || phone).slice(0, 160);
  const lock = options.forUpdate ? "FOR UPDATE" : "";
  const [rows] = await connection.query(
    `SELECT * FROM whatsapp_conversations WHERE business_id = ? AND phone = ? LIMIT 1 ${lock}`,
    [businessId, phone]
  );
  if (!rows.length) {
    const id = uuid();
    await connection.query(
      `INSERT INTO whatsapp_conversations (id, business_id, customer_id, phone, display_name)
       VALUES (?, ?, ?, ?, ?)`,
      [id, businessId, customerId, phone, displayName]
    );
    const [created] = await connection.query("SELECT * FROM whatsapp_conversations WHERE id = ? LIMIT 1", [id]);
    return { row: created[0], customer };
  }
  const row = rows[0];
  const nextCustomerId = row.customer_id || customerId;
  const nextDisplayName = row.display_name || displayName;
  if (nextCustomerId !== row.customer_id || nextDisplayName !== row.display_name) {
    await connection.query(
      "UPDATE whatsapp_conversations SET customer_id = ?, display_name = ? WHERE id = ?",
      [nextCustomerId, nextDisplayName, row.id]
    );
    row.customer_id = nextCustomerId;
    row.display_name = nextDisplayName;
  }
  return { row, customer };
}

const normalizeWhatsAppMessageStatus = (value) => {
  const status = String(value || "").toLowerCase();
  return ["queued", "sent", "delivered", "read", "failed", "received"].includes(status) ? status : "sent";
};

const whatsAppMessagePreview = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
const inboundWhatsAppText = (message = {}) => {
  if (message.text?.body) return String(message.text.body);
  if (message.button?.text) return String(message.button.text);
  if (message.interactive?.button_reply?.title) return String(message.interactive.button_reply.title);
  if (message.interactive?.list_reply?.title) return String(message.interactive.list_reply.title);
  if (message.document?.filename) return `Document: ${message.document.filename}`;
  if (message.image?.caption) return String(message.image.caption);
  if (message.type) return `[${message.type} message]`;
  return "[WhatsApp message]";
};

async function resolveApprovedWhatsAppTemplate(connection, businessId, templateName, languageCode) {
  const name = String(templateName || "").trim();
  if (!name) throwHttpError(422, "validation_error", "WhatsApp template is required.");
  const requestedLanguage = String(languageCode || "").trim();
  const [rows] = await connection.query(
    `SELECT * FROM whatsapp_templates
     WHERE business_id = ? AND name = ? AND UPPER(status) = 'APPROVED'
     ORDER BY CASE WHEN language_code = ? THEN 0 WHEN language_code IN ('en', 'en_US') THEN 1 ELSE 2 END
     LIMIT 1`,
    [businessId, name, requestedLanguage]
  );
  if (!rows.length) throwHttpError(422, "template_not_configured", `Approved WhatsApp template "${name}" is not synced for this business.`);
  return mapWhatsAppTemplate(rows[0]);
}

const safeWhatsAppFileName = (value, fallback = "autocare24-document.pdf") => {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const name = cleaned || fallback;
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
};

const normalizeWhatsAppDocumentMedia = (media) => {
  if (!media || typeof media !== "object") return null;
  const mimeType = String(media.mimeType || "").trim().toLowerCase();
  if (mimeType !== "application/pdf") throwHttpError(422, "validation_error", "Only PDF documents can be sent through this WhatsApp flow.");
  const base64 = String(media.base64 || "").replace(/\s+/g, "");
  const maxBase64Length = Math.ceil((WHATSAPP_DOCUMENT_MAX_BYTES * 4) / 3) + 4;
  if (!base64 || base64.length > maxBase64Length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throwHttpError(422, "validation_error", "A valid PDF document payload is required.");
  }
  const buffer = Buffer.from(base64, "base64");
  const declaredSize = Number(media.sizeBytes || 0);
  if (!buffer.length || buffer.length > WHATSAPP_DOCUMENT_MAX_BYTES) {
    throwHttpError(413, "whatsapp_document_too_large", "PDF is too large for this WhatsApp send flow.");
  }
  if (declaredSize > 0 && declaredSize !== buffer.length) {
    throwHttpError(422, "validation_error", "PDF document size does not match the supplied payload.");
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throwHttpError(422, "validation_error", "The supplied WhatsApp document is not a valid PDF.");
  }
  return {
    fileName: safeWhatsAppFileName(media.fileName),
    mimeType,
    sizeBytes: buffer.length,
    buffer
  };
};

const whatsappMediaMetadata = (media) => media ? { fileName: media.fileName, mimeType: media.mimeType, sizeBytes: media.sizeBytes } : null;

const templateHasDocumentHeader = (template) =>
  Array.isArray(template?.components) &&
  template.components.some((component) =>
    String(component?.type || "").toUpperCase() === "HEADER" && String(component?.format || "").toUpperCase() === "DOCUMENT"
  );

function buildWhatsAppTemplatePayload(phone, template, variables, documentMedia) {
  const parameters = (Array.isArray(variables) ? variables : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((text) => ({ type: "text", text: text.slice(0, 1024) }));
  const components = [];
  if (documentMedia?.id) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            id: documentMedia.id,
            filename: documentMedia.fileName
          }
        }
      ]
    });
  }
  if (parameters.length) components.push({ type: "body", parameters });
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.languageCode || "en" },
      ...(components.length ? { components } : {})
    }
  };
}

function buildWhatsAppTextPayload(phone, text) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: {
      preview_url: false,
      body: String(text || "").trim().slice(0, 4096)
    }
  };
}

function buildWhatsAppDocumentPayload(phone, documentMedia, caption) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "document",
    document: {
      id: documentMedia.id,
      filename: documentMedia.fileName,
      caption: String(caption || "").trim().slice(0, 1024)
    }
  };
}

async function fetchWhatsAppGraph(config, pathName, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.graphBaseUrl}/${config.graphVersion}/${pathName.replace(/^\/+/, "")}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        ...(options.body ? { "content-type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!response.ok) {
      const metaMessage = body?.error?.message || body?.message || `WhatsApp API failed with HTTP ${response.status}.`;
      throw Object.assign(new Error(metaMessage), { status: response.status, meta: body });
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadWhatsAppDocumentMedia(config, media) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", media.mimeType);
    form.append("file", new Blob([media.buffer], { type: media.mimeType }), media.fileName);
    const response = await fetch(`${config.graphBaseUrl}/${config.graphVersion}/${config.phoneNumberId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}` },
      body: form,
      signal: controller.signal
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!response.ok || !body.id) {
      const metaMessage = body?.error?.message || body?.message || `WhatsApp media upload failed with HTTP ${response.status}.`;
      throw Object.assign(new Error(metaMessage), { status: response.status, meta: body });
    }
    return {
      id: String(body.id),
      fileName: media.fileName,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsAppCloudMessage(config, phone, payload) {
  return fetchWhatsAppGraph(config, `${config.phoneNumberId}/messages`, { method: "POST", body: payload });
}

async function handleWhatsAppStatus(res, device) {
  const connection = await pool.getConnection();
  try {
    const settings = await ensureWhatsAppSettings(connection, device.business_id);
    const [templateCountRows] = await connection.query("SELECT COUNT(*) AS total FROM whatsapp_templates WHERE business_id = ?", [device.business_id]);
    const config = whatsappRuntimeConfig();
    return ok(res, {
      status: {
        enabled: config.enabled,
        configured: config.configured,
        webhookReady: config.webhookReady,
        phoneNumberId: config.phoneNumberId,
        businessAccountId: config.businessAccountId,
        displayPhoneNumber: settings?.display_phone_number || config.displayPhoneNumber,
        graphVersion: config.graphVersion,
        templatesCount: Number(templateCountRows[0]?.total || 0),
        lastTemplateSyncAt: whatsappDateIso(settings?.last_template_sync_at),
        webhookVerifiedAt: whatsappDateIso(settings?.webhook_verified_at),
        message: config.configured
          ? "WhatsApp Business API is connected through the cloud API."
          : "WhatsApp Business API not configured. Set WHATSAPP_ENABLED, WHATSAPP_ACCESS_TOKEN, and WHATSAPP_PHONE_NUMBER_ID on cloud-api."
      }
    });
  } finally {
    connection.release();
  }
}

async function handleWhatsAppTemplatesList(res, device) {
  const [rows] = await pool.query(
    "SELECT * FROM whatsapp_templates WHERE business_id = ? ORDER BY name ASC, language_code ASC",
    [device.business_id]
  );
  return ok(res, { templates: rows.map(mapWhatsAppTemplate) });
}

async function handleWhatsAppTemplatesSync(res, device) {
  const config = whatsappRuntimeConfig();
  if (!config.configured || !config.businessAccountId) {
    return error(res, 422, "whatsapp_not_configured", "Set WhatsApp Business Account ID, phone number ID, and access token before syncing templates.");
  }
  const templates = [];
  let nextPath = `${config.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=100`;
  let pageCount = 0;
  while (nextPath && pageCount < 10) {
    const body = nextPath.startsWith("http")
      ? await fetch(nextPath, { headers: { authorization: `Bearer ${config.accessToken}` } }).then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "Unable to sync WhatsApp templates."), { status: response.status });
          return payload;
        })
      : await fetchWhatsAppGraph(config, nextPath);
    for (const item of Array.isArray(body.data) ? body.data : []) {
      templates.push({
        name: String(item.name || ""),
        languageCode: String(item.language || ""),
        status: String(item.status || ""),
        category: String(item.category || ""),
        components: Array.isArray(item.components) ? item.components : []
      });
    }
    nextPath = body.paging?.next || "";
    pageCount += 1;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureWhatsAppSettings(connection, device.business_id);
    for (const template of templates.filter((item) => item.name && item.languageCode)) {
      await connection.query(
        `INSERT INTO whatsapp_templates (business_id, name, language_code, status, category, components)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), category = VALUES(category), components = VALUES(components)`,
        [device.business_id, template.name, template.languageCode, template.status, template.category, JSON.stringify(template.components)]
      );
    }
    await connection.query("UPDATE whatsapp_settings SET last_template_sync_at = CURRENT_TIMESTAMP WHERE business_id = ?", [device.business_id]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  return ok(res, { templates, syncedCount: templates.length });
}

async function handleWhatsAppConversationsList(res, device, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 60)));
  const q = String(url.searchParams.get("q") || "").trim();
  const like = `%${q}%`;
  const params = q
    ? [device.business_id, like, like, like, limit]
    : [device.business_id, limit];
  const [rows] = await pool.query(
    q
      ? `SELECT * FROM whatsapp_conversations
         WHERE business_id = ? AND (phone LIKE ? OR display_name LIKE ? OR last_message_preview LIKE ?)
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT ?`
      : `SELECT * FROM whatsapp_conversations
         WHERE business_id = ?
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT ?`,
    params
  );
  const connection = await pool.getConnection();
  try {
    const customers = await loadBusinessRecords(connection, device.business_id, "customers");
    const byId = new Map(customers.map((row) => [row.recordId, row.data]));
    const byPhone = new Map(customers.map((row) => [normalizeWhatsAppPhoneOptional(row.data?.phone), row.data]).filter(([phone]) => phone));
    const conversations = rows.map((row) => mapWhatsAppConversation(row, byId.get(row.customer_id) || byPhone.get(row.phone) || null));
    return ok(res, { conversations });
  } finally {
    connection.release();
  }
}

async function handleWhatsAppMessagesList(res, device, conversationId, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const connection = await pool.getConnection();
  try {
    const conversation = await getWhatsAppConversationById(connection, device.business_id, conversationId);
    if (!conversation) return error(res, 404, "not_found", "WhatsApp conversation was not found.");
    const customer = conversation.customer_id
      ? (await loadBusinessRecord(connection, device.business_id, "customers", conversation.customer_id))?.data
      : await whatsappCustomerByPhone(connection, device.business_id, conversation.phone);
    const [rows] = await connection.query(
      `SELECT * FROM whatsapp_messages
       WHERE business_id = ? AND conversation_id = ?
       ORDER BY COALESCE(timestamp, created_at) DESC
       LIMIT ?`,
      [device.business_id, conversationId, limit]
    );
    await connection.query("UPDATE whatsapp_conversations SET unread_count = 0 WHERE business_id = ? AND id = ?", [device.business_id, conversationId]);
    return ok(res, {
      conversation: mapWhatsAppConversation({ ...conversation, unread_count: 0 }, customer),
      messages: rows.reverse().map(mapWhatsAppMessage)
    });
  } finally {
    connection.release();
  }
}

async function handleWhatsAppMessageSend(req, res, device) {
  const config = whatsappRuntimeConfig();
  if (!config.configured) return error(res, 503, "whatsapp_not_configured", "WhatsApp Business API not configured on cloud-api.");
  const body = await readBody(req);
  const phone = normalizeWhatsAppPhone(body.phone);
  const mode = body.mode === "text" ? "text" : "template";
  const source = typeof body.source === "object" && body.source ? body.source : {};
  const documentMedia = normalizeWhatsAppDocumentMedia(body.media || body.document);
  const documentMetadata = whatsappMediaMetadata(documentMedia);
  const connection = await pool.getConnection();
  let conversation;
  let template = null;
  let messageId = "";
  let textBody = "";
  let metaPayload;
  try {
    await connection.beginTransaction();
    await ensureWhatsAppSettings(connection, device.business_id);
    const conversationResult = await getOrCreateWhatsAppConversation(connection, device.business_id, {
      phone,
      customerId: body.customerId,
      customerName: body.customerName,
      displayName: body.customerName
    }, { forUpdate: true });
    conversation = conversationResult.row;
    if (mode === "text") {
      textBody = String(body.text || "").trim();
      if (!textBody) throwHttpError(422, "validation_error", "Message text is required.");
      if (!canSendWhatsAppFreeform(conversation.last_inbound_at)) {
        throwHttpError(422, "template_required", "Use an approved WhatsApp template first. Freeform replies are allowed only after the customer messages you.");
      }
      metaPayload = documentMetadata ? { pendingDocument: documentMetadata, caption: textBody } : buildWhatsAppTextPayload(phone, textBody);
    } else {
      template = await resolveApprovedWhatsAppTemplate(connection, device.business_id, body.templateName, body.languageCode);
      if (documentMetadata && !templateHasDocumentHeader(template)) {
        throwHttpError(
          422,
          "template_document_header_required",
          `Approved WhatsApp template "${template.name}" must include a document header before PDF sharing can send the PDF.`
        );
      }
      textBody = String(body.text || `Template: ${template.name}`).trim();
      metaPayload = documentMetadata
        ? { pendingTemplateDocument: { templateName: template.name, languageCode: template.languageCode, media: documentMetadata }, variables: body.variables || [] }
        : buildWhatsAppTemplatePayload(phone, template, body.variables);
    }
    messageId = uuid();
    await connection.query(
      `INSERT INTO whatsapp_messages
         (id, business_id, conversation_id, direction, message_type, status, phone, text_body, template_name, source_type, source_id, payload, timestamp)
       VALUES (?, ?, ?, 'outbound', ?, 'queued', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        messageId,
        device.business_id,
        conversation.id,
        documentMetadata ? "document" : mode,
        phone,
        textBody,
        template?.name || "",
        String(source.type || body.sourceType || "").slice(0, 40),
        String(source.id || body.sourceId || "").slice(0, 80),
        JSON.stringify({ request: metaPayload, variables: body.variables || [] })
      ]
    );
    await connection.query(
      `UPDATE whatsapp_conversations
       SET last_message_preview = ?, last_message_at = CURRENT_TIMESTAMP, customer_id = COALESCE(NULLIF(?, ''), customer_id)
       WHERE business_id = ? AND id = ?`,
      [whatsAppMessagePreview(textBody), String(body.customerId || ""), device.business_id, conversation.id]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    connection.release();
    throw err;
  }
  try {
    let uploadedDocument = null;
    if (documentMedia) uploadedDocument = await uploadWhatsAppDocumentMedia(config, documentMedia);
    if (uploadedDocument) {
      metaPayload = mode === "text"
        ? buildWhatsAppDocumentPayload(phone, uploadedDocument, textBody)
        : buildWhatsAppTemplatePayload(phone, template, body.variables, uploadedDocument);
    }
    const metaResponse = await sendWhatsAppCloudMessage(config, phone, metaPayload);
    const whatsappMessageId = String(metaResponse?.messages?.[0]?.id || "");
    await pool.query(
      `UPDATE whatsapp_messages
       SET whatsapp_message_id = ?, status = 'sent', payload = ?
       WHERE business_id = ? AND id = ?`,
      [
        whatsappMessageId || null,
        JSON.stringify({ request: metaPayload, response: metaResponse, variables: body.variables || [], media: uploadedDocument ? whatsappMediaMetadata(uploadedDocument) : documentMetadata }),
        device.business_id,
        messageId
      ]
    );
    await pool.query(
      `INSERT INTO whatsapp_message_events (business_id, message_id, whatsapp_message_id, event_type, status, payload, occurred_at)
       VALUES (?, ?, ?, 'send', 'sent', ?, CURRENT_TIMESTAMP)`,
      [device.business_id, messageId, whatsappMessageId, JSON.stringify(metaResponse)]
    );
    const [messageRows] = await pool.query("SELECT * FROM whatsapp_messages WHERE business_id = ? AND id = ? LIMIT 1", [device.business_id, messageId]);
    const [conversationRows] = await pool.query("SELECT * FROM whatsapp_conversations WHERE business_id = ? AND id = ? LIMIT 1", [device.business_id, conversation.id]);
    return ok(res, {
      message: mapWhatsAppMessage(messageRows[0]),
      conversation: mapWhatsAppConversation(conversationRows[0])
    }, 201, { location: `/api/v1/whatsapp/conversations/${conversation.id}/messages` });
  } catch (err) {
    const failureMessage = err instanceof Error ? err.message : "Unable to send WhatsApp message.";
    await pool.query(
      "UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE business_id = ? AND id = ?",
      [failureMessage.slice(0, 500), device.business_id, messageId]
    );
    throwHttpError(502, "whatsapp_send_failed", failureMessage);
  } finally {
    connection.release();
  }
}

const verifyMetaWebhookSignature = (raw, signature) => {
  const config = whatsappRuntimeConfig();
  if (!config.appSecret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
  const received = String(signature || "");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

async function resolveMetaWebhookBusinessId(connection, phoneNumberId) {
  const id = String(phoneNumberId || "").trim();
  if (!id) return null;
  const [rows] = await connection.query("SELECT business_id FROM whatsapp_settings WHERE phone_number_id = ? LIMIT 1", [id]);
  if (rows.length) return Number(rows[0].business_id || 0) || null;
  const config = whatsappRuntimeConfig();
  if (config.phoneNumberId && config.phoneNumberId === id) {
    await ensureWhatsAppSettings(connection, 1);
    return 1;
  }
  return null;
}

async function storeInboundWhatsAppMessage(connection, businessId, value, message) {
  const phone = normalizeWhatsAppPhoneOptional(message.from);
  if (!phone || !message.id) return;
  const contact = (Array.isArray(value.contacts) ? value.contacts : []).find((row) => normalizeWhatsAppPhoneOptional(row.wa_id) === phone) || {};
  const displayName = contact.profile?.name || phone;
  const textBody = inboundWhatsAppText(message);
  const timestamp = mysqlDateFromUnix(message.timestamp);
  const conversationResult = await getOrCreateWhatsAppConversation(connection, businessId, {
    phone,
    displayName
  }, { forUpdate: true });
  const [existing] = await connection.query(
    "SELECT id FROM whatsapp_messages WHERE business_id = ? AND whatsapp_message_id = ? LIMIT 1",
    [businessId, message.id]
  );
  if (!existing.length) {
    await connection.query(
      `INSERT INTO whatsapp_messages
         (id, business_id, conversation_id, whatsapp_message_id, direction, message_type, status, phone, text_body, payload, timestamp)
       VALUES (?, ?, ?, ?, 'inbound', ?, 'received', ?, ?, ?, ?)`,
      [
        uuid(),
        businessId,
        conversationResult.row.id,
        String(message.id),
        ["text", "image", "document", "template"].includes(message.type) ? message.type : "unknown",
        phone,
        textBody,
        JSON.stringify(message),
        timestamp
      ]
    );
    await connection.query(
      `UPDATE whatsapp_conversations
       SET display_name = COALESCE(NULLIF(display_name, ''), ?),
           last_message_preview = ?,
           last_message_at = ?,
           last_inbound_at = ?,
           unread_count = unread_count + 1
       WHERE business_id = ? AND id = ?`,
      [displayName, whatsAppMessagePreview(textBody), timestamp, timestamp, businessId, conversationResult.row.id]
    );
  }
  await connection.query(
    `INSERT INTO whatsapp_message_events (business_id, whatsapp_message_id, event_type, status, payload, occurred_at)
     VALUES (?, ?, 'message', 'received', ?, ?)`,
    [businessId, String(message.id), JSON.stringify(message), timestamp]
  );
}

async function storeWhatsAppStatusEvent(connection, businessId, status) {
  const whatsappMessageId = String(status.id || "");
  if (!whatsappMessageId) return;
  const normalizedStatus = normalizeWhatsAppMessageStatus(status.status);
  const timestamp = mysqlDateFromUnix(status.timestamp);
  const errorMessage = Array.isArray(status.errors) && status.errors.length
    ? String(status.errors[0]?.message || status.errors[0]?.title || "WhatsApp delivery failed.").slice(0, 500)
    : "";
  const [messages] = await connection.query(
    "SELECT id, conversation_id FROM whatsapp_messages WHERE business_id = ? AND whatsapp_message_id = ? LIMIT 1",
    [businessId, whatsappMessageId]
  );
  const messageId = messages[0]?.id || null;
  if (messageId) {
    await connection.query(
      "UPDATE whatsapp_messages SET status = ?, error_message = ? WHERE business_id = ? AND id = ?",
      [normalizedStatus, errorMessage, businessId, messageId]
    );
  }
  await connection.query(
    `INSERT INTO whatsapp_message_events (business_id, message_id, whatsapp_message_id, event_type, status, payload, occurred_at)
     VALUES (?, ?, ?, 'status', ?, ?, ?)`,
    [businessId, messageId, whatsappMessageId, normalizedStatus, JSON.stringify(status), timestamp]
  );
}

async function handleMetaWebhookVerify(req, res, url) {
  const config = whatsappRuntimeConfig();
  const mode = url.searchParams.get("hub.mode");
  const tokenValue = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (!config.enabled || !config.verifyToken) return error(res, 503, "whatsapp_not_configured", "WhatsApp webhook verify token is not configured.");
  if (mode !== "subscribe" || tokenValue !== config.verifyToken) return error(res, 403, "forbidden", "WhatsApp webhook verification failed.");
  const connection = await pool.getConnection();
  try {
    await ensureWhatsAppSettings(connection, 1);
    await connection.query("UPDATE whatsapp_settings SET webhook_verified_at = CURRENT_TIMESTAMP WHERE business_id = 1");
  } finally {
    connection.release();
  }
  return textResponse(res, 200, challenge);
}

async function handleMetaWebhookPost(req, res) {
  const config = whatsappRuntimeConfig();
  if (!config.webhookReady) return error(res, 503, "whatsapp_not_configured", "WhatsApp webhook signature secret is not configured.");
  const raw = await readRawBody(req);
  if (!verifyMetaWebhookSignature(raw, req.headers["x-hub-signature-256"])) {
    return error(res, 401, "invalid_signature", "WhatsApp webhook signature is invalid.");
  }
  let body = {};
  try {
    body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    return error(res, 400, "invalid_json", "Request body must be valid JSON.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = change.value || {};
        const businessId = await resolveMetaWebhookBusinessId(connection, value.metadata?.phone_number_id);
        if (!businessId) continue;
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          await storeInboundWhatsAppMessage(connection, businessId, value, message);
        }
        for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
          await storeWhatsAppStatusEvent(connection, businessId, status);
        }
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  return ok(res, { received: true });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (rejectBrowserOrigin(req, res)) return;
    if (url.pathname === UPDATE_FEED_PREFIX || url.pathname.startsWith(`${UPDATE_FEED_PREFIX}/`)) {
      return handleUpdateAsset(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      return handleHealth(res);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/whatsapp/webhook") return handleMetaWebhookVerify(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/v1/whatsapp/webhook") return handleMetaWebhookPost(req, res);
    if (req.method === "POST" && url.pathname === "/api/v1/auth/devices") return handleDeviceRegistration(req, res);
    if (req.method === "GET" && url.pathname === "/api/v1/auth/devices/current/status") return handleCurrentDeviceApprovalStatus(req, res);
    if (req.method === "DELETE" && url.pathname === "/api/v1/auth/devices/current") return handleCurrentDeviceDisconnect(req, res);
    const device = await requireDevice(req, res);
    if (!device) return;
    if (req.method === "POST" && url.pathname === "/api/v1/admin/devices/list") {
      const actor = await optionalCloudUserForPermission(req, device, ["users.manage"]);
      return handleAdminDevicesList(req, res, device, actor);
    }
    const adminDeviceApproveMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/approve$/.exec(url.pathname);
    if (adminDeviceApproveMatch && req.method === "POST") {
      const actor = await optionalCloudUserForPermission(req, device, ["users.manage"]);
      return handleAdminDeviceApprove(req, res, device, adminDeviceApproveMatch[1], actor);
    }
    const adminDeviceRevokeMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/revoke$/.exec(url.pathname);
    if (adminDeviceRevokeMatch && req.method === "POST") {
      const actor = await optionalCloudUserForPermission(req, device, ["users.manage"]);
      return handleAdminDeviceRevoke(req, res, device, adminDeviceRevokeMatch[1], actor);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/auth/status") return handleCloudAuthStatus(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/auth/setup-owner") return handleCloudSetupOwner(req, res, device);
    if (req.method === "POST" && url.pathname === "/api/v1/auth/login") return handleCloudLogin(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/users") {
      await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudUsersList(req, res, device);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/users") {
      const actor = await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudUserSave(req, res, device, actor);
    }
    const userMatch = /^\/api\/v1\/users\/([^/]+)$/.exec(url.pathname);
    if (userMatch && req.method === "DELETE") {
      const actor = await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudUserDeactivate(req, res, device, userMatch[1], actor);
    }
    const userPasswordMatch = /^\/api\/v1\/users\/([^/]+)\/change-password$/.exec(url.pathname);
    if (userPasswordMatch && req.method === "POST") {
      const actor = await requireCloudUser(req, device);
      return handleCloudUserChangePassword(req, res, device, userPasswordMatch[1], actor);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/access-roles") {
      await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudRolesList(req, res, device);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/access-roles") {
      await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudRoleSave(req, res, device);
    }
    const roleMatch = /^\/api\/v1\/access-roles\/([^/]+)$/.exec(url.pathname);
    if (roleMatch && req.method === "DELETE") {
      await requireCloudUser(req, device, ["users.manage"]);
      return handleCloudRoleDeactivate(req, res, device, roleMatch[1]);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/sync/push") return handlePush(req, res, device);
    if (req.method === "GET" && url.pathname === "/api/v1/sync/pull") return handlePull(req, res, device, url);
    const recordCollectionMatch = /^\/api\/v1\/records\/([^/]+)$/.exec(url.pathname);
    if (recordCollectionMatch && req.method === "GET") {
      await requireCloudUser(req, device, recordPermissionsFor(recordCollectionMatch[1], "GET"));
      return handleRecordsList(req, res, device, url, recordCollectionMatch[1]);
    }
    if (recordCollectionMatch && req.method === "POST") {
      await requireCloudUser(req, device, recordPermissionsFor(recordCollectionMatch[1], "POST"));
      return handleRecordCreate(req, res, device, recordCollectionMatch[1]);
    }
    const recordItemMatch = /^\/api\/v1\/records\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (recordItemMatch && req.method === "GET") {
      await requireCloudUser(req, device, recordPermissionsFor(recordItemMatch[1], "GET"));
      return handleRecordGet(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    }
    if (recordItemMatch && req.method === "PATCH") {
      await requireCloudUser(req, device, recordPermissionsFor(recordItemMatch[1], "PATCH"));
      return handleRecordPatch(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    }
    if (recordItemMatch && req.method === "DELETE") {
      await requireCloudUser(req, device, recordPermissionsFor(recordItemMatch[1], "DELETE"));
      return handleRecordDelete(req, res, device, recordItemMatch[1], recordItemMatch[2]);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/dashboard") {
      await requireCloudUser(req, device, ["dashboard.view"]);
      return handleDashboard(res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/reports") {
      await requireCloudUser(req, device, ["reports.view"]);
      return handleReports(req, res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/profit") {
      await requireCloudUser(req, device, ["reports.view"]);
      return handleProfit(req, res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/whatsapp/status") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppStatus(res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/whatsapp/conversations") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppConversationsList(res, device, url);
    }
    const whatsappMessagesMatch = /^\/api\/v1\/whatsapp\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
    if (whatsappMessagesMatch && req.method === "GET") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppMessagesList(res, device, whatsappMessagesMatch[1], url);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/whatsapp/messages") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppMessageSend(req, res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/whatsapp/templates") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppTemplatesList(res, device);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/whatsapp/templates/sync") {
      await requireCloudUser(req, device, ["sharing.whatsapp"]);
      return handleWhatsAppTemplatesSync(res, device);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/invoices") {
      await requireCloudUser(req, device, ["billing.view"]);
      return handleInvoicesList(req, res, device, url);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/invoices/finalize") {
      await requireCloudUser(req, device, ["billing.create"]);
      return handleInvoiceFinalize(req, res, device);
    }
    const invoiceMatch = /^\/api\/v1\/invoices\/([^/]+)$/.exec(url.pathname);
    if (invoiceMatch && req.method === "GET") {
      await requireCloudUser(req, device, ["billing.view"]);
      return handleInvoiceGet(res, device, invoiceMatch[1]);
    }
    const invoicePaymentMatch = /^\/api\/v1\/invoices\/([^/]+)\/payments$/.exec(url.pathname);
    if (invoicePaymentMatch && req.method === "POST") {
      await requireCloudUser(req, device, ["billing.recordPayments"]);
      return handleInvoicePayment(req, res, device, invoicePaymentMatch[1]);
    }
    const invoiceCancelMatch = /^\/api\/v1\/invoices\/([^/]+)\/cancel$/.exec(url.pathname);
    if (invoiceCancelMatch && req.method === "POST") {
      await requireCloudUser(req, device, ["billing.cancelInvoices"]);
      return handleInvoiceCancel(req, res, device, invoiceCancelMatch[1]);
    }
    const invoiceItemMatch = /^\/api\/v1\/invoices\/([^/]+)\/items$/.exec(url.pathname);
    if (invoiceItemMatch && req.method === "POST") {
      await requireCloudUser(req, device, ["billing.manageInvoices"]);
      return handleInvoiceAppendItem(req, res, device, invoiceItemMatch[1]);
    }
    const quotationConvertMatch = /^\/api\/v1\/quotations\/([^/]+)\/convert-to-invoice$/.exec(url.pathname);
    if (quotationConvertMatch && req.method === "POST") {
      await requireCloudUser(req, device, ["quotations.convert"]);
      return handleQuotationConvertToInvoice(req, res, device, quotationConvertMatch[1]);
    }
    const jobCardConvertMatch = /^\/api\/v1\/job-cards\/([^/]+)\/convert-to-invoice$/.exec(url.pathname);
    if (jobCardConvertMatch && req.method === "POST") {
      await requireCloudUser(req, device, ["jobCards.manage"]);
      return handleJobCardConvertToInvoice(req, res, device, jobCardConvertMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/inventory/dashboard") {
      await requireCloudUser(req, device, ["stock.view"]);
      return handleInventoryDashboard(res, device);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/inventory/purchases") {
      await requireCloudUser(req, device, ["stock.purchase"]);
      return handleInventoryPurchase(req, res, device);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/inventory/movements") {
      await requireCloudUser(req, device, ["stock.adjust"]);
      return handleInventoryMovement(req, res, device);
    }
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
