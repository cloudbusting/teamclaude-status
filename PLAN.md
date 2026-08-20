# teamclaude-status — VS Code / VSCodium extension

## Context

TeamClaude (`@karpeleslab/teamclaude`) is running as the local proxy that fronts multiple
Claude Max accounts and rotates between them before either burns its 5h/7d quota. Today the only way to see usage is
`teamclaude status`/`attach` in a terminal — there's nothing in the editor itself, and no
extension on Open VSX fills this gap for TeamClaude specifically. `agsoft/claude-history-viewer`
is the nearest comparable (status-bar quota chip + click-to-expand dashboard), but it's a much
bigger tool (session history, SQLite, five providers) built around parsing local transcripts —
not what's needed here. This plan is for a small, focused extension: a status-bar indicator and
a click-through popup, reading live data straight from TeamClaude's own HTTP API, built once and
published to both the VS Code Marketplace and Open VSX (VSCodium).

Confirmed by inspecting the running gateway and its source (`/usr/local/lib/node_modules/@karpeleslab/teamclaude/src/server.js`):

- **`GET /teamclaude/status`** — the exact JSON behind `teamclaude status --json`: per-account
  `quota` (`unified5h`, `unified7d`, resets, `unifiedStatus`), `usage` (tokens/requests/lastUsed),
  `status` (`active`/`throttled`/`error`) + `disabled`, plus `sessions`, `currentAccount`,
  `switchThreshold`, `server`, `probe`, `warm`. No polling side effects.
- **`POST /teamclaude/switch`** / **`POST /teamclaude/reload`** exist too, but this extension is
  read-only monitoring — status/usage only, no account-switching UI.
- **Auth**: `x-api-key: <proxy.apiKey>` header, required for any non-loopback caller (loopback is
  exempted). The gateway runs in a container reached via a forwarded port, so treat auth as
  always required rather than relying on the loopback exemption.
- **Where the key/port live**: `~/.config/teamclaude/teamclaude.json` → `proxy.port` (3456) and
  `proxy.apiKey`, path overridable via `$TEAMCLAUDE_CONFIG`. In the `vscodium-sandbox` container
  scenario described in `~/code/teamclaude-gateway/README.md`, the config file isn't mounted at
  all — the key arrives only via a `TEAMCLAUDE_API_KEY` env var. The extension must support both.

This file contains live OAuth tokens for both accounts — the extension must only ever read the
two `proxy.*` fields it needs and must never log or display the rest of the file.

## Architecture

Repo and published extension are both named **`teamclaude-status`**. The current working
directory (`/home/andy/code/teamclaude-code-extension`, empty, not yet a git repo) gets renamed to
`/home/andy/code/teamclaude-status` as the first implementation step, and `git init` happens
there. `package.json`'s `name` and `displayName` are `teamclaude-status` / "TeamClaude Status";
that's also the id used for `vsce package`/`publish` and `ovsx publish`. Command and settings
namespace stays the shorter `teamclaude.*` (e.g. `teamclaude.openPanel`,
`teamclaude.baseUrl`) — no need for those identifiers to repeat the full package name.

Single TypeScript codebase, bundled with esbuild, targeting the stable `vscode` API only (no
proposed APIs) so one build installs unmodified in both VS Code and VSCodium.

### Remote execution (`extensionKind`)

Codium here is run against a remote (Dev Containers, into Docker), and TeamClaude runs in that
same remote context — not on whatever machine the Codium UI itself renders on. VS Code's Remote
Development model splits an extension across two possible hosts (`ui`, running next to the
window; `workspace`, running next to the remote/container), chosen by the extension's
`extensionKind` — and when unset, VS Code falls back to inferring it, which is not something to
depend on for an extension whose entire job is reaching a network service and env vars that only
exist on one side of that split. Set it explicitly:

```jsonc
"extensionKind": ["workspace"]
```

This forces the extension into the same Extension Host process as the remote/container — the
same place Claude Code's own extension and the `claude` CLI already run, and therefore the same
place that already has whatever makes TeamClaude reachable there today (`TEAMCLAUDE_API_KEY`,
`ANTHROPIC_BASE_URL`-style env vars, the compose network hostname, and/or the mounted config
file). The extension inherits that resolution for free instead of re-deriving connectivity that's
already solved for the CLI in the same environment. It does **not** run on the UI-side machine at
all, so it never has to guess whether *that* machine can reach `teamclaude-gateway`. Neither
`anthropic.claude-code` nor `agsoft.claude-history-viewer` (checked locally) declare an explicit
`extensionKind` either — worth being explicit here rather than copying that, since correctness in
the remote-container case is the whole point of this setting for us. (For a plain local install
with no remote at all, `workspace` still just runs in the single local Extension Host — no
downside.)

Webview panels and status bar items both work unchanged from a workspace-kind extension — VS
Code's remote layer proxies the UI surface (rendering happens client-side, extension logic stays
remote-side), which is the standard pattern for remote/container-aware extensions.

```
src/
  extension.ts        # activate(): wires everything below, registers commands
  api/client.ts        # fetch('/teamclaude/status'), fetch/post('/teamclaude/switch')
  api/config.ts         # resolves baseUrl + apiKey: settings -> env -> teamclaude.json
  statusBar.ts           # StatusBarItem: compressed text + tooltip, click -> openPopup
  poller.ts               # setInterval loop, backs off on failure, notifies subscribers
  popup/panel.ts            # WebviewPanel host: posts status JSON in, listens for switch requests out
  popup/webview/*        # plain HTML/CSS/vanilla JS rendered inside the panel (no framework)
package.json / tsconfig.json / esbuild.js / .vscodeignore / README.md / CHANGELOG.md
```

### Config resolution (`api/config.ts`)
Runs remote/container-side (see `extensionKind` above), so this is resolving against the same
filesystem/env as the `claude` CLI in that same container — not the UI-side machine. `baseUrl`
and `apiKey` resolve independently and don't share a single priority list — the key gets narrower
treatment because it's a secret and the host isn't.

**`baseUrl`** (not sensitive — a plain settings override is fine and is in fact the intended
mechanism for the container case):
1. `teamclaude.baseUrl` setting, if set. Because the extension is workspace-kind, a setting
   placed in the remote's own settings (`devcontainer.json`'s `customizations.vscode.settings`,
   or that container's own `settings.json`) travels with the environment automatically — the
   recommended way to pin `http://teamclaude-gateway:3456` (or whatever the compose network
   hostname is) once, rather than the extension guessing it.
2. Else, host from `$TEAMCLAUDE_CONFIG`/`~/.config/teamclaude/teamclaude.json`'s `proxy.port`,
   assumed reachable at `127.0.0.1` — correct for plain local installs and a host-side gateway on
   a forwarded port, and per `~/code/teamclaude-gateway/README.md` this file is deliberately not
   mounted in the sandboxed-container case, so this step naturally doesn't fire there.
3. Else: "not configured" (a real status-bar state, not a guess — there's no single correct
   default host for the container-network case, so don't assume `127.0.0.1`).

**`apiKey`** (a secret — deliberately *no* `teamclaude.apiKey` string setting. `settings.json` can
be workspace-scoped and committed to a repo, or synced off the machine via Settings Sync; that's
a worse exposure surface than either source below, and a plain setting wouldn't cover any case
those don't already cover). The two automatic sources below are what's expected to fire in
practice — both read with zero user action, same as the `teamclaude` CLI itself needs neither
configured manually. `SecretStorage` exists only for the gap where neither applies; given this
machine's `compose.yaml` mounts the config straight into the gateway container and the sandbox
pattern already sets the env var, that gap shouldn't come up here day to day. Precedence, highest
first (so an explicit manual entry can always override a stale/wrong auto-detected one, but
nothing needs to be entered manually for things to work):
1. `context.secrets` (VS Code `SecretStorage`, OS-keychain-backed) — populated only via the
   `TeamClaude: Set API Key` command (`showInputBox({ password: true })`). Manual override,
   expected to stay empty/unused in normal operation. Never written to any file this extension
   controls.
2. **(automatic)** `TEAMCLAUDE_API_KEY` env var, read from the extension host's own process env —
   real because we're workspace-kind and therefore in the same container as the CLI's own env.
3. **(automatic)** `$TEAMCLAUDE_CONFIG`/`teamclaude.json`'s `proxy.apiKey`, when that file is
   present — same file, same field, the `teamclaude` CLI itself reads. Read once, re-read on file
   change (`fs.watch`) or on demand if a request ever 401s. This is the path that fires for a
   plain local install with no remote involved at all.
4. Else: no key sent at all. Not automatically an error — loopback callers are exempt from the
   gateway's auth check (see Context), so an unset key can still work if we happen to be reaching
   it over loopback. Only flip to the auth-error status bar state if a request actually comes back
   401.

### Polling (`poller.ts`)
- Extension-host side only (Node context) — never fetch from inside the webview, keeps the API
  key out of rendered HTML/devtools.
- Default interval: 20s while just the status bar is showing; drop to ~5s while the popup panel
  is visible; pause entirely when the window loses focus for VS Code's `window.state.focused`
  hook, resume + immediate refresh on focus regain.
- On fetch failure (gateway container stopped, wrong port, 401): don't throw — flip to a distinct
  "offline"/"auth error" status bar state and keep retrying on the same interval. No error popups.
- `TeamClaude: Refresh Now` command forces an immediate poll (bypasses interval).

### Status bar (`statusBar.ts`)
Single `StatusBarItem`, right-aligned near the existing Claude Code status items if present.
Must degrade gracefully from 1 account up through ~10, and clip beyond that — the account count
is whatever's in `teamclaude.json`, not something the extension controls, so this can't assume a
fixed small N.

- **1 account**: no sparkline needed, just `$(pulse) 43%` — the headline number *is* the whole
  picture.
- **2-`teamclaude.maxStatusBarAccounts` accounts** (default max `8`): headline % for the single
  most urgent account (highest of its own 5h/7d usage — the one closest to a switch or throttle),
  followed by a one-glyph-per-account sparkline (`▁▂▃▄▅▆▇█`, no per-glyph numbers — numbers only
  for the headline) so e.g. 6 accounts renders as `$(pulse) 85% ▂▇▃▁▅▂`, staying compact
  regardless of count.
- **More than `maxStatusBarAccounts`**: sort accounts by urgency (max(5h%, 7d%) descending)
  before building the sparkline, render glyphs for the top `maxStatusBarAccounts - 1`, then a
  final `⋯` glyph standing in for the rest (hover reveals the true count, e.g. "+4 more"). This
  guarantees the accounts actually worth noticing are the ones that survive clipping, not
  whichever happened to be listed first in config.
- **0 accounts** (config present but empty, or not yet loaded): `$(circle-slash) No accounts` —
  handle as a distinct state, not a crash or an empty item.
- Color: `backgroundColor` set to `statusBarItem.warningBackground` /
  `.errorBackground` ThemeColor when the *headline* (most urgent) account's usage crosses the
  configured warning/critical threshold (default derived from the server's own `switchThreshold`,
  e.g. warn at 70%, critical near `switchThreshold`) — this is the "colour gradient in a single
  icon" the compressed view can actually deliver, VS Code status bar items only expose these few
  semantic background colors.
- Tooltip: `MarkdownString` with a table listing **every** account, unclipped — hover space is
  cheap even at 10 rows, so the clipping only applies to the inline text, never to the tooltip or
  the popup.
- Offline/error state: distinct icon (`$(debug-disconnect)`) + text. Two sub-states worth telling
  apart in the tooltip: "not configured" (no baseUrl resolved at all — points at
  `teamclaude.baseUrl` and the remote's env) vs. "unreachable/unauthorized" (a baseUrl resolved
  but the request failed — gateway container up? port/key correct?).
- `command` on the item → `teamclaude.openPanel`.

### Popup (`popup/panel.ts` + webview)
`vscode.window.createWebviewPanel` (singleton — reveal if already open), `retainContextWhenHidden:
true`. Extension host posts the latest status JSON via `panel.webview.postMessage`; webview is
static HTML/CSS/vanilla JS (no bundworthy framework — keep this light) rendering, per account:
- name/org, active/current badge, disabled/throttled/error badge
- two real progress bars (session 5h, weekly 7d) with %, and "resets in Xh Ym" from the reset
  timestamps
- usage line: requests, input/output tokens, last used (relative time)
- server footer: uptime, sessions known/active, probe/warm-up schedule (matches `teamclaude
  status` terminal output, just laid out visually)

Unlike the status bar, the popup never clips — it's a full panel, so all accounts (1 through 10
and beyond) render as cards in a responsive CSS grid (auto-fill, min card width ~260px): a few
accounts fill one row, ten wrap to a scrollable multi-row grid. No pagination or "show more" —
scrolling inside the panel is the natural answer at any count. Sort order matches the tooltip
(current account first, then by urgency) so the same "what needs attention" ordering holds
across tooltip, status bar sparkline, and popup.

Follow the `dataviz` skill's guidance when actually building the progress-bar/badge styling so it
reads correctly in both light and dark themes.

### Commands (package.json `contributes.commands`)
- `teamclaude.openPanel` — "TeamClaude: Show Usage" (also the status-bar item's click target)
- `teamclaude.refresh` — "TeamClaude: Refresh Now"
- `teamclaude.setApiKey` — "TeamClaude: Set API Key…" — prompts via a password-masked input box,
  stores into `SecretStorage`. Manual last-resort override, see Config resolution.
- `teamclaude.clearApiKey` — "TeamClaude: Clear Stored API Key" — removes it from `SecretStorage`,
  falling back to env/config-file resolution again.

### Settings (package.json `contributes.configuration`)
- `teamclaude.baseUrl` (string, default `""` = auto-detect: config-file host wins if that file's
  present, else "not configured" until set — see Config resolution above)
- `teamclaude.configPath` (string, default `""` = `$TEAMCLAUDE_CONFIG` or the standard path)
- No `teamclaude.apiKey` setting, deliberately — the key is a secret; see `teamclaude.setApiKey`/
  `SecretStorage` in Config resolution above instead.
- `teamclaude.pollIntervalSeconds` (number, default `20`)
- `teamclaude.warningThreshold` / `teamclaude.criticalThreshold` (number 0-1, defaults `0.7` /
  server's `switchThreshold` when known, else `0.9`)
- `teamclaude.maxStatusBarAccounts` (number, default `8`) — sparkline glyph cap before clipping
  to `⋯`; tooltip and popup are never affected by this setting

## Packaging for both marketplaces

No divergent code needed — stable API only. Two publish targets from the same `.vsix`:
- `@vscode/vsce package` / `vsce publish` for the VS Code Marketplace
- `ovsx publish` for Open VSX (what VSCodium/Codium points at, same registry as the reference
  extension)
Needs a publisher id picked before an actual publish (not blocking local dev — `vsce package`
+ "Install from VSIX" works without one being registered yet; the extension id itself,
`<publisher>.teamclaude-status`, is fixed regardless). Add a short README documenting the
TeamClaude setup this extension expects (mirrors `~/code/teamclaude-gateway/README.md`'s
`ANTHROPIC_CUSTOM_HEADERS`/`TEAMCLAUDE_API_KEY` split for host vs. sandboxed dev containers).

## Verification

1. `npm install`, `npm run watch`, launch the Extension Development Host (`F5`, using a
   `.vscode/launch.json` generated by the standard `yo code` TS extension scaffold or hand-written
   equivalent).
2. With the real gateway running (`teamclaude status` already confirms it's up on `:3456`),
   confirm the status bar populates with both accounts' live numbers within one poll interval.
3. Stop the gateway (or point `teamclaude.baseUrl` at a wrong port) → confirm the status bar
   flips to the offline state without throwing/popping error dialogs, and recovers automatically
   once the gateway is back.
4. Click the status bar item → popup opens, shows both accounts with progress bars matching
   `teamclaude status --json` numbers; resize/theme-toggle (light/dark) to confirm it reads
   cleanly in both.
5. Feed the status renderer synthetic status JSON (unit-level, no need for a live gateway) at 1,
   2, 8, and 12 accounts to confirm: 1 account shows no sparkline, 2-8 show one glyph per account,
   12 clips to 7 glyphs + `⋯` with the tooltip/popup still listing all 12; 0 accounts shows the
   "No accounts" state without throwing.
6. `vsce package` → install the produced `.vsix` in a plain VSCodium instance via "Install from
   VSIX" to confirm it behaves identically outside VS Code proper.
7. Run it for real against this machine's actual setup: Codium connected to the Dev Container
   TeamClaude runs alongside. Confirm the extension's process is on the remote side (Command
   Palette → "Developer: Show Running Extensions" lists it under the remote host, not the local
   one), that it resolves `baseUrl`/`apiKey` the same way the `claude` CLI already does in that
   container without any extra settings, and that a plain local (non-remote) VS Code/VSCodium
   window still works via the config-file fallback.
