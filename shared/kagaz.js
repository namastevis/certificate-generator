/*!
 * Kagaz — shared browser helpers.
 * Everything that needs a DOM, a canvas or a download lives here.
 * The PDF logic itself is in ops.js, which stays DOM-free so it can be tested.
 * MIT © namastevis
 */
(function (window, document) {
  'use strict';

  var here = (document.currentScript && document.currentScript.src) || '';
  var ROOT = here.replace(/shared\/kagaz\.js.*$/, '') || '../';

  var K = {
    ROOT: ROOT,
    VENDOR: ROOT + 'vendor/'
  };

  /* ------------------------------------------------------------------ dom */

  K.$ = function (sel, scope) { return (scope || document).querySelector(sel); };
  K.$$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  K.el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };

  /* -------------------------------------------------------------- numbers */

  K.bytes = function (n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  };

  K.pct = function (before, after) {
    if (!before) return 0;
    return Math.max(0, Math.round(100 - (after / before) * 100));
  };

  /* ------------------------------------------------- device sanity limits */

  // Phones run the whole job in one tab's memory. Rather than let Safari kill
  // the tab with no explanation, warn before starting on something implausible.
  K.isSmallDevice = function () {
    var mem = window.navigator.deviceMemory;
    var narrow = Math.min(window.screen.width, window.screen.height) < 500;
    return (mem && mem <= 4) || narrow;
  };

  K.sizeWarning = function (totalBytes) {
    var mb = totalBytes / 1048576;
    var limit = K.isSmallDevice() ? 60 : 250;
    if (mb < limit) return null;
    return 'That is ' + K.bytes(totalBytes) + ' in one go. Everything runs inside this tab, so very large ' +
      'jobs can run the browser out of memory' + (K.isSmallDevice() ? ' — especially on a phone' : '') +
      '. If it stalls, try fewer files at a time.';
  };

  /* ---------------------------------------------------------- file inputs */

  /**
   * Wire up a drop target: click to browse, drag and drop, and paste.
   * onFiles receives a real Array of File objects, already filtered.
   */
  K.dropzone = function (node, opts) {
    opts = opts || {};
    var accept = opts.accept || '.pdf';
    var input = K.el('input', {
      type: 'file', accept: accept, multiple: opts.multiple ? 'multiple' : null,
      class: 'sr', tabindex: '-1'
    });
    node.appendChild(input);

    function match(file) {
      if (!opts.match) return true;
      return opts.match(file);
    }
    function emit(list) {
      var files = Array.prototype.slice.call(list).filter(match);
      if (files.length) opts.onFiles(files);
      else if (list.length) K.say(node, 'err', 'That file type is not accepted here. Expected ' + accept + '.');
    }

    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { emit(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(function (ev) {
      node.addEventListener(ev, function (e) { e.preventDefault(); node.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      node.addEventListener(ev, function (e) { e.preventDefault(); node.classList.remove('over'); });
    });
    node.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) emit(e.dataTransfer.files);
    });

    return input;
  };

  K.isPdf = function (file) {
    return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  };

  K.read = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error('Could not read “' + file.name + '” from disk.')); };
      r.readAsArrayBuffer(file);
    });
  };

  /* -------------------------------------------------------------- messages */

  /** Replace the callout attached to a node (one message per slot). */
  K.say = function (slot, kind, message, listItems) {
    if (!slot) return;
    slot.innerHTML = '';
    if (!message) return;
    var box = K.el('div', { class: 'callout ' + kind });
    box.appendChild(K.el('span', { text: message }));
    if (listItems && listItems.length) {
      var ul = K.el('ul');
      listItems.slice(0, 8).forEach(function (t) { ul.appendChild(K.el('li', { text: t })); });
      if (listItems.length > 8) ul.appendChild(K.el('li', { text: '…and ' + (listItems.length - 8) + ' more.' }));
      box.appendChild(ul);
    }
    slot.appendChild(box);
  };

  K.humanError = function (err) {
    if (!err) return 'Something went wrong.';
    if (err.friendly) return err.message;
    var m = String(err.message || err);
    if (/out of memory|allocation/i.test(m)) {
      return 'The browser ran out of memory. Try fewer or smaller files — everything is processed inside this tab.';
    }
    return 'Something went wrong: ' + m;
  };

  K.progress = function (node) {
    var bar = K.el('i');
    node.innerHTML = '';
    node.appendChild(bar);
    return {
      set: function (frac) { bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; },
      done: function () { node.innerHTML = ''; }
    };
  };

  /** Yield to the browser so long jobs do not freeze the interface. */
  K.tick = function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  };

  /* ------------------------------------------------------------- downloads */

  K.download = function (data, filename, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = K.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    K.afterglow();
  };

  K.zip = async function (files, zipName, onProgress) {
    if (!window.JSZip) throw new Error('JSZip did not load.');
    var zip = new window.JSZip();
    for (var i = 0; i < files.length; i++) {
      zip.file(files[i].name, files[i].bytes);
    }
    var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, function (meta) {
      if (onProgress) onProgress(meta.percent / 100);
    });
    K.download(blob, zipName, 'application/zip');
  };

  /**
   * The moment of peak gratitude is right after a download fires — not the
   * footer. Reveal the "who made this" block then, once per page load.
   */
  var glowed = false;
  K.afterglow = function () {
    if (glowed) return;
    var node = K.$('#afterglow');
    if (!node) return;
    glowed = true;
    node.hidden = false;
  };

  /* ------------------------------------------------------- the image codec */

  function canvasOf(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toJpegBlob(canvas, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
    });
  }

  async function drawScaled(source, srcW, srcH, maxEdge, quality) {
    var scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    var w = Math.max(1, Math.round(srcW * scale));
    var h = Math.max(1, Math.round(srcH * scale));
    var canvas = canvasOf(w, h);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // JPEG has no alpha; paint white so transparent source pixels do not
    // come out black, which is the classic bug in this kind of tool.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    var blob = await toJpegBlob(canvas, quality);
    if (!blob) return null;
    var buf = await blob.arrayBuffer();
    if (source.close) { try { source.close(); } catch (e) {} }
    return { data: new Uint8Array(buf), width: w, height: h };
  }

  /** The browser half of compression, handed to KagazOps.compress(). */
  K.codec = {
    async resampleJpeg(bytes, maxEdge, quality) {
      var blob = new Blob([bytes], { type: 'image/jpeg' });
      var bmp;
      try { bmp = await createImageBitmap(blob); }
      catch (e) { return null; }           // browser refused it — leave it alone
      return drawScaled(bmp, bmp.width, bmp.height, maxEdge, quality);
    },
    async resampleRaw(raw, w, h, comps, maxEdge, quality) {
      var img = new ImageData(w, h);
      var d = img.data, i, j = 0, k = 0, n = w * h;
      if (comps === 3) {
        for (i = 0; i < n; i++) { d[j++] = raw[k++]; d[j++] = raw[k++]; d[j++] = raw[k++]; d[j++] = 255; }
      } else {
        for (i = 0; i < n; i++) { var v = raw[i]; d[j++] = v; d[j++] = v; d[j++] = v; d[j++] = 255; }
      }
      var bmp;
      try { bmp = await createImageBitmap(img); }
      catch (e) { return null; }
      return drawScaled(bmp, w, h, maxEdge, quality);
    }
  };

  /* ------------------------------------------------------------- rendering */

  var pdfjsReady = false;
  K.pdfjs = function () {
    if (!window.pdfjsLib) throw new Error('pdf.js did not load.');
    if (!pdfjsReady) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = K.VENDOR + 'pdf.worker.min.js';
      pdfjsReady = true;
    }
    return window.pdfjsLib;
  };

  /**
   * Render one page to a canvas at the requested DPI, capped so a huge page
   * cannot allocate a gigapixel bitmap.
   */
  K.renderPage = async function (page, dpi, maxPixels) {
    maxPixels = maxPixels || 30e6;
    var scale = dpi / 72;
    var vp = page.getViewport({ scale: scale });
    if (vp.width * vp.height > maxPixels) {
      scale = scale * Math.sqrt(maxPixels / (vp.width * vp.height));
      vp = page.getViewport({ scale: scale });
    }
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  };

  /**
   * Render every page to a small thumbnail. Organise, rotate, crop and redact
   * all need this, so it lives here rather than being copied four times.
   * Returns [{ index, url, width, height, rotation }]; call release() when done
   * or the object URLs leak.
   */
  K.thumbnails = async function (bytes, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || 200;
    var pdfjsLib = K.pdfjs();
    var doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    var out = [];

    try {
      for (var i = 1; i <= doc.numPages; i++) {
        if (opts.onProgress) opts.onProgress((i - 1) / doc.numPages);
        var page = await doc.getPage(i);
        var base = page.getViewport({ scale: 1 });
        var scale = maxEdge / Math.max(base.width, base.height);
        var vp = page.getViewport({ scale: scale });

        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', 0.7); });
        out.push({
          index: i - 1,
          url: URL.createObjectURL(blob),
          width: canvas.width,
          height: canvas.height,
          rotation: base.rotation || 0
        });
        canvas.width = canvas.height = 0;
        page.cleanup();
        await K.tick();
      }
    } finally {
      doc.destroy();
    }

    out.release = function () {
      out.forEach(function (t) { URL.revokeObjectURL(t.url); });
    };
    return out;
  };

  K.canvasToBytes = function (canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(async function (blob) {
        if (!blob) return resolve(null);
        resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), blob: blob });
      }, type, quality);
    });
  };

  /* --------------------------------------------------------------- sundry */

  K.year = function () {
    K.$$('[data-year]').forEach(function (n) { n.textContent = new Date().getFullYear(); });
  };

  document.addEventListener('DOMContentLoaded', K.year);

  window.Kagaz = K;
})(window, document);
