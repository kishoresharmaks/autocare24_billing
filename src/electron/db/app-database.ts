import { app } from "electron";
import { execFileSync } from "node:child_process";
import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  ALL_PERMISSIONS,
  DEFAULT_ACCESS_ROLES,
  OWNER_ACCESS_ROLE_ID,
  STAFF_OPERATIONS_ROLE_ID,
  normalizePermissions
} from "../../shared/access-control";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, normalizeSacCode } from "../../shared/billing-math";
import { CORE_SCHEMA_SQL, DATA_TABLES, INVOICES_JOB_CARD_INDEX_SQL, SCHEMA_COLUMNS } from "./schema";
import { BUSINESS_SETTINGS_SYNC_ID, JOB_CARD_SETTINGS_SYNC_ID } from "../../shared/types";
import type {
  AccessRole,
  BusinessSettings,
  CloudDeviceApprovalStatus,
  ChangePasswordInput,
  CloudSyncRecordStatus,
  Customer,
  CustomerWithVehicles,
  DashboardData,
  DataHealthIssue,
  DataHealthReport,
  DateRangePreset,
  Enquiry,
  EnquiryDashboardData,
  EnquiryFollowup,
  EnquiryFollowupInput,
  EnquiryInput,
  EnquiryReportData,
  EnquirySource,
  EnquiryStatus,
  Expense,
  ExpenseInput,
  InvoiceAppendItemInput,
  InvoiceCreateInput,
  InvoiceCancelInput,
  InvoiceDetail,
  InvoiceDraft,
  InvoiceDraftCorrectionType,
  InvoiceDraftPayload,
  InvoiceDraftSaveInput,
  InvoiceDensity,
  InvoiceFontStyle,
  InvoiceLogoSize,
  InvoicePaperSize,
  InvoiceTextSize,
  InvoiceWatermarkPlacement,
  InventoryBatch,
  InventoryDashboardData,
  InventoryItem,
  InventoryMovement,
  InventoryMovementInput,
  InventoryMovementType,
  InventoryPurchaseInput,
  JobCardChecklistItem,
  JobCardDashboardData,
  JobCardDetail,
  JobCardInput,
  JobCardItem,
  JobCardItemInput,
  JobCardPhoto,
  JobCardPhotoType,
  JobCardReportData,
  JobCardStatus,
  JobCardStatusHistory,
  JobCardSummary,
  LoginInput,
  InvoiceItem,
  InvoiceItemInput,
  InvoiceMode,
  InvoiceSummary,
  Payment,
  PaymentMode,
  PaymentStatus,
  PermissionKey,
  ProfitReportData,
  PurchaseRecord,
  PurchaseRecordDocument,
  QuotationDetail,
  QuotationItem,
  QuotationItemInput,
  QuotationSaveInput,
  QuotationStatus,
  QuotationStatusInput,
  QuotationSummary,
  RecordPaymentInput,
  ReportDateFilter,
  ReportData,
  ReportExportKind,
  SaveResult,
  SafeRepairCode,
  SafeRepairResult,
  SaveAccessRoleInput,
  SaveUserInput,
  ServiceConsumable,
  ServiceItem,
  SyncConnectionState,
  SyncConflictResolution,
  SyncConflictSummary,
  SyncDeviceStatus,
  SyncEntity,
  SyncFileType,
  SyncOperationType,
  SyncOutboxEntry,
  SyncOutboxStatus,
  Supplier,
  TaxScope,
  AppUser,
  BackupCloudSnapshotStatus,
  BackupResult,
  SetupOwnerInput,
  Vehicle,
  VehicleType
} from "../../shared/types";

type SqlValue = string | number | null;
type Row = Record<string, string | number | null>;
type ReportFilterInput = DateRangePreset | ReportDateFilter | undefined;
type CloudRecord = {
  entity?: string;
  recordId?: string;
  data?: Record<string, unknown> | string | null;
  revision?: number;
  deletedAt?: string | null;
};
type BackupCloudSnapshotBundle = {
  data: Buffer;
  status: BackupCloudSnapshotStatus;
};
type BackupCreateOptions = {
  cloudSnapshot?: BackupCloudSnapshotBundle | null;
  cloudSnapshotStatus?: BackupCloudSnapshotStatus | null;
};

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const nowIso = () => new Date().toISOString();
const EMPTY_JSON_OBJECT = "{}";
const EMPTY_JSON_ARRAY = "[]";
const SYNC_SIDE_TABLES = new Set(["sync_outbox", "sync_state", "sync_conflicts", "sync_files", "sync_device"]);
const CLOUD_SYNC_SKIP_TABLES = new Set(["backups", "settings", ...SYNC_SIDE_TABLES]);

const localDate = (date = new Date()) => {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
};

const timestampForFile = () => {
  const normalized = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return normalized.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
};

const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const JOB_CARD_STATUSES: JobCardStatus[] = [
  "draft",
  "estimate_pending",
  "approved",
  "in_progress",
  "quality_check",
  "ready_delivery",
  "delivered",
  "billed",
  "cancelled"
];
const JOB_CARD_PHOTO_TYPES: JobCardPhotoType[] = ["before", "after", "damage", "work_progress", "delivery"];
const QUOTATION_STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "converted"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_CARD_PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_JOB_CARD_PHOTO_BYTES = 10 * 1024 * 1024;
const AUTOCAR24_INVOICE_ACCENT = "#d71920";
const LEGACY_INVOICE_ACCENTS = ["#1c5d52", "#00583f"];
const BACKUP_BUNDLE_EXTENSION = ".ac24backup";
const BACKUP_DATABASE_ENTRY = "autocare24.sqlite";
const BACKUP_MANIFEST_ENTRY = "backup-manifest.json";
const BACKUP_INVOICE_ASSET_ROOT = "invoice-assets";
const BACKUP_JOB_CARD_PHOTO_ROOT = "job-card-photos";
const BACKUP_PURCHASE_DOCUMENT_ROOT = "purchase-documents";
const BACKUP_CLOUD_SNAPSHOT_ENTRY = "cloud-data/cloud-snapshot.json";
const DAILY_BACKUP_HOUR = 19;
const LOCAL_ONLY_SETTING_KEYS = new Set(["googleDriveClientSecret", "googleDriveClientSecretCiphertext"]);
const HARDWARE_ID_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = [ordered]@{}
try { $ids.CsProductUuid = (Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID } catch {}
try { $ids.BiosSerial = (Get-CimInstance -ClassName Win32_BIOS).SerialNumber } catch {}
try { $ids.BaseBoardSerial = (Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber } catch {}
try { $ids.MachineGuid = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid } catch {}
$ids | ConvertTo-Json -Compress
`.trim();
const DEFAULT_JOB_CHECKLIST = [
  "Vehicle condition checked",
  "Customer belongings noted",
  "Before photos captured",
  "Service work completed",
  "Interior quality checked",
  "Exterior quality checked",
  "After photos captured",
  "Customer delivery note updated"
];

let cachedStableDeviceIdentity: { deviceId: string; deviceCode: string } | null = null;

const invalidHardwareValues = new Set([
  "0",
  "none",
  "null",
  "unknown",
  "default string",
  "to be filled by o.e.m.",
  "to be filled by oem",
  "system serial number"
]);

const cleanHardwareValue = (value: unknown) => String(value || "").trim();

const isUsableHardwareValue = (value: string) => {
  const normalized = value.toLowerCase();
  if (!normalized || invalidHardwareValues.has(normalized)) return false;
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (!compact || /^0+$/.test(compact) || /^f+$/.test(compact)) return false;
  return true;
};

const readWindowsHardwareValues = () => {
  if (process.platform !== "win32") return [];
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", HARDWARE_ID_SCRIPT],
      { encoding: "utf8", timeout: 6000, windowsHide: true }
    ).trim();
    const parsed = JSON.parse(output || "{}") as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => ({ key, value: cleanHardwareValue(value) }))
      .filter((entry) => isUsableHardwareValue(entry.value))
      .map((entry) => `${entry.key}:${entry.value}`);
  } catch {
    return [];
  }
};

const readNetworkHardwareValues = () => {
  const values: string[] = [];
  Object.entries(os.networkInterfaces()).forEach(([name, entries]) => {
    (entries || []).forEach((entry) => {
      const mac = cleanHardwareValue(entry.mac).toLowerCase();
      if (!entry.internal && isUsableHardwareValue(mac) && mac !== "00:00:00:00:00:00") {
        values.push(`NetworkMac:${name}:${mac}`);
      }
    });
  });
  return values;
};

const uuidFromStableValue = (value: string) => {
  const chars = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const stableDeviceIdentity = () => {
  if (cachedStableDeviceIdentity) return cachedStableDeviceIdentity;
  const hardwareValues = [...readWindowsHardwareValues(), ...readNetworkHardwareValues()];
  const fingerprint = hardwareValues.length
    ? hardwareValues.sort().join("|")
    : `fallback:${process.platform}:${os.hostname() || process.env.COMPUTERNAME || process.env.HOSTNAME || ""}`;
  const deviceId = uuidFromStableValue(`autocare24-hardware-device-v1:${fingerprint}`);
  cachedStableDeviceIdentity = {
    deviceId,
    deviceCode: deviceId.slice(0, 8).toUpperCase()
  };
  return cachedStableDeviceIdentity;
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const hashPassword = (password: string, salt = randomBytes(16).toString("hex")) => ({
  salt,
  hash: pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("hex")
});

const verifyPassword = (password: string, salt: string, expectedHash: string) => {
  const actual = Buffer.from(hashPassword(password, salt).hash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const normalizeParam = (value: unknown): SqlValue => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return String(value);
};
const normalizeCloudParam = (value: unknown): SqlValue => {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return normalizeParam(value);
};

const requiredText = (value: unknown, field: string) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
};

const optionalForeignKey = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

const finiteNumber = (value: unknown, field: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a valid number.`);
  return number;
};

const positiveNumber = (value: unknown, field: string) => {
  const number = finiteNumber(value, field);
  if (number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
};

const nonNegativeNumber = (value: unknown, field: string) => {
  const number = finiteNumber(value, field);
  if (number < 0) throw new Error(`${field} cannot be negative.`);
  return number;
};

const isInsideDirectory = (root: string, target: string) => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot.toLowerCase() : `${resolvedRoot}${path.sep}`.toLowerCase();
  return resolvedTarget.toLowerCase().startsWith(normalizedRoot);
};

const assertInsideDirectory = (root: string, target: string) => {
  const resolvedTarget = path.resolve(target);
  if (!isInsideDirectory(root, resolvedTarget)) throw new Error("File path is outside the allowed app data folder.");
  return resolvedTarget;
};

const rowText = (row: Row | undefined | null, key: string) => String(row?.[key] ?? "");
const rowNumber = (row: Row | undefined | null, key: string) => Number(row?.[key] ?? 0);
const emptyBackupCloudSnapshotStatus = (): BackupCloudSnapshotStatus => ({
  included: false,
  exportedAt: "",
  entityCount: 0,
  recordCount: 0,
  invoiceCount: 0,
  error: ""
});
const rowObject = (row: Row | undefined | null, key: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(rowText(row, key) || EMPTY_JSON_OBJECT);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};
const rowStringArray = (row: Row | undefined | null, key: string): string[] => {
  try {
    const parsed = JSON.parse(rowText(row, key) || EMPTY_JSON_ARRAY);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
};
const settingText = (values: Map<string, string>, defaults: BusinessSettings, key: keyof BusinessSettings) => {
  const value = values.get(key);
  return value === undefined ? String(defaults[key] ?? "") : value;
};
const settingBoolean = (values: Map<string, string>, defaults: BusinessSettings, key: keyof BusinessSettings) => {
  const value = values.get(key);
  if (value === undefined) return Boolean(defaults[key]);
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
};
const settingNumber = (values: Map<string, string>, defaults: BusinessSettings, key: keyof BusinessSettings) => {
  const value = Number(values.get(key) ?? defaults[key]);
  return Number.isFinite(value) ? value : Number(defaults[key] ?? 0);
};
const normalizeInvoicePaperSize = (value?: string): InvoicePaperSize =>
  value === "Letter" || value === "Legal" ? value : "A4";
const normalizeInvoiceFontStyle = (value?: string): InvoiceFontStyle =>
  value === "classic" || value === "system" ? value : "modern";
const normalizeInvoiceTextSize = (value?: string): InvoiceTextSize =>
  value === "compact" || value === "large" ? value : "standard";
const normalizeInvoiceDensity = (value?: string): InvoiceDensity =>
  value === "compact" || value === "comfortable" ? value : "standard";
const normalizeInvoiceLogoSize = (value?: string): InvoiceLogoSize =>
  value === "small" || value === "large" ? value : "medium";
const normalizeInvoiceWatermarkPlacement = (value?: string): InvoiceWatermarkPlacement =>
  value === "center" || value === "top-right" ? value : "bottom-right";
const normalizeInvoiceWatermarkOpacity = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.12;
  return Math.min(0.3, Math.max(0, number));
};
const normalizeInvoiceColor = (value: unknown, fallback: string) => {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
};

const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export class AppDatabase {
  private sql?: SqlJsStatic;
  private db?: Database;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = path.join(app.getPath("userData"), "autocare24.sqlite");
  }

  async init() {
    this.sql = await initSqlJs({
      locateFile: (file) => {
        if (!file.endsWith(".wasm")) return file;
        return app.isPackaged
          ? path.join(process.resourcesPath, "sql-wasm.wasm")
          : require.resolve("sql.js/dist/sql-wasm.wasm");
      }
    });

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    if (fs.existsSync(this.dbPath)) {
      this.db = new this.sql.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new this.sql.Database();
    }

    this.requireDb().run("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.seedDefaults();
    this.save();
  }

  getDatabasePath() {
    return this.dbPath;
  }

  getDefaultBackupDirectory() {
    return path.join(app.getPath("documents"), "Autocare24 Billing Backups");
  }

  getDatabaseSizeBytes() {
    return fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
  }

  getTableCounts() {
    return Object.fromEntries(
      DATA_TABLES.map((table) => [table, rowNumber(this.select<Row>(`SELECT COUNT(*) AS value FROM ${table}`)[0], "value")])
    );
  }

  getSyncDeviceRecord() {
    const existing = this.select<Row>("SELECT * FROM sync_device WHERE id = 1")[0] || null;
    return this.reconcileSyncDeviceIdentity(existing);
  }

  private reconcileSyncDeviceIdentity(existing: Row | null, deviceName = "") {
    const stable = stableDeviceIdentity();
    if (!existing) return null;
    const currentDeviceId = rowText(existing, "deviceId");
    if (!currentDeviceId || currentDeviceId === stable.deviceId) return existing;

    const approvalStatus = rowText(existing, "approvalStatus").toUpperCase();
    const hasToken = Boolean(rowText(existing, "cloudUrl") && rowText(existing, "tokenCiphertext"));
    if (hasToken && approvalStatus === "APPROVED") return existing;

    const nextName = deviceName.trim() || rowText(existing, "deviceName") || app.getName();
    this.runWrite(
      `UPDATE sync_device
       SET deviceId = ?,
           deviceCode = ?,
           deviceName = ?,
           tokenCiphertext = '',
           connectedAt = '',
           approvalStatus = 'APPROVED',
           lastStatus = 'disconnected',
           lastError = 'Hardware device identity refreshed. Connect this PC again.'
       WHERE id = 1`,
      [stable.deviceId, stable.deviceCode, nextName]
    );
    return this.select<Row>("SELECT * FROM sync_device WHERE id = 1")[0] || null;
  }

  getSyncStatus(overrideState?: SyncConnectionState, overrideError = ""): SyncDeviceStatus {
    const device = this.getSyncDeviceRecord();
    const deviceRow: Row = device || {};
    const pendingCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM sync_outbox WHERE status IN ('PENDING', 'FAILED')")[0], "value");
    const failedCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM sync_outbox WHERE status = 'FAILED'")[0], "value");
    const conflictCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM sync_conflicts WHERE status = 'OPEN'")[0], "value");
    const lastRevision = rowNumber(this.select<Row>("SELECT MAX(lastRevision) AS value FROM sync_state")[0], "value");
    const rawApprovalStatus = rowText(deviceRow, "approvalStatus").toUpperCase();
    const approvalStatus: CloudDeviceApprovalStatus | "" = rawApprovalStatus === "PENDING" || rawApprovalStatus === "REVOKED" || rawApprovalStatus === "APPROVED"
      ? rawApprovalStatus as CloudDeviceApprovalStatus
      : "";
    const hasToken = Boolean(device && rowText(device, "cloudUrl") && rowText(device, "tokenCiphertext"));
    const connected = Boolean(hasToken && approvalStatus !== "PENDING" && approvalStatus !== "REVOKED");
    const state = overrideState || (hasToken
      ? ((rowText(device, "lastStatus") as SyncConnectionState) || (approvalStatus === "PENDING" ? "pending_approval" : "connected"))
      : "disconnected");
    return {
      configured: Boolean(device && rowText(device, "cloudUrl")),
      connected,
      state: hasToken ? state : "disconnected",
      approvalStatus: approvalStatus || (connected ? "APPROVED" : ""),
      cloudUrl: rowText(deviceRow, "cloudUrl"),
      deviceId: rowText(deviceRow, "deviceId"),
      deviceName: rowText(deviceRow, "deviceName"),
      deviceCode: rowText(deviceRow, "deviceCode"),
      pendingCount,
      failedCount,
      conflictCount,
      lastRevision,
      lastPushAt: rowText(deviceRow, "lastPushAt"),
      lastPullAt: rowText(deviceRow, "lastPullAt"),
      lastError: overrideError || rowText(deviceRow, "lastError")
    };
  }

  ensureSyncDeviceIdentity(deviceName = "") {
    const existing = this.getSyncDeviceRecord();
    if (existing) return { deviceId: rowText(existing, "deviceId"), deviceCode: rowText(existing, "deviceCode") };
    const { deviceId, deviceCode } = stableDeviceIdentity();
    this.runWrite(
      `INSERT INTO sync_device (id, deviceId, deviceName, deviceCode, cloudUrl, tokenCiphertext, connectedAt, lastPushAt, lastPullAt, lastError, approvalStatus, lastStatus)
       VALUES (1, ?, ?, ?, '', '', '', '', '', '', 'APPROVED', 'disconnected')`,
      [deviceId, deviceName.trim() || app.getName(), deviceCode]
    );
    return { deviceId, deviceCode };
  }

  saveSyncDevice(input: {
    cloudUrl: string;
    deviceName: string;
    tokenCiphertext: string;
    deviceId?: string;
    deviceCode?: string;
    connectedAt?: string;
    approvalStatus?: "APPROVED" | "PENDING" | "REVOKED";
    lastStatus?: SyncConnectionState;
    lastError?: string;
  }) {
    const identity = input.deviceId
      ? { deviceId: input.deviceId, deviceCode: input.deviceCode || input.deviceId.slice(0, 8).toUpperCase() }
      : this.ensureSyncDeviceIdentity(input.deviceName);
    this.runWrite(
      `INSERT OR REPLACE INTO sync_device
        (id, deviceId, deviceName, deviceCode, cloudUrl, tokenCiphertext, connectedAt, lastPushAt, lastPullAt, lastError, approvalStatus, lastStatus)
       VALUES (
        1,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        COALESCE((SELECT lastPushAt FROM sync_device WHERE id = 1), ''),
        COALESCE((SELECT lastPullAt FROM sync_device WHERE id = 1), ''),
        ?,
        ?,
        ?
       )`,
      [
        identity.deviceId,
        input.deviceName.trim() || app.getName(),
        identity.deviceCode,
        input.cloudUrl.trim().replace(/\/+$/, ""),
        input.tokenCiphertext,
        input.connectedAt || nowIso(),
        input.lastError || "",
        input.approvalStatus || "APPROVED",
        input.lastStatus || "connected"
      ]
    );
    return this.getSyncStatus();
  }

  markSyncDeviceDisconnected(message = "", approvalStatus: CloudDeviceApprovalStatus = "APPROVED") {
    const existing = this.getSyncDeviceRecord();
    if (!existing) return this.getSyncStatus();
    this.runWrite(
      `UPDATE sync_device
       SET tokenCiphertext = '', connectedAt = '', lastError = ?, approvalStatus = ?, lastStatus = 'disconnected'
       WHERE id = 1`,
      [message, approvalStatus]
    );
    return this.getSyncStatus("disconnected", message);
  }

  updateSyncRuntime(input: Partial<{ lastPushAt: string; lastPullAt: string; lastError: string; approvalStatus: "APPROVED" | "PENDING" | "REVOKED"; lastStatus: SyncConnectionState }>) {
    this.ensureSyncDeviceIdentity();
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    if (input.lastPushAt !== undefined) {
      assignments.push("lastPushAt = ?");
      params.push(input.lastPushAt);
    }
    if (input.lastPullAt !== undefined) {
      assignments.push("lastPullAt = ?");
      params.push(input.lastPullAt);
    }
    if (input.lastError !== undefined) {
      assignments.push("lastError = ?");
      params.push(input.lastError);
    }
    if (input.approvalStatus !== undefined) {
      assignments.push("approvalStatus = ?");
      params.push(input.approvalStatus);
    }
    if (input.lastStatus !== undefined) {
      assignments.push("lastStatus = ?");
      params.push(input.lastStatus);
    }
    if (!assignments.length) return this.getSyncStatus();
    this.runWrite(`UPDATE sync_device SET ${assignments.join(", ")} WHERE id = 1`, params);
    return this.getSyncStatus();
  }

  isCloudSyncConnected() {
    const status = this.getSyncStatus();
    return status.connected && status.cloudUrl.startsWith("http");
  }

  seedLocalRecordsForSync() {
    if (!this.isCloudSyncConnected()) return { queued: 0 };
    let queued = 0;
    const queue = (entity: SyncEntity, localId: string, payload: Record<string, unknown>) => {
      if (this.enqueueSyncOperation({ operationType: "UPSERT", entity, localId, payload })) queued += 1;
    };

    queue("settings", BUSINESS_SETTINGS_SYNC_ID, this.cloudSafeSettingsPayload(this.getSettings() as unknown as Record<string, unknown>));
    queue("settings", JOB_CARD_SETTINGS_SYNC_ID, this.getJobCardSettings() as Record<string, unknown>);

    DATA_TABLES.forEach((table) => {
      if (CLOUD_SYNC_SKIP_TABLES.has(table)) return;
      const columns = this.tableColumnNames(table);
      if (!columns.has("id")) return;
      this.select<Row>(`SELECT * FROM ${table}`).forEach((row) => {
        const localId = rowText(row, "id");
        if (!localId || localId.length > 36) return;
        queue(table as SyncEntity, localId, this.rowPayload(row));
      });
    });

    return { queued };
  }

  enqueueSyncOperation(input: {
    operationType: SyncOperationType;
    entity: SyncEntity;
    localId: string;
    payload: Record<string, unknown>;
    fileRefs?: string[];
  }) {
    if (!this.isCloudSyncConnected()) return null;
    const existingPending = this.select<Row>(
      "SELECT * FROM sync_outbox WHERE entity = ? AND localId = ? AND status IN ('PENDING', 'FAILED', 'CONFLICT') ORDER BY id DESC LIMIT 1",
      [input.entity, input.localId]
    )[0];
    if (existingPending) {
      this.runWrite(
        `UPDATE sync_outbox
         SET operationType = ?, payloadJson = ?, fileRefsJson = ?, createdAt = ?, status = 'PENDING', lastError = ''
         WHERE id = ?`,
        [
          input.operationType,
          JSON.stringify(input.payload || {}),
          JSON.stringify(input.fileRefs || []),
          nowIso(),
          rowNumber(existingPending, "id")
        ]
      );
      return this.select<Row>("SELECT * FROM sync_outbox WHERE id = ?", [rowNumber(existingPending, "id")]).map(this.mapSyncOutboxEntry)[0];
    }
    const idempotencyKey = randomUUID();
    const baseRevision = this.getLastSyncRevision(input.entity);
    this.runWrite(
      `INSERT INTO sync_outbox
        (idempotencyKey, operationType, entity, localId, payloadJson, fileRefsJson, baseRevision, createdAt, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        idempotencyKey,
        input.operationType,
        input.entity,
        input.localId,
        JSON.stringify(input.payload || {}),
        JSON.stringify(input.fileRefs || []),
        baseRevision,
        nowIso()
      ]
    );
    return this.select<Row>("SELECT * FROM sync_outbox WHERE idempotencyKey = ?", [idempotencyKey]).map(this.mapSyncOutboxEntry)[0];
  }

  trackSyncFile(input: {
    localPath: string;
    entity?: SyncEntity;
    entityId?: string;
    fileType: SyncFileType;
    fileId?: string;
    sha256?: string;
    sizeBytes?: number;
  }) {
    const localPath = input.localPath.trim();
    if (!localPath) return;
    this.runWrite(
      `INSERT OR REPLACE INTO sync_files
        (localPath, fileId, entity, entityId, fileType, sha256, sizeBytes, uploadStatus, uploadedAt, lastError)
       VALUES (
        ?,
        COALESCE(?, (SELECT fileId FROM sync_files WHERE localPath = ?)),
        ?,
        ?,
        ?,
        ?,
        ?,
        COALESCE((SELECT uploadStatus FROM sync_files WHERE localPath = ?), 'PENDING'),
        COALESCE((SELECT uploadedAt FROM sync_files WHERE localPath = ?), ''),
        ''
       )`,
      [
        localPath,
        input.fileId || null,
        localPath,
        input.entity || "",
        input.entityId || "",
        input.fileType,
        input.sha256 || "",
        input.sizeBytes || (fs.existsSync(localPath) ? fs.statSync(localPath).size : 0),
        localPath,
        localPath
      ]
    );
  }

  listPendingSyncFiles(limit = 10) {
    return this.select<Row>(
      "SELECT * FROM sync_files WHERE uploadStatus IN ('PENDING', 'FAILED') AND localPath <> '' ORDER BY uploadedAt ASC LIMIT ?",
      [Math.max(1, Math.min(50, Math.floor(limit)))]
    ).map((row) => ({
      localPath: rowText(row, "localPath"),
      fileId: rowText(row, "fileId"),
      entity: rowText(row, "entity") as SyncEntity | "",
      entityId: rowText(row, "entityId"),
      fileType: rowText(row, "fileType") as SyncFileType,
      sha256: rowText(row, "sha256"),
      sizeBytes: rowNumber(row, "sizeBytes"),
      lastError: rowText(row, "lastError")
    }));
  }

  markSyncFileUploaded(localPath: string, fileId: string, sha256: string, sizeBytes: number, uploadedAt = nowIso()) {
    this.runWrite(
      "UPDATE sync_files SET fileId = ?, sha256 = ?, sizeBytes = ?, uploadStatus = 'UPLOADED', uploadedAt = ?, lastError = '' WHERE localPath = ?",
      [fileId, sha256, sizeBytes, uploadedAt, localPath]
    );
  }

  markSyncFileFailed(localPath: string, error: string) {
    this.runWrite("UPDATE sync_files SET uploadStatus = 'FAILED', lastError = ? WHERE localPath = ?", [
      error.slice(0, 1000),
      localPath
    ]);
  }

  listPendingSyncOutbox(limit = 25): SyncOutboxEntry[] {
    return this.select<Row>(
      "SELECT * FROM sync_outbox WHERE status IN ('PENDING', 'FAILED') ORDER BY id ASC LIMIT ?",
      [Math.max(1, Math.min(100, Math.floor(limit)))]
    ).map(this.mapSyncOutboxEntry);
  }

  markSyncOutboxPushed(ids: number[], pushedAt = nowIso()) {
    ids.filter((id) => Number.isFinite(id)).forEach((id) => {
      this.requireDb().run("UPDATE sync_outbox SET status = 'PUSHED', pushedAt = ?, lastError = '' WHERE id = ?", [pushedAt, id]);
    });
    this.save();
  }

  markSyncOutboxFailed(id: number, error: string, conflict = false) {
    this.runWrite(
      "UPDATE sync_outbox SET status = ?, attemptCount = attemptCount + 1, lastError = ? WHERE id = ?",
      [conflict ? "CONFLICT" : "FAILED", error.slice(0, 1000), id]
    );
  }

  getLastSyncRevision(entity = "global") {
    return rowNumber(this.select<Row>("SELECT lastRevision FROM sync_state WHERE entity = ?", [entity])[0], "lastRevision");
  }

  updateSyncRevision(entity: string, revision: number, syncedAt = nowIso()) {
    const safeRevision = Math.max(0, Math.floor(Number(revision) || 0));
    this.runWrite(
      "INSERT OR REPLACE INTO sync_state (entity, lastRevision, lastSyncedAt) VALUES (?, ?, ?)",
      [entity, safeRevision, syncedAt]
    );
  }

  applyCloudRecords(records: CloudRecord[]) {
    if (!records.length) return;
    this.writeTransaction(() => {
      this.applyCloudRecordsInCurrentTransaction(records);
    });
  }

  applyCloudPull(records: CloudRecord[], revision: number, pulledAt = nowIso()) {
    const safeRevision = Math.max(0, Math.floor(Number(revision) || 0));
    this.writeTransaction(() => {
      this.applyCloudRecordsInCurrentTransaction(records);
      this.requireDb().run(
        "INSERT OR REPLACE INTO sync_state (entity, lastRevision, lastSyncedAt) VALUES (?, ?, ?)",
        ["global", safeRevision, pulledAt]
      );
      this.requireDb().run("UPDATE sync_device SET lastPullAt = ? WHERE id = 1", [pulledAt]);
    });
    return this.getSyncStatus();
  }

  applyCloudCanonicalRows(rows: Array<{ entity?: string; localId?: string; recordId?: string; invoiceNumber?: string; quotationNumber?: string; jobNumber?: string; revision?: number }>) {
    rows.forEach((row) => {
      const entity = row.entity || "";
      const id = row.localId || row.recordId || "";
      if (!id) return;
      if (entity === "invoices" && row.invoiceNumber) {
        this.requireDb().run(
          `UPDATE invoices
           SET invoiceNumber = ?, cloudSyncStatus = 'synced', cloudRevision = ?, cloudSyncedAt = ?, cloudConflictId = ''
           WHERE id = ?`,
          [row.invoiceNumber, Math.max(0, Number(row.revision || 0)), nowIso(), id]
        );
      } else if (entity === "quotations" && row.quotationNumber) {
        this.requireDb().run("UPDATE quotations SET quotationNumber = ?, updatedAt = ? WHERE id = ?", [
          row.quotationNumber,
          nowIso(),
          id
        ]);
      } else if (entity === "job_cards" && row.jobNumber) {
        this.requireDb().run("UPDATE job_cards SET jobNumber = ?, updatedAt = ? WHERE id = ?", [
          row.jobNumber,
          nowIso(),
          id
        ]);
      } else if (entity === "invoices") {
        this.requireDb().run(
          "UPDATE invoices SET cloudSyncStatus = 'synced', cloudRevision = ?, cloudSyncedAt = ?, cloudConflictId = '' WHERE id = ?",
          [Math.max(0, Number(row.revision || 0)), nowIso(), id]
        );
      }
    });
    if (rows.length) this.save();
  }

  recordSyncConflict(input: {
    conflictId: string;
    entity: SyncEntity;
    localId: string;
    localVersion: Record<string, unknown>;
    serverVersion: Record<string, unknown>;
  }) {
    this.runWrite(
      `INSERT OR REPLACE INTO sync_conflicts
        (conflictId, entity, localId, localVersionJson, serverVersionJson, detectedAt, resolvedAt, resolution, status)
       VALUES (?, ?, ?, ?, ?, ?, '', '', 'OPEN')`,
      [
        input.conflictId,
        input.entity,
        input.localId,
        JSON.stringify(input.localVersion || {}),
        JSON.stringify(input.serverVersion || {}),
        nowIso()
      ]
    );
    if (input.entity === "invoices") {
      this.runWrite("UPDATE invoices SET cloudSyncStatus = 'conflict', cloudConflictId = ? WHERE id = ?", [
        input.conflictId,
        input.localId
      ]);
    }
  }

  private applyCloudRecordsInCurrentTransaction(records: CloudRecord[]) {
    records.forEach((record) => {
      const entity = String(record.entity || "");
      const data = this.normalizeCloudRecordData(record.data);
      if (entity === "settings") {
        this.applyCloudSettings(record.recordId || "", data);
        return;
      }
      if (!DATA_TABLES.includes(entity as (typeof DATA_TABLES)[number]) || CLOUD_SYNC_SKIP_TABLES.has(entity)) return;
      const columns = this.tableColumnNames(entity);
      if (!columns.has("id")) return;
      const recordId = String(record.recordId || data.id || "");
      if (!recordId) return;
      if (record.deletedAt) {
        this.applyCloudTombstone(entity, recordId, columns);
        return;
      }
      const payload: Record<string, unknown> = { ...data, id: data.id || recordId };
      const writableColumns = [...columns].filter((column) => Object.prototype.hasOwnProperty.call(payload, column));
      if (!writableColumns.length) return;
      const placeholders = writableColumns.map(() => "?").join(", ");
      const values = writableColumns.map((column) => normalizeCloudParam(payload[column]));
      this.requireDb().run(
        `INSERT OR REPLACE INTO ${entity} (${writableColumns.join(", ")}) VALUES (${placeholders})`,
        values
      );
    });
  }

  listSyncConflicts(): SyncConflictSummary[] {
    return this.select<Row>("SELECT * FROM sync_conflicts WHERE status = 'OPEN' ORDER BY detectedAt DESC").map(this.mapSyncConflict);
  }

  resolveSyncConflict(conflictId: string, resolution: SyncConflictResolution) {
    const conflict = this.select<Row>("SELECT * FROM sync_conflicts WHERE conflictId = ?", [conflictId])[0];
    if (!conflict) throw new Error("Sync conflict not found.");
    const resolvedAt = nowIso();
    this.runWrite(
      "UPDATE sync_conflicts SET status = 'RESOLVED', resolvedAt = ?, resolution = ? WHERE conflictId = ?",
      [resolvedAt, resolution, conflictId]
    );
    if (rowText(conflict, "entity") === "invoices") {
      this.runWrite("UPDATE invoices SET cloudSyncStatus = ?, cloudConflictId = '' WHERE id = ?", [
        resolution === "KEEP_LOCAL" ? "pending_cloud" : "synced",
        rowText(conflict, "localId")
      ]);
    }
    return this.mapSyncConflict(this.select<Row>("SELECT * FROM sync_conflicts WHERE conflictId = ?", [conflictId])[0]);
  }

  private tableColumnNames(table: string) {
    return new Set(this.select<Row>(`PRAGMA table_info(${table})`).map((row) => rowText(row, "name")).filter(Boolean));
  }

  private rowPayload(row: Row | undefined | null): Record<string, unknown> {
    if (!row) return {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value]));
  }

  private normalizeCloudRecordData(data: CloudRecord["data"]): Record<string, unknown> {
    if (!data) return {};
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }

  private applyCloudSettings(recordId: string, data: Record<string, unknown>) {
    if (recordId === JOB_CARD_SETTINGS_SYNC_ID || Array.isArray(data.defaultChecklist)) {
      const defaultChecklist = Array.isArray(data.defaultChecklist)
        ? data.defaultChecklist.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (defaultChecklist.length) {
        this.requireDb().run("INSERT OR REPLACE INTO job_card_settings (key, value) VALUES ('defaultChecklist', ?)", [
          JSON.stringify(defaultChecklist)
        ]);
      }
      return;
    }

    if (recordId && recordId !== BUSINESS_SETTINGS_SYNC_ID) return;
    const current = this.getSettings() as unknown as Record<string, unknown>;
    const next = this.cloudSafeSettingsPayload({ ...current, ...this.cloudSafeSettingsPayload(data) });
    Object.entries(next).forEach(([key, value]) => {
      this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value ?? "")]);
    });
  }

  private applyCloudTombstone(entity: string, recordId: string, columns: Set<string>) {
    if (columns.has("active")) {
      const values: unknown[] = columns.has("updatedAt") ? [0, nowIso(), recordId] : [0, recordId];
      this.requireDb().run(
        `UPDATE ${entity} SET active = ?${columns.has("updatedAt") ? ", updatedAt = ?" : ""} WHERE id = ?`,
        values
      );
      return;
    }
    if (entity === "invoices") {
      this.requireDb().run(
        "UPDATE invoices SET invoiceStatus = 'cancelled', cloudSyncStatus = 'synced', cloudSyncedAt = ? WHERE id = ?",
        [nowIso(), recordId]
      );
      return;
    }
    this.requireDb().run(`DELETE FROM ${entity} WHERE id = ?`, [recordId]);
  }

  scanDataHealth(): DataHealthReport {
    const issues: DataHealthIssue[] = [];
    const integrityStatus = this.getIntegrityStatus();
    const foreignKeyIssues = this.getForeignKeyIssues();
    if (integrityStatus !== "ok") {
      issues.push({
        id: "sqlite-integrity",
        code: "sqlite_integrity",
        title: "SQLite integrity issue",
        severity: "critical",
        message: integrityStatus,
        count: 1,
        repairable: false
      });
    }
    if (foreignKeyIssues.length) {
      issues.push({
        id: "foreign-key-check",
        code: "foreign_key_check",
        title: "Broken database links",
        severity: "critical",
        message: "SQLite foreign-key check found broken references.",
        count: foreignKeyIssues.length,
        repairable: false,
        details: foreignKeyIssues.slice(0, 12)
      });
    }

    const missingSettings = this.missingDefaultSettingKeys();
    if (missingSettings.length) {
      issues.push({
        id: "missing-settings",
        code: "missing_settings_defaults",
        title: "Missing default settings",
        severity: "warning",
        message: "Some required settings keys are missing and can be restored from defaults.",
        count: missingSettings.length,
        repairable: true,
        repairCode: "restore_settings_defaults",
        details: missingSettings
      });
    }

    const brokenLogo = this.getBrokenLogoIssue();
    if (brokenLogo) issues.push(brokenLogo);

    const jobCardLinkIssues = this.getJobCardInvoiceLinkIssues();
    issues.push(...jobCardLinkIssues);

    const optionalItemLinks = this.getOptionalItemLinkIssue();
    if (optionalItemLinks) issues.push(optionalItemLinks);

    const invoiceTotalMismatch = this.getCount(
      `SELECT COUNT(*) AS value FROM invoices
       WHERE invoiceStatus <> 'cancelled'
         AND (ABS(grandTotal - (subTotal - discount + totalTax)) > 0.05
          OR ABS(balanceDue - (grandTotal - paidAmount)) > 0.05
          OR discount < 0 OR subTotal < 0 OR totalTax < 0 OR grandTotal < 0)`
    );
    if (invoiceTotalMismatch) {
      issues.push({
        id: "invoice-total-mismatch",
        code: "invoice_total_mismatch",
        title: "Invoice total mismatch",
        severity: "warning",
        message: "Some invoice totals do not match subtotal, discount, tax, paid amount, or balance due.",
        count: invoiceTotalMismatch,
        repairable: false
      });
    }

    const paymentMismatch = this.getCount(
      `SELECT COUNT(*) AS value
       FROM invoices i
       LEFT JOIN (SELECT invoiceId, COALESCE(SUM(amount), 0) AS paid FROM payments GROUP BY invoiceId) p ON p.invoiceId = i.id
       WHERE i.invoiceStatus <> 'cancelled'
         AND (ABS(i.paidAmount - COALESCE(p.paid, 0)) > 0.05
          OR ABS(i.balanceDue - (i.grandTotal - i.paidAmount)) > 0.05)`
    );
    if (paymentMismatch) {
      issues.push({
        id: "payment-mismatch",
        code: "payment_mismatch",
        title: "Payment mismatch",
        severity: "warning",
        message: "Some invoices have payment totals that do not match recorded payment rows.",
        count: paymentMismatch,
        repairable: false
      });
    }

    const negativeStock = this.getCount("SELECT COUNT(*) AS value FROM inventory_batches WHERE quantityRemaining < -0.001");
    if (negativeStock) {
      issues.push({
        id: "negative-stock",
        code: "negative_stock",
        title: "Negative stock batches",
        severity: "warning",
        message: "Some inventory batches show negative remaining quantity.",
        count: negativeStock,
        repairable: false
      });
    }

    const missingLinks = this.getMissingCustomerVehicleLinkCount();
    if (missingLinks) {
      issues.push({
        id: "missing-customer-vehicle-links",
        code: "missing_customer_vehicle_links",
        title: "Missing customer or vehicle links",
        severity: "critical",
        message: "Some invoices or job cards point to missing customer or vehicle records.",
        count: missingLinks,
        repairable: false
      });
    }

    const photoIssues = this.getJobCardPhotoIssues();
    if (photoIssues.count) issues.push(photoIssues);

    return {
      generatedAt: nowIso(),
      integrityStatus,
      foreignKeyIssues,
      tableCounts: this.getTableCounts(),
      issues
    };
  }

  runSafeRepair(code: SafeRepairCode): SafeRepairResult {
    const backupPath = this.createBackup("repair").filePath;
    let fixedCount = 0;
    if (code === "restore_settings_defaults") {
      fixedCount = this.restoreMissingDefaultSettings();
    } else if (code === "clean_job_card_invoice_links") {
      this.writeTransaction(() => {
        fixedCount = this.normalizeJobCardInvoiceLinks();
      });
    } else if (code === "clear_broken_logo_path") {
      fixedCount = this.clearBrokenLogoPath();
    } else if (code === "clean_optional_item_links") {
      this.writeTransaction(() => {
        fixedCount = this.cleanOptionalItemLinks();
      });
    } else {
      throw new Error("Safe repair is not available.");
    }
    return {
      ok: true,
      message: fixedCount ? "Safe repair completed." : "No changes were needed.",
      path: backupPath,
      backupPath,
      repairCode: code,
      fixedCount
    };
  }

  getAuthStatus() {
    const count = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM users")[0], "value");
    return { hasUsers: count > 0 };
  }

  setupOwner(input: SetupOwnerInput) {
    const existingCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM users")[0], "value");
    if (existingCount > 0) throw new Error("Owner account is already configured.");
    const displayName = input.displayName.trim();
    const username = normalizeUsername(input.username);
    this.validateUserFields(displayName, username, input.password, true);

    const id = randomUUID();
    const password = hashPassword(input.password);
    const createdAt = nowIso();
    this.runWrite(
      `INSERT INTO users (id, displayName, username, role, accessRoleId, passwordHash, salt, active, createdAt, updatedAt)
       VALUES (?, ?, ?, 'owner', ?, ?, ?, 1, ?, ?)`,
      [id, displayName, username, OWNER_ACCESS_ROLE_ID, password.hash, password.salt, createdAt, createdAt]
    );
    return this.mapUser(this.select<Row>("SELECT * FROM users WHERE id = ?", [id])[0]);
  }

  login(input: LoginInput) {
    const username = normalizeUsername(input.username);
    const password = input.password || "";
    const row = this.select<Row>("SELECT * FROM users WHERE username = ? AND active = 1 LIMIT 1", [username])[0];
    if (!row || !verifyPassword(password, rowText(row, "salt"), rowText(row, "passwordHash"))) {
      throw new Error("Invalid username or password.");
    }
    return this.mapUser(row);
  }

  listUsers() {
    return this.select<Row>(
      "SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, displayName ASC"
    ).map(this.mapUser);
  }

  getUserById(id: string) {
    const row = this.select<Row>("SELECT * FROM users WHERE id = ? LIMIT 1", [id])[0];
    return row ? this.mapUser(row) : null;
  }

  listAccessRoles() {
    return this.select<Row>(
      "SELECT * FROM access_roles ORDER BY CASE locked WHEN 1 THEN 0 ELSE 1 END, active DESC, name ASC"
    ).map(this.mapAccessRole);
  }

  saveAccessRole(input: SaveAccessRoleInput) {
    const name = input.name.trim();
    const description = (input.description || "").trim();
    const permissions = normalizePermissions(input.permissions);
    const active = input.active === false ? 0 : 1;
    if (!name) throw new Error("Role name is required.");
    if (!permissions.length) throw new Error("Select at least one permission for this role.");

    const existing = input.id ? this.select<Row>("SELECT * FROM access_roles WHERE id = ?", [input.id])[0] : undefined;
    if (existing && rowNumber(existing, "locked") === 1) throw new Error("This role is locked and cannot be edited.");

    const duplicate = this.select<Row>("SELECT id FROM access_roles WHERE lower(name) = lower(?) AND id <> ? LIMIT 1", [
      name,
      input.id || ""
    ])[0];
    if (duplicate) throw new Error("A role with this name already exists.");

    const permissionsJson = JSON.stringify(permissions);
    if (existing) {
      if (active === 0) {
        const assigned = rowNumber(
          this.select<Row>("SELECT COUNT(*) AS value FROM users WHERE accessRoleId = ? AND active = 1", [input.id])[0],
          "value"
        );
        if (assigned > 0) throw new Error("This role is assigned to active staff. Move those users to another role first.");
      }
      this.runWrite(
        "UPDATE access_roles SET name = ?, description = ?, permissionsJson = ?, active = ?, updatedAt = ? WHERE id = ?",
        [name, description, permissionsJson, active, nowIso(), input.id]
      );
      return this.mapAccessRole(this.select<Row>("SELECT * FROM access_roles WHERE id = ?", [input.id])[0]);
    }

    const id = randomUUID();
    const createdAt = nowIso();
    this.runWrite(
      `INSERT INTO access_roles (id, name, description, permissionsJson, locked, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, name, description, permissionsJson, active, createdAt, createdAt]
    );
    return this.mapAccessRole(this.select<Row>("SELECT * FROM access_roles WHERE id = ?", [id])[0]);
  }

  deactivateAccessRole(id: string) {
    const existing = this.select<Row>("SELECT * FROM access_roles WHERE id = ?", [id])[0];
    if (!existing) throw new Error("Role not found.");
    if (rowNumber(existing, "locked") === 1) throw new Error("This role is locked and cannot be deactivated.");
    const assigned = rowNumber(
      this.select<Row>("SELECT COUNT(*) AS value FROM users WHERE accessRoleId = ? AND active = 1", [id])[0],
      "value"
    );
    if (assigned > 0) throw new Error("This role is assigned to active staff. Move those users to another role first.");
    this.runWrite("UPDATE access_roles SET active = 0, updatedAt = ? WHERE id = ?", [nowIso(), id]);
    return true;
  }

  saveUser(input: SaveUserInput) {
    const displayName = input.displayName.trim();
    const username = normalizeUsername(input.username);
    const role = input.role === "owner" ? "owner" : "staff";
    const accessRoleId = this.resolveAccessRoleId(role, input.accessRoleId);
    const active = input.active === false ? 0 : 1;
    const existing = input.id ? this.select<Row>("SELECT * FROM users WHERE id = ?", [input.id])[0] : undefined;
    this.validateUserFields(displayName, username, input.password, !existing);

    const duplicate = this.select<Row>("SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1", [username, input.id || ""])[0];
    if (duplicate) throw new Error("Username is already used by another account.");

    if (existing) {
      if (rowText(existing, "role") === "owner" && (role !== "owner" || active === 0)) {
        const ownerCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM users WHERE role = 'owner' AND active = 1")[0], "value");
        if (ownerCount <= 1) throw new Error("At least one active owner account is required.");
      }

      const password = input.password ? hashPassword(input.password) : null;
      this.writeTransaction(() => {
        this.requireDb().run(
          `UPDATE users SET displayName = ?, username = ?, role = ?, accessRoleId = ?, active = ?, updatedAt = ? WHERE id = ?`,
          [displayName, username, role, accessRoleId, active, nowIso(), input.id].map(normalizeParam)
        );
        if (password) {
          this.requireDb().run("UPDATE users SET passwordHash = ?, salt = ?, updatedAt = ? WHERE id = ?", [
            password.hash,
            password.salt,
            nowIso(),
            input.id
          ]);
        }
      });
      return this.mapUser(this.select<Row>("SELECT * FROM users WHERE id = ?", [input.id])[0]);
    }

    const id = randomUUID();
    const password = hashPassword(input.password || "");
    const createdAt = nowIso();
    this.runWrite(
      `INSERT INTO users (id, displayName, username, role, accessRoleId, passwordHash, salt, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, displayName, username, role, accessRoleId, password.hash, password.salt, active, createdAt, createdAt]
    );
    return this.mapUser(this.select<Row>("SELECT * FROM users WHERE id = ?", [id])[0]);
  }

  deactivateUser(id: string) {
    const existing = this.select<Row>("SELECT * FROM users WHERE id = ?", [id])[0];
    if (!existing) throw new Error("User account not found.");
    if (rowText(existing, "role") === "owner") {
      const ownerCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM users WHERE role = 'owner' AND active = 1")[0], "value");
      if (ownerCount <= 1) throw new Error("At least one active owner account is required.");
    }
    this.runWrite("UPDATE users SET active = 0, updatedAt = ? WHERE id = ?", [nowIso(), id]);
    return true;
  }

  changePassword(input: ChangePasswordInput) {
    const row = this.select<Row>("SELECT * FROM users WHERE id = ?", [input.userId])[0];
    if (!row) throw new Error("User account not found.");
    if (input.currentPassword && !verifyPassword(input.currentPassword, rowText(row, "salt"), rowText(row, "passwordHash"))) {
      throw new Error("Current password is incorrect.");
    }
    this.validatePassword(input.newPassword);
    const password = hashPassword(input.newPassword);
    this.runWrite("UPDATE users SET passwordHash = ?, salt = ?, updatedAt = ? WHERE id = ?", [
      password.hash,
      password.salt,
      nowIso(),
      input.userId
    ]);
    return true;
  }

  getSettings(): BusinessSettings {
    const defaults = this.defaultSettings();
    const rows = this.select<{ key: string; value: string }>("SELECT key, value FROM settings");
    const values = new Map(rows.map((row) => [row.key, row.value]));

    return {
      businessName: settingText(values, defaults, "businessName"),
      address: settingText(values, defaults, "address"),
      phone: settingText(values, defaults, "phone"),
      email: settingText(values, defaults, "email"),
      gstin: settingText(values, defaults, "gstin"),
      state: settingText(values, defaults, "state"),
      invoicePrefix: settingText(values, defaults, "invoicePrefix"),
      nextInvoiceNumber: Number(values.get("nextInvoiceNumber") || defaults.nextInvoiceNumber),
      quotationPrefix: settingText(values, defaults, "quotationPrefix"),
      nextQuotationNumber: Number(values.get("nextQuotationNumber") || defaults.nextQuotationNumber),
      defaultGstRate: Number(values.get("defaultGstRate") || defaults.defaultGstRate),
      defaultTaxScope: (values.get("defaultTaxScope") || defaults.defaultTaxScope) as TaxScope,
      invoicePaperSize: normalizeInvoicePaperSize(values.get("invoicePaperSize") || defaults.invoicePaperSize),
      backupDirectory: settingText(values, defaults, "backupDirectory"),
      invoiceLogoPath: settingText(values, defaults, "invoiceLogoPath"),
      invoiceSignaturePath: settingText(values, defaults, "invoiceSignaturePath"),
      invoiceWatermarkPath: settingText(values, defaults, "invoiceWatermarkPath"),
      invoiceAccentColor: normalizeInvoiceColor(settingText(values, defaults, "invoiceAccentColor"), defaults.invoiceAccentColor),
      invoiceSecondaryColor: normalizeInvoiceColor(settingText(values, defaults, "invoiceSecondaryColor"), defaults.invoiceSecondaryColor),
      invoiceFontStyle: normalizeInvoiceFontStyle(values.get("invoiceFontStyle") || defaults.invoiceFontStyle),
      invoiceTextSize: normalizeInvoiceTextSize(values.get("invoiceTextSize") || defaults.invoiceTextSize),
      invoiceDensity: normalizeInvoiceDensity(values.get("invoiceDensity") || defaults.invoiceDensity),
      invoiceLogoSize: normalizeInvoiceLogoSize(values.get("invoiceLogoSize") || defaults.invoiceLogoSize),
      invoiceWatermarkOpacity: normalizeInvoiceWatermarkOpacity(settingNumber(values, defaults, "invoiceWatermarkOpacity")),
      invoiceWatermarkPlacement: normalizeInvoiceWatermarkPlacement(values.get("invoiceWatermarkPlacement") || defaults.invoiceWatermarkPlacement),
      gstInvoiceTitle: settingText(values, defaults, "gstInvoiceTitle"),
      simpleReceiptTitle: settingText(values, defaults, "simpleReceiptTitle"),
      quotationTitle: settingText(values, defaults, "quotationTitle"),
      invoiceTerms: settingText(values, defaults, "invoiceTerms"),
      invoiceFooterNote: settingText(values, defaults, "invoiceFooterNote"),
      bankName: settingText(values, defaults, "bankName"),
      bankAccountName: settingText(values, defaults, "bankAccountName"),
      bankAccountNumber: settingText(values, defaults, "bankAccountNumber"),
      bankIfsc: settingText(values, defaults, "bankIfsc"),
      upiId: settingText(values, defaults, "upiId"),
      signatureLabel: settingText(values, defaults, "signatureLabel"),
      showLogo: settingBoolean(values, defaults, "showLogo"),
      showGstin: settingBoolean(values, defaults, "showGstin"),
      showVehicleDetails: settingBoolean(values, defaults, "showVehicleDetails"),
      showPaymentDetails: settingBoolean(values, defaults, "showPaymentDetails"),
      showTerms: settingBoolean(values, defaults, "showTerms"),
      showSignature: settingBoolean(values, defaults, "showSignature"),
      showBusinessPhone: settingBoolean(values, defaults, "showBusinessPhone"),
      showBusinessEmail: settingBoolean(values, defaults, "showBusinessEmail"),
      showBusinessAddress: settingBoolean(values, defaults, "showBusinessAddress"),
      showCustomerPhone: settingBoolean(values, defaults, "showCustomerPhone"),
      showCustomerAddress: settingBoolean(values, defaults, "showCustomerAddress"),
      showCustomerGstin: settingBoolean(values, defaults, "showCustomerGstin"),
      showInvoiceStatus: settingBoolean(values, defaults, "showInvoiceStatus"),
      showPaymentMode: settingBoolean(values, defaults, "showPaymentMode"),
      showPaidAmount: settingBoolean(values, defaults, "showPaidAmount"),
      showBalanceDue: settingBoolean(values, defaults, "showBalanceDue"),
      showSacCode: settingBoolean(values, defaults, "showSacCode"),
      showItemGstRate: settingBoolean(values, defaults, "showItemGstRate"),
      showFooterContactBar: settingBoolean(values, defaults, "showFooterContactBar"),
      showUpiQr: settingBoolean(values, defaults, "showUpiQr"),
      invoiceNumberLabel: settingText(values, defaults, "invoiceNumberLabel"),
      invoiceDateLabel: settingText(values, defaults, "invoiceDateLabel"),
      quotationNumberLabel: settingText(values, defaults, "quotationNumberLabel"),
      quotationDateLabel: settingText(values, defaults, "quotationDateLabel"),
      billToLabel: settingText(values, defaults, "billToLabel"),
      vehicleDetailsLabel: settingText(values, defaults, "vehicleDetailsLabel"),
      paymentDetailsLabel: settingText(values, defaults, "paymentDetailsLabel"),
      bankDetailsLabel: settingText(values, defaults, "bankDetailsLabel"),
      termsLabel: settingText(values, defaults, "termsLabel"),
      subtotalLabel: settingText(values, defaults, "subtotalLabel"),
      grandTotalLabel: settingText(values, defaults, "grandTotalLabel"),
      paidLabel: settingText(values, defaults, "paidLabel"),
      balanceDueLabel: settingText(values, defaults, "balanceDueLabel"),
      paymentInstructions: settingText(values, defaults, "paymentInstructions"),
      googleDriveClientId: settingText(values, defaults, "googleDriveClientId"),
      googleDriveClientSecret: settingText(values, defaults, "googleDriveClientSecret")
    };
  }

  getLocalSettingValue(key: string) {
    this.validateSettingKey(key);
    const row = this.select<Row>("SELECT value FROM settings WHERE key = ? LIMIT 1", [key])[0];
    return rowText(row, "value");
  }

  saveLocalSettingValue(key: string, value: string) {
    this.validateSettingKey(key);
    this.runWrite("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  saveSettings(input: Partial<BusinessSettings>) {
    const current = this.getSettings();
    const next: BusinessSettings = {
      ...current,
      ...input,
      nextInvoiceNumber: Math.max(1, Math.floor(Number(input.nextInvoiceNumber ?? current.nextInvoiceNumber) || 1)),
      nextQuotationNumber: Math.max(1, Math.floor(Number(input.nextQuotationNumber ?? current.nextQuotationNumber) || 1)),
      defaultGstRate: money(Number(input.defaultGstRate ?? current.defaultGstRate) || 0),
      defaultTaxScope: (input.defaultTaxScope ?? current.defaultTaxScope) === "inter" ? "inter" : "intra",
      invoicePaperSize: normalizeInvoicePaperSize(input.invoicePaperSize ?? current.invoicePaperSize),
      invoiceAccentColor: normalizeInvoiceColor(input.invoiceAccentColor ?? current.invoiceAccentColor, AUTOCAR24_INVOICE_ACCENT),
      invoiceSecondaryColor: normalizeInvoiceColor(input.invoiceSecondaryColor ?? current.invoiceSecondaryColor, "#111111"),
      invoiceFontStyle: normalizeInvoiceFontStyle(input.invoiceFontStyle ?? current.invoiceFontStyle),
      invoiceTextSize: normalizeInvoiceTextSize(input.invoiceTextSize ?? current.invoiceTextSize),
      invoiceDensity: normalizeInvoiceDensity(input.invoiceDensity ?? current.invoiceDensity),
      invoiceLogoSize: normalizeInvoiceLogoSize(input.invoiceLogoSize ?? current.invoiceLogoSize),
      invoiceWatermarkOpacity: normalizeInvoiceWatermarkOpacity(input.invoiceWatermarkOpacity ?? current.invoiceWatermarkOpacity),
      invoiceWatermarkPlacement: normalizeInvoiceWatermarkPlacement(input.invoiceWatermarkPlacement ?? current.invoiceWatermarkPlacement),
      showLogo: input.showLogo ?? current.showLogo,
      showGstin: input.showGstin ?? current.showGstin,
      showVehicleDetails: input.showVehicleDetails ?? current.showVehicleDetails,
      showPaymentDetails: input.showPaymentDetails ?? current.showPaymentDetails,
      showTerms: input.showTerms ?? current.showTerms,
      showSignature: input.showSignature ?? current.showSignature,
      showBusinessPhone: input.showBusinessPhone ?? current.showBusinessPhone,
      showBusinessEmail: input.showBusinessEmail ?? current.showBusinessEmail,
      showBusinessAddress: input.showBusinessAddress ?? current.showBusinessAddress,
      showCustomerPhone: input.showCustomerPhone ?? current.showCustomerPhone,
      showCustomerAddress: input.showCustomerAddress ?? current.showCustomerAddress,
      showCustomerGstin: input.showCustomerGstin ?? current.showCustomerGstin,
      showInvoiceStatus: input.showInvoiceStatus ?? current.showInvoiceStatus,
      showPaymentMode: input.showPaymentMode ?? current.showPaymentMode,
      showPaidAmount: input.showPaidAmount ?? current.showPaidAmount,
      showBalanceDue: input.showBalanceDue ?? current.showBalanceDue,
      showSacCode: input.showSacCode ?? current.showSacCode,
      showItemGstRate: input.showItemGstRate ?? current.showItemGstRate,
      showFooterContactBar: input.showFooterContactBar ?? current.showFooterContactBar,
      showUpiQr: input.showUpiQr ?? current.showUpiQr
    };

    this.writeTransaction(() => {
      for (const [key, value] of Object.entries(next)) {
        this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
      }
    });

    return this.getSettings();
  }

  listServices(includeInactive = false): ServiceItem[] {
    const rows = this.select<Row>(
      `SELECT * FROM services ${includeInactive ? "" : "WHERE active = 1"} ORDER BY active DESC, name ASC`
    );
    return rows.map(this.mapService);
  }

  saveService(input: Partial<ServiceItem> & Pick<ServiceItem, "name">): ServiceItem {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM services WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Service name");

    this.runWrite(
      `INSERT OR REPLACE INTO services
        (id, name, category, defaultPrice, gstRate, sacCode, active, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.category?.trim() || "Detailing",
        money(nonNegativeNumber(input.defaultPrice ?? 0, "Default price")),
        money(nonNegativeNumber(input.gstRate ?? this.getSettings().defaultGstRate, "GST rate")),
        normalizeSacCode(input.sacCode),
        input.active === false ? 0 : 1,
        createdAt
      ]
    );

    return this.mapService(this.select<Row>("SELECT * FROM services WHERE id = ?", [id])[0]);
  }

  deactivateService(id: string) {
    this.runWrite("UPDATE services SET active = 0 WHERE id = ?", [id]);
    return true;
  }

  listInventoryItems(includeInactive = false): InventoryItem[] {
    const rows = this.select<Row>(
      this.inventoryItemsSql(includeInactive ? "" : "WHERE ii.active = 1") + " ORDER BY ii.active DESC, ii.name ASC"
    );
    return rows.map(this.mapInventoryItem);
  }

  saveInventoryItem(input: Partial<InventoryItem> & Pick<InventoryItem, "name">): InventoryItem {
    const id = input.id || randomUUID();
    const existing = input.id
      ? this.select<Row>("SELECT * FROM inventory_items WHERE id = ?", [input.id])[0]
      : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Inventory item name");

    this.runWrite(
      `INSERT OR REPLACE INTO inventory_items
        (id, name, type, unit, sku, category, retailPrice, gstRate, lowStockLevel, active, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.type === "retail" ? "retail" : "consumable",
        input.unit?.trim() || "piece",
        input.sku?.trim() || "",
        input.category?.trim() || "Studio stock",
        money(nonNegativeNumber(input.retailPrice ?? 0, "Selling price")),
        money(nonNegativeNumber(input.gstRate ?? this.getSettings().defaultGstRate, "GST rate")),
        money(nonNegativeNumber(input.lowStockLevel ?? 0, "Low stock level")),
        input.active === false ? 0 : 1,
        createdAt
      ]
    );

    return this.mapInventoryItem(this.select<Row>(this.inventoryItemsSql("WHERE ii.id = ?"), [id])[0]);
  }

  deactivateInventoryItem(id: string) {
    this.runWrite("UPDATE inventory_items SET active = 0 WHERE id = ?", [id]);
    return true;
  }

  listSuppliers(): Supplier[] {
    return this.select<Row>("SELECT * FROM suppliers ORDER BY name ASC").map(this.mapSupplier);
  }

  saveSupplier(input: Partial<Supplier> & Pick<Supplier, "name">): Supplier {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM suppliers WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Supplier name");
    this.runWrite(
      `INSERT OR REPLACE INTO suppliers (id, name, phone, gstin, address, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.phone?.trim() || "",
        input.gstin?.trim() || "",
        input.address?.trim() || "",
        createdAt
      ]
    );
    return this.mapSupplier(this.select<Row>("SELECT * FROM suppliers WHERE id = ?", [id])[0]);
  }

  addInventoryPurchase(input: InventoryPurchaseInput): InventoryBatch {
    if (!input.itemId) throw new Error("Inventory item is required.");

    const batchId = randomUUID();
    let supplierId = optionalForeignKey(input.supplierId);
    const quantity = money(positiveNumber(input.quantity, "Purchase quantity"));
    const unitCost = money(nonNegativeNumber(input.unitCost, "Unit cost"));
    const subtotal = money(quantity * unitCost);
    const gstRate = money(nonNegativeNumber(input.gstRate || 0, "GST rate"));
    const gstAmount = money((subtotal * gstRate) / 100);
    const totalCost = money(subtotal + gstAmount);

    this.writeTransaction(() => {
      if (!supplierId && input.supplier?.name?.trim()) {
        supplierId = this.saveSupplierInTransaction(input.supplier).id;
      }
      this.requireDb().run(
        `INSERT INTO inventory_batches
          (id, itemId, supplierId, batchNumber, expiryDate, purchaseDate, billNumber,
           quantityPurchased, quantityRemaining, unitCost, gstRate, subtotal, gstAmount, totalCost, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchId,
          input.itemId,
          supplierId,
          input.batchNumber.trim(),
          input.expiryDate || "",
          input.purchaseDate || localDate(),
          input.billNumber.trim(),
          quantity,
          quantity,
          unitCost,
          gstRate,
          subtotal,
          gstAmount,
          totalCost,
          nowIso()
        ].map(normalizeParam)
      );
      this.insertInventoryMovement({
        itemId: input.itemId,
        batchId,
        type: "purchase",
        quantity,
        unitCost,
        reference: input.billNumber.trim(),
        notes: "Purchase stock added",
        movementDate: input.purchaseDate || localDate()
      });
    });

    return this.mapInventoryBatch(this.select<Row>("SELECT * FROM inventory_batches WHERE id = ?", [batchId])[0]);
  }

  addInventoryMovement(input: InventoryMovementInput): InventoryMovement[] {
    if (!input.itemId) throw new Error("Inventory item is required.");
    if (Number(input.quantity) <= 0) throw new Error("Quantity must be greater than zero.");
    const type = input.type;
    if (!["usage", "stock_sale", "adjustment", "return", "damage"].includes(type)) throw new Error("Unsupported manual stock movement.");
    if (type === "adjustment" || type === "return") {
      const batch = this.getWritableBatch(input.itemId);
      if (!batch) throw new Error("Add a purchase batch before recording this movement.");
      this.writeTransaction(() => {
        this.requireDb().run("UPDATE inventory_batches SET quantityRemaining = quantityRemaining + ? WHERE id = ?", [
          money(Number(input.quantity)),
          batch.id
        ]);
        this.insertInventoryMovement({
          itemId: input.itemId,
          batchId: batch.id,
          type,
          quantity: money(Number(input.quantity)),
          unitCost: batch.unitCost,
          reference: input.reference.trim(),
          notes: input.notes.trim(),
          movementDate: input.movementDate || localDate()
        });
      });
      return this.listInventoryMovements(input.itemId).slice(0, 20);
    }

    const saleAmount = type === "stock_sale" ? money(positiveNumber(input.saleAmount, "Sale amount")) : 0;
    const paymentMode = type === "stock_sale" ? this.normalizePaymentMode(input.paymentMode || "Cash") : "";
    this.writeTransaction(() => {
      this.deductInventory(input.itemId, money(Number(input.quantity)), type, input.reference.trim(), input.notes.trim(), input.movementDate || localDate(), {
        saleAmount,
        paymentMode
      });
    });
    return this.listInventoryMovements(input.itemId).slice(0, 20);
  }

  listInventoryBatches(itemId?: string): Array<InventoryBatch & { itemName: string; unit: string }> {
    const where = itemId ? "WHERE ib.itemId = ?" : "";
    return this.select<Row>(
      `SELECT ib.*, ii.name AS itemName, ii.unit AS unit
       FROM inventory_batches ib
       JOIN inventory_items ii ON ii.id = ib.itemId
       ${where}
       ORDER BY ib.expiryDate = '', ib.expiryDate ASC, ib.purchaseDate ASC`,
      itemId ? [itemId] : []
    ).map((row) => ({ ...this.mapInventoryBatch(row), itemName: rowText(row, "itemName"), unit: rowText(row, "unit") }));
  }

  listInventoryMovements(itemId?: string): InventoryMovement[] {
    const where = itemId ? "WHERE im.itemId = ?" : "";
    return this.select<Row>(
      `SELECT im.*, ii.name AS itemName, ii.type AS itemType, ii.unit AS itemUnit
       FROM inventory_movements im
       JOIN inventory_items ii ON ii.id = im.itemId
       ${where}
       ORDER BY im.movementDate DESC, im.createdAt DESC
       LIMIT 300`,
      itemId ? [itemId] : []
    ).map(this.mapInventoryMovement);
  }

  listInventoryMovementsForDate(movementDate: string): InventoryMovement[] {
    return this.select<Row>(
      `SELECT im.*, ii.name AS itemName, ii.type AS itemType, ii.unit AS itemUnit
       FROM inventory_movements im
       JOIN inventory_items ii ON ii.id = im.itemId
       WHERE im.movementDate = ?
       ORDER BY im.createdAt DESC`,
      [movementDate]
    ).map(this.mapInventoryMovement);
  }

  getInventoryDashboard(): InventoryDashboardData {
    const items = this.listInventoryItems(true);
    const lowStockItems = items.filter((item) => item.active && item.lowStockLevel > 0 && item.currentQuantity <= item.lowStockLevel);
    const expiryLimit = new Date();
    expiryLimit.setDate(expiryLimit.getDate() + 30);
    const expiringBatches = this.listInventoryBatches().filter(
      (batch) => batch.quantityRemaining > 0 && batch.expiryDate && batch.expiryDate <= localDate(expiryLimit)
    );
    const totalStockValue = money(items.reduce((sum, item) => sum + item.stockValue, 0));
    return {
      totalStockValue,
      lowStockCount: lowStockItems.length,
      expiringCount: expiringBatches.length,
      retailCount: items.filter((item) => item.type === "retail" && item.active).length,
      items,
      lowStockItems,
      expiringBatches,
      recentMovements: this.listInventoryMovements().slice(0, 20)
    };
  }

  listPayments(): Payment[] {
    return this.select<Row>("SELECT * FROM payments ORDER BY paymentDate DESC, createdAt DESC").map(this.mapPayment);
  }

  listAllInvoices(): InvoiceSummary[] {
    return this.select<Row>(
      `${this.invoiceSummarySql()} ORDER BY i.invoiceDate DESC, i.createdAt DESC`
    ).map(this.mapInvoiceSummary);
  }

  listPurchaseRecords(query = ""): PurchaseRecord[] {
    const q = query.trim().toLowerCase();
    return this.select<Row>("SELECT * FROM purchase_records ORDER BY purchaseDate DESC, createdAt DESC")
      .map(this.mapPurchaseRecord)
      .filter((record) => !q || JSON.stringify(record).toLowerCase().includes(q));
  }

  getServiceConsumables(serviceId: string): ServiceConsumable[] {
    return this.select<Row>(
      `SELECT sc.*, ii.name AS itemName, ii.unit AS unit
       FROM service_consumables sc
       JOIN inventory_items ii ON ii.id = sc.inventoryItemId
       WHERE sc.serviceId = ?
       ORDER BY ii.name ASC`,
      [serviceId]
    ).map(this.mapServiceConsumable);
  }

  saveServiceConsumables(serviceId: string, rows: Array<{ inventoryItemId: string; quantity: number }>) {
    this.writeTransaction(() => {
      this.requireDb().run("DELETE FROM service_consumables WHERE serviceId = ?", [serviceId]);
      rows
        .filter((row) => row.inventoryItemId && Number(row.quantity) > 0)
        .forEach((row) => {
          this.requireDb().run(
            `INSERT INTO service_consumables (id, serviceId, inventoryItemId, quantity, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), serviceId, row.inventoryItemId, money(Number(row.quantity)), nowIso()].map(normalizeParam)
          );
        });
    });
    return this.getServiceConsumables(serviceId);
  }

  listEnquiries(filter: { query?: string; status?: EnquiryStatus | "open" | "followups" } = {}): Enquiry[] {
    const clauses: string[] = [];
    const params: string[] = [];

    if (filter.status === "open") {
      clauses.push("status NOT IN ('converted', 'lost')");
    } else if (filter.status === "followups") {
      clauses.push("status NOT IN ('converted', 'lost') AND followUpDate != ''");
    } else if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }

    const query = filter.query?.trim();
    if (query) {
      clauses.push(
        "(customerName LIKE ? OR phone LIKE ? OR vehicleNumber LIKE ? OR vehicleType LIKE ? OR interestedService LIKE ? OR source LIKE ?)"
      );
      params.push(...Array(6).fill(`%${query}%`));
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.select<Row>(
      `SELECT * FROM enquiries ${where}
       ORDER BY
         CASE WHEN followUpDate = '' THEN 1 ELSE 0 END,
         followUpDate ASC,
         updatedAt DESC
       LIMIT 500`,
      params
    ).map(this.mapEnquiry);
  }

  saveEnquiry(input: EnquiryInput): Enquiry {
    if (!input.customerName.trim()) throw new Error("Customer name is required.");
    if (!input.phone.trim()) throw new Error("Phone number is required.");

    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM enquiries WHERE id = ?", [input.id])[0] : undefined;
    const current = existing ? this.mapEnquiry(existing) : undefined;
    if (current?.status === "converted") throw new Error("Converted enquiries cannot be edited.");
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const status = this.normalizeEnquiryStatus(input.status);
    const source = this.normalizeEnquirySource(input.source);

    this.runWrite(
      `INSERT OR REPLACE INTO enquiries
        (id, status, source, customerName, phone, email, address, vehicleType, vehicleNumber, vehicleMake, vehicleModel, vehicleColor,
         interestedService, expectedBudget, preferredVisitDate, followUpDate, notes, lostReason,
         customerId, vehicleId, convertedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        status,
        source,
        input.customerName.trim(),
        input.phone.trim(),
        input.email.trim(),
        input.address.trim(),
        this.normalizeVehicleType(input.vehicleType),
        input.vehicleNumber.trim().toUpperCase(),
        input.vehicleMake.trim(),
        input.vehicleModel.trim(),
        input.vehicleColor.trim(),
        input.interestedService.trim(),
        money(Number(input.expectedBudget || 0)),
        input.preferredVisitDate || "",
        input.followUpDate || "",
        input.notes.trim(),
        status === "lost" ? input.lostReason.trim() : "",
        optionalForeignKey(rowText(existing || {}, "customerId")),
        optionalForeignKey(rowText(existing || {}, "vehicleId")),
        rowText(existing || {}, "convertedAt"),
        createdAt,
        nowIso()
      ].map(normalizeParam)
    );

    return this.getEnquiry(id);
  }

  getEnquiry(id: string): Enquiry {
    const enquiry = this.select<Row>("SELECT * FROM enquiries WHERE id = ?", [id]).map(this.mapEnquiry)[0];
    if (!enquiry) throw new Error("Enquiry not found.");
    return enquiry;
  }

  listEnquiryFollowups(enquiryId: string): EnquiryFollowup[] {
    return this.select<Row>(
      "SELECT * FROM enquiry_followups WHERE enquiryId = ? ORDER BY followupDate DESC, createdAt DESC",
      [enquiryId]
    ).map(this.mapEnquiryFollowup);
  }

  addEnquiryFollowup(input: EnquiryFollowupInput): Enquiry {
    const enquiry = this.getEnquiry(input.enquiryId);
    if (enquiry.status === "converted") throw new Error("Converted enquiries do not need follow-up.");
    const status = this.normalizeEnquiryStatus(input.status);
    const nextFollowUpDate = status === "lost" ? "" : input.nextFollowUpDate || "";

    this.writeTransaction(() => {
      this.requireDb().run(
        `INSERT INTO enquiry_followups (id, enquiryId, followupDate, note, nextFollowUpDate, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          input.enquiryId,
          input.followupDate || localDate(),
          input.note.trim(),
          nextFollowUpDate,
          status,
          nowIso()
        ].map(normalizeParam)
      );
      this.requireDb().run(
        "UPDATE enquiries SET status = ?, followUpDate = ?, lostReason = CASE WHEN ? = 'lost' THEN ? ELSE lostReason END, updatedAt = ? WHERE id = ?",
        [status, nextFollowUpDate, status, input.note.trim(), nowIso(), input.enquiryId].map(normalizeParam)
      );
    });

    return this.getEnquiry(input.enquiryId);
  }

  convertEnquiryToCustomer(enquiryId: string) {
    const enquiry = this.getEnquiry(enquiryId);
    if (enquiry.customerId && enquiry.vehicleId) {
      return {
        enquiry,
        customer: this.mapCustomer(this.select<Row>("SELECT * FROM customers WHERE id = ?", [enquiry.customerId])[0]),
        vehicle: this.mapVehicle(this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [enquiry.vehicleId])[0])
      };
    }
    if (!enquiry.vehicleNumber.trim()) throw new Error("Vehicle number is required before converting.");

    let customer!: Customer;
    let vehicle!: Vehicle;
    this.writeTransaction(() => {
      const existingCustomer = enquiry.phone
        ? this.select<Row>("SELECT * FROM customers WHERE phone = ? ORDER BY createdAt ASC LIMIT 1", [enquiry.phone])[0]
        : undefined;
      customer = existingCustomer
        ? this.mapCustomer(existingCustomer)
        : this.saveCustomerInTransaction(undefined, {
            name: enquiry.customerName,
            phone: enquiry.phone,
            email: enquiry.email,
            address: enquiry.address,
            gstin: ""
          });

      const registrationNumber = enquiry.vehicleNumber.trim().toUpperCase();
      const existingVehicle = this.select<Row>(
        "SELECT * FROM vehicles WHERE customerId = ? AND registrationNumber = ? LIMIT 1",
        [customer.id, registrationNumber]
      )[0];
      vehicle = existingVehicle
        ? this.mapVehicle(existingVehicle)
        : this.saveVehicleInTransaction(undefined, customer.id, {
            registrationNumber,
            vehicleType: enquiry.vehicleType,
            make: enquiry.vehicleMake,
            model: enquiry.vehicleModel,
            color: enquiry.vehicleColor
          });
      this.requireDb().run(
        "UPDATE enquiries SET status = 'converted', customerId = ?, vehicleId = ?, convertedAt = ?, followUpDate = '', updatedAt = ? WHERE id = ?",
        [customer.id, vehicle.id, nowIso(), nowIso(), enquiryId]
      );
    });

    return { enquiry: this.getEnquiry(enquiryId), customer, vehicle };
  }

  getEnquiryDashboard(): EnquiryDashboardData {
    const today = localDate();
    const open = this.listEnquiries({ status: "open" });
    const dueToday = open.filter((enquiry) => enquiry.followUpDate === today);
    const overdue = open.filter((enquiry) => enquiry.followUpDate && enquiry.followUpDate < today);
    const newEnquiries = rowNumber(
      this.select<Row>("SELECT COUNT(*) AS value FROM enquiries WHERE status = 'new'")[0],
      "value"
    );
    const convertedEnquiries = rowNumber(
      this.select<Row>("SELECT COUNT(*) AS value FROM enquiries WHERE status = 'converted'")[0],
      "value"
    );

    return {
      todayFollowups: dueToday.length,
      overdueFollowups: overdue.length,
      newEnquiries,
      convertedEnquiries,
      dueToday: dueToday.slice(0, 8),
      overdue: overdue.slice(0, 8),
      recentOpen: open.slice(0, 8)
    };
  }

  getJobCardDashboard(): JobCardDashboardData {
    const today = localDate();
    const openStatuses: JobCardStatus[] = ["draft", "estimate_pending", "approved", "in_progress", "quality_check", "ready_delivery"];
    const open = this.listJobCards({ statuses: openStatuses });
    return {
      todayJobs: rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM job_cards WHERE jobDate = ?", [today])[0], "value"),
      openJobs: open.length,
      approvalPending: rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM job_cards WHERE status = 'estimate_pending'")[0], "value"),
      inProgress: rowNumber(
        this.select<Row>("SELECT COUNT(*) AS value FROM job_cards WHERE status IN ('approved', 'in_progress', 'quality_check')")[0],
        "value"
      ),
      readyDelivery: rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM job_cards WHERE status = 'ready_delivery'")[0], "value"),
      completedToday: rowNumber(
        this.select<Row>("SELECT COUNT(*) AS value FROM job_cards WHERE actualDeliveryDate = ? AND status IN ('delivered', 'billed')", [today])[0],
        "value"
      ),
      recentOpen: open.slice(0, 8)
    };
  }

  listJobCards(filter: { query?: string; status?: JobCardStatus | "today" | "open" | "approval" | "progress" | "ready" | "closed"; statuses?: JobCardStatus[] } = {}): JobCardSummary[] {
    const clauses: string[] = [];
    const params: string[] = [];
    const today = localDate();
    const statuses =
      filter.status === "open"
        ? ["draft", "estimate_pending", "approved", "in_progress", "quality_check", "ready_delivery"]
        : filter.status === "approval"
          ? ["estimate_pending"]
          : filter.status === "progress"
            ? ["approved", "in_progress", "quality_check"]
            : filter.status === "ready"
              ? ["ready_delivery", "delivered"]
              : filter.status === "closed"
                ? ["billed", "cancelled"]
                : filter.status && filter.status !== "today"
                  ? [filter.status]
                  : filter.statuses;

    if (filter.status === "today") {
      clauses.push("jc.jobDate = ?");
      params.push(today);
    }
    if (statuses?.length) {
      clauses.push(`jc.status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    if (filter.query?.trim()) {
      const q = `%${filter.query.trim()}%`;
      clauses.push("(jc.jobNumber LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR v.registrationNumber LIKE ? OR v.vehicleType LIKE ?)");
      params.push(q, q, q, q, q);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.select<Row>(`${this.jobCardSummarySql()} ${where} ORDER BY jc.jobDate DESC, jc.createdAt DESC LIMIT 300`, params).map(
      this.mapJobCardSummary
    );
  }

  getJobCard(id: string): JobCardDetail {
    const summary = this.select<Row>(`${this.jobCardSummarySql()} WHERE jc.id = ?`, [id]).map(this.mapJobCardSummary)[0];
    if (!summary) throw new Error("Job card not found.");
    const customer = this.mapCustomer(this.select<Row>("SELECT * FROM customers WHERE id = ?", [summary.customerId])[0]);
    const vehicle = this.mapVehicle(this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [summary.vehicleId])[0]);
    const items = this.select<Row>("SELECT * FROM job_card_items WHERE jobCardId = ? ORDER BY rowid ASC", [id]).map(this.mapJobCardItem);
    const checklist = this.select<Row>(
      "SELECT * FROM job_card_checklist_items WHERE jobCardId = ? ORDER BY sortOrder ASC, createdAt ASC",
      [id]
    ).map(this.mapJobCardChecklistItem);
    const photos = this.select<Row>("SELECT * FROM job_card_photos WHERE jobCardId = ? ORDER BY createdAt DESC", [id]).map(this.mapJobCardPhoto);
    const history = this.select<Row>("SELECT * FROM job_card_status_history WHERE jobCardId = ? ORDER BY createdAt DESC", [id]).map(
      this.mapJobCardStatusHistory
    );
    const invoice = summary.invoiceId ? this.getInvoice(summary.invoiceId) : undefined;
    return { ...summary, customer, vehicle, items, checklist, photos, history, invoice };
  }

  saveJobCard(input: JobCardInput): JobCardDetail {
    if (!input.customer.name.trim()) throw new Error("Customer name is required.");
    if (!input.vehicle.registrationNumber.trim()) throw new Error("Vehicle number is required.");
    const validItems = (Array.isArray(input.items) ? input.items : []).filter((item) => String(item.description ?? "").trim());
    if (!validItems.length) throw new Error("Add at least one estimate line.");
    this.validateJobCardItems(validItems, input.discount);

    if (input.id) this.assertUuid(input.id, "Job card");
    const existing = input.id ? this.select<Row>("SELECT * FROM job_cards WHERE id = ?", [input.id])[0] : undefined;
    if (input.id && !existing) throw new Error("Job card not found.");
    if (rowText(existing || {}, "invoiceId")) throw new Error("Billed job cards cannot be edited.");
    const status = this.normalizeJobCardStatus(input.status);
    if (status === "billed") throw new Error("Use Convert to Bill to mark a job card as billed.");
    const id = existing ? input.id! : randomUUID();
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const jobDate = input.jobDate || localDate();
    const totals = this.calculateJobCard(validItems, finiteNumber(input.discount ?? 0, "Estimate discount"));
    let customerId = input.customerId || "";
    let vehicleId = input.vehicleId || "";
    let jobNumber = rowText(existing || {}, "jobNumber");

    this.writeTransaction(() => {
      const customer = this.saveCustomerInTransaction(input.customerId, input.customer);
      customerId = customer.id;
      const vehicle = this.saveVehicleInTransaction(input.vehicleId, customer.id, input.vehicle);
      vehicleId = vehicle.id;
      if (!jobNumber) {
        const next = rowNumber(this.select<Row>("SELECT value FROM job_card_settings WHERE key = 'nextJobCardNumber'")[0] || { value: 1 }, "value") || 1;
        jobNumber = `JC-${String(next).padStart(5, "0")}`;
        this.requireDb().run("INSERT OR REPLACE INTO job_card_settings (key, value) VALUES ('nextJobCardNumber', ?)", [String(next + 1)]);
      }

      this.requireDb().run(
        `INSERT OR REPLACE INTO job_cards
          (id, jobNumber, status, jobDate, expectedDeliveryDate, expectedDeliveryTime, actualDeliveryDate, actualDeliveryTime,
           customerId, vehicleId, invoiceId, odometer, fuelLevel, keyReceived, belongingsNote,
           approvalName, approvalDate, approvalNotes, workNotes, internalNotes, deliveryNotes,
           subTotal, discount, taxableValue, totalTax, grandTotal, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          jobNumber,
          status,
          jobDate,
          input.expectedDeliveryDate,
          input.expectedDeliveryTime,
          input.actualDeliveryDate,
          input.actualDeliveryTime,
          customerId,
          vehicleId,
          optionalForeignKey(rowText(existing || {}, "invoiceId")),
          input.odometer.trim(),
          input.fuelLevel.trim(),
          input.keyReceived ? 1 : 0,
          input.belongingsNote.trim(),
          input.approvalName.trim(),
          input.approvalDate,
          input.approvalNotes.trim(),
          input.workNotes.trim(),
          input.internalNotes.trim(),
          input.deliveryNotes.trim(),
          totals.subTotal,
          totals.discount,
          totals.taxableValue,
          totals.totalTax,
          totals.grandTotal,
          createdAt,
          nowIso()
        ].map(normalizeParam)
      );

      this.requireDb().run("DELETE FROM job_card_items WHERE jobCardId = ?", [id]);
      totals.items.forEach((item) => this.insertJobCardItem(id, item));
      if (!existing) {
        this.seedJobCardChecklist(id);
        this.insertJobCardHistory(id, status, "Job card created.");
      } else if (rowText(existing, "status") !== status) {
        this.insertJobCardHistory(id, status, "Status updated.");
      }
    });

    return this.getJobCard(id);
  }

  updateJobCardStatus(input: { jobCardId: string; status: JobCardStatus; note?: string }): JobCardDetail {
    this.assertUuid(input.jobCardId, "Job card");
    const current = this.getJobCard(input.jobCardId);
    const status = this.normalizeJobCardStatus(input.status);
    if (status === "billed") throw new Error("Use Convert to Bill to mark a job card as billed.");
    if (current.invoiceId) throw new Error("Billed job cards cannot be changed.");
    const patches: string[] = ["status = ?", "updatedAt = ?"];
    const params: SqlValue[] = [status, nowIso()];
    if (status === "delivered" && !current.actualDeliveryDate) {
      patches.push("actualDeliveryDate = ?");
      params.push(localDate());
    }
    params.push(input.jobCardId);
    this.writeTransaction(() => {
      this.requireDb().run(`UPDATE job_cards SET ${patches.join(", ")} WHERE id = ?`, params.map(normalizeParam));
      this.insertJobCardHistory(input.jobCardId, status, input.note?.trim() || "Status updated.");
    });
    return this.getJobCard(input.jobCardId);
  }

  saveJobCardChecklist(jobCardId: string, rows: Array<{ id: string; checked: boolean }>): JobCardDetail {
    this.assertUuid(jobCardId, "Job card");
    const current = this.getJobCard(jobCardId);
    if (current.invoiceId) throw new Error("Billed job cards cannot be changed.");
    this.writeTransaction(() => {
      rows.forEach((row) => {
        this.assertUuid(row.id, "Checklist item");
        this.requireDb().run("UPDATE job_card_checklist_items SET checked = ? WHERE id = ? AND jobCardId = ?", [
          row.checked ? 1 : 0,
          row.id,
          jobCardId
        ]);
      });
    });
    return this.getJobCard(jobCardId);
  }

  getJobCardSettings() {
    return { defaultChecklist: this.getDefaultJobChecklist() };
  }

  saveJobCardSettings(input: { defaultChecklist: string[] }) {
    const defaultChecklist = input.defaultChecklist.map((item) => item.trim()).filter(Boolean);
    if (!defaultChecklist.length) throw new Error("Add at least one checklist item.");
    this.runWrite("INSERT OR REPLACE INTO job_card_settings (key, value) VALUES ('defaultChecklist', ?)", [
      JSON.stringify(defaultChecklist)
    ]);
    return { defaultChecklist };
  }

  addJobCardPhotos(jobCardId: string, type: JobCardPhotoType, filePaths: string[]): JobCardPhoto[] {
    this.assertUuid(jobCardId, "Job card");
    this.getJobCard(jobCardId);
    const safeType = this.normalizeJobCardPhotoType(type);
    const photoRoot = this.jobCardPhotoRoot();
    const photoDir = assertInsideDirectory(photoRoot, path.join(photoRoot, jobCardId));
    fs.mkdirSync(photoDir, { recursive: true });
    const created: JobCardPhoto[] = [];
    this.writeTransaction(() => {
      filePaths.forEach((sourcePath) => {
        const { resolved, extension } = this.validateJobCardPhotoSource(sourcePath);
        const id = randomUUID();
        const targetPath = assertInsideDirectory(photoDir, path.join(photoDir, `${safeType}-${id}${extension}`));
        fs.copyFileSync(resolved, targetPath);
        this.requireDb().run(
          `INSERT INTO job_card_photos (id, jobCardId, type, path, caption, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, jobCardId, safeType, targetPath, "", nowIso()].map(normalizeParam)
        );
        created.push(this.mapJobCardPhoto(this.select<Row>("SELECT * FROM job_card_photos WHERE id = ?", [id])[0]));
      });
    });
    return created;
  }

  removeJobCardPhoto(photoId: string) {
    this.assertUuid(photoId, "Photo");
    const row = this.select<Row>("SELECT * FROM job_card_photos WHERE id = ?", [photoId])[0];
    if (!row) throw new Error("Photo not found.");
    const filePath = rowText(row, "path");
    this.runWrite("DELETE FROM job_card_photos WHERE id = ?", [photoId]);
    const resolved = path.resolve(filePath);
    if (filePath && isInsideDirectory(this.jobCardPhotoRoot(), resolved) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return true;
  }

  updateJobCardPhotoCaption(photoId: string, caption: string): JobCardPhoto {
    this.assertUuid(photoId, "Photo");
    const photo = this.select<Row>("SELECT * FROM job_card_photos WHERE id = ?", [photoId]).map(this.mapJobCardPhoto)[0];
    if (!photo) throw new Error("Photo not found.");
    this.runWrite("UPDATE job_card_photos SET caption = ? WHERE id = ?", [caption.trim(), photoId]);
    return this.mapJobCardPhoto(this.select<Row>("SELECT * FROM job_card_photos WHERE id = ?", [photoId])[0]);
  }

  convertJobCardToInvoice(jobCardId: string, officialInvoiceNumber = ""): InvoiceDetail {
    this.assertUuid(jobCardId, "Job card");
    let invoiceId = "";
    this.writeTransaction(() => {
      const jobCard = this.getJobCard(jobCardId);
      if (jobCard.invoiceId) throw new Error("This job card is already linked to an invoice.");
      const duplicate = this.select<Row>("SELECT id FROM invoices WHERE jobCardId = ? LIMIT 1", [jobCardId])[0];
      if (duplicate) throw new Error("This job card is already linked to an invoice.");
      if (["draft", "estimate_pending", "cancelled"].includes(jobCard.status)) {
        throw new Error("Approve or complete the job card before creating a bill.");
      }

      invoiceId = this.createInvoiceInTransaction(
        {
          jobCardId,
          invoiceMode: "gst",
          taxScope: this.getSettings().defaultTaxScope,
          invoiceDate: localDate(),
          customerId: jobCard.customerId,
          customer: jobCard.customer,
          vehicleId: jobCard.vehicleId,
          vehicle: jobCard.vehicle,
          items: jobCard.items.map(({ id: _id, jobCardId: _jobCardId, lineSubTotal: _lineSubTotal, lineTax: _lineTax, lineTotal: _lineTotal, ...item }) => item),
          discount: jobCard.discount,
          paidAmount: 0,
          paymentMode: "Cash",
          paymentReference: "",
          notes: `Created from job card ${jobCard.jobNumber}. ${jobCard.deliveryNotes || jobCard.workNotes || ""}`.trim()
        },
        { allowJobCardId: true, officialInvoiceNumber }
      );
      const invoice = this.getInvoice(invoiceId);
      const patches = ["invoiceId = ?", "status = 'billed'", "updatedAt = ?"];
      const params: SqlValue[] = [invoiceId, nowIso()];
      if (!jobCard.actualDeliveryDate) {
        patches.push("actualDeliveryDate = ?");
        params.push(localDate());
      }
      params.push(jobCardId);
      this.requireDb().run(`UPDATE job_cards SET ${patches.join(", ")} WHERE id = ?`, params.map(normalizeParam));
      this.insertJobCardHistory(jobCardId, "billed", `Invoice ${invoice.invoiceNumber} created.`);
    });
    return this.getInvoice(invoiceId);
  }

  listCustomers(): CustomerWithVehicles[] {
    const customers = this.select<Row>("SELECT * FROM customers ORDER BY name ASC").map(this.mapCustomer);
    return customers.map((customer) => ({
      ...customer,
      vehicles: this.select<Row>("SELECT * FROM vehicles WHERE customerId = ? ORDER BY registrationNumber ASC", [
        customer.id
      ]).map(this.mapVehicle)
    }));
  }

  saveCustomer(input: Partial<Customer> & Pick<Customer, "name">): Customer {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM customers WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Customer name");

    this.runWrite(
      `INSERT OR REPLACE INTO customers
        (id, name, phone, email, gstin, address, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.phone?.trim() || "",
        input.email?.trim() || "",
        input.gstin?.trim() || "",
        input.address?.trim() || "",
        createdAt
      ]
    );

    return this.mapCustomer(this.select<Row>("SELECT * FROM customers WHERE id = ?", [id])[0]);
  }

  saveVehicle(input: {
    id?: string;
    customerId: string;
    vehicleType?: VehicleType;
    registrationNumber: string;
    make?: string;
    model?: string;
    color?: string;
  }) {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const customerId = requiredText(input.customerId, "Customer");
    const registrationNumber = requiredText(input.registrationNumber, "Vehicle number").toUpperCase();
    const customerExists = this.select<Row>("SELECT id FROM customers WHERE id = ?", [customerId])[0];
    if (!customerExists) throw new Error("Customer not found.");

    this.runWrite(
      `INSERT OR REPLACE INTO vehicles
        (id, customerId, vehicleType, registrationNumber, make, model, color, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        customerId,
        this.normalizeVehicleType(input.vehicleType),
        registrationNumber,
        input.make?.trim() || "",
        input.model?.trim() || "",
        input.color?.trim() || "",
        createdAt
      ]
    );
    return this.mapVehicle(this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [id])[0]);
  }

  createInvoice(input: InvoiceCreateInput): InvoiceDetail {
    if (input.jobCardId) throw new Error("Create job-card bills from the Job Cards screen only.");
    let invoiceId = "";
    this.writeTransaction(() => {
      invoiceId = this.createInvoiceInTransaction({ ...input, jobCardId: "" }, { allowJobCardId: false });
    });

    return this.getInvoice(invoiceId);
  }

  validateInvoiceForFinalization(input: InvoiceCreateInput) {
    this.validateInvoice(input);
    const taxScope: TaxScope = input.taxScope === "inter" ? "inter" : "intra";
    const totals = this.calculateInvoice(input.invoiceMode, taxScope, input.items, finiteNumber(input.discount ?? 0, "Discount"));
    this.assertInvoiceInventoryAvailable(totals.items);
    return true;
  }

  getInvoiceSequenceFloor(prefix: string) {
    const safePrefix = prefix.trim() || "AC24";
    const prefixToken = `${safePrefix}-`;
    const settings = this.getSettings();
    let floor = Math.max(0, Math.floor(Number(settings.nextInvoiceNumber) || 1) - 1);
    this.select<Row>("SELECT invoiceNumber FROM invoices")
      .map((row) => rowText(row, "invoiceNumber"))
      .forEach((invoiceNumber) => {
        if (!invoiceNumber.startsWith(prefixToken)) return;
        const suffix = invoiceNumber.slice(prefixToken.length);
        if (/^\d+$/.test(suffix)) floor = Math.max(floor, Number(suffix));
      });
    return floor;
  }

  createInvoiceWithOfficialNumber(input: InvoiceCreateInput, officialInvoiceNumber: string): InvoiceDetail {
    if (input.jobCardId) throw new Error("Create job-card bills from the Job Cards screen only.");
    let invoiceId = "";
    this.writeTransaction(() => {
      invoiceId = this.createInvoiceInTransaction(
        { ...input, jobCardId: "" },
        { allowJobCardId: false, officialInvoiceNumber }
      );
    });

    return this.getInvoice(invoiceId);
  }

  private createInvoiceInTransaction(input: InvoiceCreateInput, options: { allowJobCardId: boolean; officialInvoiceNumber?: string }): string {
    if (input.jobCardId && !options.allowJobCardId) throw new Error("Create job-card bills from the Job Cards screen only.");
    if (input.jobCardId) {
      this.assertUuid(input.jobCardId, "Job card");
      const duplicate = this.select<Row>("SELECT id FROM invoices WHERE jobCardId = ? LIMIT 1", [input.jobCardId])[0];
      if (duplicate) throw new Error("This job card is already linked to an invoice.");
    }
    this.validateInvoice(input);

    const settings = this.getSettings();
    const invoiceId = randomUUID();
    const officialInvoiceNumber = (options.officialInvoiceNumber || "").trim();
    const allocatedInvoice = officialInvoiceNumber
      ? { invoiceNumber: officialInvoiceNumber, nextInvoiceNumber: settings.nextInvoiceNumber }
      : this.allocateNextInvoiceNumber(settings);
    const invoiceNumber = allocatedInvoice.invoiceNumber;
    const cloudSyncStatus: CloudSyncRecordStatus = officialInvoiceNumber ? "synced" : "local_only";
    const invoiceDate = input.invoiceDate || localDate();
    const taxScope: TaxScope = input.taxScope === "inter" ? "inter" : "intra";
    let savedCustomerId = input.customerId || "";
    let savedVehicleId = input.vehicleId || "";

    const totals = this.calculateInvoice(input.invoiceMode, taxScope, input.items, finiteNumber(input.discount ?? 0, "Discount"));
    const paidAmount = money(Math.min(Math.max(finiteNumber(input.paidAmount ?? 0, "Paid amount"), 0), totals.grandTotal));
    const balanceDue = money(totals.grandTotal - paidAmount);
    const paymentStatus = this.paymentStatus(totals.grandTotal, paidAmount);

    const customer = this.saveCustomerInTransaction(input.customerId, input.customer);
    savedCustomerId = customer.id;

    const vehicle = this.saveVehicleInTransaction(input.vehicleId, savedCustomerId, input.vehicle);
    savedVehicleId = vehicle.id;

    this.requireDb().run(
      `INSERT INTO invoices
        (id, invoiceNumber, cloudSyncStatus, invoiceMode, taxScope, invoiceDate, customerId, vehicleId,
         subTotal, discount, taxableValue, cgst, sgst, igst, totalTax, grandTotal,
         paidAmount, balanceDue, paymentStatus, paymentMode, paymentReference, notes, jobCardId, sourceInvoiceId, sourceQuotationId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        invoiceNumber,
        cloudSyncStatus,
        input.invoiceMode,
        taxScope,
        invoiceDate,
        savedCustomerId,
        savedVehicleId,
        totals.subTotal,
        totals.discount,
        totals.taxableValue,
        totals.cgst,
        totals.sgst,
        totals.igst,
        totals.totalTax,
        totals.grandTotal,
        paidAmount,
        balanceDue,
        paymentStatus,
        input.paymentMode,
        input.paymentReference?.trim() || "",
        input.notes?.trim() || "",
        options.allowJobCardId ? input.jobCardId || "" : "",
        input.sourceInvoiceId || "",
        input.sourceQuotationId || "",
        nowIso()
      ].map(normalizeParam)
    );

    totals.items.forEach((item) => this.insertInvoiceItem(invoiceId, item));

    this.deductInvoiceInventory(invoiceId, totals.items, invoiceNumber, invoiceDate);

    if (paidAmount > 0) {
      this.requireDb().run(
        `INSERT INTO payments (id, invoiceId, amount, mode, reference, paymentDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          invoiceId,
          paidAmount,
          input.paymentMode,
          input.paymentReference?.trim() || "",
          invoiceDate,
          nowIso()
        ].map(normalizeParam)
      );
    }

    if (!officialInvoiceNumber) {
      this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextInvoiceNumber', ?)", [
        String(allocatedInvoice.nextInvoiceNumber)
      ]);
    }
    return invoiceId;
  }

  listInvoices(query = ""): InvoiceSummary[] {
    const q = `%${query.trim()}%`;
    const where = query.trim()
      ? `WHERE i.invoiceNumber LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR v.registrationNumber LIKE ? OR v.vehicleType LIKE ?`
      : "";
    const params = query.trim() ? [q, q, q, q, q] : [];

    return this.select<Row>(
      `${this.invoiceSummarySql()} ${where} ORDER BY i.invoiceDate DESC, i.createdAt DESC LIMIT 300`,
      params
    ).map(this.mapInvoiceSummary);
  }

  getInvoice(id: string): InvoiceDetail {
    const summary = this.select<Row>(`${this.invoiceSummarySql()} WHERE i.id = ?`, [id]).map(this.mapInvoiceSummary)[0];
    if (!summary) throw new Error("Invoice not found.");

    const customer = this.mapCustomer(this.select<Row>("SELECT * FROM customers WHERE id = ?", [summary.customerId])[0]);
    const vehicle = this.mapVehicle(this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [summary.vehicleId])[0]);
    const items = this.select<Row>("SELECT * FROM invoice_items WHERE invoiceId = ? ORDER BY rowid ASC", [id]).map(
      this.mapInvoiceItem
    );
    const payments = this.select<Row>("SELECT * FROM payments WHERE invoiceId = ? ORDER BY paymentDate ASC", [id]).map(
      this.mapPayment
    );

    return { ...summary, customer, vehicle, items, payments };
  }

  recordPayment(input: RecordPaymentInput): InvoiceDetail {
    const current = this.getInvoice(input.invoiceId);
    if (current.invoiceStatus === "cancelled") throw new Error("Cancelled invoices cannot receive payments.");
    const amount = money(Math.min(Math.max(finiteNumber(input.amount ?? 0, "Payment amount"), 0), current.balanceDue));
    if (amount <= 0) throw new Error("Payment amount must be greater than zero.");

    const paidAmount = money(current.paidAmount + amount);
    const balanceDue = money(current.grandTotal - paidAmount);
    const status = this.paymentStatus(current.grandTotal, paidAmount);

    this.writeTransaction(() => {
      this.requireDb().run(
        `INSERT INTO payments (id, invoiceId, amount, mode, reference, paymentDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          input.invoiceId,
          amount,
          input.mode,
          input.reference.trim(),
          input.paymentDate || localDate(),
          nowIso()
        ].map(normalizeParam)
      );
      this.requireDb().run(
        `UPDATE invoices SET paidAmount = ?, balanceDue = ?, paymentStatus = ?, paymentMode = ?, paymentReference = ?
         WHERE id = ?`,
        [paidAmount, balanceDue, status, input.mode, input.reference.trim(), input.invoiceId].map(normalizeParam)
      );
    });

    return this.getInvoice(input.invoiceId);
  }

  listInvoiceDrafts(): InvoiceDraft[] {
    return this.select<Row>("SELECT * FROM invoice_drafts ORDER BY updatedAt DESC").map(this.mapInvoiceDraft);
  }

  getInvoiceDraft(id: string): InvoiceDraft {
    const draft = this.select<Row>("SELECT * FROM invoice_drafts WHERE id = ?", [id]).map(this.mapInvoiceDraft)[0];
    if (!draft) throw new Error("Draft not found.");
    return draft;
  }

  saveInvoiceDraft(input: InvoiceDraftSaveInput): InvoiceDraft {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM invoice_drafts WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const updatedAt = nowIso();
    const correctionType = this.normalizeInvoiceDraftCorrectionType(input.correctionType || rowText(existing || {}, "correctionType"));
    const sourceInvoiceId = input.sourceInvoiceId ?? rowText(existing || {}, "sourceInvoiceId");
    const name = input.name?.trim() || this.invoiceDraftName(input.payload, correctionType);

    this.runWrite(
      `INSERT OR REPLACE INTO invoice_drafts
        (id, name, sourceInvoiceId, correctionType, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, sourceInvoiceId || "", correctionType, JSON.stringify(input.payload), createdAt, updatedAt]
    );
    return this.getInvoiceDraft(id);
  }

  discardInvoiceDraft(id: string) {
    this.runWrite("DELETE FROM invoice_drafts WHERE id = ?", [id]);
    return true;
  }

  finalizeInvoiceDraft(id: string, officialInvoiceNumber = ""): InvoiceDetail {
    const draft = this.getInvoiceDraft(id);
    let invoiceId = "";
    this.writeTransaction(() => {
      invoiceId = this.createInvoiceInTransaction(
        { ...draft.payload, sourceInvoiceId: draft.sourceInvoiceId || draft.payload.sourceInvoiceId || "" },
        { allowJobCardId: false, officialInvoiceNumber }
      );
      if (draft.correctionType === "replacement" && draft.sourceInvoiceId) {
        this.requireDb().run("UPDATE invoices SET replacementInvoiceId = ? WHERE id = ?", [invoiceId, draft.sourceInvoiceId]);
      }
      this.requireDb().run("DELETE FROM invoice_drafts WHERE id = ?", [id]);
    });
    return this.getInvoice(invoiceId);
  }

  repairPendingCloudInvoice(invoiceId: string, officialInvoiceNumber: string): InvoiceDetail {
    this.assertUuid(invoiceId, "Invoice");
    const invoice = this.getInvoice(invoiceId);
    const nextNumber = officialInvoiceNumber.trim();
    if (!nextNumber) throw new Error("Cloud did not return an official invoice number.");
    if (!invoice.invoiceNumber.startsWith("LOCAL-") && invoice.cloudSyncStatus !== "pending_cloud" && invoice.cloudSyncStatus !== "failed") {
      throw new Error("This invoice already has an official number.");
    }
    const duplicate = this.select<Row>("SELECT id FROM invoices WHERE invoiceNumber = ? AND id <> ? LIMIT 1", [nextNumber, invoice.id])[0];
    if (duplicate) {
      throw new Error(`Cloud assigned ${nextNumber}, but that invoice number already exists on this PC. Update/restart the cloud API, then click Finalize with cloud again.`);
    }
    this.writeTransaction(() => {
      this.requireDb().run(
        "UPDATE inventory_movements SET reference = ?, notes = REPLACE(notes, ?, ?) WHERE reference = ?",
        [nextNumber, invoice.invoiceNumber, nextNumber, invoice.invoiceNumber]
      );
      this.requireDb().run(
        `UPDATE invoices
         SET invoiceNumber = ?, cloudSyncStatus = 'synced', cloudSyncedAt = ?, cloudConflictId = '', createdAt = createdAt
         WHERE id = ?`,
        [nextNumber, nowIso(), invoice.id]
      );
      this.requireDb().run("UPDATE sync_conflicts SET status = 'RESOLVED', resolvedAt = ?, resolution = 'REPAIRED_WITH_CLOUD' WHERE entity = 'invoices' AND localId = ?", [
        nowIso(),
        invoice.id
      ]);
    });
    return this.getInvoice(invoice.id);
  }

  movePendingCloudInvoiceToDraft(invoiceId: string): InvoiceDraft {
    this.assertUuid(invoiceId, "Invoice");
    const invoice = this.getInvoice(invoiceId);
    if (!invoice.invoiceNumber.startsWith("LOCAL-") && invoice.cloudSyncStatus !== "pending_cloud" && invoice.cloudSyncStatus !== "failed") {
      throw new Error("Only temporary cloud invoices can be moved back to draft.");
    }
    const draftInput = this.createDraftFromInvoice(invoice, "normal");
    const draftId = randomUUID();
    const createdAt = nowIso();
    this.writeTransaction(() => {
      this.reverseInvoiceInventory(invoice);
      this.requireDb().run("DELETE FROM payments WHERE invoiceId = ?", [invoice.id]);
      this.requireDb().run("DELETE FROM invoice_items WHERE invoiceId = ?", [invoice.id]);
      if (invoice.jobCardId) {
        this.requireDb().run("UPDATE job_cards SET invoiceId = '', status = 'delivered', updatedAt = ? WHERE id = ?", [nowIso(), invoice.jobCardId]);
        this.insertJobCardHistory(invoice.jobCardId, "delivered", "Temporary invoice moved back to draft.");
      }
      if (invoice.sourceQuotationId) {
        this.requireDb().run(
          "UPDATE quotations SET quotationStatus = 'accepted', convertedInvoiceId = '', updatedAt = ? WHERE id = ?",
          [nowIso(), invoice.sourceQuotationId]
        );
      }
      this.requireDb().run("DELETE FROM invoices WHERE id = ?", [invoice.id]);
      this.requireDb().run("UPDATE sync_conflicts SET status = 'RESOLVED', resolvedAt = ?, resolution = 'MOVED_TO_DRAFT' WHERE entity = 'invoices' AND localId = ?", [
        nowIso(),
        invoice.id
      ]);
      this.requireDb().run(
        `INSERT INTO invoice_drafts
          (id, name, sourceInvoiceId, correctionType, payloadJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          draftId,
          `Draft bill - ${invoice.customerName || invoice.customer.name || "Customer"}`,
          "",
          "normal",
          JSON.stringify({ ...draftInput.payload, sourceInvoiceId: "" }),
          createdAt,
          createdAt
        ]
      );
    });
    return this.getInvoiceDraft(draftId);
  }

  cancelInvoice(input: InvoiceCancelInput, userId: string): InvoiceDetail {
    const reason = input.reason.trim();
    if (!reason) throw new Error("Cancellation reason is required.");
    const invoice = this.getInvoice(input.invoiceId);
    if (invoice.invoiceStatus === "cancelled") throw new Error("Invoice is already cancelled.");

    this.writeTransaction(() => {
      this.reverseInvoiceInventory(invoice);
      this.requireDb().run(
        `UPDATE invoices
         SET invoiceStatus = 'cancelled', cancelledAt = ?, cancelledByUserId = ?, cancelReason = ?, balanceDue = 0, paymentStatus = 'paid'
         WHERE id = ?`,
        [nowIso(), userId, reason, invoice.id].map(normalizeParam)
      );
    });
    return this.getInvoice(invoice.id);
  }

  appendInvoiceItem(input: InvoiceAppendItemInput): InvoiceDetail {
    const invoice = this.getInvoice(input.invoiceId);
    if (invoice.invoiceStatus === "cancelled") throw new Error("Cancelled invoices cannot be changed.");
    const appendItem = this.normalizeAppendInvoiceItem(input.item, invoice.invoiceMode);
    const existingItems = invoice.items.map(({ id: _id, invoiceId: _invoiceId, lineSubTotal: _lineSubTotal, lineTax: _lineTax, lineTotal: _lineTotal, ...item }) => item);
    const totals = this.calculateInvoice(invoice.invoiceMode, invoice.taxScope, [...existingItems, appendItem], invoice.discount);
    const paidAmount = money(invoice.paidAmount);
    const balanceDue = money(totals.grandTotal - paidAmount);
    const paymentStatus = this.paymentStatus(totals.grandTotal, paidAmount);

    this.writeTransaction(() => {
      this.requireDb().run("DELETE FROM invoice_items WHERE invoiceId = ?", [invoice.id]);
      totals.items.forEach((item) => this.insertInvoiceItem(invoice.id, item));
      this.requireDb().run(
        `UPDATE invoices
         SET subTotal = ?, discount = ?, taxableValue = ?, cgst = ?, sgst = ?, igst = ?, totalTax = ?, grandTotal = ?,
             balanceDue = ?, paymentStatus = ?
         WHERE id = ?`,
        [
          totals.subTotal,
          totals.discount,
          totals.taxableValue,
          totals.cgst,
          totals.sgst,
          totals.igst,
          totals.totalTax,
          totals.grandTotal,
          balanceDue,
          paymentStatus,
          invoice.id
        ].map(normalizeParam)
      );
      this.deductInvoiceInventory(invoice.id, [appendItem], invoice.invoiceNumber, localDate());
    });

    return this.getInvoice(invoice.id);
  }

  createReplacementDraft(invoiceId: string): InvoiceDraft {
    const invoice = this.getInvoice(invoiceId);
    if (invoice.invoiceStatus !== "cancelled") throw new Error("Cancel the invoice before making a replacement draft.");
    const draft = this.createDraftFromInvoice(invoice, "replacement");
    return this.saveInvoiceDraft(draft);
  }

  createAddonDraft(invoiceId: string): InvoiceDraft {
    const invoice = this.getInvoice(invoiceId);
    if (invoice.invoiceStatus === "cancelled") throw new Error("Cancelled invoices cannot receive add-on bills.");
    const settings = this.getSettings();
    return this.saveInvoiceDraft({
      name: `Add-on for ${invoice.invoiceNumber}`,
      sourceInvoiceId: invoice.id,
      correctionType: "addon",
      payload: {
        invoiceMode: invoice.invoiceMode,
        taxScope: invoice.taxScope,
        invoiceDate: localDate(),
        sourceInvoiceId: invoice.id,
        selectedCustomerId: invoice.customerId,
        selectedVehicleId: invoice.vehicleId,
        customerId: invoice.customerId,
        vehicleId: invoice.vehicleId,
        customer: invoice.customer,
        vehicle: invoice.vehicle,
        items: [{ description: "", quantity: 1, unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: DEFAULT_SAC_CODE }],
        discount: 0,
        paidAmount: 0,
        paymentMode: invoice.paymentMode,
        paymentReference: "",
        notes: `Add-on bill for ${invoice.invoiceNumber}`
      }
    });
  }

  listQuotations(query = ""): QuotationSummary[] {
    const q = `%${query.trim()}%`;
    const where = query.trim()
      ? `WHERE q.quotationNumber LIKE ? OR q.quotationStatus LIKE ? OR q.customerName LIKE ? OR q.customerPhone LIKE ? OR q.customerEmail LIKE ? OR q.vehicleNumber LIKE ? OR q.vehicleType LIKE ?`
      : "";
    const params = query.trim() ? [q, q, q, q, q, q, q] : [];

    return this.select<Row>(
      `${this.quotationSummarySql()} ${where} ORDER BY q.quotationDate DESC, q.updatedAt DESC LIMIT 300`,
      params
    ).map(this.mapQuotationSummary);
  }

  getQuotation(id: string): QuotationDetail {
    const summary = this.select<Row>(`${this.quotationSummarySql()} WHERE q.id = ?`, [id]).map(this.mapQuotationSummary)[0];
    if (!summary) throw new Error("Quotation not found.");

    const customerRow = summary.customerId ? this.select<Row>("SELECT * FROM customers WHERE id = ?", [summary.customerId])[0] : undefined;
    const vehicleRow = summary.vehicleId ? this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [summary.vehicleId])[0] : undefined;
    const customer = customerRow
      ? this.mapCustomer(customerRow)
      : {
          id: summary.customerId,
          name: summary.customerName,
          phone: summary.customerPhone,
          email: summary.customerEmail,
          gstin: summary.customerGstin,
          address: summary.customerAddress,
          createdAt: summary.createdAt
        };
    const vehicle = vehicleRow
      ? this.mapVehicle(vehicleRow)
      : {
          id: summary.vehicleId,
          customerId: summary.customerId,
          vehicleType: summary.vehicleType,
          registrationNumber: summary.vehicleNumber,
          make: summary.vehicleMake,
          model: summary.vehicleModel,
          color: summary.vehicleColor,
          createdAt: summary.createdAt
        };
    const items = this.select<Row>("SELECT * FROM quotation_items WHERE quotationId = ? ORDER BY rowid ASC", [id]).map(
      this.mapQuotationItem
    );
    const convertedInvoice = summary.convertedInvoiceId
      ? this.select<Row>(`${this.invoiceSummarySql()} WHERE i.id = ?`, [summary.convertedInvoiceId]).map(this.mapInvoiceSummary)[0]
      : undefined;

    return { ...summary, customer, vehicle, items, convertedInvoice };
  }

  saveQuotation(input: QuotationSaveInput): QuotationDetail {
    const existing = input.id ? this.select<Row>("SELECT * FROM quotations WHERE id = ?", [input.id])[0] : undefined;
    if (existing && rowText(existing, "convertedInvoiceId")) throw new Error("Converted quotations cannot be edited.");

    const id = input.id || randomUUID();
    const settings = this.getSettings();
    const allocated = existing
      ? { quotationNumber: rowText(existing, "quotationNumber"), nextQuotationNumber: settings.nextQuotationNumber }
      : this.allocateNextQuotationNumber(settings);
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const updatedAt = nowIso();
    const status = existing
      ? this.normalizeQuotationStatus(input.status || rowText(existing, "quotationStatus"))
      : this.normalizeQuotationStatus(input.status || "draft");
    if (status === "converted") throw new Error("Use Convert to Bill to mark a quotation as converted.");
    const taxScope: TaxScope = input.taxScope === "inter" ? "inter" : "intra";
    const draftItems = this.normalizeQuotationDraftItems(input.items);
    const totals = this.calculateInvoice(input.invoiceMode, taxScope, draftItems, finiteNumber(input.discount ?? 0, "Discount"));
    const quotationDate = input.quotationDate || localDate();
    const customerId = optionalForeignKey(input.customerId || input.customer?.id);
    const vehicleId = optionalForeignKey(input.vehicleId || input.vehicle?.id);
    const customerName = input.customer?.name?.trim() || "";
    const customerPhone = input.customer?.phone?.trim() || "";
    const customerEmail = input.customer?.email?.trim() || "";
    const customerGstin = input.customer?.gstin?.trim().toUpperCase() || "";
    const customerAddress = input.customer?.address?.trim() || "";
    const vehicleType = this.normalizeVehicleType(input.vehicle?.vehicleType);
    const vehicleNumber = input.vehicle?.registrationNumber?.trim().toUpperCase() || "";
    const vehicleMake = input.vehicle?.make?.trim() || "";
    const vehicleModel = input.vehicle?.model?.trim() || "";
    const vehicleColor = input.vehicle?.color?.trim() || "";

    this.writeTransaction(() => {
      const commonParams = [
        allocated.quotationNumber,
        status,
        input.invoiceMode === "simple" ? "simple" : "gst",
        taxScope,
        quotationDate,
        input.validUntil?.trim() || "",
        customerId,
        vehicleId,
        customerName,
        customerPhone,
        customerEmail,
        customerGstin,
        customerAddress,
        vehicleType,
        vehicleNumber,
        vehicleMake,
        vehicleModel,
        vehicleColor,
        totals.subTotal,
        totals.discount,
        totals.taxableValue,
        totals.cgst,
        totals.sgst,
        totals.igst,
        totals.totalTax,
        totals.grandTotal,
        input.notes?.trim() || "",
        optionalForeignKey(rowText(existing || {}, "convertedInvoiceId")),
        updatedAt
      ].map(normalizeParam);

      if (existing) {
        this.requireDb().run(
          `UPDATE quotations
           SET quotationNumber = ?, quotationStatus = ?, invoiceMode = ?, taxScope = ?, quotationDate = ?, validUntil = ?,
               customerId = ?, vehicleId = ?, customerName = ?, customerPhone = ?, customerEmail = ?, customerGstin = ?, customerAddress = ?,
               vehicleType = ?, vehicleNumber = ?, vehicleMake = ?, vehicleModel = ?, vehicleColor = ?,
               subTotal = ?, discount = ?, taxableValue = ?, cgst = ?, sgst = ?, igst = ?,
               totalTax = ?, grandTotal = ?, notes = ?, convertedInvoiceId = ?, updatedAt = ?
           WHERE id = ?`,
          [...commonParams, id].map(normalizeParam)
        );
      } else {
        this.requireDb().run(
          `INSERT INTO quotations
            (quotationNumber, quotationStatus, invoiceMode, taxScope, quotationDate, validUntil, customerId, vehicleId,
             customerName, customerPhone, customerEmail, customerGstin, customerAddress, vehicleType, vehicleNumber, vehicleMake, vehicleModel, vehicleColor,
             subTotal, discount, taxableValue, cgst, sgst, igst, totalTax, grandTotal, notes, convertedInvoiceId, updatedAt, id, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...commonParams, id, createdAt].map(normalizeParam)
        );
      }

      this.requireDb().run("DELETE FROM quotation_items WHERE quotationId = ?", [id]);
      totals.items.forEach((item) => this.insertQuotationItem(id, item));
      if (!existing) {
        this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextQuotationNumber', ?)", [
          String(allocated.nextQuotationNumber)
        ]);
      }
    });

    return this.getQuotation(id);
  }

  updateQuotationStatus(input: QuotationStatusInput): QuotationDetail {
    const quotation = this.getQuotation(input.quotationId);
    if (quotation.convertedInvoiceId) throw new Error("Converted quotations are locked.");
    const status = this.normalizeQuotationStatus(input.status);
    if (status === "converted") throw new Error("Use Convert to Bill to mark a quotation as converted.");
    this.runWrite("UPDATE quotations SET quotationStatus = ?, updatedAt = ? WHERE id = ?", [status, nowIso(), quotation.id]);
    return this.getQuotation(quotation.id);
  }

  convertQuotationToInvoice(quotationId: string, officialInvoiceNumber = ""): InvoiceDetail {
    const quotation = this.getQuotation(quotationId);
    if (quotation.convertedInvoiceId || quotation.quotationStatus === "converted") {
      throw new Error("This quotation is already converted to a bill.");
    }
    if (!["draft", "sent", "accepted"].includes(quotation.quotationStatus)) {
      throw new Error("Only Draft, Sent, or Accepted quotations can be converted to a bill.");
    }

    let invoiceId = "";
    this.writeTransaction(() => {
      const current = this.select<Row>("SELECT convertedInvoiceId, quotationStatus FROM quotations WHERE id = ?", [quotation.id])[0];
      if (!current) throw new Error("Quotation not found.");
      if (rowText(current, "convertedInvoiceId") || rowText(current, "quotationStatus") === "converted") {
        throw new Error("This quotation is already converted to a bill.");
      }
      const notes = [`Converted from quotation ${quotation.quotationNumber}.`, quotation.notes].filter(Boolean).join(" ");
      invoiceId = this.createInvoiceInTransaction(
        {
          invoiceMode: quotation.invoiceMode,
          taxScope: quotation.taxScope,
          invoiceDate: localDate(),
          sourceQuotationId: quotation.id,
          customerId: quotation.customerId,
          customer: quotation.customer,
          vehicleId: quotation.vehicleId,
          vehicle: quotation.vehicle,
          items: quotation.items.map(({ id: _id, quotationId: _quotationId, lineSubTotal: _lineSubTotal, lineTax: _lineTax, lineTotal: _lineTotal, ...item }) => item),
          discount: quotation.discount,
          paidAmount: 0,
          paymentMode: "UPI",
          paymentReference: "",
          notes
        },
        { allowJobCardId: false, officialInvoiceNumber }
      );
      this.requireDb().run("UPDATE quotations SET quotationStatus = 'converted', convertedInvoiceId = ?, updatedAt = ? WHERE id = ?", [
        invoiceId,
        nowIso(),
        quotation.id
      ]);
    });

    return this.getInvoice(invoiceId);
  }

  getDashboard(): DashboardData {
    const today = localDate();
    const monthStart = `${today.slice(0, 7)}-01`;

    const activeInvoiceWhere = "invoiceStatus <> 'cancelled'";
    const activePaymentWhere = "i.invoiceStatus <> 'cancelled'";
    const todayRevenue = rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(p.amount), 0) AS value
         FROM payments p
         JOIN invoices i ON i.id = p.invoiceId
         WHERE p.paymentDate = ? AND ${activePaymentWhere}`,
        [today]
      )[0],
      "value"
    );
    const monthRevenue = rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(p.amount), 0) AS value
         FROM payments p
         JOIN invoices i ON i.id = p.invoiceId
         WHERE p.paymentDate >= ? AND ${activePaymentWhere}`,
        [monthStart]
      )[0],
      "value"
    );
    const pendingDues = rowNumber(
      this.select<Row>(`SELECT COALESCE(SUM(balanceDue), 0) AS value FROM invoices WHERE balanceDue > 0 AND ${activeInvoiceWhere}`)[0],
      "value"
    );
    const todayInvoices = rowNumber(
      this.select<Row>(`SELECT COUNT(*) AS value FROM invoices WHERE invoiceDate = ? AND ${activeInvoiceWhere}`, [today])[0],
      "value"
    );
    const todayQuickStockSales = this.getQuickStockSaleRevenue({ fromDate: today, toDate: today });
    const monthQuickStockSales = this.getQuickStockSaleRevenue({ fromDate: monthStart });

    return {
      todayRevenue: money(todayRevenue + todayQuickStockSales),
      monthRevenue: money(monthRevenue + monthQuickStockSales),
      pendingDues: money(pendingDues),
      todayInvoices,
      recentInvoices: this.listInvoices("").slice(0, 8),
      topServices: this.getTopServices(),
      enquiries: this.getEnquiryDashboard(),
      jobCards: this.getJobCardDashboard()
    };
  }

  getReports(filter: ReportFilterInput = "30d"): ReportData {
    const { where, params, label } = this.rangeClause(filter, "i.invoiceDate");
    const activeWhere = where ? `${where} AND i.invoiceStatus <> 'cancelled'` : "WHERE i.invoiceStatus <> 'cancelled'";
    const invoices = this.select<Row>(
      `${this.invoiceSummarySql()} ${activeWhere} ORDER BY i.invoiceDate DESC, i.createdAt DESC`,
      params
    ).map(this.mapInvoiceSummary);
    const cancelledWhere = where ? `${where} AND i.invoiceStatus = 'cancelled'` : "WHERE i.invoiceStatus = 'cancelled'";
    const cancelledCount = rowNumber(
      this.select<Row>(`SELECT COUNT(*) AS value FROM invoices i ${cancelledWhere}`, params)[0] || { value: 0 },
      "value"
    );

    const sums = invoices.reduce(
      (acc, invoice) => ({
        revenue: money(acc.revenue + invoice.grandTotal),
        paidAmount: money(acc.paidAmount + invoice.paidAmount),
        balanceDue: money(acc.balanceDue + invoice.balanceDue),
        taxableValue: money(acc.taxableValue + invoice.taxableValue),
        cgst: money(acc.cgst + invoice.cgst),
        sgst: money(acc.sgst + invoice.sgst),
        igst: money(acc.igst + invoice.igst),
        totalTax: money(acc.totalTax + invoice.totalTax)
      }),
      { revenue: 0, paidAmount: 0, balanceDue: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }
    );

    const topServices = this.getTopServices(filter);
    const paymentModes = this.getPaymentModeTotals(filter);
    const paidAmount = money(paymentModes.reduce((sum, item) => sum + item.amount, 0));
    const invoiceRevenue = sums.revenue;
    const quickStockSales = this.getQuickStockSaleRevenue(filter);
    const totalSales = money(invoiceRevenue + quickStockSales);

    return {
      rangeLabel: label,
      invoiceCount: invoices.length,
      cancelledCount,
      dues: invoices.filter((invoice) => invoice.balanceDue > 0),
      topServices,
      paymentModes,
      salesTrend: this.getSalesTrend(filter),
      inventory: this.getInventoryDashboard(),
      enquiries: this.getEnquiryReport(filter),
      jobCards: this.getJobCardReport(filter),
      ...sums,
      invoiceRevenue,
      quickStockSales,
      totalSales,
      paidAmount
    };
  }

  listExpenses(filter: ReportFilterInput = "30d"): Expense[] {
    const { where, params } = this.rangeClause(filter, "expenseDate");
    return this.select<Row>(
      `SELECT * FROM expenses ${where} ORDER BY expenseDate DESC, createdAt DESC`,
      params
    ).map(this.mapExpense);
  }

  saveExpense(input: ExpenseInput, userId: string): Expense {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM expenses WHERE id = ?", [input.id])[0] : undefined;
    const expenseDate = input.expenseDate || localDate();
    const category = requiredText(input.category, "Expense category");
    const amount = money(positiveNumber(input.amount, "Expense amount"));
    const paymentMode = this.normalizePaymentMode(input.paymentMode);
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const createdByUserId = rowText(existing || {}, "createdByUserId") || userId;
    const updatedAt = nowIso();

    this.runWrite(
      `INSERT OR REPLACE INTO expenses
        (id, expenseDate, category, amount, paymentMode, vendor, reference, notes, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        expenseDate,
        category,
        amount,
        paymentMode,
        input.vendor?.trim() || "",
        input.reference?.trim() || "",
        input.notes?.trim() || "",
        createdByUserId,
        createdAt,
        updatedAt
      ]
    );

    return this.mapExpense(this.select<Row>("SELECT * FROM expenses WHERE id = ?", [id])[0]);
  }

  deleteExpense(id: string) {
    this.runWrite("DELETE FROM expenses WHERE id = ?", [id]);
    return true;
  }

  getProfitReport(filter: ReportFilterInput = "30d"): ProfitReportData {
    const { label } = this.rangeClause(filter, "p.paymentDate");
    const paymentRange = this.rangeCondition(filter, "p.paymentDate");
    const stockRange = this.rangeCondition(filter, "im.movementDate");
    const expenseRange = this.rangeCondition(filter, "e.expenseDate");

    const invoicePaidRevenue = money(rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(p.amount), 0) AS value
         FROM payments p
         JOIN invoices i ON i.id = p.invoiceId
         WHERE i.invoiceStatus <> 'cancelled' ${paymentRange.condition}`,
        paymentRange.params
      )[0] || { value: 0 },
      "value"
    ));
    const quickStockSales = this.getQuickStockSaleRevenue(filter);
    const paidRevenue = money(invoicePaidRevenue + quickStockSales);

    const invoiceStockCost = money(rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(im.quantity * im.unitCost), 0) AS value
         FROM inventory_movements im
         JOIN invoices i ON i.invoiceNumber = im.reference
         WHERE i.invoiceStatus <> 'cancelled'
           AND im.type IN ('sale', 'usage') ${stockRange.condition}`,
        stockRange.params
      )[0] || { value: 0 },
      "value"
    ));
    const quickStockCost = this.getQuickStockSaleCost(filter);
    const stockCost = money(invoiceStockCost + quickStockCost);

    const expenseTotal = money(rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(e.amount), 0) AS value
         FROM expenses e
         WHERE 1 = 1 ${expenseRange.condition}`,
        expenseRange.params
      )[0] || { value: 0 },
      "value"
    ));

    const expensesByCategory = this.select<Row>(
      `SELECT e.category AS category, COALESCE(SUM(e.amount), 0) AS amount
       FROM expenses e
       WHERE 1 = 1 ${expenseRange.condition}
       GROUP BY e.category
       ORDER BY amount DESC`,
      expenseRange.params
    ).map((row) => ({ category: rowText(row, "category"), amount: money(rowNumber(row, "amount")) }));

    const trend = this.getProfitTrend(filter);
    const cashProfit = money(paidRevenue - stockCost - expenseTotal);
    const profitMargin = paidRevenue > 0 ? money((cashProfit / paidRevenue) * 100) : 0;

    return {
      rangeLabel: label,
      paidRevenue,
      stockCost,
      expenseTotal,
      cashProfit,
      profitMargin,
      trend,
      expensesByCategory,
      expenses: this.listExpenses(filter)
    };
  }

  createManualBackup(options: BackupCreateOptions = {}): BackupResult {
    const result = this.createBackup("manual", options);
    return { ok: true, message: this.backupMessage("Backup created successfully.", result.cloudSnapshot), path: result.filePath, cloudSnapshot: result.cloudSnapshot };
  }

  getLatestBackupRecord(kind?: "auto" | "manual" | "repair") {
    const rows = this.select<Row>(
      `SELECT path, kind, createdAt, cloudSnapshotIncluded, cloudSnapshotAt, cloudSnapshotEntityCount,
              cloudSnapshotRecordCount, cloudSnapshotInvoiceCount, cloudSnapshotError
       FROM backups
       ${kind ? "WHERE kind = ?" : ""}
       ORDER BY createdAt DESC LIMIT 1`,
      kind ? [kind] : []
    );
    const row = rows[0];
    if (!row) return null;
    return {
      path: rowText(row, "path"),
      kind: rowText(row, "kind"),
      createdAt: rowText(row, "createdAt"),
      cloudSnapshot: this.backupCloudSnapshotStatusFromRow(row)
    };
  }

  getLatestBackup(kind?: "auto" | "manual" | "repair"): SaveResult {
    const latest = this.getLatestBackupRecord(kind);
    if (!latest || !fs.existsSync(latest.path)) return { ok: false, message: "No local backup is available." };
    return { ok: true, message: `${latest.kind} backup found.`, path: latest.path };
  }

  restoreFromFile(filePath: string): SaveResult {
    if (this.isBackupBundle(filePath)) return this.restoreFromBundle(filePath);
    if (!this.sql) throw new Error("Database engine is not initialized.");
    const restored = new this.sql.Database(fs.readFileSync(filePath));
    const check = restored.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoices'");
    if (!check.length) throw new Error("Selected file is not a valid Autocare24 backup.");

    this.db = restored;
    this.requireDb().run("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.seedDefaults();
    this.save();
    return { ok: true, message: "Backup restored successfully.", path: filePath };
  }

  exportCsv(kind: "invoices" | "customers" | "services" | "inventory" | "enquiries" | "jobCards") {
    const rows =
      kind === "invoices"
        ? this.listInvoices("").map((invoice) => ({
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
          ? this.listCustomers().map((customer) => ({
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              gstin: customer.gstin,
              address: customer.address,
              vehicles: customer.vehicles
                .map((vehicle) => `${this.vehicleTypeLabel(vehicle.vehicleType)} ${vehicle.registrationNumber}`.trim())
                .join(" | ")
            }))
          : kind === "services"
            ? this.listServices(true).map((service) => ({
                name: service.name,
                category: service.category,
                price: service.defaultPrice,
                gstRate: service.gstRate,
                sacCode: service.sacCode,
                active: service.active ? "yes" : "no"
              }))
            : kind === "inventory"
              ? this.listInventoryItems(true).map((item) => ({
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
                ? this.listEnquiries().map((enquiry) => ({
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
                : this.listJobCards().map((jobCard) => ({
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

    if (!rows.length) return "";
    const first = rows[0];
    if (!first) return "";
    const headers = Object.keys(first);
    return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(","))].join(
      "\n"
    );
  }

  exportReportCsv(kind: ReportExportKind, filter: ReportFilterInput = "30d") {
    const report = this.getReports(filter);
    const sections: string[] = [];
    const include = (section: ReportExportKind) => kind === "full" || kind === section;
    const addSection = (title: string, rows: Array<Record<string, unknown>>) => {
      if (!rows.length) return;
      sections.push(title, this.rowsToCsv(rows));
    };

    if (include("sales")) {
      addSection("Sales Summary", [
        {
          range: report.rangeLabel,
          invoices: report.invoiceCount,
          invoiceBilled: report.invoiceRevenue,
          quickStockSales: report.quickStockSales,
          totalSales: report.totalSales,
          collected: report.paidAmount,
          due: report.balanceDue,
          cancelled: report.cancelledCount
        }
      ]);
      addSection("Daily Sales Trend", report.salesTrend);
      addSection("Top Services", report.topServices);
    }

    if (include("gst")) {
      addSection("GST Tax Summary", [
        {
          taxableValue: report.taxableValue,
          cgst: report.cgst,
          sgst: report.sgst,
          igst: report.igst,
          totalTax: report.totalTax
        }
      ]);
    }

    if (include("payments")) {
      addSection("Payment Modes", report.paymentModes);
      addSection(
        "Pending Dues",
        report.dues.map((invoice) => ({
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          customer: invoice.customerName,
          phone: invoice.customerPhone,
          vehicle: invoice.vehicleNumber,
          grandTotal: invoice.grandTotal,
          paidAmount: invoice.paidAmount,
          balanceDue: invoice.balanceDue,
          paymentStatus: invoice.paymentStatus
        }))
      );
    }

    if (include("stock")) {
      addSection("Stock Summary", [
        {
          stockValue: report.inventory.totalStockValue,
          lowStock: report.inventory.lowStockCount,
          expiringBatches: report.inventory.expiringCount,
          retailProducts: report.inventory.retailCount
        }
      ]);
      addSection(
        "Stock Items",
        report.inventory.items.map((item) => ({
          name: item.name,
          type: item.type,
          category: item.category,
          available: item.currentQuantity,
          unit: item.unit,
          lowStockLevel: item.lowStockLevel,
          stockValue: item.stockValue,
          sellingPrice: item.retailPrice,
          active: item.active ? "yes" : "no"
        }))
      );
      addSection(
        "Recent Stock Movements",
        report.inventory.recentMovements.map((movement) => ({
          date: movement.movementDate,
          item: movement.itemName,
          type: movement.type,
          quantity: movement.quantity,
          unit: movement.itemUnit,
          costValue: money(movement.quantity * movement.unitCost),
          saleValue: movement.saleAmount,
          paymentMode: movement.paymentMode,
          reference: movement.reference,
          notes: movement.notes
        }))
      );
    }

    if (include("enquiries")) {
      addSection("Enquiry Summary", [
        {
          total: report.enquiries.total,
          open: report.enquiries.open,
          converted: report.enquiries.converted,
          lost: report.enquiries.lost
        }
      ]);
      addSection("Enquiries By Source", report.enquiries.bySource);
      addSection("Enquiries By Status", report.enquiries.byStatus);
    }

    if (include("jobCards")) {
      addSection("Job Card Summary", [
        {
          total: report.jobCards.total,
          open: report.jobCards.open,
          approvalPending: report.jobCards.approvalPending,
          inProgress: report.jobCards.inProgress,
          completed: report.jobCards.completed,
          billed: report.jobCards.billed,
          cancelled: report.jobCards.cancelled,
          billedRevenue: report.jobCards.billedRevenue,
          averageTurnaroundDays: report.jobCards.averageTurnaroundDays
        }
      ]);
      addSection("Job Cards By Status", report.jobCards.byStatus);
    }

    if (include("profit")) {
      const profit = this.getProfitReport(filter);
      addSection("Profit Summary", [
        {
          range: profit.rangeLabel,
          paidRevenue: profit.paidRevenue,
          stockCost: profit.stockCost,
          expenses: profit.expenseTotal,
          cashProfit: profit.cashProfit,
          marginPercent: profit.profitMargin
        }
      ]);
      addSection("Profit Trend", profit.trend);
      addSection("Expenses By Category", profit.expensesByCategory);
      addSection(
        "Expense Audit",
        profit.expenses.map((expense) => ({
          expenseDate: expense.expenseDate,
          category: expense.category,
          amount: expense.amount,
          paymentMode: expense.paymentMode,
          vendor: expense.vendor,
          reference: expense.reference,
          notes: expense.notes
        }))
      );
    }

    return sections.join("\n\n");
  }

  private rowsToCsv(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return "";
    const first = rows[0];
    if (!first) return "";
    const headers = Object.keys(first);
    return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  }

  private createSchema() {
    this.requireDb().exec(CORE_SCHEMA_SQL);

    for (const column of SCHEMA_COLUMNS) {
      this.addColumnIfMissing(column.table, column.column, column.definition);
    }

    this.ensureLooseQuotationSchema();
    this.normalizeOptionalForeignKeys();
    this.normalizeJobCardInvoiceLinks();
    this.requireDb().run(INVOICES_JOB_CARD_INDEX_SQL);
  }

  private ensureLooseQuotationSchema() {
    const columns = this.select<Row>("PRAGMA table_info(quotations)");
    const customerId = columns.find((row) => rowText(row, "name") === "customerId");
    const vehicleId = columns.find((row) => rowText(row, "name") === "vehicleId");
    const mustRebuild = rowNumber(customerId, "notnull") > 0 || rowNumber(vehicleId, "notnull") > 0;
    if (!mustRebuild) return;

    this.requireDb().run("PRAGMA foreign_keys = OFF");
    this.requireDb().exec(`
      CREATE TABLE IF NOT EXISTS quotations_next (
        id TEXT PRIMARY KEY,
        quotationNumber TEXT NOT NULL UNIQUE,
        quotationStatus TEXT NOT NULL DEFAULT 'draft',
        invoiceMode TEXT NOT NULL,
        taxScope TEXT NOT NULL,
        quotationDate TEXT NOT NULL,
        validUntil TEXT,
        customerId TEXT,
        vehicleId TEXT,
        customerName TEXT,
        customerPhone TEXT,
        customerEmail TEXT,
        customerGstin TEXT,
        customerAddress TEXT,
        vehicleType TEXT NOT NULL DEFAULT 'car',
        vehicleNumber TEXT,
        vehicleMake TEXT,
        vehicleModel TEXT,
        vehicleColor TEXT,
        subTotal REAL NOT NULL,
        discount REAL NOT NULL,
        taxableValue REAL NOT NULL,
        cgst REAL NOT NULL,
        sgst REAL NOT NULL,
        igst REAL NOT NULL,
        totalTax REAL NOT NULL,
        grandTotal REAL NOT NULL,
        notes TEXT,
        convertedInvoiceId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id),
        FOREIGN KEY (vehicleId) REFERENCES vehicles(id),
        FOREIGN KEY (convertedInvoiceId) REFERENCES invoices(id)
      );

      INSERT OR REPLACE INTO quotations_next
        (id, quotationNumber, quotationStatus, invoiceMode, taxScope, quotationDate, validUntil, customerId, vehicleId,
         customerName, customerPhone, customerEmail, customerGstin, customerAddress, vehicleType, vehicleNumber, vehicleMake, vehicleModel, vehicleColor,
         subTotal, discount, taxableValue, cgst, sgst, igst, totalTax, grandTotal, notes, convertedInvoiceId, createdAt, updatedAt)
      SELECT
        q.id,
        q.quotationNumber,
        q.quotationStatus,
        q.invoiceMode,
        q.taxScope,
        q.quotationDate,
        q.validUntil,
        NULLIF(q.customerId, ''),
        NULLIF(q.vehicleId, ''),
        COALESCE(c.name, q.customerName, ''),
        COALESCE(c.phone, q.customerPhone, ''),
        COALESCE(c.email, q.customerEmail, ''),
        COALESCE(c.gstin, q.customerGstin, ''),
        COALESCE(c.address, q.customerAddress, ''),
        COALESCE(v.vehicleType, q.vehicleType, 'car'),
        COALESCE(v.registrationNumber, q.vehicleNumber, ''),
        COALESCE(v.make, q.vehicleMake, ''),
        COALESCE(v.model, q.vehicleModel, ''),
        COALESCE(v.color, q.vehicleColor, ''),
        q.subTotal,
        q.discount,
        q.taxableValue,
        q.cgst,
        q.sgst,
        q.igst,
        q.totalTax,
        q.grandTotal,
        q.notes,
        NULLIF(q.convertedInvoiceId, ''),
        q.createdAt,
        q.updatedAt
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customerId
      LEFT JOIN vehicles v ON v.id = q.vehicleId;

      DROP TABLE quotations;
      ALTER TABLE quotations_next RENAME TO quotations;
    `);
    this.requireDb().run("PRAGMA foreign_keys = ON");
  }

  private normalizeOptionalForeignKeys() {
    this.requireDb().run("UPDATE enquiries SET customerId = NULL WHERE customerId = ''");
    this.requireDb().run("UPDATE enquiries SET vehicleId = NULL WHERE vehicleId = ''");
    this.requireDb().run("UPDATE inventory_batches SET supplierId = NULL WHERE supplierId = ''");
    this.requireDb().run("UPDATE inventory_movements SET batchId = NULL WHERE batchId = ''");
    this.requireDb().run("UPDATE invoice_items SET serviceId = NULL WHERE serviceId = ''");
    this.requireDb().run("UPDATE invoice_items SET inventoryItemId = NULL WHERE inventoryItemId = ''");
    this.requireDb().run("UPDATE quotation_items SET serviceId = NULL WHERE serviceId = ''");
    this.requireDb().run("UPDATE quotation_items SET inventoryItemId = NULL WHERE inventoryItemId = ''");
    this.requireDb().run("UPDATE quotations SET customerId = NULL WHERE customerId = ''");
    this.requireDb().run("UPDATE quotations SET vehicleId = NULL WHERE vehicleId = ''");
    this.requireDb().run("UPDATE quotations SET convertedInvoiceId = NULL WHERE convertedInvoiceId = ''");
    this.requireDb().run("UPDATE job_cards SET invoiceId = NULL WHERE invoiceId = ''");
    this.requireDb().run("UPDATE job_card_items SET serviceId = NULL WHERE serviceId = ''");
    this.requireDb().run("UPDATE job_card_items SET inventoryItemId = NULL WHERE inventoryItemId = ''");
  }

  private seedDefaults() {
    const settings = this.defaultSettings();
    this.writeTransaction(() => {
      this.seedAccessRoles();
      for (const [key, value] of Object.entries(settings)) {
        this.requireDb().run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
      }
      this.requireDb().run("INSERT OR IGNORE INTO job_card_settings (key, value) VALUES ('defaultChecklist', ?)", [
        JSON.stringify(DEFAULT_JOB_CHECKLIST)
      ]);
      this.requireDb().run("INSERT OR IGNORE INTO job_card_settings (key, value) VALUES ('nextJobCardNumber', '1')");
      this.requireDb().run("UPDATE settings SET value = ? WHERE key = 'businessName' AND value = ?", [
        settings.businessName,
        "Autocare24 Car Detailing Studio"
      ]);
      LEGACY_INVOICE_ACCENTS.forEach((legacyAccent) => {
        this.requireDb().run("UPDATE settings SET value = ? WHERE key = 'invoiceAccentColor' AND lower(value) = ?", [
          settings.invoiceAccentColor,
          legacyAccent
        ]);
      });

      const serviceCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM services")[0], "value");
      if (serviceCount === 0) {
        const seededServices = [
          ["Premium Exterior Wash", "Wash", 799, 18, DEFAULT_SAC_CODE],
          ["Interior Deep Cleaning", "Interior", 2499, 18, DEFAULT_SAC_CODE],
          ["Full Vehicle Detailing", "Detailing", 4999, 18, DEFAULT_SAC_CODE],
          ["Paint Correction", "Polishing", 6999, 18, DEFAULT_SAC_CODE],
          ["Ceramic Coating", "Protection", 14999, 18, DEFAULT_SAC_CODE]
        ];

        seededServices.forEach(([name, category, price, gstRate, sacCode]) => {
          this.requireDb().run(
            `INSERT INTO services (id, name, category, defaultPrice, gstRate, sacCode, active, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            [randomUUID(), name, category, price, gstRate, sacCode, nowIso()].map(normalizeParam)
          );
        });
      }

      const inventoryCount = rowNumber(this.select<Row>("SELECT COUNT(*) AS value FROM inventory_items")[0], "value");
      if (inventoryCount === 0) {
        const seededItems = [
          ["Vehicle Shampoo", "consumable", "litre", "Chemical", 0, 18, 2],
          ["APC Cleaner", "consumable", "litre", "Chemical", 0, 18, 2],
          ["Microfiber Towel", "consumable", "piece", "Studio consumable", 0, 18, 10],
          ["Ceramic Coating 30ml", "consumable", "bottle", "Coating", 0, 18, 2],
          ["Dashboard Polish", "retail", "bottle", "Retail", 399, 18, 5]
        ];

        seededItems.forEach(([name, type, unit, category, retailPrice, gstRate, lowStockLevel]) => {
          this.requireDb().run(
            `INSERT INTO inventory_items
              (id, name, type, unit, sku, category, retailPrice, gstRate, lowStockLevel, active, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [
              randomUUID(),
              name,
              type,
              unit,
              "",
              category,
              retailPrice,
              gstRate,
              lowStockLevel,
              nowIso()
            ].map(normalizeParam)
          );
        });
      }
      this.requireDb().run("UPDATE services SET name = ? WHERE name = ?", ["Full Vehicle Detailing", "Full Car Detailing"]);
      this.requireDb().run("UPDATE inventory_items SET name = ? WHERE name = ?", ["Vehicle Shampoo", "Car Shampoo"]);
      this.requireDb().run("UPDATE users SET accessRoleId = ? WHERE role = 'owner' AND (accessRoleId IS NULL OR accessRoleId = '')", [
        OWNER_ACCESS_ROLE_ID
      ]);
      this.requireDb().run("UPDATE users SET accessRoleId = ? WHERE role <> 'owner' AND (accessRoleId IS NULL OR accessRoleId = '')", [
        STAFF_OPERATIONS_ROLE_ID
      ]);
    });
  }

  private seedAccessRoles() {
    const createdAt = nowIso();
    DEFAULT_ACCESS_ROLES.forEach((role) => {
      this.requireDb().run(
        `INSERT OR IGNORE INTO access_roles
          (id, name, description, permissionsJson, locked, active, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          role.id,
          role.name,
          role.description,
          JSON.stringify(role.permissions),
          role.locked ? 1 : 0,
          role.active ? 1 : 0,
          createdAt,
          createdAt
        ]
      );
    });
    const ownerRole = DEFAULT_ACCESS_ROLES.find((role) => role.id === OWNER_ACCESS_ROLE_ID);
    if (ownerRole) {
      this.requireDb().run(
        "UPDATE access_roles SET name = ?, description = ?, permissionsJson = ?, locked = 1, active = 1, updatedAt = ? WHERE id = ?",
        [ownerRole.name, ownerRole.description, JSON.stringify(ALL_PERMISSIONS), createdAt, OWNER_ACCESS_ROLE_ID]
      );
    }
    this.appendRolePermissions(STAFF_OPERATIONS_ROLE_ID, ["quotations.view", "quotations.manage", "quotations.convert"]);
    this.appendRolePermissions("billing-staff", ["quotations.view", "quotations.manage", "quotations.convert"]);
  }

  private appendRolePermissions(roleId: string, permissions: PermissionKey[]) {
    const row = this.select<Row>("SELECT * FROM access_roles WHERE id = ?", [roleId])[0];
    if (!row) return;
    const current = this.parsePermissions(rowText(row, "permissionsJson"));
    const next = Array.from(new Set([...current, ...permissions]));
    if (next.length === current.length) return;
    this.requireDb().run("UPDATE access_roles SET permissionsJson = ?, updatedAt = ? WHERE id = ?", [
      JSON.stringify(next),
      nowIso(),
      roleId
    ]);
  }

  private defaultSettings(): BusinessSettings {
    return {
      businessName: "Autocare24 Bike & Car Detailing Studio",
      address: "",
      phone: "",
      email: "",
      gstin: "",
      state: "Tamil Nadu",
      invoicePrefix: "AC24",
      nextInvoiceNumber: 1,
      quotationPrefix: "QT",
      nextQuotationNumber: 1,
      defaultGstRate: 18,
      defaultTaxScope: "intra",
      invoicePaperSize: "A4",
      backupDirectory: this.getDefaultBackupDirectory(),
      invoiceLogoPath: "",
      invoiceSignaturePath: "",
      invoiceWatermarkPath: "",
      invoiceAccentColor: AUTOCAR24_INVOICE_ACCENT,
      invoiceSecondaryColor: "#111111",
      invoiceFontStyle: "modern",
      invoiceTextSize: "standard",
      invoiceDensity: "standard",
      invoiceLogoSize: "medium",
      invoiceWatermarkOpacity: 0.12,
      invoiceWatermarkPlacement: "bottom-right",
      gstInvoiceTitle: "Tax Invoice",
      simpleReceiptTitle: "Receipt",
      quotationTitle: "Quotation",
      invoiceTerms: "Goods and services once sold are subject to studio policy. Please retain this invoice for service records.",
      invoiceFooterNote: "Thank you for choosing Autocare24.",
      bankName: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankIfsc: "",
      upiId: "",
      signatureLabel: "Authorized signatory",
      showLogo: true,
      showGstin: true,
      showVehicleDetails: true,
      showPaymentDetails: true,
      showTerms: true,
      showSignature: true,
      showBusinessPhone: true,
      showBusinessEmail: true,
      showBusinessAddress: true,
      showCustomerPhone: true,
      showCustomerAddress: true,
      showCustomerGstin: true,
      showInvoiceStatus: true,
      showPaymentMode: true,
      showPaidAmount: true,
      showBalanceDue: true,
      showSacCode: true,
      showItemGstRate: true,
      showFooterContactBar: true,
      showUpiQr: true,
      invoiceNumberLabel: "Invoice No.",
      invoiceDateLabel: "Date",
      quotationNumberLabel: "Quotation No.",
      quotationDateLabel: "Date",
      billToLabel: "Bill To",
      vehicleDetailsLabel: "Vehicle Details",
      paymentDetailsLabel: "Payment Details",
      bankDetailsLabel: "Bank Details",
      termsLabel: "Terms & Conditions",
      subtotalLabel: "Subtotal",
      grandTotalLabel: "Grand Total",
      paidLabel: "Paid",
      balanceDueLabel: "Balance Due",
      paymentInstructions: "",
      googleDriveClientId: "",
      googleDriveClientSecret: ""
    };
  }

  createAutomaticBackupIfNeeded(now = new Date(), options: BackupCreateOptions = {}) {
    return this.createScheduledBackupIfDue(now, options);
  }

  isScheduledBackupDue(now = new Date()) {
    if (now.getHours() < DAILY_BACKUP_HOUR) return "";
    const today = localDate(now);
    const existing = this
      .select<Row>("SELECT createdAt FROM backups WHERE kind = 'auto'")
      .some((row) => {
        const createdAt = rowText(row, "createdAt");
        const createdDate = createdAt ? new Date(createdAt) : null;
        return createdDate && !Number.isNaN(createdDate.getTime()) && localDate(createdDate) === today;
      });
    return existing ? "" : today;
  }

  createScheduledBackupIfDue(now = new Date(), options: BackupCreateOptions = {}) {
    if (!this.isScheduledBackupDue(now)) return "";
    return this.createBackup("auto", options).filePath;
  }

  private backupCloudSnapshotStatusFromRow(row: Row | undefined | null): BackupCloudSnapshotStatus {
    return {
      included: rowNumber(row, "cloudSnapshotIncluded") === 1,
      exportedAt: rowText(row, "cloudSnapshotAt"),
      entityCount: rowNumber(row, "cloudSnapshotEntityCount"),
      recordCount: rowNumber(row, "cloudSnapshotRecordCount"),
      invoiceCount: rowNumber(row, "cloudSnapshotInvoiceCount"),
      error: rowText(row, "cloudSnapshotError")
    };
  }

  private normalizeBackupCloudSnapshot(options: BackupCreateOptions) {
    const status = options.cloudSnapshot?.status || options.cloudSnapshotStatus || emptyBackupCloudSnapshotStatus();
    const data = options.cloudSnapshot?.data || null;
    return {
      data: data && status.included ? data : null,
      status: data && status.included ? status : { ...status, included: false }
    };
  }

  private backupMessage(baseMessage: string, status: BackupCloudSnapshotStatus) {
    if (status.included) return `${baseMessage} Cloud data snapshot included.`;
    if (status.error) return `${baseMessage} Cloud data was not included: ${status.error}`;
    return `${baseMessage} Cloud data was not included.`;
  }

  private createBackup(kind: "auto" | "manual" | "repair", options: BackupCreateOptions = {}) {
    this.save();
    const settings = this.getSettings();
    const directory = settings.backupDirectory || this.getDefaultBackupDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `autocare24-${kind}-backup-${timestampForFile()}${BACKUP_BUNDLE_EXTENSION}`);
    const cloudSnapshot = this.normalizeBackupCloudSnapshot(options);
    this.createBackupBundle(filePath, kind, cloudSnapshot);

    this.runWrite(
      `INSERT INTO backups
       (id, path, kind, cloudSnapshotIncluded, cloudSnapshotAt, cloudSnapshotEntityCount,
        cloudSnapshotRecordCount, cloudSnapshotInvoiceCount, cloudSnapshotError, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        filePath,
        kind,
        cloudSnapshot.status.included ? 1 : 0,
        cloudSnapshot.status.exportedAt,
        cloudSnapshot.status.entityCount,
        cloudSnapshot.status.recordCount,
        cloudSnapshot.status.invoiceCount,
        cloudSnapshot.status.error,
        nowIso()
      ]
    );
    return { filePath, cloudSnapshot: cloudSnapshot.status };
  }

  private createBackupBundle(filePath: string, kind: "auto" | "manual" | "repair", cloudSnapshot: { data: Buffer | null; status: BackupCloudSnapshotStatus }) {
    const includes = [BACKUP_DATABASE_ENTRY, BACKUP_INVOICE_ASSET_ROOT, BACKUP_JOB_CARD_PHOTO_ROOT, BACKUP_PURCHASE_DOCUMENT_ROOT];
    if (cloudSnapshot.data) includes.push(BACKUP_CLOUD_SNAPSHOT_ENTRY);
    const entries: Array<{ name: string; data: Buffer; mtime?: Date }> = [
      {
        name: BACKUP_MANIFEST_ENTRY,
        data: Buffer.from(
          JSON.stringify(
            {
              app: "Autocare24 Billing",
              format: "autocare24-backup-bundle",
              version: 1,
              kind,
              createdAt: nowIso(),
              includes,
              cloudSnapshot: cloudSnapshot.status
            },
            null,
            2
          ),
          "utf8"
        )
      },
      { name: BACKUP_DATABASE_ENTRY, data: fs.readFileSync(this.dbPath) }
    ];

    this.collectBackupFiles(this.invoiceAssetRoot(), BACKUP_INVOICE_ASSET_ROOT).forEach((entry) => entries.push(entry));
    this.collectBackupFiles(this.jobCardPhotoRoot(), BACKUP_JOB_CARD_PHOTO_ROOT).forEach((entry) => entries.push(entry));
    this.collectBackupFiles(this.getPurchaseDocumentRoot(), BACKUP_PURCHASE_DOCUMENT_ROOT).forEach((entry) => entries.push(entry));
    if (cloudSnapshot.data) entries.push({ name: BACKUP_CLOUD_SNAPSHOT_ENTRY, data: cloudSnapshot.data });
    fs.writeFileSync(filePath, zlib.gzipSync(this.createTar(entries)));
  }

  private collectBackupFiles(root: string, bundleRoot: string) {
    const entries: Array<{ name: string; data: Buffer; mtime?: Date }> = [];
    if (!fs.existsSync(root)) return entries;
    const visit = (directory: string) => {
      fs.readdirSync(directory, { withFileTypes: true }).forEach((item) => {
        const fullPath = path.join(directory, item.name);
        if (item.isDirectory()) {
          visit(fullPath);
          return;
        }
        if (!item.isFile()) return;
        const relative = path.relative(root, fullPath).split(path.sep).join("/");
        entries.push({
          name: `${bundleRoot}/${relative}`,
          data: fs.readFileSync(fullPath),
          mtime: fs.statSync(fullPath).mtime
        });
      });
    };
    visit(root);
    return entries;
  }

  private restoreFromBundle(filePath: string): SaveResult {
    if (!this.sql) throw new Error("Database engine is not initialized.");
    const entries = this.readBackupBundle(filePath);
    const databaseEntry = entries.find((entry) => entry.name === BACKUP_DATABASE_ENTRY);
    if (!databaseEntry) throw new Error("Backup bundle does not contain the billing database.");

    const restored = new this.sql.Database(databaseEntry.data);
    const check = restored.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoices'");
    if (!check.length) throw new Error("Selected file is not a valid Autocare24 backup.");

    this.db = restored;
    this.requireDb().run("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.seedDefaults();
    this.restoreBundleAssetFiles(entries);
    this.relinkRestoredAssetPaths();
    this.save();
    return { ok: true, message: "Backup bundle restored successfully.", path: filePath };
  }

  private isBackupBundle(filePath: string) {
    if (path.extname(filePath).toLowerCase() === BACKUP_BUNDLE_EXTENSION) return true;
    if (!fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(2);
      fs.readSync(fd, header, 0, 2, 0);
      return header[0] === 0x1f && header[1] === 0x8b;
    } finally {
      fs.closeSync(fd);
    }
  }

  private readBackupBundle(filePath: string) {
    let uncompressed: Buffer;
    try {
      uncompressed = zlib.gunzipSync(fs.readFileSync(filePath));
    } catch {
      throw new Error("Selected backup bundle is not readable.");
    }
    const entries = this.readTar(uncompressed);
    const manifest = entries.find((entry) => entry.name === BACKUP_MANIFEST_ENTRY);
    if (!manifest) throw new Error("Selected backup bundle is missing its manifest.");
    return entries;
  }

  private restoreBundleAssetFiles(entries: Array<{ name: string; data: Buffer }>) {
    const assetRoot = this.invoiceAssetRoot();
    const photoRoot = this.jobCardPhotoRoot();
    const purchaseDocumentRoot = this.getPurchaseDocumentRoot();
    fs.rmSync(assetRoot, { recursive: true, force: true });
    fs.rmSync(photoRoot, { recursive: true, force: true });
    fs.rmSync(purchaseDocumentRoot, { recursive: true, force: true });

    entries.forEach((entry) => {
      const targetRoot = entry.name.startsWith(`${BACKUP_INVOICE_ASSET_ROOT}/`)
        ? assetRoot
        : entry.name.startsWith(`${BACKUP_JOB_CARD_PHOTO_ROOT}/`)
          ? photoRoot
          : entry.name.startsWith(`${BACKUP_PURCHASE_DOCUMENT_ROOT}/`)
            ? purchaseDocumentRoot
            : "";
      if (!targetRoot) return;
      const rootPrefix = entry.name.startsWith(`${BACKUP_INVOICE_ASSET_ROOT}/`)
        ? BACKUP_INVOICE_ASSET_ROOT
        : entry.name.startsWith(`${BACKUP_JOB_CARD_PHOTO_ROOT}/`)
          ? BACKUP_JOB_CARD_PHOTO_ROOT
          : BACKUP_PURCHASE_DOCUMENT_ROOT;
      const relative = entry.name.slice(rootPrefix.length + 1);
      const target = assertInsideDirectory(targetRoot, path.join(targetRoot, ...relative.split("/")));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data);
    });
  }

  private relinkRestoredAssetPaths() {
    const assetRoot = this.invoiceAssetRoot();
    (["invoiceLogoPath", "invoiceSignaturePath", "invoiceWatermarkPath"] as const).forEach((key) => {
      const row = this.select<Row>("SELECT value FROM settings WHERE key = ?", [key])[0];
      const currentValue = rowText(row, "value");
      if (!currentValue) return;
      const restoredPath = path.join(assetRoot, path.basename(currentValue));
      this.requireDb().run("UPDATE settings SET value = ? WHERE key = ?", [
        fs.existsSync(restoredPath) ? restoredPath : "",
        key
      ]);
    });

    const photoRows = this.select<Row>("SELECT id, jobCardId, path FROM job_card_photos");
    photoRows.forEach((row) => {
      const id = rowText(row, "id");
      const jobCardId = rowText(row, "jobCardId");
      const currentPath = rowText(row, "path");
      if (!id || !jobCardId || !currentPath) return;
      const restoredPath = path.join(this.jobCardPhotoRoot(), jobCardId, path.basename(currentPath));
      this.requireDb().run("UPDATE job_card_photos SET path = ? WHERE id = ?", [
        fs.existsSync(restoredPath) ? restoredPath : "",
        id
      ]);
    });

    const purchaseRows = this.select<Row>("SELECT id, documents FROM purchase_records");
    purchaseRows.forEach((row) => {
      const recordId = rowText(row, "id");
      if (!recordId) return;
      let changed = false;
      let documents: Array<Record<string, unknown>>;
      try {
        documents = JSON.parse(rowText(row, "documents") || "[]");
      } catch {
        documents = [];
      }
      const nextDocuments = documents.map((document) => {
        const fileId = String(document.fileId || document.id || "");
        const originalName = String(document.originalName || "");
        const currentLocalPath = String(document.localPath || "");
        const extension = path.extname(currentLocalPath || originalName).toLowerCase();
        if (!fileId || !extension) return document;
        const restoredPath = path.join(this.getPurchaseDocumentRoot(), recordId, `${fileId}${extension}`);
        if (!fs.existsSync(restoredPath)) return document;
        if (currentLocalPath === restoredPath) return document;
        changed = true;
        return { ...document, localPath: restoredPath };
      });
      if (changed) {
        this.requireDb().run("UPDATE purchase_records SET documents = ? WHERE id = ?", [
          JSON.stringify(nextDocuments),
          recordId
        ]);
      }
    });
  }

  private createTar(entries: Array<{ name: string; data: Buffer; mtime?: Date }>) {
    const chunks: Buffer[] = [];
    entries.forEach((entry) => {
      const safeName = this.safeTarName(entry.name);
      const header = this.createTarHeader(safeName, entry.data.length, entry.mtime || new Date());
      chunks.push(header, entry.data);
      const padding = (512 - (entry.data.length % 512)) % 512;
      if (padding) chunks.push(Buffer.alloc(padding));
    });
    chunks.push(Buffer.alloc(1024));
    return Buffer.concat(chunks);
  }

  private createTarHeader(name: string, size: number, mtime: Date) {
    const header = Buffer.alloc(512);
    const { entryName, prefix } = this.splitTarName(name);
    this.writeTarString(header, 0, 100, entryName);
    this.writeTarOctal(header, 100, 8, 0o644);
    this.writeTarOctal(header, 108, 8, 0);
    this.writeTarOctal(header, 116, 8, 0);
    this.writeTarOctal(header, 124, 12, size);
    this.writeTarOctal(header, 136, 12, Math.floor(mtime.getTime() / 1000));
    header.fill(0x20, 148, 156);
    this.writeTarString(header, 156, 1, "0");
    this.writeTarString(header, 257, 6, "ustar");
    this.writeTarString(header, 263, 2, "00");
    this.writeTarString(header, 345, 155, prefix);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    const checksumValue = checksum.toString(8).padStart(6, "0");
    header.write(checksumValue, 148, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    return header;
  }

  private readTar(buffer: Buffer) {
    const entries: Array<{ name: string; data: Buffer }> = [];
    let offset = 0;
    while (offset + 512 <= buffer.length) {
      const header = buffer.subarray(offset, offset + 512);
      if (header.every((value) => value === 0)) break;
      const entryName = this.readTarString(header, 0, 100);
      const prefix = this.readTarString(header, 345, 155);
      const name = this.safeTarName(prefix ? `${prefix}/${entryName}` : entryName);
      const sizeText = this.readTarString(header, 124, 12).trim();
      const size = Number.parseInt(sizeText || "0", 8) || 0;
      const type = this.readTarString(header, 156, 1);
      const dataStart = offset + 512;
      const dataEnd = dataStart + size;
      if (!type || type === "0") entries.push({ name, data: Buffer.from(buffer.subarray(dataStart, dataEnd)) });
      offset = dataStart + Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  private splitTarName(name: string) {
    if (Buffer.byteLength(name) <= 100) return { entryName: name, prefix: "" };
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join("/");
      const entryName = parts.slice(index).join("/");
      if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(entryName) <= 100) return { entryName, prefix };
    }
    throw new Error(`Backup file path is too long: ${name}`);
  }

  private safeTarName(name: string) {
    const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.split("/").includes("..") || /^[a-zA-Z]:/.test(normalized)) {
      throw new Error("Backup bundle contains an unsafe file path.");
    }
    return normalized;
  }

  private writeTarString(header: Buffer, offset: number, length: number, value: string) {
    header.write(value.slice(0, length), offset, length, "utf8");
  }

  private writeTarOctal(header: Buffer, offset: number, length: number, value: number) {
    const text = value.toString(8).padStart(length - 1, "0");
    header.write(text.slice(-(length - 1)), offset, length - 1, "ascii");
    header[offset + length - 1] = 0;
  }

  private readTarString(header: Buffer, offset: number, length: number) {
    return header.toString("utf8", offset, offset + length).replace(/\0.*$/, "");
  }

  private getIntegrityStatus() {
    const result = this.requireDb().exec("PRAGMA integrity_check");
    return String(result[0]?.values?.[0]?.[0] ?? "unknown");
  }

  private getForeignKeyIssues() {
    const result = this.requireDb().exec("PRAGMA foreign_key_check");
    return (result[0]?.values ?? []).map((row) => `table=${row[0]}, row=${row[1]}, parent=${row[2]}, fk=${row[3]}`);
  }

  private getCount(sql: string, params: unknown[] = []) {
    return rowNumber(this.select<Row>(sql, params)[0], "value");
  }

  private missingDefaultSettingKeys() {
    const defaults = this.defaultSettings();
    const existing = new Set(this.select<Row>("SELECT key FROM settings").map((row) => rowText(row, "key")));
    return Object.keys(defaults).filter((key) => !existing.has(key));
  }

  private restoreMissingDefaultSettings() {
    const defaults = this.defaultSettings();
    const missing = this.missingDefaultSettingKeys();
    if (!missing.length) return 0;
    this.writeTransaction(() => {
      missing.forEach((key) => {
        this.requireDb().run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [
          key,
          String(defaults[key as keyof BusinessSettings] ?? "")
        ]);
      });
    });
    return missing.length;
  }

  private getBrokenLogoIssue(): DataHealthIssue | null {
    const logoPath = this.getSettings().invoiceLogoPath;
    if (!logoPath || fs.existsSync(logoPath)) return null;
    return {
      id: "broken-logo-path",
      code: "broken_logo_path",
      title: "Invoice logo file missing",
      severity: "warning",
      message: "The saved invoice logo path points to a file that is not available.",
      count: 1,
      repairable: true,
      repairCode: "clear_broken_logo_path",
      details: [logoPath]
    };
  }

  private clearBrokenLogoPath() {
    const logoPath = this.getSettings().invoiceLogoPath;
    if (!logoPath || fs.existsSync(logoPath)) return 0;
    this.saveSettings({ invoiceLogoPath: "" });
    return 1;
  }

  private getJobCardInvoiceLinkIssues(): DataHealthIssue[] {
    const duplicateCount = this.getCount(
      `SELECT COUNT(*) AS value FROM (
         SELECT jobCardId FROM invoices
         WHERE jobCardId IS NOT NULL AND jobCardId <> ''
         GROUP BY jobCardId HAVING COUNT(*) > 1
       )`
    );
    const invalidInvoiceLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM invoices i
       LEFT JOIN job_cards jc ON jc.id = i.jobCardId
       WHERE i.jobCardId IS NOT NULL AND i.jobCardId <> '' AND jc.id IS NULL`
    );
    const invalidJobCardLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM job_cards jc
       LEFT JOIN invoices i ON i.id = jc.invoiceId
       WHERE jc.invoiceId IS NOT NULL AND jc.invoiceId <> '' AND i.id IS NULL`
    );
    const mismatchedLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM job_cards jc
       JOIN invoices i ON i.id = jc.invoiceId
       WHERE jc.invoiceId IS NOT NULL AND jc.invoiceId <> ''
         AND COALESCE(i.jobCardId, '') <> jc.id`
    );
    const count = duplicateCount + invalidInvoiceLinks + invalidJobCardLinks + mismatchedLinks;
    if (!count) return [];
    return [
      {
        id: "job-card-invoice-links",
        code: "job_card_invoice_links",
        title: "Job card invoice link issue",
        severity: "warning",
        message: "Some job cards and invoices have duplicate, missing, or mismatched links.",
        count,
        repairable: true,
        repairCode: "clean_job_card_invoice_links",
        details: [
          `Duplicate invoice job-card links: ${duplicateCount}`,
          `Invoices pointing to missing job cards: ${invalidInvoiceLinks}`,
          `Job cards pointing to missing invoices: ${invalidJobCardLinks}`,
          `Mismatched invoice/job-card pairs: ${mismatchedLinks}`
        ]
      }
    ];
  }

  private getOptionalItemLinkIssue(): DataHealthIssue | null {
    const blankServiceLinks = this.getCount(
      "SELECT COUNT(*) AS value FROM job_card_items WHERE serviceId = ''"
    );
    const blankInventoryLinks = this.getCount(
      "SELECT COUNT(*) AS value FROM job_card_items WHERE inventoryItemId = ''"
    );
    const missingServiceLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM job_card_items jci
       LEFT JOIN services s ON s.id = jci.serviceId
       WHERE jci.serviceId IS NOT NULL AND jci.serviceId <> '' AND s.id IS NULL`
    );
    const missingInventoryLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM job_card_items jci
       LEFT JOIN inventory_items ii ON ii.id = jci.inventoryItemId
       WHERE jci.inventoryItemId IS NOT NULL AND jci.inventoryItemId <> '' AND ii.id IS NULL`
    );
    const count = blankServiceLinks + blankInventoryLinks + missingServiceLinks + missingInventoryLinks;
    if (!count) return null;
    return {
      id: "optional-item-links",
      code: "optional_item_links",
      title: "Optional service or stock line links need cleanup",
      severity: "warning",
      message: "Some job-card estimate lines have blank or missing optional service/stock links. The line description and amount will stay unchanged.",
      count,
      repairable: true,
      repairCode: "clean_optional_item_links",
      details: [
        `Blank service links: ${blankServiceLinks}`,
        `Blank stock links: ${blankInventoryLinks}`,
        `Missing service links: ${missingServiceLinks}`,
        `Missing stock links: ${missingInventoryLinks}`
      ]
    };
  }

  private cleanOptionalItemLinks() {
    let changed = 0;
    const blankRows = this.getCount(
      `SELECT COUNT(*) AS value FROM job_card_items
       WHERE serviceId = '' OR inventoryItemId = ''`
    );
    this.requireDb().run(
      `UPDATE job_card_items
       SET serviceId = CASE WHEN serviceId = '' THEN NULL ELSE serviceId END,
           inventoryItemId = CASE WHEN inventoryItemId = '' THEN NULL ELSE inventoryItemId END
       WHERE serviceId = '' OR inventoryItemId = ''`
    );
    changed += blankRows;

    const missingServiceRows = this.select<Row>(
      `SELECT jci.id
       FROM job_card_items jci
       LEFT JOIN services s ON s.id = jci.serviceId
       WHERE jci.serviceId IS NOT NULL AND jci.serviceId <> '' AND s.id IS NULL`
    );
    missingServiceRows.forEach((row) => {
      this.requireDb().run("UPDATE job_card_items SET serviceId = NULL WHERE id = ?", [rowText(row, "id")]);
      changed += 1;
    });

    const missingInventoryRows = this.select<Row>(
      `SELECT jci.id
       FROM job_card_items jci
       LEFT JOIN inventory_items ii ON ii.id = jci.inventoryItemId
       WHERE jci.inventoryItemId IS NOT NULL AND jci.inventoryItemId <> '' AND ii.id IS NULL`
    );
    missingInventoryRows.forEach((row) => {
      this.requireDb().run("UPDATE job_card_items SET inventoryItemId = NULL WHERE id = ?", [rowText(row, "id")]);
      changed += 1;
    });

    return changed;
  }

  private getMissingCustomerVehicleLinkCount() {
    const invoiceLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customerId
       LEFT JOIN vehicles v ON v.id = i.vehicleId
       WHERE c.id IS NULL OR v.id IS NULL`
    );
    const jobCardLinks = this.getCount(
      `SELECT COUNT(*) AS value
       FROM job_cards jc
       LEFT JOIN customers c ON c.id = jc.customerId
       LEFT JOIN vehicles v ON v.id = jc.vehicleId
       WHERE c.id IS NULL OR v.id IS NULL`
    );
    return invoiceLinks + jobCardLinks;
  }

  private getJobCardPhotoIssues(): DataHealthIssue {
    const orphanRows = this.select<Row>(
      `SELECT jp.path FROM job_card_photos jp
       LEFT JOIN job_cards jc ON jc.id = jp.jobCardId
       WHERE jc.id IS NULL`
    );
    const rows = this.select<Row>("SELECT path FROM job_card_photos");
    const missingFiles = rows.map((row) => rowText(row, "path")).filter((filePath) => filePath && !fs.existsSync(filePath));
    return {
      id: "job-card-photo-issues",
      code: "job_card_photo_issues",
      title: "Job card photo issue",
      severity: "warning",
      message: "Some job-card photo records are orphaned or point to missing files.",
      count: orphanRows.length + missingFiles.length,
      repairable: false,
      details: [
        `Orphan photo records: ${orphanRows.length}`,
        `Missing photo files: ${missingFiles.length}`,
        ...missingFiles.slice(0, 8)
      ]
    };
  }

  private validateInvoice(input: InvoiceCreateInput) {
    if (!input.customer?.name?.trim()) throw new Error("Customer name is required.");
    if (!input.vehicle?.registrationNumber?.trim()) throw new Error("Vehicle number is required.");
    if (!Array.isArray(input.items) || !input.items.length) throw new Error("Add at least one service item.");
    const normalizedMode: InvoiceMode = input.invoiceMode === "gst" ? "gst" : "simple";
    let subTotal = 0;
    input.items.forEach((item) => {
      if (!String(item.description ?? "").trim()) throw new Error("Every invoice item needs a description.");
      const quantity = positiveNumber(item.quantity, "Item quantity");
      const unitPrice = nonNegativeNumber(item.unitPrice, "Item price");
      if (normalizedMode === "gst") nonNegativeNumber(item.gstRate, "GST rate");
      subTotal += quantity * unitPrice;
    });
    const discount = nonNegativeNumber(input.discount ?? 0, "Discount");
    if (discount > subTotal) throw new Error("Discount cannot be greater than subtotal.");
    nonNegativeNumber(input.paidAmount ?? 0, "Paid amount");
  }

  private normalizeQuotationDraftItems(items: QuotationItemInput[]) {
    return (Array.isArray(items) ? items : [])
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
        quantity: money(Math.max(0, finiteNumber(item.quantity ?? 0, "Item quantity"))),
        unitPrice: money(Math.max(0, finiteNumber(item.unitPrice ?? 0, "Item price"))),
        gstRate: money(Math.max(0, finiteNumber(item.gstRate ?? 0, "GST rate"))),
        sacCode: normalizeSacCode(item.sacCode)
      }));
  }

  private calculateInvoice(
    invoiceMode: InvoiceMode,
    taxScope: TaxScope,
    items: InvoiceItemInput[],
    rawDiscount: number
  ) {
    return calculateInvoiceTotals(invoiceMode, taxScope, items, rawDiscount);
  }

  private deductInvoiceInventory(
    invoiceId: string,
    items: Array<InvoiceItemInput & { quantity: number; unitPrice: number }>,
    invoiceNumber: string,
    invoiceDate: string
  ) {
    items.forEach((item) => {
      if (item.inventoryItemId) {
        this.deductInventory(
          item.inventoryItemId,
          item.quantity,
          "sale",
          invoiceNumber,
          `Retail sale on invoice ${invoiceNumber}`,
          invoiceDate
        );
      }

      if (item.serviceId) {
        const recipe = this.getServiceConsumables(item.serviceId);
        recipe.forEach((row) => {
          this.deductInventory(
            row.inventoryItemId,
            money(row.quantity * item.quantity),
            "usage",
            invoiceNumber,
            `Auto usage for ${item.description}`,
            invoiceDate
          );
        });
      }
    });

    this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      `inventoryDeducted:${invoiceId}`,
      "true"
    ]);
  }

  private assertInvoiceInventoryAvailable(items: Array<InvoiceItemInput & { quantity: number }>) {
    const required = new Map<string, number>();
    const addRequired = (itemId: string, quantity: number) => {
      if (!itemId || quantity <= 0) return;
      required.set(itemId, money((required.get(itemId) || 0) + quantity));
    };
    items.forEach((item) => {
      if (item.inventoryItemId) addRequired(item.inventoryItemId, item.quantity);
      if (item.serviceId) {
        this.getServiceConsumables(item.serviceId).forEach((row) => addRequired(row.inventoryItemId, money(row.quantity * item.quantity)));
      }
    });
    required.forEach((quantity, itemId) => {
      const available = money(
        this.select<Row>(
          `SELECT COALESCE(SUM(quantityRemaining), 0) AS value
           FROM inventory_batches
           WHERE itemId = ? AND quantityRemaining > 0`,
          [itemId]
        ).reduce((sum, row) => sum + rowNumber(row, "value"), 0)
      );
      if (available < quantity) {
        const item = this.mapInventoryItem(this.select<Row>(this.inventoryItemsSql("WHERE ii.id = ?"), [itemId])[0]);
        throw new Error(`Insufficient stock for ${item.name}. Available ${available} ${item.unit}, required ${quantity} ${item.unit}.`);
      }
    });
  }

  private reverseInvoiceInventory(invoice: InvoiceDetail) {
    const movements = this.select<Row>(
      "SELECT * FROM inventory_movements WHERE reference = ? AND type IN ('sale', 'usage') ORDER BY createdAt ASC",
      [invoice.invoiceNumber]
    );
    movements.forEach((row) => {
      const batchId = rowText(row, "batchId");
      const itemId = rowText(row, "itemId");
      const quantity = money(rowNumber(row, "quantity"));
      if (!batchId || !itemId || quantity <= 0) return;
      this.requireDb().run("UPDATE inventory_batches SET quantityRemaining = quantityRemaining + ? WHERE id = ?", [
        quantity,
        batchId
      ]);
      this.insertInventoryMovement({
        itemId,
        batchId,
        type: "invoice_cancel_reversal",
        quantity,
        unitCost: rowNumber(row, "unitCost"),
        reference: invoice.invoiceNumber,
        notes: `Stock reversal for cancelled invoice ${invoice.invoiceNumber}`,
        movementDate: localDate()
      });
    });

    this.requireDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      `inventoryDeducted:${invoice.id}`,
      "cancelled"
    ]);
  }

  private deductInventory(
    itemId: string,
    quantity: number,
    type: InventoryMovementType,
    reference: string,
    notes: string,
    movementDate: string,
    sale?: { saleAmount: number; paymentMode: PaymentMode | "" }
  ) {
    let remaining = money(quantity);
    let remainingSaleAmount = money(sale?.saleAmount || 0);
    const batches = this.select<Row>(
      `SELECT * FROM inventory_batches
       WHERE itemId = ? AND quantityRemaining > 0
       ORDER BY expiryDate = '', expiryDate ASC, purchaseDate ASC, createdAt ASC`,
      [itemId]
    ).map(this.mapInventoryBatch);

    const available = money(batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0));
    if (available < remaining) {
      const item = this.mapInventoryItem(this.select<Row>(this.inventoryItemsSql("WHERE ii.id = ?"), [itemId])[0]);
      throw new Error(`Insufficient stock for ${item.name}. Available ${available} ${item.unit}, required ${remaining} ${item.unit}.`);
    }

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      if (remaining <= 0) break;
      if (!batch) continue;
      const used = money(Math.min(batch.quantityRemaining, remaining));
      remaining = money(remaining - used);
      const saleAmount = sale
        ? money(remaining <= 0 ? remainingSaleAmount : Math.min(remainingSaleAmount, money((sale.saleAmount * used) / quantity)))
        : 0;
      remainingSaleAmount = money(remainingSaleAmount - saleAmount);
      this.requireDb().run("UPDATE inventory_batches SET quantityRemaining = quantityRemaining - ? WHERE id = ?", [
        used,
        batch.id
      ]);
      this.insertInventoryMovement({
        itemId,
        batchId: batch.id,
        type,
        quantity: used,
        unitCost: batch.unitCost,
        saleAmount,
        saleUnitPrice: used > 0 ? money(saleAmount / used) : 0,
        paymentMode: sale?.paymentMode || "",
        reference,
        notes,
        movementDate
      });
    }
  }

  private insertInventoryMovement(input: {
    itemId: string;
    batchId: string;
    type: InventoryMovementType;
    quantity: number;
    unitCost: number;
    saleAmount?: number;
    saleUnitPrice?: number;
    paymentMode?: PaymentMode | "";
    reference: string;
    notes: string;
    movementDate: string;
  }) {
    this.requireDb().run(
      `INSERT INTO inventory_movements
        (id, itemId, batchId, type, quantity, unitCost, saleAmount, saleUnitPrice, paymentMode, reference, notes, movementDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.itemId,
        input.batchId,
        input.type,
        money(input.quantity),
        money(input.unitCost),
        money(input.saleAmount || 0),
        money(input.saleUnitPrice || 0),
        input.paymentMode || "",
        input.reference,
        input.notes,
        input.movementDate,
        nowIso()
      ].map(normalizeParam)
    );
  }

  private getWritableBatch(itemId: string): InventoryBatch | undefined {
    return this.select<Row>(
      `SELECT * FROM inventory_batches
       WHERE itemId = ?
       ORDER BY expiryDate = '', expiryDate ASC, purchaseDate ASC, createdAt ASC
       LIMIT 1`,
      [itemId]
    ).map(this.mapInventoryBatch)[0];
  }

  private saveSupplierInTransaction(input: Partial<Supplier> & Pick<Supplier, "name">): Supplier {
    const id = input.id || randomUUID();
    const existing = input.id ? this.select<Row>("SELECT * FROM suppliers WHERE id = ?", [input.id])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Supplier name");
    this.requireDb().run(
      `INSERT OR REPLACE INTO suppliers (id, name, phone, gstin, address, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.phone?.trim() || "",
        input.gstin?.trim() || "",
        input.address?.trim() || "",
        createdAt
      ].map(normalizeParam)
    );
    return this.mapSupplier(this.select<Row>("SELECT * FROM suppliers WHERE id = ?", [id])[0]);
  }

  private paymentStatus(total: number, paid: number): PaymentStatus {
    if (paid <= 0) return "unpaid";
    if (paid >= total) return "paid";
    return "partial";
  }

  private normalizePaymentMode(value: unknown): PaymentMode {
    const mode = String(value || "Cash").trim();
    return ["Cash", "UPI", "Card", "Bank Transfer", "Other"].includes(mode) ? (mode as PaymentMode) : "Cash";
  }

  private saveCustomerInTransaction(customerId: string | undefined, input: InvoiceCreateInput["customer"]): Customer {
    const id = customerId || randomUUID();
    const existing = customerId ? this.select<Row>("SELECT * FROM customers WHERE id = ?", [customerId])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const name = requiredText(input.name, "Customer name");
    this.requireDb().run(
      `INSERT OR REPLACE INTO customers (id, name, phone, email, gstin, address, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.phone?.trim() || "",
        input.email?.trim() || "",
        input.gstin?.trim() || "",
        input.address?.trim() || "",
        createdAt
      ].map(normalizeParam)
    );
    return this.mapCustomer(this.select<Row>("SELECT * FROM customers WHERE id = ?", [id])[0]);
  }

  private saveVehicleInTransaction(
    vehicleId: string | undefined,
    customerId: string,
    input: InvoiceCreateInput["vehicle"]
  ): Vehicle {
    const id = vehicleId || randomUUID();
    const existing = vehicleId ? this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [vehicleId])[0] : undefined;
    const createdAt = rowText(existing || {}, "createdAt") || nowIso();
    const registrationNumber = requiredText(input.registrationNumber, "Vehicle number").toUpperCase();
    this.requireDb().run(
      `INSERT OR REPLACE INTO vehicles (id, customerId, vehicleType, registrationNumber, make, model, color, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        customerId,
        this.normalizeVehicleType(input.vehicleType),
        registrationNumber,
        input.make?.trim() || "",
        input.model?.trim() || "",
        input.color?.trim() || "",
        createdAt
      ].map(normalizeParam)
    );
    return this.mapVehicle(this.select<Row>("SELECT * FROM vehicles WHERE id = ?", [id])[0]);
  }

  private createDraftFromInvoice(invoice: InvoiceDetail, correctionType: InvoiceDraftCorrectionType): InvoiceDraftSaveInput {
    return {
      name: `${correctionType === "replacement" ? "Replacement for" : "Draft from"} ${invoice.invoiceNumber}`,
      sourceInvoiceId: invoice.id,
      correctionType,
      payload: {
        invoiceMode: invoice.invoiceMode,
        taxScope: invoice.taxScope,
        invoiceDate: localDate(),
        sourceInvoiceId: invoice.id,
        selectedCustomerId: invoice.customerId,
        selectedVehicleId: invoice.vehicleId,
        customerId: invoice.customerId,
        vehicleId: invoice.vehicleId,
        customer: invoice.customer,
        vehicle: invoice.vehicle,
        items: invoice.items.map(({ id: _id, invoiceId: _invoiceId, lineSubTotal: _lineSubTotal, lineTax: _lineTax, lineTotal: _lineTotal, ...item }) => item),
        discount: invoice.discount,
        paidAmount: 0,
        paymentMode: invoice.paymentMode,
        paymentReference: "",
        notes: invoice.notes
      }
    };
  }

  private invoiceDraftName(payload: InvoiceDraftPayload, correctionType: InvoiceDraftCorrectionType) {
    const customerName = payload.customer?.name?.trim() || "New customer";
    if (correctionType === "addon") return `Add-on draft - ${customerName}`;
    if (correctionType === "replacement") return `Replacement draft - ${customerName}`;
    return `Draft bill - ${customerName}`;
  }

  private allocateNextInvoiceNumber(settings: BusinessSettings) {
    const prefix = settings.invoicePrefix.trim() || "AC24";
    let nextNumber = Math.max(1, Math.floor(Number(settings.nextInvoiceNumber) || 1));
    const existingNumbers = this.select<Row>("SELECT invoiceNumber FROM invoices").map((row) => rowText(row, "invoiceNumber"));
    const usedNumbers = new Set(existingNumbers);
    const prefixToken = `${prefix}-`;

    existingNumbers.forEach((invoiceNumber) => {
      if (!invoiceNumber.startsWith(prefixToken)) return;
      const suffix = invoiceNumber.slice(prefixToken.length);
      if (!/^\d+$/.test(suffix)) return;
      nextNumber = Math.max(nextNumber, Number(suffix) + 1);
    });

    let invoiceNumber = `${prefix}-${String(nextNumber).padStart(5, "0")}`;
    while (usedNumbers.has(invoiceNumber)) {
      nextNumber += 1;
      invoiceNumber = `${prefix}-${String(nextNumber).padStart(5, "0")}`;
    }

    return {
      invoiceNumber,
      nextInvoiceNumber: nextNumber + 1
    };
  }

  private allocateNextQuotationNumber(settings: BusinessSettings) {
    const prefix = settings.quotationPrefix.trim() || "QT";
    let nextNumber = Math.max(1, Math.floor(Number(settings.nextQuotationNumber) || 1));
    const existingNumbers = this.select<Row>("SELECT quotationNumber FROM quotations").map((row) => rowText(row, "quotationNumber"));
    const usedNumbers = new Set(existingNumbers);
    const prefixToken = `${prefix}-`;

    existingNumbers.forEach((quotationNumber) => {
      if (!quotationNumber.startsWith(prefixToken)) return;
      const suffix = quotationNumber.slice(prefixToken.length);
      if (!/^\d+$/.test(suffix)) return;
      nextNumber = Math.max(nextNumber, Number(suffix) + 1);
    });

    let quotationNumber = `${prefix}-${String(nextNumber).padStart(5, "0")}`;
    while (usedNumbers.has(quotationNumber)) {
      nextNumber += 1;
      quotationNumber = `${prefix}-${String(nextNumber).padStart(5, "0")}`;
    }

    return {
      quotationNumber,
      nextQuotationNumber: nextNumber + 1
    };
  }

  private normalizeAppendInvoiceItem(item: InvoiceItemInput, invoiceMode: InvoiceMode): InvoiceItemInput {
    const description = String(item.description ?? "").trim();
    if (!description) throw new Error("Item description is required.");
    return {
      serviceId: item.serviceId || "",
      inventoryItemId: item.inventoryItemId || "",
      description,
      quantity: money(positiveNumber(item.quantity, "Item quantity")),
      unitPrice: money(nonNegativeNumber(item.unitPrice, "Item price")),
      gstRate: invoiceMode === "gst" ? money(nonNegativeNumber(item.gstRate ?? 0, "GST rate")) : 0,
      sacCode: normalizeSacCode(item.sacCode)
    };
  }

  private insertInvoiceItem(
    invoiceId: string,
    item: InvoiceItemInput & { lineSubTotal: number; lineTax: number; lineTotal: number }
  ) {
    this.requireDb().run(
      `INSERT INTO invoice_items
        (id, invoiceId, serviceId, inventoryItemId, description, quantity, unitPrice, gstRate, sacCode, lineSubTotal, lineTax, lineTotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        invoiceId,
        item.serviceId || null,
        item.inventoryItemId || null,
        item.description,
        item.quantity,
        item.unitPrice,
        item.gstRate,
        item.sacCode,
        item.lineSubTotal,
        item.lineTax,
        item.lineTotal
      ].map(normalizeParam)
    );
  }

  private insertQuotationItem(
    quotationId: string,
    item: QuotationItemInput & { lineSubTotal: number; lineTax: number; lineTotal: number }
  ) {
    this.requireDb().run(
      `INSERT INTO quotation_items
        (id, quotationId, serviceId, inventoryItemId, description, quantity, unitPrice, gstRate, sacCode, lineSubTotal, lineTax, lineTotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        quotationId,
        item.serviceId || null,
        item.inventoryItemId || null,
        item.description,
        item.quantity,
        item.unitPrice,
        item.gstRate,
        item.sacCode,
        item.lineSubTotal,
        item.lineTax,
        item.lineTotal
      ].map(normalizeParam)
    );
  }

  private validateJobCardItems(items: JobCardItemInput[], rawDiscount: number) {
    let subTotal = 0;
    items.forEach((item) => {
      if (!String(item.description ?? "").trim()) throw new Error("Every estimate line needs a description.");
      const quantity = positiveNumber(item.quantity, "Estimate quantity");
      const unitPrice = nonNegativeNumber(item.unitPrice, "Estimate price");
      nonNegativeNumber(item.gstRate, "Estimate GST rate");
      subTotal += quantity * unitPrice;
    });
    const discount = nonNegativeNumber(rawDiscount ?? 0, "Estimate discount");
    if (discount > subTotal) throw new Error("Estimate discount cannot be greater than subtotal.");
  }

  private calculateJobCard(items: JobCardItemInput[], rawDiscount: number) {
    const normalized = items.map((item) => ({
      ...item,
      description: String(item.description ?? "").trim(),
      quantity: money(finiteNumber(item.quantity, "Estimate quantity")),
      unitPrice: money(finiteNumber(item.unitPrice, "Estimate price")),
      gstRate: money(finiteNumber(item.gstRate ?? 0, "Estimate GST rate")),
      sacCode: normalizeSacCode(item.sacCode),
      lineSubTotal: money(finiteNumber(item.quantity, "Estimate quantity") * finiteNumber(item.unitPrice, "Estimate price"))
    }));
    const subTotal = money(normalized.reduce((sum, item) => sum + item.lineSubTotal, 0));
    const discount = money(Math.min(Math.max(finiteNumber(rawDiscount, "Estimate discount"), 0), subTotal));
    const discountRatio = subTotal > 0 ? discount / subTotal : 0;
    const taxableValue = money(subTotal - discount);
    const calculatedItems = normalized.map((item) => {
      const lineTaxable = money(item.lineSubTotal * (1 - discountRatio));
      const lineTax = money((lineTaxable * item.gstRate) / 100);
      return { ...item, lineTax, lineTotal: money(lineTaxable + lineTax) };
    });
    const totalTax = money(calculatedItems.reduce((sum, item) => sum + item.lineTax, 0));
    return { items: calculatedItems, subTotal, discount, taxableValue, totalTax, grandTotal: money(taxableValue + totalTax) };
  }

  private insertJobCardItem(jobCardId: string, item: JobCardItemInput & { lineSubTotal: number; lineTax: number; lineTotal: number }) {
    this.requireDb().run(
      `INSERT INTO job_card_items
        (id, jobCardId, serviceId, inventoryItemId, description, quantity, unitPrice, gstRate, sacCode, lineSubTotal, lineTax, lineTotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        jobCardId,
        item.serviceId || null,
        item.inventoryItemId || null,
        item.description,
        item.quantity,
        item.unitPrice,
        item.gstRate,
        item.sacCode,
        item.lineSubTotal,
        item.lineTax,
        item.lineTotal
      ].map(normalizeParam)
    );
  }

  private seedJobCardChecklist(jobCardId: string) {
    this.getDefaultJobChecklist().forEach((label, index) => {
      this.requireDb().run(
        `INSERT INTO job_card_checklist_items (id, jobCardId, label, checked, sortOrder, createdAt)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [randomUUID(), jobCardId, label, index, nowIso()].map(normalizeParam)
      );
    });
  }

  private insertJobCardHistory(jobCardId: string, status: JobCardStatus, note: string) {
    this.requireDb().run(
      `INSERT INTO job_card_status_history (id, jobCardId, status, note, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), jobCardId, status, note, nowIso()].map(normalizeParam)
    );
  }

  private getDefaultJobChecklist() {
    const row = this.select<Row>("SELECT value FROM job_card_settings WHERE key = 'defaultChecklist'")[0];
    if (!row) return DEFAULT_JOB_CHECKLIST;
    try {
      const parsed = JSON.parse(rowText(row, "value"));
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : DEFAULT_JOB_CHECKLIST;
    } catch {
      return DEFAULT_JOB_CHECKLIST;
    }
  }

  private getJobCardReport(filter: ReportFilterInput): JobCardReportData {
    const { where, params } = this.rangeClause(filter, "jc.jobDate");
    const invoiceRange = this.rangeClause(filter, "i.invoiceDate");
    const rows = this.select<Row>(`${this.jobCardSummarySql()} ${where}`, params).map(this.mapJobCardSummary);
    const byStatus = this.select<Row>(
      `SELECT status, COUNT(*) AS count FROM job_cards jc ${where} GROUP BY status ORDER BY count DESC`,
      params
    ).map((row) => ({ status: this.normalizeJobCardStatus(rowText(row, "status")), count: rowNumber(row, "count") }));
    const billedRevenue = rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(i.grandTotal), 0) AS value
         FROM invoices i
         JOIN job_cards jc ON jc.id = i.jobCardId
          ${invoiceRange.where ? `${invoiceRange.where} AND i.invoiceStatus <> 'cancelled'` : "WHERE i.invoiceStatus <> 'cancelled'"}`,
        invoiceRange.params
      )[0],
      "value"
    );
    const completed = rows.filter((row) => ["delivered", "billed"].includes(row.status));
    const turnaroundDays = completed
      .filter((row) => row.actualDeliveryDate && row.jobDate)
      .map((row) => {
        const start = new Date(`${row.jobDate}T00:00:00`).getTime();
        const end = new Date(`${row.actualDeliveryDate}T00:00:00`).getTime();
        return Math.max(0, Math.round((end - start) / 86400000));
      })
      .filter((value) => value >= 0);

    return {
      total: rows.length,
      open: rows.filter((row) => !["delivered", "billed", "cancelled"].includes(row.status)).length,
      approvalPending: rows.filter((row) => row.status === "estimate_pending").length,
      inProgress: rows.filter((row) => ["approved", "in_progress", "quality_check"].includes(row.status)).length,
      completed: completed.length,
      cancelled: rows.filter((row) => row.status === "cancelled").length,
      billed: rows.filter((row) => row.status === "billed").length,
      billedRevenue: money(billedRevenue),
      averageTurnaroundDays: turnaroundDays.length ? money(turnaroundDays.reduce((sum, value) => sum + value, 0) / turnaroundDays.length) : 0,
      byStatus
    };
  }

  private getTopServices(filter?: ReportFilterInput) {
    const { where, params } = filter ? this.rangeClause(filter, "i.invoiceDate") : { where: "", params: [] as string[] };
    const activeWhere = where ? `${where} AND i.invoiceStatus <> 'cancelled'` : "WHERE i.invoiceStatus <> 'cancelled'";
    return this.select<Row>(
      `SELECT ii.description AS name, COALESCE(SUM(ii.quantity), 0) AS quantity, COALESCE(SUM(ii.lineTotal), 0) AS revenue
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoiceId
       ${activeWhere}
       GROUP BY ii.description
       ORDER BY revenue DESC
       LIMIT 6`,
      params
    ).map((row) => ({
      name: rowText(row, "name"),
      quantity: money(rowNumber(row, "quantity")),
      revenue: money(rowNumber(row, "revenue"))
    }));
  }

  private getQuickStockSaleRevenue(filter: ReportFilterInput) {
    const saleRange = this.rangeCondition(filter, "im.movementDate");
    return money(rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(im.saleAmount), 0) AS value
         FROM inventory_movements im
         WHERE im.type = 'stock_sale'
           AND im.saleAmount > 0 ${saleRange.condition}`,
        saleRange.params
      )[0] || { value: 0 },
      "value"
    ));
  }

  private getQuickStockSaleCost(filter: ReportFilterInput) {
    const saleRange = this.rangeCondition(filter, "im.movementDate");
    return money(rowNumber(
      this.select<Row>(
        `SELECT COALESCE(SUM(im.quantity * im.unitCost), 0) AS value
         FROM inventory_movements im
         WHERE im.type = 'stock_sale' ${saleRange.condition}`,
        saleRange.params
      )[0] || { value: 0 },
      "value"
    ));
  }

  private getPaymentModeTotals(filter: ReportFilterInput) {
    const paymentRange = this.rangeCondition(filter, "p.paymentDate");
    const saleRange = this.rangeCondition(filter, "im.movementDate");
    return this.select<Row>(
      `SELECT mode, COALESCE(SUM(amount), 0) AS amount
       FROM (
        SELECT p.mode AS mode, p.amount AS amount
        FROM payments p
        JOIN invoices i ON i.id = p.invoiceId
        WHERE i.invoiceStatus <> 'cancelled' ${paymentRange.condition}
        UNION ALL
        SELECT COALESCE(NULLIF(im.paymentMode, ''), 'Cash') AS mode, im.saleAmount AS amount
        FROM inventory_movements im
        WHERE im.type = 'stock_sale'
          AND im.saleAmount > 0 ${saleRange.condition}
       ) totals
       GROUP BY mode
       ORDER BY amount DESC`,
      [...paymentRange.params, ...saleRange.params]
    ).map((row) => ({
      mode: rowText(row, "mode") as PaymentMode,
      amount: money(rowNumber(row, "amount"))
    }));
  }

  private getEnquiryReport(filter: ReportFilterInput): EnquiryReportData {
    const { where, params } = this.rangeClause(filter, "date(createdAt)");
    const enquiries = this.select<Row>(`SELECT * FROM enquiries ${where}`, params).map(this.mapEnquiry);
    const byStatus = this.select<Row>(
      `SELECT status, COUNT(*) AS count
       FROM enquiries
       ${where}
       GROUP BY status
       ORDER BY count DESC`,
      params
    ).map((row) => ({
      status: this.normalizeEnquiryStatus(rowText(row, "status")),
      count: rowNumber(row, "count")
    }));
    const bySource = this.select<Row>(
      `SELECT source, COUNT(*) AS count
       FROM enquiries
       ${where}
       GROUP BY source
       ORDER BY count DESC`,
      params
    ).map((row) => ({
      source: this.normalizeEnquirySource(rowText(row, "source")),
      count: rowNumber(row, "count")
    }));

    return {
      total: enquiries.length,
      converted: enquiries.filter((enquiry) => enquiry.status === "converted").length,
      lost: enquiries.filter((enquiry) => enquiry.status === "lost").length,
      open: enquiries.filter((enquiry) => !["converted", "lost"].includes(enquiry.status)).length,
      byStatus,
      bySource
    };
  }

  private rangeClause(filter: ReportFilterInput, column: string) {
    const range = this.normalizeReportFilter(filter);
    if (range.fromDate || range.toDate) {
      const params: string[] = [];
      const conditions: string[] = [];
      if (range.fromDate) {
        conditions.push(`${column} >= ?`);
        params.push(range.fromDate);
      }
      if (range.toDate) {
        conditions.push(`${column} <= ?`);
        params.push(range.toDate);
      }
      return { where: `WHERE ${conditions.join(" AND ")}`, params, label: this.reportRangeLabel(range.fromDate, range.toDate) };
    }
    const preset = range.preset || "30d";
    if (preset === "all") return { where: "", params: [] as string[], label: "All time" };
    const days = preset === "90d" ? 90 : preset === "30d" ? 30 : 7;
    const date = new Date();
    date.setDate(date.getDate() - (days - 1));
    const start = localDate(date);
    return { where: `WHERE ${column} >= ?`, params: [start], label: `Last ${days} days` };
  }

  private rangeCondition(filter: ReportFilterInput, column: string) {
    const { where, params, label } = this.rangeClause(filter, column);
    return { condition: where ? where.replace(/^WHERE /, "AND ") : "", params, label };
  }

  private normalizeReportFilter(filter: ReportFilterInput = "30d") {
    if (typeof filter === "string") return { preset: filter as DateRangePreset, fromDate: "", toDate: "" };
    const fromDate = this.normalizeReportDate(filter?.fromDate);
    const toDate = this.normalizeReportDate(filter?.toDate);
    const sortedFromDate = fromDate && toDate && fromDate > toDate ? toDate : fromDate;
    const sortedToDate = fromDate && toDate && fromDate > toDate ? fromDate : toDate;
    return {
      preset: filter?.preset || (sortedFromDate || sortedToDate ? undefined : "30d"),
      fromDate: sortedFromDate,
      toDate: sortedToDate
    };
  }

  private normalizeReportDate(value?: string) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  private reportRangeLabel(fromDate: string, toDate: string) {
    if (fromDate && toDate) return `${fromDate} to ${toDate}`;
    if (fromDate) return `From ${fromDate}`;
    if (toDate) return `Until ${toDate}`;
    return "Custom range";
  }

  private getSalesTrend(filter: ReportFilterInput) {
    const invoiceRange = this.rangeCondition(filter, "i.invoiceDate");
    const paymentRange = this.rangeCondition(filter, "p.paymentDate");
    const saleRange = this.rangeCondition(filter, "im.movementDate");
    const rows = this.select<Row>(
      `SELECT date,
              COALESCE(SUM(billedValue), 0) AS billedValue,
              COALESCE(SUM(quickStockSales), 0) AS quickStockSales,
              COALESCE(SUM(paidAmount), 0) AS paidAmount,
              COALESCE(SUM(balanceDue), 0) AS balanceDue
       FROM (
          SELECT i.invoiceDate AS date,
                 SUM(i.grandTotal) AS billedValue,
                 0 AS quickStockSales,
                 0 AS paidAmount,
                 SUM(i.balanceDue) AS balanceDue
          FROM invoices i
         WHERE i.invoiceStatus <> 'cancelled' ${invoiceRange.condition}
         GROUP BY i.invoiceDate
          UNION ALL
          SELECT p.paymentDate AS date,
                 0 AS billedValue,
                 0 AS quickStockSales,
                 SUM(p.amount) AS paidAmount,
                 0 AS balanceDue
          FROM payments p
          JOIN invoices i ON i.id = p.invoiceId
          WHERE i.invoiceStatus <> 'cancelled' ${paymentRange.condition}
          GROUP BY p.paymentDate
          UNION ALL
          SELECT im.movementDate AS date,
                 0 AS billedValue,
                 SUM(im.saleAmount) AS quickStockSales,
                 SUM(im.saleAmount) AS paidAmount,
                 0 AS balanceDue
          FROM inventory_movements im
          WHERE im.type = 'stock_sale'
            AND im.saleAmount > 0 ${saleRange.condition}
          GROUP BY im.movementDate
       ) totals
       GROUP BY date
       ORDER BY date ASC`,
      [...invoiceRange.params, ...paymentRange.params, ...saleRange.params]
    );

    return rows.map((row) => {
      const date = rowText(row, "date");
      const billedValue = money(rowNumber(row, "billedValue"));
      const quickStockSales = money(rowNumber(row, "quickStockSales"));
      return {
        date,
        label: date ? date.slice(5) : "-",
        billedValue,
        quickStockSales,
        totalSales: money(billedValue + quickStockSales),
        paidAmount: money(rowNumber(row, "paidAmount")),
        balanceDue: money(rowNumber(row, "balanceDue"))
      };
    });
  }

  private getProfitTrend(filter: ReportFilterInput) {
    const paymentRange = this.rangeCondition(filter, "p.paymentDate");
    const stockRange = this.rangeCondition(filter, "im.movementDate");
    const stockSaleRange = this.rangeCondition(filter, "im.movementDate");
    const expenseRange = this.rangeCondition(filter, "e.expenseDate");
    const rows = this.select<Row>(
      `SELECT date,
              COALESCE(SUM(paidRevenue), 0) AS paidRevenue,
              COALESCE(SUM(stockCost), 0) AS stockCost,
              COALESCE(SUM(expenses), 0) AS expenses
       FROM (
         SELECT p.paymentDate AS date, SUM(p.amount) AS paidRevenue, 0 AS stockCost, 0 AS expenses
         FROM payments p
         JOIN invoices i ON i.id = p.invoiceId
         WHERE i.invoiceStatus <> 'cancelled' ${paymentRange.condition}
         GROUP BY p.paymentDate
         UNION ALL
         SELECT im.movementDate AS date, 0 AS paidRevenue, SUM(im.quantity * im.unitCost) AS stockCost, 0 AS expenses
         FROM inventory_movements im
         JOIN invoices i ON i.invoiceNumber = im.reference
          WHERE i.invoiceStatus <> 'cancelled'
            AND im.type IN ('sale', 'usage') ${stockRange.condition}
          GROUP BY im.movementDate
          UNION ALL
          SELECT im.movementDate AS date, SUM(im.saleAmount) AS paidRevenue, SUM(im.quantity * im.unitCost) AS stockCost, 0 AS expenses
          FROM inventory_movements im
          WHERE im.type = 'stock_sale'
            AND im.saleAmount > 0 ${stockSaleRange.condition}
          GROUP BY im.movementDate
          UNION ALL
          SELECT e.expenseDate AS date, 0 AS paidRevenue, 0 AS stockCost, SUM(e.amount) AS expenses
          FROM expenses e
          WHERE 1 = 1 ${expenseRange.condition}
          GROUP BY e.expenseDate
        ) totals
        GROUP BY date
        ORDER BY date ASC`,
      [...paymentRange.params, ...stockRange.params, ...stockSaleRange.params, ...expenseRange.params]
    );

    return rows.map((row) => {
      const paidRevenue = money(rowNumber(row, "paidRevenue"));
      const stockCost = money(rowNumber(row, "stockCost"));
      const expenses = money(rowNumber(row, "expenses"));
      const date = rowText(row, "date");
      return {
        date,
        label: date ? date.slice(5) : "-",
        paidRevenue,
        stockCost,
        expenses,
        cashProfit: money(paidRevenue - stockCost - expenses)
      };
    });
  }

  private invoiceSummarySql() {
    return `
      SELECT
        i.*,
        c.name AS customerName,
        c.phone AS customerPhone,
        v.vehicleType AS vehicleType,
        v.registrationNumber AS vehicleNumber
      FROM invoices i
      JOIN customers c ON c.id = i.customerId
      JOIN vehicles v ON v.id = i.vehicleId
    `;
  }

  private quotationSummarySql() {
    return `
      SELECT
        q.id,
        q.quotationNumber,
        q.quotationStatus,
        q.invoiceMode,
        q.taxScope,
        q.quotationDate,
        q.validUntil,
        q.customerId,
        q.vehicleId,
        COALESCE(c.name, q.customerName, '') AS customerName,
        COALESCE(c.phone, q.customerPhone, '') AS customerPhone,
        COALESCE(c.email, q.customerEmail, '') AS customerEmail,
        COALESCE(c.gstin, q.customerGstin, '') AS customerGstin,
        COALESCE(c.address, q.customerAddress, '') AS customerAddress,
        COALESCE(v.vehicleType, q.vehicleType, 'car') AS vehicleType,
        COALESCE(v.registrationNumber, q.vehicleNumber, '') AS vehicleNumber,
        COALESCE(v.make, q.vehicleMake, '') AS vehicleMake,
        COALESCE(v.model, q.vehicleModel, '') AS vehicleModel,
        COALESCE(v.color, q.vehicleColor, '') AS vehicleColor,
        q.subTotal,
        q.discount,
        q.taxableValue,
        q.cgst,
        q.sgst,
        q.igst,
        q.totalTax,
        q.grandTotal,
        q.notes,
        q.convertedInvoiceId,
        q.createdAt,
        q.updatedAt
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customerId
      LEFT JOIN vehicles v ON v.id = q.vehicleId
    `;
  }

  private jobCardSummarySql() {
    return `
      SELECT
        jc.*,
        c.name AS customerName,
        c.phone AS customerPhone,
        v.vehicleType AS vehicleType,
        v.registrationNumber AS vehicleNumber
      FROM job_cards jc
      JOIN customers c ON c.id = jc.customerId
      JOIN vehicles v ON v.id = jc.vehicleId
    `;
  }

  private inventoryItemsSql(where = "") {
    return `
      SELECT
        ii.*,
        COALESCE(SUM(ib.quantityRemaining), 0) AS currentQuantity,
        COALESCE(SUM(ib.quantityRemaining * ib.unitCost), 0) AS stockValue
      FROM inventory_items ii
      LEFT JOIN inventory_batches ib ON ib.itemId = ii.id
      ${where}
      GROUP BY ii.id
    `;
  }

  private mapService = (row: Row | undefined | null): ServiceItem => ({
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    category: rowText(row, "category"),
    defaultPrice: money(rowNumber(row, "defaultPrice")),
    gstRate: money(rowNumber(row, "gstRate")),
    sacCode: rowText(row, "sacCode"),
    active: rowNumber(row, "active") === 1,
    createdAt: rowText(row, "createdAt")
  });

  private mapCustomer = (row: Row | undefined | null): Customer => ({
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    phone: rowText(row, "phone"),
    email: rowText(row, "email"),
    gstin: rowText(row, "gstin"),
    address: rowText(row, "address"),
    createdAt: rowText(row, "createdAt")
  });

  private mapVehicle = (row: Row | undefined | null): Vehicle => ({
    id: rowText(row, "id"),
    customerId: rowText(row, "customerId"),
    vehicleType: this.normalizeVehicleType(rowText(row, "vehicleType")),
    registrationNumber: rowText(row, "registrationNumber"),
    make: rowText(row, "make"),
    model: rowText(row, "model"),
    color: rowText(row, "color"),
    createdAt: rowText(row, "createdAt")
  });

  private mapInvoiceSummary = (row: Row | undefined | null): InvoiceSummary => ({
    id: rowText(row, "id"),
    invoiceNumber: rowText(row, "invoiceNumber"),
    invoiceStatus: rowText(row, "invoiceStatus") === "cancelled" ? "cancelled" : "finalized",
    cloudSyncStatus: this.normalizeCloudSyncStatus(rowText(row, "cloudSyncStatus")),
    cloudRevision: rowNumber(row, "cloudRevision"),
    cloudSyncedAt: rowText(row, "cloudSyncedAt"),
    cloudConflictId: rowText(row, "cloudConflictId"),
    invoiceMode: rowText(row, "invoiceMode") as InvoiceMode,
    taxScope: rowText(row, "taxScope") as TaxScope,
    invoiceDate: rowText(row, "invoiceDate"),
    customerId: rowText(row, "customerId"),
    vehicleId: rowText(row, "vehicleId"),
    jobCardId: rowText(row, "jobCardId"),
    vehicleType: this.normalizeVehicleType(rowText(row, "vehicleType")),
    customerName: rowText(row, "customerName"),
    customerPhone: rowText(row, "customerPhone"),
    vehicleNumber: rowText(row, "vehicleNumber"),
    subTotal: money(rowNumber(row, "subTotal")),
    discount: money(rowNumber(row, "discount")),
    taxableValue: money(rowNumber(row, "taxableValue")),
    cgst: money(rowNumber(row, "cgst")),
    sgst: money(rowNumber(row, "sgst")),
    igst: money(rowNumber(row, "igst")),
    totalTax: money(rowNumber(row, "totalTax")),
    grandTotal: money(rowNumber(row, "grandTotal")),
    paidAmount: money(rowNumber(row, "paidAmount")),
    balanceDue: money(rowNumber(row, "balanceDue")),
    paymentStatus: rowText(row, "paymentStatus") as PaymentStatus,
    paymentMode: rowText(row, "paymentMode") as PaymentMode,
    paymentReference: rowText(row, "paymentReference"),
    notes: rowText(row, "notes"),
    cancelledAt: rowText(row, "cancelledAt"),
    cancelledByUserId: rowText(row, "cancelledByUserId"),
    cancelReason: rowText(row, "cancelReason"),
    replacementInvoiceId: rowText(row, "replacementInvoiceId"),
    sourceInvoiceId: rowText(row, "sourceInvoiceId"),
    sourceQuotationId: rowText(row, "sourceQuotationId"),
    createdAt: rowText(row, "createdAt")
  });

  private mapSyncOutboxEntry = (row: Row | undefined | null): SyncOutboxEntry => ({
    id: rowNumber(row, "id"),
    idempotencyKey: rowText(row, "idempotencyKey"),
    operationType: (rowText(row, "operationType") === "DELETE" ? "DELETE" : "UPSERT") as SyncOperationType,
    entity: rowText(row, "entity") as SyncEntity,
    localId: rowText(row, "localId"),
    payload: rowObject(row, "payloadJson"),
    fileRefs: rowStringArray(row, "fileRefsJson"),
    baseRevision: rowNumber(row, "baseRevision"),
    attemptCount: rowNumber(row, "attemptCount"),
    lastError: rowText(row, "lastError"),
    createdAt: rowText(row, "createdAt"),
    pushedAt: rowText(row, "pushedAt"),
    status: (rowText(row, "status") || "PENDING") as SyncOutboxStatus
  });

  private mapSyncConflict = (row: Row | undefined | null): SyncConflictSummary => ({
    id: rowNumber(row, "id"),
    conflictId: rowText(row, "conflictId"),
    entity: rowText(row, "entity") as SyncEntity,
    localId: rowText(row, "localId"),
    localVersion: rowObject(row, "localVersionJson"),
    serverVersion: rowObject(row, "serverVersionJson"),
    detectedAt: rowText(row, "detectedAt"),
    resolvedAt: rowText(row, "resolvedAt"),
    resolution: (rowText(row, "resolution") || "") as SyncConflictResolution | "",
    status: rowText(row, "status") === "RESOLVED" ? "RESOLVED" : "OPEN"
  });

  private mapInvoiceDraft = (row: Row | undefined | null): InvoiceDraft => {
    let payload: InvoiceDraftPayload;
    try {
      payload = JSON.parse(rowText(row, "payloadJson")) as InvoiceDraftPayload;
    } catch {
      payload = {
        invoiceMode: "gst",
        taxScope: "intra",
        invoiceDate: localDate(),
        customer: { name: "" },
        vehicle: { registrationNumber: "" },
        items: [],
        discount: 0,
        paidAmount: 0,
        paymentMode: "UPI",
        paymentReference: "",
        notes: ""
      };
    }
    return {
      id: rowText(row, "id"),
      name: rowText(row, "name"),
      sourceInvoiceId: rowText(row, "sourceInvoiceId"),
      correctionType: this.normalizeInvoiceDraftCorrectionType(rowText(row, "correctionType")),
      payload,
      createdAt: rowText(row, "createdAt"),
      updatedAt: rowText(row, "updatedAt")
    };
  };

  private mapInvoiceItem = (row: Row | undefined | null): InvoiceItem => ({
    id: rowText(row, "id"),
    invoiceId: rowText(row, "invoiceId"),
    serviceId: rowText(row, "serviceId"),
    inventoryItemId: rowText(row, "inventoryItemId"),
    description: rowText(row, "description"),
    quantity: money(rowNumber(row, "quantity")),
    unitPrice: money(rowNumber(row, "unitPrice")),
    gstRate: money(rowNumber(row, "gstRate")),
    sacCode: rowText(row, "sacCode"),
    lineSubTotal: money(rowNumber(row, "lineSubTotal")),
    lineTax: money(rowNumber(row, "lineTax")),
    lineTotal: money(rowNumber(row, "lineTotal"))
  });

  private mapQuotationSummary = (row: Row | undefined | null): QuotationSummary => ({
    id: rowText(row, "id"),
    quotationNumber: rowText(row, "quotationNumber"),
    quotationStatus: this.normalizeQuotationStatus(rowText(row, "quotationStatus")),
    invoiceMode: rowText(row, "invoiceMode") as InvoiceMode,
    taxScope: rowText(row, "taxScope") as TaxScope,
    quotationDate: rowText(row, "quotationDate"),
    validUntil: rowText(row, "validUntil"),
    customerId: rowText(row, "customerId"),
    vehicleId: rowText(row, "vehicleId"),
    vehicleType: this.normalizeVehicleType(rowText(row, "vehicleType")),
    customerName: rowText(row, "customerName"),
    customerPhone: rowText(row, "customerPhone"),
    customerEmail: rowText(row, "customerEmail"),
    customerGstin: rowText(row, "customerGstin"),
    customerAddress: rowText(row, "customerAddress"),
    vehicleNumber: rowText(row, "vehicleNumber"),
    vehicleMake: rowText(row, "vehicleMake"),
    vehicleModel: rowText(row, "vehicleModel"),
    vehicleColor: rowText(row, "vehicleColor"),
    subTotal: money(rowNumber(row, "subTotal")),
    discount: money(rowNumber(row, "discount")),
    taxableValue: money(rowNumber(row, "taxableValue")),
    cgst: money(rowNumber(row, "cgst")),
    sgst: money(rowNumber(row, "sgst")),
    igst: money(rowNumber(row, "igst")),
    totalTax: money(rowNumber(row, "totalTax")),
    grandTotal: money(rowNumber(row, "grandTotal")),
    notes: rowText(row, "notes"),
    convertedInvoiceId: rowText(row, "convertedInvoiceId"),
    createdAt: rowText(row, "createdAt"),
    updatedAt: rowText(row, "updatedAt")
  });

  private mapQuotationItem = (row: Row | undefined | null): QuotationItem => ({
    id: rowText(row, "id"),
    quotationId: rowText(row, "quotationId"),
    serviceId: rowText(row, "serviceId"),
    inventoryItemId: rowText(row, "inventoryItemId"),
    description: rowText(row, "description"),
    quantity: money(rowNumber(row, "quantity")),
    unitPrice: money(rowNumber(row, "unitPrice")),
    gstRate: money(rowNumber(row, "gstRate")),
    sacCode: rowText(row, "sacCode"),
    lineSubTotal: money(rowNumber(row, "lineSubTotal")),
    lineTax: money(rowNumber(row, "lineTax")),
    lineTotal: money(rowNumber(row, "lineTotal"))
  });

  private mapPayment = (row: Row | undefined | null): Payment => ({
    id: rowText(row, "id"),
    invoiceId: rowText(row, "invoiceId"),
    amount: money(rowNumber(row, "amount")),
    mode: rowText(row, "mode") as PaymentMode,
    reference: rowText(row, "reference"),
    paymentDate: rowText(row, "paymentDate"),
    createdAt: rowText(row, "createdAt")
  });

  private mapPurchaseRecord = (row: Row | undefined | null): PurchaseRecord => {
    let documents: PurchaseRecordDocument[] = [];
    try {
      const parsed = JSON.parse(rowText(row, "documents") || EMPTY_JSON_ARRAY);
      documents = Array.isArray(parsed) ? parsed as PurchaseRecordDocument[] : [];
    } catch {
      documents = [];
    }
    return {
      id: rowText(row, "id"),
      purchaseDate: rowText(row, "purchaseDate"),
      supplierId: rowText(row, "supplierId"),
      supplierName: rowText(row, "supplierName"),
      vendorName: rowText(row, "vendorName"),
      billNumber: rowText(row, "billNumber"),
      amount: money(rowNumber(row, "amount")),
      paymentMode: this.normalizePaymentMode(rowText(row, "paymentMode")),
      notes: rowText(row, "notes"),
      documents,
      createdAt: rowText(row, "createdAt"),
      updatedAt: rowText(row, "updatedAt")
    };
  };

  private mapExpense = (row: Row | undefined | null): Expense => ({
    id: rowText(row, "id"),
    expenseDate: rowText(row, "expenseDate"),
    category: rowText(row, "category"),
    amount: money(rowNumber(row, "amount")),
    paymentMode: this.normalizePaymentMode(rowText(row, "paymentMode")),
    vendor: rowText(row, "vendor"),
    reference: rowText(row, "reference"),
    notes: rowText(row, "notes"),
    createdByUserId: rowText(row, "createdByUserId"),
    createdAt: rowText(row, "createdAt"),
    updatedAt: rowText(row, "updatedAt")
  });

  private mapEnquiry = (row: Row | undefined | null): Enquiry => ({
    id: rowText(row, "id"),
    status: this.normalizeEnquiryStatus(rowText(row, "status")),
    source: this.normalizeEnquirySource(rowText(row, "source")),
    customerName: rowText(row, "customerName"),
    phone: rowText(row, "phone"),
    email: rowText(row, "email"),
    address: rowText(row, "address"),
    vehicleType: this.normalizeVehicleType(rowText(row, "vehicleType")),
    vehicleNumber: rowText(row, "vehicleNumber"),
    vehicleMake: rowText(row, "vehicleMake"),
    vehicleModel: rowText(row, "vehicleModel"),
    vehicleColor: rowText(row, "vehicleColor"),
    interestedService: rowText(row, "interestedService"),
    expectedBudget: money(rowNumber(row, "expectedBudget")),
    preferredVisitDate: rowText(row, "preferredVisitDate"),
    followUpDate: rowText(row, "followUpDate"),
    notes: rowText(row, "notes"),
    lostReason: rowText(row, "lostReason"),
    customerId: rowText(row, "customerId"),
    vehicleId: rowText(row, "vehicleId"),
    convertedAt: rowText(row, "convertedAt"),
    createdAt: rowText(row, "createdAt"),
    updatedAt: rowText(row, "updatedAt")
  });

  private mapEnquiryFollowup = (row: Row | undefined | null): EnquiryFollowup => ({
    id: rowText(row, "id"),
    enquiryId: rowText(row, "enquiryId"),
    followupDate: rowText(row, "followupDate"),
    note: rowText(row, "note"),
    nextFollowUpDate: rowText(row, "nextFollowUpDate"),
    status: this.normalizeEnquiryStatus(rowText(row, "status")),
    createdAt: rowText(row, "createdAt")
  });

  private mapSupplier = (row: Row | undefined | null): Supplier => ({
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    phone: rowText(row, "phone"),
    gstin: rowText(row, "gstin"),
    address: rowText(row, "address"),
    createdAt: rowText(row, "createdAt")
  });

  private mapInventoryItem = (row: Row | undefined | null): InventoryItem => ({
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    type: rowText(row, "type") === "retail" ? "retail" : "consumable",
    unit: rowText(row, "unit"),
    sku: rowText(row, "sku"),
    category: rowText(row, "category"),
    retailPrice: money(rowNumber(row, "retailPrice")),
    gstRate: money(rowNumber(row, "gstRate")),
    lowStockLevel: money(rowNumber(row, "lowStockLevel")),
    active: rowNumber(row, "active") === 1,
    currentQuantity: money(rowNumber(row, "currentQuantity")),
    stockValue: money(rowNumber(row, "stockValue")),
    createdAt: rowText(row, "createdAt")
  });

  private mapInventoryBatch = (row: Row | undefined | null): InventoryBatch => ({
    id: rowText(row, "id"),
    itemId: rowText(row, "itemId"),
    supplierId: rowText(row, "supplierId"),
    batchNumber: rowText(row, "batchNumber"),
    expiryDate: rowText(row, "expiryDate"),
    purchaseDate: rowText(row, "purchaseDate"),
    billNumber: rowText(row, "billNumber"),
    quantityPurchased: money(rowNumber(row, "quantityPurchased")),
    quantityRemaining: money(rowNumber(row, "quantityRemaining")),
    unitCost: money(rowNumber(row, "unitCost")),
    gstRate: money(rowNumber(row, "gstRate")),
    subtotal: money(rowNumber(row, "subtotal")),
    gstAmount: money(rowNumber(row, "gstAmount")),
    totalCost: money(rowNumber(row, "totalCost")),
    createdAt: rowText(row, "createdAt")
  });

  private mapInventoryMovement = (row: Row | undefined | null): InventoryMovement => ({
    id: rowText(row, "id"),
    itemId: rowText(row, "itemId"),
    itemName: rowText(row, "itemName"),
    itemType: rowText(row, "itemType") === "retail" ? "retail" : "consumable",
    itemUnit: rowText(row, "itemUnit"),
    batchId: rowText(row, "batchId"),
    type: rowText(row, "type") as InventoryMovementType,
    quantity: money(rowNumber(row, "quantity")),
    unitCost: money(rowNumber(row, "unitCost")),
    saleAmount: money(rowNumber(row, "saleAmount")),
    saleUnitPrice: money(rowNumber(row, "saleUnitPrice")),
    paymentMode: (["Cash", "UPI", "Card", "Bank Transfer", "Other"].includes(rowText(row, "paymentMode")) ? rowText(row, "paymentMode") : "") as PaymentMode | "",
    reference: rowText(row, "reference"),
    notes: rowText(row, "notes"),
    movementDate: rowText(row, "movementDate"),
    createdAt: rowText(row, "createdAt")
  });

  private mapServiceConsumable = (row: Row | undefined | null): ServiceConsumable => ({
    id: rowText(row, "id"),
    serviceId: rowText(row, "serviceId"),
    inventoryItemId: rowText(row, "inventoryItemId"),
    itemName: rowText(row, "itemName"),
    unit: rowText(row, "unit"),
    quantity: money(rowNumber(row, "quantity"))
  });

  private mapJobCardSummary = (row: Row | undefined | null): JobCardSummary => ({
    id: rowText(row, "id"),
    jobNumber: rowText(row, "jobNumber"),
    status: this.normalizeJobCardStatus(rowText(row, "status")),
    jobDate: rowText(row, "jobDate"),
    expectedDeliveryDate: rowText(row, "expectedDeliveryDate"),
    expectedDeliveryTime: rowText(row, "expectedDeliveryTime"),
    actualDeliveryDate: rowText(row, "actualDeliveryDate"),
    actualDeliveryTime: rowText(row, "actualDeliveryTime"),
    customerId: rowText(row, "customerId"),
    vehicleId: rowText(row, "vehicleId"),
    invoiceId: rowText(row, "invoiceId"),
    customerName: rowText(row, "customerName"),
    customerPhone: rowText(row, "customerPhone"),
    vehicleType: this.normalizeVehicleType(rowText(row, "vehicleType")),
    vehicleNumber: rowText(row, "vehicleNumber"),
    odometer: rowText(row, "odometer"),
    fuelLevel: rowText(row, "fuelLevel"),
    keyReceived: rowNumber(row, "keyReceived") === 1,
    belongingsNote: rowText(row, "belongingsNote"),
    approvalName: rowText(row, "approvalName"),
    approvalDate: rowText(row, "approvalDate"),
    approvalNotes: rowText(row, "approvalNotes"),
    workNotes: rowText(row, "workNotes"),
    internalNotes: rowText(row, "internalNotes"),
    deliveryNotes: rowText(row, "deliveryNotes"),
    subTotal: money(rowNumber(row, "subTotal")),
    discount: money(rowNumber(row, "discount")),
    taxableValue: money(rowNumber(row, "taxableValue")),
    totalTax: money(rowNumber(row, "totalTax")),
    grandTotal: money(rowNumber(row, "grandTotal")),
    createdAt: rowText(row, "createdAt"),
    updatedAt: rowText(row, "updatedAt")
  });

  private mapJobCardItem = (row: Row | undefined | null): JobCardItem => ({
    id: rowText(row, "id"),
    jobCardId: rowText(row, "jobCardId"),
    serviceId: rowText(row, "serviceId"),
    inventoryItemId: rowText(row, "inventoryItemId"),
    description: rowText(row, "description"),
    quantity: money(rowNumber(row, "quantity")),
    unitPrice: money(rowNumber(row, "unitPrice")),
    gstRate: money(rowNumber(row, "gstRate")),
    sacCode: rowText(row, "sacCode"),
    lineSubTotal: money(rowNumber(row, "lineSubTotal")),
    lineTax: money(rowNumber(row, "lineTax")),
    lineTotal: money(rowNumber(row, "lineTotal"))
  });

  private mapJobCardChecklistItem = (row: Row | undefined | null): JobCardChecklistItem => ({
    id: rowText(row, "id"),
    jobCardId: rowText(row, "jobCardId"),
    label: rowText(row, "label"),
    checked: rowNumber(row, "checked") === 1,
    sortOrder: rowNumber(row, "sortOrder"),
    createdAt: rowText(row, "createdAt")
  });

  private mapJobCardPhoto = (row: Row | undefined | null): JobCardPhoto => ({
    id: rowText(row, "id"),
    jobCardId: rowText(row, "jobCardId"),
    type: this.normalizeJobCardPhotoType(rowText(row, "type")),
    path: rowText(row, "path"),
    url: this.jobCardPhotoUrl(rowText(row, "path")),
    caption: rowText(row, "caption"),
    createdAt: rowText(row, "createdAt")
  });

  private jobCardPhotoUrl(filePath: string) {
    if (!filePath) return "";
    try {
      const resolved = path.resolve(filePath);
      if (!isInsideDirectory(this.jobCardPhotoRoot(), resolved) || !fs.existsSync(resolved)) return "";
      return `data:${this.jobCardPhotoMime(resolved)};base64,${fs.readFileSync(resolved).toString("base64")}`;
    } catch {
      return "";
    }
  }

  private jobCardPhotoMime(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".gif") return "image/gif";
    if (extension === ".bmp") return "image/bmp";
    return "image/png";
  }

  private mapJobCardStatusHistory = (row: Row | undefined | null): JobCardStatusHistory => ({
    id: rowText(row, "id"),
    jobCardId: rowText(row, "jobCardId"),
    status: this.normalizeJobCardStatus(rowText(row, "status")),
    note: rowText(row, "note"),
    createdAt: rowText(row, "createdAt")
  });

  private normalizeJobCardStatus(value: string): JobCardStatus {
    return JOB_CARD_STATUSES.includes(value as JobCardStatus) ? (value as JobCardStatus) : "draft";
  }

  private normalizeJobCardPhotoType(value: string): JobCardPhotoType {
    return JOB_CARD_PHOTO_TYPES.includes(value as JobCardPhotoType) ? (value as JobCardPhotoType) : "before";
  }

  private assertUuid(value: string, label: string) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${label} ID is invalid.`);
  }

  private jobCardPhotoRoot() {
    return path.join(app.getPath("userData"), "job-card-photos");
  }

  private invoiceAssetRoot() {
    return path.join(app.getPath("userData"), "invoice-assets");
  }

  getPurchaseDocumentRoot() {
    return path.join(app.getPath("userData"), "purchase-record-documents");
  }

  private validateJobCardPhotoSource(filePath: string) {
    const resolved = path.resolve(filePath);
    const extension = path.extname(resolved).toLowerCase();
    if (!JOB_CARD_PHOTO_EXTENSIONS.has(extension)) throw new Error("Only image files are allowed for job card photos.");
    if (!fs.existsSync(resolved)) throw new Error("Selected photo is not available.");
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("Selected photo is not available.");
    if (stat.size > MAX_JOB_CARD_PHOTO_BYTES) throw new Error("Selected photo is too large.");
    return { resolved, extension };
  }

  private normalizeEnquiryStatus(value: string): EnquiryStatus {
    const statuses: EnquiryStatus[] = ["new", "contacted", "follow_up", "visited", "converted", "lost"];
    return statuses.includes(value as EnquiryStatus) ? (value as EnquiryStatus) : "new";
  }

  private normalizeEnquirySource(value: string): EnquirySource {
    const sources: EnquirySource[] = ["Walk-in", "Phone", "WhatsApp", "Instagram", "Google", "Referral", "Other"];
    return sources.includes(value as EnquirySource) ? (value as EnquirySource) : "Other";
  }

  private normalizeVehicleType(value?: string): VehicleType {
    const types: VehicleType[] = ["car", "bike", "other"];
    return types.includes(value as VehicleType) ? (value as VehicleType) : "car";
  }

  private normalizeInvoiceDraftCorrectionType(value?: string): InvoiceDraftCorrectionType {
    const types: InvoiceDraftCorrectionType[] = ["normal", "replacement", "addon"];
    return types.includes(value as InvoiceDraftCorrectionType) ? (value as InvoiceDraftCorrectionType) : "normal";
  }

  private normalizeQuotationStatus(value?: string): QuotationStatus {
    return QUOTATION_STATUSES.includes(value as QuotationStatus) ? (value as QuotationStatus) : "draft";
  }

  private normalizeCloudSyncStatus(value?: string): CloudSyncRecordStatus {
    const statuses: CloudSyncRecordStatus[] = ["local_only", "pending_cloud", "synced", "conflict", "failed"];
    return statuses.includes(value as CloudSyncRecordStatus) ? (value as CloudSyncRecordStatus) : "local_only";
  }

  private vehicleTypeLabel(type: VehicleType) {
    return type === "bike" ? "Bike" : type === "other" ? "Other" : "Car";
  }

  private mapUser = (row: Row | undefined | null): AppUser => {
    const role = rowText(row, "role") === "owner" ? "owner" : "staff";
    const accessRoleId = role === "owner" ? OWNER_ACCESS_ROLE_ID : rowText(row, "accessRoleId") || STAFF_OPERATIONS_ROLE_ID;
    const accessRole = this.select<Row>("SELECT * FROM access_roles WHERE id = ? LIMIT 1", [accessRoleId])[0];
    const mappedRole = accessRole ? this.mapAccessRole(accessRole) : null;
    const activeRole = mappedRole?.active ? mappedRole : null;
    return {
      id: rowText(row, "id"),
      displayName: rowText(row, "displayName"),
      username: rowText(row, "username"),
      role,
      accessRoleId,
      accessRoleName: role === "owner" ? "Owner" : mappedRole?.name || "Staff Operations",
      permissions: role === "owner" ? [...ALL_PERMISSIONS] : activeRole?.permissions || [],
      active: rowNumber(row, "active") === 1,
      createdAt: rowText(row, "createdAt"),
      updatedAt: rowText(row, "updatedAt")
    };
  };

  private mapAccessRole = (row: Row | undefined | null): AccessRole => ({
    id: rowText(row, "id"),
    name: rowText(row, "name"),
    description: rowText(row, "description"),
    permissions: this.parsePermissions(rowText(row, "permissionsJson")),
    locked: rowNumber(row, "locked") === 1,
    active: rowNumber(row, "active") === 1,
    createdAt: rowText(row, "createdAt"),
    updatedAt: rowText(row, "updatedAt")
  });

  private parsePermissions(value: string): PermissionKey[] {
    try {
      return normalizePermissions(JSON.parse(value || "[]"));
    } catch {
      return [];
    }
  }

  private resolveAccessRoleId(role: "owner" | "staff", requestedRoleId?: string) {
    if (role === "owner") return OWNER_ACCESS_ROLE_ID;
    const accessRoleId = requestedRoleId || STAFF_OPERATIONS_ROLE_ID;
    if (accessRoleId === OWNER_ACCESS_ROLE_ID) throw new Error("Staff users cannot be assigned the owner role.");
    const accessRole = this.select<Row>("SELECT * FROM access_roles WHERE id = ? AND active = 1 LIMIT 1", [accessRoleId])[0];
    if (!accessRole) throw new Error("Select an active access role for this staff user.");
    return accessRoleId;
  }

  private validateUserFields(displayName: string, username: string, password: string | undefined, requirePassword: boolean) {
    if (!displayName) throw new Error("Display name is required.");
    if (!username) throw new Error("Username is required.");
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new Error("Username must be 3-32 characters and use letters, numbers, dot, dash, or underscore.");
    }
    if (requirePassword || password) this.validatePassword(password || "");
  }

  private validatePassword(password: string) {
    if (password.trim().length < 4) throw new Error("Password or PIN must be at least 4 characters.");
  }

  private cloudSafeSettingsPayload(payload: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(payload).filter(([key]) => !LOCAL_ONLY_SETTING_KEYS.has(key)));
  }

  private validateSettingKey(key: string) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) throw new Error("Invalid setting key.");
  }

  private runWrite(sql: string, params: unknown[] = []) {
    this.requireDb().run(sql, params.map(normalizeParam));
    this.save();
  }

  private writeTransaction(callback: () => void) {
    const db = this.requireDb();
    db.run("BEGIN TRANSACTION");
    try {
      callback();
      db.run("COMMIT");
      this.save();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  private select<T extends Row>(sql: string, params: unknown[] = []): T[] {
    const statement = this.requireDb().prepare(sql);
    const rows: T[] = [];
    try {
      statement.bind(params.map(normalizeParam));
      while (statement.step()) rows.push(statement.getAsObject() as T);
    } finally {
      statement.free();
    }
    return rows;
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = this.requireDb().exec(`PRAGMA table_info(${table})`);
    const exists = columns[0]?.values.some((value) => value[1] === column);
    if (!exists) this.requireDb().run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private normalizeJobCardInvoiceLinks() {
    let changed = 0;
    const invalidInvoiceLinks = this.select<Row>(
      `SELECT i.id FROM invoices i
       LEFT JOIN job_cards jc ON jc.id = i.jobCardId
       WHERE i.jobCardId IS NOT NULL AND i.jobCardId <> '' AND jc.id IS NULL`
    );
    invalidInvoiceLinks.forEach((invoice) => {
      this.requireDb().run("UPDATE invoices SET jobCardId = '' WHERE id = ?", [rowText(invoice, "id")]);
      changed += 1;
    });

    const invalidJobCardLinks = this.select<Row>(
      `SELECT jc.id FROM job_cards jc
       LEFT JOIN invoices i ON i.id = jc.invoiceId
       WHERE jc.invoiceId IS NOT NULL AND jc.invoiceId <> '' AND i.id IS NULL`
    );
    invalidJobCardLinks.forEach((jobCard) => {
      this.requireDb().run("UPDATE job_cards SET invoiceId = NULL WHERE id = ?", [rowText(jobCard, "id")]);
      changed += 1;
    });

    const duplicateLinks = this.select<Row>(
      "SELECT jobCardId, COUNT(*) AS count FROM invoices WHERE jobCardId IS NOT NULL AND jobCardId <> '' GROUP BY jobCardId HAVING COUNT(*) > 1"
    );
    duplicateLinks.forEach((link) => {
      const jobCardId = rowText(link, "jobCardId");
      const jobCard = this.select<Row>("SELECT invoiceId FROM job_cards WHERE id = ? LIMIT 1", [jobCardId])[0];
      const invoices = this.select<Row>(
        "SELECT id FROM invoices WHERE jobCardId = ? ORDER BY invoiceDate ASC, createdAt ASC",
        [jobCardId]
      );
      if (!jobCard) {
        invoices.forEach((invoice) => {
          this.requireDb().run("UPDATE invoices SET jobCardId = '' WHERE id = ?", [rowText(invoice, "id")]);
          changed += 1;
        });
        return;
      }
      const linkedInvoiceId = rowText(jobCard, "invoiceId");
      const keepId = invoices.some((invoice) => rowText(invoice, "id") === linkedInvoiceId)
        ? linkedInvoiceId
        : rowText(invoices[0] || {}, "id");
      invoices
        .filter((invoice) => rowText(invoice, "id") !== keepId)
        .forEach((invoice) => {
          this.requireDb().run("UPDATE invoices SET jobCardId = '' WHERE id = ?", [rowText(invoice, "id")]);
          changed += 1;
        });
      if (keepId && linkedInvoiceId !== keepId) {
        this.requireDb().run("UPDATE job_cards SET invoiceId = ? WHERE id = ?", [keepId, jobCardId]);
        changed += 1;
      }
    });

    const mismatchedJobCards = this.select<Row>(
      `SELECT jc.id AS jobCardId, jc.invoiceId AS invoiceId
       FROM job_cards jc
       JOIN invoices i ON i.id = jc.invoiceId
       WHERE jc.invoiceId IS NOT NULL AND jc.invoiceId <> ''
         AND COALESCE(i.jobCardId, '') <> jc.id`
    );
    mismatchedJobCards.forEach((row) => {
      const jobCardId = rowText(row, "jobCardId");
      const invoiceId = rowText(row, "invoiceId");
      const conflict = this.select<Row>(
        "SELECT id FROM invoices WHERE jobCardId = ? AND id <> ? LIMIT 1",
        [jobCardId, invoiceId]
      )[0];
      if (conflict) {
        this.requireDb().run("UPDATE job_cards SET invoiceId = NULL WHERE id = ?", [jobCardId]);
      } else {
        this.requireDb().run("UPDATE invoices SET jobCardId = ? WHERE id = ?", [jobCardId, invoiceId]);
      }
      changed += 1;
    });
    return changed;
  }

  private save() {
    const data = this.requireDb().export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private requireDb() {
    if (!this.db) throw new Error("Database is not initialized.");
    return this.db;
  }
}
