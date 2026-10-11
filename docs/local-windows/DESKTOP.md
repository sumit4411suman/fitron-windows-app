# FITRON Local Windows Edition: the desktop program (Phase 14)

FITRON Gym Accounting for Windows is a Tauri 2 program (`src-tauri/`) around the same FITRON server the Cloud Edition
runs. FITRON's pages are rendered on the server, so the server ships inside the program with its own Node.js. The
customer never installs Node.js, a database or anything else.

## What happens when FITRON opens and closes

| Step | What the program does | Where |
| --- | --- | --- |
| 1. Start | One FITRON per Windows user: a second start brings the open window forward. A lock file in the data folder makes sure two servers never open one database. | `src-tauri/src/main.rs` |
| 2. Data folder | `%LOCALAPPDATA%\FITRON` of the signed-in user, never the program folder. The server makes `data`, `backups`, `documents` and `logs` in it. | `main.rs`, `src/lib/runtime/paths.ts` |
| 3. Server | `fitron-node.exe server.js` from the program's `server` folder, with `FITRON_EDITION=local`, the data folder, `HOSTNAME=127.0.0.1` and a port Windows picks. No console window. | `src-tauri/src/server.rs` |
| 4. Health | Polls `/api/health` until it answers `{ "ok": true, "edition": "local", "version": "…", "instance": "…" }`. The instance id is the one the program gave its server, so another program on the port is never mistaken for FITRON. The first start after an update may take minutes while the database is updated (5-minute limit). | `server.rs`, `src/app/api/health/route.ts` |
| 5. Open | The window goes from its own start-up page to FITRON at `http://127.0.0.1:<port>/`. If the server cannot start, the start-up page says why and where the log is. | `main.rs`, `src-tauri/splash/` |
| 6. Close | The program closes the server's standard input. The server stops its timer, waits up to 8 seconds for a backup or daily job that is running, writes the WAL into `fitron.db` and exits. The program waits up to 15 seconds before ending it. | `server.rs`, `src/lib/runtime/local-shutdown.ts` |

If the program ends without closing (a crash, Task Manager), Windows closes the server's standard input, so the server
still stops itself cleanly. A Windows job object also ends the server when the program ends, should it hang.

A payment being saved at the moment FITRON closes is either saved completely (payment, receipt, journal) or not at all:
every financial change is one SQLite transaction.

## Kept to this computer

- The server listens on `127.0.0.1` only, never on a network address.
- It answers only requests addressed to `127.0.0.1` or `localhost` (421 otherwise), so a website cannot reach it through
  the computer's own browser by pointing its name at 127.0.0.1 (`src/lib/runtime/loopback.ts`, `src/proxy.ts`).
- The window has no access to the program: no Tauri commands or capabilities are given to any page.
- FITRON's pages open in the window. Websites (WhatsApp chats, Razorpay) and email or phone links open in the computer's
  own browser or mail program. Anything else (files, other programs on this computer, plain `http` sites) is refused
  (`src-tauri/src/nav.rs`). A FITRON page that opens its own window (an invoice PDF, a member's document) gets a FITRON
  window with the same rules.
- Variables of the computer that would change the server (`NODE_OPTIONS`, `DATABASE_URL`, any `FITRON_*`, the
  end-to-end suite's switch) are not passed to it.
- The server writes nothing into the program folder: no image resizing, and pages it keeps stay in memory. The bundle
  check fails if a file there changes.

## Building

On the computer type you ship for. The Windows program is built on Windows; native modules (`better-sqlite3`, argon2)
must match the Node.js shipped with them.

```
npm ci
npm run desktop:bundle          # the server in build/local-server, Node.js in src-tauri/binaries, then checks them
npx tauri build --config src-tauri/tauri.bundle.conf.json
                                # the program and its installer (Phase 15); add --no-bundle for the program only
npm run desktop:smoke           # starts, closes and ends the real program (Linux: xvfb-run -a npm run desktop:smoke)
```

`npm run desktop:build` runs the first two. Needs Rust (stable) and, on Linux, the WebKitGTK libraries.

`desktop:bundle` builds Next.js as a standalone server (`FITRON_DESKTOP_BUILD=1` in `next.config.ts`), keeps only what
the server runs from (no sources, `.env` files, test uploads, the website or the AI Trainer app), turns Next.js's
symbolic links into real files (a native module becomes a one-line package that loads the one real copy), and copies the
Node.js that built it. Then it starts the server the way the program does, from a copy in another folder, and checks:

| Check | |
| --- | --- |
| healthy, right version | data folder made |
| first-run setup page, static and public files | the website is not in it |
| a request for another website's name is refused (421) | nothing answers on the computer's network addresses |
| closing stdin stops it (exit 0, WAL written into `fitron.db`) | nothing written into its program folder |

The server is about 146 MB, and the Node.js runtime about 120 MB on Linux. The Windows sizes come with the Windows build.

## Logs

`%LOCALAPPDATA%\FITRON\logs\shell.log`: the program's own steps (start, port, ready, stop). `server.log`: the server's
output. Each starts afresh past its size limit, keeping one older copy. Neither holds gym data.

## Tests

| Test | What it proves |
| --- | --- |
| `cargo test` in `src-tauri` (12) | a free port on 127.0.0.1 only; the server's variables (Local Edition, 127.0.0.1, no switches); the health check is ours only; plain and chunked answers; where links may go; log times |
| `src/lib/runtime/local-shutdown.test.ts` (6) | the WAL is written into the database file; a running backup is waited for, a stuck job is not; stopping happens once; it starts when the shell lets go of stdin |
| `src/lib/runtime/loopback.test.ts`, `src/proxy.test.ts` | only this computer's names are answered |
| `npm run desktop:bundle` | the checks above, on the packaged server |
| `npm run desktop:smoke` | the real program: starts with a fresh data folder, server healthy on 127.0.0.1 only, window shows FITRON, a second start opens nothing, closing stops the server cleanly (WAL written, port closed), ending the program stops its server, and it starts again afterwards |
| `.github/workflows/desktop.yml` | all of the above on Windows, for every pull request |
