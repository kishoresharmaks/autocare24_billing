import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchInventoryDashboard } from "../../src/services/cloudApi";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import { colors } from "../../src/theme";
import type { InventoryBatch, InventoryItem, InventoryMovement } from "../../src/types/cloud";
import { formatCount, formatDate, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";

const inventoryTypeLabel = (type: string) => (type === "retail" ? "Retail products" : "Studio consumables");
const stockValue = (items: InventoryItem[]) => items.reduce((sum, item) => sum + Number(item.stockValue || 0), 0);
const activeStockCount = (items: InventoryItem[]) => items.filter((item) => item.active !== false).length;

const movementLabel: Record<string, string> = {
  purchase: "Stock added",
  usage: "Stock used",
  sale: "Retail sale",
  adjustment: "Adjustment",
  return: "Return",
  damage: "Damage",
  invoice_cancel_reversal: "Invoice cancelled"
};

export default function StockTab() {
  const guard = useRequireOwner();
  const session = useSession();
  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token),
    enabled: Boolean(session.user && session.token)
  });

  const dashboard = inventoryQuery.data;
  const items = dashboard?.items || [];
  const consumables = useMemo(() => items.filter((item) => item.type === "consumable"), [items]);
  const retail = useMemo(() => items.filter((item) => item.type === "retail"), [items]);
  const typeRows = useMemo(
    () => [
      { label: "Studio consumables", value: stockValue(consumables), count: activeStockCount(consumables) },
      { label: "Retail products", value: stockValue(retail), count: activeStockCount(retail) }
    ],
    [consumables, retail]
  );

  if (guard) return guard;

  return (
    <Screen
      title="Stock"
      subtitle={dashboard ? "Live cloud inventory snapshot" : "Cloud stock dashboard"}
      refreshing={inventoryQuery.isFetching}
      onRefresh={inventoryQuery.refetch}
      showHome
    >
      {inventoryQuery.error ? (
        <Text style={styles.error}>{inventoryQuery.error instanceof Error ? inventoryQuery.error.message : "Unable to load stock report."}</Text>
      ) : null}
      <MetricGrid>
        <MetricCard label="Stock Value" value={formatMoney(dashboard?.totalStockValue)} tone="success" />
        <MetricCard label="Low Stock" value={formatCount(dashboard?.lowStockCount)} tone={dashboard?.lowStockCount ? "warning" : "default"} />
        <MetricCard label="Expiring" value={formatCount(dashboard?.expiringCount)} tone={dashboard?.expiringCount ? "warning" : "default"} />
        <MetricCard label="Retail Products" value={formatCount(dashboard?.retailCount)} tone="info" />
        <MetricCard label="Stock Items" value={formatCount(items.length)} />
      </MetricGrid>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Stock type value</Text>
        {typeRows.map((row) => (
          <SummaryRow key={row.label} label={row.label} hint={`${row.count} active items`} value={formatMoney(row.value)} />
        ))}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Low stock</Text>
        {(dashboard?.lowStockItems || []).map((item) => (
          <StockItemRow key={item.id} item={item} warning />
        ))}
        {!inventoryQuery.isLoading && !dashboard?.lowStockItems?.length ? <Text style={styles.empty}>No low stock items.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Expiring batches</Text>
        {(dashboard?.expiringBatches || []).map((batch) => (
          <BatchRow key={batch.id} batch={batch} />
        ))}
        {!inventoryQuery.isLoading && !dashboard?.expiringBatches?.length ? <Text style={styles.empty}>No batches expiring soon.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent stock movements</Text>
        {(dashboard?.recentMovements || []).slice(0, 12).map((movement) => (
          <MovementRow key={movement.id} movement={movement} />
        ))}
        {!inventoryQuery.isLoading && !dashboard?.recentMovements?.length ? <Text style={styles.empty}>No stock movements found.</Text> : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Stock item list</Text>
        {items.map((item) => (
          <StockItemRow key={item.id} item={item} />
        ))}
        {!inventoryQuery.isLoading && !items.length ? <Text style={styles.empty}>No stock items available.</Text> : null}
      </View>
    </Screen>
  );
}

function SummaryRow({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function StockItemRow({ item, warning = false }: { item: InventoryItem; warning?: boolean }) {
  const quantity = `${formatCount(item.currentQuantity)} ${item.unit || "unit"}`;
  const lowStock = Number(item.lowStockLevel || 0) > 0 ? `Low alert ${formatCount(item.lowStockLevel)}` : "No low alert";
  const meta = [inventoryTypeLabel(item.type), item.category, lowStock].filter(Boolean).join(" | ");

  return (
    <View style={[styles.row, warning ? styles.warningRow : null, item.active === false ? styles.inactiveRow : null]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.name || "Stock item"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {meta}
        </Text>
        {item.active === false ? <Text style={styles.inactiveText}>Inactive</Text> : null}
      </View>
      <View style={styles.valueStack}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {quantity}
        </Text>
        <Text style={styles.valueHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(item.stockValue)}
        </Text>
      </View>
    </View>
  );
}

function BatchRow({ batch }: { batch: InventoryBatch & { itemName: string; unit: string } }) {
  const quantity = `${formatCount(batch.quantityRemaining)} ${batch.unit || "unit"}`;
  const meta = [batch.batchNumber ? `Batch ${batch.batchNumber}` : "", `Expires ${formatDate(batch.expiryDate)}`].filter(Boolean).join(" | ");

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {batch.itemName || "Stock batch"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <View style={styles.valueStack}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {quantity}
        </Text>
        <Text style={styles.valueHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(Number(batch.quantityRemaining || 0) * Number(batch.unitCost || 0))}
        </Text>
      </View>
    </View>
  );
}

function MovementRow({ movement }: { movement: InventoryMovement }) {
  const label = movementLabel[movement.type] || titleCase(movement.type);
  const quantity = `${formatCount(movement.quantity)} ${movement.itemUnit || "unit"}`;
  const meta = [label, movement.reference || movement.notes, formatDate(movement.movementDate)].filter(Boolean).join(" | ");

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {movement.itemName || "Stock movement"}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <View style={styles.valueStack}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {quantity}
        </Text>
        <Text style={styles.valueHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatMoney(Number(movement.quantity || 0) * Number(movement.unitCost || 0))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee2d5",
    paddingTop: 10
  },
  warningRow: {
    borderTopColor: "#dfbd82"
  },
  inactiveRow: {
    opacity: 0.72
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  rowSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17
  },
  inactiveText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: "900"
  },
  valueStack: {
    width: "38%",
    minWidth: 0,
    alignItems: "flex-end",
    gap: 2
  },
  amount: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: "100%",
    textAlign: "right"
  },
  valueHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: "100%",
    textAlign: "right"
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
