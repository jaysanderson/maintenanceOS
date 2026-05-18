import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, tokenStore } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "DISPATCHER" | "TECHNICIAN";
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api
      .get<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => {
        tokenStore.clear();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>(
      "/auth/login",
      { email, password }
    );
    tokenStore.set(res.token);
    setUser(res.user);
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
    location.assign("/login");
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}

export const ADMIN_ROLES = ["ADMIN", "MANAGER"];
