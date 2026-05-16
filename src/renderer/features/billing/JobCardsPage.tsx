import { Camera, FileText, Printer, ReceiptText, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { hasPermission } from "../../../shared/access-control";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } from "../../../shared/billing-math";
import type { AppUser, BusinessSettings, CustomerWithVehicles, InventoryItem, InvoiceItemInput, InvoiceMode, JobCardDetail, JobCardInput, JobCardItemInput, JobCardPhotoType, JobCardStatus, JobCardSummary, ServiceItem, TaxScope, Vehicle, VehicleType } from "../../../shared/types";

type DraftJobCardItem = JobCardItemInput & { key: string };
type JobCardTab = "today" | "open" | "approval" | "progress" | "ready" | "closed";

const vehicleTypes: VehicleType[] = ["car", "bike", "other"];
const jobCardStatuses: JobCardStatus[] = [
  "draft",
  "estimate_pending",
  "approved",
  "in_progress",
  "quality_check",
  "ready_delivery",
  "delivered",
  "billed",
  "cancelled"
];
const editableJobCardStatuses = jobCardStatuses.filter((status) => status !== "billed");
const jobCardPhotoTypes: JobCardPhotoType[] = ["before", "after", "damage", "work_progress", "delivery"];
const jobCardTabs: Array<{ id: JobCardTab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "open", label: "Open" },
  { id: "approval", label: "Approval" },
  { id: "progress", label: "In Progress" },
  { id: "ready", label: "Ready" },
  { id: "closed", label: "Closed" }
];

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
const fileNamePart = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
};
const jobCardPdfFileName = (jobCard: JobCardDetail) =>
  `${fileNamePart(jobCard.jobNumber, "job-card")}-${fileNamePart(jobCard.customerName, "customer")}.pdf`;

const emptyVehicle = (): Partial<Vehicle> & Pick<Vehicle, "registrationNumber"> => ({
  registrationNumber: "",
  vehicleType: "car"
});

const emptyJobCardItem = (settings?: BusinessSettings): DraftJobCardItem => ({
  key: crypto.randomUUID(),
  serviceId: "",
  inventoryItemId: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  gstRate: settings?.defaultGstRate ?? 18,
  sacCode: DEFAULT_SAC_CODE
});

const emptyJobCardInput = (settings?: BusinessSettings): JobCardInput => ({
  status: "draft",
  jobDate: todayLocal(),
  expectedDeliveryDate: "",
  expectedDeliveryTime: "",
  actualDeliveryDate: "",
  actualDeliveryTime: "",
  customer: { name: "" },
  vehicle: emptyVehicle(),
  odometer: "",
  fuelLevel: "",
  keyReceived: true,
  belongingsNote: "",
  approvalName: "",
  approvalDate: "",
  approvalNotes: "",
  workNotes: "",
  internalNotes: "",
  deliveryNotes: "",
  discount: 0,
  items: [emptyJobCardItem(settings)]
});

const jobCardToInput = (jobCard: JobCardDetail): JobCardInput => ({
  id: jobCard.id,
  status: jobCard.status,
  jobDate: jobCard.jobDate,
  expectedDeliveryDate: jobCard.expectedDeliveryDate,
  expectedDeliveryTime: jobCard.expectedDeliveryTime,
  actualDeliveryDate: jobCard.actualDeliveryDate,
  actualDeliveryTime: jobCard.actualDeliveryTime,
  customerId: jobCard.customerId,
  customer: jobCard.customer,
  vehicleId: jobCard.vehicleId,
  vehicle: jobCard.vehicle,
  odometer: jobCard.odometer,
  fuelLevel: jobCard.fuelLevel,
  keyReceived: jobCard.keyReceived,
  belongingsNote: jobCard.belongingsNote,
  approvalName: jobCard.approvalName,
  approvalDate: jobCard.approvalDate,
  approvalNotes: jobCard.approvalNotes,
  workNotes: jobCard.workNotes,
  internalNotes: jobCard.internalNotes,
  deliveryNotes: jobCard.deliveryNotes,
  discount: jobCard.discount,
  items: jobCard.items.map(({ id, serviceId, inventoryItemId, description, quantity, unitPrice, gstRate, sacCode }) => ({
    id,
    serviceId,
    inventoryItemId,
    description,
    quantity,
    unitPrice,
    gstRate,
    sacCode: normalizeSacCode(sacCode)
  }))
});

const calculateDraft = (mode: InvoiceMode, taxScope: TaxScope, items: InvoiceItemInput[], discount: number) => {
  return calculateInvoiceTotals(mode, taxScope, items, discount);
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "summary-row strong" : "summary-row"}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function JobCardsPage({
  settings,
  refreshKey,
  notify,
  onChanged,
  tab,
  setTab,
  newRequestKey,
  currentUser
}: {
  settings: BusinessSettings;
  refreshKey: number;
  notify: (message: string) => void;
  onChanged: () => void;
  tab: JobCardTab;
  setTab: (tab: JobCardTab) => void;
  newRequestKey: number;
  currentUser: AppUser | null;
}) {
  const [query, setQuery] = useState("");
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<JobCardDetail | null>(null);
  const [form, setForm] = useState<JobCardInput>(emptyJobCardInput(settings));
  const [items, setItems] = useState<DraftJobCardItem[]>([emptyJobCardItem(settings)]);
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [retailItems, setRetailItems] = useState<InventoryItem[]>([]);
  const [photoType, setPhotoType] = useState<JobCardPhotoType>("before");
  const [statusNote, setStatusNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [pdfSharePath, setPdfSharePath] = useState("");
  const canManageJobCards = hasPermission(currentUser, "jobCards.manage");
  const canCapturePhotos = hasPermission(currentUser, "jobCards.photos");
  const canCreateBill = hasPermission(currentUser, "billing.create");
  const canPrintPdf = hasPermission(currentUser, "documents.printPdf");
  const canShareWhatsapp = hasPermission(currentUser, "sharing.whatsapp");

  const loadLists = async (preferredId?: string) => {
    try {
      const rows = await window.autocare.listJobCards({ query, status: tab });
      setJobCards(rows);
      const nextId = rows.some((row) => row.id === (preferredId || selectedId)) ? preferredId || selectedId : rows[0]?.id || "";
      setSelectedId(nextId);
      if (!nextId) {
        setDetail(null);
        startNew();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load job cards.");
    }
  };

  useEffect(() => {
    void loadLists();
  }, [refreshKey, tab, query]);

  useEffect(() => {
    Promise.all([
      window.autocare.listCustomers(),
      canManageJobCards ? window.autocare.listServices() : Promise.resolve([]),
      canManageJobCards ? window.autocare.listInventoryItems() : Promise.resolve([])
    ])
      .then(([customerRows, serviceRows, inventoryRows]) => {
        setCustomers(customerRows);
        setServices(serviceRows);
        setRetailItems(inventoryRows.filter((item) => item.type === "retail" && item.active));
      })
      .catch((error) => notify(error.message));
  }, [canManageJobCards]);

  useEffect(() => {
    if (!selectedId) return;
    window.autocare
      .getJobCard(selectedId)
      .then((row) => {
        setDetail(row);
        setForm(jobCardToInput(row));
        setItems(row.items.map((item) => ({ ...item, key: item.id || crypto.randomUUID() })));
        setPdfSharePath("");
      })
      .catch((error) => notify(error.message));
  }, [selectedId]);

  const startNew = () => {
    setSelectedId("");
    setDetail(null);
    setForm(emptyJobCardInput(settings));
    setItems([emptyJobCardItem(settings)]);
    setStatusNote("");
    setPdfSharePath("");
  };

  useEffect(() => {
    if (newRequestKey > 0) startNew();
  }, [newRequestKey]);

  const selectedCustomer = customers.find((customer) => customer.id === form.customerId);
  const vehicleOptions = selectedCustomer?.vehicles ?? [];
  const totals = useMemo(() => calculateDraft("gst", settings.defaultTaxScope, items, form.discount), [items, form.discount, settings.defaultTaxScope]);
  const locked = detail?.status === "billed";
  const readOnly = locked || !canManageJobCards;

  const chooseCustomer = (customerId: string) => {
    const found = customers.find((customer) => customer.id === customerId);
    setForm({
      ...form,
      customerId: customerId || undefined,
      customer: found || { name: "" },
      vehicleId: undefined,
      vehicle: emptyVehicle()
    });
  };

  const chooseVehicle = (vehicleId: string) => {
    const found = vehicleOptions.find((vehicle) => vehicle.id === vehicleId);
    setForm({ ...form, vehicleId: vehicleId || undefined, vehicle: found || emptyVehicle() });
  };

  const updateItem = (key: string, patch: Partial<DraftJobCardItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const pickService = (key: string, serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return updateItem(key, { serviceId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: DEFAULT_SAC_CODE });
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
    if (!item) return updateItem(key, { inventoryItemId: "", description: "", unitPrice: 0, gstRate: settings.defaultGstRate, sacCode: DEFAULT_SAC_CODE });
    updateItem(key, {
      serviceId: "",
      inventoryItemId: item.id,
      description: item.name,
      unitPrice: item.retailPrice,
      gstRate: item.gstRate,
      sacCode: DEFAULT_SAC_CODE
    });
  };

  const saveJobCard = async () => {
    if (!canManageJobCards) return notify("Job card edit access is not enabled for this role.");
    setSaving(true);
    try {
      const saved = await window.autocare.saveJobCard({
        ...form,
        items: items.map((item) => ({
          id: item.id,
          serviceId: item.serviceId,
          inventoryItemId: item.inventoryItemId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          gstRate: item.gstRate,
          sacCode: normalizeSacCode(item.sacCode)
        }))
      });
      notify(`${saved.jobNumber} saved.`);
      setSelectedId(saved.id);
      setDetail(saved);
      setForm(jobCardToInput(saved));
      setItems(saved.items.map((item) => ({ ...item, key: item.id || crypto.randomUUID() })));
      setPdfSharePath("");
      await loadLists(saved.id);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save job card.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: JobCardStatus) => {
    if (!detail) return notify("Save the job card first.");
    if (!canManageJobCards) return notify("Job card status access is not enabled for this role.");
    try {
      const saved = await window.autocare.updateJobCardStatus({ jobCardId: detail.id, status, note: statusNote });
      setDetail(saved);
      setForm(jobCardToInput(saved));
      setStatusNote("");
      setPdfSharePath("");
      await loadLists(saved.id);
      onChanged();
      notify(`Status changed to ${statusLabel(status)}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update status.");
    }
  };

  const toggleChecklist = async (id: string, checked: boolean) => {
    if (!detail) return;
    if (!canManageJobCards) return notify("Checklist edit access is not enabled for this role.");
    const nextChecklist = detail.checklist.map((item) => (item.id === id ? { ...item, checked } : item));
    setDetail({ ...detail, checklist: nextChecklist });
    try {
      const saved = await window.autocare.saveJobCardChecklist(detail.id, nextChecklist.map((item) => ({ id: item.id, checked: item.checked })));
      setDetail(saved);
      setPdfSharePath("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update checklist.");
    }
  };

  const pickPhotos = async () => {
    if (!detail) return notify("Save the job card before adding photos.");
    if (!canCapturePhotos) return notify("Photo proof access is not enabled for this role.");
    const photos = await window.autocare.pickJobCardPhotos(detail.id, photoType);
    if (photos.length) {
      const saved = await window.autocare.getJobCard(detail.id);
      setDetail(saved);
      setPdfSharePath("");
      notify(`${photos.length} photo(s) added.`);
    }
  };

  const removePhoto = async (photoId: string) => {
    if (!detail) return;
    if (!canCapturePhotos) return notify("Photo proof access is not enabled for this role.");
    await window.autocare.removeJobCardPhoto(photoId);
    setDetail(await window.autocare.getJobCard(detail.id));
    setPdfSharePath("");
    notify("Photo removed.");
  };

  const updatePhotoCaption = async (photoId: string, caption: string) => {
    if (!detail) return;
    if (!canCapturePhotos) return notify("Photo proof access is not enabled for this role.");
    await window.autocare.updateJobCardPhotoCaption(photoId, caption);
    setDetail(await window.autocare.getJobCard(detail.id));
    setPdfSharePath("");
  };

  const convertToBill = async () => {
    if (!detail) return notify("Select a job card first.");
    if (!canCreateBill) return notify("Bill creation access is not enabled for this role.");
    try {
      const invoice = await window.autocare.convertJobCardToInvoice(detail.id);
      notify(`Invoice ${invoice.invoiceNumber} created from job card.`);
      const saved = await window.autocare.getJobCard(detail.id);
      setDetail(saved);
      setForm(jobCardToInput(saved));
      setPdfSharePath("");
      await loadLists(saved.id);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to convert job card to bill.");
    }
  };

  const shareJobCardStatus = async () => {
    if (!detail) return notify("Save the job card first.");
    if (!canShareWhatsapp) return notify("WhatsApp sharing access is not enabled for this role.");
    try {
      const result = await window.autocare.openWhatsAppShare({
        kind: "job_card_status",
        phone: detail.customerPhone,
        customerName: detail.customerName,
        businessName: settings.businessName,
        jobNumber: detail.jobNumber,
        status: detail.status,
        vehicleNumber: detail.vehicleNumber,
        expectedDeliveryDate: detail.expectedDeliveryDate,
        expectedDeliveryTime: detail.expectedDeliveryTime
      });
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send WhatsApp message.");
    }
  };

  const saveJobCardPdf = async () => {
    if (!detail) return notify("Save the job card first.");
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    try {
      const result = await window.autocare.savePdf({
        title: "Save job card PDF",
        defaultFileName: jobCardPdfFileName(detail),
        successMessage: "Job card PDF saved."
      });
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save job card PDF.");
    }
  };

  const shareJobCardPdf = async () => {
    if (!detail) return notify("Save the job card first.");
    if (!canPrintPdf) return notify("Print/PDF access is not enabled for this role.");
    if (!canShareWhatsapp) return notify("WhatsApp sharing access is not enabled for this role.");
    setSharingPdf(true);
    setPdfSharePath("");
    try {
      const pdf = await window.autocare.savePdf({
        saveMode: "documents",
        documentsSubfolder: "Autocare24\\Job Card PDFs",
        defaultFileName: jobCardPdfFileName(detail),
        successMessage: "Job card PDF ready."
      });
      if (!pdf.ok || !pdf.path) {
        notify(pdf.message || "Unable to create job card PDF.");
        return;
      }
      const result = await window.autocare.openWhatsAppShare({
        kind: "job_card_pdf",
        phone: detail.customerPhone,
        customerName: detail.customerName,
        businessName: settings.businessName,
        jobNumber: detail.jobNumber,
        vehicleNumber: detail.vehicleNumber,
        grandTotal: detail.grandTotal,
        expectedDeliveryDate: detail.expectedDeliveryDate,
        expectedDeliveryTime: detail.expectedDeliveryTime,
        documentPath: pdf.path,
        documentFileName: jobCardPdfFileName(detail)
      });
      setPdfSharePath(pdf.path);
      notify(`${result.message} Job card PDF saved locally.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send job card PDF on WhatsApp.");
    } finally {
      setSharingPdf(false);
    }
  };

  return (
    <div className="split-layout job-card-layout">
      <section className="panel list-panel no-print">
        <div className="panel-heading">
          <div>
            <h2>Job Cards</h2>
            <p>Estimate, approval, work status, delivery and billing.</p>
          </div>
          {canManageJobCards && <button className="ghost-button" onClick={startNew}>New</button>}
        </div>
        <div className="segmented full-segmented">
          {jobCardTabs.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Search job, customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </div>
        <div className="record-list">
          {jobCards.map((jobCard) => (
            <button key={jobCard.id} className={selectedId === jobCard.id ? "record active" : "record"} onClick={() => setSelectedId(jobCard.id)}>
              <strong>{jobCard.jobNumber} - {jobCard.customerName}</strong>
              <em className={`status ${jobCard.status}`}>{statusLabel(jobCard.status)}</em>
              <span>{vehicleTypeLabel(jobCard.vehicleType)} {jobCard.vehicleNumber} | {formatMoney(jobCard.grandTotal)}</span>
              <span>Delivery: {[jobCard.expectedDeliveryDate, jobCard.expectedDeliveryTime].filter(Boolean).join(" ") || "-"}</span>
            </button>
          ))}
          {!jobCards.length && <div className="empty-state subtle">No job cards found.</div>}
        </div>
      </section>

      <div className="detail-column">
        <section className="panel detail-panel">
          <div className="panel-heading">
            <div>
              <h2>{detail ? `${detail.jobNumber} - ${detail.customerName}` : "New job card"}</h2>
              <p>{locked ? "Billed job cards are locked for billing changes." : "Capture estimate, approval, intake and delivery details."}</p>
            </div>
            {detail && <span className={`status ${detail.status}`}>{statusLabel(detail.status)}</span>}
          </div>

          <div className="form-grid three">
            <label>Job date<input type="date" disabled={readOnly} value={form.jobDate} onChange={(event) => setForm({ ...form, jobDate: event.currentTarget.value })} /></label>
            <label>Expected delivery date<input type="date" disabled={readOnly} value={form.expectedDeliveryDate} onChange={(event) => setForm({ ...form, expectedDeliveryDate: event.currentTarget.value })} /></label>
            <label>Expected delivery time<input type="time" disabled={readOnly} value={form.expectedDeliveryTime} onChange={(event) => setForm({ ...form, expectedDeliveryTime: event.currentTarget.value })} /></label>
            <label>Status<select disabled={readOnly} value={form.status} onChange={(event) => setForm({ ...form, status: event.currentTarget.value as JobCardStatus })}>{(locked ? jobCardStatuses : editableJobCardStatuses).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
            <label>Existing customer<select disabled={readOnly} value={form.customerId || ""} onChange={(event) => chooseCustomer(event.currentTarget.value)}><option value="">New customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} {customer.phone ? `- ${customer.phone}` : ""}</option>)}</select></label>
            <label>Existing vehicle<select disabled={readOnly || !form.customerId} value={form.vehicleId || ""} onChange={(event) => chooseVehicle(event.currentTarget.value)}><option value="">New vehicle</option>{vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleTypeLabel(vehicle.vehicleType)} - {vehicle.registrationNumber}</option>)}</select></label>
            <label>Customer name<input disabled={readOnly} value={form.customer.name} onChange={(event) => setForm({ ...form, customer: { ...form.customer, name: event.currentTarget.value } })} /></label>
            <label>Phone<input disabled={readOnly} value={form.customer.phone || ""} onChange={(event) => setForm({ ...form, customer: { ...form.customer, phone: event.currentTarget.value } })} /></label>
            <label>Vehicle type<select disabled={readOnly} value={form.vehicle.vehicleType || "car"} onChange={(event) => setForm({ ...form, vehicle: { ...form.vehicle, vehicleType: event.currentTarget.value as VehicleType } })}>{vehicleTypes.map((type) => <option key={type} value={type}>{vehicleTypeLabel(type)}</option>)}</select></label>
            <label>Vehicle number<input disabled={readOnly} value={form.vehicle.registrationNumber} onChange={(event) => setForm({ ...form, vehicle: { ...form.vehicle, registrationNumber: event.currentTarget.value.toUpperCase() } })} /></label>
            <label>Make<input disabled={readOnly} value={form.vehicle.make || ""} onChange={(event) => setForm({ ...form, vehicle: { ...form.vehicle, make: event.currentTarget.value } })} /></label>
            <label>Model<input disabled={readOnly} value={form.vehicle.model || ""} onChange={(event) => setForm({ ...form, vehicle: { ...form.vehicle, model: event.currentTarget.value } })} /></label>
            <label>Color<input disabled={readOnly} value={form.vehicle.color || ""} onChange={(event) => setForm({ ...form, vehicle: { ...form.vehicle, color: event.currentTarget.value } })} /></label>
            <label>Odometer<input disabled={readOnly} value={form.odometer} onChange={(event) => setForm({ ...form, odometer: event.currentTarget.value })} /></label>
            <label>Fuel level<input disabled={readOnly} value={form.fuelLevel} onChange={(event) => setForm({ ...form, fuelLevel: event.currentTarget.value })} /></label>
            <label className="inline-check align-bottom"><input disabled={readOnly} type="checkbox" checked={form.keyReceived} onChange={(event) => setForm({ ...form, keyReceived: event.currentTarget.checked })} /> Key received</label>
            <label className="wide-input">Customer belongings note<textarea disabled={readOnly} value={form.belongingsNote} onChange={(event) => setForm({ ...form, belongingsNote: event.currentTarget.value })} /></label>
          </div>

          <div className="section-title with-action">
            Estimate services
            {canManageJobCards && <button className="ghost-button" disabled={readOnly} onClick={() => setItems((current) => [...current, emptyJobCardItem(settings)])}>Add line</button>}
          </div>
          <div className="line-items">
            <div className="line-head"><span>Service</span><span>Retail stock</span><span>Description</span><span>Qty</span><span>Rate</span><span>GST</span><span></span></div>
            {items.map((item) => (
              <div className="line-row" key={item.key}>
                <select disabled={readOnly} value={item.serviceId || ""} onChange={(event) => pickService(item.key, event.currentTarget.value)}><option value="">Custom</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
                <select disabled={readOnly} value={item.inventoryItemId || ""} onChange={(event) => pickRetailItem(item.key, event.currentTarget.value)}><option value="">No retail item</option>{retailItems.map((retailItem) => <option key={retailItem.id} value={retailItem.id}>{retailItem.name}</option>)}</select>
                <input disabled={readOnly} value={item.description} onChange={(event) => updateItem(item.key, { description: event.currentTarget.value })} />
                <input disabled={readOnly} type="number" min="0" step="0.25" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: Number(event.currentTarget.value) })} />
                <input disabled={readOnly} type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: Number(event.currentTarget.value) })} />
                <input disabled={readOnly} type="number" min="0" value={item.gstRate} onChange={(event) => updateItem(item.key, { gstRate: Number(event.currentTarget.value) })} />
                <button className="icon-button" disabled={readOnly} onClick={() => setItems((current) => current.length === 1 ? current : current.filter((row) => row.key !== item.key))}>x</button>
              </div>
            ))}
          </div>

          <div className="form-grid three">
            <label>Discount<input disabled={readOnly} type="number" min="0" value={form.discount} onChange={(event) => setForm({ ...form, discount: Number(event.currentTarget.value) })} /></label>
            <label>Approved by<input disabled={readOnly} value={form.approvalName} onChange={(event) => setForm({ ...form, approvalName: event.currentTarget.value })} /></label>
            <label>Approval date<input disabled={readOnly} type="date" value={form.approvalDate} onChange={(event) => setForm({ ...form, approvalDate: event.currentTarget.value })} /></label>
            <label className="wide-input">Approval notes<textarea disabled={readOnly} value={form.approvalNotes} onChange={(event) => setForm({ ...form, approvalNotes: event.currentTarget.value })} /></label>
            <label className="wide-input">Work notes<textarea disabled={readOnly} value={form.workNotes} onChange={(event) => setForm({ ...form, workNotes: event.currentTarget.value })} /></label>
            <label className="wide-input">Internal notes<textarea disabled={readOnly} value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.currentTarget.value })} /></label>
            <label>Actual delivery date<input disabled={readOnly} type="date" value={form.actualDeliveryDate} onChange={(event) => setForm({ ...form, actualDeliveryDate: event.currentTarget.value })} /></label>
            <label>Actual delivery time<input disabled={readOnly} type="time" value={form.actualDeliveryTime} onChange={(event) => setForm({ ...form, actualDeliveryTime: event.currentTarget.value })} /></label>
            <label className="wide-input">Delivery notes<textarea disabled={readOnly} value={form.deliveryNotes} onChange={(event) => setForm({ ...form, deliveryNotes: event.currentTarget.value })} /></label>
          </div>

          <div className="save-row no-print">
            <div><span>Estimate total</span><strong>{formatMoney(totals.grandTotal)}</strong></div>
            <div className="inline-actions">
              {canManageJobCards && <button className="primary-action" disabled={saving || readOnly} onClick={saveJobCard}><Save size={18} /> {saving ? "Saving..." : "Save job card"}</button>}
              {canCreateBill && detail && !detail.invoiceId && <button className="ghost-button" onClick={convertToBill}><ReceiptText size={18} /> Convert to Bill</button>}
              {canPrintPdf && detail && <button className="ghost-button" onClick={() => void window.autocare.print()}><Printer size={18} /> Print</button>}
              {canPrintPdf && detail && <button className="ghost-button" onClick={() => void saveJobCardPdf()}><FileText size={18} /> Save PDF</button>}
              {canPrintPdf && canShareWhatsapp && detail && (
                <button className="primary-action" disabled={sharingPdf} onClick={() => void shareJobCardPdf()}>
                  <MessageCircle size={18} />
                  {sharingPdf ? "Preparing PDF..." : "Send WhatsApp template"}
                </button>
              )}
              {canShareWhatsapp && detail && <button className="ghost-button" onClick={() => void shareJobCardStatus()}><MessageCircle size={18} /> WhatsApp status</button>}
            </div>
          </div>
        </section>

        {detail && (
          <>
            {pdfSharePath && (
              <div className="success-box no-print">
                <strong>WhatsApp Business message sent</strong>
                <span>Job card PDF was saved locally for your records.</span>
                <button className="ghost-button small" onClick={() => void window.autocare.showItemInFolder(pdfSharePath)}>
                  Show PDF
                </button>
              </div>
            )}
            <section className="panel no-print">
              <div className="panel-heading"><div><h2>Checklist</h2><p>Default inspection checklist copied into this job card.</p></div></div>
              <div className="toggle-grid">
                {detail.checklist.map((item) => (
                  <label key={item.id} className="inline-check"><input disabled={readOnly} type="checkbox" checked={item.checked} onChange={(event) => void toggleChecklist(item.id, event.currentTarget.checked)} /> {item.label}</label>
                ))}
              </div>
            </section>

            <section className="panel no-print">
              <div className="panel-heading"><div><h2>Photo proof</h2><p>Before, after, damage, work progress and delivery photos.</p></div></div>
              <div className="inline-actions">
                {canCapturePhotos && <select value={photoType} onChange={(event) => setPhotoType(event.currentTarget.value as JobCardPhotoType)}>{jobCardPhotoTypes.map((type) => <option key={type} value={type}>{statusLabel(type)}</option>)}</select>}
                {canCapturePhotos && <button className="ghost-button" onClick={pickPhotos}><Camera size={18} /> Add photos</button>}
              </div>
              <div className="photo-grid">
                {detail.photos.map((photo) => (
                  <div className="photo-tile" key={photo.id}>
                    <img src={photo.url || ""} alt={statusLabel(photo.type)} />
                    <div><strong>{statusLabel(photo.type)}</strong>{canCapturePhotos && <button className="ghost-button small" onClick={() => void removePhoto(photo.id)}>Remove</button>}</div>
                    <input
                      placeholder="Caption"
                      disabled={!canCapturePhotos}
                      value={photo.caption}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDetail({ ...detail, photos: detail.photos.map((row) => row.id === photo.id ? { ...row, caption: value } : row) });
                      }}
                      onBlur={(event) => void updatePhotoCaption(photo.id, event.currentTarget.value)}
                    />
                    <span>{photo.createdAt.slice(0, 10)}</span>
                  </div>
                ))}
                {!detail.photos.length && <div className="empty-state subtle">No photos added.</div>}
              </div>
            </section>

            <section className="panel no-print">
              <div className="panel-heading"><div><h2>Status timeline</h2><p>Track progress from estimate to delivery.</p></div></div>
              <div className="form-grid three">
                <label>Status note<input disabled={readOnly} value={statusNote} onChange={(event) => setStatusNote(event.currentTarget.value)} /></label>
                <div className="inline-actions wide-input">
                  {editableJobCardStatuses.map((status) => <button key={status} className="ghost-button small" disabled={detail.status === status || readOnly} onClick={() => void updateStatus(status)}>{statusLabel(status)}</button>)}
                </div>
              </div>
              <div className="stack-list">
                {detail.history.map((row) => <div className="stack-row" key={row.id}><div><strong>{statusLabel(row.status)}</strong><span>{row.note || "Status updated"}</span></div><b>{row.createdAt.slice(0, 10)}</b></div>)}
              </div>
            </section>

            <section className="panel job-card-print">
              <JobCardPrintView jobCard={detail} settings={settings} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function JobCardPrintView({ jobCard, settings }: { jobCard: JobCardDetail; settings: BusinessSettings }) {
  return (
    <div className="invoice-preview">
      <div className="invoice-header">
        <div>
          <h2>{settings.businessName}</h2>
          <p>{settings.address}</p>
          <p>{settings.phone} {settings.email ? `| ${settings.email}` : ""}</p>
        </div>
        <div className="invoice-title">
          <h3>JOB CARD</h3>
          <strong>{jobCard.jobNumber}</strong>
          <span>{statusLabel(jobCard.status)}</span>
        </div>
      </div>
      <div className="invoice-meta-grid">
        <div><span>Customer</span><strong>{jobCard.customerName}</strong><p>{jobCard.customerPhone}</p></div>
        <div><span>Vehicle</span><strong>{vehicleTypeLabel(jobCard.vehicleType)} {jobCard.vehicleNumber}</strong><p>{[jobCard.vehicle.make, jobCard.vehicle.model, jobCard.vehicle.color].filter(Boolean).join(" | ")}</p></div>
        <div><span>Job date</span><strong>{jobCard.jobDate}</strong><p>Delivery: {[jobCard.expectedDeliveryDate, jobCard.expectedDeliveryTime].filter(Boolean).join(" ") || "-"}</p></div>
      </div>
      <table className="invoice-items">
        <thead><tr><th>Service</th><th>Qty</th><th>Rate</th><th>GST</th><th>Total</th></tr></thead>
        <tbody>{jobCard.items.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPrice)}</td><td>{item.gstRate}%</td><td>{formatMoney(item.lineTotal)}</td></tr>)}</tbody>
      </table>
      <div className="invoice-total-grid">
        <Row label="Subtotal" value={formatMoney(jobCard.subTotal)} />
        <Row label="Discount" value={formatMoney(jobCard.discount)} />
        <Row label="Tax" value={formatMoney(jobCard.totalTax)} />
        <Row label="Estimate total" value={formatMoney(jobCard.grandTotal)} strong />
      </div>
      <div className="job-card-print-grid">
        <div><h3>Intake</h3><p>Odometer: {jobCard.odometer || "-"}</p><p>Fuel: {jobCard.fuelLevel || "-"}</p><p>Key received: {jobCard.keyReceived ? "Yes" : "No"}</p><p>{jobCard.belongingsNote || "No belongings note."}</p></div>
        <div><h3>Approval</h3><p>{jobCard.approvalName || "Approval pending"} {jobCard.approvalDate ? `on ${jobCard.approvalDate}` : ""}</p><p>{jobCard.approvalNotes || "No approval notes."}</p></div>
        <div><h3>Delivery</h3><p>{[jobCard.actualDeliveryDate, jobCard.actualDeliveryTime].filter(Boolean).join(" ") || "Delivery pending"}</p><p>{jobCard.deliveryNotes || "No delivery notes."}</p></div>
      </div>
      <div className="job-card-print-checklist">
        <h3>Checklist</h3>
        <div className="checklist-print-grid">{jobCard.checklist.map((item) => <span key={item.id}>{item.checked ? "[x]" : "[ ]"} {item.label}</span>)}</div>
      </div>
      {jobCard.photos.length > 0 && (
        <div className="job-card-print-photos">
          <h3>Photo proof</h3>
          <div className="print-photo-grid">
            {jobCard.photos.slice(0, 8).map((photo) => (
              <figure key={photo.id}>
                <img src={photo.url || ""} alt={statusLabel(photo.type)} />
                <figcaption>{statusLabel(photo.type)} - {photo.caption || photo.createdAt.slice(0, 10)}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

