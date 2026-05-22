import NetInfo from "@react-native-community/netinfo";
import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  checkDeviceApproval,
  checkHealth,
  loginUser as loginUserRequest,
  registerDevice as registerDeviceRequest
} from "../services/cloudApi";
import { clearConnection, clearUserSession, loadStoredSession, saveApprovalStatus, saveConnection, saveUserSession } from "../services/sessionStorage";
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
  userToken: string;
  userTokenExpiresAt: string;
  isOnline: boolean;
  lastError: string;
  registerDevice: (input: { cloudUrl: string; deviceName: string; registrationKey: string }) => Promise<void>;
  refreshApproval: () => Promise<void>;
  loginUser: (input: OwnerCredentials) => Promise<CloudUser>;
  logoutUser: () => Promise<void>;
  loginOwner: (input: OwnerCredentials) => Promise<CloudUser>;
  logoutOwner: () => Promise<void>;
  clearLocalConnection: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const STARTUP_SPLASH_MIN_MS = 5000;
const isUserTokenFresh = (expiresAt: string) => {
  if (!expiresAt) return true;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time > Date.now() + 60_000;
};

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
  const [userToken, setUserToken] = useState("");
  const [userTokenExpiresAt, setUserTokenExpiresAt] = useState("");
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
    let splashTimer: ReturnType<typeof setTimeout>;
    const minimumSplashTime = new Promise<void>((resolve) => {
      splashTimer = setTimeout(resolve, STARTUP_SPLASH_MIN_MS);
    });
    const storedSession = loadStoredSession()
      .then(async (stored) => {
        if (!active) return;
        setCloudUrl(stored.cloudUrl);
        setDeviceId(stored.deviceId);
        setDeviceCode(stored.deviceCode);
        setDeviceName(stored.deviceName);
        setToken(stored.token);
        setApprovalStatus(stored.approvalStatus as CloudDeviceApprovalStatus | "");
        if (stored.token && stored.approvalStatus === "APPROVED" && stored.authUser && stored.userToken && isUserTokenFresh(stored.userTokenExpiresAt)) {
          setUser(stored.authUser);
          setUserToken(stored.userToken);
          setUserTokenExpiresAt(stored.userTokenExpiresAt);
          return;
        }
        if (stored.userToken && !isUserTokenFresh(stored.userTokenExpiresAt)) {
          await clearUserSession();
        }
        if (stored.token && stored.approvalStatus === "APPROVED" && stored.authUser && stored.legacyOwnerCredentials) {
          const result = await loginUserRequest(stored.cloudUrl, stored.token, stored.legacyOwnerCredentials.username, stored.legacyOwnerCredentials.password);
          await saveUserSession({ user: result.user, userToken: result.userToken, expiresAt: result.expiresAt });
          if (!active) return;
          setUser(result.user);
          setUserToken(result.userToken);
          setUserTokenExpiresAt(result.expiresAt || "");
        }
      })
      .catch((error: Error) => {
        if (active) setLastError(error.message || "Unable to load saved mobile session.");
      });

    Promise.allSettled([storedSession, minimumSplashTime]).finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
      clearTimeout(splashTimer);
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
      await clearUserSession();
      setCloudUrl(normalizedUrl);
      setDeviceName(input.deviceName.trim() || deviceName);
      setToken(result.token);
      setApprovalStatus(result.approvalStatus);
      setDevice(result.device);
      setUser(null);
      setUserToken("");
      setUserTokenExpiresAt("");
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
      await clearUserSession();
      setUser(null);
      setUserToken("");
      setUserTokenExpiresAt("");
    }
  }, [cloudUrl, token]);

  const loginUser = useCallback(
    async (input: OwnerCredentials) => {
      setLastError("");
      if (!token || approvalStatus !== "APPROVED") {
        throw new Error("This phone must be approved before user login.");
      }
      const result = await loginUserRequest(cloudUrl, token, input.username.trim(), input.password);
      await saveUserSession({ user: result.user, userToken: result.userToken, expiresAt: result.expiresAt });
      setUser(result.user);
      setUserToken(result.userToken);
      setUserTokenExpiresAt(result.expiresAt || "");
      return result.user;
    },
    [approvalStatus, cloudUrl, token]
  );

  const logoutUser = useCallback(async () => {
    await clearUserSession();
    setUser(null);
    setUserToken("");
    setUserTokenExpiresAt("");
  }, []);

  const clearLocalConnection = useCallback(async () => {
    await clearConnection();
    setToken("");
    setApprovalStatus("");
    setDevice(null);
    setUser(null);
    setUserToken("");
    setUserTokenExpiresAt("");
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
      userToken,
      userTokenExpiresAt,
      isOnline,
      lastError,
      registerDevice,
      refreshApproval,
      loginUser,
      logoutUser,
      loginOwner: loginUser,
      logoutOwner: logoutUser,
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
      loginUser,
      logoutUser,
      refreshApproval,
      registerDevice,
      token,
      user,
      userToken,
      userTokenExpiresAt
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
