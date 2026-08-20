# Getting published — teamclaude-status

Two separate registries, two separate accounts, no shared login. Neither depends on the other,
so work through Part A and Part B independently, in whichever order you like. Do both once
`PLAN.md`'s implementation is done and `vsce package` produces a working `.vsix` you're happy
with — no point creating accounts before there's something to publish.

## Before either one: what package.json needs

Both registries read the same `.vsix`, built from the same `package.json`. Have these in place
before the first publish attempt, since both marketplaces render them directly on the listing
page:

- `publisher` — the id from whichever account step below you do first (see "One id or two?").
- `name` / `displayName` / `description` / `version` — `name` is `teamclaude-status`, fixed.
- `icon` — a 128×128 PNG, referenced from `package.json`. Marketplace listings without one look
  unfinished; worth a few minutes even for a small utility extension.
- `repository` — a `url` pointing at the GitHub repo (public, once pushed).
- `license` — an `SPDX` id in `package.json` plus a matching `LICENSE` file in the repo root.
- `categories` / `keywords` — `["Other"]` is fine to start; helps discovery either way.
- `README.md` — becomes the marketplace page verbatim (both registries render it as-is). Worth a
  screenshot or two of the status bar + popup once they exist.
- `engines.vscode` — the minimum VS Code version the extension targets; `vsce`/`ovsx` both refuse
  to publish without it.

## One id or two?

`publisher` (VS Code Marketplace) and the Open VSX *namespace* are independent strings — nothing
requires them to match, and each is a separate uniqueness check on a separate registry. Simpler
to pick one identity (e.g. your GitHub username) and use it both places so the
extension shows up as `<same-id>.teamclaude-status` everywhere; check it isn't already taken on
each registry before committing, since a clash on one doesn't imply a clash on the other.

## Part A — VS Code Marketplace

Reference: [Publishing Extensions — VS Code docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

1. **Azure DevOps organization** — sign in at [dev.azure.com](https://dev.azure.com) with a
   Microsoft account (create one if needed) and create an organization; the name doesn't matter,
   it's just where the token lives.
2. **Personal Access Token** — profile icon → *Personal Access Tokens* → *+ New Token*. Scope:
   *Custom defined* → *Marketplace* → **Manage** (that single scope is enough — don't grant
   more). Set an expiry, then **copy the token immediately**; Azure DevOps shows it once.
   - If the creation flow redirects in circles, the documented workaround is to go through the
     [Marketplace publisher management page](https://marketplace.visualstudio.com/manage)
     instead, in a private/incognito window: publisher profile → *Security* → *Personal Access
     Tokens*.
3. **Create the publisher** — either `npx @vscode/vsce create-publisher <id>` or through the
   [publisher management page](https://marketplace.visualstudio.com/manage) directly (the web
   form is the more reliable path if the CLI one is fussy).
4. **Log in and publish**:
   ```
   npm install -g @vscode/vsce
   vsce login <publisher-id>        # pastes/stores the PAT
   vsce package                     # sanity-check the .vsix first
   vsce publish                     # or: vsce publish -p <token>, skipping login
   ```
   `vsce publish patch` bumps the version and publishes in one step for later releases.
5. **Package/publish from Linux or macOS**, not Windows — Windows-built `.vsix` files lose POSIX
   file attributes some `node_modules` binaries depend on. Not a concern for this extension (no
   native deps), but worth knowing if that ever changes.

**Heads up**: Microsoft is retiring classic Azure DevOps PATs for Marketplace publishing on
**2026-12-01** in favor of Microsoft Entra ID-based publishing. The PAT flow above is current and
fine to use now; if you're still actively publishing near that date, check the
[VS Code publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for whatever the Entra ID flow looks like by then before your PAT stops working.

## Part B — Open VSX (what VSCodium/Codium points at)

Reference: [Publishing Extensions — Eclipse OpenVSX wiki](https://github.com/EclipseFdn/open-vsx.org/wiki/Publishing-Extensions)

1. **Account** — sign in at [open-vsx.org](https://open-vsx.org) (GitHub sign-in works).
2. **Access token** — avatar → *Settings* → *Access Tokens* → create one. This is the value
   `ovsx` needs, either via `--pat`/`-p` or an `OVSX_PAT` env var.
3. **Create the namespace**:
   ```
   npm install -g ovsx
   ovsx create-namespace <same-id-as-above>
   ```
   Creating it doesn't reserve it — anyone can currently publish into an unclaimed namespace.
4. **Claim ownership** (do this — it's what makes the listing show as "verified" instead of
   carrying an unverified-publisher warning banner): open an issue on
   [EclipseFdn/open-vsx.org](https://github.com/EclipseFdn/open-vsx.org/issues) asking for
   ownership of the namespace, linked to the GitHub account that owns it. Handled by a human,
   done in the open (existing issues are the template to follow).
5. **Publish**:
   ```
   ovsx publish                     # builds via vsce + publishes from the current source
   # or, reusing the .vsix already built for the VS Code Marketplace:
   ovsx publish path/to/teamclaude-status-0.1.0.vsix -p $OVSX_PAT
   ```
   Same `.vsix` works for both registries — no need to build twice.

## Token hygiene

Neither PAT belongs in the repo. `vsce login` / `ovsx login` store theirs in the OS keychain
(falls back to a plaintext `~/.ovsx` file for `ovsx` if no keychain is available — check that
didn't happen on a shared machine). For CI later, the equivalent is `VSCE_PAT` / `OVSX_PAT` as
GitHub Actions secrets, referenced but never printed — not needed for a first manual publish.

## Suggested order

1. Finish and locally verify the extension per `PLAN.md`'s verification section.
2. `vsce package`, install the `.vsix` in both VS Code and VSCodium via "Install from VSIX",
   confirm it looks right end to end (this is the last free chance to fix the README/icon/description
   before it's public).
3. Publish to the VS Code Marketplace (Part A) first — larger audience, and its review is
   effectively instant/automated so you'll know quickly if metadata needs fixing.
4. Publish to Open VSX (Part B) with the same `.vsix`, then file the namespace-ownership issue.
