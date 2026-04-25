import { useSettings } from "@/contexts/SettingsContext";

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatNumber(value: number) {
  if (value >= 1e9) {
    return (value / 1e9).toFixed(2) + "B";
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(2) + "M";
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(2) + "K";
  }
  return value.toString();
}

export function useFormats() {
  const { settings } = useSettings();
  const locale = settings.numberFormat === "EU" ? "de-DE" : "en-US";

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(v);

  const fmtPercent = (v: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v / 100);

  const fmtDate = (d: Date | string): string => {
    const date = typeof d === "string" ? new Date(d) : d;
    if (isNaN(date.getTime())) return "—";
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    if (settings.dateFormat === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
    if (settings.dateFormat === "DD/MM/YYYY") return `${dd}/${mm}/${yyyy}`;
    return `${mm}/${dd}/${yyyy}`;
  };

  return { fmtCurrency, fmtPercent, fmtDate };
}
