#!/usr/bin/env node
// Жёсткая сверка кода с договорённостями: спека контракта, клиентская интеграция, архитектура, решения, задачи.
// Источник истины — КОД. Любое расхождение — ошибка (exit 1). Внешний репозиторий клиента — только предупреждения.
// Вызывается из scripts/check-memory.sh (а значит, из scripts/accept.sh). Тесты — scripts/check-sync.spec.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = 'docs/superpowers/specs/2026-10-05-core-contract-design.md';
const CLIENT = 'docs/client-integration.md';
const ARCH = '.ai/memory/architecture.md';
const DECISIONS = '.ai/memory/decisions.md';
const TASKS = '.ai/memory/tasks.md';
const METHODS = 'GET|POST|PATCH|PUT|DELETE';
/** Коды, существующие только как значения `auth_error` в редиректе входа (в JSON-ответах не бывают). */
const REDIRECT_ONLY = new Set(['not_allowed', 'login_taken']);
/** Стандартные коды закрытия WebSocket, которых нет в нашем коде (их ставит библиотека `ws`/браузер). */
const PROTOCOL_CLOSE_CODES = new Set(['1006', '1009']);

export function runChecks(root) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => errors.push(msg);

  const path = (rel) => join(root, rel);
  const read = (rel) => (existsSync(path(rel)) ? readFileSync(path(rel), 'utf8') : null);
  const need = (rel) => {
    const text = read(rel);
    if (text === null) fail(`нет файла ${rel}`);
    return text ?? '';
  };
  const walk = (dir, pred) => {
    const out = [];
    const visit = (d) => {
      if (!existsSync(path(d))) return;
      for (const name of readdirSync(path(d))) {
        const rel = `${d}/${name}`;
        if (statSync(path(rel)).isDirectory()) {
          if (name !== 'generated' && name !== 'node_modules') visit(rel);
        } else if (pred(rel)) out.push(rel);
      }
    };
    visit(dir);
    return out.sort();
  };
  const srcFiles = walk('src', (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  const srcText = (f) => read(f) ?? '';

  /** Все содержимые обратных кавычек, `\|` внутри таблиц превращается в `|`. */
  const ticks = (md) => [...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].replaceAll('\\|', '|'));
  const sameSet = (what, docName, docSet, codeSet, { subsetOnly = false } = {}) => {
    const missing = [...codeSet].filter((x) => !docSet.has(x));
    const extra = [...docSet].filter((x) => !codeSet.has(x));
    if (!subsetOnly && missing.length) fail(`${docName}: не описано (есть в коде) — ${what}: ${missing.join(', ')}`);
    if (extra.length) fail(`${docName}: описано, но нет в коде — ${what}: ${extra.join(', ')}`);
  };

  const spec = need(SPEC);
  const client = need(CLIENT);
  const arch = need(ARCH);
  const decisions = need(DECISIONS);
  const tasks = need(TASKS);

  // ---------- 1. Маршруты ----------
  const normRoute = (method, p) => {
    let route = p
      .replace(/[?#].*$/, '')
      .replace(/[.,;:)]+$/, '')
      .replace(/\{[^}]*\}/g, ':p')
      .replace(/:\w+/g, ':p');
    if (route !== '/ws' && !route.startsWith('/api')) route = `/api${route}`;
    return `${method} ${route}`;
  };
  const codeRoutes = new Set();
  for (const f of srcFiles) {
    const text = srcText(f);
    const ctrl = text.match(/@Controller\('([^']*)'\)/);
    if (ctrl) {
      for (const d of text.matchAll(new RegExp(`@(${METHODS.replace(/\w+/g, (m) => m[0] + m.slice(1).toLowerCase())})\\((?:'([^']*)')?\\)`, 'g'))) {
        const full = ['/api', ctrl[1], d[2]].filter(Boolean).join('/');
        codeRoutes.add(normRoute(d[1].toUpperCase(), full));
      }
    }
    const gw = text.match(/@WebSocketGateway\(\{[^}]*path:\s*'([^']+)'/);
    if (gw) codeRoutes.add(normRoute('GET', gw[1]));
  }
  if (codeRoutes.size === 0) fail('в коде не найдено ни одного маршрута (проверьте разбор контроллеров в scripts/check-sync.mjs)');
  const docRoutes = (md) => {
    const set = new Set();
    for (const t of ticks(md)) {
      const m = t.match(new RegExp(`^(${METHODS}) (/\\S*)`));
      if (m) set.add(normRoute(m[1], m[2]));
    }
    return set;
  };
  for (const [name, md] of [[SPEC, spec], [CLIENT, client], [ARCH, arch]]) {
    sameSet('маршруты', name, docRoutes(md), codeRoutes);
  }

  // ---------- 2. Коды ошибок и auth_error ----------
  const errText = srcText('src/common/app-error.ts');
  const errorCodes = new Set([...errText.slice(errText.indexOf('ErrorCode')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  if (!errorCodes.size) fail('src/common/app-error.ts: не найден тип ErrorCode');
  const jsonCodes = new Set([...errorCodes].filter((c) => !REDIRECT_ONLY.has(c)));
  const clientCodes = new Set();
  const sec13 = client.split(/^### 1\.3\./m)[1]?.split(/^##/m)[0] ?? '';
  for (const m of sec13.matchAll(/^\| `([a-z_]+)` \|/gm)) if (m[1] !== 'error') clientCodes.add(m[1]);
  sameSet('коды error.code', CLIENT, clientCodes, jsonCodes);
  const specCodesLine = spec.match(/Коды `error\.code`:([^;\n]*);/);
  if (!specCodesLine) fail(`${SPEC}: нет строки «Коды \`error.code\`: … ;»`);
  else sameSet('коды error.code', SPEC, new Set(ticks(specCodesLine[1])), jsonCodes);

  const authCtl = srcText('src/auth/auth.controller.ts');
  const authErrors = new Set();
  for (const call of authCtl.matchAll(/\bfail\(([^;]*)\);?/g)) {
    for (const lit of call[1].matchAll(/'([a-z_]+)'/g)) authErrors.add(lit[1]);
  }
  for (const m of authCtl.matchAll(/signInError\.code === '([a-z_]+)'/g)) authErrors.add(m[1]);
  for (const c of REDIRECT_ONLY) if (!authErrors.has(c)) fail(`src/auth/auth.controller.ts: ${c} должен приводить к редиректу auth_error`);
  const sec21 = client.split(/^### 2\.1\./m)[1]?.split(/^### /m)[0] ?? '';
  const clientAuthErrors = new Set([...sec21.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).filter((c) => c !== 'auth_error'));
  sameSet('значения auth_error', CLIENT, clientAuthErrors, authErrors);
  for (const [name, md] of [[SPEC, spec], [ARCH, arch]]) {
    const mentioned = new Set([...md.matchAll(/auth_error=([a-z_]+)/g)].map((m) => m[1]));
    sameSet('значения auth_error', name, mentioned, authErrors, { subsetOnly: true });
  }

  // ---------- 3. Переменные окружения ----------
  const envSchema = srcText('src/config/env.schema.ts');
  const envKeys = new Set([...envSchema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
  const envDefaults = new Map([...envSchema.matchAll(/^\s+([A-Z][A-Z0-9_]+):.*\.default\((\d+)\)/gm)].map((m) => [m[1], Number(m[2])]));
  const example = need('.env.example');
  const exampleVars = new Map([...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2]]));
  sameSet('переменные окружения', '.env.example', new Set(exampleVars.keys()), envKeys);
  for (const [key, def] of envDefaults) {
    const v = exampleVars.get(key);
    if (v !== undefined && v !== String(def)) fail(`.env.example: ${key}=${v}, а умолчание в коде ${def}`);
  }
  const diTokens = new Set();
  for (const f of srcFiles) for (const m of srcText(f).matchAll(/export const ([A-Z][A-Z0-9_]+)\s*=/g)) diTokens.add(m[1]);
  const envLike = (md) => new Set(ticks(md).filter((t) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t) && !diTokens.has(t)));
  sameSet('переменные окружения', CLIENT, envLike(client), envKeys, { subsetOnly: true });
  sameSet('переменные окружения', SPEC, envLike(spec), envKeys, { subsetOnly: true });
  sameSet('переменные окружения', ARCH, envLike(arch), envKeys, { subsetOnly: true });
  for (const [key, def] of envDefaults) {
    const lines = client.split('\n').filter((l) => l.includes(`\`${key}\``));
    if (!lines.length) continue;
    const forms = [String(def), String(def / 1000)].filter((x) => Number.isInteger(Number(x)));
    const ok = lines.some((l) => forms.some((f) => new RegExp(`(^|[^\\d.])${f}([^\\d]|$)`).test(l)));
    if (!ok) fail(`${CLIENT}: умолчание ${key} в коде ${def}, но в строках с \`${key}\` его нет`);
  }

  // ---------- 4. WebSocket: события и коды закрытия ----------
  const wsEvents = new Set();
  for (const f of srcFiles) for (const m of srcText(f).matchAll(/'((?:chat|message)\.[a-z]+)'/g)) wsEvents.add(m[1]);
  const eventTokens = (md) => new Set(ticks(md).filter((t) => /^(chat|message)\.[a-z]+$/.test(t)));
  sameSet('WS-события', SPEC, eventTokens(spec), wsEvents);
  sameSet('WS-события', CLIENT, eventTokens(client), wsEvents);
  sameSet('WS-события', ARCH, eventTokens(arch), wsEvents, { subsetOnly: true });
  const closeCodes = new Set();
  for (const f of walk('src/realtime', (x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
    for (const m of srcText(f).matchAll(/(?:close|closeAll)\((\d{4})/g)) closeCodes.add(m[1]);
  }
  const closeTokens = (md) => new Set(ticks(md).filter((t) => /^\d{4}$/.test(t)));
  for (const [name, md] of [[SPEC, spec], [CLIENT, client]]) {
    sameSet('коды закрытия WS', name, closeTokens(md), new Set([...closeCodes, ...PROTOCOL_CLOSE_CODES]));
  }

  // ---------- 5. Схема БД ----------
  const prisma = need('prisma/schema.prisma');
  const dbTables = new Map();
  for (const m of prisma.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)) {
    const body = m[1];
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1];
    if (!table) continue;
    const cols = new Set();
    for (const line of body.split('\n')) {
      const f = line.match(/^\s+(\w+)\s+([A-Z]\w*)(\[\]|\?)?/);
      if (!f || line.includes('@relation') || /^\s+@@/.test(line)) continue;
      if (f[3] === '[]') continue;
      const isScalar = /^(String|Int|Boolean|DateTime|Provider|ChatType|ChatRole)$/.test(f[2]);
      if (!isScalar) continue;
      cols.add(line.match(/@map\("([^"]+)"\)/)?.[1] ?? f[1]);
    }
    dbTables.set(table, cols);
  }
  const sec1 = spec.split(/^## 1\./m)[1]?.split(/^## /m)[0] ?? '';
  const specTables = new Map();
  for (const row of sec1.matchAll(/^\| `([a-z_]+)` \| ([^|]*)\|/gm)) {
    const cell = row[2].replace(/(`[a-z_]+`)\s*\([^)]*\)/g, '$1');
    specTables.set(row[1], new Set([...cell.matchAll(/`([a-z_]+)`/g)].map((x) => x[1])));
  }
  sameSet('таблицы БД', SPEC, new Set(specTables.keys()), new Set(dbTables.keys()));
  for (const [table, cols] of dbTables) {
    if (specTables.has(table)) sameSet(`колонки ${table}`, SPEC, specTables.get(table), cols);
  }
  for (const m of prisma.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const value of m[2].split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (!client.includes(`"${value}"`)) fail(`${CLIENT}: нет значения enum ${m[1]}.${value} (в кавычках)`);
      if (!spec.includes(value)) fail(`${SPEC}: нет значения enum ${m[1]}.${value}`);
    }
  }

  // ---------- 6. DTO ответов ----------
  const mapper = srcText('src/chats/chat.mapper.ts');
  const sec4 = client.split(/^## 4\./m)[1]?.split(/^## /m)[0] ?? '';
  for (const dto of ['ChatMemberDto', 'ChatDto', 'ChatListItemDto', 'ChatMessageDto', 'ChatPeerDto']) {
    const m = mapper.match(new RegExp(`export interface ${dto} \\{([\\s\\S]*?)^\\}`, 'm'));
    if (!m) { fail(`src/chats/chat.mapper.ts: нет интерфейса ${dto}`); continue; }
    const codeFields = new Set([...m[1].matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]));
    const row = sec4.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${dto}\``));
    if (!row) {
      if (dto !== 'ChatPeerDto') fail(`${CLIENT}: нет строки модели ${dto} в разделе 4`);
      continue;
    }
    const cells = row.split(/(?<!\\)\|/).map((c) => c.trim()).filter(Boolean);
    const fields = new Set([...(cells[1] ?? '').matchAll(/`(\w+)\??(?::[^`]*)?`/g)].map((x) => x[1]).filter((x) => x !== 'null'));
    sameSet(`поля ${dto}`, CLIENT, fields, codeFields);
  }
  const peerRow = sec4.split('\n').find((l) => l.includes('`ChatListItemDto`')) ?? '';
  const peerCode = new Set([...(mapper.match(/export interface ChatPeerDto \{([\s\S]*?)^\}/m)?.[1] ?? '').matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]));
  for (const f of peerCode) if (!peerRow.includes(f)) fail(`${CLIENT}: в строке ChatListItemDto нет поля peer.${f}`);

  // ---------- 7. Числовые факты из кода, обязательные в документах ----------
  const facts = [];
  const gateway = srcText('src/realtime/realtime.gateway.ts').match(/maxPayload:\s*(\d+)/)?.[1];
  if (gateway) facts.push(['maxPayload', `${Number(gateway) / 1024} КиБ`]);
  else fail('src/realtime/realtime.gateway.ts: не найден maxPayload');
  const buffered = srcText('src/realtime/connection-registry.ts').match(/MAX_BUFFERED_BYTES\s*=\s*([\d_]+)/)?.[1];
  if (buffered) facts.push(['MAX_BUFFERED_BYTES', `${Number(buffered.replaceAll('_', '')) / 1048576} МиБ`]);
  else fail('src/realtime/connection-registry.ts: не найден MAX_BUFFERED_BYTES');
  const title = srcText('src/chats/dto/create-chat.dto.ts').match(/title:.*\.max\((\d+)\)/)?.[1];
  const titleRename = srcText('src/chats/dto/rename-chat.dto.ts').match(/title:.*\.max\((\d+)\)/)?.[1];
  if (!title || title !== titleRename) fail('src/chats/dto: предел длины title в create-chat и rename-chat должен совпадать');
  else facts.push(['title.max', `1..${title}`]);
  const list = srcText('src/messages/dto/list-messages.dto.ts');
  const maxLimit = list.match(/MAX_LIMIT\s*=\s*(\d+)/)?.[1];
  const defLimit = list.match(/DEFAULT_LIMIT\s*=\s*(\d+)/)?.[1];
  if (maxLimit && defLimit) {
    facts.push(['messages.limit.max', `1..${maxLimit}`]);
    facts.push(['messages.limit.default', defLimit, /limit[^\n]*\b__N__\b|\b__N__\b[^\n]*limit/i]);
  } else fail('src/messages/dto/list-messages.dto.ts: не найдены MAX_LIMIT/DEFAULT_LIMIT');
  for (const [name, needle, near] of facts) {
    for (const [doc, md] of [[SPEC, spec], [CLIENT, client]]) {
      const found = near ? new RegExp(near.source.replaceAll('__N__', needle), near.flags).test(md) : md.includes(needle);
      if (!found) fail(`${doc}: нет значения «${needle}» (${name} в коде)`);
    }
  }
  const secureConditional = /secure:\s*isSecureUrl/.test(srcText('src/auth/cookie-options.ts'));
  if (secureConditional) {
    for (const [name, md] of [[SPEC, spec], [CLIENT, client], [ARCH, arch]]) {
      if (/HttpOnly;\s*Secure/.test(md)) fail(`${name}: «HttpOnly; Secure» — в коде Secure ставится только при https в PUBLIC_URL`);
    }
    if (!/Secure[^.\n]*https/.test(client)) fail(`${CLIENT}: не сказано, что Secure у cookie — только при https`);
  }

  // ---------- 8. Решения и задачи: ссылки существуют ----------
  const decisionIds = new Set([...decisions.matchAll(/^## ((?:SH|BE)-D\d+)\b/gm)].map((m) => m[1]));
  const taskIds = new Set([...tasks.matchAll(/\bBE-(\d+)\b/g)].map((m) => `BE-${m[1]}`));
  const scanned = [
    ...srcFiles, ...walk('src', (f) => f.endsWith('.spec.ts')), ...walk('test', (f) => f.endsWith('.ts')),
    ...walk('scripts', () => true), ...walk('.ai', (f) => f.endsWith('.md')), ...walk('docs', (f) => f.endsWith('.md')),
    'CLAUDE.md', '.env.example',
  ].filter((f, i, a) => a.indexOf(f) === i && read(f) !== null);
  for (const f of scanned) {
    if (f === 'scripts/check-sync.mjs' || f === 'scripts/check-sync.spec.mjs') continue;
    const text = read(f);
    for (const m of text.matchAll(/\b((?:SH|BE)-D\d+)\b/g)) {
      if (!decisionIds.has(m[1])) fail(`${f}: ссылка на несуществующее решение ${m[1]}`);
    }
    if (f.startsWith('docs/superpowers/plans/')) continue; // исторические планы: ссылки на задачи не обязаны жить в tasks.md
    for (const m of text.matchAll(/\bBE-(\d+)\b/g)) {
      if (!taskIds.has(`BE-${m[1]}`)) fail(`${f}: ссылка на несуществующую задачу BE-${m[1]}`);
    }
  }
  const sec8b = client.split(/^### 8б\./m)[1]?.split(/^## /m)[0] ?? '';
  const items8b = [...sec8b.matchAll(/^(\d+)\. /gm)].length;
  const items8a = [...(client.split(/^### 8а\./m)[1]?.split(/^### /m)[0] ?? '').matchAll(/^(\d+)\. /gm)].length;
  if ((!items8a || !items8b) && /8[аб]\.\d+/.test(client)) fail(`${CLIENT}: есть ссылки на 8а/8б, но разделов «### 8а.»/«### 8б.» с пунктами нет`);
  for (const m of client.matchAll(/8([аб])\.(\d+)/g)) {
    const max = m[1] === 'а' ? items8a : items8b;
    if (Number(m[2]) < 1 || Number(m[2]) > max) fail(`${CLIENT}: ссылка 8${m[1]}.${m[2]} ведёт на несуществующий пункт`);
  }

  // ---------- 9. Внешний репозиторий клиента (только предупреждения) ----------
  const readme = read('.ai/memory/README.md') ?? '';
  const authPath = readme.match(/(\/\S+\/auth-contract\.md)/)?.[1];
  if (authPath && existsSync(authPath)) {
    const contract = readFileSync(authPath, 'utf8');
    for (const e of authErrors) {
      if (!contract.includes(e)) warnings.push(`клиент: ${authPath} не знает auth_error=${e}`);
    }
    const proxy = join(dirname(dirname(dirname(authPath))), 'src/setupProxy.js');
    if (existsSync(proxy) && !readFileSync(proxy, 'utf8').includes('/ws')) {
      warnings.push(`клиент: ${proxy} не проксирует /ws`);
    }
  }

  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, warnings } = runChecks(root);
  console.log('==> Сверка кода с контрактом, архитектурой, решениями (scripts/check-sync.mjs)');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  if (errors.length) {
    console.log(`==> Рассинхрон: ошибок ${errors.length}`);
    process.exit(1);
  }
  console.log(`==> Рассинхрона нет (предупреждений: ${warnings.length})`);
}
