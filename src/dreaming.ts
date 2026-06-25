import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  BridgeStore,
  LLMProvider,
  OwnerChatLogEntry,
} from 'claude-to-im/host';
import type { BridgeOwner } from 'claude-to-im/types';

export interface DreamingOptions {
  enabled?: boolean;
  time?: string;
  timezone?: string;
  model?: string;
  maxLogChars?: number;
  catchupDays?: number;
}

export interface DreamingRunResult {
  ownerKey: string;
  dateKey: string;
  status: 'completed' | 'skipped' | 'conflict' | 'error';
  reason?: string;
}

interface DreamingOutput {
  readme: string;
  todo: string;
  summary?: string;
}

const DEFAULT_TIME = '01:00';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_MAX_LOG_CHARS = 60_000;
const DEFAULT_CATCHUP_DAYS = 1;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readText(filePath: string, fallback = ''): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return fallback;
  }
}

function writePrivate(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function partsInTimezone(date: Date, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const p = partsInTimezone(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - timezoneOffsetMs(new Date(utc), timezone);
  }
  return new Date(utc);
}

export function localDateKey(date: Date, timezone = DEFAULT_TIMEZONE): string {
  const p = partsInTimezone(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map((v) => Number(v));
  const d = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));
  return d.toISOString().slice(0, 10);
}

function startOfLocalDate(dateKey: string, timezone: string): Date {
  const [year, month, day] = dateKey.split('-').map((v) => Number(v));
  return zonedTimeToUtc(year, month, day, 0, 0, timezone);
}

export function computeCatchupDateKeys(
  lastRunDate: string | undefined,
  todayKey: string,
  catchupDays = DEFAULT_CATCHUP_DAYS,
): string[] {
  const maxDays = Math.max(1, Math.floor(catchupDays));
  let first = lastRunDate ? addDays(lastRunDate, 1) : todayKey;
  const min = addDays(todayKey, -(maxDays - 1));
  if (first < min) first = min;
  const keys: string[] = [];
  for (let key = first; key <= todayKey; key = addDays(key, 1)) {
    keys.push(key);
  }
  return keys;
}

export function computeNextRun(now = new Date(), time = DEFAULT_TIME, timezone = DEFAULT_TIMEZONE): Date {
  const [hour, minute] = time.split(':').map((v) => Number(v));
  const p = partsInTimezone(now, timezone);
  let candidate = zonedTimeToUtc(p.year, p.month, p.day, hour, minute, timezone);
  if (candidate.getTime() <= now.getTime()) {
    const nextLocal = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 12, 0, 0));
    const n = partsInTimezone(nextLocal, timezone);
    candidate = zonedTimeToUtc(n.year, n.month, n.day, hour, minute, timezone);
  }
  return candidate;
}

function formatLogs(logs: OwnerChatLogEntry[]): string {
  return logs.map((entry) => {
    const who = entry.role === 'assistant' ? 'assistant' : entry.senderName || entry.senderId || 'user';
    return `[${entry.createdAt}] ${who}: ${entry.text}`;
  }).join('\n');
}

function extractJsonObject(text: string): DreamingOutput {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const parsed = JSON.parse(raw) as Partial<DreamingOutput>;
  if (!parsed.readme || !parsed.todo) {
    throw new Error('Dreaming response missing readme/todo');
  }
  return {
    readme: parsed.readme.trimEnd() + '\n',
    todo: parsed.todo.trimEnd() + '\n',
    summary: parsed.summary,
  };
}

async function collectText(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of value.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6)) as { type?: string; data?: string };
        if (event.type === 'text' && typeof event.data === 'string') text += event.data;
      } catch { /* ignore malformed chunks */ }
    }
  }
  return text;
}

function buildPrompt(owner: BridgeOwner, readme: string, todo: string, logs: OwnerChatLogEntry[]): string {
  return [
    '你是 Feishu owner 工作区的 nightly dreaming 维护器。',
    '根据最近聊天日志，更新 README.md 和 TODO.md。保持事实准确，不要编造外部信息。',
    '只输出 JSON，格式为 {"readme":"...","todo":"...","summary":"..."}。',
    '',
    `Owner: ${owner.displayName || owner.chatId}`,
    '',
    '当前 README.md:',
    readme || '(empty)',
    '',
    '当前 TODO.md:',
    todo || '(empty)',
    '',
    '最近聊天日志:',
    formatLogs(logs) || '(no logs)',
  ].join('\n');
}

export async function runDreamingForOwner(
  store: BridgeStore,
  llm: LLMProvider,
  owner: BridgeOwner,
  options: DreamingOptions = {},
  now = new Date(),
): Promise<DreamingRunResult> {
  if (!store.getOwnerWorkspace || !store.getOwnerChatLogs || !store.updateDreamingState) {
    return { ownerKey: owner.ownerKey, dateKey: localDateKey(now, options.timezone), status: 'skipped', reason: 'store does not support dreaming' };
  }

  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const dateKey = localDateKey(now, timezone);
  const previous = store.getDreamingState?.(owner.ownerKey);
  if (previous?.running) {
    return { ownerKey: owner.ownerKey, dateKey, status: 'skipped', reason: 'already running' };
  }
  if (previous?.lastRunDate === dateKey && (previous.status === 'completed' || previous.status === 'skipped')) {
    return { ownerKey: owner.ownerKey, dateKey, status: 'skipped', reason: 'already completed' };
  }

  store.updateDreamingState(owner.ownerKey, { running: true, status: 'running', error: undefined });
  const workspace = store.getOwnerWorkspace(owner.ownerKey);
  const readmePath = path.join(workspace, 'README.md');
  const todoPath = path.join(workspace, 'TODO.md');
  const artifactDir = path.join(workspace, '.cti', 'dreaming');
  ensureDir(artifactDir);

  const readmeBefore = readText(readmePath);
  const todoBefore = readText(todoPath);
  const readmeHash = sha256(readmeBefore);
  const todoHash = sha256(todoBefore);
  if (
    previous?.status === 'completed'
    && ((previous.readmeHash && previous.readmeHash !== readmeHash)
      || (previous.todoHash && previous.todoHash !== todoHash))
  ) {
    store.updateDreamingState(owner.ownerKey, {
      running: false,
      status: 'conflict',
      error: 'README.md or TODO.md changed since the previous dreaming run',
    });
    return { ownerKey: owner.ownerKey, dateKey, status: 'conflict', reason: 'previous hash conflict' };
  }

  try {
    const logDateKey = addDays(dateKey, -1);
    const logs = store.getOwnerChatLogs(owner.ownerKey, {
      since: startOfLocalDate(logDateKey, timezone).toISOString(),
      until: new Date(startOfLocalDate(dateKey, timezone).getTime() - 1).toISOString(),
      maxChars: options.maxLogChars || DEFAULT_MAX_LOG_CHARS,
    });
    if (logs.length === 0) {
      store.updateDreamingState(owner.ownerKey, {
        running: false,
        status: 'skipped',
        lastRunDate: dateKey,
        lastRunAt: now.toISOString(),
      });
      return { ownerKey: owner.ownerKey, dateKey, status: 'skipped', reason: 'no logs' };
    }

    const stream = llm.streamChat({
      prompt: buildPrompt(owner, readmeBefore, todoBefore, logs),
      sessionId: `${owner.ownerKey}:dreaming:${dateKey}`,
      model: options.model,
      workingDirectory: workspace,
      permissionMode: 'default',
      conversationHistory: [],
    });
    const output = extractJsonObject(await collectText(stream));

    const currentReadmeHash = sha256(readText(readmePath));
    const currentTodoHash = sha256(readText(todoPath));
    if (currentReadmeHash !== readmeHash || currentTodoHash !== todoHash) {
      store.updateDreamingState(owner.ownerKey, {
        running: false,
        status: 'conflict',
        error: 'README.md or TODO.md changed during dreaming run',
      });
      return { ownerKey: owner.ownerKey, dateKey, status: 'conflict', reason: 'hash conflict' };
    }

    writePrivate(readmePath, output.readme);
    writePrivate(todoPath, output.todo);
    writePrivate(path.join(artifactDir, `${dateKey}.json`), JSON.stringify({
      ownerKey: owner.ownerKey,
      dateKey,
      generatedAt: new Date().toISOString(),
      logCount: logs.length,
      summary: output.summary || '',
      readmeHashBefore: readmeHash,
      todoHashBefore: todoHash,
      readmeHashAfter: sha256(output.readme),
      todoHashAfter: sha256(output.todo),
    }, null, 2));

    store.updateDreamingState(owner.ownerKey, {
      running: false,
      status: 'completed',
      lastRunDate: dateKey,
      lastRunAt: new Date().toISOString(),
      readmeHash: sha256(output.readme),
      todoHash: sha256(output.todo),
      error: undefined,
    });
    return { ownerKey: owner.ownerKey, dateKey, status: 'completed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.updateDreamingState(owner.ownerKey, {
      running: false,
      status: 'error',
      error: message,
      lastRunAt: new Date().toISOString(),
    });
    return { ownerKey: owner.ownerKey, dateKey, status: 'error', reason: message };
  }
}

export class DreamingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private store: BridgeStore,
    private llm: LLMProvider,
    private options: DreamingOptions,
  ) {}

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()): Promise<DreamingRunResult[]> {
    if (this.running) return [];
    if (!this.store.listOwners) return [];
    this.running = true;
    try {
      const owners = this.store.listOwners();
      const results: DreamingRunResult[] = [];
      for (const owner of owners) {
        const timezone = this.options.timezone || DEFAULT_TIMEZONE;
        const todayKey = localDateKey(now, timezone);
        const state = this.store.getDreamingState?.(owner.ownerKey);
        const dates = computeCatchupDateKeys(state?.lastRunDate, todayKey, this.options.catchupDays || DEFAULT_CATCHUP_DAYS);
        for (const dateKey of dates) {
          const runAt = startOfLocalDate(dateKey, timezone);
          results.push(await runDreamingForOwner(this.store, this.llm, owner, this.options, runAt));
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  private scheduleNext(): void {
    const next = computeNextRun(new Date(), this.options.time || DEFAULT_TIME, this.options.timezone || DEFAULT_TIMEZONE);
    const delay = Math.max(1_000, next.getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runOnce().catch((err) => {
        console.error('[dreaming] scheduled run failed:', err instanceof Error ? err.message : err);
      }).finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
    console.log(`[dreaming] next run at ${next.toISOString()}`);
  }
}

export function startDreamingScheduler(
  store: BridgeStore,
  llm: LLMProvider,
  options: DreamingOptions,
): DreamingScheduler | null {
  if (!options.enabled) return null;
  const scheduler = new DreamingScheduler(store, llm, options);
  scheduler.start();
  return scheduler;
}
