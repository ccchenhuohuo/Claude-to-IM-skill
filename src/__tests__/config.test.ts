import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maskSecret, configToSettings, normalizeFeishuDomain, type Config } from '../config.js';

// ── maskSecret ──

describe('maskSecret', () => {
  it('masks short values entirely', () => {
    assert.equal(maskSecret('abc'), '****');
    assert.equal(maskSecret('abcd'), '****');
    assert.equal(maskSecret(''), '****');
  });

  it('preserves last 4 chars for longer values', () => {
    assert.equal(maskSecret('12345678'), '****5678');
    assert.equal(maskSecret('secret-token-abcd'), '*************abcd');
  });

  it('handles exactly 5 chars', () => {
    assert.equal(maskSecret('12345'), '*2345');
  });
});

// ── configToSettings ──

describe('configToSettings', () => {
  const base: Config = {
    runtime: 'claude',
    enabledChannels: [],
    defaultWorkDir: '/tmp/test',
    defaultMode: 'code',
  };

  it('always sets remote_bridge_enabled to true', () => {
    const m = configToSettings(base);
    assert.equal(m.get('remote_bridge_enabled'), 'true');
  });

  it('enables only Feishu/Lark channel settings', () => {
    const m = configToSettings({ ...base, enabledChannels: ['feishu'] });
    assert.equal(m.get('bridge_feishu_enabled'), 'true');
    assert.equal(m.has('bridge_telegram_enabled'), false);
    assert.equal(m.has('bridge_discord_enabled'), false);
    assert.equal(m.has('bridge_qq_enabled'), false);
    assert.equal(m.has('bridge_weixin_enabled'), false);
  });

  it('maps feishu config', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['feishu'],
      feishuAppId: 'app-id',
      feishuAppSecret: 'app-secret',
      feishuDomain: 'https://open.feishu.cn',
      feishuCommandAdmins: ['ou_1', 'ou_2'],
    });
    assert.equal(m.get('bridge_feishu_app_id'), 'app-id');
    assert.equal(m.get('bridge_feishu_app_secret'), 'app-secret');
    assert.equal(m.get('bridge_feishu_domain'), 'feishu');
    assert.equal(m.get('bridge_feishu_command_admins'), 'ou_1,ou_2');
  });

  it('normalizes Feishu and Lark domain aliases for core settings', () => {
    const cases: Array<[string, string]> = [
      ['feishu', 'feishu'],
      ['https://open.feishu.cn', 'feishu'],
      ['open.feishu.cn', 'feishu'],
      ['lark', 'lark'],
      ['https://open.larksuite.com', 'lark'],
      ['open.larksuite.com', 'lark'],
    ];

    for (const [input, expected] of cases) {
      assert.equal(normalizeFeishuDomain(input), expected);
      const m = configToSettings({ ...base, enabledChannels: ['feishu'], feishuDomain: input });
      assert.equal(m.get('bridge_feishu_domain'), expected);
    }
  });

  it('omits unsupported Feishu domains instead of passing raw URLs to core', () => {
    const m = configToSettings({ ...base, enabledChannels: ['feishu'], feishuDomain: 'example.com' });
    assert.equal(m.has('bridge_feishu_domain'), false);
  });

  it('maps dreaming settings', () => {
    const m = configToSettings({
      ...base,
      dreamingEnabled: true,
      dreamingTime: '01:00',
      dreamingTimezone: 'Asia/Shanghai',
      dreamingModel: 'claude-opus-4-8',
      dreamingMaxLogChars: 120000,
      dreamingCatchupDays: 3,
    });
    assert.equal(m.get('bridge_dreaming_enabled'), 'true');
    assert.equal(m.get('bridge_dreaming_time'), '01:00');
    assert.equal(m.get('bridge_dreaming_timezone'), 'Asia/Shanghai');
    assert.equal(m.get('bridge_dreaming_model'), 'claude-opus-4-8');
    assert.equal(m.get('bridge_dreaming_max_log_chars'), '120000');
    assert.equal(m.get('bridge_dreaming_catchup_days'), '3');
  });

  it('maps workdir and mode, omits model when not set', () => {
    const m = configToSettings(base);
    assert.equal(m.get('bridge_default_work_dir'), '/tmp/test');
    assert.equal(m.has('bridge_default_model'), false);
    assert.equal(m.has('default_model'), false);
    assert.equal(m.get('bridge_default_mode'), 'code');
  });

  it('maps model when explicitly set', () => {
    const m = configToSettings({ ...base, defaultModel: 'claude-opus-4-8' });
    assert.equal(m.get('bridge_default_model'), 'claude-opus-4-8');
    assert.equal(m.get('default_model'), 'claude-opus-4-8');
  });

  it('maps non-default mode', () => {
    const m = configToSettings({ ...base, defaultMode: 'plan' });
    assert.equal(m.get('bridge_default_mode'), 'plan');
  });

  it('omits optional fields when not set', () => {
    const m = configToSettings(base);
    assert.equal(m.has('bridge_feishu_app_id'), false);
    assert.equal(m.has('bridge_feishu_command_admins'), false);
    assert.equal(m.has('bridge_dreaming_enabled'), false);
  });
});

// ── Config file parsing (loadConfig/saveConfig round-trip) ──

describe('loadConfig/saveConfig round-trip', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origCtiHome: string | undefined;

  async function importConfigForHome(home: string): Promise<typeof import('../config.js')> {
    process.env.CTI_HOME = home;
    return await import(`../config.js?ctiHome=${encodeURIComponent(home)}-${Date.now()}`) as typeof import('../config.js');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-config-test-'));
    origHome = process.env.HOME;
    origCtiHome = process.env.CTI_HOME;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origCtiHome === undefined) delete process.env.CTI_HOME;
    else process.env.CTI_HOME = origCtiHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('configToSettings returns correct defaults', () => {
    const m = configToSettings({
      runtime: 'claude',
      enabledChannels: [],
      defaultWorkDir: process.cwd(),
      defaultMode: 'code',
    });
    assert.equal(m.get('bridge_feishu_enabled'), 'false');
    assert.equal(m.has('bridge_telegram_enabled'), false);
    assert.equal(m.has('bridge_discord_enabled'), false);
    assert.equal(m.has('bridge_qq_enabled'), false);
    assert.equal(m.has('bridge_weixin_enabled'), false);
  });

  it('loads and saves Feishu-only config in an isolated CTI_HOME', async () => {
    const { CONFIG_PATH, loadConfig, saveConfig } = await importConfigForHome(tmpDir);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, [
      'CTI_RUNTIME=auto',
      'CTI_ENABLED_CHANNELS=feishu,qq,telegram,weixin',
      'CTI_FEISHU_DOMAIN=open.larksuite.com',
      'CTI_FEISHU_COMMAND_ADMINS=ou_1,ou_2',
      'CTI_DREAMING_ENABLED=true',
      'CTI_DREAMING_TIME=01:00',
      'CTI_DREAMING_TIMEZONE=Asia/Shanghai',
      'CTI_DREAMING_MAX_LOG_CHARS=30000',
      'CTI_DREAMING_CATCHUP_DAYS=2',
      '',
    ].join('\n'), { mode: 0o600 });

    const loaded = loadConfig();
    assert.equal(loaded.runtime, 'auto');
    assert.deepEqual(loaded.enabledChannels, ['feishu']);
    assert.equal(loaded.feishuDomain, 'open.larksuite.com');
    assert.deepEqual(loaded.feishuCommandAdmins, ['ou_1', 'ou_2']);
    assert.equal(loaded.dreamingEnabled, true);
    assert.equal(loaded.dreamingTime, '01:00');
    assert.equal(loaded.dreamingTimezone, 'Asia/Shanghai');
    assert.equal(loaded.dreamingMaxLogChars, 30000);
    assert.equal(loaded.dreamingCatchupDays, 2);

    saveConfig({
      ...loaded,
      defaultWorkDir: '/tmp/project',
      defaultMode: 'code',
      feishuGroupTriggerMode: 'mention',
    });

    const saved = fs.readFileSync(CONFIG_PATH, 'utf-8');
    assert.match(saved, /^CTI_RUNTIME=auto$/m);
    assert.match(saved, /^CTI_ENABLED_CHANNELS=feishu$/m);
    assert.match(saved, /^CTI_DEFAULT_WORKDIR=\/tmp\/project$/m);
    assert.match(saved, /^CTI_FEISHU_COMMAND_ADMINS=ou_1,ou_2$/m);
    assert.match(saved, /^CTI_FEISHU_GROUP_TRIGGER_MODE=mention$/m);
    assert.match(saved, /^CTI_DREAMING_ENABLED=true$/m);
    assert.match(saved, /^CTI_DREAMING_TIME=01:00$/m);
    assert.match(saved, /^CTI_DREAMING_TIMEZONE=Asia\/Shanghai$/m);
  });

  it('preserves unknown provider, executable, and legacy non-Feishu env vars when saving config', async () => {
    const { CONFIG_PATH, saveConfig } = await importConfigForHome(tmpDir);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, [
      '# user-managed provider env',
      'ANTHROPIC_API_KEY=keep-anthropic-key',
      'ANTHROPIC_BASE_URL=https://provider.example/v1',
      'ANTHROPIC_AUTH_TOKEN=keep-auth-token',
      'OPENAI_API_KEY=keep-openai-key',
      'CODEX_API_KEY=keep-codex-key',
      'CTI_CLAUDE_CODE_EXECUTABLE=/opt/claude/bin/claude',
      'CTI_TG_BOT_TOKEN=legacy-telegram-token',
      'CTI_QQ_APP_SECRET=legacy-qq-secret',
      'CUSTOM_ENV=keep-custom',
      'CTI_RUNTIME=claude',
      'CTI_DEFAULT_WORKDIR=/old/path',
      '',
    ].join('\n'), { mode: 0o600 });

    saveConfig({
      runtime: 'auto',
      enabledChannels: ['feishu'],
      defaultWorkDir: '/new/path',
      defaultMode: 'plan',
      feishuDomain: 'https://open.larksuite.com',
      feishuGroupTriggerMode: 'mention',
      feishuCommandAdmins: ['ou_admin'],
      dreamingEnabled: false,
    });

    const saved = fs.readFileSync(CONFIG_PATH, 'utf-8');
    assert.match(saved, /^ANTHROPIC_API_KEY=keep-anthropic-key$/m);
    assert.match(saved, /^ANTHROPIC_BASE_URL=https:\/\/provider\.example\/v1$/m);
    assert.match(saved, /^ANTHROPIC_AUTH_TOKEN=keep-auth-token$/m);
    assert.match(saved, /^OPENAI_API_KEY=keep-openai-key$/m);
    assert.match(saved, /^CODEX_API_KEY=keep-codex-key$/m);
    assert.match(saved, /^CTI_CLAUDE_CODE_EXECUTABLE=\/opt\/claude\/bin\/claude$/m);
    assert.match(saved, /^CTI_TG_BOT_TOKEN=legacy-telegram-token$/m);
    assert.match(saved, /^CTI_QQ_APP_SECRET=legacy-qq-secret$/m);
    assert.match(saved, /^CUSTOM_ENV=keep-custom$/m);
    assert.match(saved, /^CTI_RUNTIME=auto$/m);
    assert.match(saved, /^CTI_DEFAULT_WORKDIR=\/new\/path$/m);
    assert.match(saved, /^CTI_DEFAULT_MODE=plan$/m);
    assert.match(saved, /^CTI_FEISHU_DOMAIN=https:\/\/open\.larksuite\.com$/m);
    assert.match(saved, /^CTI_FEISHU_GROUP_TRIGGER_MODE=mention$/m);
    assert.match(saved, /^CTI_FEISHU_COMMAND_ADMINS=ou_admin$/m);
    assert.match(saved, /^CTI_DREAMING_ENABLED=false$/m);
    assert.equal(saved.includes('CTI_DEFAULT_WORKDIR=/old/path'), false);

    const perms = fs.statSync(CONFIG_PATH).mode & 0o777;
    assert.equal(perms, 0o600);
  });
});
