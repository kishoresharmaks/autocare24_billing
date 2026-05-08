import { app, safeStorage, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { CloudBackupRecord, DriveBackupResult, DriveConnectionStatus, SaveResult } from "../shared/types";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_BACKUP_FOLDER_NAME = "Autocare24 Backups";
const SQLITE_MIME_TYPE = "application/vnd.sqlite3";
const BACKUP_BUNDLE_MIME_TYPE = "application/octet-stream";
const AUTH_TIMEOUT_MS = 120_000;

interface StoredDriveToken {
  clientId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
  accountEmail: string;
  connectedAt: string;
}

interface DriveCredentials {
  clientId: string;
  clientSecret: string;
}

interface DriveState {
  folderId: string;
  folderName: string;
  accountEmail: string;
  lastUploadAt: string;
  lastUploadName: string;
  lastUploadSizeBytes: number;
  lastLocalBackupPath: string;
  backupCount: number;
  lastError: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DriveFileResponse {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  mimeType?: string;
  trashed?: boolean;
}

const defaultState = (): DriveState => ({
  folderId: "",
  folderName: DRIVE_BACKUP_FOLDER_NAME,
  accountEmail: "",
  lastUploadAt: "",
  lastUploadName: "",
  lastUploadSizeBytes: 0,
  lastLocalBackupPath: "",
  backupCount: 0,
  lastError: ""
});

const base64Url = (buffer: Buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const makeCodeVerifier = () => base64Url(randomBytes(64));
const makeCodeChallenge = (verifier: string) => base64Url(createHash("sha256").update(verifier).digest());

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const driveQueryValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class DriveCloudService {
  private readonly tokenPath: string;
  private readonly statePath: string;
  private readonly downloadDirectory: string;

  constructor(private readonly userDataPath: string) {
    this.tokenPath = path.join(userDataPath, "google-drive-token.bin");
    this.statePath = path.join(userDataPath, "google-drive-state.json");
    this.downloadDirectory = path.join(userDataPath, "drive-downloads");
  }

  getStatus(credentials: DriveCredentials): DriveConnectionStatus {
    const clientId = credentials.clientId.trim();
    const state = this.readState();
    const token = this.readToken(clientId);
    return {
      configured: Boolean(clientId),
      connected: Boolean(token),
      clientId,
      accountEmail: token?.accountEmail || state.accountEmail,
      folderName: state.folderName || DRIVE_BACKUP_FOLDER_NAME,
      folderId: state.folderId,
      lastUploadAt: state.lastUploadAt,
      lastUploadName: state.lastUploadName,
      lastUploadSizeBytes: state.lastUploadSizeBytes,
      backupCount: state.backupCount,
      lastError: state.lastError
    };
  }

  async connect(credentials: DriveCredentials): Promise<DriveConnectionStatus> {
    const normalizedClientId = credentials.clientId.trim();
    const normalizedClientSecret = credentials.clientSecret.trim();
    if (!normalizedClientId) throw new Error("Google Drive OAuth Client ID is required.");
    if (!normalizedClientSecret) throw new Error("Google Drive OAuth Client Secret is required.");
    const { code, redirectUri, codeVerifier } = await this.authorize(normalizedClientId);
    const tokenResponse = await this.exchangeCode({ clientId: normalizedClientId, clientSecret: normalizedClientSecret }, code, redirectUri, codeVerifier);
    if (!tokenResponse.access_token || !tokenResponse.refresh_token) {
      throw new Error("Google did not return a refresh token. Disconnect and connect again with consent.");
    }

    const token: StoredDriveToken = {
      clientId: normalizedClientId,
      refreshToken: tokenResponse.refresh_token,
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + Math.max(60, tokenResponse.expires_in || 3600) * 1000 - 60_000,
      scope: tokenResponse.scope || DRIVE_SCOPE,
      tokenType: tokenResponse.token_type || "Bearer",
      accountEmail: "",
      connectedAt: new Date().toISOString()
    };
    this.writeToken(token);

    const accountEmail = await this.fetchAccountEmail({ clientId: normalizedClientId, clientSecret: normalizedClientSecret }).catch(() => "");
    const folder = await this.ensureBackupFolder({ clientId: normalizedClientId, clientSecret: normalizedClientSecret });
    const saved = this.readToken(normalizedClientId);
    if (saved) this.writeToken({ ...saved, accountEmail });
    this.writeState({ accountEmail, folderId: folder.id, folderName: folder.name, lastError: "" });
    return this.getStatus({ clientId: normalizedClientId, clientSecret: normalizedClientSecret });
  }

  async disconnect(credentials: DriveCredentials): Promise<SaveResult> {
    const token = this.readToken(credentials.clientId);
    if (token?.refreshToken) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.refreshToken }).toString()
      }).catch(() => undefined);
    }
    if (fs.existsSync(this.tokenPath)) fs.unlinkSync(this.tokenPath);
    this.writeState({ accountEmail: "", lastError: "" });
    return { ok: true, message: "Google Drive disconnected." };
  }

  async testConnection(credentials: DriveCredentials): Promise<SaveResult> {
    await this.getAccessToken(credentials);
    const folder = await this.ensureBackupFolder(credentials);
    const backups = await this.listBackups(credentials);
    this.writeState({ folderId: folder.id, folderName: folder.name, backupCount: backups.length, lastError: "" });
    return { ok: true, message: `Google Drive connected. ${backups.length} backup(s) found.` };
  }

  recordFailure(message: string) {
    this.writeState({ lastError: message });
  }

  async uploadBackup(credentials: DriveCredentials, filePath: string): Promise<DriveBackupResult> {
    if (!fs.existsSync(filePath)) throw new Error("Local backup file does not exist.");
    const accessToken = await this.getAccessToken(credentials);
    const folder = await this.ensureBackupFolder(credentials);
    const fileName = path.basename(filePath);
    const sizeBytes = fs.statSync(filePath).size;
    const mimeType = path.extname(filePath).toLowerCase() === ".sqlite" || path.extname(filePath).toLowerCase() === ".db"
      ? SQLITE_MIME_TYPE
      : BACKUP_BUNDLE_MIME_TYPE;
    const metadata = {
      name: fileName,
      mimeType,
      parents: [folder.id]
    };

    const startResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime,modifiedTime,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(sizeBytes)
        },
        body: JSON.stringify(metadata)
      }
    );
    if (!startResponse.ok) throw await this.responseError(startResponse, "Unable to start Google Drive upload.");
    const uploadUrl = startResponse.headers.get("location");
    if (!uploadUrl) throw new Error("Google Drive did not return an upload URL.");

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(sizeBytes)
      },
      body: fs.readFileSync(filePath) as unknown as BodyInit
    });
    if (!uploadResponse.ok) throw await this.responseError(uploadResponse, "Unable to upload backup to Google Drive.");
    const uploaded = (await uploadResponse.json()) as DriveFileResponse;
    const uploadedAt = uploaded.createdTime || new Date().toISOString();
    const state = this.readState();
    this.writeState({
      folderId: folder.id,
      folderName: folder.name,
      lastUploadAt: uploadedAt,
      lastUploadName: uploaded.name || fileName,
      lastUploadSizeBytes: Number(uploaded.size || sizeBytes),
      lastLocalBackupPath: filePath,
      backupCount: Math.max(state.backupCount + 1, 1),
      lastError: ""
    });

    return {
      ok: true,
      message: "Backup uploaded to Google Drive.",
      path: filePath,
      fileId: uploaded.id,
      fileName: uploaded.name || fileName,
      uploadedAt,
      sizeBytes: Number(uploaded.size || sizeBytes)
    };
  }

  async uploadLatestBackupOnce(credentials: DriveCredentials, backupPath: string): Promise<DriveBackupResult | null> {
    const state = this.readState();
    if (!this.readToken(credentials.clientId) || !backupPath || state.lastLocalBackupPath === backupPath) return null;
    return this.uploadBackup(credentials, backupPath);
  }

  async listBackups(credentials: DriveCredentials): Promise<CloudBackupRecord[]> {
    const accessToken = await this.getAccessToken(credentials);
    const folder = await this.ensureBackupFolder(credentials);
    const query = `'${driveQueryValue(folder.id)}' in parents and trashed=false`;
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      "&spaces=drive&pageSize=50&orderBy=createdTime desc&fields=files(id,name,size,createdTime,modifiedTime,webViewLink)";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw await this.responseError(response, "Unable to list Google Drive backups.");
    const data = (await response.json()) as { files?: DriveFileResponse[] };
    const records = (data.files || []).map(this.toBackupRecord);
    this.writeState({ backupCount: records.length, folderId: folder.id, folderName: folder.name, lastError: "" });
    return records;
  }

  async getBackup(credentials: DriveCredentials, fileId: string): Promise<CloudBackupRecord> {
    const accessToken = await this.getAccessToken(credentials);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,createdTime,modifiedTime,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) throw await this.responseError(response, "Unable to read Google Drive backup metadata.");
    return this.toBackupRecord((await response.json()) as DriveFileResponse);
  }

  async downloadBackup(credentials: DriveCredentials, fileId: string): Promise<{ record: CloudBackupRecord; filePath: string }> {
    const accessToken = await this.getAccessToken(credentials);
    const record = await this.getBackup(credentials, fileId);
    fs.mkdirSync(this.downloadDirectory, { recursive: true });
    const filePath = path.join(this.downloadDirectory, record.name.replace(/[<>:"/\\|?*]/g, "_"));
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw await this.responseError(response, "Unable to download Google Drive backup.");
    const data = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, data);
    return { record, filePath };
  }

  private async authorize(clientId: string) {
    const codeVerifier = makeCodeVerifier();
    const codeChallenge = makeCodeChallenge(codeVerifier);
    const state = base64Url(randomBytes(24));

    return new Promise<{ code: string; redirectUri: string; codeVerifier: string }>((resolve, reject) => {
      let settled = false;
      let redirectUri = "";
      const server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url || "/", redirectUri || "http://127.0.0.1");
        if (requestUrl.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");
        const returnedState = requestUrl.searchParams.get("state");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<html><body><h2>Autocare24 Drive connected</h2><p>You can close this browser tab and return to Autocare24 Billing.</p></body></html>");
        server.close();
        if (settled) return;
        settled = true;
        if (error) reject(new Error(`Google authorization failed: ${error}`));
        else if (!code || returnedState !== state) reject(new Error("Google authorization response was invalid."));
        else resolve({ code, redirectUri, codeVerifier });
      });

      server.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: DRIVE_SCOPE,
          access_type: "offline",
          prompt: "consent",
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state
        }).toString();
        shell.openExternal(authUrl.toString()).catch((error) => {
          server.close();
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        server.close();
        reject(new Error("Google authorization timed out."));
      }, AUTH_TIMEOUT_MS);
    });
  }

  private async exchangeCode(credentials: DriveCredentials, code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId.trim(),
        client_secret: credentials.clientSecret.trim(),
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }).toString()
    });
    const token = (await response.json()) as TokenResponse;
    if (!response.ok || token.error) {
      throw new Error(token.error_description || token.error || "Unable to exchange Google authorization code.");
    }
    return token;
  }

  private async getAccessToken(credentials: DriveCredentials): Promise<string> {
    const clientId = credentials.clientId.trim();
    const clientSecret = credentials.clientSecret.trim();
    if (!clientSecret) throw new Error("Google Drive OAuth Client Secret is required.");
    const token = this.readToken(clientId);
    if (!token?.refreshToken) throw new Error("Google Drive is not connected.");
    if (token.accessToken && token.expiresAt > Date.now() + 30_000) return token.accessToken;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token"
      }).toString()
    });
    const refreshed = (await response.json()) as TokenResponse;
    if (!response.ok || refreshed.error || !refreshed.access_token) {
      this.writeState({ lastError: refreshed.error_description || refreshed.error || "Unable to refresh Google Drive token." });
      throw new Error(refreshed.error_description || refreshed.error || "Unable to refresh Google Drive token.");
    }
    const next: StoredDriveToken = {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + Math.max(60, refreshed.expires_in || 3600) * 1000 - 60_000,
      scope: refreshed.scope || token.scope,
      tokenType: refreshed.token_type || token.tokenType
    };
    this.writeToken(next);
    return next.accessToken;
  }

  private async fetchAccountEmail(credentials: DriveCredentials): Promise<string> {
    const accessToken = await this.getAccessToken(credentials);
    const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { user?: { emailAddress?: string; displayName?: string } };
    return data.user?.emailAddress || data.user?.displayName || "";
  }

  private async ensureBackupFolder(credentials: DriveCredentials): Promise<{ id: string; name: string }> {
    const state = this.readState();
    if (state.folderId) {
      const existing = await this.getFolder(credentials, state.folderId).catch(() => null);
      if (existing?.id && !existing.trashed) return { id: existing.id, name: existing.name || DRIVE_BACKUP_FOLDER_NAME };
    }

    const found = await this.findBackupFolder(credentials);
    if (found) {
      this.writeState({ folderId: found.id, folderName: found.name || DRIVE_BACKUP_FOLDER_NAME });
      return { id: found.id, name: found.name || DRIVE_BACKUP_FOLDER_NAME };
    }

    const created = await this.createBackupFolder(credentials);
    this.writeState({ folderId: created.id, folderName: created.name || DRIVE_BACKUP_FOLDER_NAME });
    return { id: created.id, name: created.name || DRIVE_BACKUP_FOLDER_NAME };
  }

  private async getFolder(credentials: DriveCredentials, folderId: string): Promise<DriveFileResponse> {
    const accessToken = await this.getAccessToken(credentials);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) throw await this.responseError(response, "Unable to read Google Drive backup folder.");
    return (await response.json()) as DriveFileResponse;
  }

  private async findBackupFolder(credentials: DriveCredentials): Promise<DriveFileResponse | null> {
    const accessToken = await this.getAccessToken(credentials);
    const query = `mimeType='application/vnd.google-apps.folder' and name='${driveQueryValue(DRIVE_BACKUP_FOLDER_NAME)}' and trashed=false`;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=10&fields=files(id,name,webViewLink)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) throw await this.responseError(response, "Unable to search Google Drive backup folder.");
    const data = (await response.json()) as { files?: DriveFileResponse[] };
    return data.files?.[0] || null;
  }

  private async createBackupFolder(credentials: DriveCredentials): Promise<DriveFileResponse> {
    const accessToken = await this.getAccessToken(credentials);
    const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({
        name: DRIVE_BACKUP_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder"
      })
    });
    if (!response.ok) throw await this.responseError(response, "Unable to create Google Drive backup folder.");
    return (await response.json()) as DriveFileResponse;
  }

  private toBackupRecord(file: DriveFileResponse): CloudBackupRecord {
    return {
      id: file.id,
      name: file.name,
      sizeBytes: Number(file.size || 0),
      createdTime: file.createdTime || "",
      modifiedTime: file.modifiedTime || "",
      webViewLink: file.webViewLink || ""
    };
  }

  private async responseError(response: Response, fallback: string) {
    const text = await response.text().catch(() => "");
    const parsed = parseJson<{ error?: { message?: string }; error_description?: string }>(text, {});
    return new Error(parsed.error?.message || parsed.error_description || `${fallback} (${response.status})`);
  }

  private readToken(clientId: string): StoredDriveToken | null {
    if (!fs.existsSync(this.tokenPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const decrypted = safeStorage.decryptString(fs.readFileSync(this.tokenPath));
      const token = parseJson<StoredDriveToken | null>(decrypted, null);
      if (!token || token.clientId !== clientId.trim()) return null;
      return token;
    } catch {
      return null;
    }
  }

  private writeToken(token: StoredDriveToken) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure token storage is not available on this Windows account.");
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
    fs.writeFileSync(this.tokenPath, safeStorage.encryptString(JSON.stringify(token)));
  }

  private readState(): DriveState {
    if (!fs.existsSync(this.statePath)) return defaultState();
    return { ...defaultState(), ...parseJson<Partial<DriveState>>(fs.readFileSync(this.statePath, "utf8"), {}) };
  }

  private writeState(patch: Partial<DriveState>) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify({ ...this.readState(), ...patch }, null, 2), "utf8");
  }
}

export const createDriveCloudService = () => new DriveCloudService(app.getPath("userData"));
