# Obsidian provider settings

This document describes the provider settings flow in the desktop Obsidian
plugin. It is intentionally limited to configuration behavior; provider keys,
Vault data, and real model responses never belong in the repository.

## Sources and runtime requirements

The provider page has two sources:

| Source | Behavior | Runtime/data boundary |
| --- | --- | --- |
| `cc-switch` database | Read-only provider directory. The plugin reads provider metadata and uses the selected configuration without editing the database. | An Obsidian/Electron runtime with `node:sqlite` is required. An empty database path uses the user's default cc-switch location. |
| Custom providers | Editable list with add, edit, delete, and active-provider selection. | Values are stored in the current Vault's plugin data file. API keys are plaintext local data and must not be committed or shared. |

The plugin supports Chat Completions, Responses, and Anthropic Messages
providers. A Base URL is the API root, such as `https://example.com/v1`; the
endpoint suffix is derived by the selected protocol.

## Compact provider directory

The cc-switch view is organized as a compact directory so the provider list
does not become a tall form:

```text
provider source → database path → app type → current-provider behavior
                                      ↓
                              compact provider rows
                                      ↓
                                provider detail
                                      ↓
                              model dropdown
```

The directory shows the provider name, category/model summary, current or
active state, and whether its configuration is usable. Selecting a row opens a
detail view. The detail view contains the read-only metadata, actions to pin a
provider or follow the global current provider, and the model controls.

Custom providers use the same source area but keep their editable list and
editor. A custom model can be entered directly; a successful model discovery
also makes returned models available as choices.

## Provider and model selection

For cc-switch providers, the model control is a dropdown with these rules:

- the provider's default model is always available as the first fallback;
- `发现模型`/`Refresh models` queries the provider's derived `/models` endpoint
  and appends the returned IDs for the current session;
- choosing a model automatically pins the corresponding provider, so a model
  override cannot silently remain attached to another provider;
- clearing the selection uses the pinned provider's default model;
- if a provider has no usable credentials, its model control and discovery
  action are disabled.

Model discovery is best-effort. An empty list, an HTML/maintenance page, an
unsupported endpoint, or a network error is shown as a status message while
the provider default remains usable. Discovery results are not written back to
the cc-switch database.

## Data and security boundaries

- cc-switch data is read-only from the plugin's point of view; keys are
  redacted in the UI and are not copied into repository files.
- Custom API keys are stored in the current Vault's
  `.obsidian/plugins/video-memo/data.json` because the plugin needs them for a
  run. They are not placed in command-line arguments, logs, notes, or output
  artifacts.
- Do not commit `.env`, `.obsidian/`, cc-switch/SQLite databases, database
  sidecars, browser cookie exports, media, transcripts, model weights, output
  directories, or real Vault data.
- The plugin launches the Python engine with `shell: false`; provider values
  are passed through the child-process environment and are never interpolated
  into a shell command.

## Verification

From `obsidian-plugin/`:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build
```

The test suite uses local Obsidian/Electron mocks and `jsdom`. It covers
provider source switching, app-type/provider selection, model dropdowns,
automatic provider pinning, model discovery failures, database-path behavior,
settings persistence, progress, and source-modal interactions. It does not
contact a real provider or read a user's Vault/database.
