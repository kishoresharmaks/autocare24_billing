import { Car, Save, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Customer, CustomerWithVehicles, Vehicle, VehicleType } from "../../../shared/types";

const vehicleTypes: VehicleType[] = ["car", "bike", "other"];
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");
const emptyCustomerVehicleForm = () => ({
  id: "",
  registrationNumber: "",
  vehicleType: "car" as VehicleType,
  make: "",
  model: "",
  color: ""
});

export function CustomersPage({ refreshKey, notify }: { refreshKey: number; notify: (message: string) => void }) {
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<Partial<Customer> & Pick<Customer, "name">>({ name: "" });
  const [vehicleForm, setVehicleForm] = useState(emptyCustomerVehicleForm());

  const load = () =>
    window.autocare
      .listCustomers()
      .then((rows) => {
        setCustomers(rows);
        if (!selectedId && rows.length) setSelectedId(rows[0].id);
      })
      .catch((error) => notify(error.message));

  useEffect(() => {
    load();
  }, [refreshKey]);

  const filtered = customers.filter((customer) => {
    const text = `${customer.name} ${customer.phone} ${customer.vehicles
      .map((vehicle) => `${vehicle.registrationNumber} ${vehicle.vehicleType}`)
      .join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const selected = customers.find((item) => item.id === selectedId);

  useEffect(() => {
    if (selected) {
      setForm(selected);
      setVehicleForm(emptyCustomerVehicleForm());
    }
  }, [selectedId]);

  const saveCustomer = async () => {
    try {
      const saved = await window.autocare.saveCustomer(form);
      notify("Customer saved.");
      setSelectedId(saved.id);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save customer.");
    }
  };

  const saveVehicle = async () => {
    if (!selectedId) return notify("Save or select a customer first.");
    try {
      const { id, ...vehicleFields } = vehicleForm;
      await window.autocare.saveVehicle({ id: id || undefined, customerId: selectedId, ...vehicleFields });
      notify(vehicleForm.id ? "Vehicle updated." : "Vehicle saved.");
      setVehicleForm(emptyCustomerVehicleForm());
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save vehicle.");
    }
  };

  const editVehicle = (vehicle: Vehicle) => {
    setVehicleForm({
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      vehicleType: vehicle.vehicleType,
      make: vehicle.make,
      model: vehicle.model,
      color: vehicle.color
    });
  };

  return (
    <div className="split-layout">
      <section className="panel list-panel">
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Search customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </div>
        <div className="record-list">
          {filtered.map((customer) => (
            <button key={customer.id} className={selectedId === customer.id ? "record active" : "record"} onClick={() => setSelectedId(customer.id)}>
              <strong>{customer.name}</strong>
              <span>{customer.phone || "No phone"} - {customer.vehicles.length} vehicle(s)</span>
            </button>
          ))}
          {!filtered.length && <div className="empty-state subtle">No customers found.</div>}
        </div>
      </section>

      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <h2>Customer profile</h2>
            <p>Keep billing and vehicle history linked.</p>
          </div>
          <button className="ghost-button" onClick={() => {
            setSelectedId("");
            setForm({ name: "" });
            setVehicleForm(emptyCustomerVehicleForm());
          }}>
            New customer
          </button>
        </div>
        <div className="form-grid two">
          <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label>
          <label>Phone<input value={form.phone ?? ""} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} /></label>
          <label>Email<input value={form.email ?? ""} onChange={(event) => setForm({ ...form, email: event.currentTarget.value })} /></label>
          <label>GSTIN<input value={form.gstin ?? ""} onChange={(event) => setForm({ ...form, gstin: event.currentTarget.value.toUpperCase() })} /></label>
          <label className="wide-input">Address<input value={form.address ?? ""} onChange={(event) => setForm({ ...form, address: event.currentTarget.value })} /></label>
        </div>
        <button className="primary-action" onClick={saveCustomer}><Save size={18} /> Save customer</button>

        <div className="section-title with-action">
          Vehicles
          <button className="ghost-button small" onClick={() => setVehicleForm(emptyCustomerVehicleForm())}>
            New vehicle
          </button>
        </div>
        <div className="vehicle-grid">
          {selected?.vehicles.map((vehicle) => (
            <button
              className={vehicleForm.id === vehicle.id ? "vehicle-tile active" : "vehicle-tile"}
              key={vehicle.id}
              onClick={() => editVehicle(vehicle)}
            >
              <Car size={20} />
              <strong>{vehicleTypeLabel(vehicle.vehicleType)} - {vehicle.registrationNumber}</strong>
              <span>{[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ") || "Vehicle details pending"}</span>
            </button>
          ))}
        </div>
        <div className="form-grid four">
          <label>
            Vehicle type
            <select
              value={vehicleForm.vehicleType}
              onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.currentTarget.value as VehicleType })}
            >
              {vehicleTypes.map((type) => (
                <option key={type} value={type}>
                  {vehicleTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>Vehicle number<input value={vehicleForm.registrationNumber} onChange={(event) => setVehicleForm({ ...vehicleForm, registrationNumber: event.currentTarget.value.toUpperCase() })} /></label>
          <label>Make<input value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.currentTarget.value })} /></label>
          <label>Model<input value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.currentTarget.value })} /></label>
          <label>Color<input value={vehicleForm.color} onChange={(event) => setVehicleForm({ ...vehicleForm, color: event.currentTarget.value })} /></label>
        </div>
        <button className="ghost-button" onClick={saveVehicle}>{vehicleForm.id ? "Save vehicle changes" : "Add vehicle"}</button>
      </section>
    </div>
  );
}

