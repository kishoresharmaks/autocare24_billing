import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, ClipboardList, Eye, Filter, Gauge, MinusCircle, Package, PackagePlus, Paperclip, PieChart, PlusCircle, ReceiptText, Search, ShoppingCart, Trash2, Upload } from "lucide-react";
import type { AppUser, InventoryDashboardData, InventoryItem, InventoryMovement, InventoryMovementInput, InventoryPurchaseInput, PaymentMode, PermissionKey, PurchaseRecord, PurchaseRecordDocument, PurchaseRecordInput, Supplier } from "../../../shared/types";
import { hasPermission } from "../../../shared/access-control";
import { money } from "../../../shared/billing-math";
import { InventoryReportPanel } from "./InventoryReportPanel";

type InventoryTab = "overview" | "items" | "purchases" | "purchaseRecords" | "remove" | "movements" | "suppliers" | "reports";
type InventoryReportGroup = "consumable" | "retail";
type InventoryTypeFilter = "all" | InventoryReportGroup;
type InventoryStockFilter = "all" | "available" | "low" | "out";

const inventoryTabs: Array<{ id: InventoryTab; label: string; permission: PermissionKey }> = [
  { id: "overview", label: "Overview", permission: "stock.view" },
  { id: "items", label: "Stock List", permission: "stock.view" },
  { id: "purchases", label: "Add Stock", permission: "stock.purchase" },
  { id: "purchaseRecords", label: "Purchase Records", permission: "stock.view" },
  { id: "remove", label: "Stock Action", permission: "stock.adjust" },
  { id: "movements", label: "History", permission: "stock.view" },
  { id: "suppliers", label: "Suppliers", permission: "stock.suppliers" },
  { id: "reports", label: "Reports", permission: "stock.view" }
];

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const localDateOffset = (daysOffset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatQuantity = (value: number) => money(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const percentOf = (value: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0);
const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const defaultInventoryUnits = ["piece", "bottle", "litre", "ml", "kg", "gram", "box", "packet", "set", "kit", "roll", "meter", "can", "pair"];
const defaultInventoryCategories = [
  "Studio stock",
  "Studio consumables",
  "Retail products",
  "Cleaning",
  "Polishing",
  "Coating",
  "Chemicals",
  "Tools",
  "Accessories",
  "Safety",
  "Spare parts",
  "Packaging"
];
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
const emptyInventoryPurchaseInput = (): InventoryPurchaseInput => ({
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
const emptyInventoryItemForm = (): Partial<InventoryItem> & Pick<InventoryItem, "name"> => ({
  name: "",
  type: "consumable",
  unit: "piece",
  category: "Studio stock",
  retailPrice: 0,
  gstRate: 18,
  lowStockLevel: 0,
  active: true
});
const nonNegativeInputNumber = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};
const nonNegativeWholeInputNumber = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};
const mergedDropdownOptions = (defaults: string[], values: Array<string | undefined>) => {
  const seen = new Set<string>();
  return [...defaults, ...values]
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
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
const isLowStockItem = (item: InventoryItem) => item.active && item.lowStockLevel > 0 && item.currentQuantity > 0 && item.currentQuantity <= item.lowStockLevel;
const isOutOfStockItem = (item: InventoryItem) => item.active && item.currentQuantity <= 0;
const stockStateLabel = (item: InventoryItem) => {
  if (!item.active) return "Inactive";
  if (isOutOfStockItem(item)) return "Out of stock";
  if (isLowStockItem(item)) return "Low stock";
  return "Available";
};
const stockStateClass = (item: InventoryItem) => {
  if (!item.active) return "unpaid";
  if (isOutOfStockItem(item)) return "out_stock";
  if (isLowStockItem(item)) return "low_stock";
  return "paid";
};
const movementLabel = (type: string) => {
  const labels: Record<string, string> = {
    purchase: "Stock added",
    usage: "Stock removed",
    sale: "Sold on bill",
    stock_sale: "Stock sold",
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
  const [itemForm, setItemForm] = useState<Partial<InventoryItem> & Pick<InventoryItem, "name">>(emptyInventoryItemForm());
  const [itemQuery, setItemQuery] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<InventoryTypeFilter>("all");
  const [itemStockFilter, setItemStockFilter] = useState<InventoryStockFilter>("all");
  const [supplierForm, setSupplierForm] = useState<Partial<Supplier> & Pick<Supplier, "name">>({ name: "" });
  const [purchaseForm, setPurchaseForm] = useState<InventoryPurchaseInput>(emptyInventoryPurchaseInput());
  const [removeForm, setRemoveForm] = useState<InventoryMovementInput>({
    itemId: "",
    type: "usage",
    quantity: 0,
    saleAmount: 0,
    paymentMode: "Cash",
    reference: "",
    notes: "",
    movementDate: todayLocal()
  });
  const [saleAmountEdited, setSaleAmountEdited] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [pendingDeleteRecordId, setPendingDeleteRecordId] = useState("");

  const canManagePurchaseRecords = hasPermission(currentUser, "stock.purchase");
  const visibleTabs = inventoryTabs.filter((item) => hasPermission(currentUser, item.permission));
  const canSaveItem = Boolean(itemForm.name.trim());
  const unitOptions = mergedDropdownOptions(defaultInventoryUnits, [...items.map((item) => item.unit), itemForm.unit]);
  const categoryOptions = mergedDropdownOptions(defaultInventoryCategories, [...items.map((item) => item.category), itemForm.category]);
  const activeItems = items.filter((item) => item.active);
  const selectedPurchaseItem = items.find((item) => item.id === purchaseForm.itemId);
  const selectedActionItem = items.find((item) => item.id === removeForm.itemId);
  const actionQuantity = nonNegativeInputNumber(String(removeForm.quantity));
  const actionRemaining = selectedActionItem ? money(selectedActionItem.currentQuantity - actionQuantity) : 0;
  const canSavePurchase = Boolean(purchaseForm.itemId) && nonNegativeInputNumber(String(purchaseForm.quantity)) > 0;
  const canSaveMovement = Boolean(removeForm.itemId) && actionQuantity > 0 && (!selectedActionItem || actionRemaining >= 0) && (removeForm.type !== "stock_sale" || nonNegativeInputNumber(String(removeForm.saleAmount || 0)) > 0);
  const purchaseSubtotal = money(nonNegativeInputNumber(String(purchaseForm.quantity)) * nonNegativeInputNumber(String(purchaseForm.unitCost)));
  const purchaseGstAmount = money((purchaseSubtotal * nonNegativeInputNumber(String(purchaseForm.gstRate))) / 100);
  const purchaseTotal = money(purchaseSubtotal + purchaseGstAmount);
  const filteredItems = items.filter((item) => {
    if (!includeInactive && !item.active) return false;
    if (itemTypeFilter !== "all" && item.type !== itemTypeFilter) return false;
    if (itemStockFilter === "available" && item.currentQuantity <= 0) return false;
    if (itemStockFilter === "low" && !isLowStockItem(item)) return false;
    if (itemStockFilter === "out" && !isOutOfStockItem(item)) return false;
    const query = itemQuery.trim().toLowerCase();
    if (!query) return true;
    return [item.name, item.sku, item.category, item.unit, item.type]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
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
    const firstTab = visibleTabs[0];
    if (!firstTab) return;
    if (!visibleTabs.some((item) => item.id === tab)) setTab(firstTab.id);
  }, [tab, visibleTabs.map((item) => item.id).join("|")]);

  const saveItem = async () => {
    if (!itemForm.name.trim()) {
      notify("Inventory item name is required.");
      return;
    }
    setSavingItem(true);
    try {
      await window.autocare.saveInventoryItem(itemForm);
      notify("Inventory item saved.");
      setItemForm(emptyInventoryItemForm());
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save item.");
    } finally {
      setSavingItem(false);
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
    if (!canSavePurchase) {
      notify("Select an item and enter purchase quantity.");
      return;
    }
    setSavingPurchase(true);
    try {
      await window.autocare.addInventoryPurchase(purchaseForm);
      notify("Purchase stock added.");
      setPurchaseForm(emptyInventoryPurchaseInput());
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add purchase.");
    } finally {
      setSavingPurchase(false);
    }
  };

  const quickSaleAmountFor = (itemId: string, quantity: number) => {
    const item = items.find((row) => row.id === itemId);
    return money((item?.retailPrice || 0) * (Number.isFinite(quantity) ? quantity : 0));
  };

  const updateRemoveItem = (itemId: string) => {
    setRemoveForm((current) => ({
      ...current,
      itemId,
      saleAmount: current.type === "stock_sale" && !saleAmountEdited ? quickSaleAmountFor(itemId, current.quantity) : current.saleAmount
    }));
  };

  const updateRemoveQuantity = (quantity: number) => {
    setRemoveForm((current) => ({
      ...current,
      quantity,
      saleAmount: current.type === "stock_sale" && !saleAmountEdited ? quickSaleAmountFor(current.itemId, quantity) : current.saleAmount
    }));
  };

  const updateRemoveType = (type: InventoryMovementInput["type"]) => {
    setSaleAmountEdited(false);
    setRemoveForm((current) => ({
      ...current,
      type,
      saleAmount: type === "stock_sale" ? quickSaleAmountFor(current.itemId, current.quantity) : 0,
      paymentMode: type === "stock_sale" ? current.paymentMode || "Cash" : "Cash"
    }));
  };

  const removeStock = async () => {
    if (!canSaveMovement) {
      notify(actionRemaining < 0 ? "Quantity is more than available stock." : "Select an item and enter quantity.");
      return;
    }
    setSavingMovement(true);
    try {
      await window.autocare.addInventoryMovement(removeForm);
      notify(removeForm.type === "stock_sale" ? "Stock sale recorded." : "Stock removed.");
      setRemoveForm({ ...removeForm, quantity: 0, saleAmount: 0, paymentMode: "Cash", reference: "", notes: "" });
      setSaleAmountEdited(false);
      await load();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to remove stock.");
    } finally {
      setSavingMovement(false);
    }
  };

  const resetPurchaseRecordForm = () => {
    setPurchaseRecordForm(emptyPurchaseRecordInput());
    setPurchaseDocumentPaths([]);
    setPendingDeleteRecordId("");
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
    setPendingDeleteRecordId("");
  };

  const requestDeletePurchaseRecord = (record: PurchaseRecord) => {
    if (!canManagePurchaseRecords) return;
    setPendingDeleteRecordId(record.id);
  };

  const deletePurchaseRecord = async (record: PurchaseRecord) => {
    if (!canManagePurchaseRecords) return;
    try {
      await window.autocare.deletePurchaseRecord(record.id);
      notify("Purchase record deleted.");
      if (purchaseRecordForm.id === record.id) resetPurchaseRecordForm();
      setPendingDeleteRecordId("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to delete purchase record.");
    }
  };

  const startNewItem = () => {
    setItemForm(emptyInventoryItemForm());
    setTab("items");
  };

  const openStockAction = (type: InventoryMovementInput["type"]) => {
    updateRemoveType(type);
    setTab("remove");
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
    <div className="inventory-layout stock-workspace">
      <section className="panel wide-panel stock-hero-panel">
        <div className="panel-heading stock-hero-heading">
          <div>
            <h2>Stock management</h2>
            <p>Track items, purchases, direct stock sales, removals, supplier records, and stock health.</p>
          </div>
        </div>
        <div className="stock-action-bar">
          <button className="stock-action-tile" onClick={startNewItem}><PlusCircle size={18} /><span>New Item</span></button>
          {hasPermission(currentUser, "stock.purchase") && <button className="stock-action-tile" onClick={() => setTab("purchases")}><PackagePlus size={18} /><span>Add Stock</span></button>}
          {hasPermission(currentUser, "stock.adjust") && <button className="stock-action-tile" onClick={() => openStockAction("stock_sale")}><ShoppingCart size={18} /><span>Stock Sale</span></button>}
          {hasPermission(currentUser, "stock.adjust") && <button className="stock-action-tile" onClick={() => openStockAction("usage")}><MinusCircle size={18} /><span>Remove Stock</span></button>}
          <button className="stock-action-tile" onClick={() => setTab("purchaseRecords")}><ReceiptText size={18} /><span>Purchase Record</span></button>
        </div>
      </section>

      {tab === "overview" && (
        <StockOverviewDashboard
          dashboard={dashboard}
          movements={movements}
          onNewItem={startNewItem}
          onAddStock={() => setTab("purchases")}
          onStockSale={() => openStockAction("stock_sale")}
          onRemoveStock={() => openStockAction("usage")}
          onHistory={() => setTab("movements")}
        />
      )}

      {tab === "items" && (
        <div className="split-layout inventory-split stock-items-workspace">
          <section className="panel detail-panel stock-list-panel">
            <div className="panel-heading">
              <div>
                <h2>Stock list</h2>
                <p>Search, filter, and edit all consumable and retail stock items.</p>
              </div>
              <button className="primary-action" onClick={startNewItem}><PlusCircle size={16} /> New item</button>
            </div>
            <div className="stock-filter-bar">
              <label className="search-field stock-search-field">
                <span><Search size={14} /> Search</span>
                <input value={itemQuery} onChange={(event) => setItemQuery(event.currentTarget.value)} placeholder="Name, SKU, unit, category" />
              </label>
              <label>
                <span><Filter size={14} /> Type</span>
                <select value={itemTypeFilter} onChange={(event) => setItemTypeFilter(event.currentTarget.value as InventoryTypeFilter)}>
                  <option value="all">All types</option>
                  <option value="consumable">Consumables</option>
                  <option value="retail">Retail</option>
                </select>
              </label>
              <label>
                <span>Stock</span>
                <select value={itemStockFilter} onChange={(event) => setItemStockFilter(event.currentTarget.value as InventoryStockFilter)}>
                  <option value="all">All stock</option>
                  <option value="available">Available</option>
                  <option value="low">Low stock</option>
                  <option value="out">Out of stock</option>
                </select>
              </label>
              <label className="inline-check stock-inline-check"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.currentTarget.checked)} /> Show inactive</label>
            </div>
            <InventoryItemTable items={filteredItems} onEdit={setItemForm} />
          </section>
          <aside className="panel summary-panel stock-editor-panel">
            <div className="panel-heading compact">
              <h2>{itemForm.id ? "Edit stock item" : "Add stock item"}</h2>
              {itemForm.id && <button className="ghost-button small" onClick={startNewItem}>New</button>}
            </div>
            <div className="form-stack">
              <label>Name<input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.currentTarget.value })} /></label>
              <label>Type<select value={itemForm.type ?? "consumable"} onChange={(event) => setItemForm({ ...itemForm, type: event.currentTarget.value as InventoryItem["type"] })}><option value="consumable">Consumable</option><option value="retail">Retail</option></select></label>
              <label>Unit<input list="inventory-unit-options" value={itemForm.unit ?? ""} onChange={(event) => setItemForm({ ...itemForm, unit: event.currentTarget.value })} /></label>
              <datalist id="inventory-unit-options">{unitOptions.map((option) => <option key={option} value={option} />)}</datalist>
              <label>Category<input list="inventory-category-options" value={itemForm.category ?? ""} onChange={(event) => setItemForm({ ...itemForm, category: event.currentTarget.value })} /></label>
              <datalist id="inventory-category-options">{categoryOptions.map((option) => <option key={option} value={option} />)}</datalist>
              <label>Internal code / SKU<input value={itemForm.sku ?? ""} onChange={(event) => setItemForm({ ...itemForm, sku: event.currentTarget.value })} /></label>
              <div className="form-grid two">
                <label>Selling price<input type="number" min="0" step="0.01" value={itemForm.retailPrice ?? 0} onChange={(event) => setItemForm({ ...itemForm, retailPrice: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
                <label>GST rate<input type="number" min="0" step="0.01" value={itemForm.gstRate ?? 0} onChange={(event) => setItemForm({ ...itemForm, gstRate: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
              </div>
              <label>Low stock level<input type="number" min="0" step="1" inputMode="numeric" value={itemForm.lowStockLevel ?? 0} onChange={(event) => setItemForm({ ...itemForm, lowStockLevel: nonNegativeWholeInputNumber(event.currentTarget.value) })} /></label>
              <button className="primary-action" disabled={!canSaveItem || savingItem} onClick={saveItem}><Save size={18} /> {savingItem ? "Saving..." : "Save item"}</button>
            </div>
          </aside>
        </div>
      )}

      {tab === "purchases" && (
        <div className="split-layout inventory-split stock-action-workspace">
          <section className="panel detail-panel">
            <div className="panel-heading compact">
              <div>
                <h2>Add stock from purchase</h2>
                <p>Record new stock, batch details, supplier, and cost.</p>
              </div>
            </div>
            <div className="form-grid three">
              <label>Item<select value={purchaseForm.itemId} onChange={(event) => setPurchaseForm({ ...purchaseForm, itemId: event.currentTarget.value })}><option value="">Select item</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Supplier<select value={purchaseForm.supplierId} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplierId: event.currentTarget.value })}><option value="">New / none</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>New supplier<input value={purchaseForm.supplier?.name ?? ""} onChange={(event) => setPurchaseForm({ ...purchaseForm, supplier: { name: event.currentTarget.value } })} /></label>
              <label>Bill number<input value={purchaseForm.billNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, billNumber: event.currentTarget.value })} /></label>
              <label>Purchase date<input type="date" value={purchaseForm.purchaseDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchaseDate: event.currentTarget.value })} /></label>
              <label>Batch number<input value={purchaseForm.batchNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, batchNumber: event.currentTarget.value })} /></label>
              <label>Expiry date<input type="date" value={purchaseForm.expiryDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, expiryDate: event.currentTarget.value })} /></label>
              <label>Quantity bought<input type="number" min="0" step="0.01" value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
              <label>Cost per unit<input type="number" min="0" step="0.01" value={purchaseForm.unitCost} onChange={(event) => setPurchaseForm({ ...purchaseForm, unitCost: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
              <label>GST rate<input type="number" min="0" step="0.01" value={purchaseForm.gstRate} onChange={(event) => setPurchaseForm({ ...purchaseForm, gstRate: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
            </div>
          </section>
          <aside className="panel summary-panel stock-preview-panel">
            <h2>Purchase preview</h2>
            {selectedPurchaseItem ? (
              <div className="stock-selected-item">
                <Package size={18} />
                <div><strong>{selectedPurchaseItem.name}</strong><span>{selectedPurchaseItem.currentQuantity} {selectedPurchaseItem.unit} available</span></div>
              </div>
            ) : <div className="empty-state subtle">Select a stock item.</div>}
            <div className="summary-rows">
              <div className="summary-row"><span>Quantity</span><strong>{purchaseForm.quantity || 0}</strong></div>
              <div className="summary-row"><span>Subtotal</span><strong>{formatMoney(purchaseSubtotal)}</strong></div>
              <div className="summary-row"><span>GST</span><strong>{formatMoney(purchaseGstAmount)}</strong></div>
              <div className="summary-row strong"><span>Total cost</span><strong>{formatMoney(purchaseTotal)}</strong></div>
            </div>
            <button className="primary-action full-width-action" disabled={!canSavePurchase || savingPurchase} onClick={addPurchase}><PackagePlus size={18} /> {savingPurchase ? "Adding..." : "Add purchase"}</button>
          </aside>
        </div>
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
                <span><Search size={14} /> Search</span>
                <input value={purchaseRecordQuery} onChange={(event) => setPurchaseRecordQuery(event.currentTarget.value)} placeholder="Vendor, bill no., note" />
              </label>
            </div>
            <PurchaseRecordTable
              records={filteredPurchaseRecords}
              canManage={canManagePurchaseRecords}
              pendingDeleteId={pendingDeleteRecordId}
              onEdit={editPurchaseRecord}
              onAskDelete={requestDeletePurchaseRecord}
              onCancelDelete={() => setPendingDeleteRecordId("")}
              onConfirmDelete={deletePurchaseRecord}
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
                <label>Amount<input type="number" min="0" step="0.01" value={purchaseRecordForm.amount} onChange={(event) => setPurchaseRecordForm({ ...purchaseRecordForm, amount: nonNegativeInputNumber(event.currentTarget.value) })} /></label>
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
        <div className="split-layout inventory-split stock-action-workspace">
          <section className="panel detail-panel">
            <div className="panel-heading compact">
              <div>
                <h2>Stock action</h2>
                <p>Record studio use, direct stock sale, damage, wastage, or correction.</p>
              </div>
            </div>
            <div className="stock-reason-grid">
              <button className={removeForm.type === "usage" ? "active" : ""} onClick={() => updateRemoveType("usage")}><MinusCircle size={18} /><span>Used in studio</span></button>
              <button className={removeForm.type === "stock_sale" ? "active" : ""} onClick={() => updateRemoveType("stock_sale")}><ShoppingCart size={18} /><span>Stock sold</span></button>
              <button className={removeForm.type === "damage" ? "active" : ""} onClick={() => updateRemoveType("damage")}><AlertTriangle size={18} /><span>Damaged / wasted</span></button>
            </div>
            <div className="form-grid two">
              <label>Item<select value={removeForm.itemId} onChange={(event) => updateRemoveItem(event.currentTarget.value)}><option value="">Select item</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.currentQuantity} {item.unit} available)</option>)}</select></label>
              <label>Quantity<input type="number" min="0" step="0.01" value={removeForm.quantity} onChange={(event) => updateRemoveQuantity(nonNegativeInputNumber(event.currentTarget.value))} /></label>
              <label>Date<input type="date" value={removeForm.movementDate} onChange={(event) => setRemoveForm({ ...removeForm, movementDate: event.currentTarget.value })} /></label>
              {removeForm.type === "stock_sale" && <label>Sale amount<input type="number" min="0" step="0.01" value={removeForm.saleAmount || 0} onChange={(event) => { setSaleAmountEdited(true); setRemoveForm({ ...removeForm, saleAmount: nonNegativeInputNumber(event.currentTarget.value) }); }} /></label>}
              {removeForm.type === "stock_sale" && <label>Payment mode<select value={removeForm.paymentMode || "Cash"} onChange={(event) => setRemoveForm({ ...removeForm, paymentMode: event.currentTarget.value as PaymentMode })}>{paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>}
              <label>Reference<input placeholder="Optional" value={removeForm.reference} onChange={(event) => setRemoveForm({ ...removeForm, reference: event.currentTarget.value })} /></label>
              <label className="wide-input">Notes<input placeholder="Example: used for demo, correction" value={removeForm.notes} onChange={(event) => setRemoveForm({ ...removeForm, notes: event.currentTarget.value })} /></label>
            </div>
          </section>
          <aside className="panel summary-panel stock-preview-panel">
            <h2>Action preview</h2>
            {selectedActionItem ? (
              <>
                <div className="stock-selected-item">
                  <Package size={18} />
                  <div><strong>{selectedActionItem.name}</strong><span>{selectedActionItem.currentQuantity} {selectedActionItem.unit} available</span></div>
                </div>
                <div className="summary-rows">
                  <div className="summary-row"><span>Action</span><strong>{movementLabel(removeForm.type)}</strong></div>
                  <div className="summary-row"><span>Removing</span><strong>{actionQuantity} {selectedActionItem.unit}</strong></div>
                  <div className={`summary-row ${actionRemaining < 0 ? "danger" : ""}`}><span>Remaining</span><strong>{actionRemaining} {selectedActionItem.unit}</strong></div>
                  {removeForm.type === "stock_sale" && <div className="summary-row strong"><span>Sale value</span><strong>{formatMoney(removeForm.saleAmount || 0)}</strong></div>}
                </div>
                {actionRemaining < 0 && <div className="inline-error">Quantity is more than available stock.</div>}
              </>
            ) : <div className="empty-state subtle">Select a stock item.</div>}
            <button className="primary-action full-width-action" disabled={!canSaveMovement || savingMovement} onClick={removeStock}>
              {removeForm.type === "stock_sale" ? <ShoppingCart size={18} /> : <MinusCircle size={18} />}
              {savingMovement ? "Saving..." : removeForm.type === "stock_sale" ? "Record stock sale" : "Save stock action"}
            </button>
          </aside>
        </div>
      )}

      {tab === "movements" && (
        <div className="page-grid">
          <section className="panel wide-panel">
            <div className="panel-heading compact">
              <h2>Stock history</h2>
              <span className="status paid">{movements.length} movements</span>
            </div>
            <MovementTable movements={movements} />
          </section>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="split-layout">
          <section className="panel detail-panel">
            <div className="panel-heading compact"><h2>Suppliers</h2></div>
            <div className="table-wrap stock-table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>Address</th><th></th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.phone}</td><td>{supplier.gstin}</td><td>{supplier.address}</td><td><button className="ghost-button small" onClick={() => setSupplierForm(supplier)}>Edit</button></td></tr>)}</tbody></table></div>
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
            <div className="panel-heading compact"><h2>Removed stock history</h2></div>
            <MovementTable movements={movements.filter((row) => row.type === "usage" || row.type === "damage")} />
          </section>
        </div>
      )}
    </div>
  );
}

function StockOverviewDashboard({
  dashboard,
  movements,
  onNewItem,
  onAddStock,
  onStockSale,
  onRemoveStock,
  onHistory
}: {
  dashboard: InventoryDashboardData | null;
  movements: InventoryMovement[];
  onNewItem: () => void;
  onAddStock: () => void;
  onStockSale: () => void;
  onRemoveStock: () => void;
  onHistory: () => void;
}) {
  if (!dashboard) {
    return <section className="panel wide-panel"><div className="empty-state subtle">Loading stock dashboard...</div></section>;
  }

  const activeItems = dashboard.items.filter((item) => item.active);
  const outItems = activeItems.filter(isOutOfStockItem);
  const lowItems = dashboard.lowStockItems.filter((item) => item.active && !isOutOfStockItem(item));
  const healthyItems = activeItems.filter((item) => !isLowStockItem(item) && !isOutOfStockItem(item));
  const inactiveItems = dashboard.items.filter((item) => !item.active);
  const totalActive = activeItems.length;
  const healthyPercent = percentOf(healthyItems.length, totalActive);
  const lowPercent = percentOf(lowItems.length, totalActive);
  const outPercent = percentOf(outItems.length, totalActive);
  const totalQuantity = activeItems.reduce((sum, item) => sum + money(item.currentQuantity), 0);
  const consumableValue = money(dashboard.items.filter((item) => item.type === "consumable").reduce((sum, item) => sum + money(item.stockValue), 0));
  const retailValue = money(dashboard.items.filter((item) => item.type === "retail").reduce((sum, item) => sum + money(item.stockValue), 0));
  const maxValue = Math.max(consumableValue, retailValue, 1);
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = localDateOffset(index - 6);
    const dayMovements = movements.filter((movement) => movement.movementDate === date);
    return {
      date,
      label: date.slice(5),
      count: dayMovements.length,
      sales: money(dayMovements.filter((movement) => movement.type === "stock_sale").reduce((sum, movement) => sum + money(movement.saleAmount), 0)),
      stockOut: dayMovements.filter((movement) => ["usage", "damage", "stock_sale", "sale"].includes(movement.type)).length,
      stockIn: dayMovements.filter((movement) => movement.type === "purchase" || movement.type === "return" || movement.type === "adjustment").length
    };
  });
  const maxTrendCount = Math.max(...trend.map((item) => item.count), 1);
  const directSales = money(movements.filter((movement) => movement.type === "stock_sale").reduce((sum, movement) => sum + money(movement.saleAmount), 0));
  const riskCount = lowItems.length + outItems.length + dashboard.expiringBatches.length;

  return (
    <div className="stock-command-dashboard">
      <section className="panel stock-command-hero">
        <div className="stock-command-copy">
          <span className="stock-dashboard-eyebrow"><Gauge size={14} /> Live stock command center</span>
          <h2>{riskCount ? `${riskCount} stock point${riskCount === 1 ? "" : "s"} need attention` : "Stock is healthy"}</h2>
          <p>Value, availability, expiry risk, and movement activity are grouped here for quick counter decisions.</p>
          <div className="stock-command-actions">
            <button className="primary-action" onClick={onAddStock}><PackagePlus size={16} /> Add stock</button>
            <button className="ghost-button" onClick={onStockSale}><ShoppingCart size={16} /> Stock sale</button>
            <button className="ghost-button" onClick={onNewItem}><PlusCircle size={16} /> New item</button>
          </div>
        </div>
        <div className="stock-health-ring-card">
          <div
            className="stock-health-ring"
            style={{
              background: `conic-gradient(#1c5d52 0 ${healthyPercent}%, #c7832d ${healthyPercent}% ${healthyPercent + lowPercent}%, #9b3e2f ${healthyPercent + lowPercent}% ${healthyPercent + lowPercent + outPercent}%, #e5ded3 ${healthyPercent + lowPercent + outPercent}% 100%)`
            }}
          >
            <div>
              <strong>{healthyPercent}%</strong>
              <span>healthy</span>
            </div>
          </div>
          <div className="stock-ring-legend">
            <span><b className="legend-ok"></b>{healthyItems.length} healthy</span>
            <span><b className="legend-warn"></b>{lowItems.length} low</span>
            <span><b className="legend-danger"></b>{outItems.length} out</span>
          </div>
        </div>
      </section>

      <div className="stock-dashboard-kpis">
        <DashboardKpi icon={Package} label="Stock value" value={formatMoney(dashboard.totalStockValue)} hint={`${formatQuantity(totalQuantity)} units in stock`} />
        <DashboardKpi icon={AlertTriangle} label="Low / out" value={`${lowItems.length} / ${outItems.length}`} hint="Low alert and empty items" tone={lowItems.length || outItems.length ? "warn" : "ok"} />
        <DashboardKpi icon={PieChart} label="Expiring" value={String(dashboard.expiringCount)} hint="Batches in next 30 days" tone={dashboard.expiringCount ? "warn" : "ok"} />
        <DashboardKpi icon={ShoppingCart} label="Direct sales" value={formatMoney(directSales)} hint="Quick stock sale total" />
      </div>

      <div className="stock-visual-grid">
        <section className="panel stock-chart-panel">
          <div className="panel-heading compact">
            <div><h2>Value by stock type</h2><p>Consumables vs retail product value.</p></div>
            <BarChart3 size={18} />
          </div>
          <ValueBar label="Consumables" value={consumableValue} maxValue={maxValue} tone="teal" />
          <ValueBar label="Retail products" value={retailValue} maxValue={maxValue} tone="gold" />
        </section>

        <section className="panel stock-chart-panel">
          <div className="panel-heading compact">
            <div><h2>7-day movement activity</h2><p>Daily stock movement count with stock-in and stock-out split.</p></div>
            <Activity size={18} />
          </div>
          <div className="stock-trend-bars">
            {trend.map((point) => (
              <div className="stock-trend-day" key={point.date}>
                <div className="stock-trend-bar" title={`${point.count} movement${point.count === 1 ? "" : "s"}`}>
                  <span className="stock-in-bar" style={{ height: `${percentOf(point.stockIn, maxTrendCount)}%` }}></span>
                  <span className="stock-out-bar" style={{ height: `${percentOf(point.stockOut, maxTrendCount)}%` }}></span>
                </div>
                <small>{point.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel stock-chart-panel stock-risk-panel">
          <div className="panel-heading compact">
            <div><h2>Stock risk mix</h2><p>Items grouped by operational status.</p></div>
            <Gauge size={18} />
          </div>
          <RiskRow label="Healthy" value={healthyItems.length} total={Math.max(totalActive, 1)} tone="ok" />
          <RiskRow label="Low stock" value={lowItems.length} total={Math.max(totalActive, 1)} tone="warn" />
          <RiskRow label="Out of stock" value={outItems.length} total={Math.max(totalActive, 1)} tone="danger" />
          <RiskRow label="Inactive" value={inactiveItems.length} total={Math.max(dashboard.items.length, 1)} tone="muted" />
        </section>
      </div>

      <div className="stock-operations-grid">
        <section className="panel stock-watch-panel">
          <div className="panel-heading compact">
            <div><h2>Priority watchlist</h2><p>Low and empty stock items.</p></div>
            <button className="ghost-button small" onClick={onRemoveStock}><MinusCircle size={14} /> Stock action</button>
          </div>
          <InventoryItemList items={[...outItems, ...lowItems].slice(0, 8)} />
        </section>

        <section className="panel stock-watch-panel">
          <div className="panel-heading compact">
            <div><h2>Expiring batches</h2><p>Batches requiring rotation or sale.</p></div>
            {dashboard.expiringCount > 0 && <span className="status partial">Next 30 days</span>}
          </div>
          <ExpiringBatchList batches={dashboard.expiringBatches.slice(0, 8)} />
        </section>

        <section className="panel stock-watch-panel wide-panel">
          <div className="panel-heading compact">
            <div><h2>Latest stock movement</h2><p>Recent purchases, removals, direct sales, and invoice stock use.</p></div>
            <button className="ghost-button small" onClick={onHistory}><ClipboardList size={14} /> History</button>
          </div>
          <MovementList movements={dashboard.recentMovements} />
        </section>
      </div>
    </div>
  );
}

function DashboardKpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Package; label: string; value: string; hint: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`stock-dashboard-kpi ${tone ?? ""}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function ValueBar({ label, value, maxValue, tone }: { label: string; value: number; maxValue: number; tone: "teal" | "gold" }) {
  return (
    <div className="stock-value-row">
      <div><strong>{label}</strong><span>{formatMoney(value)}</span></div>
      <div className={`stock-value-track ${tone}`}><b style={{ width: `${percentOf(value, maxValue)}%` }}></b></div>
    </div>
  );
}

function RiskRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: "ok" | "warn" | "danger" | "muted" }) {
  return (
    <div className="stock-risk-row">
      <div><strong>{label}</strong><span>{value}</span></div>
      <div className={`stock-risk-track ${tone}`}><b style={{ width: `${percentOf(value, total)}%` }}></b></div>
    </div>
  );
}

function ExpiringBatchList({ batches }: { batches: InventoryDashboardData["expiringBatches"] }) {
  if (!batches.length) return <div className="empty-state subtle">No expiring batches.</div>;
  return (
    <div className="stack-list">
      {batches.map((batch) => (
        <div className="stack-row" key={batch.id}>
          <div>
            <strong>{batch.itemName}</strong>
            <span>{batch.batchNumber || "No batch"} | expires {batch.expiryDate}</span>
          </div>
          <b>{batch.quantityRemaining} {batch.unit}</b>
        </div>
      ))}
    </div>
  );
}

function InventoryItemTable({ items, onEdit }: { items: InventoryItem[]; onEdit: (item: InventoryItem) => void }) {
  if (!items.length) return <div className="empty-state subtle">No stock items match the current filters.</div>;
  return (
    <div className="table-wrap stock-table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Available stock</th><th>Low alert</th><th>Stock value</th><th>Selling price</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.name}</strong>
                <span className="muted">{item.sku || item.category || "-"}</span>
              </td>
              <td>{inventoryTypeLabel(item.type)}</td>
              <td>{item.currentQuantity} {item.unit}</td>
              <td>{item.lowStockLevel || "-"}</td>
              <td>{formatMoney(item.stockValue)}</td>
              <td>{formatMoney(item.retailPrice)}</td>
              <td><StockStatusBadges item={item} /></td>
              <td><button className="ghost-button small" onClick={() => onEdit(item)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockStatusBadges({ item }: { item: InventoryItem }) {
  return (
    <div className="stock-status-stack">
      <span className={`status ${item.active ? "paid" : "unpaid"}`}>{item.active ? "Active" : "Inactive"}</span>
      {item.active && <span className={`status ${stockStateClass(item)}`}>{stockStateLabel(item)}</span>}
    </div>
  );
}

function InventoryItemList({ items }: { items: InventoryItem[] }) {
  if (!items.length) return <div className="empty-state subtle">No stock records.</div>;
  return <div className="stack-list">{items.map((item) => <div className="stack-row" key={item.id}><div><strong>{item.name}</strong><span>{item.currentQuantity} {item.unit} available{item.lowStockLevel > 0 ? ` | low alert ${item.lowStockLevel}` : ""}</span></div><b>{formatMoney(item.stockValue)}</b></div>)}</div>;
}

function MovementList({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No stock movements.</div>;
  return <div className="stack-list">{movements.slice(0, 8).map((row) => <div className="stack-row" key={row.id}><div><strong>{row.itemName}</strong><span>{movementLabel(row.type)} | {row.quantity} {row.itemUnit} | {row.movementDate}{row.type === "stock_sale" ? ` | ${row.paymentMode || "Cash"}` : ""}</span></div><b>{row.type === "stock_sale" ? formatMoney(row.saleAmount) : formatMoney(row.quantity * row.unitCost)}</b></div>)}</div>;
}

function MovementTable({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No movements available.</div>;
  return (
    <div className="table-wrap">
      <table><thead><tr><th>Date</th><th>Item</th><th>Group</th><th>Action</th><th>Qty</th><th>Cost value</th><th>Sale value</th><th>Payment</th><th>Reference</th><th>Notes</th></tr></thead><tbody>
        {movements.map((row) => <tr key={row.id}><td>{row.movementDate}</td><td>{row.itemName}</td><td>{inventoryTypeLabel(row.itemType)}</td><td>{movementLabel(row.type)}</td><td>{row.quantity} {row.itemUnit}</td><td>{formatMoney(row.quantity * row.unitCost)}</td><td>{row.type === "stock_sale" ? formatMoney(row.saleAmount) : "-"}</td><td>{row.type === "stock_sale" ? row.paymentMode || "Cash" : "-"}</td><td>{row.reference}</td><td>{row.notes}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function PurchaseRecordTable({
  records,
  canManage,
  pendingDeleteId,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onPreviewDocument
}: {
  records: PurchaseRecord[];
  canManage: boolean;
  pendingDeleteId: string;
  onEdit: (record: PurchaseRecord) => void;
  onAskDelete: (record: PurchaseRecord) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (record: PurchaseRecord) => void;
  onPreviewDocument: (document: PurchaseRecordDocument) => void;
}) {
  if (!records.length) return <div className="empty-state subtle">No purchase records available.</div>;
  return (
    <div className="table-wrap stock-table-wrap">
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
            <tr key={record.id} className={pendingDeleteId === record.id ? "pending-delete-row" : ""}>
              <td>{record.purchaseDate}</td>
              <td>{record.supplierName || record.vendorName}</td>
              <td>{record.billNumber || "-"}</td>
              <td>{formatMoney(record.amount)}</td>
              <td>{record.paymentMode}</td>
              <td><PurchaseDocumentButtons documents={record.documents || []} onPreview={onPreviewDocument} /></td>
              <td>{record.notes || "-"}</td>
              {canManage && (
                <td>
                  {pendingDeleteId === record.id ? (
                    <div className="inline-actions confirm-actions">
                      <button className="ghost-button small danger-text" onClick={() => onConfirmDelete(record)}>Confirm</button>
                      <button className="ghost-button small" onClick={onCancelDelete}>Cancel</button>
                    </div>
                  ) : (
                    <div className="inline-actions">
                      <button className="ghost-button small" onClick={() => onEdit(record)}>Edit</button>
                      <button className="ghost-button small danger-text" onClick={() => onAskDelete(record)}>Delete</button>
                    </div>
                  )}
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

