import type { InvoiceSummary, VehicleType } from "../../../shared/types";

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");

export function InvoiceTable({ invoices, compact }: { invoices: InvoiceSummary[]; compact?: boolean }) {
  if (!invoices.length) return <div className="empty-state subtle">No invoices available.</div>;
  return (
    <div className="table-wrap">
      <table className={compact ? "compact-table" : ""}>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Total</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.invoiceNumber}</td>
              <td>{invoice.invoiceDate}</td>
              <td>{invoice.customerName}</td>
              <td>{vehicleTypeLabel(invoice.vehicleType)} {invoice.vehicleNumber}</td>
              <td>{formatMoney(invoice.grandTotal)}</td>
              <td>{formatMoney(invoice.balanceDue)}</td>
              <td>
                <span className={`status ${invoice.invoiceStatus === "cancelled" ? "cancelled" : invoice.paymentStatus}`}>
                  {invoice.invoiceStatus === "cancelled" ? "Cancelled" : statusLabel(invoice.paymentStatus)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
