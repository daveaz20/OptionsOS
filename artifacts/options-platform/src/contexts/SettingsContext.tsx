import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  useGetUserSettings,
  usePatchUserSettings,
  useDeleteUserSettings,
} from "@workspace/api-client-react";
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(SETTING_DEFAULTS);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, unknown>>({});

  const { data: serverSettings, isLoading } = useGetUserSettings();
  const patchMutation = usePatchUserSettings();
  const deleteMutation = useDeleteUserSettings();

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
      patchMutation.mutate(toSave, {
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
