import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const hook = (name) => join(repo, 'scripts/hooks', name);
const run = (name, input, env = {}) =>
  spawnSync(name.endsWith('.sh') ? 'bash' : 'node', [hook(name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('hooks', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('protect.mjs (PreToolUse Edit|Write)', () => {
    const migration = join(repo, 'prisma/migrations', execFileSync('ls', [join(repo, 'prisma/migrations')], { encoding: 'utf8' }).split('\n').find((d) => /^\d+_/.test(d)), 'migration.sql');
    const statePath = () => join(dir, '.ai/memory/state.md');
    const writeState = (line) => {
      mkdirSync(join(dir, '.ai/memory'), { recursive: true });
      writeFileSync(statePath(), `# Состояние\n\n${line}\nтекст\n`);
    };
    const AUTO = 'Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-10 · unit 1/1 · e2e 1/1';

    it.each([
      ['.env', join(repo, '.env')],
      ['.env.local', join(repo, '.env.local')],
      ['an applied migration', migration],
    ])('blocks editing %s', (_name, file_path) => {
      const r = run('protect.mjs', { tool_input: { file_path, new_string: 'x' } });
      expect(r.status).toBe(2);
    });

    it.each([
      ['.env.example', join(repo, '.env.example')],
      ['a new migration', join(repo, 'prisma/migrations/29990101000000_new/migration.sql')],
      ['a source file', join(repo, 'src/main.ts')],
    ])('allows editing %s', (_name, file_path) => {
      expect(run('protect.mjs', { tool_input: { file_path, new_string: 'x' } }).status).toBe(0);
    });

    it('blocks an edit that changes the acceptance line in state.md', () => {
      writeState(AUTO);
      const r = run('protect.mjs', { tool_input: { file_path: statePath(), old_string: AUTO, new_string: AUTO.replace('unit 1/1', 'unit 2/2') } });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/accept\.sh/);
    });

    it('allows an edit of state.md that leaves the acceptance line alone', () => {
      writeState(AUTO);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), old_string: 'текст', new_string: 'другой текст' } }).status).toBe(0);
    });

    it('allows rewriting state.md with the acceptance line unchanged and blocks a changed one', () => {
      writeState(AUTO);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), content: `# Новое\n${AUTO}\n` } }).status).toBe(0);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), content: `# Новое\n${AUTO.replace('код 0', 'код 1')}\n` } }).status).toBe(2);
    });

    describe.each(['state.md', 'tasks.md', 'architecture.md'])('stamp line in %s', (name) => {
      const STAMP = '> Проверено: 2026-10-10 @ abc1234';
      const path = () => join(dir, '.ai/memory', name);
      beforeEach(() => {
        mkdirSync(join(dir, '.ai/memory'), { recursive: true });
        writeFileSync(path(), `# Файл\n${STAMP}\n${AUTO}\nтекст\n`);
      });

      it('blocks an edit that changes the stamp', () => {
        const r = run('protect.mjs', { tool_input: { file_path: path(), old_string: STAMP, new_string: '> Проверено: 2026-10-11 @ abc1234' } });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/stamp-memory/);
      });

      it('blocks a rewrite with another stamp and allows one with the same stamp', () => {
        expect(run('protect.mjs', { tool_input: { file_path: path(), content: `# Новое\n> Проверено: 2026-10-11 @ abc1234\n${AUTO}\n` } }).status).toBe(2);
        expect(run('protect.mjs', { tool_input: { file_path: path(), content: `# Новое\n${STAMP}\n${AUTO}\n` } }).status).toBe(0);
      });

      it('allows an edit that leaves the stamp alone', () => {
        expect(run('protect.mjs', { tool_input: { file_path: path(), old_string: 'текст', new_string: 'другой' } }).status).toBe(0);
      });
    });
  });

  describe('format.mjs (PostToolUse Edit|Write)', () => {
    it('formats an edited TypeScript file under src/', () => {
      const file = join(dir, 'src/x.ts');
      mkdirSync(join(dir, 'src'));
      writeFileSync(file, 'const  a = {b:1}\n');
      expect(run('format.mjs', { tool_input: { file_path: file } }).status).toBe(0);
      expect(readFileSync(file, 'utf8')).not.toBe('const  a = {b:1}\n');
    });

    it('leaves files outside src/ and test/ untouched', () => {
      const file = join(dir, 'other/x.ts');
      mkdirSync(join(dir, 'other'));
      writeFileSync(file, 'const  a = {b:1}\n');
      expect(run('format.mjs', { tool_input: { file_path: file } }).status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe('const  a = {b:1}\n');
    });
  });

  describe('stop-gate.mjs (Stop)', () => {
    const project = (memoryExit) => {
      execFileSync('git', ['init', '-q', dir]);
      mkdirSync(join(dir, 'scripts'));
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'scripts/check-memory.sh'), `echo "  ✗ память устарела"\nexit ${memoryExit}\n`);
      execFileSync('git', ['-C', dir, 'add', '.']);
      execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    };

    it('blocks stopping when code changed and the memory check fails', () => {
      project(1);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      const r = run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/память устарела/);
    });

    it('lets the session stop when the tree is clean', () => {
      project(1);
      expect(run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });

    it('lets the session stop when the memory check passes', () => {
      project(0);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      expect(run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });

    it('does not loop when the stop hook already fired', () => {
      project(1);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      expect(run('stop-gate.mjs', { stop_hook_active: true }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });
  });

  describe('session-brief.sh (SessionStart)', () => {
    it('prints the branch, the task in progress, the last acceptance and the focus', () => {
      const r = run('session-brief.sh', {});
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^Ветка: /m);
      expect(r.stdout).toMatch(/^## В работе/m);
      expect(r.stdout).toMatch(/^Автоприёмка /m);
      expect(r.stdout).toMatch(/^## Фокус сейчас/m);
      expect(r.stdout).not.toMatch(/^## Бэклог/m);
    });
  });

  describe('session-guard.mjs (SessionStart, UserPromptSubmit, PreToolUse, SubagentStart, SubagentStop)', () => {
    const SID = 's1';
    const env = () => ({ CLAUDE_PROJECT_DIR: dir, SESSION_GUARD_DIR: join(dir, 'guard') });
    const guard = (input) => run('session-guard.mjs', { session_id: SID, transcript_path: join(dir, `${SID}.jsonl`), cwd: dir, ...input }, env());
    const out = (r) => {
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim() ? JSON.parse(r.stdout) : {};
    };
    const archive = (first) => {
      mkdirSync(join(dir, '.ai/memory'), { recursive: true });
      writeFileSync(join(dir, '.ai/memory/tasks-archive.md'), `# Архив\n\n## Сделано\n- ${first}\n- 2026-01-01 — BE-01: старое\n`);
    };
    const assistant = (model, tokens) =>
      JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: 10, cache_read_input_tokens: tokens - 30, cache_creation_input_tokens: 20, output_tokens: 5 } } });
    const transcript = (file, model, tokens) => {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ type: 'user', message: { content: 'x' } })}\n${assistant('claude-opus-5-5', 1000)}\n${assistant(model, tokens)}\n`);
    };
    const mainTranscript = (model, tokens) => transcript(join(dir, `${SID}.jsonl`), model, tokens);
    const agentTranscript = (id, model, tokens) => transcript(join(dir, SID, 'subagents', `agent-${id}.jsonl`), model, tokens);
    const prompt = (text) => guard({ hook_event_name: 'UserPromptSubmit', prompt: text });
    const tool = (tool_name, tool_input, extra = {}) => guard({ hook_event_name: 'PreToolUse', tool_name, tool_input, ...extra });
    const denied = (r) => out(r).hookSpecificOutput?.permissionDecision === 'deny';

    beforeEach(() => archive('2026-10-15 — BE-39: задача'));

    describe('closed task in this session', () => {
      it('blocks the prompt when the archive got a new first entry after session start', () => {
        expect(guard({ hook_event_name: 'SessionStart', source: 'startup' }).status).toBe(0);
        archive('2026-10-16 — BE-48: закрыта');
        const r = prompt('дальше');
        expect(r.status).toBe(0);
        expect(out(r).decision).toBe('block');
        expect(out(r).reason).toMatch(/задача закрыта в этой сессии — сделай \/clear/);
      });

      it('lets the prompt through while the archive is unchanged', () => {
        guard({ hook_event_name: 'SessionStart', source: 'clear' });
        expect(out(prompt('дальше')).decision).toBeUndefined();
      });

      it('lets a prompt starting with !continue through', () => {
        guard({ hook_event_name: 'SessionStart', source: 'startup' });
        archive('2026-10-16 — BE-48: закрыта');
        expect(out(prompt('!continue доделай PR')).decision).toBeUndefined();
      });

      it('keeps the snapshot on resume and compact', () => {
        guard({ hook_event_name: 'SessionStart', source: 'startup' });
        archive('2026-10-16 — BE-48: закрыта');
        guard({ hook_event_name: 'SessionStart', source: 'resume' });
        guard({ hook_event_name: 'SessionStart', source: 'compact' });
        expect(out(prompt('дальше')).decision).toBe('block');
      });

      it('takes a snapshot on resume when the session has none', () => {
        archive('2026-10-16 — BE-48: закрыта');
        guard({ hook_event_name: 'SessionStart', source: 'resume' });
        expect(out(prompt('дальше')).decision).toBeUndefined();
      });

      it('retakes the snapshot on clear', () => {
        guard({ hook_event_name: 'SessionStart', source: 'startup' });
        archive('2026-10-16 — BE-48: закрыта');
        guard({ hook_event_name: 'SessionStart', source: 'clear' });
        expect(out(prompt('дальше')).decision).toBeUndefined();
      });
    });

    describe('context threshold in the main session', () => {
      beforeEach(() => guard({ hook_event_name: 'SessionStart', source: 'startup' }));

      it.each([
        ['opus above 150 000', 'claude-opus-5-5', 150_001, true],
        ['opus at 140 000', 'claude-opus-5-5', 140_000, false],
        ['sonnet above 90 000', 'claude-sonnet-5-5', 95_000, true],
        ['haiku at 80 000', 'claude-haiku-5-5', 80_000, false],
      ])('prompt: %s → blocked=%s', (_name, model, tokens, blocked) => {
        mainTranscript(model, tokens);
        const r = prompt('дальше');
        expect(out(r).decision === 'block').toBe(blocked);
        if (blocked) expect(out(r).reason).toMatch(/\/clear/);
      });

      it('ignores a missing transcript', () => {
        expect(out(prompt('дальше')).decision).toBeUndefined();
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(false);
      });

      it('denies tools above the threshold and tells the agent to save progress and stop', () => {
        mainTranscript('claude-sonnet-5-5', 95_000);
        const r = tool('Read', { file_path: join(dir, 'src/main.ts') });
        expect(r.status).toBe(0);
        expect(denied(r)).toBe(true);
        expect(out(r).hookSpecificOutput.permissionDecisionReason).toMatch(/Осталось/);
        expect(out(r).hookSpecificOutput.permissionDecisionReason).toMatch(/\/clear/);
        expect(out(r).systemMessage).toMatch(/\/clear/);
      });

      it.each([
        ['Edit of tasks.md', 'Edit', () => ({ file_path: join(dir, '.ai/memory/tasks.md'), old_string: 'a', new_string: 'b' })],
        ['Write of tasks.md', 'Write', () => ({ file_path: join(dir, '.ai/memory/tasks.md'), content: 'x' })],
        ['the memory check', 'Bash', () => ({ command: 'bash scripts/check-memory.sh' })],
        ['Read of tasks.md (Edit needs a fresh Read)', 'Read', () => ({ file_path: join(dir, '.ai/memory/tasks.md'), offset: 1, limit: 30 })],
      ])('allows %s above the threshold', (_name, name, input) => {
        mainTranscript('claude-sonnet-5-5', 95_000);
        expect(denied(tool(name, input()))).toBe(false);
      });

      it.each([
        ['Edit of another file', 'Edit', () => ({ file_path: join(dir, 'src/main.ts'), old_string: 'a', new_string: 'b' })],
        ['a chained command', 'Bash', () => ({ command: 'bash scripts/check-memory.sh && rm x' })],
        ['Edit of a look-alike path', 'Edit', () => ({ file_path: join(dir, 'x.ai/memory/tasks.md'), old_string: 'a', new_string: 'b' })],
      ])('denies %s above the threshold', (_name, name, input) => {
        mainTranscript('claude-sonnet-5-5', 95_000);
        expect(denied(tool(name, input()))).toBe(true);
      });

      it('does not stop exactly at the threshold', () => {
        mainTranscript('claude-sonnet-5-5', 90_000);
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(false);
      });

      it('finds the last answer even when its line is longer than the tail window', () => {
        const file = join(dir, `${SID}.jsonl`);
        const big = JSON.parse(assistant('claude-sonnet-5-5', 95_000));
        big.message.content = [{ type: 'tool_use', input: { content: 'x'.repeat(1_200_000) } }];
        writeFileSync(file, `${assistant('claude-sonnet-5-5', 1000)}\n${JSON.stringify(big)}\n`);
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(true);
      });

      it('does not count an answer from before a compaction', () => {
        mainTranscript('claude-sonnet-5-5', 95_000);
        writeFileSync(join(dir, `${SID}.jsonl`), `${readFileSync(join(dir, `${SID}.jsonl`), 'utf8')}${JSON.stringify({ type: 'system', subtype: 'compact_boundary' })}\n${JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: 'summary' } })}\n`);
        expect(out(prompt('дальше')).decision).toBeUndefined();
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(false);
      });

      it('allows tools below the threshold', () => {
        mainTranscript('claude-opus-5-5', 100_000);
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(false);
      });

      it('!continue lets the prompt through and lifts the tool ban until the next prompt', () => {
        mainTranscript('claude-opus-5-5', 200_000);
        expect(out(prompt('!continue закончи PR')).decision).toBeUndefined();
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(false);
        expect(out(prompt('дальше')).decision).toBe('block');
        expect(denied(tool('Read', { file_path: join(dir, 'x') }))).toBe(true);
      });
    });

    it.each(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'SubagentStart', 'SubagentStop'])('exits 0 silently on garbage input (%s)', () => {
      const r = spawnSync('node', [hook('session-guard.mjs')], { input: 'not json', encoding: 'utf8', env: { ...process.env, ...env() } });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    });

    describe('context threshold in a subagent', () => {
      const AGENT = { agent_id: 'a1', agent_type: 'nestjs-reviewer' };

      it('denies every tool, including Edit of tasks.md, above the subagent model threshold', () => {
        mainTranscript('claude-opus-5-5', 1000);
        agentTranscript('a1', 'claude-sonnet-5-5', 95_000);
        const read = tool('Read', { file_path: join(dir, 'x') }, AGENT);
        expect(denied(read)).toBe(true);
        expect(out(read).hookSpecificOutput.permissionDecisionReason).toMatch(/отчёт/);
        expect(denied(tool('Edit', { file_path: join(dir, '.ai/memory/tasks.md'), old_string: 'a', new_string: 'b' }, AGENT))).toBe(true);
      });

      it('counts the subagent transcript, not the main one', () => {
        mainTranscript('claude-opus-5-5', 500_000);
        agentTranscript('a1', 'claude-haiku-5-5', 50_000);
        expect(denied(tool('Read', { file_path: join(dir, 'x') }, AGENT))).toBe(false);
      });

      it('also accepts transcript_path that already points to the subagent transcript', () => {
        agentTranscript('a1', 'claude-sonnet-5-5', 95_000);
        expect(denied(tool('Read', { file_path: join(dir, 'x') }, { ...AGENT, transcript_path: join(dir, SID, 'subagents', 'agent-a1.jsonl') }))).toBe(true);
      });

    });

    describe('subagent handoff', () => {
      const TYPE = 'nestjs-reviewer';
      const HOUR = 3_600_000;
      const handoffDir = () => join(dir, '.claude/handoff');
      const handoffPath = (name) => join(handoffDir(), name);
      const files = () => (existsSync(handoffDir()) ? readdirSync(handoffDir()).sort() : []);
      const inProgress = (task) => {
        mkdirSync(join(dir, '.ai/memory'), { recursive: true });
        const current = task ? `- **${task} (P3)** Текущая задача\n  - Цель: x\n` : '';
        writeFileSync(join(dir, '.ai/memory/tasks.md'), `# Задачи\n\n## В работе\n${current}\n## Бэклог\n- **BE-46 (P3)** Другая задача\n`);
      };
      const stop = (agent_id, report, agent_type = TYPE) => {
        agentTranscript(agent_id, 'claude-sonnet-5-5', 95_000);
        tool('Read', { file_path: join(dir, 'x') }, { agent_id, agent_type });
        expect(guard({ hook_event_name: 'SubagentStop', agent_id, agent_type, stop_hook_active: false, last_assistant_message: report }).status).toBe(0);
      };
      const finish = (agent_id, agent_type = TYPE) =>
        expect(guard({ hook_event_name: 'SubagentStop', agent_id, agent_type, stop_hook_active: false, last_assistant_message: 'готово' }).status).toBe(0);
      const start = (agent_id, agent_type = TYPE) => out(guard({ hook_event_name: 'SubagentStart', agent_id, agent_type })).hookSpecificOutput?.additionalContext;
      // Сдвигает время записи отчёта (в шапке) и mtime файла на hours часов назад.
      const backdate = (name, hours) => {
        const file = handoffPath(name);
        const at = new Date(Date.now() - hours * HOUR);
        writeFileSync(file, readFileSync(file, 'utf8').replace(/written=\S+/, `written=${at.toISOString()}`));
        utimesSync(file, at, at);
      };
      // Сдвигает только mtime (для `_active` — время захвата).
      const touch = (file, hours) => {
        const at = new Date(Date.now() - hours * HOUR);
        utimesSync(file, at, at);
      };

      beforeEach(() => inProgress('BE-49'));

      it('writes one file per stopped agent with the time and the task in progress in the header', () => {
        stop('a1', 'Сделано: A1.');
        stop('a2', 'Сделано: A2.');
        expect(files()).toEqual([`${TYPE}-a1.md`, `${TYPE}-a2.md`]);
        const text = readFileSync(handoffPath(`${TYPE}-a1.md`), 'utf8');
        expect(text).toMatch(/Сделано: A1\./);
        expect(text).toMatch(/BE-49/);
        expect(text).toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
        expect(readFileSync(handoffPath(`${TYPE}-a2.md`), 'utf8')).toMatch(/Сделано: A2\./);
      });

      it('does not save a report of a subagent that finished normally', () => {
        agentTranscript('a1', 'claude-sonnet-5-5', 1000);
        tool('Read', { file_path: join(dir, 'x') }, { agent_id: 'a1', agent_type: TYPE });
        finish('a1');
        expect(files()).toEqual([]);
      });

      it('hands the oldest free report of the same type to a new run, marks it _active and never hands it out twice', () => {
        stop('a1', 'Сделано: A1.');
        stop('a2', 'Сделано: A2.');
        backdate(`${TYPE}-a1.md`, 1);

        expect(start('x1', 'Explore')).toBeUndefined();
        expect(start('x2', 'nestjs')).toBeUndefined();
        expect(start('b1')).toMatch(/Сделано: A1\./);
        expect(files()).toEqual([`${TYPE}-a1_active-b1.md`, `${TYPE}-a2.md`]);
        expect(start('b2')).toMatch(/Сделано: A2\./);
        expect(start('b3')).toBeUndefined();
        expect(files()).toEqual([`${TYPE}-a1_active-b1.md`, `${TYPE}-a2_active-b2.md`]);
      });

      it('does not hand out a report of another task or one without a task to a run with a task', () => {
        stop('a1', 'Сделано: A1.');
        inProgress('BE-47');
        expect(start('b1')).toBeUndefined();
        inProgress('');
        expect(start('b2')).toBeUndefined();
        expect(files()).toEqual([`${TYPE}-a1.md`]);
      });

      it('hands a report without a task only to a run without a task', () => {
        inProgress('');
        stop('a1', 'Сделано: A1.');
        inProgress('BE-49');
        expect(start('b1')).toBeUndefined();
        inProgress('');
        expect(start('b2')).toMatch(/Сделано: A1\./);
      });

      it('does not hand out a report older than 24 hours and deletes it', () => {
        stop('a1', 'Сделано: A1.');
        backdate(`${TYPE}-a1.md`, 25);
        expect(start('b1')).toBeUndefined();
        expect(files()).toEqual([]);
      });

      it('deletes the owner _active file when the owner finishes normally and leaves other files alone', () => {
        stop('a1', 'Сделано: A1.');
        stop('a2', 'Сделано: A2.');
        backdate(`${TYPE}-a1.md`, 1);
        start('b1');
        finish('b1');
        expect(files()).toEqual([`${TYPE}-a2.md`]);
      });

      it('replaces the owner _active file with a new report when the owner is stopped by the threshold again', () => {
        stop('a1', 'Сделано: A1.');
        start('b1');
        stop('b1', 'Сделано: B1.');
        expect(files()).toEqual([`${TYPE}-b1.md`]);
        expect(readFileSync(handoffPath(`${TYPE}-b1.md`), 'utf8')).toMatch(/Сделано: B1\./);
      });

      it('returns an _active file claimed more than 2 hours ago to the queue while the report is younger than 24 hours', () => {
        stop('a1', 'Сделано: A1.');
        start('b1');
        touch(handoffPath(`${TYPE}-a1_active-b1.md`), 1);
        expect(start('b2')).toBeUndefined();
        touch(handoffPath(`${TYPE}-a1_active-b1.md`), 3);
        expect(start('b3')).toMatch(/Сделано: A1\./);
        expect(files()).toEqual([`${TYPE}-a1_active-b3.md`]);
      });

      it('deletes an abandoned _active file and old free reports at session start once the report is older than 24 hours', () => {
        stop('a1', 'Сделано: A1.');
        stop('a2', 'Сделано: A2.');
        stop('a3', 'Сделано: A3.');
        start('b1');
        backdate(`${TYPE}-a1_active-b1.md`, 25);
        backdate(`${TYPE}-a2.md`, 25);
        expect(guard({ hook_event_name: 'SessionStart', source: 'startup' }).status).toBe(0);
        expect(files()).toEqual([`${TYPE}-a3.md`]);
      });

      it('marks a claimed old report with the claim time so a sweep right after the claim keeps it _active', () => {
        stop('a1', 'Сделано: A1.');
        backdate(`${TYPE}-a1.md`, 3);
        expect(start('b1')).toMatch(/Сделано: A1\./);
        expect(guard({ hook_event_name: 'SessionStart', source: 'startup' }).status).toBe(0);
        expect(files()).toEqual([`${TYPE}-a1_active-b1.md`]);
      });

      it('still hands out a report when the sweep fails', () => {
        stop('a1', 'Сделано: A1.');
        rmSync(join(dir, 'guard'), { recursive: true, force: true });
        writeFileSync(join(dir, 'guard'), 'не каталог');
        expect(start('b1')).toMatch(/Сделано: A1\./);
      });

      it('does not write a report of a stopped subagent without a type', () => {
        stop('a1', 'Сделано: A1.', '');
        expect(files()).toEqual([]);
      });

      it('never hands out a file of the old format and deletes it 24 hours after its mtime', () => {
        mkdirSync(handoffDir(), { recursive: true });
        writeFileSync(handoffPath(`${TYPE}.md`), '# Handoff старого формата\n');
        expect(start('b1')).toBeUndefined();
        expect(start('b2', '')).toBeUndefined();
        expect(files()).toEqual([`${TYPE}.md`]);
        touch(handoffPath(`${TYPE}.md`), 25);
        expect(guard({ hook_event_name: 'SessionStart', source: 'startup' }).status).toBe(0);
        expect(files()).toEqual([]);
      });

      it('deletes agent-*.stopped markers older than 24 hours at session start', () => {
        const guardDir = join(dir, 'guard');
        mkdirSync(guardDir, { recursive: true });
        writeFileSync(join(guardDir, 'agent-old.stopped'), '');
        writeFileSync(join(guardDir, 'agent-new.stopped'), '');
        touch(join(guardDir, 'agent-old.stopped'), 25);
        expect(guard({ hook_event_name: 'SessionStart', source: 'startup' }).status).toBe(0);
        expect(existsSync(join(guardDir, 'agent-old.stopped'))).toBe(false);
        expect(existsSync(join(guardDir, 'agent-new.stopped'))).toBe(true);
      });
    });
  });
});
