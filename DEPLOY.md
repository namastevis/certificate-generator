# Deploying Kagaz

The repository is a static site. `CNAME` has been switched from `press.namastevis.in` to
`kagaz.namastevis.in`. The old subdomain is being retired outright — see step 2.

---

## 1. Point `kagaz` at GitHub Pages

Add a DNS record on `namastevis.in`:

```
Type    Name     Value
CNAME   kagaz    namastevis.github.io
```

If DNS is on Cloudflare, set the record to **DNS only** (grey cloud) at first. GitHub needs
to see the record directly to issue the TLS certificate; you can turn the proxy back on once
the certificate has been issued.

Then in the repo: **Settings → Pages**. It should already show `kagaz.namastevis.in` picked
up from the `CNAME` file. Wait for the certificate, then tick **Enforce HTTPS**.

Propagation is usually minutes, occasionally an hour.

## 2. Retire `press.namastevis.in`

No redirect. Delete it.

1. Remove the `press` DNS record from `namastevis.in`.
2. If a Cloudflare redirect rule or page rule mentions `press`, delete that too.
3. Confirm `https://press.namastevis.in/` no longer resolves.

The subdomain then stops existing. Anyone with an old bookmark gets a DNS failure rather
than a 404 page — that is the intended outcome here, but it does mean any link that was
ever shared to the old address is gone for good. Nothing else in this repository refers
to it.

## 3. Tell Google about the new address

In Search Console, add `kagaz.namastevis.in` as a property and submit
`https://kagaz.namastevis.in/sitemap.xml`.

If `press.namastevis.in` was previously a verified property, remove it. Without a 301 the
**Change of address** tool will not work, so there is nothing to migrate — Kagaz starts
from scratch, which is the trade-off for a clean break. Expect the new host to take a few
weeks to be indexed.

## 4. Check it worked

- [ ] `https://kagaz.namastevis.in/` loads and the padlock is green
- [ ] `https://press.namastevis.in/` does not resolve at all
- [ ] Each of `/merge-pdf/`, `/split-pdf/`, `/compress-pdf/`, `/pdf-to-jpg/`, `/certificate/`,
      `/contribute/` loads
- [ ] Open developer tools → Network, drop a PDF on a tool, and confirm **no requests leave**
- [ ] `/test/` runs green in Chrome, and again in Safari
- [ ] Try it on an actual phone, not just a narrow browser window
- [ ] `node tests/stress.mjs` and `node tests/verify.mjs` both pass

## 5. Link it from your portfolio

Add Kagaz to the Work section on `namastevis.in`, pointing at `https://kagaz.namastevis.in/`.

Every link in Kagaz that points back at you goes to `https://namastevis.in/` — the masthead
of each tool page, the "who made this" block, and the panel that appears after a download.

## Notes

- **Do not** add a `.nojekyll` file unless something breaks; nothing here starts with an
  underscore, so Jekyll leaves it alone.
- `index_v1.html` is the superseded first version of Certificate Press. It is marked
  `noindex` and excluded in `robots.txt`; delete it whenever you like, since git has it.
- There is no build step and nothing to configure. Pushing to `main` deploys.
