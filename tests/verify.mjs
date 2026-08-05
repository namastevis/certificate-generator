/*!
 * Kagaz — site verification.
 *
 *   node tests/verify.mjs
 *
 * Checks the things that are easy to get quietly wrong in a static site with
 * no build step: dead internal links, a missing viewport tag, a duplicated
 * canonical URL — and above all, an asset sneaking in from another origin,
 * which would break the one promise the whole project rests on.
 *
 * MIT © namastevis
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://kagaz.namastevis.in';

let pass = 0, fail = 0;
const problems = [];

const ok = (m, d) => { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  \x1b[2m' + d + '\x1b[0m' : '')); };
const no = (m, why) => { fail++; problems.push(m + ' — ' + why); console.log('  \x1b[31m✗\x1b[0m ' + m + '  \x1b[31m' + why + '\x1b[0m'); };
const group = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* --------------------------------------------------------------- discovery */

function htmlFiles(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'vendor') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, found);
    else if (entry.endsWith('.html')) found.push(full);
  }
  return found;
}

const pages = htmlFiles().filter(p => !p.includes(path.sep + 'attic' + path.sep));
const rel = p => path.relative(ROOT, p);

console.log('\x1b[1mKagaz site verification\x1b[0m  ·  ' + pages.length + ' HTML pages');

/* ------------------------------------------------- the no-external promise */

group('The no-external-origin promise');

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const assets = [...html.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(m => ({ tag: m[0], url: m[1] }));

  const external = assets.filter(a => {
    if (!/^https?:\/\/|^\/\//i.test(a.url)) return false;
    // A <link rel="canonical"> is a declaration, not a fetch.
    if (/rel\s*=\s*["'](canonical|alternate)["']/i.test(a.tag)) return false;
    return true;
  });

  if (external.length) no(rel(page) + ' loads nothing externally', external.map(e => e.url).join(', '));
  else ok(rel(page) + ' loads nothing externally', assets.length + ' local assets');
}

const jsFiles = ['shared/kagaz.js', 'shared/ops.js'];
for (const f of jsFiles) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  const calls = [...src.matchAll(/\b(fetch|XMLHttpRequest|navigator\.sendBeacon|EventSource|WebSocket)\b/g)].map(m => m[1]);
  if (calls.length) no(f + ' makes no network calls', 'found ' + [...new Set(calls)].join(', '));
  else ok(f + ' makes no network calls');
}

/* --------------------------------------------------------- internal links */

group('Internal links');

let checked = 0, broken = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const dir = path.dirname(page);

  for (const m of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    let url = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(url)) continue;
    url = url.split('#')[0].split('?')[0];
    if (!url) continue;

    const base = url.startsWith('/') ? path.join(ROOT, url) : path.join(dir, url);
    const candidates = [base, path.join(base, 'index.html')];
    checked++;
    if (!candidates.some(existsSync)) { broken++; no(rel(page) + ' → ' + m[1], 'target does not exist'); }
  }
}
if (!broken) ok('every internal link resolves', checked + ' links checked across ' + pages.length + ' pages');

/* ------------------------------------------------------------------- meta */

group('Page metadata');

const canonicals = new Map();
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const name = rel(page);
  const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html);

  if (!/<meta[^>]+name=["']viewport["'][^>]+width=device-width/i.test(html)) {
    no(name + ' has a mobile viewport', 'missing or wrong viewport meta');
  } else ok(name + ' has a mobile viewport');

  if (!/<html[^>]+lang=/i.test(html)) no(name + ' declares a language', 'missing lang attribute');

  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (!title || title[1].trim().length < 8) no(name + ' has a title', 'missing or too short');
  else if (title[1].length > 65) no(name + ' title fits a search result', title[1].length + ' chars, over 65');

  if (!noindex) {
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    if (!desc) no(name + ' has a meta description', 'missing');
    else if (desc[1].length > 165) no(name + ' description fits', desc[1].length + ' chars, over 165');

    const canon = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    if (!canon) no(name + ' has a canonical URL', 'missing');
    else {
      if (!canon[1].startsWith(SITE)) no(name + ' canonical points at the live host', canon[1]);
      if (canonicals.has(canon[1])) no(name + ' canonical is unique', 'duplicate of ' + canonicals.get(canon[1]));
      canonicals.set(canon[1], name);
    }
  }
}

/* -------------------------------------------------------------- mobile UX */

group('Mobile behaviour');

const css = readFileSync(path.join(ROOT, 'shared/kagaz.css'), 'utf8');

const inputRule = css.match(/input\[type=text\][^{]*\{[^}]*\}/);
if (inputRule && /font-size:\s*16px/.test(inputRule[0])) {
  ok('text inputs are 16px', 'stops iOS Safari zooming in on focus');
} else no('text inputs are 16px', 'iOS will zoom the viewport when a field is focused');

if (/--tap:\s*44px/.test(css)) ok('tap target size is defined', '44px minimum');
else no('tap target size is defined', '--tap custom property missing');

if (/env\(safe-area-inset-bottom\)/.test(css)) ok('sticky bar clears the iOS home indicator');
else no('sticky bar clears the iOS home indicator', 'no safe-area-inset padding');

if (/@media\s*\(min-width/.test(css)) ok('stylesheet is mobile-first', (css.match(/@media\s*\(min-width/g) || []).length + ' min-width breakpoints');
else no('stylesheet is mobile-first', 'no min-width media queries found');

if (/prefers-reduced-motion/.test(css)) ok('honours prefers-reduced-motion');
else no('honours prefers-reduced-motion', 'missing');

if (/user-scalable\s*=\s*no|maximum-scale/i.test(pages.map(p => readFileSync(p, 'utf8')).join(''))) {
  no('pinch zoom is not blocked', 'a viewport tag disables zooming — that is an accessibility failure');
} else ok('pinch zoom is not blocked');

/* ------------------------------------------------------------------ files */

group('Required files');

for (const f of ['CNAME', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'DEPLOY.md',
                 'robots.txt', 'sitemap.xml', '404.html', 'favicon.svg',
                 'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
                 'vendor/jszip.min.js', 'vendor/fontkit.umd.min.js']) {
  existsSync(path.join(ROOT, f)) ? ok(f + ' present') : no(f + ' present', 'missing');
}

const cname = readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();
cname === 'kagaz.namastevis.in'
  ? ok('CNAME points at kagaz.namastevis.in')
  : no('CNAME points at kagaz.namastevis.in', 'found "' + cname + '"');

const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const missing = pages
  .filter(p => !/noindex/i.test(readFileSync(p, 'utf8')))
  .map(p => SITE + '/' + rel(p).replace(/index\.html$/, '').replace(/\\/g, '/'))
  .filter(u => !sitemap.includes(u));
missing.length ? no('sitemap lists every indexable page', 'missing ' + missing.join(', ')) : ok('sitemap lists every indexable page');

/* ----------------------------------------------------------------- report */

console.log('\n' + '─'.repeat(64));
console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) {
  console.log('\n\x1b[31mProblems:\x1b[0m');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
console.log('\x1b[32mNothing leaves the origin, nothing is broken.\x1b[0m');
