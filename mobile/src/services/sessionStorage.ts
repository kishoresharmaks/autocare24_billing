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
  authUser: "autocare24.authUser",
  userToken: "autocare24.userToken",
  userTokenExpiresAt: "autocare24.userTokenExpiresAt",
  ownerUser: "autocare24.ownerUser",
  ownerUsername: "autocare24.ownerUsername",
  ownerPassword: "autocare24.ownerPassword"
} as const;

export interface StoredSession {
  cloudUrl: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  token: string;
  approvalStatus: string;
  authUser: CloudUser | null;
  userToken: string;
  userTokenExpiresAt: string;
  legacyOwnerCredentials: { username: string; password: string } | null;
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
  const [
    cloudUrl,
    token,
    approvalStatus,
    authUserJson,
    userToken,
    userTokenExpiresAt,
    legacyOwnerUserJson,
    legacyOwnerUsername,
    legacyOwnerPassword,
    deviceId,
    deviceCode,
    deviceName
  ] = await Promise.all([
    SecureStore.getItemAsync(keys.cloudUrl),
    SecureStore.getItemAsync(keys.token),
    SecureStore.getItemAsync(keys.approvalStatus),
    SecureStore.getItemAsync(keys.authUser),
    SecureStore.getItemAsync(keys.userToken),
    SecureStore.getItemAsync(keys.userTokenExpiresAt),
    SecureStore.getItemAsync(keys.ownerUser),
    SecureStore.getItemAsync(keys.ownerUsername),
    SecureStore.getItemAsync(keys.ownerPassword),
    getOrCreateDeviceId(),
    getOrCreateDeviceCode(),
    getOrCreateDeviceName()
  ]);

  const authUser = parseStoredUser(authUserJson) || parseStoredUser(legacyOwnerUserJson);
  const legacyOwnerCredentials =
    legacyOwnerUsername && legacyOwnerPassword
      ? {
          username: legacyOwnerUsername,
          password: legacyOwnerPassword
        }
      : null;

  return {
    cloudUrl: cloudUrl || "https://sync.autocare24.in",
    deviceId,
    deviceCode,
    deviceName,
    token: token || "",
    approvalStatus: approvalStatus || "",
    authUser,
    userToken: userToken || "",
    userTokenExpiresAt: userTokenExpiresAt || "",
    legacyOwnerCredentials
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

export async function saveUserSession(input: { user: CloudUser; userToken: string; expiresAt?: string }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(keys.authUser, JSON.stringify(input.user)),
    SecureStore.setItemAsync(keys.userToken, input.userToken),
    SecureStore.setItemAsync(keys.userTokenExpiresAt, input.expiresAt || ""),
    SecureStore.deleteItemAsync(keys.ownerUser),
    SecureStore.deleteItemAsync(keys.ownerUsername),
    SecureStore.deleteItemAsync(keys.ownerPassword)
  ]);
}

export async function clearUserSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(keys.authUser),
    SecureStore.deleteItemAsync(keys.userToken),
    SecureStore.deleteItemAsync(keys.userTokenExpiresAt),
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
    clearUserSession()
  ]);
}

function parseStoredUser(value: string | null): CloudUser | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CloudUser;
    return parsed && parsed.id && parsed.username ? parsed : null;
  } catch {
    return null;
  }
}
