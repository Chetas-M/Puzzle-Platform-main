import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api, { registerAuthHandlers, setAuthToken } from "../services/api";

const AuthContext = createContext(null);

const STORAGE_KEY = "puzzle-platform-auth";

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  useEffect(() => {
    registerAuthHandlers({
      getAuth: () => auth,
      setAuth: (nextAuth) => setAuth(nextAuth),
      onAuthFailure: () => setAuth(null)
    });
  }, [auth]);

  useEffect(() => {
    let active = true;

    const validate = async () => {
      if (!auth?.token) {
        if (active) {
          setIsAuthChecked(true);
        }
        return;
      }

      setAuthToken(auth.token);

      try {
        await api.get("/auth/validate");
      } catch {
        if (active) {
          setAuth(null);
        }
      } finally {
        if (active) {
          setIsAuthChecked(true);
        }
      }
    };

    validate();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (auth?.token) {
      setAuthToken(auth.token);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      return;
    }

    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [auth]);

  const loginTeam = async (teamId, password, isAdmin = false) => {
    const endpoint = isAdmin ? "/auth/admin-login" : "/auth/login";
    const response = await api.post(endpoint, { teamId, password });
    setAuth({
      token: response.data.token,
      refreshToken: response.data.refreshToken,
      team: response.data.team
    });
    return response.data;
  };

  const logout = async () => {
    try {
      if (auth?.token) {
        await api.post("/auth/logout", {}, { skipAuthRefresh: true });
      }
    } catch {
      // Local logout still proceeds if remote logout fails.
    }
    setAuth(null);
  };

  const value = useMemo(
    () => ({
      auth,
      loginTeam,
      logout,
      isAuthenticated: Boolean(auth?.token),
      isAdmin: Boolean(auth?.team?.is_admin),
      isAuthChecked
    }),
    [auth, isAuthChecked]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
