import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { LLMProvider, StreamChatParams } from 'claude-to-im/host';
import { computeCatchupDateKeys, computeNextRun, DreamingScheduler, localDateKey, runDreamingForOwner } from '../dreaming.js';
import { JsonFileStore } from '../store.js';
import { CTI_HOME } from '../config.js';

const DATA_DIR = path.join(CTI_HOME, 'data');
const LARK_DIR = path.join(CTI_HOME, 'lark');

function makeSettings(): Map<string, string> {
  return new Map([
    ['bridge_default_model', 'test-model'],
    ['bridge_default_work_dir', '/tmp/test-cwd'],
    ['bridge_feishu_domain', 'feishu'],
  ]);
}

function sseText(text: string): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(`data: ${JSON.stringify({ type: 'text', data: text })}\n\n`);
      controller.close();
    },
  });
}

class FakeLLM implements LLMProvider {
  prompts: StreamChatParams[] = [];

  constructor(private output: string) {}

  streamChat(params: StreamChatParams): ReadableStream<string> {
    this.prompts.push(params);
    return sseText(this.output);
  }
}

describe('dreaming', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(LARK_DIR, { recursive: true, force: true });
  });

  it('computes Beijing 01:00 next run', () => {
    const before = new Date('2026-06-24T16:30:00.000Z'); // 2026-06-25 00:30 Beijing
    const after = new Date('2026-06-24T17:30:00.000Z'); // 2026-06-25 01:30 Beijing

    assert.equal(computeNextRun(before, '01:00', 'Asia/Shanghai').toISOString(), '2026-06-24T17:00:00.000Z');
    assert.equal(computeNextRun(after, '01:00', 'Asia/Shanghai').toISOString(), '2026-06-25T17:00:00.000Z');
    assert.equal(localDateKey(before, 'Asia/Shanghai'), '2026-06-25');
    assert.deepEqual(computeCatchupDateKeys('2026-06-23', '2026-06-26', 2), ['2026-06-25', '2026-06-26']);
  });

  it('writes owner chat logs and runs structured README/TODO update', async () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({ channelType: 'feishu', chatId: 'oc_1', displayName: 'Ops' }, 'group');
    const workspace = store.getOwnerWorkspace(owner.ownerKey);
    store.appendOwnerChatLog({
      ownerKey: owner.ownerKey,
      sessionId: 'session-1',
      channelType: 'feishu',
      chatId: 'oc_1',
      direction: 'inbound',
      role: 'user',
      text: '请跟进 Q3 发布计划',
      createdAt: '2026-06-25T03:00:00.000Z',
    });

    const logFile = path.join(workspace, '.cti', 'chat-logs', '2026-06-25.jsonl');
    assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);

    const llm = new FakeLLM(JSON.stringify({
      readme: '# Ops\n\nQ3 发布计划正在跟进。',
      todo: '# TODO\n\n- [ ] 跟进 Q3 发布计划',
      summary: 'updated project memory',
    }));

    const result = await runDreamingForOwner(store, llm, owner, { timezone: 'Asia/Shanghai' }, new Date('2026-06-25T17:10:00.000Z'));

    assert.equal(result.status, 'completed');
    assert.match(fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'), /Q3 发布计划/);
    assert.match(fs.readFileSync(path.join(workspace, 'TODO.md'), 'utf-8'), /跟进 Q3 发布计划/);
    assert.equal(store.getDreamingState(owner.ownerKey)?.lastRunDate, '2026-06-26');
    assert.equal(llm.prompts.length, 1);
    assert.ok(fs.existsSync(path.join(workspace, '.cti', 'dreaming', '2026-06-26.json')));
  });

  it('does not overwrite README/TODO when hash conflict is detected', async () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({ channelType: 'feishu', chatId: 'oc_2' }, 'group');
    const workspace = store.getOwnerWorkspace(owner.ownerKey);
    store.appendOwnerChatLog({
      ownerKey: owner.ownerKey,
      channelType: 'feishu',
      chatId: 'oc_2',
      direction: 'inbound',
      role: 'user',
      text: '更新项目记忆',
      createdAt: '2026-06-25T03:00:00.000Z',
    });

    const llm: LLMProvider = {
      streamChat() {
        fs.writeFileSync(path.join(workspace, 'README.md'), '# Manual edit\n', 'utf-8');
        return sseText(JSON.stringify({
          readme: '# Generated\n',
          todo: '# TODO\n\n- [ ] Generated',
        }));
      },
    };

    const result = await runDreamingForOwner(store, llm, owner, { timezone: 'Asia/Shanghai' }, new Date('2026-06-25T17:10:00.000Z'));

    assert.equal(result.status, 'conflict');
    assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'), '# Manual edit\n');
    assert.equal(store.getDreamingState(owner.ownerKey)?.status, 'conflict');
  });

  it('does not overwrite README/TODO when files changed since previous completed run', async () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({ channelType: 'feishu', chatId: 'oc_3' }, 'group');
    const workspace = store.getOwnerWorkspace(owner.ownerKey);
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Previous\n', 'utf-8');
    fs.writeFileSync(path.join(workspace, 'TODO.md'), '# TODO\n\n- [ ] Previous\n', 'utf-8');
    store.appendOwnerChatLog({
      ownerKey: owner.ownerKey,
      channelType: 'feishu',
      chatId: 'oc_3',
      direction: 'inbound',
      role: 'user',
      text: '第一天更新',
      createdAt: '2026-06-25T03:00:00.000Z',
    });
    await runDreamingForOwner(store, new FakeLLM(JSON.stringify({
      readme: '# First generated',
      todo: '# TODO\n\n- [ ] First generated',
    })), owner, { timezone: 'Asia/Shanghai' }, new Date('2026-06-25T17:10:00.000Z'));

    fs.writeFileSync(path.join(workspace, 'README.md'), '# Manual after run\n', 'utf-8');
    store.appendOwnerChatLog({
      ownerKey: owner.ownerKey,
      channelType: 'feishu',
      chatId: 'oc_3',
      direction: 'inbound',
      role: 'user',
      text: '第二天继续更新',
      createdAt: '2026-06-26T03:00:00.000Z',
    });

    const result = await runDreamingForOwner(store, new FakeLLM(JSON.stringify({
      readme: '# Second generated',
      todo: '# TODO\n\n- [ ] Second generated',
    })), owner, { timezone: 'Asia/Shanghai' }, new Date('2026-06-26T17:10:00.000Z'));

    assert.equal(result.status, 'conflict');
    assert.equal(fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'), '# Manual after run\n');
  });

  it('scheduler catches up missed owner dates within the configured window', async () => {
    const store = new JsonFileStore(makeSettings());
    const owner = store.getOrCreateOwner({ channelType: 'feishu', chatId: 'oc_4' }, 'group');
    for (const day of ['2026-06-24', '2026-06-25']) {
      store.appendOwnerChatLog({
        ownerKey: owner.ownerKey,
        channelType: 'feishu',
        chatId: 'oc_4',
        direction: 'inbound',
        role: 'user',
        text: `日志 ${day}`,
        createdAt: `${day}T03:00:00.000Z`,
      });
    }
    store.updateDreamingState(owner.ownerKey, {
      lastRunDate: '2026-06-24',
      status: 'skipped',
    });
    const scheduler = new DreamingScheduler(store, new FakeLLM(JSON.stringify({
      readme: '# Catchup',
      todo: '# TODO\n\n- [ ] Catchup',
    })), { enabled: true, timezone: 'Asia/Shanghai', catchupDays: 3 });

    const results = await scheduler.runOnce(new Date('2026-06-25T17:10:00.000Z'));

    assert.deepEqual(results.map((r) => r.dateKey), ['2026-06-25', '2026-06-26']);
    assert.equal(results[0].status, 'completed');
    assert.equal(results[1].status, 'completed');
  });
});
