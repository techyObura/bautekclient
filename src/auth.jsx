import { CloudCog } from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Bautek authentication adapter.
 * .env:
 *   VITE_API_URL=http://localhost:5000/api/v1
 *   VITE_DEMO_MODE=true   // optional: force browser-only preview
 *
 * When VITE_API_URL is missing, the app starts in offline demonstration mode.
 * When configured, the app uses the API. A network outage can open a clearly
 * labelled local preview, but HTTP authentication/permission failures do NOT
 * silently become an authenticated or privileged session.
 *
 * Demo sessions are never proof of access. The future backend must enforce
 * every permission and verify roles, ownership, payments and admin decisions.
 */
const AuthContext = createContext(null);
const BASE = String(import.meta.env.VITE_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

const FORCE_DEMO = import.meta.env.VITE_DEMO_MODE === "true";
const API_ENABLED = Boolean(BASE) && !FORCE_DEMO;
const SESSION_USER = "bautek_user";
const SESSION_TOKEN = "bautek_access_token";
const SESSION_KIND = "bautek_auth_mode";
const TIMEOUT_MS = 9000;

// The present data.js ROLES array may predate the tenant portal. Keep the new
// role available without requiring changes to data.js at this stage.
export const AUTH_ROLES = Object.freeze([
  "client",
  "contractor",
  "admin",
  "super_admin",
  "tenant",
]);
const isRole = (role) => AUTH_ROLES.includes(role);

export const homeFor = (role) =>
  ({
    client: "/app/client",
    contractor: "/app/contractor",
    admin: "/app/admin",
    super_admin: "/app/super-admin",
    tenant: "/app/tenant",
  })[role] || "/login";

const demoNames = {
  client: "Grace Achieng",
  contractor: "Daniel Otieno",
  admin: "Mercy Wanjiku",
  super_admin: "Bautek Director",
  tenant: "Bautek Demo Tenant",
};

function readSession(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key, value) {
  try {
    if (value === null || value === undefined)
      window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* private browsing or unavailable storage: continue in memory */
  }
}
function savedUser() {
  try {
    const raw = readSession(SESSION_USER);
    const item = raw ? JSON.parse(raw) : null;
    if (!item || !isRole(item.role)) return null;
    const kind = readSession(SESSION_KIND);
    // Do not reuse a local demo identity as an API-authenticated account.
    if (API_ENABLED && kind !== "api") return null;
    if (!API_ENABLED && kind !== "demo") return null;
    return item;
  } catch {
    return null;
  }
}
function responseUser(payload) {
  const u =
    payload?.user || payload?.data?.user || payload?.data?.account || null;
  if (!u || !isRole(u.role)) return null;
  return { ...u, id: u.id ?? u._id };
}
function responseToken(payload) {
  return (
    payload?.accessToken || payload?.data?.accessToken || payload?.token || null
  );
}

/**
 * JSON API helper exported for other application modules.
 * All paths must be rooted at the API base, e.g. request('/auth/login').
 * A failed operation throws. This intentionally NEVER pretends a failed write
 * was completed on the server.
 */
let refreshFlight = null;
async function rawRequest(path, options = {}) {
  if (!API_ENABLED) {
    const err = new Error("API not configured; this is a demo preview.");
    err.code = "DEMO_ONLY";
    throw err;
  }
  const endpoint = `${BASE}/${String(path).replace(/^\/+/, "")}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { headers, body, signal, _retried, ...rest } = options;
  const token = readSession(SESSION_TOKEN);
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    const res = await fetch(endpoint, {
      credentials: "include",
      ...rest,
      body,
      signal: signal || controller.signal,
      headers: {
        ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    const type = res.headers.get("content-type") || "";
    const data =
      res.status === 204
        ? {}
        : type.includes("json")
          ? await res.json().catch(() => ({}))
          : { message: await res.text().catch(() => "") };
    if (!res.ok) {
      const err = new Error(
        data?.message || data?.error || `Request failed (${res.status})`,
      );
      err.status = res.status;
      err.code = "API_HTTP_ERROR";
      throw err;
    }
    return data;
  } catch (error) {
    if (error.code === "API_HTTP_ERROR") throw error;
    const err = new Error(
      error.name === "AbortError"
        ? "Bautek API timed out. Your session has been retained; please retry."
        : "Cannot reach Bautek API. Your session has been retained; please retry.",
    );
    err.code = "API_UNAVAILABLE";
    err.cause = error;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function rotateSession() {
  if (!refreshFlight) {
    refreshFlight = rawRequest("/auth/refresh", { method: "POST" })
      .then((data) => {
        const token = responseToken(data);
        if (token) writeSession(SESSION_TOKEN, token);
        const account = responseUser(data);
        if (account) {
          writeSession(SESSION_USER, JSON.stringify(account));
          window.dispatchEvent(
            new CustomEvent("bautek-session-refreshed", { detail: account }),
          );
        }
        return data;
      })
      .finally(() => {
        refreshFlight = null;
      });
  }
  return refreshFlight;
}

export async function request(path, options = {}) {
  const isAuth =
    /^\/auth\/(login|register|refresh|logout|invitations\/accept)/.test(path);
  try {
    return await rawRequest(path, options);
  } catch (error) {
    if (error.status !== 401 || isAuth || options._retried) throw error;
    try {
      await rotateSession();
    } catch (refreshError) {
      if (refreshError.status === 401 || refreshError.status === 403)
        window.dispatchEvent(new Event("bautek-session-invalid"));
      throw refreshError;
    }
    return rawRequest(path, { ...options, _retried: true });
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(savedUser);
  const [loading, setLoading] = useState(API_ENABLED);
  // A connection failure exposes the preview; a 401/403 does not.
  const [offlinePreview, setOfflinePreview] = useState(!API_ENABLED);
  const [apiError, setApiError] = useState(null);
  const demo = !API_ENABLED || offlinePreview;
  const clear = useCallback(() => {
    setUser(null);
    writeSession(SESSION_USER, null);
    writeSession(SESSION_TOKEN, null);
    writeSession(SESSION_KIND, null);
  }, []);
  const establish = useCallback((account, token = null, kind = "api") => {
    if (!account || !isRole(account.role))
      throw new Error("Unrecognised account role.");
    const normalized = { ...account, id: account.id ?? account._id };
    setUser(normalized);
    writeSession(SESSION_USER, JSON.stringify(normalized));
    writeSession(SESSION_KIND, kind);
    writeSession(SESSION_TOKEN, kind === "api" ? token : null);
    return normalized;
  }, []);
  function getTokenExpiry(token) {
    try {
      const payload = token.split(".")[1];

      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");

      const decoded = JSON.parse(atob(base64));

      return decoded.exp ? decoded.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!API_ENABLED || !user) return;

    let checking = false;
    let active = true;

    const checkSession = async () => {
      if (checking || !active) return;

      const token = sessionStorage.getItem("bautek_access_token");

      const expiry = token ? getTokenExpiry(token) : null;

      // No need to refresh a token that is still valid.
      if (expiry && Date.now() < expiry - 60000) {
        return;
      }

      checking = true;

      try {
        const result = await request("/auth/refresh", {
          method: "POST",
        });

        if (!active) return;

        const account = responseUser(result);
        const newToken = responseToken(result);

        if (!account || !newToken) {
          clear();
          return;
        }

        establish(account, newToken, "api");
      } catch (error) {
        if (!active) return;

        if (error.status === 401 || error.status === 403) {
          // Backend confirms the session is invalid.
          clear();
        } else {
          // Network failure: do not pretend session is valid.
          setApiError("Connection lost. Your session cannot be verified.");
        }
      } finally {
        checking = false;
      }
    };

    void checkSession();

    const interval = setInterval(checkSession, 30000);

    const onFocus = () => void checkSession();

    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id, clear, establish]);

  useEffect(() => {
    if (!API_ENABLED) {
      setLoading(false);
      return;
    }
    let mounted = true;
    const synchronise = (account) => {
      if (!mounted || !account) return;
      setUser(account);
      setApiError(null);
      setOfflinePreview(false);
    };
    const onInvalid = () => {
      if (mounted) clear();
    };
    const onRefresh = (e) => synchronise(e.detail);
    window.addEventListener("bautek-session-refreshed", onRefresh);
    window.addEventListener("bautek-session-invalid", onInvalid);
    const initialise = async () => {
      try {
        // A valid access token survives a page reload without forcing a token rotation.
        // An expired token is refreshed once using the httpOnly refresh cookie.
        const response = readSession(SESSION_TOKEN)
          ? await request("/auth/me")
          : await rotateSession();
        if (!mounted) return;
        const account = responseUser(response);
        if (account)
          establish(
            account,
            responseToken(response) || readSession(SESSION_TOKEN),
          );
        else if (!savedUser()) clear();
        setOfflinePreview(false);
        setApiError(null);
      } catch (error) {
        if (!mounted) return;
        setApiError(error.message);
        if (error.code === "API_UNAVAILABLE") {
          // Preserve the last verified user for page refreshes and show an offline warning.
          // API actions still fail, rather than pretending approval/payment succeeded.
          setOfflinePreview(!savedUser());
        } else if ([401, 403].includes(error.status)) {
          clear();
          setOfflinePreview(false);
        } else {
          setOfflinePreview(false);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void initialise();
    return () => {
      mounted = false;
      window.removeEventListener("bautek-session-refreshed", onRefresh);
      window.removeEventListener("bautek-session-invalid", onInvalid);
    };
  }, [clear, establish]);

  const demoLogin = useCallback(
    (role) => {
      if (!demo)
        throw new Error(
          "Demo role switching is disabled while the API is active.",
        );
      if (!isRole(role)) throw new Error("Invalid demo role.");
      const account = {
        id: role === "super_admin" ? "demo-super" : `demo-${role}`,
        name: demoNames[role],
        email: `${role}@demo.bautek`,
        role,
        demo: true,
      };
      return establish(account, null, "demo");
    },
    [demo, establish],
  );

  const login = useCallback(
    async (email, password) => {
      if (demo) {
        throw new Error(
          "This is an offline preview. Select a demo role below to explore the workspace.",
        );
      }
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const account = responseUser(data);
      if (!account)
        throw new Error("The backend returned an unrecognised user role.");
      setApiError(null);
      return establish(account, responseToken(data), "api");
    },
    [demo, establish],
  );

  const register = useCallback(
    async (payload) => {
      if (demo) {
        throw new Error(
          "Account registration requires the connected backend. Use the demo roles to preview the interface.",
        );
      }
      // Never accept elevated roles from public registration, including admin
      // and tenant. Tenant provisioning/invitations are backend-controlled.
      const { name, email, password } = payload || {};
      return request("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role: "client" }),
      });
    },
    [demo],
  );

  const logout = useCallback(async () => {
    if (!demo) {
      try {
        await request("/auth/logout", { method: "POST" });
      } catch {
        /* clear local session even when the network is unavailable */
      }
    }
    clear();
  }, [demo, clear]);

  /** Pull the server's authoritative role/profile after promotion or edits. */
  const refreshUser = useCallback(async () => {
    if (demo) return user;
    const data = await request("/auth/me");
    const account = responseUser(data);
    if (!account) throw new Error("No valid user profile returned by the API.");
    return establish(
      account,
      responseToken(data) || readSession(SESSION_TOKEN),
      "api",
    );
  }, [demo, user, establish]);

  /** Offline edits are explicitly local; live edits use the authenticated API. */
  const updateProfile = useCallback(
    async (patch) => {
      if (!user) throw new Error("Sign in to update your profile.");
      if (!patch || typeof patch !== "object" || Array.isArray(patch))
        throw new Error("Invalid profile data.");
      const allowed = [
        "name",
        "phone",
        "specialties",
        "specializations",
        "experience",
        "qualifications",
        "bio",
      ];
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([key]) => allowed.includes(key)),
      );
      if (demo) return establish({ ...user, ...changes }, null, "demo");
      const result = await request("/auth/me", {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      const account = responseUser(result);
      if (!account)
        throw new Error("The API did not return an updated user profile.");
      return establish(
        account,
        responseToken(result) || readSession(SESSION_TOKEN),
        "api",
      );
    },
    [demo, user, establish],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      demoLogin,
      demo,
      apiConnected: API_ENABLED && !offlinePreview,
      apiError,
      refreshUser,
      updateProfile,
    }),
    [
      user,
      loading,
      login,
      register,
      logout,
      demoLogin,
      demo,
      offlinePreview,
      apiError,
      refreshUser,
      updateProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}

export function Guard({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return <div className="page-loading">Checking your session…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/unauthorized" replace />;
  return children;
}
