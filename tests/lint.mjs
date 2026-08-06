/*!
 * Kagaz — project rule linter.
 *
 *   node tests/lint.mjs
 *
 * A generic linter checks style. This one checks the promises the site makes,
 * which are the rules a well-meaning contributor is most likely to break by
 * accident. It has no dependencies on purpose: `git clone` and it runs.
 *
 * Rules enforced:
 *   1. Every inline <script> must parse.
 *   2. No network APIs anywhere — the site claims it never phones home.
 *   3. No persistent storage — the site claims nothing is written to disk.
 *   4. No console noise or debugger statements in shipped pages.
 *   5. No hard-coded http(s) asset URLs (external origins).
 *   6. Every tool page must offer a way to report a problem.
 *
 * MIT © namastevis
 */
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'attic']);

let pass = 0, fail = 0;
const problems = [];

const ok = (m, d) => { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  \x1b[2m' + d + '\x1b[0m' : '')); };
const no = (m, why) => { fail++; problems.push(m + ' — ' + why); console.log('  \x1b[31m✗\x1b[0m ' + m + '  \x1b[31m' + why + '\x1b[0m'); };
const group = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function walk(dir, ext, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, found);
    else if (ext.some(e => entry.endsWith(e))) found.push(full);
  }
  return found;
}

const rel = p => path.relative(ROOT, p);
const htmlFiles = walk(ROOT, ['.html']).filter(p => !rel(p).startsWith('attic'));
const jsFiles = walk(path.join(ROOT, 'shared'), ['.js']);

/** Inline <script> blocks, minus JSON-LD which is data rather than code. */
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/type\s*=\s*["']application\/ld\+json["']/i.test(m[1]))
    .map(m => m[2]);
}

/* ---------------------------------------------------------------- 1. parsing */

group('Inline scripts parse');

let blocks = 0, broken = 0;
for (const file of htmlFiles) {
  for (const [i, code] of inlineScripts(readFileSync(file, 'utf8')).entries()) {
    blocks++;
    const tmp = path.join(tmpdir(), 'kagaz-lint-' + process.pid + '-' + blocks + '.js');
    writeFileSync(tmp, code);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (err) {
      broken++;
      no(rel(file) + ' block ' + (i + 1), String(err.stderr || err).split('\n').slice(0, 2).join(' ').trim());
    } finally {
      try { unlinkSync(tmp); } catch { /* already gone */ }
    }
  }
}
if (!broken) ok('every inline script parses', blocks + ' blocks across ' + htmlFiles.length + ' pages');

/* ------------------------------------------------------- 2, 3, 4. forbidden */

const BANNED = [
  // The site says it never phones home. These are the ways it could.
  { re: /\bfetch\s*\(/, name: 'fetch()', why: 'the site claims it makes no network requests' },
  { re: /\bXMLHttpRequest\b/, name: 'XMLHttpRequest', why: 'the site claims it makes no network requests' },
  { re: /\bnavigator\.sendBeacon\b/, name: 'sendBeacon', why: 'that is analytics by another name' },
  { re: /\bnew\s+WebSocket\b/, name: 'WebSocket', why: 'the site claims it makes no network requests' },
  { re: /\bnew\s+EventSource\b/, name: 'EventSource', why: 'the site claims it makes no network requests' },

  // The site says your document is never written to disk.
  { re: /\blocalStorage\b/, name: 'localStorage', why: 'the site claims nothing is written to disk' },
  { re: /\bsessionStorage\b/, name: 'sessionStorage', why: 'the site claims nothing is written to disk' },
  { re: /\bindexedDB\b/, name: 'indexedDB', why: 'the site claims nothing is written to disk' },
  { re: /\bshowSaveFilePicker\b/, name: 'showSaveFilePicker', why: 'writes to the filesystem outside the download flow' },

  // Leftovers.
  { re: /\bdebugger\b/, name: 'debugger', why: 'left in by accident' },
  { re: /\bconsole\.(log|debug|info)\s*\(/, name: 'console.log', why: 'left in by accident' }
];

group('Forbidden APIs');

for (const rule of BANNED) {
  const hits = [];

  for (const file of htmlFiles) {
    inlineScripts(readFileSync(file, 'utf8')).forEach((code, i) => {
      if (rule.re.test(code)) hits.push(rel(file) + ' (inline block ' + (i + 1) + ')');
    });
  }
  for (const file of jsFiles) {
    if (rule.re.test(readFileSync(file, 'utf8'))) hits.push(rel(file));
  }

  if (hits.length) no('no ' + rule.name, rule.why + ' — found in ' + hits.join(', '));
  else ok('no ' + rule.name, rule.why);
}

/* ------------------------------------------------------- 5. external assets */

group('External origins');

const external = [];
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["'][^>]*>/gi)) {
    if (/rel\s*=\s*["'](canonical|alternate)["']/i.test(m[0])) continue;
    external.push(rel(file));
  }
}
if (external.length) no('no assets from another origin', [...new Set(external)].join(', '));
else ok('no assets from another origin', htmlFiles.length + ' pages checked');

/* ------------------------------------------------- 6. reporting is reachable */

group('Reporting is reachable');

const toolPages = htmlFiles.filter(p => {
  const r = rel(p);
  return r.endsWith('index.html') && r.includes(path.sep) &&
    !['test', 'report', 'attic'].some(d => r.startsWith(d + path.sep));
});
const missing = toolPages.filter(p => !readFileSync(p, 'utf8').includes('report/'));
if (missing.length) no('every tool page links to /report/', missing.map(rel).join(', '));
else ok('every tool page links to /report/', toolPages.length + ' pages');

/* --------------------------------------------------------------- housekeeping */

group('Housekeeping');

const todos = [];
// The linter defines these markers, so it would otherwise flag itself.
const scanned = [...htmlFiles, ...jsFiles, ...walk(path.join(ROOT, 'tests'), ['.mjs'])]
  .filter(f => path.basename(f) !== 'lint.mjs');
for (const file of scanned) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(l)) todos.push(rel(file) + ':' + (i + 1));
  });
}
todos.length
  ? no('no unresolved TODO markers', todos.slice(0, 5).join(', ') + (todos.length > 5 ? ` (+${todos.length - 5})` : ''))
  : ok('no unresolved TODO markers');

const longFns = [];
for (const file of jsFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let name = null, start = 0;
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,4}(?:async\s+)?function\s+([a-zA-Z0-9_]+)/);
    if (m) { name = m[1]; start = i; }
    else if (name && /^\s{0,4}\}\s*$/.test(l)) {
      if (i - start > 80) longFns.push(rel(file) + ' ' + name + '() ' + (i - start) + ' lines');
      name = null;
    }
  });
}
longFns.length
  ? no('no function over 80 lines', longFns.join(', '))
  : ok('no function over 80 lines', 'shared/*.js');

/* -------------------------------------------------------------------- report */

console.log('\n' + '─'.repeat(64));
console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) {
  console.log('\n\x1b[31mProblems:\x1b[0m');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
console.log('\x1b[32mThe promises on the page still match the code.\x1b[0m');
