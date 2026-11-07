import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppConfig } from "@/shared/api";
import { api, errorMessage } from "./api";

interface ConfigState {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.config();
      setConfig(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <ConfigContext.Provider value={{ config, loading, error, reload }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig 必须在 ConfigProvider 内使用");
  return ctx;
}