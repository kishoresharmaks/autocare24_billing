import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  PackageCheck,
  ShieldCheck,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppInfo } from "../../../shared/types";
import { BRAND_LOGO } from "../../lib/branding";

const showValue = (value: string) => value?.trim() || "Not added";
const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return showValue(value);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

function AboutSummaryCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="about-summary-card">
      <div className="about-summary-icon">
        <Icon size={18} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{showValue(value)}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function AboutInfoCard({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "about-info-card wide" : "about-info-card"}>
      <span>{label}</span>
      <strong>{showValue(value)}</strong>
    </div>
  );
}

function ReadinessRow({ item }: { item: AppInfo["readiness"][number] }) {
  const ready = item.status.toLowerCase() === "ready";
  const StatusIcon = ready ? CheckCircle2 : AlertCircle;
  return (
    <div className="about-readiness-row">
      <div className={ready ? "about-status-icon ready" : "about-status-icon"}>
        <StatusIcon size={18} />
      </div>
      <div>
        <strong>{item.label}</strong>
        <span>{item.detail}</span>
      </div>
      <em className={ready ? "status paid" : "status partial"}>{item.status}</em>
    </div>
  );
}

export function AboutPage({ notify }: { notify: (message: string) => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  const loadInfo = () => {
    window.autocare
      .getAppInfo()
      .then(setInfo)
      .catch((error) => notify(error.message));
  };

  useEffect(loadInfo, []);

  if (!info) {
    return <div className="empty-state">Loading app information...</div>;
  }

  const readyCount = info.readiness.filter((item) => item.status.toLowerCase() === "ready").length;
  const generatedAt = formatDateTime(info.generatedAt);

  return (
    <div className="about-page">
      <section className="about-hero panel wide-panel">
        <div className="about-product-lockup">
          <div className="about-logo-frame">
            <img src={BRAND_LOGO} alt={info.organization.shortName} />
          </div>
          <div>
            <span>Production app profile</span>
            <h2>{info.productName}</h2>
            <p>{info.description}</p>
            <div className="about-hero-badges">
              <span><PackageCheck size={14} /> {info.releaseMode}</span>
              <span><ShieldCheck size={14} /> {readyCount}/{info.readiness.length} checks ready</span>
            </div>
          </div>
        </div>
        <div className="about-version-box">
          <span>Version</span>
          <strong>{info.version}</strong>
          <em>{info.packaged ? "Packaged production build" : "Developer build"}</em>
        </div>
      </section>

      <section className="about-summary-grid" aria-label="Application summary">
        <AboutSummaryCard icon={Building2} label="Business" value={info.organization.configuredBusinessName} detail={info.organization.category} />
        <AboutSummaryCard icon={Database} label="Cloud sync" value={info.storage.cloudSync} detail="Current connection state" />
        <AboutSummaryCard icon={HardDrive} label="Storage" value={info.storage.mode} detail="Local production data mode" />
        <AboutSummaryCard icon={ShieldCheck} label="Generated" value={generatedAt} detail="Latest app information snapshot" />
      </section>

      <section className="about-grid">
        <div className="panel about-section">
          <div className="about-section-head">
            <Building2 size={21} />
            <div>
              <h3>Organization Details</h3>
              <p>Business information shown on documents and support screens.</p>
            </div>
          </div>
          <div className="about-info-grid">
            <AboutInfoCard label="Business name" value={info.organization.configuredBusinessName} wide />
            <AboutInfoCard label="Organization" value={info.organization.name} />
            <AboutInfoCard label="Category" value={info.organization.category} />
            <AboutInfoCard label="Phone" value={info.organization.phone} />
            <AboutInfoCard label="Email" value={info.organization.email} />
            <AboutInfoCard label="GSTIN" value={info.organization.gstin} />
            <AboutInfoCard label="State" value={info.organization.state} />
            <AboutInfoCard label="Address" value={info.organization.address} wide />
          </div>
        </div>

        <div className="panel about-section about-developer-section">
          <div className="about-section-head">
            <UserRound size={21} />
            <div>
              <h3>Developer And Support</h3>
              <p>Release ownership and support contact for this installation.</p>
            </div>
          </div>
           
          <div className="about-info-grid">
            <AboutInfoCard label="Credit" value={info.developer.credit} wide />
            <AboutInfoCard label="App ID" value={info.appId} />
            <AboutInfoCard label="App name" value={info.appName} />
          </div>
          {info.developer.profileUrl ? (
            <button type="button" className="about-link-button" onClick={() => void window.autocare.openExternal(info.developer.profileUrl)}>
              <ExternalLink size={16} />
              Open developer profile
            </button>
          ) : null}
        </div>
      </section>

      <section className="about-grid">
        <div className="panel about-section">
          <div className="about-section-head">
            <Database size={21} />
            <div>
              <h3>Data And Backup</h3>
              <p>Current production storage mode for this installation.</p>
            </div>
          </div>
          <div className="about-info-grid">
            <AboutInfoCard label="Mode" value={info.storage.mode} />
            <AboutInfoCard label="Cloud sync" value={info.storage.cloudSync} wide />
            <AboutInfoCard label="Cloud backup" value={info.storage.cloudBackup} />
            <AboutInfoCard label="Backup folder" value={info.storage.backupDirectory} wide />
            <AboutInfoCard label="Data folder" value={info.storage.userDataPath} wide />
            <AboutInfoCard label="Database file" value={info.storage.databasePath} wide />
          </div>
        </div>

        <div className="panel about-section">
          <div className="about-section-head">
            <ShieldCheck size={21} />
            <div>
              <h3>Production Readiness</h3>
              <p>Current release checks and remaining production decisions.</p>
            </div>
          </div>
          <div className="about-readiness-list">
            {info.readiness.map((item) => (
              <ReadinessRow key={item.label} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel wide-panel about-section">
        <div className="about-section-head">
          <FileText size={21} />
          <div>
            <h3>Available Modules</h3>
            <p>Main areas included in this production build.</p>
          </div>
        </div>
        <div className="about-module-grid">
          {info.modules.map((module, index) => (
            <div className="about-module-card" key={module.name}>
              <span className="about-module-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{module.name}</strong>
              <span>{module.description}</span>
            </div>
          ))}
        </div>
        <p className="about-copyright">{info.copyright}</p>
      </section>
    </div>
  );
}
