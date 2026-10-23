# ClickFlow

Turn a pile of screenshots into a click-flow diagram: drop them in, they line up left to right
with arrows between them, circle what to click, and export one high-resolution PNG. Everything
runs and stays in your browser — no account, no server, no upload.

## Using it

1. **New flow** (or drop / paste screenshots anywhere on the home screen to start one).
2. **Add screenshots** by drag-and-drop, `Ctrl+V`, or the file picker — PNG, JPEG and WebP,
   several at once. Drop between two cards to insert there.
3. **Arrange**: drag a card by its window bar, or `Alt+←/→`.
4. **Annotate**: `E` then drag (or click) on a screenshot for an ellipse, `M` then click for a
   numbered marker, `1–4` for red / orange / blue / green, `N` to number an ellipse.
5. **Label**: type a title above each card and an optional description below it.
6. **Export** (`Ctrl+E`): 1× or 2×, white / light-gray / transparent background.

Press `?` in the editor for every shortcut. Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) covers the
current editing session.

## Local development

```sh
npm install
npm run dev           # dev server
npm test              # Vitest: persistence, project files, geometry, layout, history…
npm run typecheck     # tsc project references (strict)
npm run format        # Prettier (format:check in CI)
npm run build         # typecheck + production build into dist/
npm run preview       # serve dist/ — the only way to exercise the CSP and offline mode
```

Stack: React, TypeScript, Vite, [`idb`](https://github.com/jakearchibald/idb) for IndexedDB,
[`lucide-react`](https://lucide.dev) icons. Fonts are self-hosted. No runtime CDN.

### Layout

```
src/
  types.ts              Flow / Step / Annotation / BlobRecord types
  db/                   schema + migrations, typed persistence API, backup file format
  lib/                  pure logic: layout, annotation geometry, document ops, undo history,
                        image import, canvas renderer, export sizing, blob-URL cache
  hooks/                pan/zoom, debounced autosave, blob URLs
  components/           Library, Editor (canvas, cards, annotation layer, inspector, dialogs)
build/offline.ts        Vite plugin that generates the precaching service worker
```

The editor canvas and the PNG exporter share one layout function (`lib/layout.ts`), so the
export matches what you see. Annotation boxes are stored normalized (0–1 of the screenshot's
width/height), so they stay anchored when the card size changes.

## How data is stored (IndexedDB)

Everything lives in one IndexedDB database, `clickflow`, in this browser profile:

| Store   | Contents                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `flows` | title, timestamps, ordered `stepIds`, canvas + export settings, thumbnail id (indexed by `updatedAt`) |
| `steps` | per-step title, description, image size, annotations (indexed by `flowId`)                            |
| `blobs` | screenshot and thumbnail binaries as `Blob`s, referenced by id                                        |

- Metadata is kept apart from image data, so listing flows never reads screenshots.
- Images are stored as Blobs (never base64) and shown via object URLs from a reference-counted
  cache that revokes them when no card uses them.
- Screenshots wider than 2880px or above ~17 MP are downscaled, and files over 3 MB are
  re-encoded as WebP (JPEG where the browser can't encode WebP) — the UI says when that happens.
- Edits autosave after 500 ms (and immediately when the tab is hidden); the top bar shows
  Saving / Saved / Not saved. Each flow+steps save is a single transaction.
- Deleted steps keep their screenshot until the next visit to the home screen, so undo can bring
  them back; then unreferenced blobs are swept. Duplicated flows share screenshots rather than
  copying them.
- **Schema versioning**: `DB_VERSION` and an ordered `MIGRATIONS` table in `src/db/schema.ts`.
  To change the schema, bump the version and add the next migration; it runs inside the upgrade
  transaction, so a failed upgrade leaves the old data untouched. Another tab running an older
  version closes its connection instead of blocking the upgrade.
- Quota errors and unavailable storage (e.g. some private windows) are detected and explained
  in the UI. The home screen shows how much space ClickFlow uses, the browser's own estimate,
  and offers to mark storage as persistent so the browser won't evict it under disk pressure.
- **Delete all local data** (home screen) clears every store after confirmation.

## Backup and import

Use **Back up all** (home screen), the download icon on a flow card, or **Save project file**
in the export dialog to get a single portable `.clickflow` file. **Import** (or drop the file on
the home screen) adds its flows to this browser — always as new copies, never overwriting.

The file is a small binary container: a magic header, a JSON manifest (flows, steps,
annotations, image index), then the raw image bytes. It is written and read with
`Blob`/`slice`, so large backups never pass through a giant string. On import every field is
validated (types, ranges, annotations inside their image, cross-references, image bytes match
their declared format, format version); a bad file produces a readable error and changes
nothing. Older format versions would be migrated in `validateManifest`.

## Offline

A service worker generated at build time precaches the app's own files. After one visit the app
reloads and works without a network. It never caches or sees user data — that is only in
IndexedDB. A new deployment takes over once all ClickFlow tabs have been closed.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs format check, tests and build on every push to `main`, then
publishes `dist/` with the official `actions/upload-pages-artifact` and `actions/deploy-pages`.

**One-time repository setting:** _Settings → Pages → Build and deployment → Source:_ select
**GitHub Actions**. No secrets or variables are needed.

The base path is not hardcoded. The workflow reads it from `actions/configure-pages`
(`base_path`, e.g. `/ClickFlow` for a project site, empty for a user site or custom domain) and
passes it to Vite as `BASE_PATH`. Locally it defaults to `/`; to build for a sub-path yourself:

```sh
BASE_PATH=/my-repo/ npm run build
```

The app has a single page and uses hash URLs (`#/flow/<id>`), so reloading any view works on
static hosting without a 404 fallback.

## Privacy

- No backend, no analytics, no accounts, no third-party requests.
- The production build ships a Content-Security-Policy with `connect-src 'none'`: the page is
  technically unable to `fetch`/XHR/WebSocket anywhere, so screenshots cannot leave the browser.
- PNG export and thumbnails are rendered on a local `<canvas>` from your stored blobs; files are
  saved with a temporary object URL that is revoked afterwards.
- Your data is only as durable as this browser profile. Clearing site data removes it — keep a
  `.clickflow` backup of anything important.

## Limitations

- Desktop-first. The editor works on smaller laptops (the side panel overlays below 1100px) but
  is not designed for touch or phones.
- Very long flows are exported at a reduced scale if they would exceed the browser's maximum
  canvas size; the export dialog says when that happens.
- Undo history is per editing session and is not persisted.
