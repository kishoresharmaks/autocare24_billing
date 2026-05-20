import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent, type Session } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AppDatabase } from "./database";
import { CloudDataClient } from "./cloud-data";
import { createDailyReportArchive } from "./daily-report-backup";
import { createDriveCloudService } from "./drive-cloud";
import { CloudSyncEngine } from "./sync-engine";
import { createAppUpdateService, type AppUpdateService } from "./update-service";
import { hasPermission } from "../shared/access-control";
import {
  APP_COPYRIGHT,
  APP_DESCRIPTION,
  APP_DEVELOPER,
  APP_ID,
  APP_MODULES,
  APP_ORGANIZATION,
  APP_PRODUCTION_READINESS,
  APP_PRODUCT_NAME
} from "../shared/app-info";
import type {
  AppUser,
  BackupCloudSnapshotStatus,
  BackupResult,
  BackupScheduleStatus,
  BusinessSettings,
  CloudBackupRecord,
  CloudDeviceApprovalInput,
  CloudDeviceOwnerCredentials,
  DateRangePreset,
  ChangePasswordInput,
  DailyReportBackupResult,
  DailyReportBackupStatus,
  DriveBackupResult,
  EnquiryFollowupInput,
  EnquiryInput,
  EnquiryStatus,
  ExpenseInput,
  InventoryBatch,
  InventoryDashboardData,
  InventoryMovement,
  InventoryMovementInput,
  InventoryPurchaseInput,
  InvoiceSummary,
  InvoiceAppendItemInput,
  InvoiceCancelInput,
  InvoiceCreateInput,
  InvoiceDetail,
  InvoiceDraftSaveInput,
  JobCardInput,
  JobCardPhotoType,
  JobCardStatus,
  LoginInput,
  PermissionKey,
  PrintInput,
  Payment,
  PurchaseRecord,
  PurchaseRecordInput,
  QuotationSaveInput,
  QuotationStatusInput,
  RecordPaymentInput,
  ReportData,
  ReportDateFilter,
  ReportExportKind,
  SavePdfInput,
  SaveAccessRoleInput,
  SaveUserInput,
  SafeRepairCode,
  SyncConnectInput,
  SyncConflictResolution,
  SyncEntity,
  SetupOwnerInput,
  Supplier,
  WhatsAppSendMessageInput,
  WhatsAppShareInput
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const SPLASH_MIN_VISIBLE_MS = 5000;
const SPLASH_READY_FAIL_OPEN_MS = 2500;
let splashCreatedAt = 0;
let splashVisibleAt = 0;
let splashRevealTimer: NodeJS.Timeout | null = null;
let currentSession: AppUser | null = null;
const database = new AppDatabase();
let driveCloudService: ReturnType<typeof createDriveCloudService> | null = null;
let cloudSyncEngine: CloudSyncEngine | null = null;
let cloudDataClient: CloudDataClient | null = null;
let updateService: AppUpdateService | null = null;
let dailyBackupTimer: NodeJS.Timeout | null = null;
let appQuitting = false;
const cspInstalledSessions = new WeakSet<Session>();
const DAILY_BACKUP_HOUR = 19;
const DAILY_BACKUP_MINUTE = 0;
const DAILY_BACKUP_LABEL = "7:00 PM";
const PACKAGED_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join("; ");
const DEVELOPMENT_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://127.0.0.1:5173 ws://127.0.0.1:5173",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join("; ");
const driveCloud = () => {
  driveCloudService ??= createDriveCloudService();
  return driveCloudService;
};
const cloudSync = () => {
  cloudSyncEngine ??= new CloudSyncEngine(database, logAppEvent, (status) => {
    mainWindow?.webContents.send("sync:status", status);
  });
  return cloudSyncEngine;
};
const cloudData = () => {
  cloudDataClient ??= new CloudDataClient(cloudSync(), { purchaseDocumentRoot: database.getPurchaseDocumentRoot() });
  return cloudDataClient;
};
const appUpdates = () => {
  updateService ??= createAppUpdateService();
  return updateService;
};

const scheduleCloudSyncAfterAction = () => {
  // Cloud-only business data uses direct API calls; legacy sync import remains manual through sync:trigger.
};
app.setAppUserModelId(APP_ID);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const safeExportFileName = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
};

const safePathSegment = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return !cleaned || cleaned === "." || cleaned === ".." ? fallback : cleaned;
};

const todayForInvoice = () => new Date().toISOString().slice(0, 10);
const localDate = (date = new Date()) => {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
};

if (!hasSingleInstanceLock) {
  app.quit();
}

const brandingAssetPath = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, "branding", fileName)
    : path.join(app.getAppPath(), "src", "renderer", "assets", "branding", fileName);

const splashLogoSource = () => {
  const logoPath = brandingAssetPath("autocare24-logo.png");
  try {
    return `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  } catch {
    return pathToFileURL(logoPath).toString();
  }
};

const clearSplashRevealTimer = () => {
  if (!splashRevealTimer) return;
  clearTimeout(splashRevealTimer);
  splashRevealTimer = null;
};

const createSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  const logoUrl = splashLogoSource();
  splashCreatedAt = Date.now();
  splashVisibleAt = 0;
  clearSplashRevealTimer();

  splashWindow = new BrowserWindow({
    width: 560,
    height: 390,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: APP_PRODUCT_NAME,
    backgroundColor: "#061310",
    icon: brandingAssetPath("autocare24.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  const splashHtml = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #061310;
        color: #ffffff;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .splash {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 15px;
        padding: 34px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        overflow: hidden;
      }
      .logo-frame {
        width: min(390px, 100%);
        height: 176px;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.86);
        border-radius: 8px;
        box-shadow: 0 22px 46px rgba(0, 0, 0, 0.28);
        animation: logoEnter 720ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }
      img {
        width: calc(100% - 26px);
        height: calc(100% - 26px);
        object-fit: contain;
        display: block;
        animation: logoPulse 2800ms ease-in-out 900ms infinite;
      }
      h1 {
        margin: 2px 0 0;
        color: #f5f8f7;
        font-size: 24px;
        line-height: 1.15;
        letter-spacing: 0;
        font-weight: 800;
        animation: contentFade 560ms ease 250ms both;
      }
      p {
        margin: 0;
        color: #b9ccc7;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 700;
        animation: contentFade 560ms ease 330ms both;
      }
      .accent {
        width: 180px;
        height: 3px;
        margin-top: 1px;
        background: #ff0000;
        border-radius: 999px;
        animation: accentIn 640ms ease 430ms both;
      }
      .loading-row {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 20px;
        margin-top: 2px;
        color: #d8e5e1;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        animation: contentFade 560ms ease 520ms both;
      }
      .loading-dot {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: #ff0000;
        opacity: 0.4;
        animation: dotPulse 1200ms ease-in-out infinite;
      }
      .loading-dot:nth-child(3) { animation-delay: 180ms; }
      .loading-dot:nth-child(4) { animation-delay: 360ms; }
      .loader-track {
        position: relative;
        width: min(300px, 76%);
        height: 5px;
        margin-top: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        animation: contentFade 560ms ease 610ms both;
      }
      .loader-bar {
        position: absolute;
        inset: 0;
        width: 48%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(255, 0, 0, 0.1), #ff0000, rgba(255, 255, 255, 0.88));
        animation: loadingBar 1700ms cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      @keyframes logoEnter {
        from { opacity: 0; transform: translateY(12px) scale(0.94); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes logoPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.025); }
      }
      @keyframes contentFade {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes accentIn {
        from { opacity: 0; transform: scaleX(0.25); }
        to { opacity: 1; transform: scaleX(1); }
      }
      @keyframes dotPulse {
        0%, 100% { opacity: 0.35; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(-2px); }
      }
      @keyframes loadingBar {
        from { transform: translateX(-112%); }
        to { transform: translateX(220%); }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 1ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 1ms !important;
        }
        .logo-frame,
        img,
        h1,
        p,
        .accent,
        .loading-row,
        .loader-track,
        .loader-bar,
        .loading-dot {
          opacity: 1;
          transform: none;
        }
        .loader-bar {
          width: 100%;
          background: #ff0000;
        }
      }
    </style>
  </head>
  <body>
    <main class="splash">
      <div class="logo-frame"><img src="${logoUrl}" alt="Autocare24" /></div>
      <h1>${APP_PRODUCT_NAME}</h1>
      <div class="accent"></div>
      <div class="loading-row" aria-label="Loading">
        <span>Loading secure workspace</span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    </main>
  </body>
</html>`;

  splashWindow.once("ready-to-show", () => {
    splashVisibleAt = Date.now();
    splashWindow?.show();
  });
  splashWindow.on("closed", () => {
    splashCreatedAt = 0;
    splashVisibleAt = 0;
    clearSplashRevealTimer();
    splashWindow = null;
  });
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`).catch(() => {
    closeSplashWindow();
  });
};

const closeSplashWindow = () => {
  clearSplashRevealTimer();
  splashCreatedAt = 0;
  splashVisibleAt = 0;
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  const windowToClose = splashWindow;
  splashWindow = null;
  windowToClose.close();
};

const isAllowedRendererNavigation = (targetUrl: string) => {
  try {
    const parsed = new URL(targetUrl);
    if (!app.isPackaged) return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === "5173";
    return parsed.protocol === "file:" || parsed.protocol === "data:";
  } catch {
    return false;
  }
};

const normalizedExternalUrlParts = (value: string) => {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname.toLowerCase(),
      port: parsed.port,
      pathname
    };
  } catch {
    return null;
  }
};

const isAllowedExternalUrl = (targetUrl: string) => {
  const target = normalizedExternalUrlParts(targetUrl);
  const allowed = normalizedExternalUrlParts(APP_DEVELOPER.profileUrl);
  if (!target || !allowed) return false;
  return (
    target.protocol === allowed.protocol &&
    target.hostname === allowed.hostname &&
    target.port === allowed.port &&
    target.pathname === allowed.pathname
  );
};

const installRendererCsp = (window: BrowserWindow) => {
  const rendererSession = window.webContents.session;
  if (cspInstalledSessions.has(rendererSession)) return;
  cspInstalledSessions.add(rendererSession);
  const csp = app.isPackaged ? PACKAGED_RENDERER_CSP : DEVELOPMENT_RENDERER_CSP;
  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    const cspHeader = Object.keys(responseHeaders).find((key) => key.toLowerCase() === "content-security-policy") || "Content-Security-Policy";
    callback({
      responseHeaders: {
        ...responseHeaders,
        [cspHeader]: [csp]
      }
    });
  });
};

const createWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: APP_PRODUCT_NAME,
    show: false,
    backgroundColor: "#f6f4ef",
    icon: brandingAssetPath("autocare24.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  installRendererCsp(mainWindow);

  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      closeSplashWindow();
      return;
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      if (splashVisibleAt <= 0) {
        const waitingForSplashMs = Date.now() - splashCreatedAt;
        const remainingReadyWaitMs = SPLASH_READY_FAIL_OPEN_MS - waitingForSplashMs;
        if (remainingReadyWaitMs > 0) {
          clearSplashRevealTimer();
          splashRevealTimer = setTimeout(() => {
            splashRevealTimer = null;
            showMainWindow();
          }, Math.min(100, remainingReadyWaitMs));
          return;
        }
      } else {
        const visibleForMs = Date.now() - splashVisibleAt;
        const remainingMs = SPLASH_MIN_VISIBLE_MS - visibleForMs;
        if (remainingMs > 0) {
          clearSplashRevealTimer();
          splashRevealTimer = setTimeout(() => {
            splashRevealTimer = null;
            showMainWindow();
          }, remainingMs);
          return;
        }
      }
    }
    clearSplashRevealTimer();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    closeSplashWindow();
  };

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(showMainWindow, app.isPackaged ? 80 : 180);
  });
  mainWindow.webContents.on("did-fail-load", (_event, _code, description) => {
    closeSplashWindow();
    dialog.showErrorBox(APP_PRODUCT_NAME, `Unable to open the software window.\n\n${description}`);
    app.quit();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(APP_DEVELOPER.profileUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url)) event.preventDefault();
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173").catch((error) => {
      closeSplashWindow();
      dialog.showErrorBox(APP_PRODUCT_NAME, `Unable to open the development window.\n\n${error.message}`);
      app.quit();
    });
    if (process.env.AUTOCARE_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html")).catch((error) => {
      closeSplashWindow();
      dialog.showErrorBox(APP_PRODUCT_NAME, `Unable to open the installed software.\n\n${error.message}`);
      app.quit();
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: APP_PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: APP_COPYRIGHT,
      website: APP_DEVELOPER.profileUrl,
      authors: [APP_DEVELOPER.name]
    });
    createSplashWindow();
    await database.init();
    try {
      migrateGoogleDriveSecretStorage();
    } catch (error) {
      logAppEvent("warn", "Google Drive client secret secure-storage migration failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
    logAppEvent("info", "Application startup", {
      version: app.getVersion(),
      packaged: app.isPackaged,
      databasePath: database.getDatabasePath()
    });
    registerIpcHandlers();
    cloudSync().start();
    createWindow();
    setTimeout(() => {
      void runDailyScheduledBackup("startup").finally(() => scheduleNextDailyBackup());
    }, 10000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  appQuitting = true;
  if (dailyBackupTimer) {
    clearTimeout(dailyBackupTimer);
    dailyBackupTimer = null;
  }
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_INVOICE_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_LOG_LINES = 400;
type InvoiceAssetKind = "logo" | "signature" | "watermark";
type DailyReportInventorySnapshot = InventoryDashboardData & {
  batches?: Array<InventoryBatch & { itemName?: string; unit?: string }>;
  movements?: InventoryMovement[];
};
type DailyReportDataSource = {
  source: DailyReportBackupResult["source"];
  sourceStatus: string;
  report: ReportData;
  allDuesReport: ReportData;
  invoices: InvoiceSummary[];
  payments: Payment[];
  inventory: DailyReportInventorySnapshot;
  suppliers: Supplier[];
  purchaseRecords: PurchaseRecord[];
};
type StoredDailyReportBackupState = {
  lastReportAt: string;
  lastReportDate: string;
  lastReportPath: string;
  lastDriveUploadAt: string;
  lastDriveUploadName: string;
  lastError: string;
  lastErrorAt: string;
};

const timestampForFile = () => {
  const normalized = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return normalized.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
};

const logDirectory = () => appDataDirectory("logs");
const logPath = () => path.join(logDirectory(), "autocare24.log");

const logAppEvent = (level: "info" | "warn" | "error", message: string, details?: unknown) => {
  try {
    fs.mkdirSync(logDirectory(), { recursive: true });
    const safeDetails = details === undefined ? "" : ` ${JSON.stringify(details, (_key, value) => (String(_key).toLowerCase().includes("password") ? "[redacted]" : value))}`;
    fs.appendFileSync(logPath(), `[${nowLogTime()}] ${level.toUpperCase()} ${message}${safeDetails}\n`, "utf8");
  } catch {
    // Logging must never block billing.
  }
};

const nowLogTime = () => new Date().toISOString();

const readAppLogs = () => {
  try {
    if (!fs.existsSync(logPath())) return [];
    return fs.readFileSync(logPath(), "utf8").split(/\r?\n/).filter(Boolean).slice(-MAX_LOG_LINES);
  } catch {
    return [];
  }
};

const requireAuth = () => {
  if (!currentSession) throw new Error("Please login again.");
  if (!currentSession.active) {
    currentSession = null;
    throw new Error("Please login again.");
  }
  return currentSession;
};

const requirePermission = (permission: PermissionKey) => {
  const user = requireAuth();
  if (!hasPermission(user, permission)) throw new Error("You do not have access to this action.");
  return user;
};

const requireAnyPermission = (permissions: PermissionKey[]) => {
  const user = requireAuth();
  if (!permissions.some((permission) => hasPermission(user, permission))) throw new Error("You do not have access to this action.");
  return user;
};

const authenticated =
  <Args extends unknown[], Result>(handler: (user: AppUser, ...args: Args) => Result | Promise<Result>) =>
  async (_event: IpcMainInvokeEvent, ...args: Args) => {
    try {
      return await handler(requireAuth(), ...args);
    } catch (error) {
      logAppEvent("error", "Authenticated IPC failed", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };

const permitted =
  <Args extends unknown[], Result>(permission: PermissionKey, handler: (user: AppUser, ...args: Args) => Result | Promise<Result>) =>
  async (_event: IpcMainInvokeEvent, ...args: Args) => {
    try {
      return await handler(requirePermission(permission), ...args);
    } catch (error) {
      logAppEvent("error", "Permission IPC failed", {
        permission,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

const permittedAny =
  <Args extends unknown[], Result>(permissions: PermissionKey[], handler: (user: AppUser, ...args: Args) => Result | Promise<Result>) =>
  async (_event: IpcMainInvokeEvent, ...args: Args) => {
    try {
      return await handler(requireAnyPermission(permissions), ...args);
    } catch (error) {
      logAppEvent("error", "Permission IPC failed", {
        permissions,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

const appDataDirectory = (...segments: string[]) => path.join(app.getPath("userData"), ...segments);

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

const validateImageFile = (filePath: string, maxBytes: number) => {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Only image files are allowed.");
  if (!fs.existsSync(resolved)) throw new Error("Image file is not available.");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Image file is not available.");
  if (stat.size > maxBytes) throw new Error("Image file is too large.");
  return { resolved, extension };
};

const invoiceAssetDirectory = () => appDataDirectory("invoice-assets");

const normalizeInvoiceAssetKind = (kind?: string): InvoiceAssetKind => {
  if (kind === "signature" || kind === "watermark") return kind;
  return "logo";
};

const invoiceAssetLabel = (kind: InvoiceAssetKind) => {
  if (kind === "signature") return "Signature";
  if (kind === "watermark") return "Watermark";
  return "Logo";
};

const copyInvoiceAssetToAppData = (kind: InvoiceAssetKind, filePath: string) => {
  const { resolved, extension } = validateImageFile(filePath, MAX_INVOICE_ASSET_BYTES);
  const directory = invoiceAssetDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const target = assertInsideDirectory(directory, path.join(directory, `invoice-${kind}-${randomUUID()}${extension}`));
  fs.copyFileSync(resolved, target);
  return target;
};

const safeInvoiceAssetPath = (filePath?: string) => {
  if (!filePath?.trim()) return "";
  const directory = invoiceAssetDirectory();
  const resolved = assertInsideDirectory(directory, filePath);
  validateImageFile(resolved, MAX_INVOICE_ASSET_BYTES);
  return resolved;
};
const isCloudFileRef = (value?: string) => String(value || "").startsWith("cloud:");
const cloudFileId = (value?: string) => isCloudFileRef(value) ? String(value).slice("cloud:".length) : "";
const GOOGLE_DRIVE_SECRET_KEY = "googleDriveClientSecret";
const GOOGLE_DRIVE_SECRET_CIPHERTEXT_KEY = "googleDriveClientSecretCiphertext";

const encryptedDriveSecret = (secret: string) => {
  const text = secret.trim();
  if (!text) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure Google Drive secret storage is not available on this Windows account.");
  }
  return `safe:${safeStorage.encryptString(text).toString("base64")}`;
};

const decryptedDriveSecret = (value: string) => {
  const text = value.trim();
  if (!text) return "";
  if (!text.startsWith("safe:")) return text;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure Google Drive secret storage is not available on this Windows account.");
  }
  return safeStorage.decryptString(Buffer.from(text.slice(5), "base64"));
};

const clearPlainGoogleDriveSecret = () => {
  if (database.getLocalSettingValue(GOOGLE_DRIVE_SECRET_KEY)) {
    database.saveLocalSettingValue(GOOGLE_DRIVE_SECRET_KEY, "");
  }
};

const saveSecureGoogleDriveSecret = (secret: string) => {
  const ciphertext = encryptedDriveSecret(secret);
  if (!ciphertext) return;
  database.saveLocalSettingValue(GOOGLE_DRIVE_SECRET_CIPHERTEXT_KEY, ciphertext);
  clearPlainGoogleDriveSecret();
};

const readSecureGoogleDriveSecret = () => {
  const ciphertext = database.getLocalSettingValue(GOOGLE_DRIVE_SECRET_CIPHERTEXT_KEY);
  if (ciphertext) return decryptedDriveSecret(ciphertext);
  const legacy = database.getLocalSettingValue(GOOGLE_DRIVE_SECRET_KEY).trim();
  if (!legacy) return "";
  if (legacy.startsWith("safe:")) {
    database.saveLocalSettingValue(GOOGLE_DRIVE_SECRET_CIPHERTEXT_KEY, legacy);
    clearPlainGoogleDriveSecret();
    return decryptedDriveSecret(legacy);
  }
  saveSecureGoogleDriveSecret(legacy);
  return legacy;
};

const migrateGoogleDriveSecretStorage = () => {
  const legacy = database.getLocalSettingValue(GOOGLE_DRIVE_SECRET_KEY).trim();
  if (!legacy) return;
  if (legacy.startsWith("safe:")) {
    database.saveLocalSettingValue(GOOGLE_DRIVE_SECRET_CIPHERTEXT_KEY, legacy);
    clearPlainGoogleDriveSecret();
    logAppEvent("info", "Google Drive client secret moved to local secure storage");
    return;
  }
  saveSecureGoogleDriveSecret(legacy);
  logAppEvent("info", "Google Drive client secret migrated to local secure storage");
};

const publicSettings = (settings: BusinessSettings): BusinessSettings => ({
  ...settings,
  googleDriveClientSecret: ""
});

const cloudSafeSettings = (settings: Partial<BusinessSettings>): Partial<BusinessSettings> => {
  const next = { ...settings };
  delete next.googleDriveClientSecret;
  return next;
};

const safeInvoiceAssetSettings = (settings: Partial<BusinessSettings>) => {
  const next: Partial<BusinessSettings> = { ...settings };
  (["invoiceLogoPath", "invoiceSignaturePath", "invoiceWatermarkPath"] as const).forEach((key) => {
    if (!(key in settings)) return;
    const value = settings[key];
    next[key] = typeof value === "string" && value
      ? isCloudFileRef(value) ? value : safeInvoiceAssetPath(value)
      : value || "";
  });
  if ("googleDriveClientId" in settings) next.googleDriveClientId = settings.googleDriveClientId?.trim() || "";
  if ("googleDriveClientSecret" in settings) {
    const secret = settings.googleDriveClientSecret?.trim() || "";
    if (secret) saveSecureGoogleDriveSecret(secret);
    next.googleDriveClientSecret = "";
  }
  return next;
};

const settingsWithSafeAssets = () => {
  const settings = database.getSettings();
  const next = { ...settings };
  (["invoiceLogoPath", "invoiceSignaturePath", "invoiceWatermarkPath"] as const).forEach((key) => {
    if (!settings[key]) return;
    if (isCloudFileRef(settings[key])) return;
    try {
      next[key] = safeInvoiceAssetPath(settings[key]);
    } catch {
      next[key] = "";
    }
  });
  return publicSettings(next);
};

const queueCloudSync = (
  entity: SyncEntity,
  localId: string,
  payload: Record<string, unknown>,
  operationType: "UPSERT" | "DELETE" = "UPSERT",
  fileRefs: string[] = []
) => {
  try {
    const queued = database.enqueueSyncOperation({ operationType, entity, localId, payload, fileRefs });
    if (queued) scheduleCloudSyncAfterAction();
  } catch (error) {
    logAppEvent("warn", "Unable to queue cloud sync operation", {
      entity,
      localId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

const queueCloudSyncResult = <T extends { id?: string }>(entity: SyncEntity, result: T, operationType: "UPSERT" | "DELETE" = "UPSERT") => {
  if (!result?.id) return result;
  queueCloudSync(entity, result.id, result as Record<string, unknown>, operationType);
  return result;
};

const queueInvoiceDetail = (invoice: InvoiceDetail) => {
  queueCloudSyncResult("customers", invoice.customer);
  queueCloudSyncResult("vehicles", invoice.vehicle);
  queueCloudSyncResult("invoices", invoice);
  invoice.items.forEach((item) => queueCloudSyncResult("invoice_items", item));
  invoice.payments.forEach((payment) => queueCloudSyncResult("payments", payment));
  return invoice;
};

const assignOfficialInvoiceNumber = async (
  source: "invoice" | "invoice_draft" | "job_card" | "quotation" | "repair",
  localId: string,
  payload: Record<string, unknown>
) => {
  try {
    const settings = database.getSettings();
    const invoicePrefix = settings.invoicePrefix || "AUTOCARE24";
    const result = await cloudSync().finalizeInvoiceNumber({
      source,
      localId,
      payload: {
        ...payload,
        invoicePrefix,
        invoiceSequenceFloor: database.getInvoiceSequenceFloor(invoicePrefix)
      }
    });
    return result.invoiceNumber;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/stock/i.test(message) || /revoked|reconnect|connect cloud sync/i.test(message)) throw new Error(message);
    throw new Error("Internet required to create final invoice number. Saved as draft.");
  }
};

const imageMime = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  return "image/png";
};

const invoicePaperSize = () => {
  const value = database.getSettings().invoicePaperSize;
  return value === "Letter" || value === "Legal" ? value : "A4";
};

const getAppInfo = () => {
  const settings = database.getSettings();
  const syncStatus = database.getSyncStatus();
  const syncState = syncStatus.state
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const cloudSync = syncStatus.state === "pending_approval"
    ? `Waiting for owner approval${syncStatus.cloudUrl ? ` - ${syncStatus.cloudUrl}` : ""}`
    : syncStatus.connected
    ? `${syncState}${syncStatus.cloudUrl ? ` - ${syncStatus.cloudUrl}` : ""}`
    : syncStatus.configured
      ? `Configured but disconnected${syncStatus.cloudUrl ? ` - ${syncStatus.cloudUrl}` : ""}`
      : "Not connected";
  return {
    generatedAt: new Date().toISOString(),
    appId: APP_ID,
    appName: app.getName(),
    productName: APP_PRODUCT_NAME,
    description: APP_DESCRIPTION,
    version: app.getVersion(),
    copyright: APP_COPYRIGHT,
    packaged: app.isPackaged,
    releaseMode: app.isPackaged ? "Installed app" : "Development demo",
    organization: {
      ...APP_ORGANIZATION,
      configuredBusinessName: settings.businessName || APP_ORGANIZATION.name,
      phone: settings.phone,
      email: settings.email,
      gstin: settings.gstin,
      state: settings.state,
      address: settings.address
    },
    developer: { ...APP_DEVELOPER },
    storage: {
      mode: "Local PC database with optional Cloud Sync",
      cloudSync,
      databasePath: database.getDatabasePath(),
      userDataPath: app.getPath("userData"),
      backupDirectory: settings.backupDirectory,
      cloudBackup: settings.googleDriveClientId ? "Google Drive configured" : "Google Drive not configured"
    },
    modules: APP_MODULES.map((item) => ({ ...item })),
    readiness: APP_PRODUCTION_READINESS.map((item) => ({ ...item }))
  };
};

const getDeveloperDiagnostics = () => ({
  generatedAt: new Date().toISOString(),
  appId: APP_ID,
  appName: app.getName(),
  productName: APP_PRODUCT_NAME,
  appVersion: app.getVersion(),
  packaged: app.isPackaged,
  organizationName: database.getSettings().businessName || APP_ORGANIZATION.name,
  developerName: APP_DEVELOPER.name,
  developerProfileUrl: APP_DEVELOPER.profileUrl,
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron || "",
  chromeVersion: process.versions.chrome || "",
  nodeVersion: process.versions.node || "",
  databasePath: database.getDatabasePath(),
  databaseSizeBytes: database.getDatabaseSizeBytes(),
  userDataPath: app.getPath("userData"),
  backupDirectory: database.getSettings().backupDirectory,
  logPath: logPath(),
  tableCounts: database.getTableCounts()
});

const exportDiagnosticBundle = () => {
  const directory = path.join(app.getPath("documents"), "Autocare24 Diagnostic Bundles", `autocare24-diagnostics-${timestampForFile()}`);
  fs.mkdirSync(directory, { recursive: true });
  const diagnostics = getDeveloperDiagnostics();
  const health = database.scanDataHealth();
  fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(diagnostics, null, 2), "utf8");
  fs.writeFileSync(path.join(directory, "data-health.json"), JSON.stringify(health, null, 2), "utf8");
  fs.writeFileSync(path.join(directory, "logs.txt"), readAppLogs().join("\n"), "utf8");
  fs.writeFileSync(
    path.join(directory, "README.txt"),
    [
      "Autocare24 diagnostic bundle",
      "",
      "This bundle contains app version, system paths, database health summary, table counts, and recent application logs.",
      "It does not include the SQLite database file, password hashes, customer exports, invoice exports, or raw table data."
    ].join("\n"),
    "utf8"
  );
  logAppEvent("info", "Diagnostic bundle exported", { path: directory });
  return { ok: true, message: "Diagnostic bundle exported successfully.", path: directory };
};

const driveCredentials = () => {
  const settings = database.getSettings();
  return {
    clientId: settings.googleDriveClientId.trim(),
    clientSecret: readSecureGoogleDriveSecret()
  };
};

type StoredBackupScheduleState = {
  lastError: string;
  lastErrorAt: string;
};

const emptyBackupCloudSnapshotStatus = (error = ""): BackupCloudSnapshotStatus => ({
  included: false,
  exportedAt: "",
  entityCount: 0,
  recordCount: 0,
  invoiceCount: 0,
  error
});

const backupScheduleStatePath = () => appDataDirectory("backup-scheduler-state.json");
const dailyReportBackupStatePath = () => appDataDirectory("daily-report-backup-state.json");

const readBackupScheduleState = (): StoredBackupScheduleState => {
  try {
    return {
      lastError: "",
      lastErrorAt: "",
      ...JSON.parse(fs.readFileSync(backupScheduleStatePath(), "utf8"))
    };
  } catch {
    return { lastError: "", lastErrorAt: "" };
  }
};

const writeBackupScheduleState = (patch: Partial<StoredBackupScheduleState>) => {
  const state = { ...readBackupScheduleState(), ...patch };
  fs.mkdirSync(path.dirname(backupScheduleStatePath()), { recursive: true });
  fs.writeFileSync(backupScheduleStatePath(), JSON.stringify(state, null, 2), "utf8");
  return state;
};

const emptyDailyReportBackupState = (): StoredDailyReportBackupState => ({
  lastReportAt: "",
  lastReportDate: "",
  lastReportPath: "",
  lastDriveUploadAt: "",
  lastDriveUploadName: "",
  lastError: "",
  lastErrorAt: ""
});

const readDailyReportBackupState = (): StoredDailyReportBackupState => {
  try {
    return {
      ...emptyDailyReportBackupState(),
      ...JSON.parse(fs.readFileSync(dailyReportBackupStatePath(), "utf8"))
    };
  } catch {
    return emptyDailyReportBackupState();
  }
};

const writeDailyReportBackupState = (patch: Partial<StoredDailyReportBackupState>) => {
  const state = { ...readDailyReportBackupState(), ...patch };
  fs.mkdirSync(path.dirname(dailyReportBackupStatePath()), { recursive: true });
  fs.writeFileSync(dailyReportBackupStatePath(), JSON.stringify(state, null, 2), "utf8");
  return state;
};

const scheduledBackupTimeFor = (date = new Date()) => {
  const scheduled = new Date(date);
  scheduled.setHours(DAILY_BACKUP_HOUR, DAILY_BACKUP_MINUTE, 0, 0);
  return scheduled;
};

const nextDailyBackupRun = (now = new Date()) => {
  const today = scheduledBackupTimeFor(now);
  if (now.getTime() < today.getTime()) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
};

const backupScheduleStatus = (): BackupScheduleStatus => {
  const credentials = driveCredentials();
  const driveStatus = driveCloud().getStatus(credentials);
  const schedulerState = readBackupScheduleState();
  const latestLocal = database.getLatestBackupRecord();
  const latestLocalPath = latestLocal?.path || "";
  return {
    scheduledTime: DAILY_BACKUP_LABEL,
    nextRunAt: nextDailyBackupRun().toISOString(),
    lastLocalBackupAt: latestLocalPath && fs.existsSync(latestLocalPath) ? latestLocal?.createdAt || "" : "",
    lastLocalBackupPath: latestLocalPath && fs.existsSync(latestLocalPath) ? latestLocalPath : "",
    lastDriveUploadAt: driveStatus.lastUploadAt,
    lastDriveUploadName: driveStatus.lastUploadName,
    lastCloudSnapshot: latestLocal?.cloudSnapshot || emptyBackupCloudSnapshotStatus(),
    lastError: schedulerState.lastError || latestLocal?.cloudSnapshot.error || driveStatus.lastError || ""
  };
};

const sendBackupScheduleStatus = () => {
  mainWindow?.webContents.send("backup:schedule-status", backupScheduleStatus());
};

const isDailyReportBackupDue = (now = new Date()) => {
  const reportDate = new Date(now);
  if (now.getHours() < DAILY_BACKUP_HOUR) reportDate.setDate(reportDate.getDate() - 1);
  const dueDate = localDate(reportDate);
  const state = readDailyReportBackupState();
  return state.lastReportDate >= dueDate && state.lastReportPath && fs.existsSync(state.lastReportPath) ? "" : dueDate;
};

const dailyReportBackupStatus = (): DailyReportBackupStatus => {
  const state = readDailyReportBackupState();
  const reportExists = Boolean(state.lastReportPath && fs.existsSync(state.lastReportPath));
  return {
    scheduledTime: DAILY_BACKUP_LABEL,
    nextRunAt: nextDailyBackupRun().toISOString(),
    lastReportAt: reportExists ? state.lastReportAt : "",
    lastReportDate: reportExists ? state.lastReportDate : "",
    lastReportPath: reportExists ? state.lastReportPath : "",
    lastDriveUploadAt: state.lastDriveUploadAt,
    lastDriveUploadName: state.lastDriveUploadName,
    lastError: state.lastError
  };
};

const dailyReportOutputRoot = () => database.getSettings().backupDirectory || database.getDefaultBackupDirectory();

const collectCloudDailyReportData = async (reportDate: string): Promise<DailyReportDataSource> => {
  const filter: ReportDateFilter = { fromDate: reportDate, toDate: reportDate };
  const client = cloudData();
  const [report, allDuesReport, inventory, invoices, payments, suppliers, purchaseRecords] = await Promise.all([
    client.reports(filter),
    client.reports("all"),
    client.inventoryDashboard() as Promise<DailyReportInventorySnapshot>,
    client.listAllInvoices(),
    client.listPayments(),
    client.listSuppliers(),
    client.listPurchaseRecords()
  ]);
  const [batches, movements] = await Promise.all([
    client.listInventoryBatches().catch(() => inventory.batches || []),
    client.listInventoryMovements().catch(() => inventory.movements || inventory.recentMovements || [])
  ]);
  return {
    source: "cloud-api",
    sourceStatus: "Cloud API live data",
    report,
    allDuesReport,
    invoices,
    payments,
    inventory: { ...inventory, batches: inventory.batches || batches, movements: inventory.movements || movements },
    suppliers,
    purchaseRecords
  };
};

const collectLocalDailyReportData = (reportDate: string, fallbackReason = ""): DailyReportDataSource => {
  const filter: ReportDateFilter = { fromDate: reportDate, toDate: reportDate };
  const inventory = database.getInventoryDashboard() as DailyReportInventorySnapshot;
  return {
    source: "local-database",
    sourceStatus: fallbackReason ? `Local database fallback: ${fallbackReason}` : "Local database",
    report: database.getReports(filter),
    allDuesReport: database.getReports("all"),
    invoices: database.listAllInvoices(),
    payments: database.listPayments(),
    inventory: {
      ...inventory,
      batches: database.listInventoryBatches(),
      movements: database.listInventoryMovementsForDate(reportDate)
    },
    suppliers: database.listSuppliers(),
    purchaseRecords: database.listPurchaseRecords()
  };
};

const collectDailyReportData = async (reportDate: string): Promise<DailyReportDataSource> => {
  try {
    return await collectCloudDailyReportData(reportDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAppEvent("warn", "Daily report cloud data unavailable; using local database", { reportDate, message });
    return collectLocalDailyReportData(reportDate, message);
  }
};

const uploadDailyReportToDriveIfConnected = async (filePath: string) => {
  const credentials = driveCredentials();
  const driveStatus = driveCloud().getStatus(credentials);
  if (!credentials.clientId || !driveStatus.connected) return null;
  return driveCloud().uploadBackup(credentials, filePath);
};

const createDailyReportBackup = async (reportDate = localDate(), options: { uploadToDrive?: boolean } = {}): Promise<DailyReportBackupResult> => {
  const generatedAt = new Date().toISOString();
  const data = await collectDailyReportData(reportDate);
  const archive = createDailyReportArchive({
    outputRoot: dailyReportOutputRoot(),
    reportDate,
    generatedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    source: data.source,
    sourceDevice: os.hostname(),
    sourceStatus: data.sourceStatus,
    report: data.report,
    allDuesReport: data.allDuesReport,
    invoices: data.invoices,
    payments: data.payments,
    inventory: data.inventory,
    suppliers: data.suppliers,
    purchaseRecords: data.purchaseRecords
  });

  let driveUpload: DriveBackupResult | null = null;
  let uploadError = "";
  if (options.uploadToDrive !== false) {
    try {
      driveUpload = await uploadDailyReportToDriveIfConnected(archive.filePath);
    } catch (error) {
      uploadError = error instanceof Error ? error.message : String(error);
      driveCloud().recordFailure(uploadError);
      logAppEvent("warn", "Daily report Google Drive upload failed", { path: archive.filePath, message: uploadError });
    }
  }

  const previousReportState = readDailyReportBackupState();
  writeDailyReportBackupState({
    lastReportAt: archive.generatedAt,
    lastReportDate: archive.reportDate,
    lastReportPath: archive.filePath,
    lastDriveUploadAt: driveUpload?.uploadedAt || previousReportState.lastDriveUploadAt,
    lastDriveUploadName: driveUpload?.fileName || previousReportState.lastDriveUploadName,
    lastError: uploadError,
    lastErrorAt: uploadError ? new Date().toISOString() : ""
  });

  const uploadMessage = driveUpload ? " Uploaded to Google Drive." : uploadError ? ` Google Drive upload failed: ${uploadError}` : "";
  return {
    ok: true,
    message: `Daily report backup created for ${reportDate}.${uploadMessage}`,
    path: archive.filePath,
    reportDate: archive.reportDate,
    generatedAt: archive.generatedAt,
    source: archive.source,
    driveUpload
  };
};

const cloudSnapshotOptionsForBackup = async () => {
  try {
    const snapshot = await cloudData().exportCloudSnapshot();
    logAppEvent("info", "Cloud data snapshot exported for backup", snapshot.status);
    return { cloudSnapshot: { data: snapshot.data, status: snapshot.status } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAppEvent("warn", "Cloud data snapshot export failed", { message });
    return { cloudSnapshotStatus: emptyBackupCloudSnapshotStatus(message) };
  }
};

const createManualBackupWithCloudSnapshot = async (): Promise<BackupResult> => {
  const options = await cloudSnapshotOptionsForBackup();
  return database.createManualBackup(options);
};

const runDailyScheduledBackup = async (reason: "startup" | "timer") => {
  let backupPath = "";
  let reportResult: DailyReportBackupResult | null = null;
  try {
    const now = new Date();
    const reportDate = isDailyReportBackupDue(now);
    const backupDue = database.isScheduledBackupDue(now);
    if (!backupDue && !reportDate) {
      sendBackupScheduleStatus();
      return null;
    }

    if (backupDue) {
      backupPath = database.createScheduledBackupIfDue(now, await cloudSnapshotOptionsForBackup());
      if (backupPath) {
        logAppEvent("info", "Daily scheduled backup created", { reason, path: backupPath });
        writeBackupScheduleState({ lastError: "", lastErrorAt: "" });
      }
    }

    if (reportDate) {
      reportResult = await createDailyReportBackup(reportDate);
      logAppEvent("info", "Daily report backup created", {
        reason,
        path: reportResult.path,
        reportDate: reportResult.reportDate,
        source: reportResult.source
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeBackupScheduleState({ lastError: message, lastErrorAt: new Date().toISOString() });
    writeDailyReportBackupState({ lastError: message, lastErrorAt: new Date().toISOString() });
    logAppEvent("warn", "Daily scheduled backup or report failed", { reason, message });
    sendBackupScheduleStatus();
    return null;
  }

  if (!backupPath) {
    sendBackupScheduleStatus();
    return { backupPath, driveResult: null, reportResult };
  }

  const credentials = driveCredentials();
  const driveStatus = driveCloud().getStatus(credentials);
  if (!credentials.clientId || !driveStatus.connected) {
    sendBackupScheduleStatus();
    return { backupPath, driveResult: null, reportResult };
  }

  try {
    const driveResult = await driveCloud().uploadBackup(credentials, backupPath);
    logAppEvent("info", "Daily scheduled backup uploaded to Google Drive", driveResult);
    writeBackupScheduleState({ lastError: "", lastErrorAt: "" });
    sendBackupScheduleStatus();
    return { backupPath, driveResult, reportResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeBackupScheduleState({ lastError: message, lastErrorAt: new Date().toISOString() });
    driveCloud().recordFailure(message);
    logAppEvent("warn", "Daily scheduled Google Drive backup failed", { path: backupPath, message });
    sendBackupScheduleStatus();
    return { backupPath, driveResult: null, reportResult };
  }
};

const scheduleNextDailyBackup = () => {
  if (appQuitting) return;
  if (dailyBackupTimer) {
    clearTimeout(dailyBackupTimer);
    dailyBackupTimer = null;
  }
  const delay = Math.max(1000, nextDailyBackupRun().getTime() - Date.now());
  dailyBackupTimer = setTimeout(() => {
    dailyBackupTimer = null;
    void runDailyScheduledBackup("timer").finally(() => {
      if (!appQuitting) scheduleNextDailyBackup();
    });
  }, delay);
  dailyBackupTimer.unref?.();
  sendBackupScheduleStatus();
};

const formatShareMoney = (value?: number) =>
  `Rs ${(Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
const WHATSAPP_PDF_MAX_BYTES = 18 * 1024 * 1024;

const normalizeIndianPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  throw new Error("A valid 10-digit customer phone number is required for WhatsApp sharing.");
};

const shareStatusLabel = (status?: string) =>
  (status || "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildWhatsAppMessage = (input: WhatsAppShareInput) => {
  const businessName = input.businessName?.trim() || "Autocare24";
  const customer = input.customerName?.trim() || "Customer";
  const customMessage = input.message?.trim();
  if (customMessage) return customMessage;
  if (input.kind === "customer_chat") {
    return [
      `Hi ${customer},`,
      `This is ${businessName}.`
    ].filter(Boolean).join("\n");
  }
  if (input.kind === "invoice") {
    return [
      `Hi ${customer},`,
      `Your invoice ${input.invoiceNumber || ""} from ${businessName} is ready.`,
      `Amount: ${formatShareMoney(input.grandTotal)}`,
      input.balanceDue && input.balanceDue > 0 ? `Balance due: ${formatShareMoney(input.balanceDue)}` : "Payment status: Paid",
      input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
      "Thank you."
    ].filter(Boolean).join("\n");
  }
  if (input.kind === "invoice_pdf") {
    return [
      `Hi ${customer},`,
      `${businessName} invoice PDF is ready.`,
      `Invoice: ${input.invoiceNumber || ""}`,
      `Amount: ${formatShareMoney(input.grandTotal)}`,
      input.balanceDue && input.balanceDue > 0 ? `Balance due: ${formatShareMoney(input.balanceDue)}` : "Payment status: Paid",
      input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
      "Please check the attached PDF.",
      "Thank you."
    ].filter(Boolean).join("\n");
  }
  if (input.kind === "quotation") {
    return [
      `Hi ${customer},`,
      `${businessName} quotation ${input.quotationNumber || ""} is ready.`,
      `Amount: ${formatShareMoney(input.grandTotal)}`,
      input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
      input.validUntil ? `Valid until: ${input.validUntil}` : "",
      "Please confirm if you would like to proceed."
    ].filter(Boolean).join("\n");
  }
  if (input.kind === "due_reminder") {
    if (!input.balanceDue || input.balanceDue <= 0) throw new Error("This invoice has no pending due amount.");
    return [
      `Hi ${customer},`,
      `Payment reminder from ${businessName}.`,
      `Invoice: ${input.invoiceNumber || ""}`,
      `Balance due: ${formatShareMoney(input.balanceDue)}`,
      input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
      "Please complete the payment when convenient."
    ].filter(Boolean).join("\n");
  }
  if (input.kind === "job_card_pdf") {
    return [
      `Hi ${customer},`,
      `${businessName} job card PDF is ready.`,
      `Job card: ${input.jobNumber || ""}`,
      input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
      input.grandTotal !== undefined ? `Estimate: ${formatShareMoney(input.grandTotal)}` : "",
      [input.expectedDeliveryDate, input.expectedDeliveryTime].filter(Boolean).length
        ? `Expected delivery: ${[input.expectedDeliveryDate, input.expectedDeliveryTime].filter(Boolean).join(" ")}`
        : "",
      "Please check the attached PDF.",
      "Thank you."
    ].filter(Boolean).join("\n");
  }
  return [
    `Hi ${customer},`,
    `${businessName} job card update.`,
    `Job card: ${input.jobNumber || ""}`,
    `Status: ${shareStatusLabel(input.status) || "Updated"}`,
    input.vehicleNumber ? `Vehicle: ${input.vehicleNumber}` : "",
    [input.expectedDeliveryDate, input.expectedDeliveryTime].filter(Boolean).length
      ? `Expected delivery: ${[input.expectedDeliveryDate, input.expectedDeliveryTime].filter(Boolean).join(" ")}`
      : "",
    "Thank you."
  ].filter(Boolean).join("\n");
};

const whatsappTemplateForShare = (kind: WhatsAppShareInput["kind"]) => {
  if (kind === "invoice_pdf") return "invoice_pdf_ready";
  if (kind === "invoice") return "invoice_ready";
  if (kind === "due_reminder") return "payment_reminder";
  if (kind === "quotation") return "quotation_ready";
  if (kind === "job_card_pdf") return "job_card_pdf_ready";
  if (kind === "job_card_status") return "job_card_update";
  return "customer_chat";
};

const whatsappSourceForShare = (input: WhatsAppShareInput) => {
  if (input.invoiceNumber) return { type: "invoice", id: input.invoiceNumber };
  if (input.quotationNumber) return { type: "quotation", id: input.quotationNumber };
  if (input.jobNumber) return { type: "job_card", id: input.jobNumber };
  return { type: "customer", id: input.customerName || input.phone };
};

const whatsappVariablesForShare = (input: WhatsAppShareInput, message: string) => [
  input.customerName || "Customer",
  input.businessName || "Autocare24",
  input.invoiceNumber || input.quotationNumber || input.jobNumber || "",
  input.grandTotal === undefined ? "" : formatShareMoney(input.grandTotal),
  input.balanceDue === undefined ? "" : formatShareMoney(input.balanceDue),
  input.vehicleNumber || "",
  shareStatusLabel(input.status) || "",
  message
].filter((value) => String(value || "").trim());

const readWhatsAppPdfMedia = (input: WhatsAppShareInput): WhatsAppSendMessageInput["media"] | undefined => {
  if (input.kind !== "invoice_pdf" && input.kind !== "job_card_pdf") return undefined;
  if (!input.documentPath) throw new Error("PDF file is required before sending this WhatsApp document.");
  const resolvedPath = path.resolve(input.documentPath);
  if (!fs.existsSync(resolvedPath)) throw new Error("PDF file was not found. Please generate the PDF again.");
  const documentsRoot = fs.realpathSync(app.getPath("documents"));
  const realPath = fs.realpathSync(resolvedPath);
  if (!isInsideDirectory(documentsRoot, realPath)) {
    throw new Error("WhatsApp PDF sharing can only send app-generated PDFs saved under Documents.");
  }
  if (path.extname(realPath).toLowerCase() !== ".pdf") throw new Error("Only PDF files can be sent through this WhatsApp document flow.");
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) throw new Error("PDF path is not a file.");
  if (stat.size <= 0) throw new Error("PDF file is empty.");
  if (stat.size > WHATSAPP_PDF_MAX_BYTES) throw new Error("PDF is too large for this WhatsApp send flow. Please reduce the PDF size.");
  const data = fs.readFileSync(realPath);
  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("The selected file is not a valid PDF.");
  const fileName = safeExportFileName(input.documentFileName || path.basename(realPath), "autocare24-document.pdf");
  return {
    fileName: fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`,
    mimeType: "application/pdf",
    base64: data.toString("base64"),
    sizeBytes: data.length
  };
};

const buildWhatsAppBusinessSendInput = (input: WhatsAppShareInput): WhatsAppSendMessageInput => {
  const phone = normalizeIndianPhone(input.phone || "");
  const message = buildWhatsAppMessage(input);
  const media = readWhatsAppPdfMedia(input);
  return {
    phone,
    customerName: input.customerName,
    mode: "template",
    text: message,
    templateName: whatsappTemplateForShare(input.kind),
    languageCode: "en",
    variables: whatsappVariablesForShare(input, message),
    ...(media ? { media } : {}),
    source: whatsappSourceForShare(input)
  };
};

const registerIpcHandlers = () => {
  ipcMain.handle("app:openExternal", (_event, url: string) => {
    if (!isAllowedExternalUrl(url)) throw new Error("External link is not allowed.");
    return shell.openExternal(APP_DEVELOPER.profileUrl).then(() => true);
  });
  ipcMain.handle("app:getInfo", authenticated(() => getAppInfo()));
  ipcMain.handle("updates:status", authenticated(() => appUpdates().getStatus()));
  ipcMain.handle("updates:check", authenticated(() => appUpdates().checkForUpdates()));
  ipcMain.handle("updates:download", authenticated(() => appUpdates().downloadUpdate()));
  ipcMain.handle("updates:install", authenticated(() => appUpdates().installUpdate()));
  ipcMain.handle("auth:status", async () => {
    if (currentSession) {
      const sessionId = currentSession.id;
      try {
        const freshUser = await cloudData().getUserById(sessionId);
        currentSession = freshUser?.active ? freshUser : null;
      } catch {
        const freshUser = database.getUserById(sessionId);
        currentSession = freshUser?.active ? freshUser : null;
      }
    }
    try {
      return { ...(await cloudData().authStatus()), currentUser: currentSession };
    } catch {
      return { ...database.getAuthStatus(), currentUser: currentSession };
    }
  });
  ipcMain.handle("auth:existingBusinessStatus", () => cloudSync().checkStatus());
  ipcMain.handle("auth:connectExistingBusiness", async (_event, input: SyncConnectInput) => {
    currentSession = null;
    return cloudSync().connect(input);
  });
  ipcMain.handle("auth:checkExistingBusinessApproval", async () => {
    currentSession = null;
    return cloudSync().checkDeviceApproval();
  });
  ipcMain.handle("auth:setupOwner", async (_event, input: SetupOwnerInput) => {
    let user: AppUser;
    const syncStatus = cloudSync().status();
    if (syncStatus.approvalStatus === "PENDING" || syncStatus.state === "pending_approval") {
      throw new Error("This PC is waiting for existing business approval. Use staff login after owner approval instead of creating a new owner.");
    }
    try {
      user = await cloudData().setupOwner(input);
      if (!database.getAuthStatus().hasUsers) {
        try {
          database.setupOwner(input, user.id);
          logAppEvent("info", "Owner account mirrored to local database", { username: user.username });
        } catch (mirrorError) {
          logAppEvent("warn", "Cloud owner account was created but local mirror failed", {
            username: user.username,
            message: mirrorError instanceof Error ? mirrorError.message : String(mirrorError)
          });
        }
      }
    } catch (error) {
      if (cloudSync().status().connected) throw error;
      user = database.setupOwner(input);
    }
    currentSession = user;
    logAppEvent("info", "Owner account configured", { username: user.username });
    return user;
  });
  ipcMain.handle("auth:login", async (_event, input: LoginInput) => {
    let user: AppUser;
    try {
      user = await cloudData().login(input);
    } catch (error) {
      if (cloudSync().status().connected) throw error;
      user = database.login(input);
    }
    currentSession = user;
    logAppEvent("info", "User login", { username: user.username, role: user.role });
    return user;
  });
  ipcMain.handle("auth:logout", () => {
    logAppEvent("info", "User logout", { username: currentSession?.username || "" });
    currentSession = null;
    return true;
  });
  ipcMain.handle("users:list", permitted("users.manage", () => cloudData().listUsers()));
  ipcMain.handle("users:save", permitted("users.manage", (_user, input: SaveUserInput) => cloudData().saveUser(input)));
  ipcMain.handle("users:deactivate", permitted("users.manage", (_user, id: string) => cloudData().deactivateUser(id)));
  ipcMain.handle("roles:list", permitted("users.manage", () => cloudData().listAccessRoles()));
  ipcMain.handle("roles:save", permitted("users.manage", (_user, input: SaveAccessRoleInput) => cloudData().saveAccessRole(input)));
  ipcMain.handle("roles:deactivate", permitted("users.manage", (_user, id: string) => cloudData().deactivateAccessRole(id)));
  ipcMain.handle("users:changePassword", authenticated(async (user, input: ChangePasswordInput) => {
    if (input.userId !== user.id) {
      requirePermission("users.manage");
    } else if (!input.currentPassword) {
      throw new Error("Current password is required.");
    }
    try {
      return await cloudData().changePassword(input);
    } catch (error) {
      if (cloudSync().status().connected) throw error;
      return database.changePassword(input);
    }
  }));
  ipcMain.handle("dashboard:get", permitted("dashboard.view", () => cloudData().dashboard()));
  ipcMain.handle("settings:get", authenticated(async () => publicSettings(await cloudData().getSettings(settingsWithSafeAssets()))));
  ipcMain.handle("settings:save", permitted("settings.manage", async (_user, settings: Partial<BusinessSettings>) => {
    const nextSettings = safeInvoiceAssetSettings(settings);
    if (nextSettings.invoiceLogoPath && !isCloudFileRef(nextSettings.invoiceLogoPath)) {
      nextSettings.invoiceLogoPath = await cloudData().uploadInvoiceAsset(nextSettings.invoiceLogoPath, "logo");
    }
    if (nextSettings.invoiceSignaturePath && !isCloudFileRef(nextSettings.invoiceSignaturePath)) {
      nextSettings.invoiceSignaturePath = await cloudData().uploadInvoiceAsset(nextSettings.invoiceSignaturePath, "signature");
    }
    if (nextSettings.invoiceWatermarkPath && !isCloudFileRef(nextSettings.invoiceWatermarkPath)) {
      nextSettings.invoiceWatermarkPath = await cloudData().uploadInvoiceAsset(nextSettings.invoiceWatermarkPath, "watermark");
    }
    if ("googleDriveClientId" in nextSettings || "googleDriveClientSecret" in nextSettings) {
      database.saveSettings({
        googleDriveClientId: nextSettings.googleDriveClientId ?? database.getSettings().googleDriveClientId,
        googleDriveClientSecret: ""
      });
      clearPlainGoogleDriveSecret();
    }
    const saved = await cloudData().saveSettings({
      ...(await cloudData().getSettings(settingsWithSafeAssets())),
      ...cloudSafeSettings(nextSettings)
    });
    return publicSettings(saved);
  }));
  ipcMain.handle("settings:pickAsset", permitted("settings.manage", async (_user, requestedKind?: string) => {
    const kind = normalizeInvoiceAssetKind(requestedKind);
    const label = invoiceAssetLabel(kind);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: `Select invoice ${label.toLowerCase()}`,
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { ok: false, message: `${label} selection cancelled.` };
    return { ok: true, message: `${label} selected.`, path: copyInvoiceAssetToAppData(kind, filePath) };
  }));
  ipcMain.handle("settings:pickLogo", permitted("settings.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Select invoice logo",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { ok: false, message: "Logo selection cancelled." };
    return { ok: true, message: "Logo selected.", path: copyInvoiceAssetToAppData("logo", filePath) };
  }));
  ipcMain.handle("settings:readAsset", authenticated(async (_user, filePath?: string) => {
    try {
      if (isCloudFileRef(filePath)) {
        return {
          ok: true,
          message: "Invoice asset loaded.",
          dataUrl: await cloudSync().cloudBinaryDataUrl(`/api/v1/files/${encodeURIComponent(cloudFileId(filePath))}`)
        };
      }
      const assetPath = safeInvoiceAssetPath(filePath);
      if (!assetPath) {
        return { ok: false, message: "Invoice asset file is not available." };
      }
      const data = fs.readFileSync(assetPath).toString("base64");
      return { ok: true, message: "Invoice asset loaded.", dataUrl: `data:${imageMime(assetPath)};base64,${data}` };
    } catch {
      return { ok: false, message: "Invoice asset file is not available." };
    }
  }));
  ipcMain.handle("settings:readLogo", authenticated(async (_user, filePath?: string) => {
    try {
      if (isCloudFileRef(filePath)) {
        return {
          ok: true,
          message: "Logo loaded.",
          dataUrl: await cloudSync().cloudBinaryDataUrl(`/api/v1/files/${encodeURIComponent(cloudFileId(filePath))}`)
        };
      }
      const assetPath = safeInvoiceAssetPath(filePath);
      if (!assetPath) return { ok: false, message: "Logo file is not available." };
      const data = fs.readFileSync(assetPath).toString("base64");
      return { ok: true, message: "Logo loaded.", dataUrl: `data:${imageMime(assetPath)};base64,${data}` };
    } catch {
      return { ok: false, message: "Logo file is not available." };
    }
  }));
  ipcMain.handle("sync:status", permitted("backup.manage", () => cloudSync().checkStatus()));
  ipcMain.handle("sync:connect", permitted("backup.manage", (_user, input: SyncConnectInput) => cloudSync().connect(input)));
  ipcMain.handle("sync:disconnect", permitted("backup.manage", () => cloudSync().disconnect()));
  ipcMain.handle("sync:trigger", permitted("backup.manage", () => cloudSync().trigger("manual")));
  ipcMain.handle("sync:approval-check", permitted("backup.manage", () => cloudSync().checkDeviceApproval()));
  ipcMain.handle("sync:devices-list", permitted("backup.manage", (_user, input: CloudDeviceOwnerCredentials) => cloudSync().listCloudDevices(input)));
  ipcMain.handle("sync:devices-approve", permitted("backup.manage", (_user, input: CloudDeviceApprovalInput) => cloudSync().approveCloudDevice(input)));
  ipcMain.handle("sync:devices-revoke", permitted("backup.manage", (_user, input: CloudDeviceApprovalInput) => cloudSync().revokeCloudDevice(input)));
  ipcMain.handle("sync:conflicts-list", permitted("backup.manage", () => cloudSync().listConflicts()));
  ipcMain.handle("sync:conflict-resolve", permitted("backup.manage", (_user, input: { conflictId: string; resolution: SyncConflictResolution }) =>
    cloudSync().resolveConflict(input.conflictId, input.resolution)
  ));
  ipcMain.handle("services:list", permittedAny(["services.view", "billing.create", "quotations.manage", "jobCards.manage", "enquiries.manage"], (_user, includeInactive?: boolean) => cloudData().listServices(includeInactive)));
  ipcMain.handle("services:save", permitted("services.manage", (_user, service) => cloudData().saveService(service)));
  ipcMain.handle("services:deactivate", permitted("services.manage", (_user, id: string) => {
    return cloudData().deactivateService(id);
  }));
  ipcMain.handle("inventory:dashboard", permitted("stock.view", () => cloudData().inventoryDashboard()));
  ipcMain.handle("inventory:items", permittedAny(["stock.view", "billing.create", "quotations.manage", "quotations.convert", "jobCards.manage", "services.view", "services.manage"], (_user, includeInactive?: boolean) => cloudData().listInventoryItems(includeInactive)));
  ipcMain.handle("inventory:saveItem", permitted("stock.manageItems", (_user, item) => cloudData().saveInventoryItem(item)));
  ipcMain.handle("inventory:deactivateItem", permitted("stock.manageItems", (_user, id: string) => {
    return cloudData().deactivateInventoryItem(id);
  }));
  ipcMain.handle("inventory:suppliers", permittedAny(["stock.suppliers", "stock.purchase"], () => cloudData().listSuppliers()));
  ipcMain.handle("inventory:saveSupplier", permitted("stock.suppliers", (_user, supplier) => cloudData().saveSupplier(supplier)));
  ipcMain.handle("inventory:addPurchase", permitted("stock.purchase", (_user, input: InventoryPurchaseInput) => cloudData().addInventoryPurchase(input)));
  ipcMain.handle("inventory:addMovement", permitted("stock.adjust", (_user, input: InventoryMovementInput) => cloudData().addInventoryMovement(input)));
  ipcMain.handle("inventory:batches", permitted("stock.view", (_user, itemId?: string) => cloudData().listInventoryBatches(itemId)));
  ipcMain.handle("inventory:movements", permitted("stock.view", (_user, itemId?: string) => cloudData().listInventoryMovements(itemId)));
  ipcMain.handle("purchaseRecords:list", permitted("stock.view", (_user, query?: string) => cloudData().listPurchaseRecords(query)));
  ipcMain.handle("purchaseRecords:save", permitted("stock.purchase", (_user, input: PurchaseRecordInput, documentPaths: string[] = []) =>
    cloudData().savePurchaseRecord(input, documentPaths)
  ));
  ipcMain.handle("purchaseRecords:delete", permitted("stock.purchase", (_user, id: string) => cloudData().deletePurchaseRecord(id)));
  ipcMain.handle("purchaseRecords:pickDocuments", permitted("stock.purchase", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Attach purchase documents",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Purchase documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp"] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  }));
  ipcMain.handle("purchaseRecords:readDocument", permitted("stock.view", async (_user, fileId: string, localPath = "") => {
    try {
      return {
        ok: true,
        message: "Purchase document loaded.",
        dataUrl: await cloudData().purchaseDocumentDataUrl(fileId, localPath)
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Purchase document is not available."
      };
    }
  }));
  ipcMain.handle("services:recipe:get", permitted("services.view", (_user, serviceId: string) => cloudData().getServiceRecipe(serviceId)));
  ipcMain.handle("services:recipe:save", permitted("services.manage", (_user, serviceId: string, rows) => cloudData().saveServiceRecipe(serviceId, rows)));
  ipcMain.handle("enquiries:dashboard", permitted("enquiries.view", () => cloudData().enquiryDashboard()));
  ipcMain.handle("enquiries:list", permitted("enquiries.view", (_user, filter?: { query?: string; status?: EnquiryStatus | "open" | "followups" }) =>
    cloudData().listEnquiries(filter)
  ));
  ipcMain.handle("enquiries:save", permitted("enquiries.manage", (_user, input: EnquiryInput) => cloudData().saveEnquiry(input)));
  ipcMain.handle("enquiries:followups", permitted("enquiries.view", (_user, enquiryId: string) => cloudData().listEnquiryFollowups(enquiryId)));
  ipcMain.handle("enquiries:addFollowup", permitted("enquiries.manage", (_user, input: EnquiryFollowupInput) => cloudData().addEnquiryFollowup(input)));
  ipcMain.handle("enquiries:convert", permitted("enquiries.convert", (_user, enquiryId: string) => cloudData().convertEnquiryToCustomer(enquiryId)));
  ipcMain.handle("jobCards:dashboard", permitted("jobCards.view", () => cloudData().jobCardDashboard()));
  ipcMain.handle(
    "jobCards:list",
    permitted("jobCards.view", (_user, filter?: { query?: string; status?: JobCardStatus | "today" | "open" | "approval" | "progress" | "ready" | "closed" }) =>
      cloudData().listJobCards(filter)
    )
  );
  ipcMain.handle("jobCards:get", permitted("jobCards.view", (_user, id: string) => cloudData().getJobCard(id)));
  ipcMain.handle("jobCards:save", permitted("jobCards.manage", (_user, input: JobCardInput) => cloudData().saveJobCard(input)));
  ipcMain.handle("jobCards:updateStatus", permitted("jobCards.manage", (_user, input: { jobCardId: string; status: JobCardStatus; note?: string }) =>
      cloudData().updateJobCardStatus(input)
  ));
  ipcMain.handle("jobCards:saveChecklist", permitted("jobCards.manage", (_user, jobCardId: string, rows: Array<{ id: string; checked: boolean }>) =>
    cloudData().saveJobCardChecklist(jobCardId, rows)
  ));
  ipcMain.handle("jobCards:getSettings", permitted("jobCards.settings", () => cloudData().getJobCardSettings()));
  ipcMain.handle("jobCards:saveSettings", permitted("jobCards.settings", (_user, input: { defaultChecklist: string[] }) => cloudData().saveJobCardSettings(input)));
  ipcMain.handle("jobCards:pickPhotos", permitted("jobCards.photos", async (_user, jobCardId: string, type: JobCardPhotoType) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Select job card photos",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    return cloudData().addJobCardPhotos(jobCardId, type, result.filePaths);
  }));
  ipcMain.handle("jobCards:removePhoto", permitted("jobCards.photos", (_user, photoId: string) => cloudData().removeJobCardPhoto(photoId)));
  ipcMain.handle("jobCards:updatePhotoCaption", permitted("jobCards.photos", (_user, photoId: string, caption: string) =>
    cloudData().updateJobCardPhotoCaption(photoId, caption)
  ));
  ipcMain.handle("jobCards:convertToInvoice", permitted("billing.create", (_user, jobCardId: string) => cloudData().convertJobCardToInvoice(jobCardId)));
  ipcMain.handle("customers:list", permittedAny(["customers.view", "billing.create", "quotations.manage", "jobCards.view", "enquiries.convert"], () => cloudData().listCustomers()));
  ipcMain.handle("customers:save", permitted("customers.manage", (_user, customer) => cloudData().saveCustomer(customer)));
  ipcMain.handle("vehicles:save", permitted("customers.manage", (_user, vehicle) => cloudData().saveVehicle(vehicle)));
  ipcMain.handle("invoices:create", permitted("billing.create", async (_user, input: InvoiceCreateInput) => cloudData().createInvoice(input)));
  ipcMain.handle("invoices:list", permitted("billing.view", (_user, query?: string) => cloudData().listInvoices(query)));
  ipcMain.handle("invoices:get", permitted("billing.view", (_user, id: string) => cloudData().getInvoice(id)));
  ipcMain.handle("invoiceDrafts:list", permitted("billing.create", () => database.listInvoiceDrafts()));
  ipcMain.handle("invoiceDrafts:get", permitted("billing.create", (_user, id: string) => database.getInvoiceDraft(id)));
  ipcMain.handle("invoiceDrafts:save", permitted("billing.create", (_user, input: InvoiceDraftSaveInput) => database.saveInvoiceDraft(input)));
  ipcMain.handle("invoiceDrafts:discard", permitted("billing.create", (_user, id: string) => {
    return database.discardInvoiceDraft(id);
  }));
  ipcMain.handle("invoiceDrafts:finalize", permitted("billing.create", async (_user, id: string) => {
    const draft = database.getInvoiceDraft(id);
    const invoice = await cloudData().createInvoice({ ...draft.payload, sourceInvoiceId: draft.sourceInvoiceId || draft.payload.sourceInvoiceId || "" }, "invoice_draft", id);
    database.discardInvoiceDraft(id);
    return invoice;
  }));
  ipcMain.handle("invoices:cancel", permitted("billing.cancelInvoices", (user, input: InvoiceCancelInput) => cloudData().cancelInvoice({ ...input, cancelledByUserId: user.id })));
  ipcMain.handle("invoices:appendItem", permitted("billing.manageInvoices", (_user, input: InvoiceAppendItemInput) => cloudData().appendInvoiceItem(input)));
  ipcMain.handle("invoices:finalizePendingCloud", permitted("billing.manageInvoices", async (_user, invoiceId: string) => {
    const invoice = database.getInvoice(invoiceId);
    const invoiceNumber = await assignOfficialInvoiceNumber("repair", invoiceId, invoice as unknown as Record<string, unknown>);
    return queueInvoiceDetail(database.repairPendingCloudInvoice(invoiceId, invoiceNumber));
  }));
  ipcMain.handle("invoices:movePendingCloudToDraft", permitted("billing.manageInvoices", (_user, invoiceId: string) => {
    const draft = database.movePendingCloudInvoiceToDraft(invoiceId);
    return draft;
  }));
  ipcMain.handle("invoices:createReplacementDraft", permitted("billing.manageInvoices", async (_user, invoiceId: string) => {
    const invoice = await cloudData().getInvoice(invoiceId);
    return database.saveInvoiceDraft({
      name: `Replacement for ${invoice.invoiceNumber}`,
      sourceInvoiceId: invoice.id,
      correctionType: "replacement",
      payload: {
        invoiceMode: invoice.invoiceMode,
        taxScope: invoice.taxScope,
        invoiceDate: todayForInvoice(),
        sourceInvoiceId: invoice.id,
        customerId: invoice.customerId,
        customer: invoice.customer,
        vehicleId: invoice.vehicleId,
        vehicle: invoice.vehicle,
        items: invoice.items.map(({ id: _id, invoiceId: _invoiceId, lineSubTotal: _lineSubTotal, lineTax: _lineTax, lineTotal: _lineTotal, ...item }) => item),
        discount: invoice.discount,
        paidAmount: 0,
        paymentMode: invoice.paymentMode,
        paymentReference: "",
        notes: ""
      }
    });
  }));
  ipcMain.handle("invoices:createAddonDraft", permitted("billing.manageInvoices", async (_user, invoiceId: string) => {
    const invoice = await cloudData().getInvoice(invoiceId);
    return database.saveInvoiceDraft({
      name: `Add-on for ${invoice.invoiceNumber}`,
      sourceInvoiceId: invoice.id,
      correctionType: "addon",
      payload: {
        invoiceMode: invoice.invoiceMode,
        taxScope: invoice.taxScope,
        invoiceDate: todayForInvoice(),
        sourceInvoiceId: invoice.id,
        customerId: invoice.customerId,
        customer: invoice.customer,
        vehicleId: invoice.vehicleId,
        vehicle: invoice.vehicle,
        items: [],
        discount: 0,
        paidAmount: 0,
        paymentMode: invoice.paymentMode,
        paymentReference: "",
        notes: ""
      }
    });
  }));
  ipcMain.handle("payments:record", permitted("billing.recordPayments", (_user, input: RecordPaymentInput) => cloudData().recordPayment(input)));
  ipcMain.handle("quotations:list", permitted("quotations.view", (_user, query?: string) => cloudData().listQuotations(query)));
  ipcMain.handle("quotations:get", permitted("quotations.view", (_user, id: string) => cloudData().getQuotation(id)));
  ipcMain.handle("quotations:save", permitted("quotations.manage", (_user, input: QuotationSaveInput) => cloudData().saveQuotation(input)));
  ipcMain.handle("quotations:updateStatus", permitted("quotations.manage", (_user, input: QuotationStatusInput) => cloudData().updateQuotationStatus(input)));
  ipcMain.handle("quotations:convert", permitted("quotations.convert", (_user, id: string) => cloudData().convertQuotationToInvoice(id)));
  ipcMain.handle("expenses:list", permitted("expenses.manage", (_user, filter: DateRangePreset | ReportDateFilter = "30d") => cloudData().listExpenses(filter)));
  ipcMain.handle("expenses:save", permitted("expenses.manage", (user, input: ExpenseInput) => cloudData().saveExpense(input, user.id)));
  ipcMain.handle("expenses:delete", permitted("expenses.manage", (_user, id: string) => cloudData().deleteExpense(id)));
  ipcMain.handle("profit:get", permitted("reports.view", (_user, filter: DateRangePreset | ReportDateFilter) => cloudData().profit(filter)));
  ipcMain.handle("reports:get", permitted("reports.view", (_user, filter: DateRangePreset | ReportDateFilter) => cloudData().reports(filter)));
  ipcMain.handle("reports:exportCsv", permitted("reports.export", async (_user, input: { kind: ReportExportKind; filter?: DateRangePreset | ReportDateFilter; fileName?: string }) => {
    const kind = input?.kind || "full";
    const csv = await cloudData().exportReportCsv(kind, input?.filter || "30d");
    if (!csv) return { ok: false, message: "No report records available to export." };
    const defaultFileName = safeExportFileName(input?.fileName || `autocare24-${kind}-report-${Date.now()}.csv`, `autocare24-${kind}-report.csv`);

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: kind === "full" ? "Export full report bundle for Excel" : `Export ${kind} report for Excel`,
      defaultPath: path.join(app.getPath("documents"), defaultFileName),
      filters: [{ name: "Excel CSV", extensions: ["csv"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, message: "Report export cancelled." };
    fs.writeFileSync(result.filePath, csv, "utf8");
    return { ok: true, message: "Excel report exported successfully.", path: result.filePath };
  }));
  ipcMain.handle("dailyReports:status", permitted("reports.export", () => dailyReportBackupStatus()));
  ipcMain.handle("dailyReports:generate", permitted("reports.export", async () => {
    const result = await createDailyReportBackup(localDate());
    logAppEvent("info", "Manual daily report backup created", {
      path: result.path,
      reportDate: result.reportDate,
      source: result.source,
      driveUploaded: Boolean(result.driveUpload)
    });
    return result;
  }));
  ipcMain.handle("dailyReports:openFolder", permitted("reports.export", () => {
    const state = readDailyReportBackupState();
    if (state.lastReportPath && fs.existsSync(state.lastReportPath)) {
      shell.showItemInFolder(state.lastReportPath);
      return { ok: true, message: "Daily report archive highlighted.", path: state.lastReportPath };
    }

    const reportsFolder = path.join(dailyReportOutputRoot(), "daily-reports");
    if (fs.existsSync(reportsFolder)) {
      void shell.openPath(reportsFolder);
      return { ok: true, message: "Daily reports folder opened.", path: reportsFolder };
    }
    return { ok: false, message: "No daily report backup folder is available yet." };
  }));
  ipcMain.handle("developer:getDiagnostics", permitted("developer.access", () => getDeveloperDiagnostics()));
  ipcMain.handle("developer:scanDataHealth", permitted("developer.access", () => database.scanDataHealth()));
  ipcMain.handle("developer:runSafeRepair", permitted("developer.access", (_user, input: { repairCode: SafeRepairCode }) => {
    const result = database.runSafeRepair(input.repairCode);
    logAppEvent("warn", "Safe repair executed", result);
    return result;
  }));
  ipcMain.handle("developer:getLogs", permitted("developer.access", () => readAppLogs()));
  ipcMain.handle("developer:exportDiagnosticBundle", permitted("developer.access", () => exportDiagnosticBundle()));
  ipcMain.handle("backup:create", permitted("backup.manage", async () => {
    const result = await createManualBackupWithCloudSnapshot();
    logAppEvent("info", "Manual backup created", result);
    sendBackupScheduleStatus();
    return result;
  }));
  ipcMain.handle("backup:status", permitted("backup.manage", () => backupScheduleStatus()));
  ipcMain.handle("backup:restore", permitted("backup.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Restore Autocare24 backup",
      properties: ["openFile"],
      filters: [
        { name: "Autocare24 backup bundle", extensions: ["ac24backup"] },
        { name: "Legacy SQLite backup", extensions: ["sqlite", "db"] }
      ]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { ok: false, message: "Restore cancelled." };

    const restored = database.restoreFromFile(filePath);
    currentSession = null;
    logAppEvent("warn", "Backup restored", restored);
    mainWindow?.webContents.send("database:restored");
    sendBackupScheduleStatus();
    return {
      ...restored,
      message: `${restored.message} Local backup restored. Cloud data was not changed.`
    };
  }));
  ipcMain.handle("drive:status", permitted("backup.manage", () => driveCloud().getStatus(driveCredentials())));
  ipcMain.handle("drive:connect", permitted("backup.manage", async (_user, clientId: string, clientSecret: string) => {
    const nextSettings = safeInvoiceAssetSettings({ googleDriveClientId: clientId, googleDriveClientSecret: clientSecret });
    const saved = database.saveSettings({ ...nextSettings, googleDriveClientSecret: "" });
    const secret = readSecureGoogleDriveSecret();
    const status = await driveCloud().connect({ clientId: saved.googleDriveClientId, clientSecret: secret });
    logAppEvent("info", "Google Drive connected", { accountEmail: status.accountEmail, folderId: status.folderId });
    return status;
  }));
  ipcMain.handle("drive:disconnect", permitted("backup.manage", async () => {
    const result = await driveCloud().disconnect(driveCredentials());
    logAppEvent("warn", "Google Drive disconnected");
    return result;
  }));
  ipcMain.handle("drive:testConnection", permitted("backup.manage", async () => {
    const result = await driveCloud().testConnection(driveCredentials());
    logAppEvent("info", "Google Drive connection tested", result);
    return result;
  }));
  ipcMain.handle("drive:backupNow", permitted("backup.manage", async () => {
    const localBackup = await createManualBackupWithCloudSnapshot();
    if (!localBackup.path) throw new Error("Unable to create local backup before Google Drive upload.");
    const uploaded: DriveBackupResult = await driveCloud().uploadBackup(driveCredentials(), localBackup.path);
    logAppEvent("info", "Manual backup uploaded to Google Drive", uploaded);
    sendBackupScheduleStatus();
    return {
      ...uploaded,
      message: localBackup.cloudSnapshot.included
        ? uploaded.message
        : `${uploaded.message} Cloud data was not included${localBackup.cloudSnapshot.error ? `: ${localBackup.cloudSnapshot.error}` : "."}`
    };
  }));
  ipcMain.handle("drive:listBackups", permitted("backup.manage", async () => {
    const backups: CloudBackupRecord[] = await driveCloud().listBackups(driveCredentials());
    return backups;
  }));
  ipcMain.handle("drive:restoreBackup", permitted("backup.manage", async (_user, fileId: string) => {
    const credentials = driveCredentials();
    const record = await driveCloud().getBackup(credentials, fileId);
    const confirm = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: ["Restore cloud backup", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Restore Google Drive backup",
      message: `Restore ${record.name}?`,
      detail: "This will replace the current local billing database only. A safety local backup will be created first. Cloud data will not be changed."
    });
    if (confirm.response !== 0) return { ok: false, message: "Cloud restore cancelled." };

    const safetyBackup = await createManualBackupWithCloudSnapshot();
    const downloaded = await driveCloud().downloadBackup(credentials, fileId);
    const restored = database.restoreFromFile(downloaded.filePath);
    currentSession = null;
    logAppEvent("warn", "Google Drive backup restored", { fileId, name: downloaded.record.name, safetyBackup: safetyBackup.path });
    mainWindow?.webContents.send("database:restored");
    sendBackupScheduleStatus();
    return {
      ...restored,
      message: safetyBackup.path
        ? `Google Drive backup restored locally. Safety backup created at ${safetyBackup.path}. Local backup restored. Cloud data was not changed.`
        : "Google Drive backup restored locally. Local backup restored. Cloud data was not changed.",
      path: downloaded.filePath
    };
  }));
  ipcMain.handle("whatsapp:status", permitted("sharing.whatsapp", () => cloudData().getWhatsAppStatus()));
  ipcMain.handle("whatsapp:conversations", permitted("sharing.whatsapp", (_user, query?: string) => cloudData().listWhatsAppConversations(query)));
  ipcMain.handle("whatsapp:messages", permitted("sharing.whatsapp", (_user, conversationId: string) => cloudData().listWhatsAppMessages(conversationId)));
  ipcMain.handle("whatsapp:templates", permitted("sharing.whatsapp", () => cloudData().listWhatsAppTemplates()));
  ipcMain.handle("whatsapp:templatesSync", permitted("sharing.whatsapp", () => cloudData().syncWhatsAppTemplates()));
  ipcMain.handle("whatsapp:sendMessage", permitted("sharing.whatsapp", (_user, input: WhatsAppSendMessageInput) => cloudData().sendWhatsAppMessage(input)));
  ipcMain.handle("sharing:openWhatsAppShare", permitted("sharing.whatsapp", async (_user, input: WhatsAppShareInput) => {
    const sendInput = buildWhatsAppBusinessSendInput(input);
    const result = await cloudData().sendWhatsAppMessage(sendInput);
    logAppEvent("info", "WhatsApp Business API message queued", { kind: input.kind, phone: sendInput.phone, messageId: result.message.id });
    return { ok: true, message: sendInput.media ? "WhatsApp Business PDF sent." : "WhatsApp Business message sent.", path: result.message.id };
  }));
  ipcMain.handle("app:showItemInFolder", permitted("documents.printPdf", (_user, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: "PDF file was not found." };
    if (path.extname(filePath).toLowerCase() !== ".pdf") return { ok: false, message: "Only PDF files can be opened from here." };
    shell.showItemInFolder(filePath);
    return { ok: true, message: "PDF file highlighted.", path: filePath };
  }));
  ipcMain.handle("export:csv", permitted("exports.csv", async (_user, kind: "invoices" | "customers" | "services" | "inventory" | "enquiries" | "jobCards") => {
    const csv = await cloudData().exportCsv(kind);
    if (!csv) return { ok: false, message: "No records available to export." };

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: `Export ${kind}`,
      defaultPath: path.join(app.getPath("documents"), `autocare24-${kind}.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, message: "Export cancelled." };
    fs.writeFileSync(result.filePath, csv, "utf8");
    return { ok: true, message: "CSV exported successfully.", path: result.filePath };
  }));
  ipcMain.handle("app:print", async (event, input?: PrintInput) => {
    requirePermission(input?.requiredPermission || "documents.printPdf");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    const pageSize = input?.pageSize || invoicePaperSize();
    await new Promise<void>((resolve, reject) => {
      window.webContents.print({ printBackground: true, pageSize, margins: { marginType: "none" } }, (success, errorType) => {
        if (!success) reject(new Error(errorType));
        else resolve();
      });
    });
  });
  ipcMain.handle("app:savePdf", async (event, input?: SavePdfInput) => {
    requirePermission(input?.requiredPermission || "documents.printPdf");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { ok: false, message: "No active window." };
    const defaultFileName = safeExportFileName(input?.defaultFileName || `autocare24-invoice-${Date.now()}.pdf`, `autocare24-document-${Date.now()}.pdf`);
    const pdfFileName = defaultFileName.toLowerCase().endsWith(".pdf") ? defaultFileName : `${defaultFileName}.pdf`;

    let filePath = "";
    if (input?.saveMode === "documents") {
      const segments = (input.documentsSubfolder || "Autocare24 Documents")
        .split(/[\\/]+/)
        .map((segment, index) => safePathSegment(segment, index === 0 ? "Autocare24" : "Documents"))
        .filter(Boolean);
      const folderPath = path.join(app.getPath("documents"), ...segments);
      fs.mkdirSync(folderPath, { recursive: true });
      filePath = path.join(folderPath, pdfFileName);
    } else {
      const result = await dialog.showSaveDialog(window, {
        title: input?.title || "Save invoice PDF",
        defaultPath: path.join(app.getPath("documents"), pdfFileName),
        filters: [{ name: "PDF", extensions: ["pdf"] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, message: "PDF export cancelled." };
      filePath = result.filePath;
    }

    const data = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: input?.pageSize || invoicePaperSize(),
      preferCSSPageSize: true,
      margins: { marginType: "none" }
    });
    fs.writeFileSync(filePath, data);
    return { ok: true, message: input?.successMessage || "PDF saved successfully.", path: filePath };
  });
};
