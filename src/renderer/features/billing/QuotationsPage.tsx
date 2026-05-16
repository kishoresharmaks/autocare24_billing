import { CheckCircle2, FileText, MessageCircle, PlusCircle, Printer, ReceiptText, Save, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { hasPermission } from "../../../shared/access-control";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } from "../../../shared/billing-math";
import type {
  AppUser,
  BusinessSettings,
  Customer,
  CustomerWithVehicles,
  InventoryItem,
  InvoiceDetail,
  InvoiceItemInput,
  InvoiceMode,
  QuotationDetail,
  QuotationSaveInput,
  QuotationStatus,
  QuotationSummary,
  ServiceItem,
  TaxScope,
  Vehicle,
  VehicleType
} from "../../../shared/types";
import { InvoicePreview } from "./InvoicePreview";

type DraftItem = InvoiceItemInput & { key: string };
type ConvertedInvoiceLink = { id: string; invoiceNumber: string };

const quotationStatuses: Array<{ value: QuotationStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" }
];
const vehicleTypes: VehicleType[] = ["car", "bike", "other"];

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");

const emptyVehicle = (): Partial<Vehicle> & Pick<Vehicle, "registrationNumber"> => ({
  registrationNumber: "",
  vehicleType: "car"
});

const emptyItem = (settings?: BusinessSettings): DraftItem => ({
  key: crypto.randomUUID(),
  serviceId: "",
  inventoryItemId: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  gstRate: settings?.defaultGstRate ?? 18,
  sacCode: DEFAULT_SAC_CODE
});

const quotationItemHasContent = (item: Partial<InvoiceItemInput>) =>
  Boolean(
    String(item.serviceId || "").trim() ||
      String(item.inventoryItemId || "").trim() ||
      String(item.description || "").trim() ||
      Number(item.unitPrice || 0) > 0
  );

const normalizeQuotationDraftItems = (rows: Array<Partial<InvoiceItemInput>>): InvoiceItemInput[] =>
  (Array.isArray(rows) ? rows : [])
    .filter(quotationItemHasContent)
    .map((item) => ({
      serviceId: item.serviceId || "",
      inventoryItemId: item.inventoryItemId || "",
      description: String(item.description || "").trim(),
      quantity: money(Math.max(0, Number(item.quantity || 0))),
      unitPrice: money(Math.max(0, Number(item.unitPrice || 0))),
      gstRate: money(Math.max(0, Number(item.gstRate || 0))),
      sacCode: normalizeSacCode(item.sacCode)
    }));

const itemsFromQuotation = (quotation: QuotationDetail, settings: BusinessSettings): DraftItem[] =>
  (quotation.items.length ? quotation.items : [emptyItem(settings)]).map((item) => ({
    key: crypto.randomUUID(),
    serviceId: item.serviceId || "",
    inventoryItemId: item.inventoryItemId || "",
    description: item.description || "",
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
    unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : 0,
    gstRate: Number.isFinite(Number(item.gstRate)) ? Number(item.gstRate) : settings.defaultGstRate,
    sacCode: normalizeSacCode(item.sacCode)
  }));

const validateQuotationForBill = (payload: QuotationSaveInput) => {
  const errors: string[] = [];
  const customerName = payload.customer?.name?.trim() || "";
  const vehicleNumber = payload.vehicle?.registrationNumber?.trim() || "";
  if (!customerName) errors.push("Customer name is required before converting.");
  if (!vehicleNumber) errors.push("Vehicle number is required before converting.");
  if (payload.status && !["draft", "sent", "accepted"].includes(payload.status)) {
    errors.push("Only Draft, Sent, or Accepted quotations can be converted.");
  }
  if (!payload.items.length) errors.push("Add at least one valid service item before converting.");

  const invoiceMode = payload.invoiceMode === "simple" ? "simple" : "gst";
  let subTotal = 0;
  payload.items.forEach((item, index) => {
    const row = `Line ${index + 1}`;
    if (!String(item.description || "").trim()) errors.push(`${row}: description is required.`);
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) errors.push(`${row}: quantity must be greater than zero.`);
    if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) errors.push(`${row}: price cannot be negative.`);
    if (invoiceMode === "gst" && (!Number.isFinite(Number(item.gstRate)) || Number(item.gstRate) < 0)) {
      errors.push(`${row}: GST cannot be negative.`);
    }
    subTotal += Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0);
  });

  const discount = Number(payload.discount || 0);
  if (!Number.isFinite(discount) || discount < 0) errors.push("Discount cannot be negative.");
  if (Number.isFinite(discount) && money(discount) > money(subTotal)) errors.push("Discount cannot be greater than subtotal.");
  return errors.length ? Array.from(new Set(errors)).join(" ") : "";
};

function SummaryRows({
  totals
}: {
  totals: ReturnType<typeof calculateInvoiceTotals>;
}) {
  return (
    <div className="summary-rows">
      <div className="summary-row"><span>Subtotal</span><b>{formatMoney(totals.subTotal)}</b></div>
      <div className="summary-row"><span>Discount</span><b>{formatMoney(totals.discount)}</b></div>
      {totals.totalTax > 0 && <div className="summary-row"><span>GST</span><b>{formatMoney(totals.totalTax)}</b></div>}
      <div className="summary-row strong"><span>Quotation total</span><b>{formatMoney(totals.grandTotal)}</b></div>
    </div>
  );
}

export function QuotationsPage({
  settings,
  refreshKey,
  notify,
  onChanged,
  newRequestKey,
  currentUser,
  openInvoice
}: {
  settings: BusinessSettings;
  refreshKey: number;
  notify: (message: string) => void;
  onChanged: () => void;
  newRequestKey: number;
  currentUser: AppUser | null;
  openInvoice: (invoiceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeQuotation, setActiveQuotation] = useState<QuotationDetail | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [retailItems, setRetailItems] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([]);
  const [mode, setMode] = useState<InvoiceMode>("gst");
  const [taxScope, setTaxScope] = useState<TaxScope>(settings.defaultTaxScope);
  const [quotationDate, setQuotationDate] = useState(todayLocal());
  const [validUntil, setValidUntil] = useState("");
  const [status, setStatus] = useState<QuotationStatus>("draft");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [customer, setCustomer] = useState<Partial<Customer> & Pick<Customer, "name">>({ name: "" });
  const [vehicle, setVehicle] = useState<Partial<Vehicle> & Pick<Vehicle, "registrationNumber">>(emptyVehicle());
  const [items, setItems] = useState<DraftItem[]>([emptyItem(settings)]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [showConvertPanel, setShowConvertPanel] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [convertedInvoice, setConvertedInvoice] = useState<ConvertedInvoiceLink | null>(null);

  const canView = hasPermission(currentUser, "quotations.view");
  const canManage = hasPermission(currentUser, "quotations.manage");
  const canConvert = hasPermission(currentUser, "quotations.convert");
  const canPrintPdf = hasPermission(currentUser, "documents.printPdf");
  const canShareWhatsapp = hasPermission(currentUser, "sharing.whatsapp");
  const selectedCustomer = customers.find((item) => item.id === selectedCustomerId);
  const vehicleOptions = selectedCustomer?.vehicles ?? [];
  const draftItems = useMemo(() => normalizeQuotationDraftItems(items), [items]);
  const totals = useMemo(() => calculateInvoiceTotals(mode, taxScope, draftItems, discount), [mode, taxScope, draftItems, discount]);
  const isConverted = Boolean(activeQuotation?.convertedInvoiceId || status === "converted");
  const canEditCurrent = canManage && !isConverted;
  const canConvertCurrent = Boolean(
    canConvert && activeQuotation && ["draft", "sent", "accepted"].includes(activeQuotation.quotationStatus) && !activeQuotation.convertedInvoiceId
  );

  const loadQuotations = async () => {
    if (!canView) return;
    try {
      const rows = await window.autocare.listQuotations(query);
      setQuotations(rows);
      const first = rows[0];
      if (!selectedId && first) setSelectedId(first.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load quotations.");
    }
  };

  useEffect(() => {
    void loadQuotations();
  }, [refreshKey, query, canView]);

  useEffect(() => {
    Promise.all([
      canManage ? window.autocare.listServices() : Promise.resolve([]),
      canManage ? window.autocare.listCustomers() : Promise.resolve([]),
      canManage || canConvert ? window.autocare.listInventoryItems() : Promise.resolve([])
    ])
      .then(([serviceRows, customerRows, inventoryRows]) => {
        setServices(serviceRows);
        setCustomers(customerRows);
        setRetailItems(inventoryRows.filter((item) => item.type === "retail" && item.active));
      })
      .catch((error) => notify(error instanceof Error ? error.message : "Unable to load quotation helpers."));
  }, [canManage, canConvert]);

  const resetForm = () => {
    setSelectedId("");
    setActiveQuotation(null);
    setMode("gst");
    setTaxScope(settings.defaultTaxScope);
    setQuotationDate(todayLocal());
    setValidUntil("");
    setStatus("draft");
    setSelectedCustomerId("");
    setSelectedVehicleId("");
    setCustomer({ name: "" });
    setVehicle(emptyVehicle());
    setItems([emptyItem(settings)]);
    setDiscount(0);
    setNotes("");
    setShowConvertPanel(false);
    setConvertError("");
    setConvertedInvoice(null);
  };

  useEffect(() => {
    if (newRequestKey > 0) resetForm();
  }, [newRequestKey]);

  const applyQuotation = (quotation: QuotationDetail) => {
    setActiveQuotation(quotation);
    setMode(quotation.invoiceMode === "simple" ? "simple" : "gst");
    setTaxScope(quotation.taxScope === "inter" ? "inter" : "intra");
    setQuotationDate(quotation.quotationDate || todayLocal());
    setValidUntil(quotation.validUntil || "");
    setStatus(quotation.quotationStatus);
    setSelectedCustomerId(quotation.customerId);
    setSelectedVehicleId(quotation.vehicleId);
    setCustomer(quotation.customer);
    setVehicle(quotation.vehicle);
    setItems(itemsFromQuotation(quotation, settings));
    setDiscount(quotation.discount);
    setNotes(quotation.notes || "");
    setConvertedInvoice(quotation.convertedInvoice ? {
      id: quotation.convertedInvoice.id,
      invoiceNumber: quotation.convertedInvoice.invoiceNumber
    } : null);
    setShowConvertPanel(false);
    setConvertError("");
  };

  useEffect(() => {
    if (!selectedId) return;
    window.autocare
      .getQuotation(selectedId)
      .then(applyQuotation)
      .catch((error) => notify(error instanceof Error ? error.message : "Unable to open quotation."));
  }, [selectedId]);

  const chooseCustomer = (id: string) => {
    setSelectedCustomerId(id);
    setSelectedVehicleId("");
    const found = customers.find((item) => item.id === id);
    if (found) {
      setCustomer(found);
      setVehicle(emptyVehicle());
    } else {
      setCustomer({ name: "" });
      setVehicle(emptyVehicle());
    }
  };

  const chooseVehicle = (id: string) => {
    setSelectedVehicleId(id);
    const found = vehicleOptions.find((item) => item.id === id);
    setVehicle(found || emptyVehicle());
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const pickService = (key: string, serviceId: string) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      updateItem(key, { serviceId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: DEFAULT_SAC_CODE });
      return;
    }
    updateItem(key, {
      serviceId: service.id,
      inventoryItemId: "",
      description: service.name,
      unitPrice: service.defaultPrice,
      gstRate: service.gstRate,
      sacCode: normalizeSacCode(service.sacCode)
    });
  };

  const pickRetailItem = (key: string, inventoryItemId: string) => {
    const item = retailItems.find((row) => row.id === inventoryItemId);
    if (!item) {
      updateItem(key, { inventoryItemId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: DEFAULT_SAC_CODE });
      return;
    }
    updateItem(key, {
      serviceId: "",
      inventoryItemId: item.id,
      description: item.name,
      unitPrice: item.retailPrice,
      gstRate: item.gstRate,
      sacCode: DEFAULT_SAC_CODE
    });
  };

  const buildPayload = (): QuotationSaveInput => ({
    id: selectedId || undefined,
    invoiceMode: mode,
    taxScope,
    quotationDate,
    validUntil,
    status,
    customerId: selectedCustomerId || undefined,
    customer,
    vehicleId: selectedVehicleId || undefined,
    vehicle,
    items: draftItems,
    discount,
    notes
  });

  const saveQuotation = async () => {
    if (!canEditCurrent) return notify("Quotation edit access is not enabled for this role.");
    setSaving(true);
    setConvertError("");
    try {
      const saved = await window.autocare.saveQuotation(buildPayload());
      setSelectedId(saved.id);
      applyQuotation(saved);
      await loadQuotations();
      notify(`${saved.quotationNumber} saved.`);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save quotation.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (nextStatus: QuotationStatus) => {
    setStatus(nextStatus);
    if (!activeQuotation || !selectedId || !canEditCurrent) return;
    try {
      const updated = await window.autocare.updateQuotationStatus({ quotationId: selectedId, status: nextStatus });
      applyQuotation(updated);
      await loadQuotations();
      notify("Quotation status updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update status.");
    }
  };

  const convertToBill = async () => {
    if (!activeQuotation) return;
    if (!canConvertCurrent) return notify("This quotation cannot be converted right now.");
    const payload = buildPayload();
    const validationMessage = validateQuotationForBill(payload);
    if (validationMessage) {
      setConvertError(validationMessage);
      setShowConvertPanel(true);
      return;
    }
    setConverting(true);
    setConvertError("");
    try {
      let quotationId = activeQuotation.id;
      if (canEditCurrent) {
        const saved = await window.autocare.saveQuotation(payload);
        quotationId = saved.id;
        setSelectedId(saved.id);
        setActiveQuotation(saved);
      }
      const invoice = await window.autocare.convertQuotationToInvoice(quotationId);
      setConvertedInvoice(invoice);
      setShowConvertPanel(false);
      notify(`Bill ${invoice.invoiceNumber} created from quotation.`);
      await window.autocare.getQuotation(quotationId).then(applyQuotation);
      await loadQuotations();
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to convert quotation.";
      setConvertError(message);
      setShowConvertPanel(true);
      notify(message);
    } finally {
      setConverting(false);
    }
  };

  const savePdf = async () => {
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    const result = await window.autocare.savePdf({
      title: "Save quotation PDF",
      defaultFileName: `${activeQuotation?.quotationNumber || "quotation"}.pdf`,
      successMessage: "Quotation PDF saved."
    });
    notify(result.message);
  };

  const shareQuotation = async () => {
    if (!activeQuotation) return;
    if (!canShareWhatsapp) return notify("WhatsApp sharing access is not enabled for this role.");
    try {
      const result = await window.autocare.openWhatsAppShare({
        kind: "quotation",
        phone: activeQuotation.customerPhone || activeQuotation.customer.phone,
        customerName: activeQuotation.customerName,
        businessName: settings.businessName,
        quotationNumber: activeQuotation.quotationNumber,
        quotationDate: activeQuotation.quotationDate,
        validUntil: activeQuotation.validUntil,
        vehicleNumber: activeQuotation.vehicleNumber,
        grandTotal: activeQuotation.grandTotal
      });
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send WhatsApp message.");
    }
  };

  const stockWarnings = draftItems
    .filter((item) => item.inventoryItemId)
    .map((item) => {
      const stockItem = retailItems.find((row) => row.id === item.inventoryItemId);
      if (!stockItem) return "";
      return stockItem.currentQuantity < item.quantity
        ? `${stockItem.name}: available ${stockItem.currentQuantity} ${stockItem.unit}, needed ${item.quantity}`
        : "";
    })
    .filter(Boolean);

  const previewInvoice: InvoiceDetail = {
    id: activeQuotation?.id || "quotation-preview",
    invoiceNumber: activeQuotation?.quotationNumber || "Saved after Save",
    invoiceStatus: "finalized",
    cloudSyncStatus: "local_only",
    cloudRevision: 0,
    cloudSyncedAt: "",
    cloudConflictId: "",
    invoiceMode: mode,
    taxScope,
    invoiceDate: quotationDate,
    customerId: selectedCustomerId || activeQuotation?.customerId || "",
    vehicleId: selectedVehicleId || activeQuotation?.vehicleId || "",
    jobCardId: "",
    vehicleType: (vehicle.vehicleType || "car") as VehicleType,
    customerName: customer.name || "Customer",
    customerPhone: customer.phone || "",
    vehicleNumber: vehicle.registrationNumber || "",
    subTotal: totals.subTotal,
    discount: totals.discount,
    taxableValue: totals.taxableValue,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    totalTax: totals.totalTax,
    grandTotal: totals.grandTotal,
    paidAmount: 0,
    balanceDue: totals.grandTotal,
    paymentStatus: "unpaid",
    paymentMode: "UPI",
    paymentReference: "",
    notes,
    cancelledAt: "",
    cancelledByUserId: "",
    cancelReason: "",
    replacementInvoiceId: "",
    sourceInvoiceId: "",
    sourceQuotationId: activeQuotation?.id || "",
    createdAt: activeQuotation?.createdAt || todayLocal(),
    customer: {
      id: selectedCustomerId || activeQuotation?.customerId || "quotation-customer",
      name: customer.name || "Customer",
      phone: customer.phone || "",
      email: customer.email || "",
      gstin: customer.gstin || "",
      address: customer.address || "",
      createdAt: activeQuotation?.customer.createdAt || todayLocal()
    },
    vehicle: {
      id: selectedVehicleId || activeQuotation?.vehicleId || "quotation-vehicle",
      customerId: selectedCustomerId || activeQuotation?.customerId || "quotation-customer",
      vehicleType: (vehicle.vehicleType || "car") as VehicleType,
      registrationNumber: vehicle.registrationNumber || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      color: vehicle.color || "",
      createdAt: activeQuotation?.vehicle.createdAt || todayLocal()
    },
    items: totals.items.map((item, index) => ({
      id: `${activeQuotation?.id || "quotation"}-${index}`,
      invoiceId: activeQuotation?.id || "quotation-preview",
      serviceId: item.serviceId || "",
      inventoryItemId: item.inventoryItemId || "",
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate,
      sacCode: item.sacCode,
      lineSubTotal: item.lineSubTotal,
      lineTax: item.lineTax,
      lineTotal: item.lineTotal
    })),
    payments: []
  };

  if (!canView) {
    return <div className="empty-state">Quotation access is not enabled for this role.</div>;
  }

  return (
    <div className="quotation-layout invoice-layout">
      <section className="panel list-panel no-print">
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Quotation, customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </div>
        {canManage && (
          <button className="primary-action full-width-action" onClick={resetForm}>
            <PlusCircle size={18} />
            New Quotation
          </button>
        )}
        <div className="record-list quotation-list">
          {quotations.map((item) => (
            <button key={item.id} className={selectedId === item.id ? "record active" : "record"} onClick={() => setSelectedId(item.id)}>
              <strong>{item.quotationNumber}</strong>
              <span>{item.customerName || "No customer"} - {vehicleTypeLabel(item.vehicleType)} {item.vehicleNumber || "No vehicle"}</span>
              <b>{formatMoney(item.grandTotal)}</b>
              <em className={`status ${item.quotationStatus}`}>{statusLabel(item.quotationStatus)}</em>
            </button>
          ))}
          {!quotations.length && <div className="empty-state subtle">No quotations found.</div>}
        </div>
      </section>

      <section className="quotation-detail invoice-detail">
        <div className="invoice-actions no-print">
          {canManage && <button className="ghost-button" onClick={resetForm}><PlusCircle size={17} /> New Quotation</button>}
          {canEditCurrent && <button className="primary-action" disabled={saving} onClick={() => void saveQuotation()}><Save size={17} /> {saving ? "Saving..." : "Save Quotation"}</button>}
          {activeQuotation && canPrintPdf && <button className="ghost-button" onClick={() => window.autocare.print()}><Printer size={17} /> Print</button>}
          {activeQuotation && canPrintPdf && <button className="ghost-button" onClick={() => void savePdf()}><FileText size={17} /> Save PDF</button>}
          {activeQuotation && canShareWhatsapp && !isConverted && <button className="ghost-button" onClick={() => void shareQuotation()}><MessageCircle size={17} /> Send on WhatsApp</button>}
          {canConvertCurrent && <button className="primary-action" onClick={() => {
            setConvertError("");
            setShowConvertPanel((value) => !value);
          }}><ReceiptText size={17} /> Convert to Bill</button>}
        </div>

        {showConvertPanel && activeQuotation && (
          <div className="panel quotation-convert-panel no-print">
            <div className="panel-heading compact">
              <div>
                <h2>Convert this quotation to bill?</h2>
                <p>Stock will be deducted only after the bill is created.</p>
              </div>
            </div>
            <div className="mini-metrics">
              <div><span>Customer</span><strong>{activeQuotation.customerName}</strong></div>
              <div><span>Vehicle</span><strong>{activeQuotation.vehicleNumber}</strong></div>
              <div><span>Total</span><strong>{formatMoney(activeQuotation.grandTotal)}</strong></div>
            </div>
            {stockWarnings.length > 0 ? (
              <div className="stock-warning">
                <strong>Stock warning</strong>
                {stockWarnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            ) : (
              <p className="muted">Retail stock and service consumables will be checked during conversion.</p>
            )}
            {convertError && <p className="cloud-error">{convertError}</p>}
            <div className="inline-actions">
              <button className="ghost-button" onClick={() => {
                setShowConvertPanel(false);
                setConvertError("");
              }}>Close</button>
              <button className="primary-action" disabled={converting} onClick={() => void convertToBill()}>
                <CheckCircle2 size={17} />
                {converting ? "Creating bill..." : "Create Bill"}
              </button>
            </div>
          </div>
        )}

        {(convertedInvoice || activeQuotation?.convertedInvoice) && (
          <div className="success-box no-print">
            <strong>Bill created</strong>
            <span>{convertedInvoice?.invoiceNumber || activeQuotation?.convertedInvoice?.invoiceNumber} is linked to this quotation.</span>
            {(convertedInvoice?.id || activeQuotation?.convertedInvoiceId) && (
              <button className="ghost-button small" onClick={() => openInvoice(convertedInvoice?.id || activeQuotation?.convertedInvoiceId || "")}>
                Open Invoice
              </button>
            )}
          </div>
        )}

        <div className="quotation-editor no-print">
          <section className="panel bill-form">
            <div className="panel-heading">
              <div>
                <h2>{activeQuotation ? activeQuotation.quotationNumber : "New Quotation"}</h2>
                <p>Save a quote first. Convert to bill only after customer approval.</p>
              </div>
              <span className={`status ${status}`}>{statusLabel(status)}</span>
            </div>

            <div className="draft-banner quotation-help">
              <div>
                <strong>Quotation does not reduce stock</strong>
                <span>Stock, sales, GST, dues, and profit update only after Convert to Bill.</span>
              </div>
              {activeQuotation && <span>{activeQuotation.updatedAt.slice(0, 10)}</span>}
            </div>

            <div className="form-grid three">
              <label>
                Quotation date
                <input type="date" disabled={!canEditCurrent} value={quotationDate} onChange={(event) => setQuotationDate(event.currentTarget.value)} />
              </label>
              <label>
                Valid until
                <input type="date" disabled={!canEditCurrent} value={validUntil} onChange={(event) => setValidUntil(event.currentTarget.value)} />
              </label>
              <label>
                Status
                <select disabled={!canEditCurrent} value={status} onChange={(event) => void updateStatus(event.currentTarget.value as QuotationStatus)}>
                  {quotationStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  {status === "converted" && <option value="converted">Converted</option>}
                </select>
              </label>
              <label>
                Tax type
                <select value={taxScope} disabled={!canEditCurrent || mode === "simple"} onChange={(event) => setTaxScope(event.currentTarget.value as TaxScope)}>
                  <option value="intra">CGST + SGST</option>
                  <option value="inter">IGST</option>
                </select>
              </label>
              <div className="segmented align-bottom">
                <button className={mode === "gst" ? "active" : ""} disabled={!canEditCurrent} onClick={() => setMode("gst")}>GST quote</button>
                <button className={mode === "simple" ? "active" : ""} disabled={!canEditCurrent} onClick={() => setMode("simple")}>Simple quote</button>
              </div>
            </div>

            <div className="section-title">Customer and vehicle</div>
            <div className="form-grid two">
              <label>
                Existing customer
                <select value={selectedCustomerId} disabled={!canEditCurrent} onChange={(event) => chooseCustomer(event.currentTarget.value)}>
                  <option value="">New customer</option>
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} {item.phone ? `- ${item.phone}` : ""}</option>
                  ))}
                </select>
              </label>
              <label>
                Existing vehicle
                <select value={selectedVehicleId} disabled={!canEditCurrent || !selectedCustomerId} onChange={(event) => chooseVehicle(event.currentTarget.value)}>
                  <option value="">New vehicle</option>
                  {vehicleOptions.map((item) => (
                    <option key={item.id} value={item.id}>{vehicleTypeLabel(item.vehicleType)} - {item.registrationNumber}</option>
                  ))}
                </select>
              </label>
              <label>Customer name<input disabled={!canEditCurrent} value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.currentTarget.value })} /></label>
              <label>Phone<input disabled={!canEditCurrent} value={customer.phone ?? ""} onChange={(event) => setCustomer({ ...customer, phone: event.currentTarget.value })} /></label>
              <label>Customer email<input type="email" disabled={!canEditCurrent} value={customer.email ?? ""} onChange={(event) => setCustomer({ ...customer, email: event.currentTarget.value })} /></label>
              <label>Customer GSTIN<input disabled={!canEditCurrent} value={customer.gstin ?? ""} onChange={(event) => setCustomer({ ...customer, gstin: event.currentTarget.value.toUpperCase() })} /></label>
              <label>Address<input disabled={!canEditCurrent} value={customer.address ?? ""} onChange={(event) => setCustomer({ ...customer, address: event.currentTarget.value })} /></label>
              <label>
                Vehicle type
                <select disabled={!canEditCurrent} value={vehicle.vehicleType ?? "car"} onChange={(event) => setVehicle({ ...vehicle, vehicleType: event.currentTarget.value as VehicleType })}>
                  {vehicleTypes.map((type) => <option key={type} value={type}>{vehicleTypeLabel(type)}</option>)}
                </select>
              </label>
              <label>Vehicle number<input disabled={!canEditCurrent} value={vehicle.registrationNumber} onChange={(event) => setVehicle({ ...vehicle, registrationNumber: event.currentTarget.value.toUpperCase() })} /></label>
              <label>Make / model<input disabled={!canEditCurrent} value={[vehicle.make, vehicle.model].filter(Boolean).join(" ")} onChange={(event) => setVehicle({ ...vehicle, make: event.currentTarget.value, model: "" })} /></label>
            </div>

            <div className="section-title with-action">
              Services
              {canEditCurrent && <button className="ghost-button" onClick={() => setItems((current) => [...current, emptyItem(settings)])}>Add line</button>}
            </div>
            <div className="line-items">
              <div className="line-head">
                <span>Service</span>
                <span>Retail stock</span>
                <span>Description</span>
                <span>Qty</span>
                <span>Rate</span>
                <span>GST</span>
                <span></span>
              </div>
              {items.map((item) => (
                <div className="line-row" key={item.key}>
                  <select disabled={!canEditCurrent} value={item.serviceId || ""} onChange={(event) => pickService(item.key, event.currentTarget.value)}>
                    <option value="">Custom</option>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select>
                  <select disabled={!canEditCurrent} value={item.inventoryItemId || ""} onChange={(event) => pickRetailItem(item.key, event.currentTarget.value)}>
                    <option value="">No retail item</option>
                    {retailItems.map((retailItem) => <option key={retailItem.id} value={retailItem.id}>{retailItem.name} ({retailItem.currentQuantity} {retailItem.unit})</option>)}
                  </select>
                  <input disabled={!canEditCurrent} value={item.description} onChange={(event) => updateItem(item.key, { description: event.currentTarget.value })} />
                  <input disabled={!canEditCurrent} type="number" min="0" step="0.25" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: Number(event.currentTarget.value) })} />
                  <input disabled={!canEditCurrent} type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: Number(event.currentTarget.value) })} />
                  <input disabled={!canEditCurrent || mode === "simple"} type="number" min="0" value={mode === "simple" ? 0 : item.gstRate} onChange={(event) => updateItem(item.key, { gstRate: Number(event.currentTarget.value) })} />
                  {canEditCurrent && (
                    <button className="icon-button" title="Remove line" onClick={() => setItems((current) => (current.length === 1 ? current : current.filter((row) => row.key !== item.key)))}>
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="form-grid three">
              <label>Discount<input disabled={!canEditCurrent} type="number" min="0" value={discount} onChange={(event) => setDiscount(Number(event.currentTarget.value))} /></label>
              <label className="wide-input">Notes<input disabled={!canEditCurrent} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} /></label>
            </div>

            <div className="save-row">
              <div>
                <span>Quotation total</span>
                <strong>{formatMoney(totals.grandTotal)}</strong>
              </div>
              {canEditCurrent && (
                <button className="primary-action" disabled={saving} onClick={() => void saveQuotation()}>
                  <Save size={18} />
                  {saving ? "Saving..." : "Save Quotation"}
                </button>
              )}
            </div>
          </section>

          <aside className="panel summary-panel quotation-summary-panel">
            <h2>Quotation summary</h2>
            <SummaryRows totals={totals} />
            <div className="draft-summary">
              <span>Quotation number</span>
              <strong>{activeQuotation?.quotationNumber || "Assigned after Save"}</strong>
              <span>Status</span>
              <strong>{statusLabel(status)}</strong>
            </div>
            {canConvertCurrent && (
              <button className="primary-action full-width-action" onClick={() => {
                setConvertError("");
                setShowConvertPanel(true);
              }}>
                <Send size={18} />
                Convert to Bill
              </button>
            )}
          </aside>
        </div>

        <InvoicePreview settings={settings} invoice={previewInvoice} documentKind="quotation" />
      </section>
    </div>
  );
}
