import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(process.cwd(), ".env");

const SERVER_ENV_KEYS = [
  "POLYGON_API_KEY",
  "TASTYTRADE_USERNAME",
  "TASTYTRADE_ACCOUNT_NUMBER",
  "TASTYTRADE_CLIENT_ID",
  "TASTYTRADE_CLIENT_SECRET",
  "TASTYTRADE_REDIRECT_URI",
  "TASTYTRADE_REFRESH_TOKEN",
] as const;

export type ServerEnvKey = typeof SERVER_ENV_KEYS[number];
export type ServerEnvPatch = Partial<Record<ServerEnvKey, string>>;

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function serializeValue(value: string): string {
  if (/[\s#"']/u.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function readEnvFile(): Map<string, string> {
  try {
    return parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
  } catch {
    return new Map();
  }
}

export function getServerEnv(): Record<ServerEnvKey, string> {
  const fileEnv = readEnvFile();
  return Object.fromEntries(
    SERVER_ENV_KEYS.map((key) => [key, process.env[key] ?? fileEnv.get(key) ?? ""]),
  ) as Record<ServerEnvKey, string>;
}

export function loadServerEnvIntoProcess(): void {
  const fileEnv = readEnvFile();
  for (const [key, value] of fileEnv.entries()) {
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

export function updateServerEnv(patch: ServerEnvPatch): Record<ServerEnvKey, string> {
  const env = readEnvFile();

  for (const [key, value] of Object.entries(patch) as Array<[ServerEnvKey, string | undefined]>) {
    if (!SERVER_ENV_KEYS.includes(key)) continue;
    if (value == null) continue;
    env.set(key, value);
    process.env[key] = value;
  }

  const lines = [...env.entries()].map(([key, value]) => `${key}=${serializeValue(value)}`);
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf8");

  return getServerEnv();
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "•".repeat(value.length);
  return `${value.slice(0, visible)}${"•".repeat(Math.min(12, value.length - visible * 2))}${value.slice(-visible)}`;
}
