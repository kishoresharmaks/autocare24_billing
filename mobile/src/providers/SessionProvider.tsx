import NetInfo from "@react-native-community/netinfo";
import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  checkDeviceApproval,
  checkHealth,
  loginOwner as loginOwnerRequest,
  registerDevice as registerDeviceRequest
} from "../services/cloudApi";
import { clearConnection, loadStoredSession, saveApprovalStatus, saveConnection } from "../services/sessionStorage";
import type { CloudDeviceApprovalStatus, CloudDeviceSummary, CloudUser } from "../types/cloud";
import { cleanBaseUrl } from "../utils/format";

type OwnerCredentials = {
  username: string;
  password: string;
};

interface SessionState {
  booting: boolean;
  cloudUrl: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  token: string;
  approvalStatus: CloudDeviceApprovalStatus | "";
  device: CloudDeviceSummary | null;
  user: CloudUser | null;
  ownerCredentials: OwnerCredentials | null;
  isOnline: boolean;
  lastError: string;
  registerDevice: (input: { cloudUrl: string; deviceName: string; registrationKey: string }) => Promise<void>;
  refreshApproval: () => Promise<void>;
  loginOwner: (input: OwnerCredentials) => Promise<void>;
  logoutOwner: () => void;
  clearLocalConnection: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [booting, setBooting] = useState(true);
  const [cloudUrl, setCloudUrl] = useState("https://sync.autocare24.in");
  const [deviceId, setDeviceId] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [token, setToken] = useState("");
  const [approvalStatus, setApprovalStatus] = useState<CloudDeviceApprovalStatus | "">("");
  const [device, setDevice] = useState<CloudDeviceSummary | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [ownerCredentials, setOwnerCredentials] = useState<OwnerCredentials | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastError, setLastError] = useState("");

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
      setIsOnline(Boolean(state.isConnected));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    loadStoredSession()
      .then((stored) => {
        if (!active) return;
        setCloudUrl(stored.cloudUrl);
        setDeviceId(stored.deviceId);
        setDeviceCode(stored.deviceCode);
        setDeviceName(stored.deviceName);
        setToken(stored.token);
        setApprovalStatus(stored.approvalStatus as CloudDeviceApprovalStatus | "");
      })
      .catch((error: Error) => {
        if (active) setLastError(error.message || "Unable to load saved mobile session.");
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const registerDevice = useCallback(
    async (input: { cloudUrl: string; deviceName: string; registrationKey: string }) => {
      setLastError("");
      const normalizedUrl = cleanBaseUrl(input.cloudUrl);
      if (!normalizedUrl.startsWith("https://")) {
        throw new Error("Cloud API URL must start with https://");
      }
      if (!input.registrationKey.trim()) {
        throw new Error("Registration key is required.");
      }

      await checkHealth(normalizedUrl);
      const result = await registerDeviceRequest(normalizedUrl, {
        deviceId,
        deviceCode,
        deviceName: input.deviceName.trim() || deviceName,
        registrationKey: input.registrationKey.trim()
      });

      await saveConnection({
        cloudUrl: normalizedUrl,
        deviceName: input.deviceName.trim() || deviceName,
        token: result.token,
        approvalStatus: result.approvalStatus
      });
      setCloudUrl(normalizedUrl);
      setDeviceName(input.deviceName.trim() || deviceName);
      setToken(result.token);
      setApprovalStatus(result.approvalStatus);
      setDevice(result.device);
      setUser(null);
      setOwnerCredentials(null);
    },
    [deviceCode, deviceId, deviceName]
  );

  const refreshApproval = useCallback(async () => {
    setLastError("");
    if (!token) {
      throw new Error("This phone has not requested cloud access yet.");
    }
    const result = await checkDeviceApproval(cloudUrl, token);
    await saveApprovalStatus(result.approvalStatus);
    setApprovalStatus(result.approvalStatus);
    setDevice(result.device);
    if (result.revoked) {
      setUser(null);
      setOwnerCredentials(null);
    }
  }, [cloudUrl, token]);

  const loginOwner = useCallback(
    async (input: OwnerCredentials) => {
      setLastError("");
      if (!token || approvalStatus !== "APPROVED") {
        throw new Error("This phone must be approved before owner login.");
      }
      const result = await loginOwnerRequest(cloudUrl, token, input.username.trim(), input.password);
      if (result.user.role !== "owner") {
        throw new Error("Only owner accounts can use this mobile reports app.");
      }
      setUser(result.user);
      setOwnerCredentials({ username: input.username.trim(), password: input.password });
    },
    [approvalStatus, cloudUrl, token]
  );

  const logoutOwner = useCallback(() => {
    setUser(null);
    setOwnerCredentials(null);
  }, []);

  const clearLocalConnection = useCallback(async () => {
    await clearConnection();
    setToken("");
    setApprovalStatus("");
    setDevice(null);
    setUser(null);
    setOwnerCredentials(null);
    setLastError("");
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      booting,
      cloudUrl,
      deviceId,
      deviceCode,
      deviceName,
      token,
      approvalStatus,
      device,
      user,
      ownerCredentials,
      isOnline,
      lastError,
      registerDevice,
      refreshApproval,
      loginOwner,
      logoutOwner,
      clearLocalConnection
    }),
    [
      approvalStatus,
      booting,
      clearLocalConnection,
      cloudUrl,
      device,
      deviceCode,
      deviceId,
      deviceName,
      isOnline,
      lastError,
      loginOwner,
      logoutOwner,
      ownerCredentials,
      refreshApproval,
      registerDevice,
      token,
      user
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider.");
  }
  return context;
}
