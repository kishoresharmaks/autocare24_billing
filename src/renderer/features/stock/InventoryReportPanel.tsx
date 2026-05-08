import type { InventoryItem, InventoryMovement } from "../../../shared/types";

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inventoryTypeLabel = (type: "consumable" | "retail" | string) => (type === "retail" ? "Retail products" : "Studio consumables");
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
  return labels[type] || type.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};
const stockSummary = (items: InventoryItem[]) => ({
  count: items.filter((item) => item.active).length,
  value: money(items.reduce((sum, item) => sum + item.stockValue, 0))
});

function InventoryItemList({ items }: { items: InventoryItem[] }) {
  if (!items.length) return <div className="empty-state subtle">No stock records.</div>;
  return (
    <div className="stack-list">
      {items.map((item) => (
        <div className="stack-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.currentQuantity} {item.unit} available{item.lowStockLevel > 0 ? ` | low alert ${item.lowStockLevel}` : ""}</span>
          </div>
          <b>{formatMoney(item.stockValue)}</b>
        </div>
      ))}
    </div>
  );
}

function MovementList({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <div className="empty-state subtle">No stock movements.</div>;
  return (
    <div className="stack-list">
      {movements.slice(0, 8).map((row) => (
        <div className="stack-row" key={row.id}>
          <div>
            <strong>{row.itemName}</strong>
            <span>{movementLabel(row.type)} | {row.quantity} {row.itemUnit} | {row.movementDate}</span>
          </div>
          <b>{formatMoney(row.quantity * row.unitCost)}</b>
        </div>
      ))}
    </div>
  );
}

export function InventoryReportPanel({
  title,
  items,
  lowStockItems,
  movements
}: {
  title: string;
  items: InventoryItem[];
  lowStockItems: InventoryItem[];
  movements: InventoryMovement[];
}) {
  const summary = stockSummary(items);
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="mini-metrics">
        <div><span>Items</span><strong>{summary.count}</strong></div>
        <div><span>Value</span><strong>{formatMoney(summary.value)}</strong></div>
        <div><span>Low stock</span><strong>{lowStockItems.length}</strong></div>
      </div>
      <div className="section-title">Low stock</div>
      <InventoryItemList items={lowStockItems} />
      <div className="section-title">Recent activity</div>
      <MovementList movements={movements.slice(0, 6)} />
    </section>
  );
}
