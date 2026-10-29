# MCTools — Minecraft Bedrock Toolkit

A responsive, pixel-font toolbox for Minecraft Bedrock pack creators. The static site is designed for GitHub Pages and runs local file tools in the browser.

## Tools

- **Pack exporter** — package ZIP-based archives as `.mcpack`, `.mcaddon`, or `.zip`. This is packaging, not encryption.
- **Decrypt my pack (legacy)** — restore compatible `.fnpack` containers made by the prior MCTools-compatible browser container implementation.
- **Server pack fetch** — embeds the public `decryptmypack.com` page in an iframe. Its backend remains operated by that service; MCTools does not call an undocumented private API or proxy its traffic.
- **Glyph generator** — map a bitmap atlas to Unicode private-use characters and export a bitmap-provider JSON snippet.
- **JSON maker** — format, minify, validate, copy, and download JSON, with useful templates.
- **UUID generator** — create cryptographically random UUID v4 identifiers.
- **Manifest maker** — build a Bedrock resource/behavior pack `manifest.json`.
- **Pack inspector** — inspect ZIP-based archives, manifests, and file listings locally.
- **Pack icon maker** — crop/fit an image to 256×256 and export `pack_icon.png`, with optional pixelation.
- **Text formatter** — generate Bedrock section-sign text, `tellraw`, and title/subtitle commands.
- **3D skin preview** — a rotatable model preview using the supplied skin texture.

## Important format and integration notes

### `.mcpack` / `.mcaddon` are not encrypted formats

Microsoft documents `.mcpack` as a zipped resource or behavior pack and `.mcaddon` as a ZIP container that includes `.mcpack` or `.mcworld` files. MCTools therefore does not label an ordinary ZIP packaging operation as encryption. The pack exporter creates a compatible extension where the archive structure allows it, and warns when a root `manifest.json` is missing.

Reference: [Minecraft file extensions — Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/documents/minecraftfileextensions?view=minecraft-bedrock-stable).

### Server fetch embed

The server fetch panel embeds `https://decryptmypack.com/` in an iframe so visitors remain on the MCTools page. The service performs its own server connection, caching, and pack processing. There is no documented public API wired into this project, and the source does not attempt to scrape or proxy a private API. The external provider may prevent iframe embedding using browser security headers; if it does, a native integration requires a documented API or permission from the provider. GitHub Pages itself cannot host a UDP/RakNet Bedrock client backend.

## Run locally

Serve the files through localhost (rather than opening via `file://`):

```bash
python -m http.server 8080
```

Open `http://localhost:8080`. JavaScript libraries (`JSZip` and `Three.js`) and pixel fonts load from public CDNs, so a connection is needed unless you bundle those dependencies yourself.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages** in the repository.
3. Choose **Deploy from a branch**, select the branch (usually `main`) and folder `/ (root)`, then save.
4. After GitHub Pages publishes the site, open the provided URL over HTTPS.

No build step is required. Keep `index.html`, `app.js`, `styles.css`, and the `assets/` folder in the repository root.

## Files

- `index.html` — page structure and embedded server-fetch workspace
- `styles.css` — responsive dark UI and pixel typography
- `app.js` — local tool behavior
- `assets/Mason_customSlim.png` — skin texture supplied for the 3D preview
- `assets/favicon.svg` — MCTools favicon
- `LICENSE` — MIT license

## Privacy

Local archive and image utilities process selected files in the browser. The server-fetch iframe is a separate third-party service and is subject to its own behavior and privacy terms. Do not enter secrets or account information into an embedded third-party interface unless you trust that service.

## Credits

Made by MCTools. Creator credit: [TikTok @fariznomercy](https://www.tiktok.com/@fariznomercy).
