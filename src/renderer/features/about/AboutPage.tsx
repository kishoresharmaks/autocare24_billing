import { Building2, CheckCircle2, Database, ExternalLink, FileText, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppInfo } from "../../../shared/types";
import { BRAND_LOGO } from "../../lib/branding";

const showValue = (value: string) => value?.trim() || "Not added";

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
  return (
    <div className="about-readiness-row">
      <div className={ready ? "about-status-icon ready" : "about-status-icon"}>
        <CheckCircle2 size={18} />
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

  return (
    <div className="about-page">
      <section className="about-hero panel wide-panel">
        <div className="about-product-lockup">
          <div className="about-logo-frame">
            <img src={BRAND_LOGO} alt={info.organization.shortName} />
          </div>
          <div>
            <span>Production app information</span>
            <h2>{info.productName}</h2>
            <p>{info.description}</p>
          </div>
        </div>
        <div className="about-version-box">
          <span>Version</span>
          <strong>{info.version}</strong>
          <em>{info.releaseMode}</em>
        </div>
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

        <div className="panel about-section">
          <div className="about-section-head">
            <UserRound size={21} />
            <div>
              <h3>Developer Details</h3>
              <p>Software ownership and support reference.</p>
            </div>
          </div>
          <div className="about-info-grid">
            <AboutInfoCard label="Developer" value={info.developer.name} />
            <AboutInfoCard label="Role" value={info.developer.role} />
            <AboutInfoCard label="Credit" value={info.developer.credit} wide />
          </div>
          <button className="developer-profile-card about-profile-card" onClick={() => void window.autocare.openExternal(info.developer.profileUrl)}>
            <div>
              <span>Developer profile</span>
              <strong>{info.developer.name}</strong>
              <small>Open LinkedIn profile</small>
            </div>
            <ExternalLink size={18} />
          </button>
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
          {info.modules.map((module) => (
            <div className="about-module-card" key={module.name}>
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
