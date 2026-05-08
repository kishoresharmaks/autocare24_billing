import { useEffect, useState } from "react";
import type { DashboardData, Enquiry, VehicleType } from "../../../shared/types";
import { InvoiceTable } from "../../components/tables/InvoiceTable";

type DashboardPageTarget = "invoices" | "enquiries";

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");

export function DashboardPage({
  refreshKey,
  setPage,
  notify
}: {
  refreshKey: number;
  setPage: (page: DashboardPageTarget) => void;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    window.autocare.dashboard().then(setData).catch((error) => notify(error.message));
  }, [refreshKey]);

  if (!data) return <div className="empty-state">Loading dashboard...</div>;

  return (
    <div className="page-grid dashboard-grid">
      <div className="metric-strip">
        <Metric label="Today paid" value={formatMoney(data.todayRevenue)} />
        <Metric label="Month paid" value={formatMoney(data.monthRevenue)} />
        <Metric label="Pending dues" value={formatMoney(data.pendingDues)} tone={data.pendingDues > 0 ? "warn" : "ok"} />
        <Metric label="Today invoices" value={String(data.todayInvoices)} />
      </div>

      <div className="metric-strip">
        <Metric label="Today follow-ups" value={String(data.enquiries.todayFollowups)} tone={data.enquiries.todayFollowups > 0 ? "warn" : "ok"} />
        <Metric label="Overdue follow-ups" value={String(data.enquiries.overdueFollowups)} tone={data.enquiries.overdueFollowups > 0 ? "warn" : "ok"} />
        <Metric label="New enquiries" value={String(data.enquiries.newEnquiries)} />
        <Metric label="Converted leads" value={String(data.enquiries.convertedEnquiries)} tone="ok" />
      </div>

      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent invoices</h2>
            <p>Latest saved bills with payment status.</p>
          </div>
          <button className="ghost-button" onClick={() => setPage("invoices")}>
            View all
          </button>
        </div>
        <InvoiceTable invoices={data.recentInvoices} compact />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Follow-ups due</h2>
            <p>Calls and visits staff should handle first.</p>
          </div>
          <button className="ghost-button" onClick={() => setPage("enquiries")}>
            Open
          </button>
        </div>
        <EnquiryMiniList
          enquiries={[...data.enquiries.overdue, ...data.enquiries.dueToday].slice(0, 8)}
          empty="No due follow-ups."
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Top services</h2>
            <p>Ranked by billed value.</p>
          </div>
        </div>
        <div className="stack-list">
          {data.topServices.length === 0 ? (
            <div className="empty-state subtle">No billed services yet.</div>
          ) : (
            data.topServices.map((service) => (
              <div className="stack-row" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.quantity} qty</span>
                </div>
                <b>{formatMoney(service.revenue)}</b>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent enquiries</h2>
            <p>Open leads not yet converted or lost.</p>
          </div>
        </div>
        <EnquiryMiniList enquiries={data.enquiries.recentOpen} empty="No open enquiries." />
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EnquiryMiniList({ enquiries, empty }: { enquiries: Enquiry[]; empty: string }) {
  if (!enquiries.length) return <div className="empty-state subtle">{empty}</div>;
  return (
    <div className="stack-list">
      {enquiries.map((enquiry) => (
        <div className="stack-row" key={enquiry.id}>
          <div>
            <strong>{enquiry.customerName}</strong>
            <span>
              {[
                enquiry.phone,
                enquiry.vehicleNumber ? `${vehicleTypeLabel(enquiry.vehicleType)} ${enquiry.vehicleNumber}` : "",
                enquiry.interestedService
              ]
                .filter(Boolean)
                .join(" | ") || "Lead details pending"}
            </span>
          </div>
          <b>{enquiry.followUpDate || "-"}</b>
        </div>
      ))}
    </div>
  );
}

