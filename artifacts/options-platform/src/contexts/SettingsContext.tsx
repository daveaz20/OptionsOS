import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SETTING_DEFAULTS, type AppSettings } from "@/lib/settings-defaults";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SettingsContextValue {
  settings: AppSettings;
  isLoading: boolean;
  saveStatus: SaveStatus;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const SETTINGS_QUERY_KEY = ["settings"] as const;

async function requestSettings<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Settings request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(SETTING_DEFAULTS);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, unknown>>({});
  const queryClient = useQueryClient();

  const { data: serverSettings, isLoading } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => requestSettings<Partial<AppSettings>>("/api/settings"),
  });

  const patchMutation = useMutation({
    mutationFn: (updates: Partial<AppSettings>) =>
      requestSettings<Partial<AppSettings>>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    onSuccess: (savedSettings) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, savedSettings);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      requestSettings<Partial<AppSettings>>("/api/settings", {
        method: "DELETE",
      }),
    onSuccess: (savedSettings) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, savedSettings);
    },
  });

  useEffect(() => {
    if (serverSettings) {
      setSettings({ ...SETTING_DEFAULTS, ...(serverSettings as Partial<AppSettings>) });
    }
  }, [serverSettings]);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    pendingRef.current[key as string] = value;
    setSaveStatus("saving");

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const toSave = { ...pendingRef.current };
      pendingRef.current = {};
      patchMutation.mutate(toSave as Partial<AppSettings>, {
        onSuccess: () => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        },
        onError: () => {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        },
      });
    }, 500);
  }, [patchMutation]);

  const resetSettings = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setSettings(SETTING_DEFAULTS);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      },
    });
  }, [deleteMutation]);

  return (
    <SettingsContext.Provider value={{ settings, isLoading, saveStatus, updateSetting, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
