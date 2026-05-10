import {
  addSslPinningErrorListener,
  initializeSslPinning,
  isSslPinningAvailable,
  type PinningOptions
} from "react-native-ssl-public-key-pinning";
import { cleanBaseUrl } from "../utils/format";

const DEFAULT_PINNED_HOST = "sync.autocare24.in";
const PUBLIC_KEY_HASH_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

type PinningConfig = {
  host: string;
  includeSubdomains: boolean;
  publicKeyHashes: string[];
  expirationDate?: string;
};

let initializationPromise: Promise<void> | null = null;
let listenerAttached = false;
let lastPinningFailureHost = "";

const envValue = (name: string) => process.env[name]?.trim() || "";

const isDevRuntime = () => typeof __DEV__ !== "undefined" && __DEV__;

const allowsUnpinnedDevelopmentTls = () => isDevRuntime() && envValue("EXPO_PUBLIC_ALLOW_UNPINNED_TLS") !== "0";

const parseBooleanEnv = (value: string) => ["1", "true", "yes", "on"].includes(value.toLowerCase());

const parsePublicKeyHashes = (value: string) =>
  value
    .split(",")
    .map((hash) => hash.trim())
    .filter(Boolean);

const getPinningConfig = (): PinningConfig => ({
  host: (envValue("EXPO_PUBLIC_CLOUD_API_PINNED_HOST") || DEFAULT_PINNED_HOST).toLowerCase(),
  includeSubdomains: parseBooleanEnv(envValue("EXPO_PUBLIC_CLOUD_API_PIN_INCLUDE_SUBDOMAINS")),
  publicKeyHashes: parsePublicKeyHashes(envValue("EXPO_PUBLIC_CLOUD_API_PUBLIC_KEY_HASHES")),
  expirationDate: envValue("EXPO_PUBLIC_CLOUD_API_PIN_EXPIRATION") || undefined
});

const hostMatchesPinningConfig = (hostname: string, config: PinningConfig) =>
  hostname === config.host || (config.includeSubdomains && hostname.endsWith(`.${config.host}`));

const validatePinningConfig = (config: PinningConfig) => {
  if (!config.host) {
    throw new Error("Cloud API TLS pinning host is not configured.");
  }
  if (config.publicKeyHashes.length < 2) {
    throw new Error("Cloud API TLS pinning requires at least two public key hashes.");
  }
  const invalidHash = config.publicKeyHashes.find((hash) => !PUBLIC_KEY_HASH_PATTERN.test(hash));
  if (invalidHash) {
    throw new Error(`Cloud API TLS pin hash is not a valid SHA-256 base64 value: ${invalidHash}`);
  }
};

const attachPinningFailureListener = () => {
  if (listenerAttached || !isSslPinningAvailable()) return;
  addSslPinningErrorListener((error) => {
    lastPinningFailureHost = error.serverHostname || "";
  });
  listenerAttached = true;
};

const initializeCloudApiPinning = async (config: PinningConfig) => {
  validatePinningConfig(config);
  if (!isSslPinningAvailable()) {
    throw new Error("TLS certificate pinning is not available in this build. Rebuild the Expo app with native modules.");
  }
  if (!initializationPromise) {
    const options: PinningOptions = {
      [config.host]: {
        includeSubdomains: config.includeSubdomains,
        publicKeyHashes: config.publicKeyHashes,
        ...(config.expirationDate ? { expirationDate: config.expirationDate } : {})
      }
    };
    initializationPromise = initializeSslPinning(options).then(() => {
      attachPinningFailureListener();
    });
  }
  await initializationPromise;
};

export async function ensureCloudApiTransportSecurity(cloudUrl: string) {
  const normalizedUrl = cleanBaseUrl(cloudUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("Cloud API URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Cloud API URL must use HTTPS.");
  }

  const config = getPinningConfig();
  const hostname = parsed.hostname.toLowerCase();
  if (!hostMatchesPinningConfig(hostname, config)) {
    if (allowsUnpinnedDevelopmentTls()) return;
    throw new Error(`Cloud API host ${hostname} is not configured for TLS certificate pinning.`);
  }

  try {
    await initializeCloudApiPinning(config);
  } catch (error) {
    if (allowsUnpinnedDevelopmentTls()) return;
    throw error;
  }
}

export function getLastTlsPinningFailureHost() {
  return lastPinningFailureHost;
}
