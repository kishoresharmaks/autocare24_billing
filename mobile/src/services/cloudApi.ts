import { cleanBaseUrl } from "../utils/format";
import { ensureCloudApiTransportSecurity, getLastTlsPinningFailureHost } from "./transportSecurity";
import type {
  ApiEnvelope,
  CloudDeviceSummary,
  DateRangePreset,
  DeviceApprovalStatusResult,
  DeviceRegistrationResult,
  DevicesListResult,
  InventoryDashboardData,
  InvoiceDetail,
  InvoiceSummary,
  LoginResult,
  PurchaseRecord,
  ProfitReportData,
  ReportDateFilter,
  ReportData,
  Supplier
} from "../types/cloud";

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
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
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

export async function loginOwner(cloudUrl: string, token: string, username: string, password: string): Promise<LoginResult> {
  return request<LoginResult>(cloudUrl, "/api/v1/auth/login", {
    method: "POST",
    token,
    body: { username, password }
  });
}

function reportFilterPath(filter: ReportDateFilter): string {
  if (typeof filter === "string") {
    return `/api/v1/reports?preset=${encodeURIComponent(filter)}`;
  }
  const payload = {
    preset: filter.preset || "",
    fromDate: filter.fromDate || "",
    toDate: filter.toDate || ""
  };
  return `/api/v1/reports?filterJson=${encodeURIComponent(JSON.stringify(payload))}`;
}

export async function fetchReport(cloudUrl: string, token: string, filter: ReportDateFilter): Promise<ReportData> {
  const data = await request<{ report: ReportData }>(cloudUrl, reportFilterPath(filter), { token });
  return data.report;
}

export async function fetchProfit(cloudUrl: string, token: string, preset: DateRangePreset): Promise<ProfitReportData> {
  const data = await request<{ profit: ProfitReportData }>(cloudUrl, `/api/v1/profit?preset=${encodeURIComponent(preset)}`, { token });
  return data.profit;
}

export async function fetchInventoryDashboard(cloudUrl: string, token: string): Promise<InventoryDashboardData> {
  const data = await request<{ dashboard: InventoryDashboardData }>(cloudUrl, "/api/v1/inventory/dashboard", { token });
  return data.dashboard;
}

async function fetchCloudRecords<T>(cloudUrl: string, token: string, entity: string, includeInactive = false): Promise<T[]> {
  const params = includeInactive ? "?includeInactive=true" : "";
  const data = await request<CloudRecordsResponse<T>>(cloudUrl, `/api/v1/records/${encodeURIComponent(entity)}${params}`, { token });
  return data.items || [];
}

export async function fetchSuppliers(cloudUrl: string, token: string): Promise<Supplier[]> {
  const suppliers = await fetchCloudRecords<Supplier>(cloudUrl, token, "suppliers");
  return suppliers.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export async function fetchPurchaseRecords(cloudUrl: string, token: string): Promise<PurchaseRecord[]> {
  const records = await fetchCloudRecords<PurchaseRecord>(cloudUrl, token, "purchase_records", true);
  return records.sort(
    (left, right) =>
      String(right.purchaseDate || right.createdAt || "").localeCompare(String(left.purchaseDate || left.createdAt || "")) ||
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  );
}

export async function fetchInvoices(cloudUrl: string, token: string, query: string): Promise<InvoiceSummary[]> {
  const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const data = await request<{ invoices: InvoiceSummary[] }>(cloudUrl, `/api/v1/invoices${params}`, { token });
  return data.invoices;
}

export async function fetchInvoice(cloudUrl: string, token: string, invoiceId: string): Promise<InvoiceDetail> {
  const data = await request<{ invoice: InvoiceDetail }>(cloudUrl, `/api/v1/invoices/${encodeURIComponent(invoiceId)}`, { token });
  return data.invoice;
}

export async function fetchDevices(
  cloudUrl: string,
  token: string,
  ownerUsername: string,
  ownerPassword: string
): Promise<DevicesListResult> {
  return request<DevicesListResult>(cloudUrl, "/api/v1/admin/devices/list", {
    method: "POST",
    token,
    body: { ownerUsername, ownerPassword }
  });
}

export async function approveDevice(
  cloudUrl: string,
  token: string,
  deviceId: string,
  ownerUsername: string,
  ownerPassword: string
): Promise<CloudDeviceSummary> {
  const data = await request<{ device: CloudDeviceSummary }>(
    cloudUrl,
    `/api/v1/admin/devices/${encodeURIComponent(deviceId)}/approve`,
    {
      method: "POST",
      token,
      body: { ownerUsername, ownerPassword }
    }
  );
  return data.device;
}

export async function revokeDevice(
  cloudUrl: string,
  token: string,
  deviceId: string,
  ownerUsername: string,
  ownerPassword: string
): Promise<CloudDeviceSummary> {
  const data = await request<{ device: CloudDeviceSummary }>(
    cloudUrl,
    `/api/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`,
    {
      method: "POST",
      token,
      body: { ownerUsername, ownerPassword }
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
