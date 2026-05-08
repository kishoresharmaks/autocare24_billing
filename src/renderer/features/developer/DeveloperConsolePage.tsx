import { useEffect, useState } from "react";
import type { AppUser, DataHealthIssue, DataHealthReport, DeveloperDiagnostics, SafeRepairCode } from "../../../shared/types";
import { ExternalLink, FileText } from "lucide-react";
import { DEVELOPER_LINKEDIN_URL, DEVELOPER_NAME } from "../../lib/branding";
import { hasPermission } from "../../../shared/access-control";

type DeveloperConsoleTab = "overview" | "health" | "repair" | "logs" | "export";

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatLocalDateTime = (value: string) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
};

const developerTabs: Array<{ id: DeveloperConsoleTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "health", label: "Database Health" },
  { id: "repair", label: "Data Repair" },
  { id: "logs", label: "Logs" },
  { id: "export", label: "Export Bundle" }
];

const repairLabel = (code?: SafeRepairCode) =>
  code === "restore_settings_defaults"
    ? "Restore default settings"
    : code === "clean_job_card_invoice_links"
      ? "Clean job-card invoice links"
    : code === "clear_broken_logo_path"
      ? "Clear broken logo path"
      : code === "clean_optional_item_links"
        ? "Clean optional line links"
        : "Repair";

function IssueList({ issues }: { issues: DataHealthIssue[] }) {
  if (!issues.length) return <div className="empty-state subtle">No issues found.</div>;
  return (
    <div className="stack-list">
      {issues.map((issue) => (
        <div className="stack-row developer-issue-row" key={issue.id}>
          <div>
            <strong>{issue.title}</strong>
            <span>{issue.message}</span>
            {issue.details?.length ? <small>{issue.details.slice(0, 4).join(" | ")}</small> : null}
          </div>
          <div className="issue-meta">
            <span className={`status ${issue.severity === "critical" ? "unpaid" : issue.severity === "warning" ? "partial" : "paid"}`}>
              {statusLabel(issue.severity)}
            </span>
            <b>{issue.count}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeveloperStat({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="developer-stat">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
      {helper && <small>{helper}</small>}
    </div>
  );
}

function DeveloperInfoCard({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "developer-info-card wide" : "developer-info-card"}>
      <span>{label}</span>
      <code title={value}>{value || "-"}</code>
    </div>
  );
}

export function DeveloperConsolePage({ currentUser, notify }: { currentUser: AppUser; notify: (message: string) => void }) {
  const [tab, setTab] = useState<DeveloperConsoleTab>("overview");
  const [diagnostics, setDiagnostics] = useState<DeveloperDiagnostics | null>(null);
  const [health, setHealth] = useState<DataHealthReport | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [bundlePath, setBundlePath] = useState("");

  const loadDiagnostics = () =>
    window.autocare
      .getDeveloperDiagnostics()
      .then(setDiagnostics)
      .catch((error) => notify(error.message));
  const scanHealth = () =>
    window.autocare
      .scanDataHealth()
      .then(setHealth)
      .catch((error) => notify(error.message));
  const loadLogs = () =>
    window.autocare
      .getDeveloperLogs()
      .then(setLogs)
      .catch((error) => notify(error.message));

  useEffect(() => {
    if (!hasPermission(currentUser, "developer.access")) return;
    void loadDiagnostics();
    void scanHealth();
    void loadLogs();
  }, [currentUser.id, currentUser.permissions.join("|")]);

  if (!hasPermission(currentUser, "developer.access")) {
    return (
      <div className="page-grid">
        <section className="panel wide-panel access-panel">
          <h2>Owner access required</h2>
          <p className="muted">Developer diagnostics and repair tools are protected for the owner account.</p>
        </section>
      </div>
    );
  }

  const runRepair = async (repairCode: SafeRepairCode) => {
    if (!window.confirm(`${repairLabel(repairCode)}?\n\nA repair backup will be created before any change.`)) return;
    setBusy(true);
    try {
      const result = await window.autocare.runSafeRepair({ repairCode });
      notify(`${result.message} Backup: ${result.backupPath}`);
      await Promise.all([loadDiagnostics(), scanHealth(), loadLogs()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to run repair.");
    } finally {
      setBusy(false);
    }
  };

  const exportBundle = async () => {
    setBusy(true);
    try {
      const result = await window.autocare.exportDiagnosticBundle();
      setBundlePath(result.path || "");
      notify(result.path ? `${result.message} ${result.path}` : result.message);
      await loadLogs();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to export diagnostic bundle.");
    } finally {
      setBusy(false);
    }
  };

  const repairableIssues = health?.issues.filter((issue) => issue.repairable && issue.repairCode) ?? [];
  const reportOnlyIssues = health?.issues.filter((issue) => !issue.repairable) ?? [];

  return (
    <div className="developer-console">
      <div className="tab-row">
        {developerTabs.map((item) => (
          <button key={item.id} className={tab === item.id ? "tab active" : "tab"} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="panel wide-panel developer-panel">
          <div className="developer-panel-heading">
            <div>
              <h2>System overview</h2>
              <p>Safe owner diagnostics for installation, runtime, database, and local files.</p>
            </div>
            <button className="ghost-button" onClick={() => void loadDiagnostics()}>Refresh</button>
          </div>
          {diagnostics ? (
            <div className="developer-panel-body">
              <div className="developer-stat-grid">
                <DeveloperStat label="Version" value={diagnostics.appVersion} helper="Current installed build" />
                <DeveloperStat label="Mode" value={diagnostics.packaged ? "Installed" : "Development"} helper="Runtime environment" />
                <DeveloperStat label="Database size" value={formatBytes(diagnostics.databaseSizeBytes)} helper="Local SQLite file" />
                <DeveloperStat label="Platform" value={`${diagnostics.platform} ${diagnostics.arch}`} helper="Windows runtime target" />
              </div>

              <div className="developer-section-head">
                <div>
                  <h3>Important local paths</h3>
                  <p>Use these paths only for troubleshooting, backups, and support.</p>
                </div>
              </div>
              <div className="developer-path-grid">
                <DeveloperInfoCard label="Database path" value={diagnostics.databasePath} wide />
                <DeveloperInfoCard label="User data path" value={diagnostics.userDataPath} />
                <DeveloperInfoCard label="Backup directory" value={diagnostics.backupDirectory} />
                <DeveloperInfoCard label="Log path" value={diagnostics.logPath} wide />
              </div>

              <div className="developer-section-head">
                <div>
                  <h3>Runtime versions</h3>
                  <p>Useful when checking installed software compatibility.</p>
                </div>
              </div>
              <div className="developer-runtime-grid">
                <DeveloperInfoCard label="Electron" value={diagnostics.electronVersion} />
                <DeveloperInfoCard label="Node" value={diagnostics.nodeVersion} />
                <DeveloperInfoCard label="Chrome" value={diagnostics.chromeVersion} />
                <DeveloperInfoCard label="Generated" value={formatLocalDateTime(diagnostics.generatedAt)} />
              </div>

              <button className="developer-profile-card" onClick={() => void window.autocare.openExternal(DEVELOPER_LINKEDIN_URL)}>
                <div>
                  <span>Developer profile</span>
                  <strong>{DEVELOPER_NAME}</strong>
                  <small>LinkedIn profile</small>
                </div>
                <ExternalLink size={18} />
              </button>
            </div>
          ) : (
            <div className="empty-state">Loading diagnostics...</div>
          )}
        </section>
      )}

      {tab === "health" && (
        <section className="panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Database health</h2>
              <p>Read-only checks for integrity, links, totals, stock, and photos.</p>
            </div>
            <button className="ghost-button" onClick={() => void scanHealth()}>Run scan</button>
          </div>
          {health ? (
            <>
              <div className="developer-stat-grid">
                <DeveloperStat label="Integrity" value={health.integrityStatus} />
                <DeveloperStat label="Foreign-key issues" value={String(health.foreignKeyIssues.length)} />
                <DeveloperStat label="Health issues" value={String(health.issues.length)} />
                <DeveloperStat label="Generated" value={formatLocalDateTime(health.generatedAt)} />
              </div>
              <IssueList issues={health.issues} />
              <div className="table-wrap developer-table-counts">
                <table>
                  <thead>
                    <tr><th>Table</th><th>Rows</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(health.tableCounts).map(([table, count]) => (
                      <tr key={table}><td>{table}</td><td>{count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">Run scan to view health status.</div>
          )}
        </section>
      )}

      {tab === "repair" && (
        <section className="panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Safe data repair</h2>
              <p>Only guided repairs are available. Every repair creates a backup first.</p>
            </div>
            <button className="ghost-button" onClick={() => void scanHealth()}>Refresh scan</button>
          </div>
          {repairableIssues.length ? (
            <div className="stack-list">
              {repairableIssues.map((issue) => (
                <div className="stack-row developer-issue-row" key={issue.id}>
                  <div>
                    <strong>{issue.title}</strong>
                    <span>{issue.message}</span>
                  </div>
                  <button className="primary-action" disabled={busy} onClick={() => issue.repairCode && void runRepair(issue.repairCode)}>
                    {repairLabel(issue.repairCode)}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state subtle">No safe repairs are currently needed.</div>
          )}
          <div className="section-title">Report-only checks</div>
          <IssueList issues={reportOnlyIssues} />
        </section>
      )}

      {tab === "logs" && (
        <section className="panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent logs</h2>
              <p>Startup, IPC errors, backups, restores, repairs, and diagnostic exports.</p>
            </div>
            <button className="ghost-button" onClick={() => void loadLogs()}>Refresh logs</button>
          </div>
          <pre className="developer-log">{logs.length ? logs.join("\n") : "No logs available."}</pre>
        </section>
      )}

      {tab === "export" && (
        <section className="panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Export diagnostic bundle</h2>
              <p>Exports app info, health summary, table counts, and logs. It does not include raw database data.</p>
            </div>
            <button className="primary-action" disabled={busy} onClick={exportBundle}>
              <FileText size={18} /> Export bundle
            </button>
          </div>
          <div className="developer-stat-grid">
            <DeveloperStat label="Contains" value="Diagnostics JSON" />
            <DeveloperStat label="Contains" value="Health JSON" />
            <DeveloperStat label="Contains" value="Recent logs" />
          </div>
          {bundlePath && <div className="empty-state subtle">Last exported: {bundlePath}</div>}
        </section>
      )}
    </div>
  );
}

