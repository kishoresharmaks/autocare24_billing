import { cleanBaseUrl } from "../utils/format";
import { ensureCloudApiTransportSecurity, getLastTlsPinningFailureHost } from "./transportSecurity";
import type {
  ApiEnvelope,
  BusinessSettings,
  ChangePasswordInput,
  Customer,
  CloudDeviceSummary,
  DashboardData,
  DeviceApprovalStatusResult,
  DeviceRegistrationResult,
  DevicesListResult,
  InvoiceAppendItemInput,
  InvoiceCancelInput,
  InvoiceCreateInput,
  InventoryDashboardData,
  InvoiceDetail,
  InvoicePaymentInput,
  InvoiceSummary,
  LoginResult,
  PurchaseRecord,
  ProfitReportData,
  ReportDateFilter,
  ReportData,
  ServiceItem,
  Supplier,
  Vehicle
} from "../types/cloud";

const BUSINESS_SETTINGS_RECORD_ID = "00000000-0000-4000-8000-000000000001";

export class CloudApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  token?: string;
  userToken?: string;
  body?: Record<string, unknown>;
};

type CloudRecordsResponse<T> = {
  entity: string;
  records: Array<{ recordId: string; data: T; revision: number }>;
  items: T[];
};

async function request<T>(cloudUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = cleanBaseUrl(cloudUrl);
  try {
    await ensureCloudApiTransportSecurity(baseUrl);
  } catch (error) {
    throw new CloudApiError(
      error instanceof Error ? error.message : "Cloud API transport security check failed.",
      "transport_security_error",
      0
    );
  }

  const url = `${baseUrl}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.userToken ? { "x-autocare-user-token": options.userToken } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    const pinnedHost = getLastTlsPinningFailureHost();
    if (pinnedHost) {
      throw new CloudApiError(`Secure connection blocked. TLS certificate pinning failed for ${pinnedHost}.`, "tls_pinning_failed", 0);
    }
    throw new CloudApiError("Cloud API is not reachable. Check internet connection and cloud URL.", "network_error", 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new CloudApiError(
      payload.error?.message || `Cloud request failed with status ${response.status}.`,
      payload.error?.code || "request_failed",
      response.status
    );
  }

  if (!payload.data) {
    throw new CloudApiError("Cloud response did not include data.", "empty_response", response.status);
  }
  return payload.data;
}

export async function checkHealth(cloudUrl: string): Promise<void> {
  await request<Record<string, unknown>>(cloudUrl, "/api/v1/health");
}

export async function registerDevice(
  cloudUrl: string,
  input: {
    deviceId: string;
    deviceCode: string;
    deviceName: string;
    registrationKey: string;
  }
): Promise<DeviceRegistrationResult> {
  return request<DeviceRegistrationResult>(cloudUrl, "/api/v1/auth/devices", {
    method: "POST",
    body: input
  });
}

export async function checkDeviceApproval(cloudUrl: string, token: string): Promise<DeviceApprovalStatusResult> {
  return request<DeviceApprovalStatusResult>(cloudUrl, "/api/v1/auth/devices/current/status", { token });
}

export async function loginUser(cloudUrl: string, token: string, username: string, password: string): Promise<LoginResult> {
  return request<LoginResult>(cloudUrl, "/api/v1/auth/login", {
    method: "POST",
    token,
    body: { username, password }
  });
}

export const loginOwner = loginUser;

export async function changeUserPassword(cloudUrl: string, token: string, userToken: string, input: ChangePasswordInput): Promise<void> {
  await request<{ ok: true }>(cloudUrl, `/api/v1/users/${encodeURIComponent(input.userId)}/change-password`, {
    method: "POST",
    token,
    userToken,
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword
    }
  });
}

function reportFilterPath(endpoint: "reports" | "profit", filter: ReportDateFilter): string {
  if (typeof filter === "string") {
    if (filter === "month") {
      return reportFilterPath(endpoint, currentMonthReportFilter());
    }
    return `/api/v1/${endpoint}?preset=${encodeURIComponent(filter)}`;
  }
  const payload = {
    preset: filter.preset || "",
    fromDate: filter.fromDate || "",
    toDate: filter.toDate || ""
  };
  return `/api/v1/${endpoint}?filterJson=${encodeURIComponent(JSON.stringify(payload))}`;
}

function currentMonthReportFilter() {
  const now = new Date();
  return {
    preset: "" as const,
    fromDate: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: toIsoDate(now)
  };
}

function toIsoDate(date: Date) {
  const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return normalized.toISOString().slice(0, 10);
}

export async function fetchReport(cloudUrl: string, token: string, userToken: string, filter: ReportDateFilter): Promise<ReportData> {
  const data = await request<{ report: ReportData }>(cloudUrl, reportFilterPath("reports", filter), { token, userToken });
  return data.report;
}

export async function fetchProfit(cloudUrl: string, token: string, userToken: string, filter: ReportDateFilter): Promise<ProfitReportData> {
  const data = await request<{ profit: ProfitReportData }>(cloudUrl, reportFilterPath("profit", filter), { token, userToken });
  return data.profit;
}

export async function fetchInventoryDashboard(cloudUrl: string, token: string, userToken: string): Promise<InventoryDashboardData> {
  const data = await request<{ dashboard: InventoryDashboardData }>(cloudUrl, "/api/v1/inventory/dashboard", { token, userToken });
  return data.dashboard;
}

export async function fetchDashboard(cloudUrl: string, token: string, userToken: string): Promise<DashboardData> {
  const data = await request<{ dashboard: DashboardData }>(cloudUrl, "/api/v1/dashboard", { token, userToken });
  return data.dashboard;
}

async function fetchCloudRecords<T>(cloudUrl: string, token: string, userToken: string, entity: string, includeInactive = false): Promise<T[]> {
  const params = includeInactive ? "?includeInactive=true" : "";
  const data = await request<CloudRecordsResponse<T>>(cloudUrl, `/api/v1/records/${encodeURIComponent(entity)}${params}`, { token, userToken });
  return data.items || [];
}

export async function fetchSuppliers(cloudUrl: string, token: string, userToken: string): Promise<Supplier[]> {
  const suppliers = await fetchCloudRecords<Supplier>(cloudUrl, token, userToken, "suppliers");
  return suppliers.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export async function fetchPurchaseRecords(cloudUrl: string, token: string, userToken: string): Promise<PurchaseRecord[]> {
  const records = await fetchCloudRecords<PurchaseRecord>(cloudUrl, token, userToken, "purchase_records", true);
  return records.sort(
    (left, right) =>
      String(right.purchaseDate || right.createdAt || "").localeCompare(String(left.purchaseDate || left.createdAt || "")) ||
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  );
}

export async function fetchBusinessSettings(cloudUrl: string, token: string, userToken: string): Promise<BusinessSettings> {
  const settings = await fetchCloudRecords<BusinessSettings>(cloudUrl, token, userToken, "settings", true);
  return settings.find((row) => row.id === BUSINESS_SETTINGS_RECORD_ID) || settings[0] || {};
}

export async function fetchCustomers(cloudUrl: string, token: string, userToken: string): Promise<Customer[]> {
  const customers = await fetchCloudRecords<Customer>(cloudUrl, token, userToken, "customers");
  return customers.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export async function fetchVehicles(cloudUrl: string, token: string, userToken: string): Promise<Vehicle[]> {
  const vehicles = await fetchCloudRecords<Vehicle>(cloudUrl, token, userToken, "vehicles");
  return vehicles.sort((left, right) => String(left.registrationNumber || "").localeCompare(String(right.registrationNumber || "")));
}

export async function fetchServices(cloudUrl: string, token: string, userToken: string): Promise<ServiceItem[]> {
  const services = await fetchCloudRecords<ServiceItem>(cloudUrl, token, userToken, "services");
  return services
    .filter((service) => service.active !== false)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export async function fetchInvoices(cloudUrl: string, token: string, userToken: string, query: string): Promise<InvoiceSummary[]> {
  const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const data = await request<{ invoices: InvoiceSummary[] }>(cloudUrl, `/api/v1/invoices${params}`, { token, userToken });
  return data.invoices;
}

export async function fetchInvoice(cloudUrl: string, token: string, userToken: string, invoiceId: string): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, `/api/v1/invoices/${encodeURIComponent(invoiceId)}`, { token, userToken });
  return data.invoice;
}

export async function createInvoice(cloudUrl: string, token: string, userToken: string, input: InvoiceCreateInput): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, "/api/v1/invoices/finalize", {
    method: "POST",
    token,
    userToken,
    body: {
      idempotencyKey: `mobile-invoice:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      source: "mobile",
      payload: input
    }
  });
  return data.invoice;
}

export async function recordInvoicePayment(cloudUrl: string, token: string, userToken: string, input: InvoicePaymentInput): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, `/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/payments`, {
    method: "POST",
    token,
    userToken,
    body: {
      amount: input.amount,
      mode: input.mode,
      reference: input.reference,
      paymentDate: input.paymentDate
    }
  });
  return data.invoice;
}

export async function appendInvoiceItem(cloudUrl: string, token: string, userToken: string, input: InvoiceAppendItemInput): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, `/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/items`, {
    method: "POST",
    token,
    userToken,
    body: { item: input.item }
  });
  return data.invoice;
}

export async function cancelInvoice(cloudUrl: string, token: string, userToken: string, input: InvoiceCancelInput): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, `/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/cancel`, {
    method: "POST",
    token,
    userToken,
    body: { reason: input.reason }
  });
  return data.invoice;
}

export async function fetchDevices(
  cloudUrl: string,
  token: string,
  userToken: string
): Promise<DevicesListResult> {
  return request<DevicesListResult>(cloudUrl, "/api/v1/admin/devices/list", {
    method: "POST",
    token,
    userToken
  });
}

export async function approveDevice(
  cloudUrl: string,
  token: string,
  deviceId: string,
  userToken: string
): Promise<CloudDeviceSummary> {
  const data = await request<{ device: CloudDeviceSummary }>(
    cloudUrl,
    `/api/v1/admin/devices/${encodeURIComponent(deviceId)}/approve`,
    {
      method: "POST",
      token,
      userToken
    }
  );
  return data.device;
}

export async function revokeDevice(
  cloudUrl: string,
  token: string,
  deviceId: string,
  userToken: string
): Promise<CloudDeviceSummary> {
  const data = await request<{ device: CloudDeviceSummary }>(
    cloudUrl,
    `/api/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`,
    {
      method: "POST",
      token,
      userToken
    }
  );
  return data.device;
}

export function summarizeDeviceStatus(devices: CloudDeviceSummary[]) {
  return devices.reduce(
    (summary, device) => {
      if (!isVisibleCloudDevice(device)) return summary;
      summary.total += 1;
      if (device.approvalStatus === "APPROVED" && !device.isRevoked) summary.approved += 1;
      if (device.approvalStatus === "PENDING") summary.pending += 1;
      return summary;
    },
    { total: 0, approved: 0, pending: 0 }
  );
}

export function isVisibleCloudDevice(device: CloudDeviceSummary) {
  return device.approvalStatus !== "REVOKED" && !device.isRevoked;
}
