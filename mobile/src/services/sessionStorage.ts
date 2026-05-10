import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import type { CloudUser } from "../types/cloud";

const keys = {
  cloudUrl: "autocare24.cloudUrl",
  deviceId: "autocare24.deviceId",
  deviceCode: "autocare24.deviceCode",
  deviceName: "autocare24.deviceName",
  token: "autocare24.deviceToken",
  approvalStatus: "autocare24.approvalStatus",
  ownerUser: "autocare24.ownerUser",
  ownerUsername: "autocare24.ownerUsername",
  ownerPassword: "autocare24.ownerPassword"
} as const;

export interface StoredOwnerCredentials {
  username: string;
  password: string;
}

export interface StoredSession {
  cloudUrl: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  token: string;
  approvalStatus: string;
  ownerUser: CloudUser | null;
  ownerCredentials: StoredOwnerCredentials | null;
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(keys.deviceId);
  if (existing) return existing;
  const next = Crypto.randomUUID();
  await SecureStore.setItemAsync(keys.deviceId, next);
  return next;
}

async function getOrCreateDeviceCode(): Promise<string> {
  const existing = await SecureStore.getItemAsync(keys.deviceCode);
  if (existing) return existing;
  const randomBytes = (await Crypto.getRandomBytesAsync(4)) as Uint8Array;
  const next = Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  await SecureStore.setItemAsync(keys.deviceCode, next);
  return next;
}

async function getOrCreateDeviceName(): Promise<string> {
  const existing = await SecureStore.getItemAsync(keys.deviceName);
  if (existing) return existing;
  const modelName = Device.deviceName || Device.modelName || "Android phone";
  const next = `Autocare24 ${modelName}`.slice(0, 80);
  await SecureStore.setItemAsync(keys.deviceName, next);
  return next;
}

export async function loadStoredSession(): Promise<StoredSession> {
  const [cloudUrl, token, approvalStatus, ownerUserJson, ownerUsername, ownerPassword, deviceId, deviceCode, deviceName] = await Promise.all([
    SecureStore.getItemAsync(keys.cloudUrl),
    SecureStore.getItemAsync(keys.token),
    SecureStore.getItemAsync(keys.approvalStatus),
    SecureStore.getItemAsync(keys.ownerUser),
    SecureStore.getItemAsync(keys.ownerUsername),
    SecureStore.getItemAsync(keys.ownerPassword),
    getOrCreateDeviceId(),
    getOrCreateDeviceCode(),
    getOrCreateDeviceName()
  ]);

  const ownerUser = parseStoredOwnerUser(ownerUserJson);
  const ownerCredentials =
    ownerUsername && ownerPassword
      ? {
          username: ownerUsername,
          password: ownerPassword
        }
      : null;

  return {
    cloudUrl: cloudUrl || "https://sync.autocare24.in",
    deviceId,
    deviceCode,
    deviceName,
    token: token || "",
    approvalStatus: approvalStatus || "",
    ownerUser,
    ownerCredentials
  };
}

export async function saveConnection(input: {
  cloudUrl: string;
  deviceName: string;
  token: string;
  approvalStatus: string;
}): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(keys.cloudUrl, input.cloudUrl),
    SecureStore.setItemAsync(keys.deviceName, input.deviceName),
    SecureStore.setItemAsync(keys.token, input.token),
    SecureStore.setItemAsync(keys.approvalStatus, input.approvalStatus)
  ]);
}

export async function saveApprovalStatus(approvalStatus: string): Promise<void> {
  await SecureStore.setItemAsync(keys.approvalStatus, approvalStatus);
}

export async function saveOwnerSession(input: { user: CloudUser; credentials: StoredOwnerCredentials }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(keys.ownerUser, JSON.stringify(input.user)),
    SecureStore.setItemAsync(keys.ownerUsername, input.credentials.username),
    SecureStore.setItemAsync(keys.ownerPassword, input.credentials.password)
  ]);
}

export async function clearOwnerSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(keys.ownerUser),
    SecureStore.deleteItemAsync(keys.ownerUsername),
    SecureStore.deleteItemAsync(keys.ownerPassword)
  ]);
}

export async function clearConnection(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(keys.cloudUrl),
    SecureStore.deleteItemAsync(keys.token),
    SecureStore.deleteItemAsync(keys.approvalStatus),
    clearOwnerSession()
  ]);
}

function parseStoredOwnerUser(value: string | null): CloudUser | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CloudUser;
    return parsed && parsed.role === "owner" ? parsed : null;
  } catch {
    return null;
  }
}
