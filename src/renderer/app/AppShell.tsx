import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  Clock,
  Database,
  Download,
  FileText,
  Home,
  Info,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Package,
  PhoneCall,
  PlusCircle,
  Power,
  ReceiptText,
  RefreshCw,
  Settings,
  UploadCloud,
  UserCircle,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type {
  AppUpdateStatus,
  AppUser,
  BusinessSettings,
  DashboardData,
  InventoryDashboardData,
  InvoiceSummary,
  PermissionKey,
  SyncDeviceStatus
} from "../../shared/types";
import { hasAnyPermission, hasPermission } from "../../shared/access-control";
import { CustomersPage } from "../features/billing/CustomersPage";
import { DeveloperConsolePage } from "../features/developer/DeveloperConsolePage";
import { EnquiriesPage } from "../features/enquiries/EnquiriesPage";
import { InvoicesPage } from "../features/billing/InvoicesPage";
import { JobCardsPage } from "../features/billing/JobCardsPage";
import { NewBillPage } from "../features/billing/NewBillPage";
import { QuotationsPage } from "../features/billing/QuotationsPage";
import { ServicesPage } from "../features/billing/ServicesPage";
import { WhatsAppConnectPage } from "../features/billing/WhatsAppConnectPage";
import { DashboardPage } from "../features/reports/DashboardPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { InventoryPage } from "../features/stock/InventoryPage";
import { BRAND_LOGO, DEVELOPER_LINKEDIN_URL, DEVELOPER_NAME } from "../lib/branding";
import { AboutPage } from "../features/about/AboutPage";

type PageId =
  | "dashboard"
  | "new-bill"
  | "quotations"
  | "job-cards"
  | "customers"
  | "whatsapp-connect"
  | "enquiries"
  | "services"
  | "inventory"
  | "invoices"
  | "reports"
  | "about"
  | "settings"
  | "developer-console";

type InventoryTab = "overview" | "items" | "purchases" | "purchaseRecords" | "remove" | "movements" | "suppliers" | "reports";
type EnquiryTab = "open" | "followups" | "converted" | "lost";
type JobCardTab = "today" | "open" | "approval" | "progress" | "ready" | "closed";
type WorkModule = "billing" | "stock" | "enquiries";
type ActiveModule = "home" | WorkModule;
type AuthMode = "checking" | "setup" | "login";
type SetupFlow = "choice" | "owner" | "staff" | "login";
type WeeklySalesPoint = {
  date: string;
  label: string;
  sales: number;
  bills: number;
};
type ModuleNavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  page: PageId;
  inventoryTab?: InventoryTab;
  enquiryTab?: EnquiryTab;
  startNewEnquiry?: boolean;
  startNewQuotation?: boolean;
  permission?: PermissionKey;
  allPermissions?: PermissionKey[];
};

const moduleLabels: Record<WorkModule, string> = {
  billing: "Billing",
  stock: "Stock Management",
  enquiries: "Customer Enquiries"
};

const syncStatusText = (status: SyncDeviceStatus | null) => {
  if (!status || !status.configured) return "Not connected";
  if (status.state === "pending_approval" || status.approvalStatus === "PENDING") return "Waiting for owner approval";
  if (status.connected) return "Device approved";
  if (status.approvalStatus === "REVOKED") return "Device revoked";
  if (status.lastError) return "Connection needs attention";
  return "Not connected";
};

const syncStatusHelp = (status: SyncDeviceStatus | null) => {
  if (!status || !status.configured) return "Enter the cloud details once to request access for this PC.";
  if (status.state === "pending_approval" || status.approvalStatus === "PENDING") {
    return "Access is already requested for this PC. Ask the owner to approve this device code, then click Check approval.";
  }
  if (status.connected) return "This PC is approved. Continue to staff login.";
  if (status.approvalStatus === "REVOKED") return "This PC was revoked by the owner. Reconnect only if the owner wants to approve it again.";
  return "Use Connect device only to request access again.";
};

const inventoryNavKeys: Record<InventoryTab, string> = {
  overview: "stock-overview",
  items: "stock-items",
  purchases: "stock-purchases",
  purchaseRecords: "stock-purchase-records",
  remove: "stock-remove",
  movements: "stock-movements",
  suppliers: "stock-suppliers",
  reports: "stock-reports"
};

const enquiryNavKeys: Record<EnquiryTab, string> = {
  followups: "enquiry-followups",
  open: "enquiry-open",
  converted: "enquiry-converted",
  lost: "enquiry-lost"
};

const moduleNavItems: Record<WorkModule, ModuleNavItem[]> = {
  billing: [
    { key: "billing-new", label: "New Bill", icon: PlusCircle, page: "new-bill", permission: "billing.create" },
    { key: "billing-new-quotation", label: "New Quotation", icon: PlusCircle, page: "quotations", startNewQuotation: true, permission: "quotations.manage" },
    { key: "billing-jobs", label: "Job Cards", icon: ClipboardList, page: "job-cards", permission: "jobCards.view" },
    { key: "billing-invoices", label: "Invoices", icon: ReceiptText, page: "invoices", permission: "billing.view" },
    { key: "billing-quotations", label: "Quotations", icon: FileText, page: "quotations", permission: "quotations.view" },
    { key: "billing-customers", label: "Customers & Vehicles", icon: Users, page: "customers", permission: "customers.view" },
    { key: "billing-whatsapp", label: "WhatsApp Connect", icon: MessageCircle, page: "whatsapp-connect", allPermissions: ["customers.view", "sharing.whatsapp"] },
    { key: "billing-services", label: "Services & Packages", icon: Wrench, page: "services", permission: "services.view" }
  ],
  stock: [
    { key: inventoryNavKeys.overview, label: "Stock Overview", icon: LayoutDashboard, page: "inventory", inventoryTab: "overview", permission: "stock.view" },
    { key: inventoryNavKeys.items, label: "Stock List", icon: Package, page: "inventory", inventoryTab: "items", permission: "stock.view" },
    { key: inventoryNavKeys.purchases, label: "Add Stock", icon: PlusCircle, page: "inventory", inventoryTab: "purchases", permission: "stock.purchase" },
    { key: inventoryNavKeys.purchaseRecords, label: "Purchase Records", icon: ReceiptText, page: "inventory", inventoryTab: "purchaseRecords", permission: "stock.view" },
    { key: inventoryNavKeys.remove, label: "Stock Action", icon: Package, page: "inventory", inventoryTab: "remove", permission: "stock.adjust" },
    { key: inventoryNavKeys.suppliers, label: "Suppliers", icon: Users, page: "inventory", inventoryTab: "suppliers", permission: "stock.suppliers" },
    { key: inventoryNavKeys.movements, label: "Stock History", icon: ClipboardList, page: "inventory", inventoryTab: "movements", permission: "stock.view" },
    { key: inventoryNavKeys.reports, label: "Stock Reports", icon: FileText, page: "inventory", inventoryTab: "reports", permission: "stock.view" }
  ],
  enquiries: [
    { key: enquiryNavKeys.followups, label: "Follow-ups", icon: LayoutDashboard, page: "enquiries", enquiryTab: "followups", permission: "enquiries.view" },
    { key: "enquiry-new", label: "New Enquiry", icon: PlusCircle, page: "enquiries", enquiryTab: "open", startNewEnquiry: true, permission: "enquiries.manage" },
    { key: enquiryNavKeys.open, label: "Open Enquiries", icon: ClipboardList, page: "enquiries", enquiryTab: "open", permission: "enquiries.view" },
    { key: enquiryNavKeys.converted, label: "Converted", icon: Users, page: "enquiries", enquiryTab: "converted", permission: "enquiries.view" },
    { key: enquiryNavKeys.lost, label: "Lost", icon: FileText, page: "enquiries", enquiryTab: "lost", permission: "enquiries.view" }
  ]
};

const modulePermissions: Record<WorkModule, PermissionKey[]> = {
  billing: ["billing.view", "billing.create", "quotations.view", "quotations.manage", "quotations.convert", "jobCards.view", "customers.view", "sharing.whatsapp", "services.view"],
  stock: ["stock.view", "stock.purchase", "stock.adjust", "stock.suppliers"],
  enquiries: ["enquiries.view", "enquiries.manage"]
};

const settingsPermissions: PermissionKey[] = [
  "settings.manage",
  "jobCards.settings",
  "users.manage",
  "backup.manage",
  "exports.csv"
];

const emptySidebarSyncStatus: SyncDeviceStatus = {
  configured: false,
  connected: false,
  state: "disconnected",
  approvalStatus: "",
  cloudUrl: "",
  deviceId: "",
  deviceName: "",
  deviceCode: "",
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastRevision: 0,
  lastPushAt: "",
  lastPullAt: "",
  lastError: ""
};

const can = (user: AppUser | null | undefined, permission: PermissionKey) => hasPermission(user, permission);
const canAny = (user: AppUser | null | undefined, permissions: PermissionKey[]) => hasAnyPermission(user, permissions);
const canUseNavItem = (user: AppUser, item: ModuleNavItem) =>
  (!item.permission || can(user, item.permission)) && (!item.allPermissions || item.allPermissions.every((permission) => can(user, permission)));
const allowedNavItems = (user: AppUser, module: WorkModule) => moduleNavItems[module].filter((item) => canUseNavItem(user, item));

const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateFromKey = (dateKey: string) => new Date(`${dateKey}T00:00:00`);
const addDaysToDateKey = (dateKey: string, days: number) => {
  const [year = 1970, month = 1, day = 1] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const shortWeekday = (dateKey: string) =>
  dateFromKey(dateKey).toLocaleDateString("en-IN", { weekday: "short" });
const lastSevenDateKeys = () => {
  const todayKey = todayLocal();
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(todayKey, index - 6));
};
const buildWeeklySales = (invoices: InvoiceSummary[]) => {
  const dateKeys = lastSevenDateKeys();
  return dateKeys.map((date) => {
    const dayInvoices = invoices.filter((invoice) => invoice.invoiceDate === date && invoice.invoiceStatus !== "cancelled");
    return {
      date,
      label: shortWeekday(date),
      sales: money(dayInvoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0)),
      bills: dayInvoices.length
    };
  });
};

const cleanNotificationMessage = (message: unknown, fallback = "Unexpected app error.") => {
  let text = String(message || fallback).trim();
  text = text.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  while (/^Error:\s*/i.test(text)) text = text.replace(/^Error:\s*/i, "");
  if (/typeerror:\s*fetch failed|fetch failed/i.test(text)) {
    return "Cloud API is not reachable. Check internet connection and Cloud API URL, then try again.";
  }
  return text || fallback;
};

const errorMessage = (error: unknown, fallback: string) =>
  cleanNotificationMessage(error instanceof Error ? error.message : fallback, fallback);

export default function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>("home");
  const [page, setPage] = useState<PageId>("new-bill");
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>("overview");
  const [enquiryTab, setEnquiryTab] = useState<EnquiryTab>("followups");
  const [jobCardTab, setJobCardTab] = useState<JobCardTab>("today");
  const [activeNavKey, setActiveNavKey] = useState("billing-new");
  const [newEnquiryKey, setNewEnquiryKey] = useState(0);
  const [newJobCardKey, setNewJobCardKey] = useState(0);
  const [newQuotationKey, setNewQuotationKey] = useState(0);
  const [activeInvoiceDraftId, setActiveInvoiceDraftId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  const refresh = () => setRefreshKey((value) => value + 1);
  const notify = (message: string) => {
    setToast(cleanNotificationMessage(message));
    window.setTimeout(() => setToast(""), 3200);
  };

  useEffect(() => {
    let active = true;
    const loadAuthStatus = () =>
      window.autocare.authStatus().then((status) => {
        if (!active) return;
        setAuthMode(status.hasUsers ? "login" : "setup");
        if (status.currentUser) setCurrentUser(status.currentUser);
      });

    loadAuthStatus().catch((error) => {
      if (active) notify(error.message);
    });
    const unsubscribeDatabaseRestored = window.autocare.onDatabaseRestored(() => {
      if (!active) return;
      notify("Backup restored. Data refreshed.");
      setCurrentUser(null);
      setSettings(null);
      loadAuthStatus().catch((error) => {
        if (active) notify(error.message);
      });
      refresh();
    });
    return () => {
      active = false;
      unsubscribeDatabaseRestored();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    window.autocare.getSettings().then(setSettings).catch((error) => notify(error.message));
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) {
      setUpdateStatus(null);
      setUpdatePanelOpen(false);
      return;
    }

    let active = true;
    window.autocare
      .getUpdateStatus()
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch((error) => notify(errorMessage(error, "Unable to load update status.")));
    const unsubscribe = window.autocare.onUpdateStatus((status) => setUpdateStatus(status));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || can(currentUser, "dashboard.view") || activeModule !== "home" || page !== "new-bill") return;
    if (canAny(currentUser, modulePermissions.billing)) {
      const firstItem = allowedNavItems(currentUser, "billing")[0];
      setActiveModule("billing");
      setPage(firstItem?.page || "invoices");
      setActiveNavKey(firstItem?.key || "billing-invoices");
    } else if (canAny(currentUser, modulePermissions.stock)) {
      const firstItem = allowedNavItems(currentUser, "stock")[0];
      setActiveModule("stock");
      setPage("inventory");
      setInventoryTab(firstItem?.inventoryTab || "overview");
      setActiveNavKey(firstItem?.key || inventoryNavKeys.overview);
    } else if (canAny(currentUser, modulePermissions.enquiries)) {
      const firstItem = allowedNavItems(currentUser, "enquiries")[0];
      setActiveModule("enquiries");
      setPage("enquiries");
      setEnquiryTab(firstItem?.enquiryTab || "open");
      setActiveNavKey(firstItem?.key || enquiryNavKeys.open);
    }
  }, [currentUser?.id, currentUser?.permissions.join("|"), activeModule, page]);

  const completeAuth = (user: AppUser) => {
    setCurrentUser(user);
    setSettings(null);
    setAuthMode("login");
    if (can(user, "dashboard.view")) {
      setActiveModule("home");
      setPage("new-bill");
      setActiveNavKey("overview");
    } else if (canAny(user, modulePermissions.billing)) {
      const firstItem = allowedNavItems(user, "billing")[0];
      setActiveModule("billing");
      setPage(firstItem?.page || "invoices");
      setActiveNavKey(firstItem?.key || "billing-invoices");
    } else if (canAny(user, modulePermissions.stock)) {
      const firstItem = allowedNavItems(user, "stock")[0];
      setActiveModule("stock");
      setPage("inventory");
      setInventoryTab(firstItem?.inventoryTab || "overview");
      setActiveNavKey(firstItem?.key || inventoryNavKeys.overview);
    } else if (canAny(user, modulePermissions.enquiries)) {
      const firstItem = allowedNavItems(user, "enquiries")[0];
      setActiveModule("enquiries");
      setPage("enquiries");
      setEnquiryTab(firstItem?.enquiryTab || "open");
      setActiveNavKey(firstItem?.key || enquiryNavKeys.open);
    } else {
      setActiveModule("home");
      setPage("new-bill");
      setActiveNavKey("overview");
    }
    notify(`Welcome ${user.displayName}.`);
  };

  const logout = () => {
    void window.autocare.logout().catch((error) => notify(error.message));
    setCurrentUser(null);
    setSettings(null);
    setActiveModule("home");
    setPage("new-bill");
    setActiveNavKey("billing-new");
  };

  const openModule = (module: WorkModule) => {
    if (!currentUser || !canAny(currentUser, modulePermissions[module])) return;
    const firstItem = allowedNavItems(currentUser, module)[0];
    if (!firstItem) return;
    setActiveModule(module);
    setPage(firstItem.page);
    setActiveNavKey(firstItem.key);
    if (firstItem.inventoryTab) setInventoryTab(firstItem.inventoryTab);
    if (firstItem.enquiryTab) setEnquiryTab(firstItem.enquiryTab);
  };

  const openInvoiceDraft = (draftId: string) => {
    if (!can(currentUser, "billing.create")) return;
    setActiveInvoiceDraftId(draftId);
    setActiveModule("billing");
    setPage("new-bill");
    setActiveNavKey("billing-new");
  };

  const openInvoice = (invoiceId: string) => {
    if (!can(currentUser, "billing.view")) return;
    setSelectedInvoiceId(invoiceId);
    setActiveModule("billing");
    setPage("invoices");
    setActiveNavKey("billing-invoices");
    refresh();
  };

  const startNewQuotation = () => {
    if (!can(currentUser, "quotations.manage")) return;
    setActiveModule("billing");
    setPage("quotations");
    setActiveNavKey("billing-new-quotation");
    setNewQuotationKey((value) => value + 1);
  };

  const goHome = () => {
    setActiveModule("home");
    setPage("new-bill");
    setActiveNavKey("overview");
  };

  const updateInventoryTab = (nextTab: InventoryTab) => {
    const item = moduleNavItems.stock.find((row) => row.inventoryTab === nextTab);
    if (currentUser && item && !canUseNavItem(currentUser, item)) return;
    setInventoryTab(nextTab);
    setActiveNavKey(inventoryNavKeys[nextTab]);
  };

  const updateEnquiryTab = (nextTab: EnquiryTab) => {
    const item = moduleNavItems.enquiries.find((row) => row.enquiryTab === nextTab && row.key !== "enquiry-new");
    if (currentUser && item && !canUseNavItem(currentUser, item)) return;
    setEnquiryTab(nextTab);
    setActiveNavKey(enquiryNavKeys[nextTab]);
  };

  const startNewEnquiry = () => {
    if (!can(currentUser, "enquiries.manage")) return;
    setActiveModule("enquiries");
    setPage("enquiries");
    setEnquiryTab("open");
    setActiveNavKey("enquiry-new");
    setNewEnquiryKey((value) => value + 1);
  };

  const openJobCards = (newCard = false) => {
    if (!can(currentUser, "jobCards.view")) return;
    setActiveModule("billing");
    setPage("job-cards");
    setJobCardTab(newCard ? "open" : "today");
    setActiveNavKey("billing-jobs");
    if (newCard) setNewJobCardKey((value) => value + 1);
  };

  const openAddStock = () => {
    if (!can(currentUser, "stock.purchase")) return;
    setActiveModule("stock");
    setPage("inventory");
    setInventoryTab("purchases");
    setActiveNavKey(inventoryNavKeys.purchases);
  };

  const openBillingReports = () => {
    if (!can(currentUser, "reports.view")) return;
    setActiveModule("home");
    setPage("reports");
    setActiveNavKey("reports");
  };

  const openNavItem = (item: ModuleNavItem) => {
    if (currentUser && !canUseNavItem(currentUser, item)) return;
    setPage(item.page);
    setActiveNavKey(item.key);
    if (item.inventoryTab) setInventoryTab(item.inventoryTab);
    if (item.enquiryTab) setEnquiryTab(item.enquiryTab);
    if (item.startNewEnquiry) setNewEnquiryKey((value) => value + 1);
    if (item.startNewQuotation) setNewQuotationKey((value) => value + 1);
  };

  const openSettings = () => {
    if (!canAny(currentUser, settingsPermissions)) return;
    setActiveModule("home");
    setPage("settings");
    setActiveNavKey("settings");
  };

  const openAbout = () => {
    setActiveModule("home");
    setPage("about");
    setActiveNavKey("about");
  };

  const openDeveloperConsole = () => {
    if (!can(currentUser, "developer.access")) return;
    setActiveModule("home");
    setPage("developer-console");
    setActiveNavKey("developer-console");
  };

  const checkForUpdates = async () => {
    setUpdatePanelOpen(true);
    setUpdateBusy(true);
    try {
      const status = await window.autocare.checkForUpdates();
      setUpdateStatus(status);
      if (status.state === "not-available" || status.state === "disabled" || status.state === "error") notify(status.message);
    } catch (error) {
      notify(errorMessage(error, "Unable to check for updates."));
    } finally {
      setUpdateBusy(false);
    }
  };

  const downloadUpdate = async () => {
    setUpdatePanelOpen(true);
    setUpdateBusy(true);
    try {
      const status = await window.autocare.downloadUpdate();
      setUpdateStatus(status);
      if (status.state === "error") notify(status.message);
    } catch (error) {
      notify(errorMessage(error, "Unable to download the update."));
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    try {
      await window.autocare.installUpdate();
    } catch (error) {
      notify(errorMessage(error, "Unable to install the update."));
      setUpdateBusy(false);
    }
  };

  const topbarAction = () => {
    if ((page === "settings" || page === "developer-console" || page === "reports" || page === "about") && activeModule === "home") {
      return (
        <button className="ghost-button" onClick={goHome}>
          <Home size={18} />
          Main Options
        </button>
      );
    }
    if (page === "settings" || page === "developer-console" || page === "about") return null;
    if (activeModule === "home") {
      if (!canAny(currentUser, settingsPermissions)) return null;
      return (
        <button className="ghost-button" onClick={openSettings}>
          <Settings size={18} />
          Settings
        </button>
      );
    }
    if (activeModule === "billing") {
      if (page === "quotations") {
        if (!can(currentUser, "quotations.manage")) return null;
        return (
          <button className="primary-action" onClick={startNewQuotation}>
            <PlusCircle size={18} />
            New quotation
          </button>
        );
      }
      if (page === "whatsapp-connect") return null;
      if (!can(currentUser, "billing.create")) return null;
      return (
        <button className="primary-action" onClick={() => openModule("billing")}>
          <PlusCircle size={18} />
          New bill
        </button>
      );
    }
    if (activeModule === "stock") {
      if (!can(currentUser, "stock.purchase")) return null;
      return (
        <button className="primary-action" onClick={openAddStock}>
          <PlusCircle size={18} />
          Add stock
        </button>
      );
    }
    return (
      can(currentUser, "enquiries.manage") ? (
      <button className="primary-action" onClick={startNewEnquiry}>
        <PlusCircle size={18} />
        New enquiry
      </button>
      ) : null
    );
  };

  const activeNavItem =
    activeModule !== "home"
      ? currentUser
        ? allowedNavItems(currentUser, activeModule).find((item) => item.key === activeNavKey)
        : undefined
      : undefined;
  const title =
    page === "settings"
      ? "Settings"
      : page === "about"
        ? "App Information"
      : page === "reports"
        ? "Reports"
      : page === "developer-console"
        ? "Developer Console"
        : activeModule === "home"
          ? "Overview"
          : activeNavItem?.label ?? moduleLabels[activeModule];
  const eyebrow =
    activeModule === "home" || page === "settings" || page === "developer-console" || page === "reports" || page === "about"
      ? page === "reports"
        ? "Owner Workspace"
        : page === "about"
          ? "Production Details"
        : "Autocare24 Bike & Car Detailing Studio"
        : `${moduleLabels[activeModule]} Workspace`;
  const showOverview = activeModule === "home" && page !== "settings" && page !== "developer-console" && page !== "reports" && page !== "about";
  const updateAction = currentUser ? (
    <UpdateHeaderControl
      status={updateStatus}
      busy={updateBusy}
      panelOpen={updatePanelOpen}
      setPanelOpen={setUpdatePanelOpen}
      checkForUpdates={checkForUpdates}
      downloadUpdate={downloadUpdate}
      installUpdate={installUpdate}
    />
  ) : null;

  if (authMode === "checking") {
    return (
      <div className="auth-shell">
        <div className="empty-state">Loading secure workspace...</div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <AuthGate
          mode={authMode}
          onAuthed={completeAuth}
          notify={notify}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  if (!settings) {
    return (
      <div className="auth-shell">
        <div className="empty-state">Loading secure workspace...</div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppSidebar
        currentUser={currentUser}
        activeModule={activeModule}
        page={page}
        goHome={goHome}
        openModule={openModule}
        openReports={openBillingReports}
        openAbout={openAbout}
        openSettings={openSettings}
        openDeveloperConsole={openDeveloperConsole}
        notify={notify}
        logout={logout}
      />

      <main className="workspace">
        {!showOverview && (
          <header className="topbar">
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h1>{title}</h1>
            </div>
            <div className="topbar-actions">
              {updateAction}
              {topbarAction()}
            </div>
          </header>
        )}

        <section className="content-area">
          {
            <>
              {activeModule !== "home" && page !== "settings" && (
                <WorkspaceNav
                  module={activeModule}
                  activeNavKey={activeNavKey}
                  page={page}
                  openNavItem={openNavItem}
                  currentUser={currentUser}
                />
              )}
              {showOverview && can(currentUser, "dashboard.view") && (
                <OverviewPage
                  refreshKey={refreshKey}
                  notify={notify}
                  openModule={openModule}
                  currentUser={currentUser}
                  openSettings={openSettings}
                  updateAction={updateAction}
                  openAddStock={openAddStock}
                  startNewEnquiry={startNewEnquiry}
                  openBillingReports={openBillingReports}
                  openJobCards={() => openJobCards(true)}
                />
              )}
              {showOverview && !can(currentUser, "dashboard.view") && <NoAccessPanel currentUser={currentUser} logout={logout} />}
              {page === "dashboard" && activeModule !== "home" && can(currentUser, "dashboard.view") && <DashboardPage refreshKey={refreshKey} setPage={setPage} notify={notify} />}
              {page === "new-bill" && activeModule !== "home" && can(currentUser, "billing.create") && (
                <NewBillPage
                  settings={settings}
                  notify={notify}
                  onSaved={refresh}
                  activeDraftId={activeInvoiceDraftId}
                  setActiveDraftId={setActiveInvoiceDraftId}
                />
              )}
              {page === "job-cards" && activeModule !== "home" && can(currentUser, "jobCards.view") && (
                <JobCardsPage
                  settings={settings}
                  refreshKey={refreshKey}
                  notify={notify}
                  onChanged={refresh}
                  tab={jobCardTab}
                  setTab={setJobCardTab}
                  newRequestKey={newJobCardKey}
                  currentUser={currentUser}
                />
              )}
              {page === "quotations" && activeModule !== "home" && can(currentUser, "quotations.view") && (
                <QuotationsPage
                  settings={settings}
                  refreshKey={refreshKey}
                  notify={notify}
                  onChanged={refresh}
                  newRequestKey={newQuotationKey}
                  currentUser={currentUser}
                  openInvoice={openInvoice}
                />
              )}
              {page === "customers" && activeModule !== "home" && can(currentUser, "customers.view") && <CustomersPage refreshKey={refreshKey} notify={notify} />}
              {page === "whatsapp-connect" && activeModule !== "home" && can(currentUser, "customers.view") && can(currentUser, "sharing.whatsapp") && (
                <WhatsAppConnectPage settings={settings} refreshKey={refreshKey} notify={notify} />
              )}
              {page === "enquiries" && activeModule !== "home" && can(currentUser, "enquiries.view") && (
                <EnquiriesPage
                  refreshKey={refreshKey}
                  notify={notify}
                  onChanged={refresh}
                  tab={enquiryTab}
                  setTab={updateEnquiryTab}
                  newRequestKey={newEnquiryKey}
                />
              )}
              {page === "services" && activeModule !== "home" && can(currentUser, "services.view") && <ServicesPage settings={settings} notify={notify} />}
              {page === "inventory" && activeModule !== "home" && can(currentUser, "stock.view") && (
                <InventoryPage
                  refreshKey={refreshKey}
                  notify={notify}
                  onChanged={refresh}
                  tab={inventoryTab}
                  setTab={updateInventoryTab}
                  currentUser={currentUser}
                />
              )}
              {page === "invoices" && activeModule !== "home" && can(currentUser, "billing.view") && (
                <InvoicesPage
                  settings={settings}
                  refreshKey={refreshKey}
                  notify={notify}
                  openDraft={openInvoiceDraft}
                  currentUser={currentUser}
                  initialSelectedInvoiceId={selectedInvoiceId}
                />
              )}
              {page === "reports" && can(currentUser, "reports.view") && <ReportsPage refreshKey={refreshKey} notify={notify} currentUser={currentUser} />}
              {page === "about" && <AboutPage notify={notify} />}
              {page === "settings" && canAny(currentUser, settingsPermissions) && (
                <SettingsPage
                  settings={settings}
                  setSettings={setSettings}
                  notify={notify}
                  currentUser={currentUser}
                  onLogout={logout}
                  onChanged={() => {
                    refresh();
                    window.autocare.getSettings().then(setSettings).catch((error) => notify(error.message));
                  }}
                />
              )}
              {page === "developer-console" && can(currentUser, "developer.access") && (
                <DeveloperConsolePage currentUser={currentUser} notify={notify} />
              )}
            </>
          }
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const updateButtonLabel = (status: AppUpdateStatus | null, busy: boolean) => {
  if (busy && status?.state === "downloaded") return "Installing";
  if (busy && status?.state === "available") return "Starting download";
  if (busy && status?.state !== "downloading") return "Checking";
  if (!status) return "Check for updates";
  if (status.state === "checking") return "Checking";
  if (status.state === "available") return "Update available";
  if (status.state === "downloading") return `Downloading ${Math.round(status.progressPercent)}%`;
  if (status.state === "downloaded") return "Update ready";
  return "Check for updates";
};

const updatePanelHeading = (status: AppUpdateStatus | null) => {
  if (!status) return "App updates";
  if (status.state === "available") return "Update available";
  if (status.state === "downloading") return "Downloading update";
  if (status.state === "downloaded") return "Update ready";
  if (status.state === "not-available") return "Latest version";
  if (status.state === "error") return "Update check failed";
  return "App updates";
};

const formatBytes = (value: number) => {
  if (!value) return "";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

function UpdateHeaderControl({
  status,
  busy,
  panelOpen,
  setPanelOpen,
  checkForUpdates,
  downloadUpdate,
  installUpdate
}: {
  status: AppUpdateStatus | null;
  busy: boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}) {
  const state = status?.state || "idle";
  const progress = Math.round(status?.progressPercent || 0);
  const version = status?.availableVersion && status.availableVersion !== status.currentVersion ? status.availableVersion : "";
  const message = status?.message || "Ready to check for updates.";
  const releaseDate = status?.releaseDate ? status.releaseDate.slice(0, 10) : "";
  const downloaded = status?.transferredBytes ? formatBytes(status.transferredBytes) : "";
  const total = status?.totalBytes ? formatBytes(status.totalBytes) : "";
  const checkOnClick = state === "idle" || state === "not-available" || state === "error" || state === "disabled";

  const handleButtonClick = () => {
    if (checkOnClick) void checkForUpdates();
    else setPanelOpen(!panelOpen);
  };

  return (
    <div className="update-control">
      <button
        className={`ghost-button update-button update-${state}`}
        disabled={busy && state !== "downloading"}
        onClick={handleButtonClick}
        title={message}
      >
        <RefreshCw size={17} className={state === "checking" || state === "downloading" ? "spin-icon" : ""} />
        {updateButtonLabel(status, busy)}
      </button>

      {panelOpen && (
        <div className="update-panel" role="status" aria-live="polite">
          <div className="update-panel-header">
            <div>
              <strong>{updatePanelHeading(status)}</strong>
              <span>Current version {status?.currentVersion || "unknown"}</span>
            </div>
            <button className="icon-button update-panel-close" onClick={() => setPanelOpen(false)} title="Close update panel">
              <X size={16} />
            </button>
          </div>

          <p className={state === "error" ? "update-message error" : "update-message"}>{message}</p>
          {(version || releaseDate) && (
            <div className="update-meta-row">
              {version && <span>Version {version}</span>}
              {releaseDate && <span>{releaseDate}</span>}
            </div>
          )}

          {(state === "downloading" || state === "downloaded") && (
            <div className="update-progress">
              <div><span style={{ width: `${state === "downloaded" ? 100 : progress}%` }} /></div>
              <small>{state === "downloaded" ? "Download complete" : `${progress}%${downloaded && total ? ` - ${downloaded} of ${total}` : ""}`}</small>
            </div>
          )}

          <div className="update-panel-actions">
            {state === "available" && (
              <button className="primary-action" disabled={busy} onClick={() => void downloadUpdate()}>
                <Download size={17} />
                Download update
              </button>
            )}
            {state === "downloaded" && (
              <button className="primary-action" disabled={busy} onClick={() => void installUpdate()}>
                <Power size={17} />
                Restart and install
              </button>
            )}
            {state !== "checking" && state !== "downloading" && (
              <button className="ghost-button" disabled={busy} onClick={() => void checkForUpdates()}>
                <RefreshCw size={17} />
                Check again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AppSidebar({
  currentUser,
  activeModule,
  page,
  goHome,
  openModule,
  openReports,
  openAbout,
  openSettings,
  openDeveloperConsole,
  notify,
  logout
}: {
  currentUser: AppUser;
  activeModule: ActiveModule;
  page: PageId;
  goHome: () => void;
  openModule: (module: WorkModule) => void;
  openReports: () => void;
  openAbout: () => void;
  openSettings: () => void;
  openDeveloperConsole: () => void;
  notify: (message: string) => void;
  logout: () => void;
}) {
  const [driveBackupBusy, setDriveBackupBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncDeviceStatus>(emptySidebarSyncStatus);
  const navItems: Array<{ key: string; label: string; icon: LucideIcon; active: boolean; onClick: () => void; visible: boolean }> = [
    { key: "overview", label: "Overview", icon: Home, active: activeModule === "home" && page !== "settings" && page !== "developer-console" && page !== "reports", onClick: goHome, visible: can(currentUser, "dashboard.view") },
    { key: "billing", label: "Billing", icon: ReceiptText, active: activeModule === "billing" && page !== "settings", onClick: () => openModule("billing"), visible: canAny(currentUser, modulePermissions.billing) },
    { key: "stock", label: "Stock Management", icon: Package, active: activeModule === "stock" && page !== "settings", onClick: () => openModule("stock"), visible: canAny(currentUser, modulePermissions.stock) },
    { key: "enquiries", label: "Customer Enquiries", icon: PhoneCall, active: activeModule === "enquiries" && page !== "settings", onClick: () => openModule("enquiries"), visible: canAny(currentUser, modulePermissions.enquiries) },
    { key: "reports", label: "Reports", icon: BarChart3, active: activeModule === "home" && page === "reports", onClick: openReports, visible: can(currentUser, "reports.view") }
  ];

  const backupToDrive = async () => {
    setDriveBackupBusy(true);
    notify("Starting Google Drive backup...");
    try {
      const result = await window.autocare.backupToDriveNow();
      notify(result.fileName ? `${result.message} ${result.fileName}` : result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to back up to Google Drive.");
    } finally {
      setDriveBackupBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    window.autocare.syncStatus().then((status) => {
      if (mounted) setSyncStatus(status);
    }).catch(() => undefined);
    const unsubscribe = window.autocare.onSyncStatus((status) => setSyncStatus(status));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const cloudOnline = syncStatus.connected && syncStatus.state === "connected";
  const cloudChecking = syncStatus.connected && syncStatus.state === "syncing";
  const cloudPendingApproval = syncStatus.state === "pending_approval";
  const cloudProblem = syncStatus.state === "error";
  const syncLabel = cloudProblem
    ? "Offline"
    : cloudChecking
      ? "Checking..."
      : cloudPendingApproval
        ? "Approval pending"
        : cloudOnline
        ? syncStatus.conflictCount > 0
          ? `${syncStatus.conflictCount} conflict${syncStatus.conflictCount === 1 ? "" : "s"}`
          : syncStatus.pendingCount > 0
            ? `${syncStatus.pendingCount} pending`
            : "Connected"
        : syncStatus.configured
          ? "Cloud offline"
          : "Not connected";
  const syncHeading = cloudPendingApproval ? "Owner approval needed" : cloudOnline ? "Cloud data" : syncStatus.configured ? "Cloud unavailable" : "Cloud required";
  const syncDotClass = syncStatus.conflictCount > 0 || cloudProblem ? "danger" : cloudOnline ? "online" : "";

  return (
    <aside className="sidebar app-sidebar">
      <div className="brand-lockup sidebar-brand">
        <div className="brand-logo-shell">
          <img className="brand-logo-image" src={BRAND_LOGO} alt="Autocare24" />
        </div>
        <div>
          <strong>Autocare24</strong>
          <span>Detailing Studio</span>
        </div>
      </div>

      <div className="sidebar-user-card">
        <div>
          <span>Signed in</span>
          <strong>{currentUser.displayName}</strong>
          <em>{currentUser.role === "owner" ? "Owner" : currentUser.accessRoleName || "Staff"}</em>
        </div>
        <UserCircle size={42} />
      </div>

      <nav className="nav-list main-nav" aria-label="Main navigation">
        {navItems.filter((item) => item.visible).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} className={item.active ? "nav-item active" : "nav-item"} onClick={item.onClick}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-system-label">System</div>
      <div className="sidebar-system">
        {canAny(currentUser, settingsPermissions) && (
          <button className={page === "settings" ? "nav-item utility active" : "nav-item utility"} onClick={openSettings}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
        )}
        <button className={page === "about" ? "nav-item utility active" : "nav-item utility"} onClick={openAbout}>
          <Info size={18} />
          <span>App Information</span>
        </button>
        {can(currentUser, "developer.access") && (
          <button className={page === "developer-console" ? "nav-item utility active" : "nav-item utility"} onClick={openDeveloperConsole}>
            <Wrench size={18} />
            <span>Developer Console</span>
          </button>
        )}
        <button className="nav-item utility" onClick={logout}>
          <LogOut size={18} />
          <span>Log out</span>
        </button>
      </div>

      <div className="sidebar-bottom">
        {can(currentUser, "backup.manage") && (
          <button className="sidebar-drive-backup" disabled={driveBackupBusy} onClick={() => void backupToDrive()}>
            <UploadCloud size={22} />
            <div>
              <span>Cloud backup</span>
              <strong>{driveBackupBusy ? "Uploading..." : "Back up to Drive"}</strong>
            </div>
          </button>
        )}
        <div className="sidebar-db-card" title={syncStatus.lastError || syncLabel}>
          <Database size={24} />
          <div>
            <span>{syncHeading}</span>
            <strong><span className={`status-dot ${syncDotClass}`} />{syncLabel}</strong>
          </div>
        </div>
        <button className="developer-credit" onClick={() => void window.autocare.openExternal(DEVELOPER_LINKEDIN_URL)}>
          <span>Developer</span>
          <strong>{DEVELOPER_NAME}</strong>
        </button>
      </div>
    </aside>
  );
}

function NoAccessPanel({ currentUser, logout }: { currentUser: AppUser; logout: () => void }) {
  return (
    <div className="page-grid">
      <section className="panel wide-panel access-panel">
        <h2>No access assigned</h2>
        <p className="muted">This account is active, but its role does not include any workspace permission yet.</p>
        <div className="mini-metrics">
          <div><span>Signed in</span><strong>{currentUser.displayName}</strong></div>
          <div><span>Role</span><strong>{currentUser.accessRoleName || currentUser.role}</strong></div>
          <div><span>Status</span><strong>Ask an owner to update access</strong></div>
        </div>
        <button className="ghost-button" onClick={logout}>
          <LogOut size={18} />
          Log out
        </button>
      </section>
    </div>
  );
}

function WorkspaceNav({
  module,
  activeNavKey,
  page,
  openNavItem,
  currentUser
}: {
  module: WorkModule;
  activeNavKey: string;
  page: PageId;
  openNavItem: (item: ModuleNavItem) => void;
  currentUser: AppUser;
}) {
  return (
    <nav className="workspace-nav no-print" aria-label={`${moduleLabels[module]} tools`}>
      {allowedNavItems(currentUser, module).map((item) => {
        const Icon = item.icon;
        const active = activeNavKey === item.key && page === item.page;
        return (
          <button key={item.key} className={active ? "workspace-nav-item active" : "workspace-nav-item"} onClick={() => openNavItem(item)}>
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function AuthGate({
  mode,
  onAuthed,
  notify
}: {
  mode: AuthMode;
  onAuthed: (user: AppUser) => void;
  notify: (message: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupFlow, setSetupFlow] = useState<SetupFlow>("choice");
  const [cloudUrl, setCloudUrl] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [registrationKey, setRegistrationKey] = useState("");
  const [staffStatus, setStaffStatus] = useState<SyncDeviceStatus | null>(null);
  const [authMessage, setAuthMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isSetup = mode === "setup";
  const isOwnerSetup = isSetup && setupFlow === "owner";
  const isStaffSetup = isSetup && setupFlow === "staff";
  const isLogin = mode === "login" || (isSetup && setupFlow === "login");
  const isExistingBusinessLogin = isSetup && setupFlow === "login";

  useEffect(() => {
    if (mode !== "setup") {
      setSetupFlow("login");
      return;
    }
    setSetupFlow("choice");
    window.autocare
      .existingBusinessStatus()
      .then((status) => {
        setStaffStatus(status);
        setCloudUrl(status.cloudUrl || "");
        setDeviceName(status.deviceName || "");
        if (status.connected) {
          window.autocare
            .authStatus()
            .then((auth) => {
              if (auth.hasUsers) setSetupFlow("login");
            })
            .catch(() => undefined);
        } else if (status.state === "pending_approval" || status.approvalStatus === "PENDING") {
          setSetupFlow("staff");
        }
      })
      .catch(() => undefined);
  }, [mode]);

  const openStaffSetup = () => {
    setAuthMessage("");
    setSetupFlow("staff");
    window.autocare
      .existingBusinessStatus()
      .then((status) => {
        setStaffStatus(status);
        setCloudUrl((current) => current || status.cloudUrl || "");
        setDeviceName((current) => current || status.deviceName || "");
      })
      .catch(() => undefined);
  };

  const openOwnerSetup = () => {
    setAuthMessage("");
    if (!staffStatus?.connected) {
      setSetupFlow("staff");
      setAuthMessage("Connect this PC to Cloud API first. If this is the first PC, it will be approved automatically, then you can create the owner account.");
      return;
    }
    setSetupFlow("owner");
    setPassword("");
    setConfirmPassword("");
  };

  const showAuthMessage = (message: string) => {
    const cleaned = cleanNotificationMessage(message);
    setAuthMessage(cleaned);
    notify(cleaned);
  };

  const switchToLoginWhenReady = async (status: SyncDeviceStatus) => {
    setStaffStatus(status);
    if (!status.connected) return;
    const auth = await window.autocare.authStatus();
    if (!auth.hasUsers) {
      setSetupFlow("owner");
      setPassword("");
      setConfirmPassword("");
      notify("Device approved. Create the owner account now.");
      return;
    }
    setSetupFlow("login");
    setUsername("");
    setPassword("");
    notify("Device approved. Staff can login.");
  };

  const connectExistingBusiness = async () => {
    setAuthMessage("");
    if (!cloudUrl.trim()) return showAuthMessage("Cloud API URL is required.");
    if (!deviceName.trim()) return showAuthMessage("Device name is required.");
    if (!registrationKey.trim()) return showAuthMessage("Registration key is required.");
    setBusy(true);
    try {
      const status = await window.autocare.connectExistingBusiness({ cloudUrl, deviceName, registrationKey });
      setRegistrationKey("");
      await switchToLoginWhenReady(status);
      if (!status.connected) notify(syncStatusText(status));
    } catch (error) {
      showAuthMessage(error instanceof Error ? error.message : "Unable to connect this PC.");
    } finally {
      setBusy(false);
    }
  };

  const checkExistingBusinessApproval = async () => {
    setAuthMessage("");
    setBusy(true);
    try {
      const status = await window.autocare.checkExistingBusinessApproval();
      await switchToLoginWhenReady(status);
      if (!status.connected) notify(status.lastError || syncStatusText(status));
    } catch (error) {
      showAuthMessage(error instanceof Error ? error.message : "Unable to check approval.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setAuthMessage("");
    if (!username.trim()) return showAuthMessage("Username is required.");
    if (!password.trim()) return showAuthMessage("Password or PIN is required.");
    if (isOwnerSetup && password !== confirmPassword) return showAuthMessage("Passwords do not match.");
    setBusy(true);
    try {
      const user = isOwnerSetup
        ? await window.autocare.setupOwner({ displayName, username, password })
        : await window.autocare.login({ username, password });
      onAuthed(user);
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      showAuthMessage(error instanceof Error ? error.message : "Unable to unlock app.");
    } finally {
      setBusy(false);
    }
  };

  const title = isOwnerSetup
    ? "New owner setup"
    : isStaffSetup
      ? "Connect existing business"
      : isLogin
        ? "Login required"
        : "Choose setup type";
  const subtitle = isOwnerSetup
    ? "Use this only on the main owner PC."
    : isStaffSetup
      ? "Request access to the existing cloud business."
      : isLogin
        ? isExistingBusinessLogin
          ? "Enter your staff username and password."
          : "Enter your username and password."
        : "Select the correct setup for this Windows PC.";
  const brandStatus = isOwnerSetup
    ? "Main PC owner access"
    : isStaffSetup
      ? "Staff PC cloud access"
      : isLogin
        ? "Secure login"
        : "First-run setup";

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup auth-brand">
          <div className="brand-logo-shell">
            <img className="brand-logo-image" src={BRAND_LOGO} alt="Autocare24" />
          </div>
          <div>
            <strong>Autocare24 Billing</strong>
            <span>{brandStatus}</span>
          </div>
        </div>
        <div>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        {authMessage && <div className="auth-error">{authMessage}</div>}

        {isSetup && setupFlow === "choice" && (
          <div className="auth-choice-grid">
            <button className="auth-choice-button" type="button" onClick={openOwnerSetup}>
              <UserCircle size={22} />
              <strong>Create Owner Account</strong>
              <span>Use after this PC is connected to Cloud API.</span>
            </button>
            <button className="auth-choice-button" type="button" onClick={openStaffSetup}>
              <UploadCloud size={22} />
              <strong>Connect Cloud API</strong>
              <span>Connect this PC or request approval for an existing business.</span>
            </button>
          </div>
        )}

        {isStaffSetup && (
          <div className="form-stack">
            <div className={`auth-status ${staffStatus?.connected ? "approved" : staffStatus?.state === "pending_approval" ? "pending" : ""}`}>
              <span>Device status</span>
              <strong>{syncStatusText(staffStatus)}</strong>
              {staffStatus?.deviceCode && <code>{staffStatus.deviceCode}</code>}
              <em>{syncStatusHelp(staffStatus)}</em>
              {staffStatus?.lastError && staffStatus.lastError !== syncStatusHelp(staffStatus) && <em>{staffStatus.lastError}</em>}
            </div>
            <label>
              Cloud API URL
              <input value={cloudUrl} onChange={(event) => setCloudUrl(event.currentTarget.value)} placeholder="https://sync.yourdomain.com" autoFocus />
            </label>
            <label>
              Device name
              <input value={deviceName} onChange={(event) => setDeviceName(event.currentTarget.value)} placeholder="Front desk PC" />
            </label>
            <label>
              Registration key
              <input type="password" value={registrationKey} onChange={(event) => setRegistrationKey(event.currentTarget.value)} placeholder="Cloud setup key" />
            </label>
            <button className="primary-action auth-submit" onClick={connectExistingBusiness} disabled={busy}>
              <UploadCloud size={18} />
              {busy ? "Please wait..." : staffStatus?.approvalStatus === "PENDING" ? "Request access again" : "Connect device"}
            </button>
            <button className="ghost-button auth-submit" onClick={checkExistingBusinessApproval} disabled={busy || !staffStatus?.configured}>
              {busy ? "Checking..." : "Check approval"}
            </button>
            <button className="ghost-button auth-submit" onClick={() => setSetupFlow("choice")} disabled={busy}>
              Back to setup choice
            </button>
          </div>
        )}

        {(isOwnerSetup || isLogin) && (
          <div className="form-stack">
            {isOwnerSetup && (
            <label>
              Owner name
              <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
            </label>
          )}
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoFocus />
          </label>
          <label>
            Password / PIN
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isLogin) void submit();
              }}
            />
          </label>
          {isOwnerSetup && (
            <label>
              Confirm password / PIN
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
            </label>
          )}
          <button className="primary-action auth-submit" onClick={submit} disabled={busy}>
            {busy ? "Please wait..." : isOwnerSetup ? "Create owner account" : "Unlock software"}
          </button>
          {isOwnerSetup && (
            <button className="ghost-button auth-submit" onClick={() => setSetupFlow("choice")} disabled={busy}>
              Back to setup choice
            </button>
          )}
        </div>
        )}
        <p className="auth-note">
          {isStaffSetup || isExistingBusinessLogin
            ? "Staff PCs use cloud approval and staff logins. Owner passwords stay private."
            : "Owner setup is for the main PC only. Passwords are stored as salted hashes."}
        </p>
      </section>
    </div>
  );
}

function OverviewPage({
  refreshKey,
  notify,
  openModule,
  currentUser,
  openSettings,
  updateAction,
  openAddStock,
  startNewEnquiry,
  openBillingReports,
  openJobCards
}: {
  refreshKey: number;
  notify: (message: string) => void;
  openModule: (module: WorkModule) => void;
  currentUser: AppUser;
  openSettings: () => void;
  updateAction: ReactNode;
  openAddStock: () => void;
  startNewEnquiry: () => void;
  openBillingReports: () => void;
  openJobCards: () => void;
}) {
  const [data, setData] = useState<{
    dashboard: DashboardData;
    inventory: InventoryDashboardData;
    weeklySales: WeeklySalesPoint[];
    weeklyTotalSales: number;
    weeklyBills: number;
    weeklyNewLeads: number;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError("");
    const emptyInventory: InventoryDashboardData = {
      totalStockValue: 0,
      lowStockCount: 0,
      expiringCount: 0,
      retailCount: 0,
      items: [],
      lowStockItems: [],
      expiringBatches: [],
      recentMovements: []
    };
    Promise.all([
      window.autocare.dashboard(),
      can(currentUser, "stock.view") ? window.autocare.inventoryDashboard() : Promise.resolve(emptyInventory),
      can(currentUser, "billing.view") ? window.autocare.listInvoices("") : Promise.resolve([]),
      can(currentUser, "enquiries.view") ? window.autocare.listEnquiries() : Promise.resolve([])
    ])
      .then(([dashboardData, inventoryData, invoices, enquiries]) => {
        if (!active) return;
        const weeklySales = buildWeeklySales(invoices);
        const weeklyDateKeys = new Set(weeklySales.map((point) => point.date));
        setData({
          dashboard: dashboardData,
          inventory: inventoryData,
          weeklySales,
          weeklyTotalSales: money(weeklySales.reduce((sum, point) => sum + point.sales, 0)),
          weeklyBills: weeklySales.reduce((sum, point) => sum + point.bills, 0),
          weeklyNewLeads: enquiries.filter((enquiry) => weeklyDateKeys.has((enquiry.createdAt || "").slice(0, 10))).length
        });
      })
      .catch((error) => {
        if (!active) return;
        const message = errorMessage(error, "Unable to load module summaries.");
        setData(null);
        setLoadError(message);
        notify(message);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, retryKey, currentUser.id, currentUser.permissions.join("|")]);

  if (loadError) {
    return (
      <section className="panel wide-panel access-panel cloud-required-panel">
        <h2>Cloud data unavailable</h2>
        <p className="muted">Overview, reports, stock, customers, invoices, job cards, and enquiries need the cloud connection.</p>
        <p className="cloud-error">{loadError}</p>
        <div className="cloud-actions">
          <button className="primary-action" onClick={() => setRetryKey((value) => value + 1)}>Retry cloud</button>
          <button className="ghost-button" onClick={openSettings}>
            <Settings size={18} />
            Cloud Status
          </button>
        </div>
      </section>
    );
  }

  if (!data) return <div className="empty-state">Loading overview...</div>;

  const { dashboard, inventory, weeklySales, weeklyTotalSales, weeklyBills, weeklyNewLeads } = data;

  return (
    <div className="overview-page">
      <header className="overview-header">
        <div>
          <h1>Welcome back, {currentUser.displayName}</h1>
          <p>Here's what's happening in your studio today.</p>
        </div>
        <div className="overview-header-actions">
          {updateAction}
          <button className="ghost-button" onClick={openSettings}>
            <Settings size={18} />
            Settings
          </button>
        </div>
      </header>

      <section className="overview-kpi-strip" aria-label="Today summary">
        <OverviewKpi
          icon={Wallet}
          label="Today revenue"
          value={formatMoney(dashboard.todayRevenue)}
          hint="Cash collected today"
          tone="green"
        />
        <OverviewKpi
          icon={Clock}
          label="Pending revenue"
          value={formatMoney(dashboard.pendingDues)}
          hint={dashboard.pendingDues > 0 ? "Payment follow-up needed" : "No Pending revenue"}
          tone="gold"
        />
        <OverviewKpi
          icon={ReceiptText}
          label="Today bills"
          value={String(dashboard.todayInvoices)}
          hint={`${dashboard.jobCards.todayJobs} job card${dashboard.jobCards.todayJobs === 1 ? "" : "s"} today`}
          tone="blue"
        />
        {can(currentUser, "stock.view") && (
          <OverviewKpi
            icon={Package}
            label="Stock value"
            value={formatMoney(inventory.totalStockValue)}
            hint={`${inventory.lowStockCount} low stock item${inventory.lowStockCount === 1 ? "" : "s"}`}
            tone="purple"
            warn={inventory.lowStockCount > 0}
          />
        )}
        {can(currentUser, "enquiries.view") && (
          <OverviewKpi
            icon={PhoneCall}
            label="Today calls"
            value={String(dashboard.enquiries.todayFollowups)}
            hint={dashboard.enquiries.todayFollowups > 0 ? "Follow-ups due today" : "No calls today"}
            tone="green"
          />
        )}
      </section>

      <section>
        <h2 className="section-title">Your Workspaces</h2>
        <div className="module-card-grid">
          {canAny(currentUser, modulePermissions.billing) && <WorkspaceCard
            title="Billing"
            subtitle="Daily counter & billing operations"
            icon={ReceiptText}
            actionLabel="Open billing workspace"
            onClick={() => openModule("billing")}
            stats={[
              { label: "Today revenue", value: formatMoney(dashboard.todayRevenue), icon: Wallet },
              { label: "Pending revenue", value: formatMoney(dashboard.pendingDues), icon: Clock },
              { label: "Open jobs", value: String(dashboard.jobCards.openJobs), icon: ClipboardList }
            ]}
          />}
          {canAny(currentUser, modulePermissions.stock) && <WorkspaceCard
            title="Stock Management"
            subtitle="Manage inventory & stock levels"
            icon={Package}
            actionLabel="Open stock workspace"
            onClick={() => openModule("stock")}
            stats={[
              { label: "Stock value", value: formatMoney(inventory.totalStockValue), icon: Package },
              { label: "Low stock", value: String(inventory.lowStockCount), icon: FileText, warn: inventory.lowStockCount > 0 },
              { label: "Expiring", value: String(inventory.expiringCount), icon: ClipboardList }
            ]}
          />}
          {canAny(currentUser, modulePermissions.enquiries) && <WorkspaceCard
            title="Customer Enquiries"
            subtitle="Leads & customer follow-ups"
            icon={PhoneCall}
            actionLabel="Open enquiry workspace"
            onClick={() => openModule("enquiries")}
            stats={[
              { label: "Today calls", value: String(dashboard.enquiries.todayFollowups), icon: PhoneCall },
              { label: "Overdue", value: String(dashboard.enquiries.overdueFollowups), icon: Clock, warn: dashboard.enquiries.overdueFollowups > 0 },
              { label: "New leads", value: String(dashboard.enquiries.newEnquiries), icon: Users }
            ]}
          />}
        </div>
      </section>

      <div className="quick-activity-grid">
        <section className="quick-actions-panel">
          <h2>Quick Actions</h2>
          <div className="quick-action-grid">
            {can(currentUser, "billing.create") && <button className="quick-action" onClick={() => openModule("billing")}>
              <PlusCircle size={28} />
              <span>Create Bill</span>
            </button>}
            {can(currentUser, "jobCards.view") && <button className="quick-action" onClick={openJobCards}>
              <ClipboardList size={28} />
              <span>Job Card</span>
            </button>}
            {can(currentUser, "stock.purchase") && <button className="quick-action" onClick={openAddStock}>
              <Package size={28} />
              <span>Add Stock</span>
            </button>}
            {can(currentUser, "enquiries.manage") && <button className="quick-action" onClick={startNewEnquiry}>
              <Users size={28} />
              <span>Add Lead</span>
            </button>}
            {can(currentUser, "reports.view") && <button className="quick-action" onClick={openBillingReports}>
              <BarChart3 size={28} />
              <span>View Reports</span>
            </button>}
          </div>
        </section>

        <section className="activity-panel">
          <div className="activity-heading">
            <h2>Activity Overview</h2>
            <span>This Week</span>
          </div>
          <div className="activity-body">
            <SalesActivityChart points={weeklySales} />
            <div className="chart-summary">
              <div>
                <strong>{formatMoney(weeklyTotalSales)}</strong>
                <span>Total Sales</span>
              </div>
              <div>
                <strong>{weeklyBills}</strong>
                <span>Total Bills</span>
              </div>
              <div>
                <strong>{weeklyNewLeads}</strong>
                <span>New Leads</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function OverviewKpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  warn
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: "green" | "gold" | "blue" | "purple";
  warn?: boolean;
}) {
  return (
    <div className="overview-kpi">
      <div className={`overview-kpi-icon ${tone}`}>
        <Icon size={24} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em className={warn ? "warn" : ""}>{hint}</em>
      </div>
    </div>
  );
}

function WorkspaceCard({
  title,
  subtitle,
  icon: Icon,
  stats,
  actionLabel,
  onClick
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  stats: Array<{ label: string; value: string; icon: LucideIcon; warn?: boolean }>;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="module-card" onClick={onClick}>
      <div className="module-card-heading">
        <div className="module-card-icon">
          <Icon size={28} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="module-stat-grid">
        {stats.map((stat) => {
          const StatIcon = stat.icon;
          return (
            <div key={stat.label}>
              <span><StatIcon size={15} />{stat.label}</span>
              <strong className={stat.warn ? "warn" : ""}>{stat.value}</strong>
            </div>
          );
        })}
      </div>
      <span className="module-action-label">
        {actionLabel}
        <ArrowRight size={18} />
      </span>
    </button>
  );
}

function SalesActivityChart({ points }: { points: WeeklySalesPoint[] }) {
  const width = 720;
  const height = 210;
  const paddingX = 32;
  const top = 18;
  const baseY = 162;
  const maxSales = Math.max(1, ...points.map((point) => point.sales));
  const coordinates = points.map((point, index) => {
    const x = paddingX + (index * (width - paddingX * 2)) / Math.max(1, points.length - 1);
    const y = baseY - (point.sales / maxSales) * (baseY - top);
    return { ...point, x, y };
  });
  const linePath = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const firstCoordinate = coordinates[0];
  const lastCoordinate = coordinates[coordinates.length - 1];
  const areaPath = firstCoordinate && lastCoordinate
    ? `${linePath} L ${lastCoordinate.x} ${baseY} L ${firstCoordinate.x} ${baseY} Z`
    : "";
  const gridValues = [0, 0.33, 0.66, 1];

  return (
    <div className="activity-chart-wrap">
      <svg className="activity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Last seven days paid sales">
        {gridValues.map((value) => {
          const y = baseY - value * (baseY - top);
          const labelValue = money(maxSales * value);
          return (
            <g key={value}>
              <line x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
              <text x={0} y={y + 4}>{labelValue >= 1000 ? `${Math.round(labelValue / 1000)}K` : Math.round(labelValue)}</text>
            </g>
          );
        })}
        {areaPath && <path className="chart-area" d={areaPath} />}
        {linePath && <path className="chart-line" d={linePath} />}
        {coordinates.map((point) => (
          <g key={point.date}>
            <circle cx={point.x} cy={point.y} r={4.5} />
            <text className="chart-day" x={point.x} y={195}>{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
