# TeamClaude Status

Live usage monitoring for [TeamClaude](https://www.npmjs.com/package/@karpeleslab/teamclaude)'s
linked Claude Max accounts, right in the editor: a status-bar quota chip for all linked accounts,
and a click-through panel with full per-account detail.

This is read-only monitoring — it never switches accounts or changes gateway state.

## Status bar

- **1 account**: `43%` — the single headline number.
- **2+ accounts**: a headline percentage for whichever account is closest to throttling, followed
  by a one-glyph-per-account sparkline (`▂▇▃▁▅▂`). Beyond `teamclaude.maxStatusBarAccounts`
  (default 8), the sparkline clips to the most urgent accounts plus a trailing `⋯`.
- Hover for a full table of every account, unclipped, regardless of how many are configured.
- Turns amber/red when the most urgent account crosses `teamclaude.warningThreshold` /
  `teamclaude.criticalThreshold`.
- Click to open the full usage panel.

## Requirements

A running TeamClaude gateway this extension can reach over HTTP, and a way to authenticate to it.
Both are usually automatic — see below.

### Base URL

- Plain local install, gateway on the same machine (or reached via a forwarded port): resolved
  automatically from `~/.config/teamclaude/teamclaude.json`'s `proxy.port`, no configuration
  needed.
- Dev container / remote setup where the gateway is a separate container on a compose network:
  set `teamclaude.baseUrl` (e.g. `http://teamclaude-gateway:3456`) in that environment's own
  settings (`devcontainer.json`'s `customizations.vscode.settings`, or the container's
  `settings.json`) so it travels with the environment.

This extension declares `"extensionKind": ["workspace"]`, so under VS Code Remote Development it
always runs in the same Extension Host as the remote/container — the same place the `claude` CLI
and Claude Code's own extension already run — not on the machine the UI renders on.

### API key

No plaintext `teamclaude.apiKey` setting exists on purpose — `settings.json` can be committed or
synced, which is a worse place for a secret than either automatic source below:

1. `TEAMCLAUDE_API_KEY` environment variable, if set in the extension host's environment (the
   sandboxed dev-container pattern).
2. Otherwise, `proxy.apiKey` from `teamclaude.json`, the same field the `teamclaude` CLI itself
   reads.
3. Manual override/fallback: run **TeamClaude: Set API Key…** to store one in VS Code's
   `SecretStorage` (OS keychain-backed). Clear it again with **TeamClaude: Clear Stored API Key**.

## Commands

| Command | Description |
|---|---|
| `TeamClaude: Show Usage` | Opens the usage panel (also the status bar item's click target) |
| `TeamClaude: Refresh Now` | Forces an immediate poll |
| `TeamClaude: Set API Key…` | Stores a manual API key override in `SecretStorage` |
| `TeamClaude: Clear Stored API Key` | Removes the stored override |

## Settings

| Setting | Default | Description |
|---|---|---|
| `teamclaude.baseUrl` | `""` | Gateway base URL. Empty = auto-detect from `teamclaude.json`. |
| `teamclaude.configPath` | `""` | Path to `teamclaude.json`. Empty = `$TEAMCLAUDE_CONFIG` or the standard path. |
| `teamclaude.pollIntervalSeconds` | `20` | Poll interval while only the status bar is visible (drops to ~5s while the panel is open). |
| `teamclaude.warningThreshold` | `0.7` | Usage fraction at which the status bar turns amber. |
| `teamclaude.criticalThreshold` | `0.9` | Usage fraction at which the status bar turns red. |
| `teamclaude.maxStatusBarAccounts` | `8` | Sparkline glyph cap before clipping. Tooltip/panel are never clipped. |

## Development

```
npm install
npm run watch
```

Then press `F5` to launch an Extension Development Host.
