/*!
 * Kagaz — PDF operations.
 *
 * Deliberately DOM-free so the same code runs in the browser and in Node,
 * which is what lets tests/stress.mjs hammer it headlessly. Anything that
 * genuinely needs a browser (decoding a JPEG, rendering a page) is passed in
 * as a `codec` or `renderer` argument rather than reached for directly.
 *
 * Browser:  <script src="../vendor/pdf-lib.min.js"></script>
 *           <script src="../shared/ops.js"></script>   ->  window.KagazOps
 * Node:     const ops = require('./shared/ops.js')(require('./vendor/pdf-lib.min.js'))
 *
 * MIT © namastevis
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.KagazOps = factory(root.PDFLib);
})(typeof self !== 'undefined' ? self : globalThis, function (PDFLib) {
  'use strict';

  if (!PDFLib) throw new Error('Kagaz: pdf-lib must be loaded before ops.js');

  var PDFDocument = PDFLib.PDFDocument,
      PDFName = PDFLib.PDFName,
      PDFRawStream = PDFLib.PDFRawStream,
      PDFArray = PDFLib.PDFArray,
      PDFNumber = PDFLib.PDFNumber,
      decodePDFRawStream = PDFLib.decodePDFRawStream;

  var VERSION = '1.0.0';
  var PRODUCER = 'Kagaz · kagaz.namastevis.in';

  /* ------------------------------------------------------------------ *
   * Errors
   * ------------------------------------------------------------------ */

  /**
   * An error we are willing to show a human. `code` lets the UI decide
   * whether to offer a next step; `message` is already plain English.
   */
  function KagazError(code, message, detail) {
    var e = new Error(message);
    e.name = 'KagazError';
    e.code = code;
    e.detail = detail;
    e.friendly = true;
    return e;
  }

  /* ------------------------------------------------------------------ *
   * Loading
   * ------------------------------------------------------------------ */

  var MAX_BYTES = 600 * 1024 * 1024;

  function asBytes(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input.buffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    return null;
  }

  function looksLikePdf(bytes) {
    // The header is usually at byte 0, but the spec tolerates junk in front
    // of it and plenty of real-world files have some. Scan the first 1 KB.
    var n = Math.min(bytes.length, 1024), s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
    return s.indexOf('%PDF-') !== -1;
  }

  /**
   * Load a PDF, converting pdf-lib's internal failures into messages a
   * person can act on. Encrypted files are refused rather than silently
   * producing garbage output, which is what ignoreEncryption would do.
   */
  async function load(input, name) {
    var label = name ? '“' + name + '”' : 'That file';
    var bytes = asBytes(input);

    if (!bytes) throw KagazError('nodata', label + ' could not be read.');
    if (bytes.length === 0) throw KagazError('empty', label + ' is empty — 0 bytes.');
    if (bytes.length > MAX_BYTES) {
      throw KagazError('toobig', label + ' is larger than 600 MB, which will run this browser out of memory.');
    }
    if (!looksLikePdf(bytes)) {
      throw KagazError('notpdf', label + ' is not a PDF. The file may have been renamed, or the download may have failed.');
    }

    var doc;
    try {
      doc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        updateMetadata: false
      });
    } catch (err) {
      throw KagazError('damaged',
        label + ' could not be opened — the PDF structure is damaged.',
        err && err.message);
    }

    if (doc.isEncrypted) {
      throw KagazError('encrypted',
        label + ' is password-protected. Kagaz will not guess or strip passwords; open it in a reader, ' +
        'save an unprotected copy, and try again.');
    }

    var count = 0;
    try { count = doc.getPageCount(); } catch (e) { count = 0; }
    if (count === 0) throw KagazError('nopages', label + ' contains no pages.');

    return doc;
  }

  function stamp(doc) {
    try {
      doc.setProducer(PRODUCER);
      doc.setCreator(PRODUCER);
      doc.setModificationDate(new Date());
    } catch (e) { /* metadata is a nicety, never a reason to fail */ }
  }

  /* ------------------------------------------------------------------ *
   * Page ranges
   * ------------------------------------------------------------------ */

  /**
   * Parse "1-3, 7, 12-" into zero-based page indices.
   * Also understands: all, odd, even, last, first, and open-ended ranges.
   * Never throws — returns whatever it understood plus a list of complaints,
   * so the UI can show the damage while still offering a usable result.
   */
  function parseRanges(spec, pageCount) {
    var out = [], errors = [], seen = {};
    var text = String(spec == null ? '' : spec).trim().toLowerCase();

    function push(i) {
      if (i >= 0 && i < pageCount && !seen[i]) { seen[i] = 1; out.push(i); }
    }

    if (!text || text === 'all') {
      for (var a = 0; a < pageCount; a++) push(a);
      return { indices: out, errors: errors };
    }

    var tokens = text.split(/[,;\s]+/).filter(Boolean);
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];

      if (tok === 'odd')   { for (var o = 0; o < pageCount; o += 2) push(o); continue; }
      if (tok === 'even')  { for (var e = 1; e < pageCount; e += 2) push(e); continue; }
      if (tok === 'last')  { push(pageCount - 1); continue; }
      if (tok === 'first') { push(0); continue; }

      var m = tok.match(/^(\d+)?-(\d+)?$/);
      if (m) {
        var hasFrom = m[1] != null, hasTo = m[2] != null;
        var from = hasFrom ? parseInt(m[1], 10) : 1;
        var to   = hasTo   ? parseInt(m[2], 10) : pageCount;
        // Only reorder when both ends were actually given. "12-" on a
        // ten-page file is a mistake worth reporting, not a request for
        // pages 10 through 12.
        if (hasFrom && hasTo && from > to) { var sw = from; from = to; to = sw; }
        if (from > pageCount) { errors.push('Page ' + from + ' is past the end (' + pageCount + ' pages).'); continue; }
        if (from < 1) from = 1;
        for (var p = from; p <= Math.min(to, pageCount); p++) push(p - 1);
        continue;
      }

      if (/^\d+$/.test(tok)) {
        var n = parseInt(tok, 10);
        if (n < 1 || n > pageCount) { errors.push('Page ' + n + ' does not exist (' + pageCount + ' pages).'); continue; }
        push(n - 1);
        continue;
      }

      errors.push('Could not read “' + tok + '”.');
    }

    return { indices: out, errors: errors };
  }

  /* ------------------------------------------------------------------ *
   * Merge
   * ------------------------------------------------------------------ */

  /**
   * items: [{ name, bytes, range? }]
   * Page size, rotation and orientation are preserved per page — merging
   * never normalises anything to A4, which is a common annoyance elsewhere.
   */
  async function merge(items, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    if (!items || !items.length) throw KagazError('nofiles', 'Add at least one PDF first.');

    var out = await PDFDocument.create();
    var report = [];

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      onProgress(i / items.length, it.name);

      var src = await load(it.bytes, it.name);
      var count = src.getPageCount();
      var indices = src.getPageIndices();

      if (it.range) {
        var parsed = parseRanges(it.range, count);
        if (!parsed.indices.length) {
          throw KagazError('badrange', 'The page range for “' + it.name + '” selected no pages.');
        }
        indices = parsed.indices;
      }

      var copied = await out.copyPages(src, indices);
      for (var c = 0; c < copied.length; c++) out.addPage(copied[c]);
      report.push({ name: it.name, pages: indices.length, of: count });
    }

    stamp(out);
    onProgress(1, null);
    var bytes = await out.save({ useObjectStreams: true });
    return { bytes: bytes, pages: out.getPageCount(), report: report };
  }

  /* ------------------------------------------------------------------ *
   * Split
   * ------------------------------------------------------------------ */

  /**
   * Turn a source filename into something safe to use as a ZIP entry.
   * Separators and "..' segments are neutralised so a hostile filename
   * cannot write outside the folder someone extracts into.
   */
  function baseName(name) {
    return String(name || 'document')
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/^[.\s]+/, '')
      .trim() || 'document';
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /**
   * Work out which pages land in which output file, without touching the
   * document. Kept separate from split() so the UI can preview the plan
   * ("12 files, 3 pages each") before anyone commits to a download.
   */
  function splitPlan(mode, options, pageCount, name) {
    var base = baseName(name);
    var width = String(pageCount).length;
    var groups = [], errors = [], i, n;

    if (mode === 'extract') {
      var parsed = parseRanges(options.ranges, pageCount);
      errors = parsed.errors;
      if (parsed.indices.length) {
        groups.push({ name: base + '_extract.pdf', indices: parsed.indices });
      }
    } else if (mode === 'every') {
      n = Math.max(1, parseInt(options.size, 10) || 1);
      for (i = 0; i < pageCount; i += n) {
        var chunk = [];
        for (var j = i; j < Math.min(i + n, pageCount); j++) chunk.push(j);
        groups.push({
          name: base + '_' + pad(i + 1, width) + '-' + pad(Math.min(i + n, pageCount), width) + '.pdf',
          indices: chunk
        });
      }
    } else if (mode === 'each') {
      for (i = 0; i < pageCount; i++) {
        groups.push({ name: base + '_' + pad(i + 1, width) + '.pdf', indices: [i] });
      }
    } else if (mode === 'at') {
      var cuts = parseRanges(options.at, pageCount).indices.slice().sort(function (a, b) { return a - b; });
      var start = 0;
      cuts.push(pageCount);
      for (var k = 0; k < cuts.length; k++) {
        var end = Math.min(cuts[k], pageCount);
        if (end <= start) continue;
        var g = [];
        for (var q = start; q < end; q++) g.push(q);
        groups.push({ name: base + '_part' + (groups.length + 1) + '.pdf', indices: g });
        start = end;
      }
    } else {
      errors.push('Unknown split mode “' + mode + '”.');
    }

    return { groups: groups, errors: errors };
  }

  async function split(input, mode, options, name, onProgress) {
    onProgress = onProgress || function () {};
    var src = await load(input, name);
    var pageCount = src.getPageCount();
    var plan = splitPlan(mode, options || {}, pageCount, name);

    if (!plan.groups.length) {
      throw KagazError('nogroups',
        plan.errors.length ? plan.errors.join(' ') : 'That selection produced no pages.');
    }

    var files = [];
    for (var i = 0; i < plan.groups.length; i++) {
      var g = plan.groups[i];
      var out = await PDFDocument.create();
      var copied = await out.copyPages(src, g.indices);
      for (var c = 0; c < copied.length; c++) out.addPage(copied[c]);
      stamp(out);
      files.push({ name: g.name, bytes: await out.save({ useObjectStreams: true }), pages: g.indices.length });
      onProgress((i + 1) / plan.groups.length, g.name);
    }

    return { files: files, errors: plan.errors, sourcePages: pageCount };
  }

  /* ------------------------------------------------------------------ *
   * Compression
   * ------------------------------------------------------------------ */

  function num(v) {
    if (v == null) return null;
    if (typeof v.asNumber === 'function') return v.asNumber();
    if (typeof v.numberValue === 'number') return v.numberValue;
    return null;
  }

  function filterNames(dict) {
    var f = dict.lookup(PDFName.of('Filter'));
    if (!f) return [];
    if (f instanceof PDFArray) {
      var list = [];
      for (var i = 0; i < f.size(); i++) {
        var el = f.lookup(i);
        if (el && el.asString) list.push(el.asString().replace(/^\//, ''));
      }
      return list;
    }
    if (f.asString) return [f.asString().replace(/^\//, '')];
    return [];
  }

  /**
   * How many colour components does this image have, and can we safely hand
   * it to a browser canvas? ICCBased is the common real-world case and is
   * resolved through its /N entry. Anything exotic returns null, which the
   * caller treats as "leave this image alone".
   */
  function componentCount(dict) {
    var cs = dict.lookup(PDFName.of('ColorSpace'));
    if (!cs) return null;

    if (cs.asString) {
      var nm = cs.asString();
      if (nm === '/DeviceRGB' || nm === '/RGB' || nm === '/CalRGB') return 3;
      if (nm === '/DeviceGray' || nm === '/G' || nm === '/CalGray') return 1;
      if (nm === '/DeviceCMYK' || nm === '/CMYK') return 4;
      return null;
    }

    if (cs instanceof PDFArray && cs.size() >= 1) {
      var head = cs.lookup(0);
      var family = head && head.asString ? head.asString() : '';
      if (family === '/ICCBased') {
        var streamRef = cs.lookup(1);
        var n = streamRef && streamRef.dict ? num(streamRef.dict.lookup(PDFName.of('N'))) : null;
        return n === 1 || n === 3 || n === 4 ? n : null;
      }
      // Indexed, Separation, DeviceN, Lab, Pattern — re-encoding these to
      // plain RGB would change how they render. Not worth the risk.
      return null;
    }

    return null;
  }

  function isImageStream(obj) {
    if (!(obj instanceof PDFRawStream)) return false;
    var st = obj.dict.lookup(PDFName.of('Subtype'));
    return !!(st && st.asString && st.asString() === '/Image');
  }

  function skip(reason, w, h, size) {
    return { status: 'skip', reason: reason, w: w, h: h, size: size };
  }

  /**
   * Re-encode one image XObject in place.
   *
   * This is the heart of the whole tool: it replaces the *image* inside the
   * PDF and leaves text, vectors, links and bookmarks untouched — which is
   * what separates it from the rasterise-the-whole-page trick that most
   * free compressors quietly use.
   */
  async function reencodeImage(ctx, obj, o, codec) {
    var d = obj.dict;
    var w = num(d.lookup(PDFName.of('Width')));
    var h = num(d.lookup(PDFName.of('Height')));
    var originalSize = obj.getContentsSize();

    if (!w || !h) return skip('no dimensions', w, h, originalSize);
    if (d.lookup(PDFName.of('ImageMask'))) return skip('stencil mask', w, h, originalSize);
    if (d.has(PDFName.of('Decode'))) return skip('custom decode array', w, h, originalSize);
    if (d.has(PDFName.of('Mask'))) return skip('has a colour-key mask', w, h, originalSize);

    // A very large image would need width*height*4 bytes as RGBA before we
    // could touch it. On a phone that is a tab crash, so refuse early.
    if (w * h > (o.maxPixels || 40e6)) return skip('too large to process on this device', w, h, originalSize);

    var filters = filterNames(d);
    var bpc = num(d.lookup(PDFName.of('BitsPerComponent'))) || 8;
    var comps = componentCount(d);
    var encoded = null;

    if (filters.length === 1 && filters[0] === 'DCTDecode') {
      // Already a JPEG. The browser can decode it directly.
      if (comps === 4) return skip('CMYK JPEG', w, h, originalSize);
      if (comps === null) return skip('unsupported colour space', w, h, originalSize);
      if (Math.max(w, h) <= o.maxEdge && o.quality >= 0.85) return skip('already small enough', w, h, originalSize);
      encoded = await codec.resampleJpeg(obj.getContents(), o.maxEdge, o.quality);

    } else if (filters.length === 1 && filters[0] === 'FlateDecode') {
      // Raw samples — typically a screenshot or a PNG someone dropped in.
      // These are usually the worst offenders in an oversized PDF.
      if (bpc !== 8) return skip(bpc + '-bit samples', w, h, originalSize);
      if (comps !== 1 && comps !== 3) return skip('unsupported colour space', w, h, originalSize);

      var raw;
      try {
        raw = decodePDFRawStream(obj).decode();
      } catch (err) {
        return skip('could not decompress', w, h, originalSize);
      }
      if (raw.length < w * h * comps) return skip('pixel data is truncated', w, h, originalSize);
      encoded = await codec.resampleRaw(raw, w, h, comps, o.maxEdge, o.quality);

    } else if (!filters.length) {
      return skip('uncompressed', w, h, originalSize);
    } else {
      // JPXDecode (JPEG 2000), JBIG2Decode, CCITTFaxDecode and filter chains.
      // Decoding these correctly in the browser is a project of its own;
      // corrupting someone's scan is much worse than not shrinking it.
      return skip(filters.join(' + '), w, h, originalSize);
    }

    if (!encoded || !encoded.data) return skip('re-encoding failed', w, h, originalSize);
    if (encoded.data.length >= originalSize * 0.95) return skip('no worthwhile saving', w, h, originalSize);

    var nd = d.clone(ctx);
    nd.set(PDFName.of('Width'), ctx.obj(encoded.width));
    nd.set(PDFName.of('Height'), ctx.obj(encoded.height));
    nd.set(PDFName.of('BitsPerComponent'), ctx.obj(8));
    nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    nd.set(PDFName.of('Length'), ctx.obj(encoded.data.length));
    nd.delete(PDFName.of('DecodeParms'));
    nd.delete(PDFName.of('DL'));

    return {
      status: 'ok',
      stream: PDFRawStream.of(nd, encoded.data),
      saved: originalSize - encoded.data.length,
      w: w, h: h, nw: encoded.width, nh: encoded.height,
      size: originalSize, newSize: encoded.data.length
    };
  }

  function stripJunk(doc) {
    try {
      doc.catalog.delete(PDFName.of('Metadata'));
      var pages = doc.getPages();
      for (var i = 0; i < pages.length; i++) {
        pages[i].node.delete(PDFName.of('Thumb'));
        pages[i].node.delete(PDFName.of('PieceInfo'));
      }
    } catch (e) { /* best effort */ }
  }

  /**
   * mode: 'structural' — lossless rewrite. Nothing is re-encoded.
   *       'images'     — downsample and re-encode embedded images. Text stays text.
   *
   * `codec` supplies the two browser-only primitives:
   *   resampleJpeg(bytes, maxEdge, quality) -> { data, width, height }
   *   resampleRaw(samples, w, h, comps, maxEdge, quality) -> { data, width, height }
   */
  async function compress(input, opts, codec) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var bytes = asBytes(input);
    var before = bytes ? bytes.length : 0;
    var doc = await load(bytes, opts.name);

    var stats = { mode: opts.mode || 'structural', images: 0, changed: 0, imageBytesSaved: 0, skipped: [], changes: [] };

    if ((opts.mode === 'images') && codec) {
      // Target the longest edge of the largest page. A 300 dpi image on an A4
      // page is 3508 px on the long edge; anything beyond that is invisible
      // in print and enormous on disk.
      var maxInches = 0, pages = doc.getPages();
      for (var p = 0; p < pages.length; p++) {
        var s = pages[p].getSize();
        maxInches = Math.max(maxInches, Math.max(s.width, s.height) / 72);
      }
      if (!maxInches) maxInches = 11;

      var o = {
        // Floor keeps tiny pages sane; ceiling stops a poster-sized page
        // from asking for a bitmap no device could hold.
        maxEdge: Math.min(10000, Math.max(320, Math.round(maxInches * (opts.dpi || 150)))),
        quality: opts.quality == null ? 0.72 : opts.quality,
        maxPixels: opts.maxPixels || 40e6
      };
      stats.maxEdge = o.maxEdge;

      var ctx = doc.context;
      var targets = [];
      var all = ctx.enumerateIndirectObjects();
      for (var a = 0; a < all.length; a++) {
        if (isImageStream(all[a][1])) targets.push(all[a]);
      }
      stats.images = targets.length;

      for (var t = 0; t < targets.length; t++) {
        onProgress(t / targets.length, 'image ' + (t + 1) + ' of ' + targets.length);
        var ref = targets[t][0], obj = targets[t][1], res;
        try {
          res = await reencodeImage(ctx, obj, o, codec);
        } catch (err) {
          res = skip('error: ' + (err && err.message ? err.message : 'unknown'));
        }
        if (res.status === 'ok') {
          ctx.assign(ref, res.stream);
          stats.changed++;
          stats.imageBytesSaved += res.saved;
          stats.changes.push({ from: res.w + '×' + res.h, to: res.nw + '×' + res.nh, saved: res.saved });
        } else {
          stats.skipped.push({ reason: res.reason, w: res.w, h: res.h, size: res.size });
        }
      }
    }

    stripJunk(doc);
    stamp(doc);
    onProgress(1, 'writing');

    var out = await doc.save({ useObjectStreams: true });
    return { bytes: out, before: before, after: out.length, stats: stats };
  }

  /**
   * Last-resort compression: every page becomes a flat JPEG. Text stops
   * being text, so the UI must say so plainly before anyone clicks it.
   * `renderer(pageIndex, {widthPt, heightPt, rotation})` returns
   * { data: Uint8Array(jpeg), width, height }.
   */
  async function rasterize(input, opts, renderer) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var bytes = asBytes(input);
    var before = bytes ? bytes.length : 0;
    var src = await load(bytes, opts.name);
    var out = await PDFDocument.create();
    var pages = src.getPages();

    for (var i = 0; i < pages.length; i++) {
      var size = pages[i].getSize();
      var rotation = 0;
      try { rotation = ((pages[i].getRotation().angle % 360) + 360) % 360; } catch (e) { rotation = 0; }

      // pdf.js applies rotation when it renders, so a 90°-rotated page comes
      // back with its dimensions swapped. The new page has to match.
      var wPt = (rotation === 90 || rotation === 270) ? size.height : size.width;
      var hPt = (rotation === 90 || rotation === 270) ? size.width : size.height;

      var img = await renderer(i, { widthPt: wPt, heightPt: hPt, rotation: rotation });
      var embedded = await out.embedJpg(img.data);
      var page = out.addPage([wPt, hPt]);
      page.drawImage(embedded, { x: 0, y: 0, width: wPt, height: hPt });
      onProgress((i + 1) / pages.length, 'page ' + (i + 1) + ' of ' + pages.length);
    }

    stamp(out);
    var result = await out.save({ useObjectStreams: true });
    return { bytes: result, before: before, after: result.length, pages: pages.length };
  }

  /* ------------------------------------------------------------------ *
   * Inspection — used by the tool pages to describe a file before acting
   * ------------------------------------------------------------------ */

  async function describe(input, name) {
    var doc = await load(input, name);
    var pages = doc.getPages();
    var sizes = {}, imageCount = 0;

    for (var i = 0; i < pages.length; i++) {
      var s = pages[i].getSize();
      var key = Math.round(s.width) + '×' + Math.round(s.height);
      sizes[key] = (sizes[key] || 0) + 1;
    }
    var all = doc.context.enumerateIndirectObjects();
    for (var a = 0; a < all.length; a++) if (isImageStream(all[a][1])) imageCount++;

    return { pages: pages.length, sizes: sizes, images: imageCount };
  }

  return {
    VERSION: VERSION,
    KagazError: KagazError,
    load: load,
    describe: describe,
    parseRanges: parseRanges,
    merge: merge,
    split: split,
    splitPlan: splitPlan,
    compress: compress,
    rasterize: rasterize,
    // exported for tests
    _internals: { isImageStream: isImageStream, componentCount: componentCount, filterNames: filterNames, baseName: baseName }
  };
});
