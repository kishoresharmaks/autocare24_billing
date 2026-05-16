import { ALL_PERMISSION_KEYS, type AccessRole, type AppUser, type PermissionKey } from "./types";

export const OWNER_ACCESS_ROLE_ID = "owner";
export const STAFF_OPERATIONS_ROLE_ID = "staff-operations";

export type PermissionItem = {
  key: PermissionKey;
  label: string;
  helper?: string;
};

export type PermissionGroup = {
  id: string;
  label: string;
  permissions: PermissionItem[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    permissions: [{ key: "dashboard.view", label: "View overview dashboard" }]
  },
  {
    id: "billing",
    label: "Billing and Invoices",
    permissions: [
      { key: "billing.view", label: "View invoices and billing data" },
      { key: "billing.create", label: "Create bills and drafts" },
      { key: "billing.manageInvoices", label: "Edit invoice corrections and add-ons" },
      { key: "billing.recordPayments", label: "Record invoice payments" },
      { key: "billing.cancelInvoices", label: "Cancel invoices" },
      { key: "quotations.view", label: "View quotations" },
      { key: "quotations.manage", label: "Create and edit quotations" },
      { key: "quotations.convert", label: "Convert quotations to bills" }
    ]
  },
  {
    id: "customers",
    label: "Customers and Vehicles",
    permissions: [
      { key: "customers.view", label: "View customers and vehicles" },
      { key: "customers.manage", label: "Add and edit customers or vehicles" }
    ]
  },
  {
    id: "jobCards",
    label: "Job Cards",
    permissions: [
      { key: "jobCards.view", label: "View job cards" },
      { key: "jobCards.manage", label: "Create and update job cards" },
      { key: "jobCards.photos", label: "Add and manage photo proof" },
      { key: "jobCards.settings", label: "Manage checklist settings" }
    ]
  },
  {
    id: "enquiries",
    label: "Enquiries",
    permissions: [
      { key: "enquiries.view", label: "View enquiries and follow-ups" },
      { key: "enquiries.manage", label: "Create and update enquiries" },
      { key: "enquiries.convert", label: "Convert enquiries to customers or job cards" }
    ]
  },
  {
    id: "services",
    label: "Services and Packages",
    permissions: [
      { key: "services.view", label: "View services and packages" },
      { key: "services.manage", label: "Manage services, prices, and recipes" }
    ]
  },
  {
    id: "stock",
    label: "Stock",
    permissions: [
      { key: "stock.view", label: "View stock and history" },
      { key: "stock.manageItems", label: "Add and edit stock items" },
      { key: "stock.purchase", label: "Add purchased stock and purchase records" },
      { key: "stock.adjust", label: "Remove or adjust stock" },
      { key: "stock.suppliers", label: "Manage suppliers" }
    ]
  },
  {
    id: "reports",
    label: "Reports, Profit, and Expenses",
    permissions: [
      { key: "reports.view", label: "View reports and profit dashboards" },
      { key: "reports.export", label: "Export reports and report PDFs" },
      { key: "expenses.manage", label: "Add, edit, and delete expenses" }
    ]
  },
  {
    id: "documents",
    label: "Documents and Sharing",
    permissions: [
      { key: "documents.printPdf", label: "Print and save PDFs" },
      { key: "sharing.whatsapp", label: "Share invoices and job updates on WhatsApp" },
      { key: "exports.csv", label: "Export CSV data" }
    ]
  },
  {
    id: "system",
    label: "System",
    permissions: [
      { key: "settings.manage", label: "Manage business and invoice settings" },
      { key: "users.manage", label: "Manage users and roles" },
      { key: "backup.manage", label: "Backup, restore, and Google Drive" },
      { key: "developer.access", label: "Developer console and repairs" }
    ]
  }
];

const permissionSet = new Set<PermissionKey>(ALL_PERMISSION_KEYS);

export const ALL_PERMISSIONS: ReadonlyArray<PermissionKey> = Object.freeze([...ALL_PERMISSION_KEYS]);

export const normalizePermissions = (permissions: unknown): PermissionKey[] => {
  const rows = Array.isArray(permissions) ? permissions : [];
  return Array.from(new Set(rows.filter((permission): permission is PermissionKey => permissionSet.has(permission as PermissionKey))));
};

export const hasPermission = (user: Pick<AppUser, "role" | "permissions"> | null | undefined, permission: PermissionKey) =>
  Boolean(user && (user.role === "owner" || user.permissions.includes(permission)));

export const hasAnyPermission = (
  user: Pick<AppUser, "role" | "permissions"> | null | undefined,
  permissions: PermissionKey[]
) => Boolean(user && (user.role === "owner" || permissions.some((permission) => user.permissions.includes(permission))));

export const hasAllPermissions = (
  user: Pick<AppUser, "role" | "permissions"> | null | undefined,
  permissions: PermissionKey[]
) => Boolean(user && (user.role === "owner" || permissions.every((permission) => user.permissions.includes(permission))));

const staffOperationsPermissions: PermissionKey[] = [
  "dashboard.view",
  "billing.view",
  "billing.create",
  "billing.manageInvoices",
  "billing.recordPayments",
  "billing.cancelInvoices",
  "quotations.view",
  "quotations.manage",
  "quotations.convert",
  "customers.view",
  "customers.manage",
  "jobCards.view",
  "jobCards.manage",
  "jobCards.photos",
  "enquiries.view",
  "enquiries.manage",
  "enquiries.convert",
  "services.view",
  "services.manage",
  "stock.view",
  "stock.manageItems",
  "stock.purchase",
  "stock.adjust",
  "stock.suppliers",
  "documents.printPdf",
  "sharing.whatsapp"
];

export const DEFAULT_ACCESS_ROLES: Array<Omit<AccessRole, "createdAt" | "updatedAt">> = [
  {
    id: OWNER_ACCESS_ROLE_ID,
    name: "Owner",
    description: "Full access to every workspace, setting, report, backup, and developer tool.",
    permissions: [...ALL_PERMISSIONS],
    locked: true,
    active: true
  },
  {
    id: STAFF_OPERATIONS_ROLE_ID,
    name: "Staff Operations",
    description: "Preserves the previous staff access for billing, enquiries, services, and stock operations.",
    permissions: staffOperationsPermissions,
    locked: false,
    active: true
  },
  {
    id: "billing-staff",
    name: "Billing Staff",
    description: "Counter billing, customers, job cards, print/PDF, and WhatsApp sharing.",
    permissions: [
      "dashboard.view",
      "billing.view",
      "billing.create",
      "billing.recordPayments",
      "quotations.view",
      "quotations.manage",
      "quotations.convert",
      "customers.view",
      "customers.manage",
      "jobCards.view",
      "jobCards.manage",
      "enquiries.view",
      "enquiries.manage",
      "services.view",
      "stock.view",
      "documents.printPdf",
      "sharing.whatsapp"
    ],
    locked: false,
    active: true
  },
  {
    id: "stock-staff",
    name: "Stock Staff",
    description: "Stock viewing, item management, stock purchases, purchase records, adjustments, suppliers, and basic dashboard access.",
    permissions: [
      "dashboard.view",
      "stock.view",
      "stock.manageItems",
      "stock.purchase",
      "stock.adjust",
      "stock.suppliers"
    ],
    locked: false,
    active: true
  }
];
