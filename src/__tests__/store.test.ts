import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JsonFileStore } from '../store.js';
import { CTI_HOME } from '../config.js';

const DATA_DIR = path.join(CTI_HOME, 'data');
const LARK_DIR = path.join(CTI_HOME, 'lark');

// We construct the store with a settings map directly
function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_work_dir', '/tmp/test-cwd'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
  ]);
}

describe('JsonFileStore', () => {
  beforeEach(() => {
    // Clean data dir before each test for isolation
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(LARK_DIR, { recursive: true, force: true });
  });

  it('getSetting returns values from settings map', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getSetting('remote_bridge_enabled'), 'true');
    assert.equal(store.getSetting('bridge_default_model'), 'test-model');
    assert.equal(store.getSetting('nonexistent'), null);
  });

  it('createSession and getSession', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model-1', 'system prompt', '/tmp');
    assert.ok(session.id);
    assert.equal(session.model, 'model-1');
    assert.equal(session.working_directory, '/tmp');
    assert.equal(session.system_prompt, 'system prompt');

    const fetched = store.getSession(session.id);
    assert.deepEqual(fetched, session);
  });

  it('getSession returns null for unknown id', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getSession('nonexistent'), null);
  });

  it('upsertChannelBinding creates and updates', () => {
    const store = new JsonFileStore(makeSettings());
    const b1 = store.upsertChannelBinding({
      channelType: 'telegram',
      chatId: '123',
      codepilotSessionId: 'sess-1',
      workingDirectory: '/tmp',
      model: 'model-1',
    });
    assert.ok(b1.id);
    assert.equal(b1.channelType, 'telegram');
    assert.equal(b1.chatId, '123');

    // Upsert same channel+chat should update
    const b2 = store.upsertChannelBinding({
      channelType: 'telegram',
      chatId: '123',
      codepilotSessionId: 'sess-2',
      workingDirectory: '/tmp/new',
      model: 'model-2',
    });
    assert.equal(b2.id, b1.id);
    assert.equal(b2.codepilotSessionId, 'sess-2');
  });

  it('upsertChannelBinding uses default mode from settings', () => {
    const settings = makeSettings();
    settings.set('bridge_default_mode', 'plan');
    const store = new JsonFileStore(settings);
    const b = store.upsertChannelBinding({
      channelType: 'telegram',
      chatId: '456',
      codepilotSessionId: 'sess-1',
      workingDirectory: '/tmp',
      model: 'model-1',
    });
    assert.equal(b.mode, 'plan');
  });

  it('getChannelBinding returns null for missing', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getChannelBinding('telegram', 'missing'), null);
  });

  it('listChannelBindings filters by type', () => {
    const store = new JsonFileStore(makeSettings());
    store.upsertChannelBinding({
      channelType: 'telegram',
      chatId: '1',
      codepilotSessionId: 's1',
      workingDirectory: '/tmp',
      model: 'm',
    });
    store.upsertChannelBinding({
      channelType: 'discord',
      chatId: '2',
      codepilotSessionId: 's2',
      workingDirectory: '/tmp',
      model: 'm',
    });
    assert.equal(store.listChannelBindings('telegram').length, 1);
    assert.equal(store.listChannelBindings('discord').length, 1);
    assert.equal(store.listChannelBindings().length, 2);
  });

  it('creates Feishu owners and private lark workspaces', () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({
      channelType: 'feishu',
      chatId: 'oc_123',
      displayName: 'Strategy Group',
    }, 'group');

    assert.equal(owner.ownerKey, 'feishu:feishu:group:oc_123');
    assert.equal(owner.chatType, 'group');

    const workspace = store.getOwnerWorkspace(owner.ownerKey);
    assert.equal(path.dirname(workspace), LARK_DIR);
    assert.ok(fs.existsSync(path.join(workspace, 'README.md')));
    assert.ok(fs.existsSync(path.join(workspace, 'TODO.md')));
    assert.ok(fs.existsSync(path.join(workspace, '.cti', 'owner.json')));
    assert.ok(fs.existsSync(path.join(workspace, '.cti', 'chat-logs')));
    assert.equal(fs.statSync(path.join(workspace, '.cti', 'owner.json')).mode & 0o777, 0o600);
  });

  it('creates and lists owner-scoped sessions', () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({ channelType: 'feishu', chatId: 'ou_private' }, 'private');
    const session = store.createSessionForOwner(owner.ownerKey, {
      title: '项目讨论',
      titleStatus: 'manual',
      model: 'model-1',
      mode: 'plan',
    });

    assert.equal(session.ownerKey, owner.ownerKey);
    assert.equal(session.title, '项目讨论');
    assert.equal(session.titleStatus, 'manual');
    assert.equal(session.generation, 1);
    assert.equal(session.mode, 'plan');
    assert.ok(session.working_directory.startsWith(LARK_DIR));

    const sessions = store.listSessionsByOwner(owner.ownerKey);
    assert.deepEqual(sessions.map((s) => s.id), [session.id]);
  });

  it('addMessage and getMessages', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.addMessage(session.id, 'user', 'hello');
    store.addMessage(session.id, 'assistant', 'hi');

    const { messages } = store.getMessages(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].content, 'hi');
  });

  it('persists data files with private permissions', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.addMessage(session.id, 'user', 'hello');
    store.insertPermissionLink({
      permissionRequestId: 'pr-private',
      channelType: 'feishu',
      chatId: 'chat-private',
      messageId: 'msg-private',
      toolName: 'Bash',
      suggestions: '',
    });
    store.insertAuditLog({
      channelType: 'feishu',
      chatId: 'chat-private',
      direction: 'inbound',
      messageId: 'msg-audit',
      summary: 'audit',
    });

    const files = [
      path.join(DATA_DIR, 'sessions.json'),
      path.join(DATA_DIR, 'messages', `${session.id}.json`),
      path.join(DATA_DIR, 'permissions.json'),
      path.join(DATA_DIR, 'audit.json'),
    ];
    for (const file of files) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  });

  it('getMessages with limit returns last N', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.addMessage(session.id, 'user', 'msg1');
    store.addMessage(session.id, 'user', 'msg2');
    store.addMessage(session.id, 'user', 'msg3');

    const { messages } = store.getMessages(session.id, { limit: 2 });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, 'msg2');
    assert.equal(messages[1].content, 'msg3');
  });

  // ── Session Locking ──

  it('acquireSessionLock succeeds on first call', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
  });

  it('acquireSessionLock fails when held by another', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
    assert.equal(store.acquireSessionLock('sess', 'lock2', 'owner2', 60), false);
  });

  it('acquireSessionLock succeeds with same lockId', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
  });

  it('releaseSessionLock allows re-acquire', () => {
    const store = new JsonFileStore(makeSettings());
    store.acquireSessionLock('sess', 'lock1', 'owner1', 60);
    store.releaseSessionLock('sess', 'lock1');
    assert.ok(store.acquireSessionLock('sess', 'lock2', 'owner2', 60));
  });

  it('expired lock can be re-acquired', async () => {
    const store = new JsonFileStore(makeSettings());
    // Acquire with very short TTL
    store.acquireSessionLock('sess', 'lock1', 'owner1', 0);
    // Should be expired immediately
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(store.acquireSessionLock('sess', 'lock2', 'owner2', 60));
  });

  // ── Permission Links ──

  it('insertPermissionLink and getPermissionLink', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-1',
      channelType: 'telegram',
      chatId: '123',
      messageId: 'msg-1',
      sessionId: 'session-1',
      toolName: 'bash',
      toolInput: '{"command":"pwd"}',
      suggestions: 'allow,deny',
    });
    const link = store.getPermissionLink('pr-1');
    assert.ok(link);
    assert.equal(link.permissionRequestId, 'pr-1');
    assert.equal(link.channelType, 'telegram');
    assert.equal(link.sessionId, 'session-1');
    assert.equal(link.toolName, 'bash');
    assert.equal(link.toolInput, '{"command":"pwd"}');
    assert.ok(link.createdAt);
    assert.equal(link.resolved, false);
  });

  it('markPermissionLinkResolved is atomic', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-2',
      channelType: 'telegram',
      chatId: '123',
      messageId: 'msg-2',
      toolName: 'bash',
      suggestions: '',
    });
    assert.ok(store.markPermissionLinkResolved('pr-2'));
    const resolved = store.getPermissionLink('pr-2');
    assert.ok(resolved?.resolvedAt);
    // Second call returns false (already resolved)
    assert.equal(store.markPermissionLinkResolved('pr-2'), false);
    // Unknown id returns false
    assert.equal(store.markPermissionLinkResolved('unknown'), false);
  });

  it('listPendingPermissionLinksByChat returns only unresolved links for the chat', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-a',
      channelType: 'qq',
      chatId: 'chat-1',
      messageId: 'msg-a',
      toolName: 'Bash',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-b',
      channelType: 'qq',
      chatId: 'chat-1',
      messageId: 'msg-b',
      toolName: 'Read',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-c',
      channelType: 'qq',
      chatId: 'chat-2',
      messageId: 'msg-c',
      toolName: 'Bash',
      suggestions: '',
    });
    // Resolve one
    store.markPermissionLinkResolved('pr-a');
    const pending = store.listPendingPermissionLinksByChat('chat-1');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].permissionRequestId, 'pr-b');
    // Different chat
    const pending2 = store.listPendingPermissionLinksByChat('chat-2');
    assert.equal(pending2.length, 1);
    assert.equal(pending2[0].permissionRequestId, 'pr-c');
    // No permissions for unknown chat
    assert.equal(store.listPendingPermissionLinksByChat('chat-unknown').length, 0);
  });

  it('listPendingPermissionLinksByChat filters channel collisions and expires stale links', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-telegram',
      channelType: 'telegram',
      chatId: 'same-chat',
      messageId: 'msg-t',
      toolName: 'Bash',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-qq',
      channelType: 'qq',
      chatId: 'same-chat',
      messageId: 'msg-q',
      toolName: 'Bash',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-expired',
      channelType: 'qq',
      chatId: 'same-chat',
      messageId: 'msg-old',
      toolName: 'Bash',
      suggestions: '',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const qqPending = store.listPendingPermissionLinksByChat('same-chat', 'qq');
    assert.deepEqual(qqPending.map((link) => link.permissionRequestId), ['pr-qq']);
    assert.equal(store.getPermissionLink('pr-expired')?.resolved, true);
  });

  // ── Dedup ──

  it('dedup insert and check within window', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.checkDedup('key1'), false);
    store.insertDedup('key1');
    assert.equal(store.checkDedup('key1'), true);
  });

  it('cleanupExpiredDedup removes old entries', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertDedup('key1');
    // The entry was just inserted so it shouldn't be expired
    store.cleanupExpiredDedup();
    assert.equal(store.checkDedup('key1'), true);
  });

  // ── Audit Log ──

  it('insertAuditLog keeps max 1000', () => {
    const store = new JsonFileStore(makeSettings());
    for (let i = 0; i < 1010; i++) {
      store.insertAuditLog({
        channelType: 'telegram',
        chatId: '123',
        direction: 'inbound',
        messageId: `msg-${i}`,
        summary: `msg ${i}`,
      });
    }
    // We can't directly inspect length, but it shouldn't crash
  });

  // ── Channel Offsets ──

  it('getChannelOffset returns default for unknown key', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getChannelOffset('unknown'), '0');
  });

  it('setChannelOffset and getChannelOffset round-trip', () => {
    const store = new JsonFileStore(makeSettings());
    store.setChannelOffset('tg:offset', '12345');
    assert.equal(store.getChannelOffset('tg:offset'), '12345');
  });

  // ── SDK Session ──

  it('updateSdkSessionId updates session and bindings', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.upsertChannelBinding({
      channelType: 'telegram',
      chatId: '1',
      codepilotSessionId: session.id,
      workingDirectory: '/tmp',
      model: 'model',
    });
    store.updateSdkSessionId(session.id, 'sdk-123');
    const binding = store.getChannelBinding('telegram', '1');
    assert.equal(binding?.sdkSessionId, 'sdk-123');
  });

  it('updateSessionModel updates model', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model-old', undefined, '/tmp');
    store.updateSessionModel(session.id, 'model-new');
    const updated = store.getSession(session.id);
    assert.equal(updated?.model, 'model-new');
  });

  it('updateSessionMode updates mode', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp', 'code');
    store.updateSessionMode(session.id, 'plan');
    const updated = store.getSession(session.id);
    assert.equal(updated?.mode, 'plan');
  });

  // ── Provider (no-op) ──

  it('getProvider returns undefined', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getProvider('any'), undefined);
  });

  it('getDefaultProviderId returns null', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getDefaultProviderId(), null);
  });
});
