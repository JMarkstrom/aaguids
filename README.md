# YubiKey AAGUIDs
_This repository hosts a 🌐[webpage](https://JMarkstrom.github.io/aaguids/) to search, filter and export YubiKey AAGUIDs._    

**Note**: CSPN YubiKeys have been excluded since AAGUID overlaps with standard models.

## 🛠️ Local development
The page is plain HTML, CSS and JavaScript with no build step — but it cannot be opened
directly from disk, because browsers block `fetch()` on `file://` URLs and the table is
loaded from `aaguids.csv` at runtime. Serve the folder instead:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

| File | Purpose |
| --- | --- |
| `index.html` | Page structure only — no inline styles or scripts (enforced by the Content-Security-Policy meta tag) |
| `styles.css` | Design tokens and all styling; light/dark handled with `light-dark()` |
| `theme-init.js` | Applies the saved theme before first paint. **Must stay synchronous** — adding `defer`, `async` or `type="module"` reintroduces a flash of the wrong theme |
| `app.js` | CSV parsing, table rendering, search, sort, filter, copy, export |
| `aaguids.csv` | The data, and the single source of truth |
| `images/yubikeys/` | Product photos, matched to rows by a slug derived from the `Model` column |

To add or correct data, edit `aaguids.csv` — the table, the certification filter chips and
the counts in the header all derive from it. If you add a model, drop a matching PNG into
`images/yubikeys/` named after its slug (lowercase, non-alphanumerics collapsed to `-`,
e.g. `YubiKey 5C NFC` → `yubikey-5c-nfc.png`) and add that slug to `YUBIKEY_STEMS` in
`app.js`.

## ™️ Trademark notice
YubiKey is a trademark of Yubico. This project is independent of and is not affiliated with, endorsed by, or sponsored by Yubico.

## ⚖️ License
This software is proprietary. Copyright (c) 2026 swjm.blog. All rights reserved. See [LICENSE](LICENSE) for details.
