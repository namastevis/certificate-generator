# Contributing to Kagaz

Thank you for looking. Kagaz is deliberately boring to work on — no toolchain, no bundler,
no `node_modules` to install before you can see a change.

## Setup

```bash
git clone https://github.com/namastevis/kagaz.git
cd kagaz
python3 -m http.server 8000
# open http://localhost:8000
```

That is the whole development environment. The static server is only needed because pdf.js
loads its worker as a separate file, which browsers block on `file://`.

## The three rules

These are the only ones, and they are not negotiable because the project stops making sense
without them.

1. **One tool is one HTML file.** Markup, tool-specific styles and logic live together. You
   should be able to understand a tool without opening anything else.

2. **Nothing may be fetched from another origin.** No CDN, no font service, no analytics, no
   error reporting — not even the privacy-respecting kind. The entire premise is that opening
   Kagaz makes no network requests, and one `fonts.googleapis.com` link would quietly break
   the claim the whole site rests on.

3. **PDF logic goes in `shared/ops.js`.** That file has no DOM references so it runs in Node
   and can be tested. Anything needing a canvas is passed in as an argument — see how
   `compress()` takes a `codec` and `rasterize()` takes a `renderer`.

## Adding a tool

1. Copy `merge-pdf/index.html` to `your-tool/index.html` — it is the simplest of the four.
2. Change the title, meta description, canonical URL and the copy below the fold. The slug
   should be what someone would actually type into a search box: `rotate-pdf`, not `rotator`.
3. Put the PDF manipulation in `shared/ops.js` as a function taking bytes and returning bytes.
4. Add a card to the grid in `index.html` and a link in the other tools' footer lists.
5. Add cases to `tests/stress.mjs`.

## Tests

```bash
node tests/stress.mjs
```

Every test asserts one of two things: that an operation works, or that it **refuses cleanly**
with a `KagazError` carrying a message a person could act on. A crash, a hang, or a silently
broken output file is a failure. A polite refusal is a pass.

If you touch anything in `shared/kagaz.js` or the compression path, also open `/test/` in a
browser — it covers the canvas codec, `createImageBitmap` and rendering, which Node cannot.

## Style

- Plain ES5-compatible JavaScript in the tool pages. No transpiler means no optional chaining.
  `shared/ops.js` uses `async`/`await`, which is safe everywhere Kagaz runs.
- Comments explain *why*, not *what*. `// skip CMYK, browsers decode it unreliably` is useful;
  `// loop over images` is not.
- British or Indian English in user-facing text, whichever reads naturally. Plain words over
  jargon: "shrink" rather than "optimise", "page range" rather than "selection criteria".
- Error messages tell the person what happened *and* what to do next.

## What would help most

The list with detail lives at [/contribute](https://kagaz.namastevis.in/contribute/). Briefly:

**Good first issues** — JPG to PDF · rotate and reorder pages · add page numbers ·
watermarks · dark mode · Hindi, Odia, Tamil and Bengali interface strings.

**Harder** — more image formats in the compressor (CCITT fax first, it is what scanners
produce) · downsampling soft masks · true redaction that actually removes the underlying
data · a service worker for proper offline install · reading the content stream so images
can be sized against how they are actually drawn.

## Please don't

- Add a framework, bundler or package manager step.
- Add analytics, telemetry or error reporting.
- Add PDF to Word. It cannot be done well in a browser, and a bad version would undermine
  the one thing this site is for.
- Add anything that silently degrades a file. If it cannot be processed safely, say so.

## Reporting bugs

A useful report has: the browser and version, what you did, what happened, and what you
expected. If a PDF triggered it and you can share it, that is enormously helpful — but never
attach anything confidential. A file that reproduces the problem is usually easy to make with
the fixtures in `tests/stress.mjs`.

## Licence

Contributions are accepted under the MIT licence, the same as the rest of the project.
