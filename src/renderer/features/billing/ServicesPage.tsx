import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { BusinessSettings, InventoryItem, ServiceConsumable, ServiceItem } from "../../../shared/types";

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ServicesPage({ settings, notify }: { settings: BusinessSettings; notify: (message: string) => void }) {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [recipe, setRecipe] = useState<ServiceConsumable[]>([]);
  const [recipeItemId, setRecipeItemId] = useState("");
  const [recipeQty, setRecipeQty] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [form, setForm] = useState<Partial<ServiceItem> & Pick<ServiceItem, "name">>({
    name: "",
    category: "Detailing",
    defaultPrice: 0,
    gstRate: settings.defaultGstRate,
    sacCode: "9987",
    active: true
  });

  const load = () =>
    Promise.all([window.autocare.listServices(includeInactive), window.autocare.listInventoryItems()])
      .then(([serviceRows, inventoryRows]) => {
        setServices(serviceRows);
        setInventoryItems(inventoryRows.filter((item) => item.type === "consumable" && item.active));
      })
      .catch((error) => notify(error.message));
  useEffect(() => {
    load();
  }, [includeInactive]);

  const save = async () => {
    try {
      await window.autocare.saveService(form);
      notify("Service saved.");
      setForm({ name: "", category: "Detailing", defaultPrice: 0, gstRate: settings.defaultGstRate, sacCode: "9987", active: true });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save service.");
    }
  };

  const deactivate = async (id: string) => {
    await window.autocare.deactivateService(id);
    notify("Service disabled.");
    await load();
  };

  const editService = async (service: ServiceItem) => {
    setForm(service);
    setRecipe(await window.autocare.getServiceRecipe(service.id));
  };

  const addRecipeLine = async () => {
    if (!form.id) return notify("Save/select a service before adding recipe stock.");
    const rows = [
      ...recipe.map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: row.quantity })),
      { inventoryItemId: recipeItemId, quantity: recipeQty }
    ];
    const saved = await window.autocare.saveServiceRecipe(form.id, rows);
    setRecipe(saved);
    setRecipeItemId("");
    setRecipeQty(0);
    notify("Service recipe saved.");
  };

  const removeRecipeLine = async (inventoryItemId: string) => {
    if (!form.id) return;
    const rows = recipe
      .filter((row) => row.inventoryItemId !== inventoryItemId)
      .map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: row.quantity }));
    setRecipe(await window.autocare.saveServiceRecipe(form.id, rows));
  };

  return (
    <div className="split-layout">
      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <h2>Service catalog</h2>
            <p>Set default rates, GST percentage, and SAC/service code.</p>
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.currentTarget.checked)} />
            Show inactive
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>GST</th>
                <th>SAC</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td>{service.name}</td>
                  <td>{service.category}</td>
                  <td>{formatMoney(service.defaultPrice)}</td>
                  <td>{service.gstRate}%</td>
                  <td>{service.sacCode}</td>
                  <td><span className={service.active ? "status paid" : "status unpaid"}>{service.active ? "Active" : "Inactive"}</span></td>
                  <td className="actions-cell">
                    <button className="ghost-button small" onClick={() => editService(service)}>Edit</button>
                    {service.active && <button className="ghost-button small" onClick={() => deactivate(service.id)}>Disable</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="panel summary-panel">
        <h2>{form.id ? "Edit service" : "Add service"}</h2>
        <div className="form-stack">
          <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label>
          <label>Category<input value={form.category ?? ""} onChange={(event) => setForm({ ...form, category: event.currentTarget.value })} /></label>
          <label>Default price<input type="number" min="0" value={form.defaultPrice ?? 0} onChange={(event) => setForm({ ...form, defaultPrice: Number(event.currentTarget.value) })} /></label>
          <label>GST rate<input type="number" min="0" value={form.gstRate ?? 0} onChange={(event) => setForm({ ...form, gstRate: Number(event.currentTarget.value) })} /></label>
          <label>SAC code<input value={form.sacCode ?? ""} onChange={(event) => setForm({ ...form, sacCode: event.currentTarget.value })} /></label>
          <button className="primary-action" onClick={save}><Save size={18} /> Save service</button>
        </div>
        <div className="section-title">Consumables recipe</div>
        <div className="stack-list">
          {recipe.map((row) => (
            <div className="stack-row" key={row.id}>
              <div><strong>{row.itemName}</strong><span>{row.quantity} {row.unit} per service qty</span></div>
              <button className="ghost-button small" onClick={() => removeRecipeLine(row.inventoryItemId)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="form-stack">
          <label>Consumable<select value={recipeItemId} onChange={(event) => setRecipeItemId(event.currentTarget.value)}><option value="">Select item</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
          <label>Quantity per service<input type="number" min="0" step="0.01" value={recipeQty} onChange={(event) => setRecipeQty(Number(event.currentTarget.value))} /></label>
          <button className="ghost-button" onClick={addRecipeLine}>Add recipe line</button>
        </div>
      </aside>
    </div>
  );
}

