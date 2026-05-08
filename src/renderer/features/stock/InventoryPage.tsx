import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Eye, Paperclip, Trash2, Upload } from "lucide-react";
import type { AppUser, InventoryDashboardData, InventoryItem, InventoryMovement, InventoryMovementInput, InventoryPurchaseInput, PaymentMode, PermissionKey, PurchaseRecord, PurchaseRecordDocument, PurchaseRecordInput, Supplier } from "../../../shared/types";
import { hasPermission } from "../../../shared/access-control";
import { InventoryReportPanel } from "./InventoryReportPanel";

type InventoryTab = "overview" | "items" | "purchases" | "purchaseRecords" | "remove" | "movements" | "suppliers" | "reports";
type InventoryReportGroup = "consumable" | "retail";

const inventoryTabs: Array<{ id: InventoryTab; label: string; permission: PermissionKey }> = [
  { id: "overview", label: "Overview", permission: "stock.view" },
  { id: "items", label: "Stock List", permission: "stock.view" },
  { id: "purchases", label: "Add Stock", permission: "stock.purchase" },
  { id: "purchaseRecords", label: "Purchase Records", permission: "stock.view" },
  { id: "remove", label: "Remove Stock", permission: "stock.adjust" },
  { id: "movements", label: "History", permission: "stock.view" },
  { id: "suppliers", label: "Suppliers", permission: "stock.suppliers" },
  { id: "reports", label: "Reports", permission: "stock.view" }
];

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const emptyPurchaseRecordInput = (): PurchaseRecordInput => ({
  purchaseDate: todayLocal(),
  supplierId: "",
  supplierName: "",
  vendorName: "",
  billNumber: "",
  amount: 0,
  paymentMode: "UPI",
  notes: "",
  documents: []
});
const fileNameFromPath = (filePath: string) => filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
};
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const inventoryTypeLabel = (type: InventoryReportGroup) => (type === "retail" ? "Retail products" : "Studio consumables");
const movementLabel = (type: string) => {
  const labels: Record<string, string> = {
    purchase: "Stock added",
    usage: "Stock removed",
    sale: "Sold on bill",
    adjustment: "Added correction",
    return: "Returned stock",
    damage: "Damaged/wasted",
    invoice_cancel_reversal: "Invoice cancellation reversal"
  };
  return labels[type] || statusLabel(type);
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function InventoryPage({
  refreshKey,
  notify,
  onChanged,
  tab,
  setTab,
  currentUser
}: {
  refreshKey: number;
  notify: (message: string) => void;
  onChanged: () => void;
  tab: InventoryTab;
  setTab: (tab: InventoryTab) => void;
  currentUser: AppUser;
}) {
  const [dashboard, setDashboard] = useState<InventoryDashboardData | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [purchaseRecords, setPurchaseRecords] = useState<PurchaseRecord[]>([]);
  const [purchaseRecordQuery, setPurchaseRecordQuery] = useState("");
  const [purchaseRecordForm, setPurchaseRecordForm] = useState<PurchaseRecordInput>(emptyPurchaseRecordInput());
  const [purchaseDocumentPaths, setPurchaseDocumentPaths] = useState<string[]>([]);
  const [savingPurchaseRecord, setSavingPurchaseRecord] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [itemForm, setItemForm] = useState<Partial<InventoryItem> & Pick<InventoryItem, "name">>({
    name: "",
    type: "consumable",
    unit: "piece",
    category: "Studio stock",
    retailPrice: 0,
    gstRate: 18,
    lowStockLevel: 0,
    active: true
  });
  const [supplierForm, setSupplierForm] = useState<Partial<Supplier> & Pick<Supplier, "name">>({ name: "" });
  const [purchaseForm, setPurchaseForm] = useState<InventoryPurchaseInput>({
    itemId: "",
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "",
    expiryDate: "",
    purchaseDate: todayLocal(),
    billNumber: "",
    quantity: 0,
    unitCost: 0,
    gstRate: 18
  });
  const [removeForm, setRemoveForm] = useState<InventoryMovementInput>({
    itemId: "",
    type: "usage",
    quantity: 0,
    reference: "",
    notes: "",
    movementDate: todayLocal()
  });

  const canManagePurchaseRecords = hasPermission(currentUser, "stock.purchase");
  const visibleTabs = inventoryTabs.filter((item) => hasPermission(currentUser, item.permission));
  const load = () =>
    Promise.all([
      window.autocare.inventoryDashboard(),
      window.autocare.listInventoryItems(includeInactive),
      (hasPermission(currentUser, "stock.suppliers") || hasPermission(currentUser, "stock.purchase")) ? window.autocare.listSuppliers() : Promise.resolve([]),
      window.autocare.listInventoryMovements(),
      window.autocare.listPurchaseRecords()
    ])
      .then(([dash, itemRows, supplierRows, movementRows, purchaseRecordRows]) => {
        setDashboard(dash);
        setItems(itemRows);
        setSuppliers(supplierRows);
        setMovements(movementRows);
        setPurchaseRecords(purchaseRecordRows);
      })
      .catch((error) => notify(error.message));

  useEffect(() => {
    load();
  }, [refreshKey, includeInactive, currentUser.id, currentUser.permissions.join("|")]);

  useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.some((item) => item.id === tab)) setTab(visibleTabs[0].id);
  }, [tab, visibleTabs.map((item) => item.id).join("|")]);

  const saveItem = async () => {
    try {
      await window.autocare.saveInventoryItem(itemForm);
      notify("Inventory item saved.");
      setItemForm({ name: "", type: "consumable", unit: "piece", category: "Studio stock", retailPrice: 0, gstRate: 18, lowStockLevel: 0, active: true });
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save item.");
    }
  };

  const saveSupplier = async () => {
    try {
      await window.autocare.saveSupplier(supplierForm);
      notify("Supplier saved.");
      setSupplierForm({ name: "" });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save supplier.");
    }
  };

  const addPurchase = async () => {
    try {
      await window.autocare.addInventoryPurchase(purchaseForm);
      notify("Purchase stock added.");
      setPurchaseForm({ ...purchaseForm, batchNumber: "", billNumber: "", quantity: 0, unitCost: 0 });
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add purchase.");
    }
  };

  const removeStock = async () => {
    try {
      await window.autocare.addInventoryMovement(removeForm);
      notify("Stock removed.");
      setRemoveForm({ ...removeForm, quantity: 0, reference: "", notes: "" });
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to remove stock.");
    }
  };

  const resetPurchaseRecordForm = () => {
    setPurchaseRecordForm(emptyPurchaseRecordInput());
    setPurchaseDocumentPaths([]);
  };

  const filteredPurchaseRecords = purchaseRecords.filter((record) => {
    const query = purchaseRecordQuery.trim().toLowerCase();
    return !query || JSON.stringify(record).toLowerCase().includes(query);
  });

  const selectPurchaseRecordSupplier = (supplierId: string) => {
    const supplier = suppliers.find((row) => row.id === supplierId);
    setPurchaseRecordForm({
      ...purchaseRecordForm,
      supplierId,
      supplierName: supplier?.name || "",
      vendorName: supplier?.name || purchaseRecordForm.vendorName
    });
  };

  const pickPurchaseDocuments = async () => {
    try {
      const selectedPaths = await window.autocare.pickPurchaseRecordDocuments();
      if (!selectedPaths.length) return;
      setPurchaseDocumentPaths((current) => [...new Set([...current, ...selectedPaths])]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to select documents.");
    }
  };

  const removePurchaseDocumentPath = (filePath: string) => {
    setPurchaseDocumentPaths((current) => current.filter((row) => row !== filePath));
  };

  const removePurchaseRecordDocument = (fileId: string) => {
    setPurchaseRecordForm({
      ...purchaseRecordForm,
      documents: (purchaseRecordForm.documents || []).filter((document) => document.fileId !== fileId)
    });
  };

  const savePurchaseRecord = async () => {
    if (!canManagePurchaseRecords) return;
    setSavingPurchaseRecord(true);
    try {
      await window.autocare.savePurchaseRecord(purchaseRecordForm, purchaseDocumentPaths);
      notify("Purchase record saved.");
      resetPurchaseRecordForm();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save purchase record.");
    } finally {
      setSavingPurchaseRecord(false);
    }
  };

  const editPurchaseRecord = (record: PurchaseRecord) => {
    setPurchaseRecordForm({
      id: record.id,
      purchaseDate: record.purchaseDate,
      supplierId: record.supplierId,
      supplierName: record.supplierName,
      vendorName: record.vendorName,
      billNumber: record.billNumber,
      amount: record.amount,
      paymentMode: record.paymentMode,
      notes: record.notes,
      documents: record.documents || [],
      createdAt: record.createdAt
    });
    setPurchaseDocumentPaths([]);
  };

  const deletePurchaseRecord = async (record: PurchaseRecord) => {
    if (!canManagePurchaseRecords || !window.confirm(`Delete purchase record ${record.billNumber || record.vendorName}?`)) return;
    try {
      await window.autocare.deletePurchaseRecord(record.id);
      notify("Purchase record deleted.");
      if (purchaseRecordForm.id === record.id) resetPurchaseRecordForm();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to delete purchase record.");
    }
  };

  const previewPurchaseDocument = async (document: PurchaseRecordDocument) => {
    try {
      const response = await window.autocare.readPurchaseRecordDocument(document.fileId, document.localPath);
      if (!response.ok || !response.dataUrl) {
        notify(response.message || "Unable to open document.");
        return;
      }
      const opened = window.open(response.dataUrl, "_blank", "noopener,noreferrer");
      if (!opened) notify("Document preview was blocked by the browser window.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to open document.");
    }
  };

  return (
    <div className="inventory-layout">
      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Inventory management</h2>
            <p>Add stock when you buy items. Remove stock when items are used, damaged, or wasted.</p>
          </div>
          <div className="segmented">
            {visibleTabs.map((item) => (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "overview" && dashboard && (
        <div className="page-grid">
          <div className="metric-strip">
            <Metric label="Stock value" value={formatMoney(dashboard.totalStockValue)} />
            <Metric label="Low stock" value={String(dashboard.lowStockCount)} tone={dashboard.lowStockCount ? "warn" : "ok"} />
            <Metric label="Expiring batches" value={String(dashboard.expiringCount)} tone={dashboard.expiringCount ? "warn" : "ok"} />
            <Metric label="Retail products" value={String(dashboard.retailCount)} />
          </div>
          <section className="panel">
            <h2>Low stock</h2>
            <InventoryItemList items={dashboard.lowStockItems} />
          </section>
          <section className="panel">
            <h2>Recent stock changes</h2>
            <MovementList movements={dashboard.recentMovements} />
          </section>
          <section className="panel wide-panel">
            <h2>Expiring batches</h2>
            <div className="table-wrap">
              <table><thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Value</th></tr></thead><tbody>
                {dashboard.expiringBatches.map((batch) => (
                  <tr key={batch.id}><td>{batch.itemName}</td><td>{batch.batchNumber || "-"}</td><td>{batch.expiryDate}</td><td>{batch.quantityRemaining} {batch.unit}</td><td>{formatMoney(batch.quantityRemaining * batch.unitCost)}</td></tr>
                ))}
              </tbody></table>
            </div>
          </section>
        </div>
      )}

      {tab === "items" && (
        <div className="split-layout inventory-split">
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Stock list</h2>
                <p>Consumables are used in the studio. Retail products are sold directly to customers.</p>
              </div>
              <label className="inline-check"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.currentTarget.checked)} /> Show inactive</label>
            </div>
            <InventoryItemTable items={items} onEdit={setItemForm} />
          </section>
          <aside className="panel summary-panel">
            <h2>{itemForm.id ? "Edit stock item" : "Add stock item"}</h2>
            <div className="form-stack">
              <label>Name<input value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.currentTarget.value })} /></label>
              <label>Type<select value={itemForm.type ?? "consumable"} onChange={(event) => setItemForm({ ...itemForm, type: event.currentTarget.value as InventoryItem["type"] })}><option value="consumable">Consumable</option><option value="retail">Retail</option></select></label>
              <label>Unit<input value={itemForm.unit ?? ""} onChange={(event) => setItemForm({ ...itemForm, unit: event.currentTarget.value })} /></label>
              <label>Category<input value={itemForm.category ?? ""} onChange={(event) => setItemForm({ ...itemForm, category: event.currentTarget.value })} /></label>
              <label>Internal code / SKU<input value={itemForm.sku ?? ""} onChange={(event) => setItemForm({ ...itemForm, sku: event.currentTarget.value })} /></label>
              <label>Selling price<input type="number" min="0" value={itemForm.retailPrice ?? 0} onChange={(event) => setItemForm({ ...itemForm, retailPrice: Number(event.currentTarget.value) })} /></label>
              <label>GST rate<input type="number" min="0" value={itemForm.gstRate ?? 0} onChange={(event) => setItemForm({ ...itemForm, gstRate: Number(event.currentTarget.value) })} /></label>
              <label>Low stock level<input type="number" min="0" value={itemForm.lowStockLevel ?? 0} onChange={(event) => setItemForm({ ...itemForm, lowStockLevel: Number(event.currentTarget.value) })} /></label>
              <button className="primary-action" onClick={saveItem}><Save size={18} /> Save item</button>
            </div>
          </aside>
        </div>
      )}

      {tab === "purchases" && (
        <section className="panel wide-panel">
          <h2>Add stock from purchase</h2>
          <p className="muted">Use this when you buy shampoo, polish, coating, towels, bottles, or retail products.</p>
          <div className="form-grid four">
            <label>Item<select value={purchaseForm.itemId} onChange={(event) => setPurchaseForm({ ...purchaseForm, itemId: event.currentTarget.value })}><option value="">Select item</option>{items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Supplier<select value={purchaseForm.supplierId} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplierId: event.currentTarget.value })}><option value="">New / none</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>New supplier<input value={purchaseForm.supplier?.name ?? ""} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: { name: event.currentTarget.value } })} /></label>
            <label>Bill number<input value={purchaseForm.billNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, billNumber: event.currentTarget.value })} /></label>
            <label>Purchase date<input type="date" value={purchaseForm.purchaseDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchaseDate: event.currentTarget.value })} /></label>
            <label>Batch number<input value={purchaseForm.batchNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, batchNumber: event.currentTarget.value })} /></label>
            <label>Expiry date<input type="date" value={purchaseForm.expiryDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, expiryDate: event.currentTarget.value })} /></label>
            <label>Quantity bought<input type="number" min="0" step="0.01" value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: Number(event.currentTarget.value) })} /></label>
            <label>Cost per unit<input type="number" min="0" step="0.01" value={purchaseForm.unitCost} onChange={(event) => setPurchaseForm({ ...purchaseForm, unitCost: Number(event.currentTarget.value) })} /></label>
            <label>GST rate<input type="number" min="0" value={purchaseForm.gstRate} onChange={(event) => setPurchaseForm({ ...purchaseForm, gstRate: Number(event.currentTarget.value) })} /></label>
            <button className="primary-action align-bottom" onClick={addPurchase}>Add purchase</button>
          </div>
        </section>
      )}

      {tab === "purchaseRecords" && (
        <div className={canManagePurchaseRecords ? "split-layout inventory-split" : "page-grid"}>
          <section className={`panel ${canManagePurchaseRecords ? "detail-panel" : "wide-panel"}`}>
            <div className="panel-heading">
              <div>
                <h2>Purchase records</h2>
                <p>Reference-only supplier bills and documents. These records do not change stock, expenses, profit, or reports.</p>
              </div>
              <label className="search-field">
                <span>Search</span>
                <input
                  value={purchaseRecordQuery}
                  onChange={(event) => setPurchaseRecordQuery(event.currentTarget.value)}
                  placeholder="Vendor, bill no., note"
                />
              </label>
            </div>
            <PurchaseRecordTable
              records={filteredPurchaseRecords}
              canManage={canManagePurchaseRecords}
              onEdit={editPurchaseRecord}
              onDelete={deletePurchaseRecord}
              onPreviewDocument={previewPurchaseDocument}
            />
          </section>

          {canManagePurchaseRecords && (
            <aside className="panel summary-panel">
              <div className="panel-heading compact">
                <div>
                  <h2>{purchaseRecordForm.id ? "Edit purchase record" : "Add purchase record"}</h2>
                  <p>Save bill details and optional PDF/image proof only.</p>
                </div>
                {purchaseRecordForm.id && <button className="ghost-button small" onClick={resetPurchaseRecordForm}>New</button>}
              </div>
              <div className="form-stack">
                <label>
                  Supplier
                  <select value={purchaseRecordForm.supplierId || ""} onChange={(event) => selectPurchaseRecordSupplier(event.currentTarget.value)}>
                    <option value="">Free text vendor</option>
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label>Vendor name<input value={purchaseRecordForm.vendorName} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, supplierId: "", supplierName: "", vendorName: event.currentTarget.value })} /></label>
                <label>Bill number<input value={purchaseRecordForm.billNumber} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, billNumber: event.currentTarget.value })} /></label>
                <label>Purchase date<input type="date" value={purchaseRecordForm.purchaseDate} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, purchaseDate: event.currentTarget.value })} /></label>
                <label>Amount<input type="number" min="0" step="0.01" value={purchaseRecordForm.amount} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, amount: Number(event.currentTarget.value) })} /></label>
                <label>
                  Payment mode
                  <select value={purchaseRecordForm.paymentMode} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, paymentMode: event.currentTarget.value as PaymentMode })}>
                    {paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </label>
                <label>Notes<textarea value={purchaseRecordForm.notes} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, notes: event.currentTarget.value })} /></label>

                <div className="form-stack">
                  <button className="ghost-button" onClick={pickPurchaseDocuments}><Upload size={16} /> Attach PDF/image</button>
                  <PurchaseDocumentList
                    documents={purchaseRecordForm.documents || []}
                    pendingPaths={purchaseDocumentPaths}
                    onPreview={previewPurchaseDocument}
                    onRemoveDocument={removePurchaseRecordDocument}
                    onRemovePath={removePurchaseDocumentPath}
                  />
                </div>

                <button className="primary-action" disabled={savingPurchaseRecord} onClick={savePurchaseRecord}>
                  <Save size={18} /> {savingPurchaseRecord ? "Saving..." : purchaseRecordForm.id ? "Update record" : "Save record"}
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {tab === "remove" && (
        <div className="page-grid">
          <section className="panel wide-panel">
            <h2>Remove stock</h2>
            <p className="muted">Use this for items used outside a bill, damaged stock, wastage, or correction. Bills and service recipes already remove stock automatically.</p>
            <div className="form-grid four">
              <label>Item<select value={removeForm.itemId} onChange={(event) => setRemoveForm({ ...removeForm, itemId: event.currentTarget.value })}><option value="">Select item</option>{items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.currentQuantity} {item.unit} available)</option>)}</select></label>
              <label>Reason<select value={removeForm.type} onChange={(event) => setRemoveForm({ ...removeForm, type: event.currentTarget.value as InventoryMovementInput["type"] })}><option value="usage">Used in studio</option><option value="damage">Damaged / wasted</option></select></label>
              <label>Quantity to remove<input type="number" min="0" step="0.01" value={removeForm.quantity} onChange={(event) => setRemoveForm({ ...removeForm, quantity: Number(event.currentTarget.value) })} /></label>
              <label>Date<input type="date" value={removeForm.movementDate} onChange={(event) => setRemoveForm({ ...removeForm, movementDate: event.currentTarget.value })} /></label>
              <label>Reference<input placeholder="Optional" value={removeForm.reference} onChange={(event) => setRemoveForm({ ...removeForm, reference: event.currentTarget.value })} /></label>
              <label className="wide-input">Notes<input placeholder="Example: spilled, used for demo, correction" value={removeForm.notes} onChange={(event) => setRemoveForm({ ...removeForm, notes: event.currentTarget.value })} /></label>
              <button className="primary-action align-bottom" onClick={removeStock}>Remove stock</button>
            </div>
          </section>
        </div>
      )}

      {tab === "movements" && (
        <div className="page-grid">
          <section className="panel wide-panel">
            <h2>Stock history</h2>
            <MovementTable movements={movements} />
          </section>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="split-layout">
          <section className="panel detail-panel">
            <h2>Suppliers</h2>
            <div className="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>Address</th><th></th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.phone}</td><td>{supplier.gstin}</td><td>{supplier.address}</td><td><button className="ghost-button small" onClick={() => setSupplierForm(supplier)}>Edit</button></td></tr>)}</tbody></table></div>
          </section>
          <aside className="panel summary-panel">
            <h2>{supplierForm.id ? "Edit supplier" : "Add supplier"}</h2>
            <div className="form-stack">
              <label>Name<input value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.currentTarget.value })} /></label>
              <label>Phone<input value={supplierForm.phone ?? ""} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.currentTarget.value })} /></label>
              <label>GSTIN<input value={supplierForm.gstin ?? ""} onChange={(event) => setSupplierForm({ ...supplierForm, gstin: event.currentTarget.value.toUpperCase() })} /></label>
              <label>Address<input value={supplierForm.address ?? ""} onChange={(event) => setSupplierForm({ ...supplierForm, address: event.currentTarget.value })} /></label>
              <button className="primary-action" onClick={saveSupplier}><Save size={18} /> Save supplier</button>
            </div>
          </aside>
        </div>
      )}

      {tab === "reports" && dashboard && (
        <div className="page-grid">
          <InventoryReportPanel
            title="Consumables report"
            items={dashboard.items.filter((item) => item.type === "consumable")}
            lowStockItems={dashboard.lowStockItems.filter((item) => item.type === "consumable")}
            movements={movements.filter((row) => row.itemType === "consumable")}
          />
          <InventoryReportPanel
            title="Retail report"
            items={dashboard.items.filter((item) => item.type === "retail")}
            lowStockItems={dashboard.lowStockItems.filter((item) => item.type === "retail")}
            movements={movements.filter((row) => row.itemType === "retail")}
          />
          <section className="panel wide-panel">
            <h2>Removed stock history</h2>
            <MovementTable movements={movements.filter((row) => row.type === "usage" || row.type === "damage")} />
          </section>
        </div>
      )}
    </div>
  );
}

function InventoryItemTable({ items, onEdit }: { items: InventoryItem[]; onEdit: (item: InventoryItem) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Available stock</th><th>Low alert</th><th>Stock value</th><th>Selling price</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td><td>{inventoryTypeLabel(item.type)}</td><td>{item.currentQuantity} {item.unit}</td><td>{item.lowStockLevel || "-"}</td><td>{formatMoney(item.stockValue)}</td><td>{formatMoney(item.retailPrice)}</td><td><span className={item.active ? "status paid" : "status unpaid"}>{item.active ? "Active" : "Inactive"}</span></td><td><button className="ghost-button small" onClick={() => onEdit(item)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryItemList({ items }: { items: InventoryItem[] }) {
  if (!items.length) return <div className="empty-state subtle">No stock records.</div>;
  return <div className="stack-list">{items.map((item) => <div className="stack-row" key={item.id}><div><strong>{item.name}</strong><span>{item.currentQuantity} {item.unit} available{item.lowStockLevel > 0 ? ` | low alert ${item.lowStockLevel}` : ""}</span></div><b>{formatMoney(item.stockValue)}</b></div>)}</div>;
}

function MovementList({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No stock movements.</div>;
  return <div className="stack-list">{movements.slice(0, 8).map((row) => <div className="stack-row" key={row.id}><div><strong>{row.itemName}</strong><span>{movementLabel(row.type)} | {row.quantity} {row.itemUnit} | {row.movementDate}</span></div><b>{formatMoney(row.quantity * row.unitCost)}</b></div>)}</div>;
}

function MovementTable({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No movements available.</div>;
  return (
    <div className="table-wrap">
      <table><thead><tr><th>Date</th><th>Item</th><th>Group</th><th>Action</th><th>Qty</th><th>Cost value</th><th>Reference</th><th>Notes</th></tr></thead><tbody>
        {movements.map((row) => <tr key={row.id}><td>{row.movementDate}</td><td>{row.itemName}</td><td>{inventoryTypeLabel(row.itemType)}</td><td>{movementLabel(row.type)}</td><td>{row.quantity} {row.itemUnit}</td><td>{formatMoney(row.quantity * row.unitCost)}</td><td>{row.reference}</td><td>{row.notes}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function PurchaseRecordTable({
  records,
  canManage,
  onEdit,
  onDelete,
  onPreviewDocument
}: {
  records: PurchaseRecord[];
  canManage: boolean;
  onEdit: (record: PurchaseRecord) => void;
  onDelete: (record: PurchaseRecord) => void;
  onPreviewDocument: (document: PurchaseRecordDocument) => void;
}) {
  if (!records.length) return <div className="empty-state subtle">No purchase records available.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Supplier / Vendor</th>
            <th>Bill no.</th>
            <th>Amount</th>
            <th>Payment</th>
            <th>Documents</th>
            <th>Notes</th>
            {canManage && <th></th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.purchaseDate}</td>
              <td>{record.supplierName || record.vendorName}</td>
              <td>{record.billNumber || "-"}</td>
              <td>{formatMoney(record.amount)}</td>
              <td>{record.paymentMode}</td>
              <td><PurchaseDocumentButtons documents={record.documents || []} onPreview={onPreviewDocument} /></td>
              <td>{record.notes || "-"}</td>
              {canManage && (
                <td>
                  <div className="inline-actions">
                    <button className="ghost-button small" onClick={() => onEdit(record)}>Edit</button>
                    <button className="ghost-button small danger-text" onClick={() => onDelete(record)}>Delete</button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PurchaseDocumentButtons({ documents, onPreview }: { documents: PurchaseRecordDocument[]; onPreview: (document: PurchaseRecordDocument) => void }) {
  if (!documents.length) return <span className="muted">-</span>;
  return (
    <div className="inline-actions">
      {documents.map((document) => (
        <button key={document.fileId} className="ghost-button small" title={document.originalName} onClick={() => onPreview(document)}>
          <Eye size={14} /> Open
        </button>
      ))}
    </div>
  );
}

function PurchaseDocumentList({
  documents,
  pendingPaths,
  onPreview,
  onRemoveDocument,
  onRemovePath
}: {
  documents: PurchaseRecordDocument[];
  pendingPaths: string[];
  onPreview: (document: PurchaseRecordDocument) => void;
  onRemoveDocument: (fileId: string) => void;
  onRemovePath: (filePath: string) => void;
}) {
  if (!documents.length && !pendingPaths.length) return <div className="empty-state subtle">No documents attached.</div>;
  return (
    <div className="stack-list">
      {documents.map((document) => (
        <div className="stack-row" key={document.fileId}>
          <div>
            <strong><Paperclip size={14} /> {document.originalName}</strong>
            <span>{document.mimeType} | {formatBytes(document.sizeBytes)}</span>
          </div>
          <div className="inline-actions">
            <button className="ghost-button small" onClick={() => onPreview(document)}><Eye size={14} /> Open</button>
            <button className="ghost-button small danger-text" onClick={() => onRemoveDocument(document.fileId)}><Trash2 size={14} /> Remove</button>
          </div>
        </div>
      ))}
      {pendingPaths.map((filePath) => (
        <div className="stack-row" key={filePath}>
          <div>
            <strong><Paperclip size={14} /> {fileNameFromPath(filePath)}</strong>
            <span>Pending upload</span>
          </div>
          <button className="ghost-button small danger-text" onClick={() => onRemovePath(filePath)}><Trash2 size={14} /> Remove</button>
        </div>
      ))}
    </div>
  );
}

