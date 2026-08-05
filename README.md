# कागज़ Kagaz

**Paper tools that never leave your browser.**

Merge, split, compress and convert PDFs — and batch-personalise certificates — entirely on
your own machine. Nothing is uploaded, because there is no server. No accounts, no daily
task limits, no file size caps beyond what your device can hold, no trackers, no ads.

Live at **[kagaz.namastevis.in](https://kagaz.namastevis.in)** · MIT licensed · made in India

---

## The tools

| | | |
|---|---|---|
| **[Merge PDF](https://kagaz.namastevis.in/merge-pdf/)** | Join files into one | Page size, orientation and rotation preserved exactly |
| **[Split PDF](https://kagaz.namastevis.in/split-pdf/)** | Extract or break apart | By range, every N pages, one per page, or at uneven breakpoints |
| **[Compress PDF](https://kagaz.namastevis.in/compress-pdf/)** | Shrink the file | Downsamples embedded images and **leaves text as text** |
| **[PDF to JPG](https://kagaz.namastevis.in/pdf-to-jpg/)** | Pages as images | You choose the dpi — 72 for screen, 300 for print |
| **[Certificate Press](https://kagaz.namastevis.in/certificate/)** | One design × many names | Certificates, badges, place cards, tickets, ID cards |

## Why it works this way

Every other free PDF site uploads your file to a company's servers. That is fine for a
restaurant menu and not fine for a signed contract, a medical report, a bank statement or a
scan of somebody's ID — which is exactly what people put through these tools.

Doing the work in the browser removes the problem rather than promising to be careful with
it. It also means running a job costs nothing, so there is no reason to meter it.

## What it deliberately does not do

- **No PDF to Word.** It cannot be done well client-side. Every free tool offering it is
  sending your document somewhere.
- **No password cracking.** Encrypted files are refused, not guessed at.
- **No silent degradation.** When an image cannot be safely re-encoded — CMYK, JPEG 2000,
  JBIG2, CCITT fax, indexed colour — it is left alone and reported, rather than corrupted
  to make a compression percentage look better.

## Compression, specifically

The default mode walks every image XObject in the document, downsamples anything larger
than the target resolution, re-encodes it as JPEG and swaps it back **in place**. Text,
vector graphics, links and bookmarks are untouched, so the result is still selectable and
searchable. Typical saving on an image-heavy document is 50–90%.

There is also a lossless structural mode, and an optional flatten mode that turns pages
into pictures — which destroys text and says so, in a confirmation dialog, before it does.

## Running it

**Locally**

```bash
git clone https://github.com/namastevis/kagaz.git
cd kagaz
python3 -m http.server 8000    # any static server; pdf.js needs a real origin for its worker
```

**Hosting** — it is a static site. Put it on GitHub Pages, Cloudflare Pages, Netlify or a
folder on any web server. See [DEPLOY.md](DEPLOY.md) for the DNS and redirect notes.

## Layout

```
index.html            landing page
merge-pdf/            one tool, one self-contained HTML file
split-pdf/
compress-pdf/
pdf-to-jpg/
certificate/          Certificate Press
contribute/           how to help, and where to send a chai
test/                 in-browser test bench
shared/kagaz.css      one stylesheet for every page
shared/kagaz.js       browser helpers — drop zones, downloads, canvas codec, messages
shared/ops.js         the PDF logic, deliberately DOM-free so Node can test it
vendor/               pdf-lib, pdf.js, JSZip, fontkit — vendored, never a CDN
tests/stress.mjs      throws deliberately broken PDFs at shared/ops.js
```

No framework, no bundler, no build step. Clone it and open a file.

## Tests

```bash
node tests/stress.mjs
```

61 checks covering malformed input, hostile filenames, page-range parsing, merge and split
correctness, compression safety and extreme documents. Every one asserts that Kagaz either
works or **refuses cleanly with a message a person could act on** — a crash, a hang or a
silently broken output file is a failure.

`sharp` is picked up automatically if it happens to be installed, which exercises the real
pixel path; without it a stub codec still covers every branch. Neither is required.

Then open [`/test/`](https://kagaz.namastevis.in/test/) in a browser for the parts Node
cannot reach: the canvas codec, `createImageBitmap`, blob encoding and rendering.

## Under the hood

[pdf-lib](https://github.com/Hopding/pdf-lib) reads and writes documents ·
[pdf.js](https://mozilla.github.io/pdf.js/) renders pages ·
[JSZip](https://stuk.github.io/jszip/) packs multi-file output ·
[fontkit](https://github.com/foliojs/fontkit) embeds uploaded fonts in Certificate Press.
All vendored — a CDN would quietly break the offline promise.

## Contributing

Please do. There is a list of scoped, genuinely useful things to build at
[/contribute](https://kagaz.namastevis.in/contribute/), and the rules are in
[CONTRIBUTING.md](CONTRIBUTING.md). Translations into Indian languages are as welcome as code.

## Support

Kagaz is free and will stay free. If it saved you an evening, you can
[buy me a chai](https://razorpay.me/@namastevis).

## Licence

MIT — see [LICENSE](LICENSE). Use it, fork it, remix it, ship it commercially.

Built by [Amit Jena](https://namastevis.in) · [GitHub](https://github.com/namastevis) ·
[LinkedIn](https://linkedin.com/in/namastevis)
