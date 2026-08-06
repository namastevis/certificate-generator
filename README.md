# कागज़ Kagaz

**Paper tools that never leave your browser.**

Merge, split, compress and convert PDFs — and batch-personalise certificates — entirely on
your own machine. Nothing is uploaded, because there is no server. No accounts, no daily
task limits, no file size caps beyond what your device can hold, no trackers, no ads.

Live at **[kagaz.namastevis.in](https://kagaz.namastevis.in)** · MIT licensed · made in India

---

## The tools

**Organise** — [Merge](https://kagaz.namastevis.in/merge-pdf/) ·
[Split](https://kagaz.namastevis.in/split-pdf/) ·
[Organize](https://kagaz.namastevis.in/organize-pdf/) ·
[Rotate](https://kagaz.namastevis.in/rotate-pdf/) ·
[Crop](https://kagaz.namastevis.in/crop-pdf/)

**Convert and shrink** — [Compress](https://kagaz.namastevis.in/compress-pdf/) ·
[PDF to JPG](https://kagaz.namastevis.in/pdf-to-jpg/) ·
[JPG to PDF](https://kagaz.namastevis.in/jpg-to-pdf/) ·
[Scan to PDF](https://kagaz.namastevis.in/scan-to-pdf/)

**Mark and protect** — [Redact](https://kagaz.namastevis.in/redact-pdf/) ·
[Sign](https://kagaz.namastevis.in/sign-pdf/) ·
[Watermark](https://kagaz.namastevis.in/watermark-pdf/) ·
[Page numbers](https://kagaz.namastevis.in/page-numbers/)

**Several jobs at once** — [Workspace](https://kagaz.namastevis.in/workspace/) — load a document
once, stack operations, download at the end. Everything stays in memory; nothing is written to disk
between steps.

**Batch** — [Certificate Press](https://kagaz.namastevis.in/certificate/) — one design × many
names, from a spreadsheet.

Two of these are worth calling out. **Compress** downsamples the images inside the document and
leaves text as text, instead of flattening every page into a picture. **Redact** actually destroys
the content underneath rather than drawing a black rectangle over selectable text.

There is a [roadmap](https://kagaz.namastevis.in/roadmap/) listing what is being built next and,
just as importantly, what will never be built here and why.

## Why it works this way

Every other free PDF site uploads your file to a company's servers. That is fine for a
restaurant menu and not fine for a signed contract, a medical report, a bank statement or a
scan of somebody's ID — which is exactly what people put through these tools.

Doing the work in the browser removes the problem rather than promising to be careful with
it. It also means running a job costs nothing, so there is no reason to meter it.

## What it deliberately does not do

- **No office-format conversion**, in either direction, and no AI features. Each one needs a
  server, and a server means uploading your document. The
  [roadmap](https://kagaz.namastevis.in/roadmap/) lists every excluded tool with its reason.
- **No password cracking.** Encrypted files are refused, not guessed at.
- **No silent degradation.** When an image cannot be safely re-encoded — CMYK, JPEG 2000,
  JBIG2, CCITT fax, indexed colour — it is left alone and reported, rather than corrupted
  to make a compression percentage look better.

## There is no usage counter

No "2 million documents processed" badge, no analytics, not even the self-hosted privacy-respecting
kind. A number like that has to be counted somewhere, which means a request from your browser on
every visit — tiny, anonymous, and still the site watching you.

So I do not know how many people use Kagaz. [`tests/verify.mjs`](tests/verify.mjs) fails the build
if any page ever loads something from another origin, or if the shared scripts gain a network call,
which is what makes that checkable rather than a promise.

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
index.html              landing page
roadmap/                what exists, what is coming, what never will
merge-pdf/ split-pdf/ compress-pdf/ pdf-to-jpg/ jpg-to-pdf/
organize-pdf/ rotate-pdf/ crop-pdf/ page-numbers/
watermark-pdf/ sign-pdf/ scan-to-pdf/ redact-pdf/
workspace/              load once, stack operations, download at the end
certificate/            Certificate Press
contribute/             how to help, and where to send a chai
test/                   in-browser test bench
shared/kagaz.css        one stylesheet for every page
shared/kagaz.js         browser helpers — drop zones, downloads, canvas codec, thumbnails
shared/ops.js           the PDF logic, deliberately DOM-free so Node can test it
vendor/                 pdf-lib, pdf.js, JSZip, fontkit — vendored, never a CDN
tests/stress.mjs        throws deliberately broken PDFs at shared/ops.js
tests/verify.mjs        site checks — links, metadata, mobile
tests/lint.mjs          project rules — no network, no storage, no external assets
```

No framework, no bundler, no build step. Clone it and open a file.

## Checks

```bash
npm run check     # lint + verify + tests, no npm install required
```

- **`npm run lint`** — the project's own rules. No network APIs, no persistent storage, no
  assets from another origin, every inline script parses, every tool page links to `/report/`.
  This is the one that matters: it fails the build if the code stops matching the promises on
  the front page.
- **`npm run verify`** — 69 checks on the site: dead links, metadata, mobile viewport, tap
  targets, sitemap coverage.
- **`npm test`** — 89 checks on the PDF engine: malformed input, hostile filenames, page
  geometry, stamping, redaction, compression safety, chained operations, extreme documents.
  Every one asserts that Kagaz either works or **refuses cleanly with a message a person could
  act on**.

All three run on a bare Node install. `sharp` is picked up automatically if present, which
exercises the real image codec; without it a stub covers the same branches. ESLint is
configured but optional and advisory.

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

Built by [Amit Jena](https://namastevis.in) — an *Accidental Designer*.

[Website](https://namastevis.in) ·
[GitHub](https://github.com/namastevis) ·
[LinkedIn](https://linkedin.com/in/namastevis) ·
[X](https://x.com/namastevis) ·
[Instagram](https://instagram.com/namastevis) ·
[Google Scholar](https://scholar.google.com/citations?user=t98YXOQAAAAJ&hl=en) ·
[amitjena@namastevis.in](mailto:amitjena@namastevis.in)

Found a problem? The [report page](https://kagaz.namastevis.in/report/) fills in your browser
details and offers email, a reply on X, or a prefilled GitHub issue — no account needed for the
first two.
