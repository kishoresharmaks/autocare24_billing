import { Save, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Enquiry, EnquiryFollowup, EnquiryInput, EnquirySource, EnquiryStatus, ServiceItem, VehicleType } from "../../../shared/types";

type EnquiryTab = "open" | "followups" | "converted" | "lost";
const vehicleTypes: VehicleType[] = ["car", "bike", "other"];
const enquiryTabs: Array<{ id: EnquiryTab; label: string }> = [
  { id: "open", label: "Open" },
  { id: "followups", label: "Follow-ups" },
  { id: "converted", label: "Converted" },
  { id: "lost", label: "Lost" }
];
const enquiryStatuses: EnquiryStatus[] = ["new", "contacted", "follow_up", "visited", "converted", "lost"];
const enquirySources: EnquirySource[] = ["Walk-in", "Phone", "WhatsApp", "Instagram", "Google", "Referral", "Other"];

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");

const emptyEnquiry = (): EnquiryInput => ({
  status: "new",
  source: "Walk-in",
  customerName: "",
  phone: "",
  email: "",
  address: "",
  vehicleType: "car",
  vehicleNumber: "",
  vehicleMake: "",
  vehicleModel: "",
  vehicleColor: "",
  interestedService: "",
  expectedBudget: 0,
  preferredVisitDate: "",
  followUpDate: todayLocal(),
  notes: "",
  lostReason: ""
});

const enquiryToInput = (enquiry: Enquiry): EnquiryInput => ({
  id: enquiry.id,
  status: enquiry.status,
  source: enquiry.source,
  customerName: enquiry.customerName,
  phone: enquiry.phone,
  email: enquiry.email,
  address: enquiry.address,
  vehicleType: enquiry.vehicleType,
  vehicleNumber: enquiry.vehicleNumber,
  vehicleMake: enquiry.vehicleMake,
  vehicleModel: enquiry.vehicleModel,
  vehicleColor: enquiry.vehicleColor,
  interestedService: enquiry.interestedService,
  expectedBudget: enquiry.expectedBudget,
  preferredVisitDate: enquiry.preferredVisitDate,
  followUpDate: enquiry.followUpDate,
  notes: enquiry.notes,
  lostReason: enquiry.lostReason
});

export function EnquiriesPage({
  refreshKey,
  notify,
  onChanged,
  tab,
  setTab,
  newRequestKey
}: {
  refreshKey: number;
  notify: (message: string) => void;
  onChanged: () => void;
  tab: EnquiryTab;
  setTab: (tab: EnquiryTab) => void;
  newRequestKey: number;
}) {
  const [query, setQuery] = useState("");
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<EnquiryInput>(emptyEnquiry());
  const [followups, setFollowups] = useState<EnquiryFollowup[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [followupNote, setFollowupNote] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState(todayLocal());
  const [followupStatus, setFollowupStatus] = useState<EnquiryStatus>("follow_up");

  const refreshList = async (preferredId?: string) => {
    try {
      const rows = await window.autocare.listEnquiries({ query, status: tab });
      setEnquiries(rows);
      setSelectedId((current) => {
        const target = preferredId || current;
        return rows.some((row) => row.id === target) ? target : rows[0]?.id || "";
      });
      if (!rows.length && !preferredId) {
        setForm(emptyEnquiry());
        setFollowups([]);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load enquiries.");
    }
  };

  useEffect(() => {
    void refreshList();
  }, [refreshKey, tab, query]);

  useEffect(() => {
    window.autocare.listServices().then(setServices).catch((error) => notify(error.message));
  }, []);

  const selected = enquiries.find((item) => item.id === selectedId);
  const locked = selected?.status === "converted";

  useEffect(() => {
    if (!selected) return;
    setForm(enquiryToInput(selected));
    setFollowupStatus(selected.status === "lost" ? "lost" : "follow_up");
    setNextFollowUpDate(selected.followUpDate || todayLocal());
    window.autocare.listEnquiryFollowups(selected.id).then(setFollowups).catch((error) => notify(error.message));
  }, [selectedId, enquiries]);

  const startNew = () => {
    setSelectedId("");
    setForm(emptyEnquiry());
    setFollowups([]);
    setFollowupNote("");
    setFollowupStatus("follow_up");
    setNextFollowUpDate(todayLocal());
  };

  useEffect(() => {
    if (newRequestKey > 0) startNew();
  }, [newRequestKey]);

  const saveEnquiry = async () => {
    try {
      const saved = await window.autocare.saveEnquiry(form);
      notify(saved.status === "lost" ? "Enquiry marked lost." : "Enquiry saved.");
      const targetTab: EnquiryTab = saved.status === "lost" ? "lost" : saved.status === "converted" ? "converted" : tab;
      setSelectedId(saved.id);
      if (targetTab !== tab) setTab(targetTab);
      else await refreshList(saved.id);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save enquiry.");
    }
  };

  const addFollowup = async () => {
    if (!selected) return notify("Select an enquiry first.");
    if (!followupNote.trim()) return notify("Follow-up note is required.");
    try {
      const updated = await window.autocare.addEnquiryFollowup({
        enquiryId: selected.id,
        note: followupNote,
        nextFollowUpDate,
        status: followupStatus,
        followupDate: todayLocal()
      });
      notify("Follow-up saved.");
      setFollowupNote("");
      const targetTab: EnquiryTab = updated.status === "lost" ? "lost" : tab;
      setSelectedId(updated.id);
      if (targetTab !== tab) setTab(targetTab);
      else await refreshList(updated.id);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save follow-up.");
    }
  };

  const convertEnquiry = async () => {
    if (!selected) return notify("Select an enquiry first.");
    try {
      const result = await window.autocare.convertEnquiryToCustomer(selected.id);
      notify(`Converted to customer: ${result.customer.name}`);
      setSelectedId(result.enquiry.id);
      if (tab !== "converted") setTab("converted");
      else await refreshList(result.enquiry.id);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to convert enquiry.");
    }
  };

  const createJobCardFromEnquiry = async () => {
    if (!selected) return notify("Select an enquiry first.");
    try {
      const converted = selected.status === "converted" && selected.customerId && selected.vehicleId
        ? { enquiry: selected, customer: undefined, vehicle: undefined }
        : await window.autocare.convertEnquiryToCustomer(selected.id);
      const enquiry = converted.enquiry;
      const matchedService = services.find((service) => service.name.toLowerCase() === enquiry.interestedService.toLowerCase());
      const saved = await window.autocare.saveJobCard({
        status: "estimate_pending",
        jobDate: todayLocal(),
        expectedDeliveryDate: enquiry.preferredVisitDate || "",
        expectedDeliveryTime: "",
        actualDeliveryDate: "",
        actualDeliveryTime: "",
        customerId: enquiry.customerId,
        customer: { name: enquiry.customerName, phone: enquiry.phone, email: enquiry.email, address: enquiry.address },
        vehicleId: enquiry.vehicleId,
        vehicle: {
          vehicleType: enquiry.vehicleType,
          registrationNumber: enquiry.vehicleNumber,
          make: enquiry.vehicleMake,
          model: enquiry.vehicleModel,
          color: enquiry.vehicleColor
        },
        odometer: "",
        fuelLevel: "",
        keyReceived: true,
        belongingsNote: "",
        approvalName: "",
        approvalDate: "",
        approvalNotes: `Created from enquiry ${enquiry.customerName}.`,
        workNotes: enquiry.notes,
        internalNotes: "",
        deliveryNotes: "",
        discount: 0,
        items: [
          {
            serviceId: matchedService?.id || "",
            description: enquiry.interestedService || matchedService?.name || "Detailing service",
            quantity: 1,
            unitPrice: matchedService?.defaultPrice || enquiry.expectedBudget || 0,
            gstRate: matchedService?.gstRate || 18,
            sacCode: matchedService?.sacCode || "9987"
          }
        ]
      });
      notify(`Job card ${saved.jobNumber} created. Open Billing > Job Cards.`);
      if (selected.status !== "converted") {
        if (tab !== "converted") setTab("converted");
        else await refreshList(enquiry.id);
      }
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to create job card from enquiry.");
    }
  };

  return (
    <div className="split-layout enquiry-layout">
      <section className="panel list-panel">
        <div className="panel-heading">
          <div>
            <h2>Enquiries</h2>
            <p>Capture leads and follow-up calls.</p>
          </div>
          <button className="ghost-button" onClick={startNew}>
            New
          </button>
        </div>
        <div className="segmented full-segmented">
          {enquiryTabs.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={18} />
          <input
            placeholder="Search name, phone, vehicle, service"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="record-list">
          {enquiries.map((enquiry) => (
            <button
              key={enquiry.id}
              className={selectedId === enquiry.id ? "record active enquiry-record" : "record enquiry-record"}
              onClick={() => setSelectedId(enquiry.id)}
            >
              <strong>{enquiry.customerName}</strong>
              <em className={`status ${enquiry.status}`}>{statusLabel(enquiry.status)}</em>
              <span>
                {[enquiry.phone, enquiry.vehicleNumber ? `${vehicleTypeLabel(enquiry.vehicleType)} ${enquiry.vehicleNumber}` : ""]
                  .filter(Boolean)
                  .join(" | ") || "Contact details pending"}
              </span>
              <span>{enquiry.interestedService || "Service interest pending"}</span>
              <span>Follow-up: {enquiry.followUpDate || "-"}</span>
            </button>
          ))}
          {!enquiries.length && <div className="empty-state subtle">No enquiries found.</div>}
        </div>
      </section>

      <div className="detail-column">
        <section className="panel detail-panel">
          <div className="panel-heading">
            <div>
              <h2>{selected ? selected.customerName : "New enquiry"}</h2>
              <p>{locked ? "Converted enquiries are locked." : "Enter only the details staff know now."}</p>
            </div>
            {selected && <span className={`status ${selected.status}`}>{statusLabel(selected.status)}</span>}
          </div>

          <datalist id="service-interest-options">
            {services.map((service) => (
              <option key={service.id} value={service.name} />
            ))}
          </datalist>

          <div className="form-grid three">
            <label>
              Customer name
              <input
                disabled={locked}
                value={form.customerName}
                onChange={(event) => setForm({ ...form, customerName: event.currentTarget.value })}
              />
            </label>
            <label>
              Phone
              <input disabled={locked} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} />
            </label>
            <label>
              Source
              <select
                disabled={locked}
                value={form.source}
                onChange={(event) => setForm({ ...form, source: event.currentTarget.value as EnquirySource })}
              >
                {enquirySources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                disabled={locked}
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.currentTarget.value as EnquiryStatus })}
              >
                {(locked ? enquiryStatuses : enquiryStatuses.filter((status) => status !== "converted")).map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Interested service
              <input
                disabled={locked}
                list="service-interest-options"
                value={form.interestedService}
                onChange={(event) => setForm({ ...form, interestedService: event.currentTarget.value })}
              />
            </label>
            <label>
              Expected budget
              <input
                disabled={locked}
                type="number"
                min="0"
                value={form.expectedBudget}
                onChange={(event) => setForm({ ...form, expectedBudget: Number(event.currentTarget.value) })}
              />
            </label>
            <label>
              Vehicle type
              <select
                disabled={locked}
                value={form.vehicleType}
                onChange={(event) => setForm({ ...form, vehicleType: event.currentTarget.value as VehicleType })}
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
                disabled={locked}
                value={form.vehicleNumber}
                onChange={(event) => setForm({ ...form, vehicleNumber: event.currentTarget.value.toUpperCase() })}
              />
            </label>
            <label>
              Make
              <input disabled={locked} value={form.vehicleMake} onChange={(event) => setForm({ ...form, vehicleMake: event.currentTarget.value })} />
            </label>
            <label>
              Model
              <input disabled={locked} value={form.vehicleModel} onChange={(event) => setForm({ ...form, vehicleModel: event.currentTarget.value })} />
            </label>
            <label>
              Color
              <input disabled={locked} value={form.vehicleColor} onChange={(event) => setForm({ ...form, vehicleColor: event.currentTarget.value })} />
            </label>
            <label>
              Preferred visit date
              <input
                disabled={locked}
                type="date"
                value={form.preferredVisitDate}
                onChange={(event) => setForm({ ...form, preferredVisitDate: event.currentTarget.value })}
              />
            </label>
            <label>
              Follow-up date
              <input
                disabled={locked}
                type="date"
                value={form.followUpDate}
                onChange={(event) => setForm({ ...form, followUpDate: event.currentTarget.value })}
              />
            </label>
            <label>
              Email
              <input disabled={locked} value={form.email} onChange={(event) => setForm({ ...form, email: event.currentTarget.value })} />
            </label>
            <label className="wide-input">
              Address
              <input disabled={locked} value={form.address} onChange={(event) => setForm({ ...form, address: event.currentTarget.value })} />
            </label>
            <label className="wide-input">
              Notes
              <textarea disabled={locked} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })} />
            </label>
            {form.status === "lost" && (
              <label className="wide-input">
                Lost reason
                <textarea
                  disabled={locked}
                  value={form.lostReason}
                  onChange={(event) => setForm({ ...form, lostReason: event.currentTarget.value })}
                />
              </label>
            )}
          </div>

          <div className="save-row">
            <div>
              <span>{selected ? "Enquiry record" : "New lead"}</span>
              <strong>{form.expectedBudget ? formatMoney(form.expectedBudget) : "Budget not set"}</strong>
            </div>
            <div className="inline-actions">
              {!locked && (
                <button className="primary-action" onClick={saveEnquiry}>
                  <Save size={18} />
                  Save enquiry
                </button>
              )}
              {selected && !locked && (
                <button className="ghost-button" onClick={convertEnquiry}>
                  Convert to customer
                </button>
              )}
              {selected && (
                <button className="ghost-button" onClick={createJobCardFromEnquiry}>
                  Create job card
                </button>
              )}
            </div>
          </div>
        </section>

        {selected && !locked && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Follow-up</h2>
                <p>Save call notes and the next date to contact.</p>
              </div>
            </div>
            <div className="form-grid three">
              <label>
                Status after call
                <select value={followupStatus} onChange={(event) => setFollowupStatus(event.currentTarget.value as EnquiryStatus)}>
                  {enquiryStatuses
                    .filter((status) => status !== "converted")
                    .map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Next follow-up date
                <input type="date" value={nextFollowUpDate} onChange={(event) => setNextFollowUpDate(event.currentTarget.value)} />
              </label>
              <button className="primary-action align-bottom" onClick={addFollowup}>
                Save follow-up
              </button>
              <label className="wide-input">
                Follow-up note
                <textarea value={followupNote} onChange={(event) => setFollowupNote(event.currentTarget.value)} />
              </label>
            </div>
          </section>
        )}

        <section className="panel">
          <h2>Follow-up history</h2>
          <div className="stack-list">
            {followups.map((followup) => (
              <div className="stack-row" key={followup.id}>
                <div>
                  <strong>{statusLabel(followup.status)}</strong>
                  <span>{followup.note || "No note"}</span>
                </div>
                <b>{followup.nextFollowUpDate || followup.followupDate}</b>
              </div>
            ))}
            {!followups.length && <div className="empty-state subtle">No follow-up notes yet.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

