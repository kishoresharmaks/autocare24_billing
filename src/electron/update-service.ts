import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateStatus, AppUpdateState } from "../shared/types";

type UpdateInfoLike = {
  version?: string;
  releaseName?: string | null;
  releaseDate?: string;
  releaseNotes?: unknown;
};

type ProgressInfoLike = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

const UPDATE_STATUS_CHANNEL = "updates:status";

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const cleanMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const normalized = String(message || fallback)
    .replace(/Error:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("github.com") && (lower.includes("releases.atom") || lower.includes("/releases")) && lower.includes("404")) {
    return "No public update release was found on GitHub. Publish a higher app version to kishoresharmaks/autocare24_billing releases, or make the repository/releases public.";
  }
  if (lower.includes("github") && lower.includes("authentication token")) {
    return "GitHub update access failed. Public releases do not need a token; private releases need a secure updater server instead of embedding a token in the app.";
  }
  return normalized;
};

const notesToText = (notes: unknown) => {
  if (typeof notes === "string") return notes.trim();
  if (Array.isArray(notes)) {
    return notes
      .map((note) => {
        if (typeof note === "string") return note;
        if (note && typeof note === "object" && "note" in note) return String((note as { note?: unknown }).note || "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

export class AppUpdateService {
  private configured = false;
  private status: AppUpdateStatus = this.initialStatus();

  constructor() {
    this.configure();
  }

  getStatus() {
    return { ...this.status };
  }

  async checkForUpdates() {
    this.configure();
    if (!app.isPackaged) {
      return this.publish({
        state: "disabled",
        message: "Updates are available only in the installed Windows app.",
        error: ""
      });
    }
    if (this.status.state === "checking" || this.status.state === "downloading") return this.getStatus();

    this.publish({
      state: "checking",
      checkedAt: new Date().toISOString(),
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      error: "",
      message: "Checking for updates..."
    });

    try {
      await autoUpdater.checkForUpdates();
      return this.getStatus();
    } catch (error) {
      return this.fail(error, "Unable to check for updates. Check your internet connection and try again.");
    }
  }

  async downloadUpdate() {
    this.configure();
    if (!app.isPackaged) {
      return this.publish({
        state: "disabled",
        message: "Updates are available only in the installed Windows app.",
        error: ""
      });
    }
    if (this.status.state === "downloaded" || this.status.state === "downloading") return this.getStatus();
    if (!this.status.availableVersion) {
      return this.publish({
        state: "error",
        error: "Check for updates first.",
        message: "Check for updates first."
      });
    }

    this.publish({
      state: "downloading",
      error: "",
      message: `Downloading version ${this.status.availableVersion}...`
    });

    try {
      await autoUpdater.downloadUpdate();
      return this.getStatus();
    } catch (error) {
      return this.fail(error, "Unable to download the update. Check your internet connection and try again.");
    }
  }

  installUpdate() {
    this.configure();
    if (!app.isPackaged) {
      return this.publish({
        state: "disabled",
        message: "Updates are available only in the installed Windows app.",
        error: ""
      });
    }
    if (this.status.state !== "downloaded") {
      return this.publish({
        state: "error",
        error: "Download the update before installing.",
        message: "Download the update before installing."
      });
    }

    this.publish({
      message: "Restarting to install the update...",
      error: ""
    });
    autoUpdater.quitAndInstall(false, true);
    return this.getStatus();
  }

  private configure() {
    if (this.configured) return;
    this.configured = true;
    this.status = this.initialStatus();

    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on("checking-for-update", () => {
      this.publish({
        state: "checking",
        checkedAt: new Date().toISOString(),
        message: "Checking for updates...",
        error: ""
      });
    });

    autoUpdater.on("update-available", (info: UpdateInfoLike) => {
      const version = info.version || "";
      this.publish({
        state: "available",
        availableVersion: version,
        releaseName: info.releaseName || "",
        releaseDate: info.releaseDate || "",
        releaseNotes: notesToText(info.releaseNotes),
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0,
        message: version ? `Version ${version} is ready to download.` : "An update is ready to download.",
        error: ""
      });
    });

    autoUpdater.on("update-not-available", (info: UpdateInfoLike) => {
      this.publish({
        state: "not-available",
        availableVersion: info.version || "",
        releaseName: info.releaseName || "",
        releaseDate: info.releaseDate || "",
        releaseNotes: notesToText(info.releaseNotes),
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0,
        message: `You are using the latest version (${app.getVersion()}).`,
        error: ""
      });
    });

    autoUpdater.on("download-progress", (progress: ProgressInfoLike) => {
      const percent = clampPercent(progress.percent || 0);
      this.publish({
        state: "downloading",
        progressPercent: Math.round(percent * 10) / 10,
        transferredBytes: Math.max(0, Math.round(progress.transferred || 0)),
        totalBytes: Math.max(0, Math.round(progress.total || 0)),
        bytesPerSecond: Math.max(0, Math.round(progress.bytesPerSecond || 0)),
        message: `Downloading update ${Math.round(percent)}%...`,
        error: ""
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfoLike) => {
      const version = info.version || this.status.availableVersion;
      this.publish({
        state: "downloaded",
        availableVersion: version || "",
        releaseName: info.releaseName || this.status.releaseName,
        releaseDate: info.releaseDate || this.status.releaseDate,
        releaseNotes: notesToText(info.releaseNotes) || this.status.releaseNotes,
        progressPercent: 100,
        message: version ? `Version ${version} is ready to install.` : "Update downloaded and ready to install.",
        error: ""
      });
    });

    autoUpdater.on("error", (error) => {
      this.fail(error, "Unable to update. Check your internet connection and try again.");
    });
  }

  private initialStatus(): AppUpdateStatus {
    const now = new Date().toISOString();
    return {
      state: app.isPackaged ? "idle" : "disabled",
      currentVersion: app.getVersion(),
      availableVersion: "",
      releaseName: "",
      releaseDate: "",
      releaseNotes: "",
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      message: app.isPackaged ? "Ready to check for updates." : "Updates are available only in the installed Windows app.",
      error: "",
      checkedAt: "",
      updatedAt: now,
      packaged: app.isPackaged
    };
  }

  private fail(error: unknown, fallback: string) {
    const message = cleanMessage(error, fallback);
    return this.publish({
      state: "error",
      message,
      error: message
    });
  }

  private publish(patch: Partial<AppUpdateStatus> & { state?: AppUpdateState }) {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      updatedAt: new Date().toISOString()
    };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(UPDATE_STATUS_CHANNEL, this.status);
    }
    return this.getStatus();
  }
}

export const createAppUpdateService = () => new AppUpdateService();
