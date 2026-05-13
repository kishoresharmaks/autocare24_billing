import { FileText, Printer, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { hasPermission } from "../../../shared/access-control";
import type { AppUser, BusinessSettings, InventoryItem, InvoiceDetail, InvoiceItemInput, InvoiceSummary, PaymentMode, ServiceItem, VehicleType } from "../../../shared/types";
import { InvoicePreview } from "./InvoicePreview";

type DraftItem = InvoiceItemInput & { key: string };
const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");
const fileNamePart = (value: string | undefined, fallback: string) => {
  const safe = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return safe || fallback;
};
const invoicePdfFileName = (invoice: InvoiceDetail) =>
  `${fileNamePart(invoice.invoiceNumber, "invoice")}-${fileNamePart(invoice.customerName || invoice.customer.name, "customer")}.pdf`;
const normalizeWhatsAppPhone = (phone: string) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return { valid: true, display: digits, value: digits };
  if (digits.length === 12 && digits.startsWith("91")) return { valid: true, display: digits.slice(2), value: digits };
  return { valid: false, display: "", value: "" };
};
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitForInvoiceTemplateReady(timeoutMs = 3500) {
  const start = Date.now();
  let documentNode: Element | null = null;
  while (Date.now() - start < timeoutMs) {
    documentNode = document.querySelector(".premium-invoice-document");
    if (documentNode) break;
    await wait(80);
  }
  if (!documentNode) throw new Error("Invoice template is still loading. Try again in a moment.");

  await wait(150);
  const images = Array.from(documentNode.querySelectorAll("img"));
  await Promise.all(images.map((image) => waitForImageReady(image, Math.max(500, timeoutMs - (Date.now() - start)))));
}

async function waitForImageReady(image: HTMLImageElement, timeoutMs: number) {
  if (image.complete && image.naturalWidth > 0) {
    await image.decode?.().catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  });
  await image.decode?.().catch(() => undefined);
}

const emptyItem = (settings?: BusinessSettings): DraftItem => ({
  key: crypto.randomUUID(),
  serviceId: "",
  inventoryItemId: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  gstRate: settings?.defaultGstRate ?? 18,
  sacCode: "9987"
});

export function InvoicesPage({
  settings,
  refreshKey,
  notify,
  openDraft,
  currentUser,
  initialSelectedInvoiceId
}: {
  settings: BusinessSettings;
  refreshKey: number;
  notify: (message: string) => void;
  openDraft: (draftId: string) => void;
  currentUser: AppUser | null;
  initialSelectedInvoiceId?: string;
}) {
  const [query, setQuery] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("UPI");
  const [paymentReference, setPaymentReference] = useState("");
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [retailItems, setRetailItems] = useState<InventoryItem[]>([]);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showAddItemPanel, setShowAddItemPanel] = useState(false);
  const [appendItem, setAppendItem] = useState<DraftItem>(emptyItem(settings));
  const [updatingInvoice, setUpdatingInvoice] = useState(false);
  const [repairingCloudInvoice, setRepairingCloudInvoice] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [pdfSharePath, setPdfSharePath] = useState("");
  const canManageInvoices = hasPermission(currentUser, "billing.manageInvoices");
  const canCancelInvoices = hasPermission(currentUser, "billing.cancelInvoices");
  const canRecordPayments = hasPermission(currentUser, "billing.recordPayments");
  const canPrintPdf = hasPermission(currentUser, "documents.printPdf");
  const canShareWhatsapp = hasPermission(currentUser, "sharing.whatsapp");
  const invoiceNeedsCloudNumber = Boolean(invoice && (invoice.cloudSyncStatus === "pending_cloud" || invoice.cloudSyncStatus === "failed" || invoice.invoiceNumber.startsWith("LOCAL-")));
  const whatsappPhone = normalizeWhatsAppPhone(invoice?.customerPhone || invoice?.customer.phone || "");

  const loadInvoices = () =>
    window.autocare
      .listInvoices(query)
      .then((rows) => {
        setInvoices(rows);
        if (!selectedId && rows.length) setSelectedId(rows[0].id);
      })
      .catch((error) => notify(error.message));

  useEffect(() => {
    loadInvoices();
  }, [refreshKey, query]);

  useEffect(() => {
    if (initialSelectedInvoiceId) setSelectedId(initialSelectedInvoiceId);
  }, [initialSelectedInvoiceId]);

  useEffect(() => {
    Promise.all([
      canManageInvoices ? window.autocare.listServices() : Promise.resolve([]),
      canManageInvoices ? window.autocare.listInventoryItems() : Promise.resolve([])
    ])
      .then(([serviceRows, inventoryRows]) => {
        setServices(serviceRows);
        setRetailItems(inventoryRows.filter((item) => item.type === "retail" && item.active));
      })
      .catch((error) => notify(error.message));
  }, [canManageInvoices]);

  useEffect(() => {
    if (!selectedId) {
      setInvoice(null);
      return;
    }
    setShowCancelPanel(false);
    setCancelReason("");
    setShowAddItemPanel(false);
    setAppendItem(emptyItem(settings));
    setPdfSharePath("");
    window.autocare.getInvoice(selectedId).then(setInvoice).catch((error) => notify(error.message));
  }, [selectedId]);

  const recordPayment = async () => {
    if (!invoice) return;
    if (!canRecordPayments) return notify("Payment access is not enabled for this role.");
    try {
      const updated = await window.autocare.recordPayment({
        invoiceId: invoice.id,
        amount: paymentAmount,
        mode: paymentMode,
        reference: paymentReference,
        paymentDate: todayLocal()
      });
      setInvoice(updated);
      setPdfSharePath("");
      setPaymentAmount(0);
      setPaymentReference("");
      notify("Payment recorded.");
      await loadInvoices();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to record payment.");
    }
  };

  const savePdf = async () => {
    if (!invoice) return;
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    if (invoiceNeedsCloudNumber) return notify("Sync this invoice first. Official print and PDF are locked until cloud assigns the final number.");
    try {
      await waitForInvoiceTemplateReady();
      const result = await window.autocare.savePdf({ defaultFileName: invoicePdfFileName(invoice) });
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save invoice PDF.");
    }
  };

  const printInvoice = async () => {
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    if (invoiceNeedsCloudNumber) return notify("Sync this invoice first. Official print and PDF are locked until cloud assigns the final number.");
    await window.autocare.print();
  };

  const shareInvoicePdf = async () => {
    if (!invoice) return;
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    if (!canShareWhatsapp) return notify("WhatsApp sharing access is not enabled for this role.");
    if (invoice.invoiceStatus === "cancelled") return notify("Cancelled invoices cannot be shared on WhatsApp.");
    if (invoiceNeedsCloudNumber) return notify("Sync this invoice first. WhatsApp sharing is locked until cloud assigns the final number.");
    if (!whatsappPhone.valid) return notify("A valid 10-digit customer phone number is required for WhatsApp sharing.");
    setSharingPdf(true);
    setPdfSharePath("");
    try {
      await waitForInvoiceTemplateReady();
      const pdf = await window.autocare.savePdf({
        saveMode: "documents",
        documentsSubfolder: "Autocare24\\Invoice PDFs",
        defaultFileName: invoicePdfFileName(invoice),
        successMessage: "Invoice PDF ready."
      });
      if (!pdf.ok || !pdf.path) {
        notify(pdf.message || "Unable to create invoice PDF.");
        return;
      }
      const result = await window.autocare.openWhatsAppShare({
        kind: "invoice_pdf",
        phone: whatsappPhone.value,
        customerName: invoice.customerName,
        businessName: settings.businessName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        vehicleNumber: invoice.vehicleNumber,
        grandTotal: invoice.grandTotal,
        balanceDue: invoice.balanceDue,
        documentPath: pdf.path,
        documentFileName: invoicePdfFileName(invoice)
      });
      setPdfSharePath(pdf.path);
      notify(`${result.message} Invoice PDF saved locally.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send invoice PDF on WhatsApp.");
    } finally {
      setSharingPdf(false);
    }
  };

  const shareInvoice = async (kind: "due_reminder") => {
    if (!invoice) return;
    if (!canShareWhatsapp) return notify("WhatsApp sharing access is not enabled for this role.");
    if (invoiceNeedsCloudNumber) return notify("Sync this invoice first. WhatsApp sharing is locked until cloud assigns the final number.");
    if (!whatsappPhone.valid) return notify("A valid 10-digit customer phone number is required for WhatsApp sharing.");
    try {
      const result = await window.autocare.openWhatsAppShare({
        kind,
        phone: whatsappPhone.value,
        customerName: invoice.customerName,
        businessName: settings.businessName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        vehicleNumber: invoice.vehicleNumber,
        grandTotal: invoice.grandTotal,
        balanceDue: invoice.balanceDue
      });
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send WhatsApp message.");
    }
  };

  const copyPdfPath = async () => {
    if (!pdfSharePath) return;
    try {
      await navigator.clipboard.writeText(pdfSharePath);
      notify("Invoice PDF path copied.");
    } catch {
      notify("Unable to copy PDF path. Use Show PDF to open the folder.");
    }
  };

  const cancelAndReplace = async () => {
    if (!invoice) return;
    if (!canCancelInvoices || !canManageInvoices) return notify("Invoice correction access is not enabled for this role.");
    if (!cancelReason.trim()) return notify("Cancellation reason is required.");
    setUpdatingInvoice(true);
    try {
      await window.autocare.cancelInvoice({ invoiceId: invoice.id, reason: cancelReason });
      const draft = await window.autocare.createReplacementDraft(invoice.id);
      notify("Invoice cancelled. Replacement draft opened.");
      setShowCancelPanel(false);
      setCancelReason("");
      await loadInvoices();
      openDraft(draft.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to cancel invoice.");
    } finally {
      setUpdatingInvoice(false);
    }
  };

  const finalizePendingCloudInvoice = async () => {
    if (!invoice) return;
    if (!canManageInvoices) return notify("Invoice repair access is not enabled for this role.");
    setRepairingCloudInvoice(true);
    try {
      const updated = await window.autocare.finalizePendingCloudInvoice(invoice.id);
      setInvoice(updated);
      notify(`Official invoice number assigned: ${updated.invoiceNumber}`);
      await loadInvoices();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to finalize this invoice with cloud.");
    } finally {
      setRepairingCloudInvoice(false);
    }
  };

  const movePendingCloudInvoiceToDraft = async () => {
    if (!invoice) return;
    if (!canManageInvoices) return notify("Invoice repair access is not enabled for this role.");
    if (!window.confirm("Move this temporary invoice back to an editable draft?")) return;
    setRepairingCloudInvoice(true);
    try {
      const draft = await window.autocare.movePendingCloudInvoiceToDraft(invoice.id);
      notify("Temporary invoice moved back to draft.");
      setInvoice(null);
      setSelectedId("");
      await loadInvoices();
      openDraft(draft.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to move this invoice back to draft.");
    } finally {
      setRepairingCloudInvoice(false);
    }
  };

  const updateAppendItem = (patch: Partial<DraftItem>) => {
    setAppendItem((current) => ({ ...current, ...patch }));
  };

  const pickAppendService = (serviceId: string) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      updateAppendItem({ serviceId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: "9987" });
      return;
    }
    updateAppendItem({
      serviceId: service.id,
      inventoryItemId: "",
      description: service.name,
      unitPrice: service.defaultPrice,
      gstRate: service.gstRate,
      sacCode: service.sacCode
    });
  };

  const pickAppendRetailItem = (inventoryItemId: string) => {
    const item = retailItems.find((row) => row.id === inventoryItemId);
    if (!item) {
      updateAppendItem({ inventoryItemId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: "9987" });
      return;
    }
    updateAppendItem({
      serviceId: "",
      inventoryItemId: item.id,
      description: item.name,
      unitPrice: item.retailPrice,
      gstRate: item.gstRate,
      sacCode: "9987"
    });
  };

  const appendExtraItem = async () => {
    if (!invoice) return;
    if (!canManageInvoices) return notify("Invoice edit access is not enabled for this role.");
    const { key: _key, ...item } = appendItem;
    setUpdatingInvoice(true);
    try {
      const updated = await window.autocare.appendInvoiceItem({ invoiceId: invoice.id, item });
      setInvoice(updated);
      setPdfSharePath("");
      setAppendItem(emptyItem(settings));
      setShowAddItemPanel(false);
      notify("Item added to the same invoice.");
      await loadInvoices();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add item to invoice.");
    } finally {
      setUpdatingInvoice(false);
    }
  };

  return (
    <div className="invoice-layout">
      <section className="panel list-panel">
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Invoice, customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </div>
        <div className="record-list invoice-list">
          {invoices.map((item) => (
            <button key={item.id} className={selectedId === item.id ? "record active" : "record"} onClick={() => setSelectedId(item.id)}>
              <strong>{item.invoiceNumber}</strong>
              <span>{item.customerName} - {vehicleTypeLabel(item.vehicleType)} {item.vehicleNumber}</span>
              <b>{formatMoney(item.grandTotal)}</b>
              <em className={`status ${item.invoiceStatus === "cancelled" ? "cancelled" : item.paymentStatus}`}>
                {item.invoiceStatus === "cancelled" ? "Cancelled" : statusLabel(item.paymentStatus)}
              </em>
            </button>
          ))}
        </div>
      </section>

      <section className="invoice-detail">
        {invoice ? (
          <>
            <div className="invoice-actions no-print">
              {canPrintPdf && canShareWhatsapp && !invoiceNeedsCloudNumber && invoice.invoiceStatus !== "cancelled" && (
                <span className={`whatsapp-phone-chip ${whatsappPhone.valid ? "" : "missing"}`}>
                  {whatsappPhone.valid ? `WhatsApp to: ${whatsappPhone.display}` : "Customer phone missing"}
                </span>
              )}
              {canPrintPdf && !invoiceNeedsCloudNumber && <button className="ghost-button" onClick={() => void printInvoice()}><Printer size={17} /> Print</button>}
              {canPrintPdf && !invoiceNeedsCloudNumber && <button className="ghost-button" onClick={savePdf}><FileText size={17} /> Save PDF</button>}
              {canPrintPdf && canShareWhatsapp && !invoiceNeedsCloudNumber && invoice.invoiceStatus !== "cancelled" && (
                <button className="primary-action" disabled={sharingPdf || !whatsappPhone.valid} onClick={() => void shareInvoicePdf()}>
                  <MessageCircle size={17} />
                  <FileText size={17} />
                  {sharingPdf ? "Preparing PDF..." : "Send WhatsApp template"}
                </button>
              )}
              {canShareWhatsapp && !invoiceNeedsCloudNumber && invoice.invoiceStatus !== "cancelled" && invoice.balanceDue > 0 && (
                <button className="ghost-button" disabled={!whatsappPhone.valid} onClick={() => void shareInvoice("due_reminder")}><MessageCircle size={17} /> Due reminder</button>
              )}
              {invoice.invoiceStatus !== "cancelled" && (canCancelInvoices || canManageInvoices) && (
                <>
                  {canCancelInvoices && canManageInvoices && <button className="ghost-button danger-action" onClick={() => setShowCancelPanel((value) => !value)}>
                    Mistake? Cancel & Make New Bill
                  </button>}
                  {canManageInvoices && <button className="ghost-button" onClick={() => setShowAddItemPanel((value) => !value)}>
                    Add extra product/service
                  </button>}
                </>
              )}
            </div>
            {pdfSharePath && invoice.invoiceStatus !== "cancelled" && (
              <div className="success-box invoice-pdf-share-box no-print">
                <strong>WhatsApp Business message sent</strong>
                <span>Invoice PDF was saved locally for your records.</span>
                <div className="inline-actions">
                  <button className="ghost-button small" onClick={() => void window.autocare.showItemInFolder(pdfSharePath)}>
                    <FileText size={14} /> Show PDF
                  </button>
                  <button className="ghost-button small" onClick={() => void copyPdfPath()}>
                    <Copy size={14} /> Copy PDF path
                  </button>
                </div>
              </div>
            )}
            {invoiceNeedsCloudNumber && (
              <div className="success-box no-print">
                <strong>Invoice needs internet to finalize</strong>
                <span>This bill still has a temporary local number. It cannot be printed, exported, or shared as an official invoice until cloud assigns the final number.</span>
                {canManageInvoices && (
                  <div className="inline-actions">
                    <button className="primary-action" disabled={repairingCloudInvoice} onClick={() => void finalizePendingCloudInvoice()}>
                      Finalize with cloud
                    </button>
                    <button className="ghost-button" disabled={repairingCloudInvoice} onClick={() => void movePendingCloudInvoiceToDraft()}>
                      Move back to draft
                    </button>
                  </div>
                )}
              </div>
            )}
            {invoice.invoiceStatus !== "cancelled" && canCancelInvoices && canManageInvoices && showCancelPanel && (
              <div className="panel correction-panel no-print">
                <div className="panel-heading compact">
                  <div>
                    <h2>Cancel and make new bill</h2>
                    <p>This keeps the old invoice in history and opens an editable replacement draft.</p>
                  </div>
                </div>
                <label className="wide-input">
                  Reason for cancellation
                  <textarea value={cancelReason} onChange={(event) => setCancelReason(event.currentTarget.value)} />
                </label>
                <div className="inline-actions">
                  <button className="ghost-button" onClick={() => setShowCancelPanel(false)}>Close</button>
                  <button className="primary-action danger-fill" disabled={updatingInvoice} onClick={cancelAndReplace}>
                    Cancel invoice and open draft
                  </button>
                </div>
              </div>
            )}
            {invoice.invoiceStatus !== "cancelled" && canManageInvoices && showAddItemPanel && (
              <div className="panel append-item-panel no-print">
                <div className="panel-heading compact">
                  <div>
                    <h2>Add item to this invoice</h2>
                    <p>Append-only change. Existing lines stay locked; totals and stock update after saving.</p>
                  </div>
                </div>
                <div className="form-grid three">
                  <label>
                    Service
                    <select value={appendItem.serviceId || ""} onChange={(event) => pickAppendService(event.currentTarget.value)}>
                      <option value="">Custom</option>
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>{service.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Retail stock
                    <select value={appendItem.inventoryItemId || ""} onChange={(event) => pickAppendRetailItem(event.currentTarget.value)}>
                      <option value="">No retail item</option>
                      {retailItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.name} ({item.currentQuantity} {item.unit})</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Description
                    <input value={appendItem.description} onChange={(event) => updateAppendItem({ description: event.currentTarget.value })} />
                  </label>
                  <label>
                    Quantity
                    <input type="number" min="0" step="0.25" value={appendItem.quantity} onChange={(event) => updateAppendItem({ quantity: Number(event.currentTarget.value) })} />
                  </label>
                  <label>
                    Rate
                    <input type="number" min="0" value={appendItem.unitPrice} onChange={(event) => updateAppendItem({ unitPrice: Number(event.currentTarget.value) })} />
                  </label>
                  <label>
                    GST
                    <input
                      type="number"
                      min="0"
                      disabled={invoice.invoiceMode === "simple"}
                      value={invoice.invoiceMode === "simple" ? 0 : appendItem.gstRate}
                      onChange={(event) => updateAppendItem({ gstRate: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    SAC
                    <input value={appendItem.sacCode} onChange={(event) => updateAppendItem({ sacCode: event.currentTarget.value })} />
                  </label>
                  <button className="primary-action align-bottom" disabled={updatingInvoice} onClick={appendExtraItem}>
                    Add to same invoice
                  </button>
                </div>
              </div>
            )}
            {invoice.invoiceStatus === "cancelled" && (
              <div className="panel correction-panel no-print">
                <strong>This invoice is cancelled.</strong>
                <span>{invoice.cancelReason || "No reason recorded."}</span>
                {invoice.replacementInvoiceId && <span>Replacement invoice is linked in history.</span>}
              </div>
            )}
            <InvoicePreview settings={settings} invoice={invoice} />
            {invoice.invoiceStatus !== "cancelled" && canRecordPayments && invoice.balanceDue > 0 && (
              <div className="panel payment-panel no-print">
                <h2>Record payment</h2>
                <div className="form-grid four">
                  <label>Amount<input type="number" min="0" max={invoice.balanceDue} value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.currentTarget.value))} /></label>
                  <label>Mode<select value={paymentMode} onChange={(event) => setPaymentMode(event.currentTarget.value as PaymentMode)}>{paymentModes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                  <label>Reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.currentTarget.value)} /></label>
                  <button className="primary-action align-bottom" onClick={recordPayment}>Save payment</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">Select an invoice to view print layout.</div>
        )}
      </section>
    </div>
  );
}

