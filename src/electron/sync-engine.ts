import { safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppDatabase } from "./database";
import type {
  CloudDeviceApprovalInput,
  CloudDeviceListResult,
  CloudDeviceOwnerCredentials,
  CloudDeviceSummary,
  SaveResult,
  SyncConnectInput,
  SyncConflictResolution,
  SyncDeviceStatus,
  SyncEntity,
  SyncOperationType,
  SyncTriggerResult
} from "../shared/types";

type SyncLogger = (level: "info" | "warn" | "error", message: string, details?: unknown) => void;
type SyncEmitter = (status: SyncDeviceStatus) => void;
type ApiErrorBody = { error?: { code?: string; message?: string }; message?: string; code?: string };
type CloudRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const LOCAL_DEV_API_PATTERN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

const normalizeCloudUrl = (value: string) => value.trim().replace(/\/+$/, "");
const PRIVATE_IPV4_PATTERN = /^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/;

const isAllowedCloudUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || LOCAL_DEV_API_PATTERN.test(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return false;
  }
};

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error || "Cloud sync failed.");
const cleanCloudConnectionError = (error: unknown) => {
  const message = toErrorMessage(error);
  if (/fetch failed|failed to fetch|network|internet|offline|enotfound|econnrefused|econnreset|etimedout|aborted|aborterror/i.test(message)) {
    return "Cloud API is not reachable. Check internet connection and Cloud API URL, then try again.";
  }
  return message || "Cloud API is not reachable. Check internet connection and Cloud API URL, then try again.";
};
const getPrimarySystemIp = () => {
  const privateIps: string[] = [];
  const publicIps: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = String(entry.family || "");
      const address = String(entry.address || "").trim();
      if (!address || entry.internal || address.startsWith("169.254.")) continue;
      if (family !== "IPv4" && family !== "4") continue;
      if (PRIVATE_IPV4_PATTERN.test(address)) privateIps.push(address);
      else publicIps.push(address);
    }
  }
  return privateIps[0] || publicIps[0] || "";
};

export class CloudSyncEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly database: AppDatabase,
    private readonly log: SyncLogger,
    private readonly emit: SyncEmitter
  ) {}

  start() {
    // Cloud-only mode keeps manual legacy import available, but does not run a repeating local-first sync loop.
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return this.database.getSyncStatus(this.running ? "syncing" : undefined);
  }

  async checkStatus(): Promise<SyncDeviceStatus> {
    const status = this.database.getSyncStatus(this.running ? "syncing" : undefined);
    if (status.approvalStatus === "PENDING") return this.checkDeviceApproval();
    if (!status.configured || !status.cloudUrl || !status.connected) return status;
    try {
      const response = await this.fetchWithTimeout(`${status.cloudUrl}/api/v1/health`, { method: "GET" }, 4500);
      if (!response.ok) throw new Error(`Cloud health check failed with HTTP ${response.status}.`);
      const next = this.database.updateSyncRuntime({ lastStatus: this.running ? "syncing" : "connected", lastError: "" });
      this.emit(next);
      return next;
    } catch (error) {
      const message = this.markCloudUnavailable(error);
      return this.database.getSyncStatus("error", message);
    }
  }

  async connect(input: SyncConnectInput): Promise<SyncDeviceStatus> {
    const cloudUrl = normalizeCloudUrl(input.cloudUrl);
    if (!isAllowedCloudUrl(cloudUrl)) throw new Error("Cloud URL must use HTTPS. Localhost HTTP is allowed only for development.");
    const identity = this.database.ensureSyncDeviceIdentity(input.deviceName);
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${cloudUrl}/api/v1/auth/devices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: identity.deviceId,
          deviceCode: identity.deviceCode,
          deviceName: input.deviceName.trim() || identity.deviceCode,
          registrationKey: input.registrationKey || "",
          reportedIp: getPrimarySystemIp()
        })
      });
    } catch (error) {
      throw new Error(cleanCloudConnectionError(error));
    }
    const body = await this.readJson(response);
    if (!response.ok) throw new Error(this.apiErrorMessage(body, "Unable to connect this device."));
    const token = String((body.data?.token ?? body.token ?? "") as string);
    if (!token) throw new Error("Cloud API did not return a device token.");
    const device = body.data?.device || body.device || {};
    const approvalStatus = this.normalizeApprovalStatus(
      body.data?.approvalStatus || body.approvalStatus || device.approvalStatus || "APPROVED"
    );
    const pendingApproval = Boolean(body.data?.pendingApproval || body.pendingApproval || approvalStatus === "PENDING");
    const status = this.database.saveSyncDevice({
      cloudUrl,
      deviceName: String(device.name || input.deviceName || identity.deviceCode),
      deviceId: String(device.id || identity.deviceId),
      deviceCode: String(device.deviceCode || identity.deviceCode),
      tokenCiphertext: this.encryptToken(token),
      connectedAt: new Date().toISOString(),
      approvalStatus,
      lastStatus: pendingApproval ? "pending_approval" : "connected",
      lastError: pendingApproval ? "Waiting for owner approval." : ""
    });
    this.emit(status);
    this.log("info", pendingApproval ? "Cloud sync device is waiting for owner approval" : "Cloud sync device connected", { cloudUrl, deviceId: status.deviceId });
    return status;
  }

  async disconnect(): Promise<SaveResult & { status: SyncDeviceStatus }> {
    const status = this.database.getSyncStatus();
    const token = this.decryptToken();
    if (status.configured && status.cloudUrl && token) {
      try {
        await fetch(`${status.cloudUrl}/api/v1/auth/devices/current`, {
          method: "DELETE",
          headers: this.authHeaders(token)
        });
      } catch (error) {
        this.log("warn", "Cloud sync remote disconnect failed", { message: toErrorMessage(error) });
      }
    }
    const next = this.database.markSyncDeviceDisconnected("Device disconnected locally.");
    this.emit(next);
    return { ok: true, message: "Cloud sync disconnected on this PC.", status: next };
  }

  async trigger(reason = "manual"): Promise<SyncTriggerResult> {
    if (this.running) {
      const status = this.database.getSyncStatus("syncing");
      return { ok: true, message: "Cloud sync is already running.", status };
    }
    const status = this.database.getSyncStatus();
    if (!status.connected) return { ok: false, message: "Connect this PC to cloud sync first.", status };
    const token = this.decryptToken();
    if (!token) {
      const next = this.database.markSyncDeviceDisconnected("Stored cloud token could not be read. Reconnect this PC.");
      this.emit(next);
      return { ok: false, message: next.lastError, status: next };
    }

    this.running = true;
    this.emit(this.database.updateSyncRuntime({ lastStatus: "syncing", lastError: "" }));
    try {
      const bootstrapStatus = this.database.getSyncStatus("syncing");
      if (bootstrapStatus.lastRevision === 0 && bootstrapStatus.pendingCount === 0) {
        await this.pullRemote(token);
        if (this.database.getSyncStatus("syncing").lastRevision === 0) {
          const seeded = this.database.seedLocalRecordsForSync();
          if (seeded.queued > 0) this.emit(this.database.getSyncStatus("syncing"));
        }
      }
      await this.uploadPendingFiles(token);
      await this.pushPending(token);
      await this.pullRemote(token);
      const next = this.database.updateSyncRuntime({ lastStatus: "connected", lastError: "" });
      this.emit(next);
      this.log("info", "Cloud sync completed", { reason, pendingCount: next.pendingCount, conflictCount: next.conflictCount });
      return { ok: true, message: "Cloud sync completed.", status: next };
    } catch (error) {
      const message = toErrorMessage(error);
      const next = this.database.updateSyncRuntime({ lastStatus: "error", lastError: message });
      this.emit(next);
      this.log("error", "Cloud sync failed", { reason, message });
      return { ok: false, message, status: next };
    } finally {
      this.running = false;
    }
  }

  listConflicts() {
    return this.database.listSyncConflicts();
  }

  resolveConflict(conflictId: string, resolution: SyncConflictResolution) {
    const conflict = this.database.resolveSyncConflict(conflictId, resolution);
    this.emit(this.database.getSyncStatus());
    return conflict;
  }

  async checkDeviceApproval(): Promise<SyncDeviceStatus> {
    const status = this.database.getSyncStatus();
    const token = this.decryptToken();
    if (!status.configured || !status.cloudUrl || !token) return status;
    try {
      const response = await this.fetchWithTimeout(`${status.cloudUrl}/api/v1/auth/devices/current/status`, {
        method: "GET",
        headers: this.authHeaders(token)
      }, 6000);
      const body = await this.readJson(response);
      if (response.status === 401) {
        const next = this.database.markSyncDeviceDisconnected(this.apiErrorMessage(body, "Cloud device is no longer valid. Reconnect this PC."), "REVOKED");
        this.emit(next);
        return next;
      }
      if (!response.ok) throw new Error(this.apiErrorMessage(body, "Unable to check device approval."));
      const approvalStatus = this.normalizeApprovalStatus(body.data?.approvalStatus || body.approvalStatus || body.data?.device?.approvalStatus || "PENDING");
      if (approvalStatus === "APPROVED") {
        const next = this.database.updateSyncRuntime({ approvalStatus: "APPROVED", lastStatus: "connected", lastError: "" });
        this.emit(next);
        return next;
      }
      if (approvalStatus === "REVOKED") {
        const next = this.database.markSyncDeviceDisconnected("Cloud device was revoked by owner.", "REVOKED");
        this.emit(next);
        return next;
      }
      const next = this.database.updateSyncRuntime({ approvalStatus: "PENDING", lastStatus: "pending_approval", lastError: "Waiting for owner approval." });
      this.emit(next);
      return next;
    } catch (error) {
      const message = cleanCloudConnectionError(error);
      const next = status.approvalStatus === "APPROVED"
        ? this.database.updateSyncRuntime({ lastStatus: "error", lastError: message })
        : this.database.updateSyncRuntime({ approvalStatus: "PENDING", lastStatus: "pending_approval", lastError: message });
      this.emit(next);
      this.log("warn", "Cloud device approval check failed", { message });
      return next;
    }
  }

  async listCloudDevices(input: CloudDeviceOwnerCredentials): Promise<CloudDeviceListResult> {
    return this.cloudRequest<CloudDeviceListResult>("/api/v1/admin/devices/list", {
      method: "POST",
      body: input
    });
  }

  async approveCloudDevice(input: CloudDeviceApprovalInput): Promise<CloudDeviceSummary> {
    const data = await this.cloudRequest<{ device: CloudDeviceSummary }>(`/api/v1/admin/devices/${encodeURIComponent(input.deviceId)}/approve`, {
      method: "POST",
      body: { ownerUsername: input.ownerUsername, ownerPassword: input.ownerPassword }
    });
    return data.device;
  }

  async revokeCloudDevice(input: CloudDeviceApprovalInput): Promise<CloudDeviceSummary> {
    const data = await this.cloudRequest<{ device: CloudDeviceSummary }>(`/api/v1/admin/devices/${encodeURIComponent(input.deviceId)}/revoke`, {
      method: "POST",
      body: { ownerUsername: input.ownerUsername, ownerPassword: input.ownerPassword }
    });
    return data.device;
  }

  async finalizeInvoiceNumber(input: {
    source?: "invoice" | "invoice_draft" | "job_card" | "quotation" | "repair";
    localId?: string;
    payload?: Record<string, unknown>;
  }) {
    const status = this.database.getSyncStatus();
    if (!status.connected) throw new Error("Connect Cloud Sync before creating a final invoice.");
    const token = this.decryptToken();
    if (!token) {
      const next = this.database.markSyncDeviceDisconnected("Stored cloud token could not be read. Reconnect this PC.");
      this.emit(next);
      throw new Error("Reconnect Cloud Sync before creating a final invoice.");
    }
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${status.cloudUrl}/api/v1/invoices/finalize`, {
        method: "POST",
        headers: this.authHeaders(token),
        body: JSON.stringify({
          source: input.source || "invoice",
          localId: input.localId || "",
          idempotencyKey: input.localId ? `invoice-finalize:${input.source || "invoice"}:${input.localId}` : randomUUID(),
          payload: input.payload || {}
        })
      });
    } catch (error) {
      const message = this.markCloudUnavailable(error);
      throw new Error(`${message} Saved as draft.`);
    }
    const body = await this.readJson(response);
    if (response.status === 401) {
      const message = this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC.");
      this.database.markSyncDeviceDisconnected(message, "REVOKED");
      throw new Error(message);
    }
    if (!response.ok) throw new Error(this.apiErrorMessage(body, "Internet required to create final invoice number. Saved as draft."));
    const invoiceNumber = String(body.data?.invoiceNumber || body.invoiceNumber || "");
    if (!invoiceNumber) throw new Error("Cloud did not return an official invoice number.");
    this.database.updateSyncRuntime({ lastPushAt: new Date().toISOString(), lastStatus: "connected", lastError: "" });
    this.emit(this.database.getSyncStatus());
    return {
      invoiceNumber,
      assignedAt: String(body.data?.assignedAt || body.assignedAt || new Date().toISOString()),
      invoice: body.data?.invoice || body.invoice
    };
  }

  async cloudRequest<T = unknown>(path: string, options: CloudRequestOptions = {}): Promise<T> {
    const status = this.database.getSyncStatus();
    if (!status.connected) throw new Error("Cloud connection required. Connect this PC before using online business data.");
    const token = this.decryptToken();
    if (!token) {
      const next = this.database.markSyncDeviceDisconnected("Stored cloud token could not be read. Reconnect this PC.");
      this.emit(next);
      throw new Error("Cloud connection required. Reconnect this PC.");
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${status.cloudUrl}${normalizedPath}`, {
        method: options.method || "GET",
        headers: this.authHeaders(token),
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      throw new Error(this.markCloudUnavailable(error));
    }
    const body = await this.readJson(response);
    if (response.status === 401) {
      const message = this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC.");
      this.database.markSyncDeviceDisconnected(message, "REVOKED");
      this.emit(this.database.getSyncStatus());
      throw new Error(message);
    }
    if (!response.ok) throw new Error(this.apiErrorMessage(body, "Cloud server is not reachable."));
    this.database.updateSyncRuntime({
      lastStatus: "connected",
      lastError: "",
      ...(options.method && options.method !== "GET" ? { lastPushAt: new Date().toISOString() } : { lastPullAt: new Date().toISOString() })
    });
    this.emit(this.database.getSyncStatus());
    return (body.data ?? body) as T;
  }

  async cloudBinaryDataUrl(path: string): Promise<string> {
    const status = this.database.getSyncStatus();
    if (!status.connected) throw new Error("Cloud connection required. Connect this PC before using online business data.");
    const token = this.decryptToken();
    if (!token) {
      const next = this.database.markSyncDeviceDisconnected("Stored cloud token could not be read. Reconnect this PC.");
      this.emit(next);
      throw new Error("Cloud connection required. Reconnect this PC.");
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${status.cloudUrl}${normalizedPath}`, {
        headers: { authorization: `Bearer ${token}` }
      });
    } catch (error) {
      throw new Error(this.markCloudUnavailable(error));
    }
    if (response.status === 401) {
      const body = await this.readJson(response);
      const message = this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC.");
      this.database.markSyncDeviceDisconnected(message, "REVOKED");
      this.emit(this.database.getSyncStatus());
      throw new Error(message);
    }
    if (!response.ok) throw new Error("Cloud file is not reachable.");
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const bytes = Buffer.from(await response.arrayBuffer());
    this.database.updateSyncRuntime({ lastStatus: "connected", lastError: "", lastPullAt: new Date().toISOString() });
    this.emit(this.database.getSyncStatus());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  }

  private async pushPending(token: string) {
    const pending = this.database.listPendingSyncOutbox(50);
    if (!pending.length) return;
    for (const entry of pending) {
      const current = this.database.getSyncStatus("syncing");
      const response = await fetch(`${current.cloudUrl}/api/v1/sync/push`, {
        method: "POST",
        headers: this.authHeaders(token),
        body: JSON.stringify({
          deviceId: current.deviceId,
          idempotencyKey: randomUUID(),
          baseRevision: current.lastRevision,
          operations: [{
            idempotencyKey: entry.idempotencyKey,
            type: entry.operationType,
            entity: entry.entity,
            localId: entry.localId,
            data: entry.payload,
            fileRefs: entry.fileRefs,
            baseRevision: entry.baseRevision,
            timestamp: entry.createdAt
          }]
        })
      });
      const body = await this.readJson(response);
      if (response.status === 401) {
        this.database.markSyncDeviceDisconnected(this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC."), "REVOKED");
        throw new Error("Cloud device was revoked. Reconnect this PC.");
      }
      if (response.status === 409) {
        this.recordConflict(body, entry.entity, entry.localId);
        this.database.markSyncOutboxFailed(entry.id, "Cloud has a newer version of this record.", true);
        continue;
      }
      if (!response.ok) {
        const message = this.apiErrorMessage(body, "Unable to push local changes.");
        this.database.markSyncOutboxFailed(entry.id, message);
        throw new Error(message);
      }
      const canonicalRows = (body.data?.canonicalRows || body.canonicalRows || []) as Array<{
        entity?: string;
        localId?: string;
        recordId?: string;
        invoiceNumber?: string;
        quotationNumber?: string;
        jobNumber?: string;
        revision?: number;
      }>;
      this.database.applyCloudCanonicalRows(canonicalRows);
      this.database.markSyncOutboxPushed([entry.id]);
      const newRevision = Number(body.data?.newRevision ?? body.newRevision ?? current.lastRevision);
      this.database.updateSyncRevision("global", newRevision);
      this.database.updateSyncRuntime({ lastPushAt: new Date().toISOString() });
    }
  }

  private async uploadPendingFiles(token: string) {
    const pendingFiles = this.database.listPendingSyncFiles(10);
    if (!pendingFiles.length) return;
    const current = this.database.getSyncStatus("syncing");
    for (const file of pendingFiles) {
      try {
        if (!fs.existsSync(file.localPath)) throw new Error("Local file was not found.");
        const bytes = fs.readFileSync(file.localPath);
        const digest = createHash("sha256").update(bytes).digest("hex");
        const response = await fetch(`${current.cloudUrl}/api/v1/files`, {
          method: "POST",
          headers: this.authHeaders(token),
          body: JSON.stringify({
            entity: file.entity || "",
            entityId: file.entityId || "",
            fileType: file.fileType || "PHOTO",
            originalName: path.basename(file.localPath),
            mimeType: this.fileMime(file.localPath),
            sha256: digest,
            dataBase64: bytes.toString("base64")
          })
        });
        const body = await this.readJson(response);
        if (response.status === 401) {
          this.database.markSyncDeviceDisconnected(this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC."), "REVOKED");
          throw new Error("Cloud device was revoked. Reconnect this PC.");
        }
        if (!response.ok) throw new Error(this.apiErrorMessage(body, "Unable to upload sync file."));
        this.database.markSyncFileUploaded(
          file.localPath,
          String(body.data?.fileId || body.fileId || ""),
          String(body.data?.sha256 || body.sha256 || digest),
          Number(body.data?.sizeBytes || body.sizeBytes || bytes.length)
        );
      } catch (error) {
        const message = toErrorMessage(error);
        this.database.markSyncFileFailed(file.localPath, message);
        this.log("warn", "Cloud sync file upload failed", { path: file.localPath, message });
      }
    }
  }

  private async pullRemote(token: string) {
    const status = this.database.getSyncStatus("syncing");
    const response = await fetch(`${status.cloudUrl}/api/v1/sync/pull?sinceRevision=${encodeURIComponent(String(status.lastRevision))}`, {
      headers: this.authHeaders(token)
    });
    const body = await this.readJson(response);
    if (response.status === 401) {
      this.database.markSyncDeviceDisconnected(this.apiErrorMessage(body, "Cloud device was revoked. Reconnect this PC."), "REVOKED");
      throw new Error("Cloud device was revoked. Reconnect this PC.");
    }
    if (!response.ok) throw new Error(this.apiErrorMessage(body, "Unable to pull cloud changes."));
    const records = (body.data?.records || body.records || []) as Array<{
      entity?: SyncEntity;
      recordId?: string;
      data?: Record<string, unknown> | string | null;
      revision?: number;
      deletedAt?: string | null;
    }>;
    this.database.applyCloudRecords(records);
    const newestRecordRevision = records.reduce((max, record) => Math.max(max, Number(record.revision || 0)), status.lastRevision);
    const newRevision = Number(body.data?.newRevision ?? body.newRevision ?? newestRecordRevision);
    this.database.updateSyncRevision("global", Math.max(status.lastRevision, newRevision));
    this.database.updateSyncRuntime({ lastPullAt: new Date().toISOString() });
  }

  private recordConflict(body: Record<string, unknown>, fallbackEntity: SyncEntity, fallbackLocalId: string) {
    const data = (body.data || body) as Record<string, unknown>;
    this.database.recordSyncConflict({
      conflictId: String(data.conflictId || randomUUID()),
      entity: String(data.entity || fallbackEntity) as SyncEntity,
      localId: String(data.localId || fallbackLocalId),
      localVersion: (data.localVersion || {}) as Record<string, unknown>,
      serverVersion: (data.serverVersion || {}) as Record<string, unknown>
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private markCloudUnavailable(error: unknown) {
    const message = cleanCloudConnectionError(error);
    const next = this.database.updateSyncRuntime({ lastStatus: "error", lastError: message });
    this.emit(next);
    this.log("warn", "Cloud API unavailable", { message });
    return message;
  }

  private authHeaders(token: string) {
    return {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json"
    };
  }

  private fileMime(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".gif") return "image/gif";
    if (extension === ".bmp") return "image/bmp";
    if (extension === ".pdf") return "application/pdf";
    return "application/octet-stream";
  }

  private encryptToken(token: string) {
    if (safeStorage.isEncryptionAvailable()) return `safe:${safeStorage.encryptString(token).toString("base64")}`;
    return `plain:${Buffer.from(token, "utf8").toString("base64")}`;
  }

  private decryptToken() {
    const row = this.database.getSyncDeviceRecord();
    const value = row ? String(row.tokenCiphertext || "") : "";
    if (!value) return "";
    try {
      if (value.startsWith("safe:")) return safeStorage.decryptString(Buffer.from(value.slice(5), "base64"));
      if (value.startsWith("plain:")) return Buffer.from(value.slice(6), "base64").toString("utf8");
      return value;
    } catch {
      return "";
    }
  }

  private async readJson(response: Response) {
    try {
      return await response.json() as Record<string, any>;
    } catch {
      return {};
    }
  }

  private apiErrorMessage(body: Record<string, unknown>, fallback: string) {
    const parsed = body as ApiErrorBody;
    return parsed.error?.message || parsed.message || parsed.error?.code || parsed.code || fallback;
  }

  private normalizeApprovalStatus(value: unknown): "APPROVED" | "PENDING" | "REVOKED" {
    const text = String(value || "").toUpperCase();
    if (text === "PENDING" || text === "REVOKED") return text;
    return "APPROVED";
  }
}
