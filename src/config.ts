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
  // Telegram
  tgBotToken?: string;
  tgChatId?: string;
  tgAllowedUsers?: string[];
  // Feishu
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuDomain?: string;
  feishuAllowedUsers?: string[];
  feishuGroupTriggerMode?: 'all' | 'mention';
  feishuGroupContextMaxMessages?: number;
  feishuGroupContextMaxAgeMinutes?: number;
  feishuGroupContextMaxChars?: number;
  feishuGroupContextPerMessageMaxChars?: number;
  // Discord
  discordBotToken?: string;
  discordAllowedUsers?: string[];
  discordAllowedChannels?: string[];
  discordAllowedGuilds?: string[];
  // QQ
  qqAppId?: string;
  qqAppSecret?: string;
  qqAllowedUsers?: string[];
  qqImageEnabled?: boolean;
  qqMaxImageSize?: number;
  // WeChat
  weixinBaseUrl?: string;
  weixinCdnBaseUrl?: string;
  weixinMediaEnabled?: boolean;
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
    enabledChannels: splitCsv(env.get("CTI_ENABLED_CHANNELS")) ?? [],
    defaultWorkDir: env.get("CTI_DEFAULT_WORKDIR") || process.cwd(),
    defaultModel: env.get("CTI_DEFAULT_MODEL") || undefined,
    defaultEffort: normalizeEffort(env.get("CTI_DEFAULT_EFFORT")),
    defaultMode: env.get("CTI_DEFAULT_MODE") || "code",
    tgBotToken: env.get("CTI_TG_BOT_TOKEN") || undefined,
    tgChatId: env.get("CTI_TG_CHAT_ID") || undefined,
    tgAllowedUsers: splitCsv(env.get("CTI_TG_ALLOWED_USERS")),
    feishuAppId: env.get("CTI_FEISHU_APP_ID") || undefined,
    feishuAppSecret: env.get("CTI_FEISHU_APP_SECRET") || undefined,
    feishuDomain: env.get("CTI_FEISHU_DOMAIN") || undefined,
    feishuAllowedUsers: splitCsv(env.get("CTI_FEISHU_ALLOWED_USERS")),
    feishuGroupTriggerMode: normalizeFeishuGroupTriggerMode(env.get("CTI_FEISHU_GROUP_TRIGGER_MODE")),
    feishuGroupContextMaxMessages: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES")),
    feishuGroupContextMaxAgeMinutes: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES")),
    feishuGroupContextMaxChars: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS")),
    feishuGroupContextPerMessageMaxChars: optionalPositiveNumber(env.get("CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS")),
    discordBotToken: env.get("CTI_DISCORD_BOT_TOKEN") || undefined,
    discordAllowedUsers: splitCsv(env.get("CTI_DISCORD_ALLOWED_USERS")),
    discordAllowedChannels: splitCsv(
      env.get("CTI_DISCORD_ALLOWED_CHANNELS")
    ),
    discordAllowedGuilds: splitCsv(env.get("CTI_DISCORD_ALLOWED_GUILDS")),
    qqAppId: env.get("CTI_QQ_APP_ID") || undefined,
    qqAppSecret: env.get("CTI_QQ_APP_SECRET") || undefined,
    qqAllowedUsers: splitCsv(env.get("CTI_QQ_ALLOWED_USERS")),
    qqImageEnabled: env.has("CTI_QQ_IMAGE_ENABLED")
      ? env.get("CTI_QQ_IMAGE_ENABLED") === "true"
      : undefined,
    qqMaxImageSize: env.get("CTI_QQ_MAX_IMAGE_SIZE")
      ? Number(env.get("CTI_QQ_MAX_IMAGE_SIZE"))
      : undefined,
    weixinBaseUrl: env.get("CTI_WEIXIN_BASE_URL") || undefined,
    weixinCdnBaseUrl: env.get("CTI_WEIXIN_CDN_BASE_URL") || undefined,
    weixinMediaEnabled: env.has("CTI_WEIXIN_MEDIA_ENABLED")
      ? env.get("CTI_WEIXIN_MEDIA_ENABLED") === "true"
      : undefined,
    autoApprove: env.has("CTI_AUTO_APPROVE")
      ? env.get("CTI_AUTO_APPROVE") === "true"
      : undefined,
  };
}

const MANAGED_ENV_KEYS = [
  "CTI_RUNTIME",
  "CTI_ENABLED_CHANNELS",
  "CTI_DEFAULT_WORKDIR",
  "CTI_DEFAULT_MODEL",
  "CTI_DEFAULT_EFFORT",
  "CTI_DEFAULT_MODE",
  "CTI_TG_BOT_TOKEN",
  "CTI_TG_CHAT_ID",
  "CTI_TG_ALLOWED_USERS",
  "CTI_FEISHU_APP_ID",
  "CTI_FEISHU_APP_SECRET",
  "CTI_FEISHU_DOMAIN",
  "CTI_FEISHU_ALLOWED_USERS",
  "CTI_FEISHU_GROUP_TRIGGER_MODE",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES",
  "CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS",
  "CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS",
  "CTI_DISCORD_BOT_TOKEN",
  "CTI_DISCORD_ALLOWED_USERS",
  "CTI_DISCORD_ALLOWED_CHANNELS",
  "CTI_DISCORD_ALLOWED_GUILDS",
  "CTI_QQ_APP_ID",
  "CTI_QQ_APP_SECRET",
  "CTI_QQ_ALLOWED_USERS",
  "CTI_QQ_IMAGE_ENABLED",
  "CTI_QQ_MAX_IMAGE_SIZE",
  "CTI_WEIXIN_BASE_URL",
  "CTI_WEIXIN_CDN_BASE_URL",
  "CTI_WEIXIN_MEDIA_ENABLED",
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
  setManagedEnv(entries, "CTI_TG_BOT_TOKEN", config.tgBotToken);
  setManagedEnv(entries, "CTI_TG_CHAT_ID", config.tgChatId);
  setManagedEnv(entries, "CTI_TG_ALLOWED_USERS", config.tgAllowedUsers?.join(","));
  setManagedEnv(entries, "CTI_FEISHU_APP_ID", config.feishuAppId);
  setManagedEnv(entries, "CTI_FEISHU_APP_SECRET", config.feishuAppSecret);
  setManagedEnv(entries, "CTI_FEISHU_DOMAIN", config.feishuDomain);
  setManagedEnv(entries, "CTI_FEISHU_ALLOWED_USERS", config.feishuAllowedUsers?.join(","));
  setManagedEnv(entries, "CTI_FEISHU_GROUP_TRIGGER_MODE", config.feishuGroupTriggerMode);
  if (config.feishuGroupContextMaxMessages !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_MESSAGES", String(config.feishuGroupContextMaxMessages));
  if (config.feishuGroupContextMaxAgeMinutes !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_AGE_MINUTES", String(config.feishuGroupContextMaxAgeMinutes));
  if (config.feishuGroupContextMaxChars !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_MAX_CHARS", String(config.feishuGroupContextMaxChars));
  if (config.feishuGroupContextPerMessageMaxChars !== undefined)
    setManagedEnv(entries, "CTI_FEISHU_GROUP_CONTEXT_PER_MESSAGE_MAX_CHARS", String(config.feishuGroupContextPerMessageMaxChars));
  setManagedEnv(entries, "CTI_DISCORD_BOT_TOKEN", config.discordBotToken);
  setManagedEnv(entries, "CTI_DISCORD_ALLOWED_USERS", config.discordAllowedUsers?.join(","));
  setManagedEnv(entries, "CTI_DISCORD_ALLOWED_CHANNELS", config.discordAllowedChannels?.join(","));
  setManagedEnv(entries, "CTI_DISCORD_ALLOWED_GUILDS", config.discordAllowedGuilds?.join(","));
  setManagedEnv(entries, "CTI_QQ_APP_ID", config.qqAppId);
  setManagedEnv(entries, "CTI_QQ_APP_SECRET", config.qqAppSecret);
  setManagedEnv(entries, "CTI_QQ_ALLOWED_USERS", config.qqAllowedUsers?.join(","));
  if (config.qqImageEnabled !== undefined)
    setManagedEnv(entries, "CTI_QQ_IMAGE_ENABLED", String(config.qqImageEnabled));
  if (config.qqMaxImageSize !== undefined)
    setManagedEnv(entries, "CTI_QQ_MAX_IMAGE_SIZE", String(config.qqMaxImageSize));
  setManagedEnv(entries, "CTI_WEIXIN_BASE_URL", config.weixinBaseUrl);
  setManagedEnv(entries, "CTI_WEIXIN_CDN_BASE_URL", config.weixinCdnBaseUrl);
  if (config.weixinMediaEnabled !== undefined)
    setManagedEnv(entries, "CTI_WEIXIN_MEDIA_ENABLED", String(config.weixinMediaEnabled));
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

  // ── Telegram ──
  // Upstream keys: telegram_bot_token, bridge_telegram_enabled,
  //   telegram_bridge_allowed_users, telegram_chat_id
  m.set(
    "bridge_telegram_enabled",
    config.enabledChannels.includes("telegram") ? "true" : "false"
  );
  if (config.tgBotToken) m.set("telegram_bot_token", config.tgBotToken);
  if (config.tgAllowedUsers)
    m.set("telegram_bridge_allowed_users", config.tgAllowedUsers.join(","));
  if (config.tgChatId) m.set("telegram_chat_id", config.tgChatId);

  // ── Discord ──
  // Upstream keys: bridge_discord_bot_token, bridge_discord_enabled,
  //   bridge_discord_allowed_users, bridge_discord_allowed_channels,
  //   bridge_discord_allowed_guilds
  m.set(
    "bridge_discord_enabled",
    config.enabledChannels.includes("discord") ? "true" : "false"
  );
  if (config.discordBotToken)
    m.set("bridge_discord_bot_token", config.discordBotToken);
  if (config.discordAllowedUsers)
    m.set("bridge_discord_allowed_users", config.discordAllowedUsers.join(","));
  if (config.discordAllowedChannels)
    m.set(
      "bridge_discord_allowed_channels",
      config.discordAllowedChannels.join(",")
    );
  if (config.discordAllowedGuilds)
    m.set(
      "bridge_discord_allowed_guilds",
      config.discordAllowedGuilds.join(",")
    );

  // ── Feishu ──
  // Upstream keys: bridge_feishu_app_id, bridge_feishu_app_secret,
  //   bridge_feishu_domain, bridge_feishu_enabled, bridge_feishu_allowed_users
  m.set(
    "bridge_feishu_enabled",
    config.enabledChannels.includes("feishu") ? "true" : "false"
  );
  if (config.feishuAppId) m.set("bridge_feishu_app_id", config.feishuAppId);
  if (config.feishuAppSecret)
    m.set("bridge_feishu_app_secret", config.feishuAppSecret);
  const feishuDomain = normalizeFeishuDomain(config.feishuDomain);
  if (feishuDomain) m.set("bridge_feishu_domain", feishuDomain);
  if (config.feishuAllowedUsers)
    m.set("bridge_feishu_allowed_users", config.feishuAllowedUsers.join(","));
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

  // ── QQ ──
  // Upstream keys: bridge_qq_enabled, bridge_qq_app_id, bridge_qq_app_secret,
  //   bridge_qq_allowed_users, bridge_qq_image_enabled, bridge_qq_max_image_size
  m.set(
    "bridge_qq_enabled",
    config.enabledChannels.includes("qq") ? "true" : "false"
  );
  if (config.qqAppId) m.set("bridge_qq_app_id", config.qqAppId);
  if (config.qqAppSecret) m.set("bridge_qq_app_secret", config.qqAppSecret);
  if (config.qqAllowedUsers)
    m.set("bridge_qq_allowed_users", config.qqAllowedUsers.join(","));
  if (config.qqImageEnabled !== undefined)
    m.set("bridge_qq_image_enabled", String(config.qqImageEnabled));
  if (config.qqMaxImageSize !== undefined)
    m.set("bridge_qq_max_image_size", String(config.qqMaxImageSize));

  // ── WeChat ──
  // Upstream keys: bridge_weixin_enabled, bridge_weixin_media_enabled,
  //   bridge_weixin_base_url, bridge_weixin_cdn_base_url
  m.set(
    "bridge_weixin_enabled",
    config.enabledChannels.includes("weixin") ? "true" : "false"
  );
  if (config.weixinMediaEnabled !== undefined)
    m.set("bridge_weixin_media_enabled", String(config.weixinMediaEnabled));
  if (config.weixinBaseUrl)
    m.set("bridge_weixin_base_url", config.weixinBaseUrl);
  if (config.weixinCdnBaseUrl)
    m.set("bridge_weixin_cdn_base_url", config.weixinCdnBaseUrl);

  // ── Defaults ──
  // Upstream keys: bridge_default_work_dir, bridge_default_model, default_model
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
