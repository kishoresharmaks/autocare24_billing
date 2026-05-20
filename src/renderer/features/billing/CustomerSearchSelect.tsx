import { useMemo, useState } from "react";
import type { CustomerWithVehicles } from "../../../shared/types";

const customerOptionLabel = (customer: CustomerWithVehicles) =>
  `${customer.customerCode ? `${customer.customerCode} - ` : ""}${customer.name}${customer.phone ? ` - ${customer.phone}` : ""}`;

const customerSearchText = (customer: CustomerWithVehicles) =>
  [
    customer.customerCode,
    customer.name,
    customer.phone,
    customer.email,
    customer.gstin,
    ...(customer.vehicles || []).map((vehicle) => vehicle.registrationNumber)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export function CustomerSearchSelect({
  customers,
  value,
  onChange,
  disabled = false,
  label = "Existing customer"
}: {
  customers: CustomerWithVehicles[];
  value: string;
  onChange: (customerId: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === value);
  const selectedLabel = selectedCustomer ? customerOptionLabel(selectedCustomer) : "New customer";
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = query ? customers.filter((customer) => customerSearchText(customer).includes(query)) : customers;
    return rows.slice(0, 60);
  }, [customers, search]);
  const matchCount = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? customers.filter((customer) => customerSearchText(customer).includes(query)).length : customers.length;
  }, [customers, search]);

  const choose = (customerId: string) => {
    onChange(customerId);
    setSearch("");
    setOpen(false);
  };

  const inputValue = open ? search : selectedLabel;

  return (
    <div className="customer-search-field">
      <span>{label}</span>
      <div className="customer-search-control">
        <input
          type="search"
          disabled={disabled}
          value={inputValue}
          placeholder="Search customer ID, name, phone"
          aria-expanded={open}
          onFocus={() => {
            if (!disabled) {
              setSearch("");
              setOpen(true);
            }
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setSearch("");
            }
            if (event.key === "Enter" && open && matches[0]) {
              event.preventDefault();
              choose(matches[0].id);
            }
          }}
        />
        {open && !disabled && (
          <div className="customer-search-menu" role="listbox">
            <button
              type="button"
              className={!value ? "customer-search-option active" : "customer-search-option"}
              onMouseDown={(event) => {
                event.preventDefault();
                choose("");
              }}
            >
              <strong>New customer</strong>
              <span>Create customer details manually</span>
            </button>
            {matches.map((customer) => (
              <button
                type="button"
                key={customer.id}
                className={customer.id === value ? "customer-search-option active" : "customer-search-option"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(customer.id);
                }}
              >
                <strong>{customer.customerCode || "Customer ID pending"} - {customer.name}</strong>
                <span>{[customer.phone, customer.email].filter(Boolean).join(" | ") || "No contact saved"}</span>
              </button>
            ))}
            {!matches.length && <div className="customer-search-empty">No customers found.</div>}
            {matchCount > matches.length && <div className="customer-search-count">Showing first {matches.length} of {matchCount} matches.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
