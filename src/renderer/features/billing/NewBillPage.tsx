import { Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } from "../../../shared/billing-math";
import type { BusinessSettings, Customer, CustomerWithVehicles, InventoryItem, InvoiceDetail, InvoiceDraft, InvoiceDraftCorrectionType, InvoiceDraftPayload, InvoiceItemInput, InvoiceMode, PaymentMode, ServiceItem, TaxScope, Vehicle, VehicleType } from "../../../shared/types";
import { CustomerSearchSelect } from "./CustomerSearchSelect";

type DraftItem = InvoiceItemInput & { key: string };
const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const vehicleTypes: VehicleType[] = ["car", "bike", "other"];
const PAID_AMOUNT_EXCEEDS_TOTAL_MESSAGE = "Entered paid amount is greater than billed amount.";

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatInvoiceDate = (date: string) => {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
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

const emptyInvoiceDraftPayload = (settings: BusinessSettings): InvoiceDraftPayload => ({
  invoiceMode: "gst",
  taxScope: settings.defaultTaxScope,
  invoiceDate: todayLocal(),
  customer: { name: "" },
  vehicle: emptyVehicle(),
  items: [emptyItem(settings)].map(({ key: _key, ...item }) => item),
  discount: 0,
  paidAmount: 0,
  paymentMode: "UPI",
  paymentReference: "",
  notes: ""
});

const draftItemsFromPayload = (payload: InvoiceDraftPayload, settings: BusinessSettings): DraftItem[] =>
  (payload.items?.length ? payload.items : emptyInvoiceDraftPayload(settings).items).map((item) => ({
    key: crypto.randomUUID(),
    serviceId: item.serviceId || "",
    inventoryItemId: item.inventoryItemId || "",
    description: item.description || "",
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
    unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : 0,
    gstRate: Number.isFinite(Number(item.gstRate)) ? Number(item.gstRate) : settings.defaultGstRate,
    sacCode: normalizeSacCode(item.sacCode)
  }));

const draftCorrectionLabel = (type: InvoiceDraftCorrectionType) =>
  type === "replacement" ? "Replacement draft" : type === "addon" ? "Add-on draft" : "Draft bill";

const calculateDraft = (mode: InvoiceMode, taxScope: TaxScope, items: DraftItem[], discount: number) => {
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

export function NewBillPage({
  settings,
  notify,
  onSaved,
  activeDraftId,
  setActiveDraftId
}: {
  settings: BusinessSettings;
  notify: (message: string) => void;
  onSaved: () => void;
  activeDraftId: string;
  setActiveDraftId: (id: string) => void;
}) {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [retailItems, setRetailItems] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([]);
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [mode, setMode] = useState<InvoiceMode>("gst");
  const [taxScope, setTaxScope] = useState<TaxScope>(settings.defaultTaxScope);
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [customer, setCustomer] = useState<Partial<Customer> & Pick<Customer, "name">>({ name: "" });
  const [vehicle, setVehicle] = useState<Partial<Vehicle> & Pick<Vehicle, "registrationNumber">>(emptyVehicle());
  const [items, setItems] = useState<DraftItem[]>([emptyItem(settings)]);
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("UPI");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");
  const [draftCorrectionType, setDraftCorrectionType] = useState<InvoiceDraftCorrectionType>("normal");
  const [draftStatus, setDraftStatus] = useState("Draft not saved yet");
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<InvoiceDetail | null>(null);
  const hydratingDraftRef = useRef(false);
  const locallySavedDraftIdRef = useRef("");
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const clearAutosaveTimer = () => {
    if (!autosaveTimerRef.current) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
  };

  useEffect(() => {
    Promise.all([
      window.autocare.listServices(),
      window.autocare.listCustomers(),
      window.autocare.listInventoryItems(),
      window.autocare.listInvoiceDrafts()
    ])
      .then(([serviceRows, customerRows, inventoryRows, draftRows]) => {
        setServices(serviceRows);
        setCustomers(customerRows);
        setRetailItems(inventoryRows.filter((item) => item.type === "retail" && item.active));
        setDrafts(draftRows);
        const firstDraft = draftRows[0];
        if (!activeDraftId && firstDraft) setActiveDraftId(firstDraft.id);
      })
      .catch((error) => notifyRef.current(error.message));
  }, []);

  const selectedCustomer = customers.find((item) => item.id === selectedCustomerId);
  const vehicleOptions = selectedCustomer?.vehicles ?? [];
  const totals = useMemo(() => calculateDraft(mode, taxScope, items, discount), [mode, taxScope, items, discount]);
  const paidAmountError = money(paidAmount) > money(totals.grandTotal) ? PAID_AMOUNT_EXCEEDS_TOTAL_MESSAGE : "";
  const balanceDue = money(totals.grandTotal - Math.min(Math.max(paidAmount, 0), totals.grandTotal));

  const buildPayload = (): InvoiceDraftPayload => ({
    invoiceMode: mode,
    taxScope,
    invoiceDate,
    sourceInvoiceId,
    selectedCustomerId,
    selectedVehicleId,
    customerId: selectedCustomerId || undefined,
    customer,
    vehicleId: selectedVehicleId || undefined,
    vehicle,
    items: items.map(({ key: _key, ...item }) => ({ ...item, sacCode: normalizeSacCode(item.sacCode) })),
    discount,
    paidAmount,
    paymentMode,
    paymentReference,
    notes
  });

  const draftHasContent = (payload: InvoiceDraftPayload) =>
    Boolean(
      payload.sourceInvoiceId ||
        payload.customer?.name?.trim() ||
        payload.customer?.phone?.trim() ||
        payload.customer?.email?.trim() ||
        payload.vehicle?.registrationNumber?.trim() ||
        payload.notes?.trim() ||
        payload.discount > 0 ||
        payload.paidAmount > 0 ||
        payload.items.some((item) => item.description.trim() || item.serviceId || item.inventoryItemId || item.unitPrice > 0)
    );

  const refreshDrafts = async () => {
    const rows = await window.autocare.listInvoiceDrafts();
    setDrafts(rows);
    return rows;
  };

  const resetDraftForm = () => {
    hydratingDraftRef.current = true;
    const emptyPayload = emptyInvoiceDraftPayload(settings);
    setMode(emptyPayload.invoiceMode);
    setTaxScope(emptyPayload.taxScope);
    setInvoiceDate(emptyPayload.invoiceDate);
    setSelectedCustomerId("");
    setSelectedVehicleId("");
    setCustomer({ name: "" });
    setVehicle(emptyVehicle());
    setItems([emptyItem(settings)]);
    setDiscount(0);
    setPaidAmount(0);
    setPaymentMode(emptyPayload.paymentMode);
    setPaymentReference("");
    setNotes("");
    setSourceInvoiceId("");
    setDraftCorrectionType("normal");
    setDraftStatus("Draft not saved yet");
    window.setTimeout(() => {
      hydratingDraftRef.current = false;
    }, 0);
  };

  const applyDraft = (draft: InvoiceDraft) => {
    const payload = draft.payload || emptyInvoiceDraftPayload(settings);
    hydratingDraftRef.current = true;
    setMode(payload.invoiceMode === "simple" ? "simple" : "gst");
    setTaxScope(payload.taxScope === "inter" ? "inter" : payload.taxScope === "intra" ? "intra" : settings.defaultTaxScope);
    setInvoiceDate(payload.invoiceDate || todayLocal());
    setSelectedCustomerId(payload.selectedCustomerId || payload.customerId || "");
    setSelectedVehicleId(payload.selectedVehicleId || payload.vehicleId || "");
    setCustomer({ ...payload.customer, name: payload.customer?.name || "" });
    setVehicle({ ...emptyVehicle(), ...payload.vehicle, registrationNumber: payload.vehicle?.registrationNumber || "" });
    setItems(draftItemsFromPayload(payload, settings));
    setDiscount(Number(payload.discount) || 0);
    setPaidAmount(Number(payload.paidAmount) || 0);
    setPaymentMode(payload.paymentMode || "UPI");
    setPaymentReference(payload.paymentReference || "");
    setNotes(payload.notes || "");
    setSourceInvoiceId(draft.sourceInvoiceId || payload.sourceInvoiceId || "");
    setDraftCorrectionType(draft.correctionType);
    setDraftStatus(`Draft saved ${formatInvoiceDate(draft.updatedAt.slice(0, 10))}`);
    setCreatedInvoice(null);
    window.setTimeout(() => {
      hydratingDraftRef.current = false;
    }, 0);
  };

  const saveDraft = async (silent = false) => {
    if (!silent) clearAutosaveTimer();
    const payload = buildPayload();
    if (!activeDraftId && !draftHasContent(payload)) {
      setDraftStatus("Draft not saved yet");
      return null;
    }
    if (!silent) setSavingDraft(true);
    setDraftStatus("Saving draft...");
    try {
      const draft = await window.autocare.saveInvoiceDraft({
        id: activeDraftId || undefined,
        sourceInvoiceId,
        correctionType: draftCorrectionType,
        payload
      });
      locallySavedDraftIdRef.current = activeDraftId === draft.id ? "" : draft.id;
      setActiveDraftId(draft.id);
      await refreshDrafts();
      setDraftStatus(`Draft saved ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
      if (!silent) notifyRef.current("Draft saved.");
      return draft;
    } catch (error) {
      setDraftStatus("Draft save failed");
      if (!silent) notifyRef.current(error instanceof Error ? error.message : "Unable to save draft.");
      return null;
    } finally {
      if (!silent) setSavingDraft(false);
    }
  };

  useEffect(() => {
    if (!activeDraftId) {
      resetDraftForm();
      return;
    }
    if (locallySavedDraftIdRef.current === activeDraftId) {
      locallySavedDraftIdRef.current = "";
      return;
    }
    let cancelled = false;
    window.autocare
      .getInvoiceDraft(activeDraftId)
      .then((draft) => {
        if (!cancelled) applyDraft(draft);
      })
      .catch((error) => {
        if (cancelled) return;
        notifyRef.current(error instanceof Error ? error.message : "Unable to load draft.");
        setActiveDraftId("");
      });
    return () => {
      cancelled = true;
    };
  }, [activeDraftId]);

  useEffect(() => {
    if (hydratingDraftRef.current) return;
    const payload = buildPayload();
    if (!activeDraftId && !draftHasContent(payload)) return;
    clearAutosaveTimer();
    setDraftStatus("Draft changes pending...");
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = undefined;
      void saveDraft(true);
    }, 900);
    return () => {
      clearAutosaveTimer();
    };
  }, [
    mode,
    taxScope,
    invoiceDate,
    selectedCustomerId,
    selectedVehicleId,
    customer,
    vehicle,
    items,
    discount,
    paidAmount,
    paymentMode,
    paymentReference,
    notes,
    sourceInvoiceId,
    draftCorrectionType
  ]);

  useEffect(() => () => clearAutosaveTimer(), []);

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

  const startNewDraft = () => {
    clearAutosaveTimer();
    setActiveDraftId("");
    setCreatedInvoice(null);
    resetDraftForm();
  };

  const discardDraft = async () => {
    if (!activeDraftId) {
      startNewDraft();
      return;
    }
    if (!window.confirm("Discard this draft bill?")) return;
    clearAutosaveTimer();
    setSavingDraft(true);
    try {
      await window.autocare.discardInvoiceDraft(activeDraftId);
      setActiveDraftId("");
      await refreshDrafts();
      resetDraftForm();
      notify("Draft discarded.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to discard draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  const finalizeInvoice = async () => {
    if (paidAmountError) {
      notify(paidAmountError);
      return;
    }
    clearAutosaveTimer();
    setSaving(true);
    try {
      const draft = await saveDraft(true);
      if (!draft) throw new Error("Enter bill details before finalizing.");
      const invoice = await window.autocare.finalizeInvoiceDraft(draft.id);
      setCreatedInvoice(invoice);
      notify(`Finalized ${invoice.invoiceNumber}`);
      setActiveDraftId("");
      await refreshDrafts();
      resetDraftForm();
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save invoice.";
      if (message.includes("Internet required to create final invoice number")) {
        setDraftStatus("Saved as draft. Internet required to create final invoice number.");
        notify("Internet required to create final invoice number. Saved as draft.");
      } else {
        notify(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bill-layout">
      <section className="panel bill-form">
        <div className="panel-heading">
          <div>
            <h2>Create bill draft</h2>
            <p>Drafts stay editable. Final invoices are locked for billing and GST history.</p>
          </div>
          <div className="segmented">
            <button className={mode === "gst" ? "active" : ""} onClick={() => setMode("gst")}>
              GST invoice
            </button>
            <button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>
              Simple receipt
            </button>
          </div>
        </div>

        <div className={`draft-banner ${draftCorrectionType}`}>
          <div>
            <strong>{draftCorrectionLabel(draftCorrectionType)}</strong>
            <span>{draftStatus}</span>
          </div>
          <div className="draft-controls">
            {drafts.length > 0 && (
              <select value={activeDraftId} onChange={(event) => setActiveDraftId(event.currentTarget.value)}>
                <option value="">Start new draft</option>
                {drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.name} - {draft.updatedAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            )}
            <button className="ghost-button small" onClick={startNewDraft}>New draft</button>
            <button className="ghost-button small" disabled={savingDraft} onClick={() => void saveDraft(false)}>
              Save draft
            </button>
            <button className="ghost-button small danger-action" disabled={savingDraft} onClick={() => void discardDraft()}>
              Discard
            </button>
          </div>
        </div>

        <div className="form-grid two">
          <label>
            Invoice date
            <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.currentTarget.value)} />
          </label>
          <label>
            Tax type
            <select value={taxScope} disabled={mode === "simple"} onChange={(event) => setTaxScope(event.currentTarget.value as TaxScope)}>
              <option value="intra">CGST + SGST</option>
              <option value="inter">IGST</option>
            </select>
          </label>
        </div>

        <div className="section-title">Customer and vehicle</div>
        <div className="form-grid two">
          <CustomerSearchSelect customers={customers} value={selectedCustomerId} onChange={chooseCustomer} />
          <label>
            Existing vehicle
            <select value={selectedVehicleId} disabled={!selectedCustomerId} onChange={(event) => chooseVehicle(event.currentTarget.value)}>
              <option value="">New vehicle</option>
              {vehicleOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {vehicleTypeLabel(item.vehicleType)} - {item.registrationNumber} {item.model ? `- ${item.model}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer ID
            <input readOnly value={customer.customerCode || "Assigned after finalize"} />
          </label>
          <label>
            Customer name
            <input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.currentTarget.value })} />
          </label>
          <label>
            Phone
            <input value={customer.phone ?? ""} onChange={(event) => setCustomer({ ...customer, phone: event.currentTarget.value })} />
          </label>
          <label>
            Customer email
            <input type="email" value={customer.email ?? ""} onChange={(event) => setCustomer({ ...customer, email: event.currentTarget.value })} />
          </label>
          <label>
            Customer GSTIN
            <input value={customer.gstin ?? ""} onChange={(event) => setCustomer({ ...customer, gstin: event.currentTarget.value.toUpperCase() })} />
          </label>
          <label>
            Address
            <input value={customer.address ?? ""} onChange={(event) => setCustomer({ ...customer, address: event.currentTarget.value })} />
          </label>
          <label>
            Vehicle type
            <select
              value={vehicle.vehicleType ?? "car"}
              onChange={(event) => setVehicle({ ...vehicle, vehicleType: event.currentTarget.value as VehicleType })}
            >
              {vehicleTypes.map((type) => (
                <option key={type} value={type}>
                  {vehicleTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle number
            <input
              value={vehicle.registrationNumber}
              onChange={(event) => setVehicle({ ...vehicle, registrationNumber: event.currentTarget.value.toUpperCase() })}
            />
          </label>
          <label>
            Make / model
            <input
              value={[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setVehicle({ ...vehicle, make: value, model: "" });
              }}
            />
          </label>
        </div>

        <div className="section-title with-action">
          Services
          <button className="ghost-button" onClick={() => setItems((current) => [...current, emptyItem(settings)])}>
            Add line
          </button>
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
              <select value={item.serviceId || ""} onChange={(event) => pickService(item.key, event.currentTarget.value)}>
                <option value="">Custom</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <select value={item.inventoryItemId || ""} onChange={(event) => pickRetailItem(item.key, event.currentTarget.value)}>
                <option value="">No retail item</option>
                {retailItems.map((retailItem) => (
                  <option key={retailItem.id} value={retailItem.id}>
                    {retailItem.name} ({retailItem.currentQuantity} {retailItem.unit})
                  </option>
                ))}
              </select>
              <input value={item.description} onChange={(event) => updateItem(item.key, { description: event.currentTarget.value })} />
              <input
                type="number"
                min="0"
                step="0.25"
                value={item.quantity}
                onChange={(event) => updateItem(item.key, { quantity: Number(event.currentTarget.value) })}
              />
              <input
                type="number"
                min="0"
                value={item.unitPrice}
                onChange={(event) => updateItem(item.key, { unitPrice: Number(event.currentTarget.value) })}
              />
              <input
                type="number"
                min="0"
                disabled={mode === "simple"}
                value={mode === "simple" ? 0 : item.gstRate}
                onChange={(event) => updateItem(item.key, { gstRate: Number(event.currentTarget.value) })}
              />
              <button
                className="icon-button"
                title="Remove line"
                onClick={() => setItems((current) => (current.length === 1 ? current : current.filter((row) => row.key !== item.key)))}
              >
                x
              </button>
            </div>
          ))}
        </div>

        <div className="form-grid three">
          <label>
            Discount
            <input type="number" min="0" value={discount} onChange={(event) => setDiscount(Number(event.currentTarget.value))} />
          </label>
          <label>
            Paid amount
            <input type="number" min="0" max={totals.grandTotal} step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(Number(event.currentTarget.value))} />
            {paidAmountError && <span className="field-error">{paidAmountError}</span>}
          </label>
          <label>
            Payment mode
            <select value={paymentMode} onChange={(event) => setPaymentMode(event.currentTarget.value as PaymentMode)}>
              {paymentModes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment reference
            <input value={paymentReference} onChange={(event) => setPaymentReference(event.currentTarget.value)} />
          </label>
          <label className="wide-input">
            Notes
            <input value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
          </label>
        </div>

        <div className="save-row">
          <div>
            <span>Balance due</span>
            <strong>{formatMoney(balanceDue)}</strong>
          </div>
          <button className="primary-action" disabled={saving || Boolean(paidAmountError)} onClick={finalizeInvoice}>
            <Save size={18} />
            {saving ? "Finalizing..." : "Finalize invoice"}
          </button>
        </div>
      </section>

      <aside className="panel summary-panel">
        <h2>Bill summary</h2>
        <SummaryRows totals={totals} paidAmount={paidAmount} balanceDue={balanceDue} />
        <div className="draft-summary">
          <span>Invoice number</span>
          <strong>Assigned only after finalize</strong>
          <span>Draft type</span>
          <strong>{draftCorrectionLabel(draftCorrectionType)}</strong>
        </div>
        {createdInvoice && (
          <div className="success-box">
            <strong>{createdInvoice.invoiceNumber} saved</strong>
            <span>{createdInvoice.customerName} - {formatMoney(createdInvoice.grandTotal)}</span>
          </div>
        )}
      </aside>
    </div>
  );
}

function SummaryRows({
  totals,
  paidAmount,
  balanceDue
}: {
  totals: ReturnType<typeof calculateDraft>;
  paidAmount: number;
  balanceDue: number;
}) {
  return (
    <div className="summary-rows">
      <Row label="Subtotal" value={formatMoney(totals.subTotal)} />
      <Row label="Discount" value={formatMoney(totals.discount)} />
      {totals.taxableValue > 0 && <Row label="Taxable value" value={formatMoney(totals.taxableValue)} />}
      {totals.cgst > 0 && <Row label="CGST" value={formatMoney(totals.cgst)} />}
      {totals.sgst > 0 && <Row label="SGST" value={formatMoney(totals.sgst)} />}
      {totals.igst > 0 && <Row label="IGST" value={formatMoney(totals.igst)} />}
      <Row label="Grand total" value={formatMoney(totals.grandTotal)} strong />
      <Row label="Paid" value={formatMoney(paidAmount)} />
      <Row label="Balance" value={formatMoney(balanceDue)} strong />
    </div>
  );
}

