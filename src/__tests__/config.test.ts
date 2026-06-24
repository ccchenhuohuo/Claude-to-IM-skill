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

  it('sets channel enabled flags based on enabledChannels', () => {
    const m = configToSettings({ ...base, enabledChannels: ['telegram', 'discord'] });
    assert.equal(m.get('bridge_telegram_enabled'), 'true');
    assert.equal(m.get('bridge_discord_enabled'), 'true');
    assert.equal(m.get('bridge_feishu_enabled'), 'false');
  });

  it('maps telegram config', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['telegram'],
      tgBotToken: 'bot123:abc',
      tgAllowedUsers: ['user1', 'user2'],
      tgChatId: '99999',
    });
    assert.equal(m.get('telegram_bot_token'), 'bot123:abc');
    assert.equal(m.get('telegram_bridge_allowed_users'), 'user1,user2');
    assert.equal(m.get('telegram_chat_id'), '99999');
  });

  it('maps discord config', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['discord'],
      discordBotToken: 'discord-token',
      discordAllowedUsers: ['u1'],
      discordAllowedChannels: ['c1', 'c2'],
      discordAllowedGuilds: ['g1'],
    });
    assert.equal(m.get('bridge_discord_bot_token'), 'discord-token');
    assert.equal(m.get('bridge_discord_allowed_users'), 'u1');
    assert.equal(m.get('bridge_discord_allowed_channels'), 'c1,c2');
    assert.equal(m.get('bridge_discord_allowed_guilds'), 'g1');
  });

  it('maps feishu config', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['feishu'],
      feishuAppId: 'app-id',
      feishuAppSecret: 'app-secret',
      feishuDomain: 'https://open.feishu.cn',
      feishuAllowedUsers: ['fu1'],
    });
    assert.equal(m.get('bridge_feishu_app_id'), 'app-id');
    assert.equal(m.get('bridge_feishu_app_secret'), 'app-secret');
    assert.equal(m.get('bridge_feishu_domain'), 'feishu');
    assert.equal(m.get('bridge_feishu_allowed_users'), 'fu1');
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

  it('sets bridge_qq_enabled based on enabledChannels', () => {
    const m = configToSettings({ ...base, enabledChannels: ['qq'] });
    assert.equal(m.get('bridge_qq_enabled'), 'true');
    assert.equal(m.get('bridge_telegram_enabled'), 'false');
  });

  it('defaults bridge_qq_enabled to false', () => {
    const m = configToSettings(base);
    assert.equal(m.get('bridge_qq_enabled'), 'false');
  });

  it('maps qq config fields', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['qq'],
      qqAppId: 'qq-app-id',
      qqAppSecret: 'qq-secret',
      qqAllowedUsers: ['openid1', 'openid2'],
    });
    assert.equal(m.get('bridge_qq_app_id'), 'qq-app-id');
    assert.equal(m.get('bridge_qq_app_secret'), 'qq-secret');
    assert.equal(m.get('bridge_qq_allowed_users'), 'openid1,openid2');
  });

  it('maps qq image settings', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['qq'],
      qqAppId: 'id',
      qqAppSecret: 'secret',
      qqImageEnabled: false,
      qqMaxImageSize: 10,
    });
    assert.equal(m.get('bridge_qq_image_enabled'), 'false');
    assert.equal(m.get('bridge_qq_max_image_size'), '10');
  });

  it('maps weixin settings', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['weixin'],
      weixinBaseUrl: 'https://example.weixin.test',
      weixinCdnBaseUrl: 'https://cdn.weixin.test',
      weixinMediaEnabled: true,
    });
    assert.equal(m.get('bridge_weixin_enabled'), 'true');
    assert.equal(m.get('bridge_weixin_base_url'), 'https://example.weixin.test');
    assert.equal(m.get('bridge_weixin_cdn_base_url'), 'https://cdn.weixin.test');
    assert.equal(m.get('bridge_weixin_media_enabled'), 'true');
  });

  it('omits qq image settings when not set', () => {
    const m = configToSettings({
      ...base,
      enabledChannels: ['qq'],
      qqAppId: 'id',
      qqAppSecret: 'secret',
    });
    assert.equal(m.has('bridge_qq_image_enabled'), false);
    assert.equal(m.has('bridge_qq_max_image_size'), false);
  });

  it('maps workdir and mode, omits model when not set', () => {
    const m = configToSettings(base);
    assert.equal(m.get('bridge_default_work_dir'), '/tmp/test');
    assert.equal(m.has('bridge_default_model'), false);
    assert.equal(m.has('default_model'), false);
    assert.equal(m.get('bridge_default_mode'), 'code');
  });

  it('maps model when explicitly set', () => {
    const m = configToSettings({ ...base, defaultModel: 'gpt-4o' });
    assert.equal(m.get('bridge_default_model'), 'gpt-4o');
    assert.equal(m.get('default_model'), 'gpt-4o');
  });

  it('maps non-default mode', () => {
    const m = configToSettings({ ...base, defaultMode: 'plan' });
    assert.equal(m.get('bridge_default_mode'), 'plan');
  });

  it('omits optional fields when not set', () => {
    const m = configToSettings(base);
    assert.equal(m.has('telegram_bot_token'), false);
    assert.equal(m.has('bridge_discord_bot_token'), false);
    assert.equal(m.has('bridge_feishu_app_id'), false);
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
    assert.equal(m.get('bridge_telegram_enabled'), 'false');
    assert.equal(m.get('bridge_discord_enabled'), 'false');
    assert.equal(m.get('bridge_feishu_enabled'), 'false');
    assert.equal(m.get('bridge_qq_enabled'), 'false');
    assert.equal(m.get('bridge_weixin_enabled'), 'false');
  });

  it('loads and saves config in an isolated CTI_HOME', async () => {
    const { CONFIG_PATH, loadConfig, saveConfig } = await importConfigForHome(tmpDir);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, 'CTI_RUNTIME=auto\nCTI_ENABLED_CHANNELS=feishu,qq\nCTI_FEISHU_DOMAIN=open.larksuite.com\n', { mode: 0o600 });

    const loaded = loadConfig();
    assert.equal(loaded.runtime, 'auto');
    assert.deepEqual(loaded.enabledChannels, ['feishu', 'qq']);
    assert.equal(loaded.feishuDomain, 'open.larksuite.com');

    saveConfig({
      ...loaded,
      defaultWorkDir: '/tmp/project',
      defaultMode: 'code',
      feishuGroupTriggerMode: 'mention',
    });

    const saved = fs.readFileSync(CONFIG_PATH, 'utf-8');
    assert.match(saved, /^CTI_RUNTIME=auto$/m);
    assert.match(saved, /^CTI_DEFAULT_WORKDIR=\/tmp\/project$/m);
    assert.match(saved, /^CTI_FEISHU_GROUP_TRIGGER_MODE=mention$/m);
  });

  it('preserves unknown provider and executable env vars when saving config', async () => {
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
    });

    const saved = fs.readFileSync(CONFIG_PATH, 'utf-8');
    assert.match(saved, /^ANTHROPIC_API_KEY=keep-anthropic-key$/m);
    assert.match(saved, /^ANTHROPIC_BASE_URL=https:\/\/provider\.example\/v1$/m);
    assert.match(saved, /^ANTHROPIC_AUTH_TOKEN=keep-auth-token$/m);
    assert.match(saved, /^OPENAI_API_KEY=keep-openai-key$/m);
    assert.match(saved, /^CODEX_API_KEY=keep-codex-key$/m);
    assert.match(saved, /^CTI_CLAUDE_CODE_EXECUTABLE=\/opt\/claude\/bin\/claude$/m);
    assert.match(saved, /^CUSTOM_ENV=keep-custom$/m);
    assert.match(saved, /^CTI_RUNTIME=auto$/m);
    assert.match(saved, /^CTI_DEFAULT_WORKDIR=\/new\/path$/m);
    assert.match(saved, /^CTI_DEFAULT_MODE=plan$/m);
    assert.match(saved, /^CTI_FEISHU_DOMAIN=https:\/\/open\.larksuite\.com$/m);
    assert.match(saved, /^CTI_FEISHU_GROUP_TRIGGER_MODE=mention$/m);
    assert.equal(saved.includes('CTI_DEFAULT_WORKDIR=/old/path'), false);

    const perms = fs.statSync(CONFIG_PATH).mode & 0o777;
    assert.equal(perms, 0o600);
  });
});
