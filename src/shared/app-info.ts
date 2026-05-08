export const APP_ID = "com.autocare24.billing";
export const APP_PRODUCT_NAME = "Autocare24 Billing";
export const APP_SHORT_NAME = "Autocare24";
export const APP_DESCRIPTION =
  "Windows billing software for vehicle detailing studios, covering billing, quotations, job cards, stock, purchase records, cloud sync, reports, backup, PDF, and WhatsApp sharing.";
export const APP_COPYRIGHT = "Copyright (c) 2026 Autocare24. All rights reserved.";

export const APP_ORGANIZATION = {
  name: "Autocare24 Bike & Car Detailing Studio",
  shortName: "Autocare24",
  category: "Bike & Car Detailing Studio",
  country: "India",
  dataOwner: "Business owner account"
} as const;

export const APP_DEVELOPER = {
  name: "KS TECH SOLUTIONS",
  role: "Software design, development, and production support",
  profileUrl: "https://www.linkedin.com/in/kishore-sharma-t/",
  credit: "Developed by KS TECH SOLUTIONS"
} as const;

export const APP_MODULES = [
  {
    name: "Billing",
    description: "GST bills, simple receipts, payments, PDF, print, WhatsApp sharing, and correction flow."
  },
  {
    name: "Quotations",
    description: "Quotation creation, status tracking, PDF output, WhatsApp sharing, and convert to bill."
  },
  {
    name: "Job Cards",
    description: "Vehicle job cards, estimate, checklist, photo proof, PDF, and invoice conversion."
  },
  {
    name: "Customers & Vehicles",
    description: "Customer profile, phone, address, GST details, and vehicle history."
  },
  {
    name: "Stock Management",
    description: "Inventory items, suppliers, stock purchase batches, purchase records with PDF/image documents, stock movement, and stock reports."
  },
  {
    name: "Cloud Sync",
    description: "Shared Cloud API connection for multi-PC records, final invoice numbering, file uploads, and purchase documents."
  },
  {
    name: "Reports",
    description: "Sales, GST, payment, dues, profit, enquiry, job-card, and stock reporting."
  },
  {
    name: "Backup & Restore",
    description: "Local backup bundles, Google Drive backup, restore, and diagnostic export."
  },
  {
    name: "Security",
    description: "Owner login, staff users, reusable access roles, and protected owner tools."
  }
] as const;

export const APP_PRODUCTION_READINESS = [
  {
    label: "Owner and staff access",
    status: "Ready",
    detail: "Owner account, staff accounts, roles, and protected permissions are available."
  },
  {
    label: "Billing workflow",
    status: "Ready",
    detail: "Bills, payments, cancellations, correction flow, PDF, print, and WhatsApp sharing are available."
  },
  {
    label: "Quotation to bill",
    status: "Ready",
    detail: "Quotations can be saved, shared, tracked, and converted to final bills with stock checks."
  },
  {
    label: "Job card workflow",
    status: "Ready",
    detail: "Job cards support estimates, checklist, photo proof, PDF, WhatsApp sharing, and bill conversion."
  },
  {
    label: "Stock safety",
    status: "Ready",
    detail: "Stock is reduced only through billing, stock additions, and guarded stock movements. Purchase records are reference-only and excluded from calculations."
  },
  {
    label: "Purchase records",
    status: "Ready",
    detail: "Supplier bill records can store date, vendor, amount, payment mode, notes, and optional PDF/image documents without changing stock, expenses, or profit."
  },
  {
    label: "Backup protection",
    status: "Ready",
    detail: "Manual local backup, automatic startup backup, restore, Google Drive backup, and diagnostic export are available."
  },
  {
    label: "Cloud Sync API",
    status: "Ready",
    detail: "The desktop can connect to the Cloud API for synced records, final invoice numbering, and protected file uploads."
  },
  {
    label: "Installer release",
    status: "Ready",
    detail: "Build and package scripts are available. Rebuild the installer after approved source changes."
  }
] as const;
