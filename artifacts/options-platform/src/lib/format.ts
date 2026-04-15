import { useTheme } from "next-themes";

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

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}
