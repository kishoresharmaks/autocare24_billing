import type { CloudUser } from "../types/cloud";

export const PERMISSION_LABELS: Record<string, string> = {
  "dashboard.view": "Dashboard",
  "billing.view": "Invoices",
  "billing.create": "Create invoices",
  "billing.manageInvoices": "Manage invoices",
  "billing.recordPayments": "Record payments",
  "billing.cancelInvoices": "Cancel invoices",
  "quotations.view": "Quotations",
  "quotations.manage": "Manage quotations",
  "quotations.convert": "Convert quotations",
  "customers.view": "Customers",
  "customers.manage": "Manage customers",
  "jobCards.view": "Job cards",
  "jobCards.manage": "Manage job cards",
  "jobCards.photos": "Job card photos",
  "jobCards.settings": "Job card settings",
  "enquiries.view": "Enquiries",
  "enquiries.manage": "Manage enquiries",
  "enquiries.convert": "Convert enquiries",
  "services.view": "Services",
  "services.manage": "Manage services",
  "stock.view": "Stock",
  "stock.manageItems": "Manage stock items",
  "stock.purchase": "Stock purchases",
  "stock.adjust": "Stock adjustments",
  "stock.suppliers": "Suppliers",
  "reports.view": "Reports",
  "reports.export": "Export reports",
  "expenses.manage": "Expenses",
  "documents.printPdf": "Print PDF",
  "sharing.whatsapp": "WhatsApp sharing",
  "exports.csv": "CSV exports",
  "settings.manage": "Settings",
  "users.manage": "Users and devices",
  "backup.manage": "Backup",
  "developer.access": "Developer access"
};

export function hasPermission(user: CloudUser | null | undefined, permission: string) {
  if (!user || user.active === false) return false;
  if (user.role === "owner") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function hasAnyPermission(user: CloudUser | null | undefined, permissions: string[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function permissionLabel(permission: string) {
  return PERMISSION_LABELS[permission] || permission;
}

export function readablePermissions(user: CloudUser | null | undefined) {
  const permissions = user?.role === "owner" ? Object.keys(PERMISSION_LABELS) : user?.permissions || [];
  return permissions.map(permissionLabel).sort((left, right) => left.localeCompare(right));
}

export function firstAllowedMobileRoute(user: CloudUser | null | undefined) {
  if (hasPermission(user, "dashboard.view")) return "/dashboard";
  if (hasPermission(user, "billing.view")) return "/invoices";
  if (hasPermission(user, "stock.view")) return "/stock";
  if (hasPermission(user, "reports.view")) return "/reports";
  return "/more";
}
