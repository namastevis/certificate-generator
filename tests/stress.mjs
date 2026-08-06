/*!
 * Kagaz — stress tests.
 *
 *   node tests/stress.mjs
 *
 * Throws deliberately awful PDFs at shared/ops.js and checks that each one
 * either works or fails *cleanly* — with a KagazError carrying a message a
 * person could act on. A crash, a hang, or a silently broken output file is
 * a failure; a polite refusal is a pass.
 *
 * Image compression needs a JPEG codec, which Node does not have. If `sharp`
 * happens to be installed the real pixel path is exercised too; if not, a
 * stub codec still verifies every branch of the traversal and replacement
 * logic. Neither is required to run the suite.
 *
 * MIT © namastevis
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PDFLib = require(path.join(ROOT, 'vendor/pdf-lib.min.js'));
const ops = require(path.join(ROOT, 'shared/ops.js'))(PDFLib);
const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFRawStream } = PDFLib;

/* ------------------------------------------------------------------ harness */

let passed = 0, failed = 0;
const failures = [];

function ok(name, detail) {
  passed++;
  console.log('  \x1b[32m✓\x1b[0m ' + name + (detail ? '  \x1b[2m' + detail + '\x1b[0m' : ''));
}
function bad(name, why) {
  failed++;
  failures.push(name + ' — ' + why);
  console.log('  \x1b[31m✗\x1b[0m ' + name + '  \x1b[31m' + why + '\x1b[0m');
}
function group(title) {
  console.log('\n\x1b[1m' + title + '\x1b[0m');
}

/** The operation must reject, and must do it with a friendly KagazError. */
async function refuses(name, fn, expectCode) {
  const allowed = expectCode ? [].concat(expectCode) : null;
  try {
    await fn();
    bad(name, 'no error was thrown — it should have refused');
  } catch (err) {
    if (!err.friendly) return bad(name, 'threw a raw error instead of a KagazError: ' + err.message);
    if (allowed && allowed.indexOf(err.code) === -1) return bad(name, 'expected code ' + allowed.join(' or ') + ', got "' + err.code + '"');
    if (!err.message || err.message.length < 12) return bad(name, 'error message is not useful: ' + err.message);
    ok(name, err.code + ': ' + err.message.slice(0, 58) + '…');
  }
}

async function succeeds(name, fn, check) {
  try {
    const result = await fn();
    const problem = check ? await check(result) : null;
    if (problem) bad(name, problem);
    else ok(name, typeof result === 'string' ? result : '');
  } catch (err) {
    bad(name, 'threw: ' + (err && err.message));
  }
}

/* ------------------------------------------------------------------ fixtures */

async function makePdf(pages, opt = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(opt.size || [595.28, 841.89]);
    page.drawText('Page ' + (i + 1) + ' — Kagaz stress fixture', {
      x: 40, y: (opt.size ? opt.size[1] : 841.89) / 2, size: opt.fontSize || 14, font, color: rgb(0, 0, 0)
    });
    if (opt.rotate) page.setRotation(degrees(opt.rotate));
  }
  return doc.save();
}

/** A valid PDF with an /Encrypt entry bolted into the trailer. */
async function makeFakeEncrypted() {
  const bytes = await makePdf(1);
  const doc = await PDFDocument.load(bytes);
  doc.context.trailerInfo.Encrypt = doc.context.obj({
    Filter: 'Standard', V: 1, R: 2, P: -1,
    O: PDFLib.PDFHexString.of('00'.repeat(32)),
    U: PDFLib.PDFHexString.of('00'.repeat(32))
  });
  return doc.save();
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

/** Count image XObjects and confirm text-drawing operators survived. */
async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  let images = 0, hasText = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const sub = obj.dict.lookup(PDFName.of('Subtype'));
      if (sub && sub.asString && sub.asString() === '/Image') images++;
    }
    try {
      const decoded = PDFLib.decodePDFRawStream(obj).decode();
      const text = Buffer.from(decoded).toString('latin1');
      if (text.includes('Tj') || text.includes('TJ')) hasText = true;
    } catch { /* not a decodable stream */ }
  }
  return { pages: doc.getPageCount(), images, hasText };
}

/* -------------------------------------------------------------------- codecs */

/** Pretends to shrink an image. Exercises replacement without real pixels. */
const stubCodec = {
  async resampleJpeg(bytes, maxEdge) {
    return { data: new Uint8Array(Math.max(8, Math.floor(bytes.length / 4))), width: maxEdge, height: maxEdge };
  },
  async resampleRaw(raw, w, h, comps, maxEdge) {
    return { data: new Uint8Array(Math.max(8, Math.floor(raw.length / 20))), width: Math.min(w, maxEdge), height: Math.min(h, maxEdge) };
  }
};

const nullCodec = { async resampleJpeg() { return null; }, async resampleRaw() { return null; } };
const throwingCodec = {
  async resampleJpeg() { throw new Error('codec exploded'); },
  async resampleRaw() { throw new Error('codec exploded'); }
};
const inflatingCodec = {
  async resampleJpeg(bytes) { return { data: new Uint8Array(bytes.length * 2), width: 10, height: 10 }; },
  async resampleRaw(raw) { return { data: new Uint8Array(raw.length * 2), width: 10, height: 10 }; }
};

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional */ }

const realCodec = sharp && {
  async _enc(img, maxEdge, quality) {
    const meta = await img.metadata();
    const scale = Math.min(1, maxEdge / Math.max(meta.width, meta.height));
    const w = Math.max(1, Math.round(meta.width * scale));
    const h = Math.max(1, Math.round(meta.height * scale));
    const data = await img.resize(w, h, { fit: 'fill' }).jpeg({ quality: Math.round(quality * 100) }).toBuffer();
    return { data: new Uint8Array(data), width: w, height: h };
  },
  async resampleJpeg(bytes, maxEdge, q) { return this._enc(sharp(Buffer.from(bytes)), maxEdge, q); },
  async resampleRaw(raw, w, h, comps, maxEdge, q) {
    return this._enc(sharp(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), { raw: { width: w, height: h, channels: comps } }), maxEdge, q);
  }
};

async function noisyImage(w, h, ch) {
  const buf = Buffer.alloc(w * h * ch);
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.sin(i * 0.017) * 90 + Math.random() * 70 + 128) & 255;
  return sharp(buf, { raw: { width: w, height: h, channels: ch } });
}

/* ---------------------------------------------------------------------- run */

console.log('\x1b[1mKagaz stress tests\x1b[0m  ·  ops v' + ops.VERSION + (sharp ? '  ·  sharp available' : '  ·  sharp not installed, using stub codec'));

const good1 = await makePdf(1);
const good3 = await makePdf(3);
const good10 = await makePdf(10);

/* ----------------------------------------------------------- malformed input */

group('Refusing malformed input');

await refuses('zero-byte file', () => ops.load(new Uint8Array(0), 'empty.pdf'), 'empty');
await refuses('null input', () => ops.load(null, 'null.pdf'), 'nodata');
await refuses('plain text renamed .pdf', () => ops.load(Buffer.from('Dear sir, please find attached.'), 'letter.pdf'), 'notpdf');
await refuses('JPEG renamed .pdf', () => ops.load(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70]), 'photo.pdf'), 'notpdf');
await refuses('header only, no body', () => ops.load(Buffer.from('%PDF-1.7\n'), 'stub.pdf'), ['damaged', 'nopages']);
await refuses('truncated at 40 bytes', () => ops.load(good3.slice(0, 40), 'cut.pdf'), 'damaged');
await refuses('truncated at 60%', () => ops.load(good10.slice(0, Math.floor(good10.length * 0.6)), 'half.pdf'), 'damaged');
const encrypted = await makeFakeEncrypted();
await refuses('encrypted document', () => ops.load(encrypted, 'locked.pdf'), 'encrypted');
await refuses('HTML error page renamed .pdf', () => ops.load(Buffer.from('<!DOCTYPE html><html><body>404 Not Found</body></html>'), 'download.pdf'), 'notpdf');

await succeeds('junk bytes before the %PDF header', async () => {
  const junk = concat(Buffer.from('\n\n<!-- proxy noise -->\n'), good1);
  const doc = await ops.load(junk, 'junk.pdf');
  return doc.getPageCount() + ' page recovered';
});

/* -------------------------------------------------------------------- ranges */

group('Page ranges');

const rangeCases = [
  ['', 10, 10, 'empty means all'],
  ['all', 10, 10, 'the word all'],
  ['1-3', 10, 3, 'simple range'],
  ['3-1', 10, 3, 'reversed range is corrected'],
  ['12-', 10, 0, 'range past the end'],
  ['1-999', 10, 10, 'range clamped to the end'],
  ['odd', 10, 5, 'odd pages'],
  ['even', 10, 5, 'even pages'],
  ['last', 10, 1, 'last page'],
  ['2,2,2', 10, 1, 'duplicates collapse'],
  ['banana', 10, 0, 'nonsense is rejected'],
  ['-', 10, 10, 'a lone dash means everything'],
  ['0', 10, 0, 'page zero does not exist'],
  ['-3', 10, 3, 'open start'],
  ['  1 , 2  ;  3 ', 10, 3, 'messy separators']
];

for (const [spec, count, expect, label] of rangeCases) {
  const got = ops.parseRanges(spec, count).indices.length;
  if (got === expect) ok('range "' + spec + '" → ' + got, label);
  else bad('range "' + spec + '"', 'expected ' + expect + ' pages, got ' + got);
}

await succeeds('ranges never throw on hostile input', async () => {
  const hostile = [null, undefined, {}, [], 'a'.repeat(5000), '1-'.repeat(2000), '-'.repeat(500), '99999999999-'];
  for (const h of hostile) ops.parseRanges(h, 10);
  return hostile.length + ' hostile inputs survived';
});

/* --------------------------------------------------------------------- merge */

group('Merge');

await refuses('merging nothing', () => ops.merge([]), 'nofiles');
await refuses('merge with one bad file in the middle', () => ops.merge([
  { name: 'ok.pdf', bytes: good1 },
  { name: 'broken.pdf', bytes: Buffer.from('not a pdf at all') },
  { name: 'ok2.pdf', bytes: good1 }
]), 'notpdf');

await succeeds('merge 2 files', async () => {
  const out = await ops.merge([{ name: 'a.pdf', bytes: good3 }, { name: 'b.pdf', bytes: good1 }]);
  const info = await inspect(out.bytes);
  if (info.pages !== 4) return 'expected 4 pages, got ' + info.pages;
  if (!info.hasText) return 'text did not survive the merge';
  return '4 pages, text intact';
});

await succeeds('merge preserves mixed page sizes', async () => {
  const a4 = await makePdf(1);
  const a3 = await makePdf(1, { size: [841.89, 1190.55] });
  const tiny = await makePdf(1, { size: [72, 72] });
  const out = await ops.merge([{ name: 'a4', bytes: a4 }, { name: 'a3', bytes: a3 }, { name: 'tiny', bytes: tiny }]);
  const doc = await ops.load(out.bytes);
  const sizes = doc.getPages().map(p => Math.round(p.getSize().width));
  if (sizes[0] === sizes[1]) return 'page sizes were normalised — they should differ';
  return sizes.join(' / ') + ' pt wide';
});

await succeeds('merge preserves rotation', async () => {
  const rotated = await makePdf(1, { rotate: 90 });
  const out = await ops.merge([{ name: 'r', bytes: rotated }, { name: 'n', bytes: good1 }]);
  const doc = await ops.load(out.bytes);
  const angle = doc.getPage(0).getRotation().angle;
  if (angle !== 90) return 'rotation lost — expected 90, got ' + angle;
  return 'rotation kept at 90°';
});

await succeeds('merge 50 files', async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ name: 'f' + i + '.pdf', bytes: good3 }));
  const out = await ops.merge(items);
  if (out.pages !== 150) return 'expected 150 pages, got ' + out.pages;
  return '150 pages, ' + Math.round(out.bytes.length / 1024) + ' KB';
});

await succeeds('merge honours per-file ranges', async () => {
  const out = await ops.merge([
    { name: 'a.pdf', bytes: good10, range: '1-3' },
    { name: 'b.pdf', bytes: good10, range: 'last' }
  ]);
  if (out.pages !== 4) return 'expected 4 pages, got ' + out.pages;
  return '4 pages from 20';
});

await refuses('merge with a range that selects nothing', () => ops.merge([
  { name: 'a.pdf', bytes: good3, range: '50-60' }
]), 'badrange');

await succeeds('merge with unicode filenames', async () => {
  const out = await ops.merge([
    { name: 'रिपोर्ट.pdf', bytes: good1 },
    { name: '報告書 (final) [v2].pdf', bytes: good1 }
  ]);
  return out.pages + ' pages';
});

/* --------------------------------------------------------------------- split */

group('Split');

await succeeds('split into one file per page', async () => {
  const out = await ops.split(good10, 'each', {}, 'doc.pdf');
  if (out.files.length !== 10) return 'expected 10 files, got ' + out.files.length;
  const first = await inspect(out.files[0].bytes);
  if (first.pages !== 1) return 'first file has ' + first.pages + ' pages';
  return '10 files, names ' + out.files[0].name + ' … ' + out.files[9].name;
});

await succeeds('split every 3 pages leaves a short tail', async () => {
  const out = await ops.split(good10, 'every', { size: 3 }, 'doc.pdf');
  if (out.files.length !== 4) return 'expected 4 files, got ' + out.files.length;
  if (out.files[3].pages !== 1) return 'tail file should have 1 page, has ' + out.files[3].pages;
  return '4 files: 3+3+3+1';
});

await succeeds('split every 0 pages is treated as 1', async () => {
  const out = await ops.split(good3, 'every', { size: 0 }, 'doc.pdf');
  return out.files.length + ' files';
});

await succeeds('split every 99999 pages gives one file', async () => {
  const out = await ops.split(good10, 'every', { size: 99999 }, 'doc.pdf');
  if (out.files.length !== 1) return 'expected 1 file, got ' + out.files.length;
  return '1 file of 10 pages';
});

await succeeds('split at uneven breakpoints', async () => {
  const out = await ops.split(good10, 'at', { at: '4, 8' }, 'doc.pdf');
  const shape = out.files.map(f => f.pages).join('+');
  if (shape !== '3+4+3') return 'expected 3+4+3, got ' + shape;
  return shape;
});

await succeeds('extract a range', async () => {
  const out = await ops.split(good10, 'extract', { ranges: '2-4, 9' }, 'doc.pdf');
  if (out.files.length !== 1) return 'expected a single file';
  if (out.files[0].pages !== 4) return 'expected 4 pages, got ' + out.files[0].pages;
  return '4 pages in one file';
});

await refuses('extract with an out-of-range selection', () => ops.split(good3, 'extract', { ranges: '90-99' }, 'doc.pdf'), 'nogroups');
await refuses('split with an unknown mode', () => ops.split(good3, 'sideways', {}, 'doc.pdf'), 'nogroups');

await succeeds('split neutralises path traversal in filenames', async () => {
  const nasty = ['../../etc/passwd.pdf', '..\\..\\windows\\system32\\a.pdf', '/absolute/path.pdf', '....//....//x.pdf'];
  for (const name of nasty) {
    const out = await ops.split(good1, 'each', {}, name);
    const entry = out.files[0].name;
    if (/[\\/]/.test(entry)) return 'a separator survived in "' + entry + '" (from ' + name + ')';
    if (entry.includes('..')) return 'a ".." segment survived in "' + entry + '"';
    if (entry.startsWith('.')) return 'a leading dot survived in "' + entry + '"';
  }
  return nasty.length + ' hostile filenames neutralised';
});

/* ---------------------------------------------------------------- compression */

group('Compression — structure and safety');

await succeeds('structural pass on a text-only PDF', async () => {
  const out = await ops.compress(good10, { mode: 'structural', name: 'doc.pdf' });
  const info = await inspect(out.bytes);
  if (!info.hasText) return 'text was destroyed by a lossless pass';
  if (info.pages !== 10) return 'page count changed';
  return out.before + ' → ' + out.after + ' bytes, text intact';
});

await succeeds('image mode on a PDF with no images does nothing harmful', async () => {
  const out = await ops.compress(good3, { mode: 'images', name: 'doc.pdf' }, stubCodec);
  if (out.stats.images !== 0) return 'found phantom images';
  const info = await inspect(out.bytes);
  if (!info.hasText) return 'text was destroyed';
  return 'no images found, text intact';
});

if (sharp) {
  const jpgBytes = await (await noisyImage(2400, 1700, 3)).jpeg({ quality: 95 }).toBuffer();
  const pngBytes = await (await noisyImage(1800, 1200, 3)).png().toBuffer();
  const grayBytes = await (await noisyImage(1400, 1000, 1)).png().toBuffer();

  async function pdfWithImages(list) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const item of list) {
      const img = item.type === 'jpg' ? await doc.embedJpg(item.bytes) : await doc.embedPng(item.bytes);
      const page = doc.addPage([595.28, 841.89]);
      page.drawImage(img, { x: 20, y: 300, width: 555, height: 400 });
      page.drawText('This text must survive compression.', { x: 40, y: 120, size: 13, font, color: rgb(0, 0, 0) });
    }
    return doc.save();
  }

  const imagey = await pdfWithImages([
    { type: 'jpg', bytes: jpgBytes }, { type: 'png', bytes: pngBytes }, { type: 'png', bytes: grayBytes }
  ]);

  group('Compression — real pixels (sharp)');

  await succeeds('image-heavy PDF shrinks substantially', async () => {
    const out = await ops.compress(imagey, { mode: 'images', dpi: 150, quality: 0.72, name: 'big.pdf' }, realCodec);
    const cut = Math.round(100 - (out.after / out.before) * 100);
    if (cut < 40) return 'only ' + cut + '% saved — expected far more on an image-heavy file';
    return Math.round(out.before / 1024) + ' KB → ' + Math.round(out.after / 1024) + ' KB (' + cut + '% off)';
  });

  await succeeds('text survives image compression', async () => {
    const out = await ops.compress(imagey, { mode: 'images', dpi: 150, quality: 0.72 }, realCodec);
    const info = await inspect(out.bytes);
    if (!info.hasText) return 'THE TEXT WAS DESTROYED — this is the bug the whole tool exists to avoid';
    if (info.images !== 3) return 'image count changed from 3 to ' + info.images;
    if (info.pages !== 3) return 'page count changed';
    return '3 pages, 3 images, text still selectable';
  });

  await succeeds('output re-opens and can be compressed again', async () => {
    const once = await ops.compress(imagey, { mode: 'images', dpi: 150, quality: 0.72 }, realCodec);
    const twice = await ops.compress(once.bytes, { mode: 'images', dpi: 96, quality: 0.6 }, realCodec);
    if (twice.after > once.after) return 'second pass made it bigger';
    return Math.round(once.after / 1024) + ' KB → ' + Math.round(twice.after / 1024) + ' KB';
  });

  await succeeds('higher dpi produces a larger file than lower dpi', async () => {
    const low = await ops.compress(imagey, { mode: 'images', dpi: 96, quality: 0.72 }, realCodec);
    const high = await ops.compress(imagey, { mode: 'images', dpi: 220, quality: 0.72 }, realCodec);
    if (high.after <= low.after) return 'dpi setting had no effect';
    return '96 dpi ' + Math.round(low.after / 1024) + ' KB · 220 dpi ' + Math.round(high.after / 1024) + ' KB';
  });

  await succeeds('CMYK images are refused, not mangled', async () => {
    const cmyk = await (await noisyImage(1200, 900, 3)).jpeg({ quality: 92 }).toColourspace('cmyk').toBuffer();
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(cmyk);
    doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    const out = await ops.compress(await doc.save(), { mode: 'images', dpi: 150, quality: 0.7 }, realCodec);
    if (out.stats.changed !== 0) return 'a CMYK image was re-encoded — colours would shift on print';
    if (!out.stats.skipped.length) return 'no reason was recorded for skipping';
    return 'skipped: ' + out.stats.skipped[0].reason;
  });
}

group('Compression — hostile codecs');

/**
 * A PDF carrying an image XObject whose payload is not a real JPEG.
 *
 * The stub codecs never decode anything, so the bytes do not need to be
 * valid — this exercises the discovery, replacement and rejection logic
 * without requiring an image library. It is how the suite stays runnable
 * with zero dependencies.
 */
const withImage = await (async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;

  const payload = new Uint8Array(4096).fill(0x7f);
  const dict = ctx.obj({
    Type: 'XObject', Subtype: 'Image',
    Width: 1000, Height: 800,
    ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    Filter: 'DCTDecode', Length: payload.length
  });
  const ref = ctx.register(PDFRawStream.of(dict, payload));

  page.node.setXObject(PDFName.of('Im0'), ref);
  return doc.save();
})();

await succeeds('codec returning null leaves the image alone', async () => {
  const out = await ops.compress(withImage, { mode: 'images', dpi: 96, quality: 0.5 }, nullCodec);
  if (out.stats.changed !== 0) return 'something was changed despite the codec declining';
  const info = await inspect(out.bytes);
  if (info.images !== 1) return 'the image vanished';
  return 'image preserved, ' + out.stats.skipped.length + ' skip recorded';
});

await succeeds('codec that throws is caught per image', async () => {
  const out = await ops.compress(withImage, { mode: 'images', dpi: 96, quality: 0.5 }, throwingCodec);
  if (out.stats.changed !== 0) return 'changed an image despite the codec throwing';
  if (!out.stats.skipped.some(s => /error/.test(s.reason))) return 'the error was not recorded';
  return 'error caught and reported, file still valid';
});

await succeeds('codec producing a larger image is rejected', async () => {
  const out = await ops.compress(withImage, { mode: 'images', dpi: 96, quality: 0.5 }, inflatingCodec);
  if (out.stats.changed !== 0) return 'accepted a replacement that was bigger than the original';
  return 'inflation rejected';
});

await succeeds('missing codec falls back to structural', async () => {
  const out = await ops.compress(withImage, { mode: 'images', dpi: 96 }, null);
  if (out.stats.changed !== 0) return 'changed images without a codec';
  return 'degraded gracefully';
});

/* ------------------------------------------------------------------ extremes */

group('Extremes');

await succeeds('2000-page document', async () => {
  const big = await makePdf(2000);
  const started = Date.now();
  const out = await ops.split(big, 'extract', { ranges: '1000-1010' }, 'big.pdf');
  const took = Date.now() - started;
  if (out.files[0].pages !== 11) return 'expected 11 pages, got ' + out.files[0].pages;
  if (took > 30000) return 'took ' + took + ' ms — too slow';
  return '11 pages extracted from 2000 in ' + took + ' ms';
});

await succeeds('absurdly large page size', async () => {
  const huge = await makePdf(1, { size: [14400, 14400] });   // 200 × 200 inches, the PDF maximum
  const out = await ops.compress(huge, { mode: 'images', dpi: 150 }, stubCodec);
  return 'handled a 200in page, maxEdge ' + out.stats.maxEdge + ' px';
});

await succeeds('one-point page', async () => {
  const tiny = await makePdf(1, { size: [1, 1], fontSize: 1 });
  const out = await ops.compress(tiny, { mode: 'images', dpi: 150 }, stubCodec);
  if (out.stats.maxEdge < 320) return 'maxEdge collapsed to ' + out.stats.maxEdge;
  return 'maxEdge floored at ' + out.stats.maxEdge + ' px';
});

await succeeds('all four rotations survive a round trip', async () => {
  const angles = [0, 90, 180, 270];
  for (const angle of angles) {
    const src = await makePdf(1, { rotate: angle });
    const out = await ops.merge([{ name: 'r.pdf', bytes: src }]);
    const doc = await ops.load(out.bytes);
    const got = doc.getPage(0).getRotation().angle;
    if (got !== angle) return 'rotation ' + angle + '° became ' + got + '°';
  }
  return '0/90/180/270 all preserved';
});

await succeeds('splitting a single-page document', async () => {
  const out = await ops.split(good1, 'each', {}, 'one.pdf');
  if (out.files.length !== 1) return 'expected 1 file';
  return '1 file';
});

await succeeds('describe() reports a sane summary', async () => {
  const info = await ops.describe(good10, 'doc.pdf');
  if (info.pages !== 10) return 'wrong page count';
  if (typeof info.images !== 'number') return 'image count missing';
  return info.pages + ' pages, ' + info.images + ' images, ' + Object.keys(info.sizes).length + ' distinct size';
});

/* ------------------------------------------------------- geometry and stamps */

group('Rotate, organise, crop');

await succeeds('rotate every page by 90', async () => {
  const out = await ops.rotate(good10, { angle: 90 });
  const doc = await ops.load(out.bytes);
  const angles = doc.getPages().map(p => p.getRotation().angle);
  if (!angles.every(a => a === 90)) return 'got ' + [...new Set(angles)].join(',');
  return '10 pages at 90 degrees';
});

await succeeds('rotation is relative, not absolute', async () => {
  const once = await ops.rotate(good3, { angle: 90 });
  const twice = await ops.rotate(once.bytes, { angle: 90 });
  const doc = await ops.load(twice.bytes);
  const a = doc.getPage(0).getRotation().angle;
  if (a !== 180) return '90 + 90 gave ' + a + ' degrees';
  return '90 + 90 = 180';
});

await succeeds('rotating a range leaves the rest alone', async () => {
  const out = await ops.rotate(good10, { angle: 270, absolute: true, ranges: '1-2' });
  const doc = await ops.load(out.bytes);
  if (doc.getPage(0).getRotation().angle !== 270) return 'page 1 was not turned';
  if (doc.getPage(5).getRotation().angle !== 0) return 'the rotation leaked past the range';
  return 'pages 1-2 only';
});

await succeeds('organise reorders, deletes and duplicates', async () => {
  const reversed = await ops.organize(good10, { order: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] });
  if (reversed.pages !== 10) return 'reverse changed the count';
  const fewer = await ops.organize(good10, { order: [0, 2, 4] });
  if (fewer.pages !== 3) return 'delete gave ' + fewer.pages + ' pages';
  const dup = await ops.organize(good3, { order: [0, 0, 0, 0] });
  if (dup.pages !== 4) return 'duplicate gave ' + dup.pages + ' pages';
  return 'reverse / 10→3 / 1→4';
});

await succeeds('organise applies per-page rotation', async () => {
  const out = await ops.organize(good3, { order: [1], rotations: { 1: 90 } });
  const doc = await ops.load(out.bytes);
  if (doc.getPage(0).getRotation().angle !== 90) return 'rotation was not applied';
  return 'single page kept and turned';
});

await refuses('organise refuses to delete every page', () => ops.organize(good3, { order: [] }), 'nopages');
await refuses('organise ignores out-of-range indices', () => ops.organize(good3, { order: [50, 60] }), 'nopages');

await succeeds('crop sets a smaller CropBox', async () => {
  const out = await ops.crop(good3, { margins: { left: 0.1, right: 0.1, top: 0.05, bottom: 0.05 } });
  const doc = await ops.load(out.bytes);
  const box = doc.getPage(0).getCropBox();
  if (Math.abs(box.width - 595.28 * 0.8) > 1) return 'width came out ' + box.width.toFixed(1);
  if (Math.abs(box.height - 841.89 * 0.9) > 1) return 'height came out ' + box.height.toFixed(1);
  return Math.round(box.width) + '×' + Math.round(box.height) + ' pt';
});

await refuses('crop refuses zero margins', () => ops.crop(good3, { margins: {} }), 'nocrop');

await succeeds('crop clamps absurd margins instead of producing nothing', async () => {
  const out = await ops.crop(good3, { margins: { left: 9, right: 9, top: 9, bottom: 9 } });
  const doc = await ops.load(out.bytes);
  const box = doc.getPage(0).getCropBox();
  if (box.width < 1 || box.height < 1) return 'produced an empty page';
  return 'clamped to ' + Math.round(box.width) + '×' + Math.round(box.height) + ' pt';
});

group('Page numbers and stamps');

await succeeds('numbers every page', async () => {
  const out = await ops.pageNumbers(good10, { format: '{n} of {total}' });
  if (out.numbered !== 10) return 'numbered ' + out.numbered;
  const info = await inspect(out.bytes);
  if (info.pages !== 10) return 'page count changed';
  return '10 numbered, "1 of 10"';
});

await succeeds('numbers a range with a custom start', async () => {
  const out = await ops.pageNumbers(good10, { ranges: '3-', start: 1, position: 'top-right' });
  if (out.numbered !== 8) return 'numbered ' + out.numbered;
  return 'pages 3-10 numbered from 1';
});

await refuses('numbering an empty selection', () => ops.pageNumbers(good3, { ranges: '80-90' }), 'nopages');

await succeeds('tiled text watermark', async () => {
  const out = await ops.stampPages(good3, { text: 'CONFIDENTIAL', tile: true, opacity: 0.2, angle: 45, size: 36 });
  if (out.stamped !== 3) return 'stamped ' + out.stamped;
  return '3 pages, ' + Math.round(out.bytes.length / 1024) + ' KB';
});

await succeeds('single positioned stamp', async () => {
  const out = await ops.stampPages(good3, { text: 'DRAFT', tile: false, position: 'bottom-right', opacity: 0.5 });
  if (out.stamped !== 3) return 'stamped ' + out.stamped;
  return 'bottom right on 3 pages';
});

await refuses('stamping nothing', () => ops.stampPages(good3, {}), 'nothing');
await refuses('stamping a corrupt image', () => ops.stampPages(good3, { image: new Uint8Array([1, 2, 3, 4]) }), 'badimage');

await succeeds('signature on the last page only', async () => {
  // A 1x1 PNG is enough to prove the placement path works.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const out = await ops.stampPages(good10, { image: new Uint8Array(png), imageType: 'png', ranges: 'last', opacity: 1, scale: 0.25 });
  if (out.stamped !== 1) return 'stamped ' + out.stamped + ' pages';
  return 'one page signed';
});

group('Images in');

await refuses('no images at all', () => ops.imagesToPdf([]), 'nofiles');
await refuses('nothing readable as an image', () => ops.imagesToPdf([{ name: 'x.jpg', bytes: new Uint8Array([1, 2, 3]) }]), 'noimages');

await succeeds('one unreadable image does not lose the rest', async () => {
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const out = await ops.imagesToPdf([
    { name: 'good.png', bytes: png, type: 'png' },
    { name: 'junk.png', bytes: new Uint8Array([1, 2, 3]), type: 'png' },
    { name: 'good2.png', bytes: png, type: 'png' }
  ], { pageSize: 'a4' });
  if (out.pages !== 2) return 'expected 2 pages, got ' + out.pages;
  if (out.skipped.length !== 1) return 'expected 1 skip, got ' + out.skipped.length;
  return '2 pages kept, 1 skipped: ' + out.skipped[0].reason;
});

group('Redaction');

await refuses('redacting with no areas', () => ops.redact(good3, { areas: [] }, async () => {}), 'noareas');
await refuses('redacting a page that does not exist', () => ops.redact(good3, { areas: [{ page: 99, x: 0, y: 0, w: 1, h: 1 }] }, async () => {}), 'noareas');

await succeeds('only marked pages are flattened', async () => {
  const rendered = [];
  // A tiny valid JPEG stands in for a rendered page.
  const jpeg = new Uint8Array(Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1td' +
    'hbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSk' +
    'pKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAACAAIDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAA' +
    'AAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMR' +
    'AD8AAA//2Q==', 'base64'));

  const out = await ops.redact(good10, {
    areas: [{ page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, { page: 4, x: 0.2, y: 0.4, w: 0.4, h: 0.1 }]
  }, async (i) => { rendered.push(i); return { data: jpeg }; });

  if (out.flattened !== 2) return 'flattened ' + out.flattened + ' pages';
  if (rendered.join() !== '1,4') return 'rendered the wrong pages: ' + rendered.join();
  if (out.pages !== 10) return 'page count became ' + out.pages;
  return '2 of 10 pages flattened, 8 kept intact';
});

/* --------------------------------------------------------------------- report */

console.log('\n' + '─'.repeat(64));
console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failed) {
  console.log('\n\x1b[31mFailures:\x1b[0m');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('\x1b[32mEverything refused what it should refuse and kept what it should keep.\x1b[0m');
