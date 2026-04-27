export type FreshnessTone = "fresh" | "aging" | "stale" | "unknown";

export function formatFreshness(timestamp?: number | string | null): string {
  if (!timestamp) return "unknown";
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const ageSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ageSeconds < 10) return "just now";
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getFreshnessTone(timestamp?: number | string | null, staleAfterMs = 5 * 60 * 1000): FreshnessTone {
  if (!timestamp) return "unknown";
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const age = Date.now() - ms;
  if (age <= staleAfterMs * 0.5) return "fresh";
  if (age <= staleAfterMs) return "aging";
  return "stale";
}

export function freshnessColor(tone: FreshnessTone): string {
  if (tone === "fresh") return "hsl(var(--success))";
  if (tone === "aging") return "hsl(38 92% 50%)";
  if (tone === "stale") return "hsl(var(--destructive))";
  return "hsl(var(--muted-foreground))";
}
