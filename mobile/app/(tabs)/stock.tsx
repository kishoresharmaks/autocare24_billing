import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Building2,
  CalendarClock,
  FileText,
  Package,
  ReceiptText,
  Search,
  ShoppingBag,
  Truck
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { fetchInventoryDashboard, fetchPurchaseRecords, fetchSuppliers } from "../../src/services/cloudApi";
import { ExportActions } from "../../src/components/ExportActions";
import { FormField } from "../../src/components/FormField";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import { colors, radius } from "../../src/theme";
import { exportStockDocument, type ExportFormat } from "../../src/services/reportExport";
import type { InventoryBatch, InventoryItem, InventoryMovement, PurchaseRecord, Supplier } from "../../src/types/cloud";
import { formatCount, formatDate, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

type StockSection = "overview" | "items" | "batches" | "vendors" | "purchases";
type EnrichedBatch = InventoryBatch & { itemName: string; unit: string };
type BadgeTone = "success" | "warning" | "danger" | "info" | "muted" | "primary";

type VendorStats = {
  name: string;
  purchaseCount: number;
  totalPurchases: number;
  latestBill: string;
  latestPurchaseDate: string;
  documentCount: number;
};

type VendorRow = Supplier & VendorStats & { source: "supplier" | "vendor" };

const stockSections: Array<{ id: StockSection; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Boxes },
  { id: "items", label: "Items", icon: Package },
  { id: "batches", label: "Batches", icon: Archive },
  { id: "vendors", label: "Vendors", icon: Building2 },
  { id: "purchases", label: "Purchases", icon: ReceiptText }
];

const movementLabel: Record<string, string> = {
  purchase: "Stock added",
  usage: "Stock used",
  sale: "Retail sale",
  adjustment: "Adjustment",
  return: "Return",
  damage: "Damage",
  invoice_cancel_reversal: "Invoice cancelled"
};

const inventoryTypeLabel = (type: string) => (type === "retail" ? "Retail" : "Consumable");
const activeStockCount = (items: InventoryItem[]) => items.filter((item) => item.active !== false).length;
const stockValue = (items: InventoryItem[]) => items.reduce((sum, item) => sum + Number(item.stockValue || 0), 0);
const batchValue = (batch: InventoryBatch) => Number(batch.quantityRemaining || 0) * Number(batch.unitCost || 0);

export default function StockTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const [activeSection, setActiveSection] = useState<StockSection>("overview");
  const [query, setQuery] = useState("");
  const enabled = Boolean(session.user && session.token);

  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token),
    enabled
  });
  const suppliersQuery = useQuery({
    queryKey: ["stock-suppliers", session.cloudUrl, session.token],
    queryFn: () => fetchSuppliers(session.cloudUrl, session.token),
    enabled
  });
  const purchaseRecordsQuery = useQuery({
    queryKey: ["stock-purchase-records", session.cloudUrl, session.token],
    queryFn: () => fetchPurchaseRecords(session.cloudUrl, session.token),
    enabled
  });

  const dashboard = inventoryQuery.data;
  const items = dashboard?.items || [];
  const batches = dashboard?.batches || [];
  const movements = dashboard?.movements || dashboard?.recentMovements || [];
  const suppliers = suppliersQuery.data || [];
  const purchaseRecords = purchaseRecordsQuery.data || [];
  const searchText = query.trim().toLowerCase();

  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [String(supplier.id || ""), supplier])), [suppliers]);
  const expiringBatchIds = useMemo(() => new Set((dashboard?.expiringBatches || []).map((batch) => batch.id)), [dashboard?.expiringBatches]);
  const consumables = useMemo(() => items.filter((item) => item.type === "consumable"), [items]);
  const retail = useMemo(() => items.filter((item) => item.type === "retail"), [items]);
  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (left, right) =>
          String(left.expiryDate || "9999-12-31").localeCompare(String(right.expiryDate || "9999-12-31")) ||
          String(right.purchaseDate || "").localeCompare(String(left.purchaseDate || ""))
      ),
    [batches]
  );
  const vendorRows = useMemo(() => buildVendorRows(suppliers, purchaseRecords), [purchaseRecords, suppliers]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        matchesSearch(searchText, [item.name, item.sku, item.category, item.type, item.unit, item.active === false ? "inactive" : "active"])
      ),
    [items, searchText]
  );
  const filteredBatches = useMemo(
    () =>
      sortedBatches.filter((batch) =>
        matchesSearch(searchText, [
          batch.itemName,
          batch.batchNumber,
          batch.billNumber,
          batch.expiryDate,
          batch.purchaseDate,
          supplierMap.get(batch.supplierId)?.name
        ])
      ),
    [searchText, sortedBatches, supplierMap]
  );
  const filteredVendors = useMemo(
    () => vendorRows.filter((vendor) => matchesSearch(searchText, [vendor.name, vendor.phone, vendor.gstin, vendor.address, vendor.latestBill])),
    [searchText, vendorRows]
  );
  const filteredPurchases = useMemo(
    () =>
      purchaseRecords.filter((record) =>
        matchesSearch(searchText, [
          record.supplierName,
          record.vendorName,
          record.billNumber,
          record.paymentMode,
          record.notes,
          record.purchaseDate,
          ...(Array.isArray(record.documents) ? record.documents.map((document) => document.originalName) : [])
        ])
      ),
    [purchaseRecords, searchText]
  );

  const firstError = [inventoryQuery.error, suppliersQuery.error, purchaseRecordsQuery.error].find(Boolean);
  const isRefreshing = inventoryQuery.isFetching || suppliersQuery.isFetching || purchaseRecordsQuery.isFetching;

  if (guard) return guard;

  async function refreshAll() {
    await Promise.all([inventoryQuery.refetch(), suppliersQuery.refetch(), purchaseRecordsQuery.refetch()]);
  }

  async function exportStock(format: ExportFormat) {
    if (!dashboard) throw new Error("Stock data is not loaded yet.");
    if (firstError) throw new Error("Refresh stock details before exporting.");
    await exportStockDocument({
      dashboard,
      suppliers,
      purchaseRecords,
      format
    });
  }

  return (
    <Screen
      title="Stock"
      subtitle="Inventory, batches, vendors, and synced purchase records."
      refreshing={isRefreshing}
      onRefresh={() => void refreshAll()}
      showHome
    >
      {firstError ? <Text style={styles.error}>{firstError instanceof Error ? firstError.message : "Unable to load stock details."}</Text> : null}
      <ExportActions disabled={!dashboard || isRefreshing || Boolean(firstError)} onExport={exportStock} />

      <MetricGrid>
        <MetricCard label="Stock Value" value={formatMoney(dashboard?.totalStockValue)} tone="success" />
        <MetricCard label="Low Stock" value={formatCount(dashboard?.lowStockCount)} tone={dashboard?.lowStockCount ? "warning" : "default"} />
        <MetricCard label="Expiring" value={formatCount(dashboard?.expiringCount)} tone={dashboard?.expiringCount ? "warning" : "default"} />
        <MetricCard label="Vendors" value={formatCount(vendorRows.length)} tone="info" />
        <MetricCard label="Purchase Bills" value={formatCount(purchaseRecords.length)} />
      </MetricGrid>

      <View style={styles.searchPanel}>
        <View style={styles.searchHeader}>
          <Search color={colors.primary} size={18} />
          <Text style={styles.searchTitle}>Find stock, vendors, bills</Text>
        </View>
        <FormField label="Search" onChangeText={setQuery} placeholder="Item, batch, vendor, bill number" value={query} />
      </View>

      <SectionTabs activeSection={activeSection} onChange={setActiveSection} />

      {activeSection === "overview" ? (
        <OverviewSection
          consumables={consumables}
          retail={retail}
          lowStockItems={dashboard?.lowStockItems || []}
          expiringBatches={dashboard?.expiringBatches || []}
          movements={(dashboard?.recentMovements || []).slice(0, 6)}
          loading={inventoryQuery.isLoading}
          supplierMap={supplierMap}
          expiringBatchIds={expiringBatchIds}
        />
      ) : null}

      {activeSection === "items" ? (
        <View style={styles.section}>
          <SectionHeader icon={Package} title="Stock Items" subtitle={`${formatCount(filteredItems.length)} item(s) shown`} />
          {filteredItems.map((item) => (
            <StockItemCard key={item.id} item={item} />
          ))}
          {!inventoryQuery.isLoading && !filteredItems.length ? <EmptyState title="No stock items found" detail="Try another item name, SKU, category, or type." /> : null}
        </View>
      ) : null}

      {activeSection === "batches" ? (
        <View style={styles.section}>
          <SectionHeader icon={Archive} title="Batches" subtitle={`${formatCount(filteredBatches.length)} batch(es) shown`} />
          {filteredBatches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              supplierName={supplierMap.get(batch.supplierId)?.name || ""}
              expiring={expiringBatchIds.has(batch.id)}
            />
          ))}
          {!inventoryQuery.isLoading && !filteredBatches.length ? <EmptyState title="No batches found" detail="Purchase batches will appear here after stock is added." /> : null}
        </View>
      ) : null}

      {activeSection === "vendors" ? (
        <View style={styles.section}>
          <SectionHeader icon={Building2} title="Vendors" subtitle={`${formatCount(filteredVendors.length)} vendor(s) shown`} />
          {filteredVendors.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
          {!suppliersQuery.isLoading && !purchaseRecordsQuery.isLoading && !filteredVendors.length ? (
            <EmptyState title="No vendors found" detail="Synced suppliers and free-text purchase vendors will appear here." />
          ) : null}
        </View>
      ) : null}

      {activeSection === "purchases" ? (
        <View style={styles.section}>
          <SectionHeader icon={ReceiptText} title="Purchase Records" subtitle={`${formatCount(filteredPurchases.length)} bill(s) shown`} />
          {filteredPurchases.map((record) => (
            <PurchaseRecordCard key={record.id} record={record} />
          ))}
          {!purchaseRecordsQuery.isLoading && !filteredPurchases.length ? (
            <EmptyState title="No purchase records found" detail="Supplier bills, payment modes, and document names will appear here." />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function OverviewSection({
  consumables,
  retail,
  lowStockItems,
  expiringBatches,
  movements,
  loading,
  supplierMap,
  expiringBatchIds
}: {
  consumables: InventoryItem[];
  retail: InventoryItem[];
  lowStockItems: InventoryItem[];
  expiringBatches: EnrichedBatch[];
  movements: InventoryMovement[];
  loading: boolean;
  supplierMap: Map<string, Supplier>;
  expiringBatchIds: Set<string>;
}) {
  return (
    <View style={styles.overviewStack}>
      <View style={styles.splitStats}>
        <TypeSummaryCard title="Consumables" count={activeStockCount(consumables)} value={stockValue(consumables)} icon={Boxes} />
        <TypeSummaryCard title="Retail" count={activeStockCount(retail)} value={stockValue(retail)} icon={ShoppingBag} />
      </View>

      <View style={styles.section}>
        <SectionHeader icon={AlertTriangle} title="Needs Attention" subtitle="Low stock and expiring batches" />
        {lowStockItems.slice(0, 4).map((item) => (
          <StockItemCard key={item.id} item={item} compact />
        ))}
        {expiringBatches.slice(0, 4).map((batch) => (
          <BatchCard key={batch.id} batch={batch} supplierName={supplierMap.get(batch.supplierId)?.name || ""} expiring={expiringBatchIds.has(batch.id)} compact />
        ))}
        {!loading && !lowStockItems.length && !expiringBatches.length ? <EmptyState title="Stock looks healthy" detail="No low-stock items or batches expiring soon." /> : null}
      </View>

      <View style={styles.section}>
        <SectionHeader icon={Truck} title="Recent Movements" subtitle="Latest stock activity" />
        {movements.map((movement) => (
          <MovementCard key={movement.id} movement={movement} />
        ))}
        {!loading && !movements.length ? <EmptyState title="No stock movement yet" detail="Purchases, usage, sales, and adjustments will appear here." /> : null}
      </View>
    </View>
  );
}

function SectionTabs({ activeSection, onChange }: { activeSection: StockSection; onChange: (section: StockSection) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabList}>
      {stockSections.map((section) => {
        const Icon = section.icon;
        const active = section.id === activeSection;
        return (
          <Pressable
            key={section.id}
            accessibilityRole="button"
            onPress={() => onChange(section.id)}
            style={({ pressed }) => [styles.tabButton, active ? styles.tabButtonActive : null, pressed ? styles.pressed : null]}
          >
            <Icon color={active ? "#ffffff" : colors.primary} size={16} />
            <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}>
        <Icon color={colors.primary} size={18} />
      </View>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sectionSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function TypeSummaryCard({ title, count, value, icon: Icon }: { title: string; count: number; value: number; icon: LucideIcon }) {
  return (
    <View style={styles.typeCard}>
      <View style={styles.typeCardTop}>
        <View style={styles.sectionIcon}>
          <Icon color={colors.primary} size={18} />
        </View>
        <Text style={styles.typeTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={styles.typeValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {formatMoney(value)}
      </Text>
      <Text style={styles.typeSub}>{formatCount(count)} active item(s)</Text>
    </View>
  );
}

function StockItemCard({ item, compact = false }: { item: InventoryItem; compact?: boolean }) {
  const low = isLowStock(item);
  const quantity = formatQuantity(item.currentQuantity, item.unit);
  const status = item.active === false ? "Inactive" : low ? "Low stock" : "In stock";
  const tone: BadgeTone = item.active === false ? "muted" : low ? "warning" : "success";
  const details = [inventoryTypeLabel(item.type), item.category || "Uncategorized", item.sku ? `SKU ${item.sku}` : ""].filter(Boolean).join(" | ");

  return (
    <View style={[styles.card, low ? styles.warningCard : null, item.active === false ? styles.inactiveCard : null, compact ? styles.compactCard : null]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.name || "Stock item"}
          </Text>
          <Text style={styles.cardSub} numberOfLines={2}>
            {details}
          </Text>
        </View>
        <Badge label={status} tone={tone} />
      </View>
      <View style={styles.infoGrid}>
        <InfoCell label="Quantity" value={quantity} />
        <InfoCell label="Low alert" value={Number(item.lowStockLevel || 0) > 0 ? formatQuantity(item.lowStockLevel, item.unit) : "Not set"} />
        <InfoCell label="Stock value" value={formatMoney(item.stockValue)} />
        <InfoCell label="Retail price" value={item.type === "retail" ? formatMoney(item.retailPrice) : "Not retail"} />
      </View>
    </View>
  );
}

function BatchCard({ batch, supplierName, expiring, compact = false }: { batch: EnrichedBatch; supplierName: string; expiring: boolean; compact?: boolean }) {
  const quantity = formatQuantity(batch.quantityRemaining, batch.unit);
  const batchTitle = batch.batchNumber ? `${batch.itemName || "Stock batch"} - ${batch.batchNumber}` : batch.itemName || "Stock batch";
  const detail = [batch.billNumber ? `Bill ${batch.billNumber}` : "", supplierName || "Supplier not linked"].filter(Boolean).join(" | ");

  return (
    <View style={[styles.card, expiring ? styles.warningCard : null, compact ? styles.compactCard : null]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {batchTitle}
          </Text>
          <Text style={styles.cardSub} numberOfLines={2}>
            {detail}
          </Text>
        </View>
        <Badge label={expiring ? "Expiring" : "Batch"} tone={expiring ? "warning" : "info"} />
      </View>
      <View style={styles.infoGrid}>
        <InfoCell label="Remaining" value={quantity} />
        <InfoCell label="Expires" value={formatDate(batch.expiryDate)} />
        <InfoCell label="Unit cost" value={formatMoney(batch.unitCost)} />
        <InfoCell label="Value" value={formatMoney(batchValue(batch))} />
      </View>
    </View>
  );
}

function VendorCard({ vendor }: { vendor: VendorRow }) {
  const contact = [vendor.phone || "No phone", vendor.gstin ? `GSTIN ${vendor.gstin}` : "No GSTIN"].join(" | ");
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {vendor.name || "Vendor"}
          </Text>
          <Text style={styles.cardSub} numberOfLines={2}>
            {contact}
          </Text>
        </View>
        <Badge label={vendor.source === "supplier" ? "Supplier" : "Vendor"} tone={vendor.source === "supplier" ? "primary" : "info"} />
      </View>
      {vendor.address ? (
        <Text style={styles.notesText} numberOfLines={2}>
          {vendor.address}
        </Text>
      ) : null}
      <View style={styles.infoGrid}>
        <InfoCell label="Purchases" value={formatCount(vendor.purchaseCount)} />
        <InfoCell label="Total value" value={formatMoney(vendor.totalPurchases)} />
        <InfoCell label="Latest bill" value={vendor.latestBill || "Not available"} />
        <InfoCell label="Latest date" value={formatDate(vendor.latestPurchaseDate)} />
      </View>
    </View>
  );
}

function PurchaseRecordCard({ record }: { record: PurchaseRecord }) {
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const vendorName = record.supplierName || record.vendorName || "Vendor not available";
  const documentNames = documents.map((document) => document.originalName).filter(Boolean).slice(0, 2).join(" | ");

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {vendorName}
          </Text>
          <Text style={styles.cardSub} numberOfLines={2}>
            {[record.billNumber ? `Bill ${record.billNumber}` : "No bill number", formatDate(record.purchaseDate)].join(" | ")}
          </Text>
        </View>
        <Badge label={titleCase(record.paymentMode)} tone="primary" />
      </View>
      <View style={styles.infoGrid}>
        <InfoCell label="Amount" value={formatMoney(record.amount)} />
        <InfoCell label="Documents" value={formatCount(documents.length)} />
        <InfoCell label="Created" value={formatDate(record.createdAt)} />
        <InfoCell label="Updated" value={formatDate(record.updatedAt)} />
      </View>
      {documentNames ? (
        <Text style={styles.notesText} numberOfLines={2}>
          {documentNames}
        </Text>
      ) : null}
      {record.notes ? (
        <Text style={styles.notesText} numberOfLines={2}>
          {record.notes}
        </Text>
      ) : null}
    </View>
  );
}

function MovementCard({ movement }: { movement: InventoryMovement }) {
  const label = movementLabel[movement.type] || titleCase(movement.type);
  const quantity = formatQuantity(movement.quantity, movement.itemUnit);
  const value = Number(movement.quantity || 0) * Number(movement.unitCost || 0);

  return (
    <View style={styles.movementRow}>
      <View style={styles.movementIcon}>
        <Truck color={colors.primary} size={18} />
      </View>
      <View style={styles.movementText}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {movement.itemName || "Stock movement"}
        </Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {[label, movement.reference || movement.notes, formatDate(movement.movementDate)].filter(Boolean).join(" | ")}
        </Text>
      </View>
      <View style={styles.movementValue}>
        <Text style={styles.amountText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {quantity}
        </Text>
        <Text style={styles.amountHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(value)}
        </Text>
      </View>
    </View>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.infoValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <View style={[styles.badge, badgeToneStyle(tone)]}>
      <Text style={[styles.badgeText, badgeTextToneStyle(tone)]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.76}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <FileText color="#d8d7df" size={42} strokeWidth={1.5} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{detail}</Text>
    </View>
  );
}

function buildVendorRows(suppliers: Supplier[], purchaseRecords: PurchaseRecord[]): VendorRow[] {
  const stats = new Map<string, VendorStats>();

  purchaseRecords.forEach((record) => {
    const vendorName = String(record.supplierName || record.vendorName || "Unknown vendor").trim() || "Unknown vendor";
    const key = record.supplierId ? `supplier:${record.supplierId}` : `vendor:${vendorName.toLowerCase()}`;
    const documents = Array.isArray(record.documents) ? record.documents : [];
    const current = stats.get(key) || {
      name: vendorName,
      purchaseCount: 0,
      totalPurchases: 0,
      latestBill: "",
      latestPurchaseDate: "",
      documentCount: 0
    };
    const recordDate = String(record.purchaseDate || record.createdAt || "");
    current.purchaseCount += 1;
    current.totalPurchases += Number(record.amount || 0);
    current.documentCount += documents.length;
    if (!current.latestPurchaseDate || recordDate > current.latestPurchaseDate) {
      current.latestPurchaseDate = recordDate;
      current.latestBill = record.billNumber || "";
      current.name = vendorName;
    }
    stats.set(key, current);
  });

  const rows: VendorRow[] = suppliers.map((supplier) => {
    const stat = stats.get(`supplier:${supplier.id}`) || {
      name: supplier.name,
      purchaseCount: 0,
      totalPurchases: 0,
      latestBill: "",
      latestPurchaseDate: "",
      documentCount: 0
    };
    return { ...supplier, ...stat, name: supplier.name || stat.name, source: "supplier" };
  });

  stats.forEach((stat, key) => {
    if (!key.startsWith("vendor:")) return;
    rows.push({
      id: key,
      phone: "",
      gstin: "",
      address: "",
      createdAt: "",
      ...stat,
      source: "vendor"
    });
  });

  return rows.sort((left, right) => right.purchaseCount - left.purchaseCount || left.name.localeCompare(right.name));
}

function matchesSearch(query: string, fields: Array<string | number | undefined | null>) {
  if (!query) return true;
  return fields.some((field) => String(field || "").toLowerCase().includes(query));
}

function isLowStock(item: InventoryItem) {
  return item.active !== false && Number(item.lowStockLevel || 0) > 0 && Number(item.currentQuantity || 0) <= Number(item.lowStockLevel || 0);
}

function formatQuantity(value: number | undefined | null, unit: string | undefined | null) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const quantity = Number.isInteger(amount) ? formatCount(amount) : amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${quantity} ${unit || "unit"}`;
}

function badgeToneStyle(tone: BadgeTone) {
  if (tone === "success") return styles.successBadge;
  if (tone === "warning") return styles.warningBadge;
  if (tone === "danger") return styles.dangerBadge;
  if (tone === "info") return styles.infoBadge;
  if (tone === "primary") return styles.primaryBadge;
  return styles.mutedBadge;
}

function badgeTextToneStyle(tone: BadgeTone) {
  if (tone === "success") return styles.successBadgeText;
  if (tone === "warning") return styles.warningBadgeText;
  if (tone === "danger") return styles.dangerBadgeText;
  if (tone === "info") return styles.infoBadgeText;
  if (tone === "primary") return styles.primaryBadgeText;
  return styles.mutedBadgeText;
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  },
  searchPanel: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  searchTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900"
  },
  tabList: {
    gap: 8,
    paddingRight: 2
  },
  tabButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 12
  },
  tabButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary
  },
  tabText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  tabTextActive: {
    color: "#ffffff"
  },
  overviewStack: {
    gap: 12
  },
  splitStats: {
    flexDirection: "row",
    gap: 10
  },
  typeCard: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  typeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  typeTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  typeValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  typeSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  section: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  card: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12
  },
  compactCard: {
    padding: 10
  },
  warningCard: {
    borderColor: "#e2c17a",
    backgroundColor: colors.goldSoft
  },
  inactiveCard: {
    opacity: 0.74
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  cardSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  badge: {
    maxWidth: "42%",
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 10
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900"
  },
  successBadge: {
    backgroundColor: colors.greenSoft
  },
  warningBadge: {
    backgroundColor: colors.goldSoft
  },
  dangerBadge: {
    backgroundColor: colors.redSoft
  },
  infoBadge: {
    backgroundColor: colors.blueSoft
  },
  primaryBadge: {
    backgroundColor: colors.purpleSoft
  },
  mutedBadge: {
    backgroundColor: colors.surfaceStrong
  },
  successBadgeText: {
    color: colors.success
  },
  warningBadgeText: {
    color: colors.warning
  },
  dangerBadgeText: {
    color: colors.danger
  },
  infoBadgeText: {
    color: colors.info
  },
  primaryBadgeText: {
    color: colors.primary
  },
  mutedBadgeText: {
    color: colors.muted
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  infoCell: {
    width: "48%",
    minWidth: 0,
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceStrong,
    padding: 9
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900"
  },
  notesText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700"
  },
  movementRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 10
  },
  movementIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.purpleSoft
  },
  movementText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  movementValue: {
    width: "34%",
    minWidth: 0,
    alignItems: "flex-end",
    gap: 2
  },
  amountText: {
    maxWidth: "100%",
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900"
  },
  amountHint: {
    maxWidth: "100%",
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  emptyState: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 14
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  emptySub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  }
});
