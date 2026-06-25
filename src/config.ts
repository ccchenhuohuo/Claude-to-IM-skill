import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  runtime: 'claude' | 'codex' | 'auto';
  enabledChannels: string[];
  defaultWorkDir: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultMode: string;
  // Feishu/Lark
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuDomain?: string;
  feishuCommandAdmins?: string[];
  feishuGroupTriggerMode?: 'all' | 'mention';
  feishuGroupContextMaxMessages?: number;
  feishuGroupContextMaxAgeMinutes?: number;
  feishuGroupContextMaxChars?: number;
  feishuGroupContextPerMessageMaxChars?: number;
  // Legacy Weixin fields are kept temporarily until the Weixin source files are
  // removed from the TypeScript compile set in the Feishu-only cleanup.
  weixinBaseUrl?: string;
  weixinCdnBaseUrl?: string;
  // Dreaming
  dreamingEnabled?: boolean;
  dreamingTime?: string;
  dreamingTimezone?: string;
  dreamingModel?: string;
  dreamingMaxLogChars?: number;
  dreamingCatchupDays?: number;
  // Auto-approve all tool permission requests without user confirmation
  autoApprove?: boolean;
}

export const CTI_HOME = process.env.CTI_HOME || path.join(os.homedir(), ".claude-to-im");
export const CONFIG_PATH = path.join(CTI_HOME, "config.env");

function parseEnvFile(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeEnabledChannels(value: string | undefined): string[] {
  const channels = splitCsv(value) ?? [];
  return channels.some((channel) => channel.toLowerCase() === 'feishu') ? ['feishu'] : [];
}

function normalizeEffort(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const effort = value.trim();
  return ["low", "medium", "high", "xhigh", "max"].includes(effort)
    ? effort
    : undefined;
}

function normalizeFeishuGroupTriggerMode(value: string | undefined): 'all' | 'mention' | undefined {
  if (!value) return undefined;
  const mode = value.trim().toLowerCase();
  return mode === 'all' || mode === 'mention' ? mode : undefined;
}

export function normalizeFeishuDomain(value: string | undefined): 'feishu' | 'lark' | undefined {
  if (!value) return undefined;
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split('/')[0];

  if (domain === 'feishu' || domain === 'open.feishu.cn') return 'feishu';
  if (domain === 'lark' || domain === 'open.larksuite.com') return 'lark';
  return undefined;
}

function optionalPositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.trim().toLowerCase() === 'true';
}

function normalizeDreamingTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = value.trim();
  return /^\d{2}:\d{2}$/.test(time) ? time : undefined;
}

export function loadConfig(): Config {
  let env = new Map<string, string>();
  try {
    const content = fs.readFileSync(CONFIG_PATH, "utf-8");
    env = parseEnvFile(content);
  } catch {
    // Config file doesn't exist yet — use defaults
  }

  const rawRuntime = env.get("CTI_RUNTIME") || "claude";
  const runtime = (["claude", "codex", "auto"].includes(rawRuntime) ? rawRuntime : "claude") as Config["runtime"];

  return {
    runtime,
    enabledChannels: normalizeEnabledChannels(env.get("CTI_ENABLED_CHANNELS")),
    defaultWorkDir: env.get("CTI_DEFAULT_WORKDIR") || process.cwd(),
    defaultModel: env.get("CTI_DEFAULT_MODEL") || undefined,
    defaultEffort: normalizeEffort(env.get("CTI_DEFAULT_EFFORT")),
    defaultMode: env.get("CTI_DEFAULT_MODE") || "code",
    feishuAppId: env.get("CTI_FEISHU_APP_ID") || undefined,
    feishuAppSecret: env.get("CTI_FEISHU_APP_SECRET") || undefined,
    feishuDomain: env.get("CTI_FEISHU_DOMAIN") || undefined,
    feishuCommandAdmins: splitCsv(env.get("CTI_FEISHU_COMMAND_ADMINS")),
    feishuGroupTriggerMode: normalizeFeishuGroupTriggerMode(env.get("CTI_FEISHU_GROUP_TRIGGER_MODE")),
    feishuGroupContextMaxMessages: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES")),
    feishuGroupContextMaxAgeMinutes: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES")),
    feishuGroupContextMaxChars: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS")),
    feishuGroupContextPerMessageMaxChars: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS")),
    dreamingEnabled: optionalBoolean(env.get("CTI_DREAMING_ENABLED")),
    dreamingTime: normalizeDreamingTime(env.get("CTI_DREAMING_TIME")),
    dreamingTimezone: env.get("CTI_DREAMING_TIMEZONE") || undefined,
    dreamingModel: env.get("CTI_DREAMING_MODEL") || undefined,
    dreamingMaxLogChars: optionalPositiveNumber(env.get("CTI_DREAMING_MAX_LOG_CHARS")),
    dreamingCatchupDays: optionalPositiveNumber(env.get("CTI_DREAMING_CATCHUP_DAYS")),
    autoApprove: optionalBoolean(env.get("CTI_AUTO_APPROVE")),
  };
}

const MANAGED_ENV_KEYS = [
  "CTI_RUNTIME",
  "CTI_ENABLED_CHANNELS",
  "CTI_DEFAULT_WORKDIR",
  "CTI_DEFAULT_MODEL",
  "CTI_DEFAULT_EFFORT",
  "CTI_DEFAULT_MODE",
  "CTI_FEISHU_APP_ID",
  "CTI_FEISHU_APP_SECRET",
  "CTI_FEISHU_DOMAIN",
  "CTI_FEISHU_COMMAND_ADMINS",
  "CTI_FEISHU_GROUP_TRIGGER_MODE",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS",
  "CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS",
  "CTI_DREAMING_ENABLED",
  "CTI_DREAMING_TIME",
  "CTI_DREAMING_TIMEZONE",
  "CTI_DREAMING_MODEL",
  "CTI_DREAMING_MAX_LOG_CHARS",
  "CTI_DREAMING_CATCHUP_DAYS",
  "CTI_AUTO_APPROVE",
] as const;

const MANAGED_ENV_KEY_SET = new Set<string>(MANAGED_ENV_KEYS);

function setManagedEnv(entries: Map<string, string>, key: string, value: string | undefined): void {
  if (value === undefined || value === "") return;
  entries.set(key, value);
}

function buildManagedEnv(config: Config): Map<string, string> {
  const entries = new Map<string, string>();
  setManagedEnv(entries, "CTI_RUNTIME", config.runtime);
  setManagedEnv(entries, "CTI_ENABLED_CHANNELS", config.enabledChannels.join(","));
  setManagedEnv(entries, "CTI_DEFAULT_WORKDIR", config.defaultWorkDir);
  setManagedEnv(entries, "CTI_DEFAULT_MODEL", config.defaultModel);
  setManagedEnv(entries, "CTI_DEFAULT_EFFORT", config.defaultEffort);
  setManagedEnv(entries, "CTI_DEFAULT_MODE", config.defaultMode);
  setManagedEnv(entries, "CTI_FEISHU_APP_ID", config.feishuAppId);
  setManagedEnv(entries, "CTI_FEISHU_APP_SECRET", config.feishuAppSecret);
  setManagedEnv(entries, "CTI_FEISHU_DOMAIN", config.feishuDomain);
  setManagedEnv(entries, "CTI_FEISHU_COMMAND_ADMINS", config.feishuCommandAdmins?.join(","));
  setManagedEnv(entries, "CTI_FEISHU_GROUP_TRIGGER_MODE", config.feishuGroupTriggerMode);
  if (config.feishuGroupContextMaxMessages !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES", String(config.feishuGroupContextMaxMessages));
  if (config.feishuGroupContextMaxAgeMinutes !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES", String(config.feishuGroupContextMaxAgeMinutes));
  if (config.feishuGroupContextMaxChars !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS", String(config.feishuGroupContextMaxChars));
  if (config.feishuGroupContextPerMessageMaxChars !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS", String(config.feishuGroupContextPerMessageMaxChars));
  if (config.dreamingEnabled !== undefined)
    setManagedEnv(entries, "CTI_DREAMING_ENABLED", String(config.dreamingEnabled));
  setManagedEnv(entries, "CTI_DREAMING_TIME", config.dreamingTime);
  setManagedEnv(entries, "CTI_DREAMING_TIMEZONE", config.dreamingTimezone);
  setManagedEnv(entries, "CTI_DREAMING_MODEL", config.dreamingModel);
  if (config.dreamingMaxLogChars !== undefined)
    setManagedEnv(entries, "CTI_DREAMING_MAX_LOG_CHARS", String(config.dreamingMaxLogChars));
  if (config.dreamingCatchupDays !== undefined)
    setManagedEnv(entries, "CTI_DREAMING_CATCHUP_DAYS", String(config.dreamingCatchupDays));
  if (config.autoApprove !== undefined)
    setManagedEnv(entries, "CTI_AUTO_APPROVE", String(config.autoApprove));
  return entries;
}

function mergeEnvContent(existingContent: string, managedEntries: Map<string, string>): string {
  const out: string[] = [];
  const seenManaged = new Set<string>();
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === lines.length - 1 && line === "") continue;
    const trimmed = line.trim();
    const eqIdx = trimmed.indexOf("=");
    const key = eqIdx === -1 ? "" : trimmed.slice(0, eqIdx).trim();

    if (!trimmed || trimmed.startsWith("#") || eqIdx === -1 || !MANAGED_ENV_KEY_SET.has(key)) {
      out.push(line);
      continue;
    }

    if (!seenManaged.has(key) && managedEntries.has(key)) {
      out.push(`${key}=${managedEntries.get(key)}`);
    }
    seenManaged.add(key);
  }

  const missing = MANAGED_ENV_KEYS.filter((key) => managedEntries.has(key) && !seenManaged.has(key));
  if (missing.length > 0 && out.length > 0 && out[out.length - 1].trim() !== "") {
    out.push("");
  }
  for (const key of missing) {
    out.push(`${key}=${managedEntries.get(key)}`);
  }

  return out.length > 0 ? `${out.join("\n")}\n` : "";
}

export function saveConfig(config: Config): void {
  let existing = "";
  try {
    existing = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    // First save; there is no existing config to merge.
  }

  const out = mergeEnvContent(existing, buildManagedEnv(config));

  fs.mkdirSync(CTI_HOME, { recursive: true });
  const tmpPath = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmpPath, out, { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_PATH);
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return "*".repeat(value.length - 4) + value.slice(-4);
}

export function configToSettings(config: Config): Map<string, string> {
  const m = new Map<string, string>();
  m.set("remote_bridge_enabled", "true");

  // ── Feishu/Lark ──
  m.set(
    "bridge_feishu_enabled",
    config.enabledChannels.includes("feishu") ? "true" : "false"
  );
  if (config.feishuAppId) m.set("bridge_feishu_app_id", config.feishuAppId);
  if (config.feishuAppSecret)
    m.set("bridge_feishu_app_secret", config.feishuAppSecret);
  const feishuDomain = normalizeFeishuDomain(config.feishuDomain);
  if (feishuDomain) m.set("bridge_feishu_domain", feishuDomain);
  if (config.feishuCommandAdmins)
    m.set("bridge_feishu_command_admins", config.feishuCommandAdmins.join(","));
  if (config.feishuGroupTriggerMode)
    m.set("bridge_feishu_group_trigger_mode", config.feishuGroupTriggerMode);
  if (config.feishuGroupContextMaxMessages !== undefined)
    m.set("bridge_feishu_group_context_max_messages", String(config.feishuGroupContextMaxMessages));
  if (config.feishuGroupContextMaxAgeMinutes !== undefined)
    m.set("bridge_feishu_group_context_max_age_minutes", String(config.feishuGroupContextMaxAgeMinutes));
  if (config.feishuGroupContextMaxChars !== undefined)
    m.set("bridge_feishu_group_context_max_chars", String(config.feishuGroupContextMaxChars));
  if (config.feishuGroupContextPerMessageMaxChars !== undefined)
    m.set("bridge_feishu_group_context_per_message_max_chars", String(config.feishuGroupContextPerMessageMaxChars));

  // ── Dreaming ──
  if (config.dreamingEnabled !== undefined)
    m.set("bridge_dreaming_enabled", String(config.dreamingEnabled));
  if (config.dreamingTime)
    m.set("bridge_dreaming_time", config.dreamingTime);
  if (config.dreamingTimezone)
    m.set("bridge_dreaming_timezone", config.dreamingTimezone);
  if (config.dreamingModel)
    m.set("bridge_dreaming_model", config.dreamingModel);
  if (config.dreamingMaxLogChars !== undefined)
    m.set("bridge_dreaming_max_log_chars", String(config.dreamingMaxLogChars));
  if (config.dreamingCatchupDays !== undefined)
    m.set("bridge_dreaming_catchup_days", String(config.dreamingCatchupDays));

  // ── Defaults ──
  m.set("bridge_default_work_dir", config.defaultWorkDir);
  if (config.defaultModel) {
    m.set("bridge_default_model", config.defaultModel);
    m.set("default_model", config.defaultModel);
  }
  if (config.defaultEffort) {
    m.set("bridge_default_effort", config.defaultEffort);
    m.set("default_effort", config.defaultEffort);
  }
  m.set("bridge_default_mode", config.defaultMode);

  return m;
}
