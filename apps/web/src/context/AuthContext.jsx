import { createContext, useContext, useMemo, useState } from "react";
import api from "../services/api";

const STORAGE_KEY = "mvp-team-session";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [team, setTeam] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  });

  const login = async (teamCode, teamName) => {
    const response = await api.post("/auth/team-session", {
      teamCode,
      teamName
    });

    setTeam(response.data.team);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(response.data.team));
    return response.data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Local cleanup still applies if remote call fails.
    }
    setTeam(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo(
    () => ({
      team,
      login,
      logout,
      isAuthenticated: Boolean(team),
      isAdmin: Boolean(team?.isAdmin)
    }),
    [team]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
