# v0.3.0 release review

Checked against Magpie's public plugin documentation and the community repository on 2026-10-24.

## Decisions

| Area | Decision and reason |
|---|---|
| Distribution | Independent public GitHub repository with `magpie-plugin` topic; no npm release required |
| Plugin kind | Agent only; it consumes existing provider models and does not supply a provider |
| Agent identity | Keep `science-local`; built-in IDs cannot be replaced by plugins |
| Models | Omit the Agent's `model` field and return the `models` catalog from `connect` |
| Hook runtime | Agent module is configuration-only; no Node APIs or background-service setup in the hook |
| Request adaptation | Owned loopback bridge translates model IDs and echoes the requested alias; no redundant gateway middleware |
| Installation | Explicit CLI setup, not `postinstall`; Magpie leaves install scripts unrun |
| Versions | Preserve GitHub registration for discovery while copying a verified local runtime; service upgrades are explicit |
| Rollback | Restore a frozen plugin/runtime pair; subsequent upgrade can re-enable the GitHub source |
| Dependencies | One pinned TOML parser is needed to preserve structured existing Science configuration; it is copied with the managed runtime |
| Published contents | Source, tests, lockfile, CI and documentation; runtime state and private backups excluded |
| License | Preserve upstream MIT copyright and derivation notice |

## Validation

- 64 local tests passed with Node 24.13.0. Removed obsolete middleware tests with the redundant middleware; kept bridge, catalog, files, installer and process-ownership coverage.
- The managed-service fixture installs/upgrades/uninstalls with a GitHub source registration and verifies that the runtime remains linked to that source.
- Installer checks cover a failed upgrade, GitHub source retention, rollback to a frozen local version, and a later upgrade back to the original source.
- A separate real Magpie 0.1.1364 instance loaded the Agent-only plugin with a fresh HOME. Legacy single-model config was migrated, two fake models routed independently, streamed tool deltas and model aliases were retained, and unrelated agents were unaffected.
- The actual package tarball was installed in a temporary directory. Its Agent module and CLI loaded, its file list matched the allowlist, and its copied deployment resolved the production dependency correctly.
- The CI workflow runs Node 22 and 24 on macOS. Remote CI completion must be reported separately from these local results.

No v0.3.0 real-provider conversation was run as part of release preparation, and the existing user's service was not restarted for publication. The preceding v0.2.0 live baseline is described in [COMPATIBILITY.md](../COMPATIBILITY.md).

## Boundaries to retain in the listing

- macOS only; no claim of official Magpie or Anthropic review.
- Adding the plugin alone is not complete setup; a separate local service must be initialized.
- A local compatibility identity is not an Anthropic account or paid subscription.
- Existing native Science sessions are not imported; the adapter uses a separate data directory.
- Magpie's model catalog is user-specific; do not advertise a fixed bundle of nine models.
- Updating the marketplace entry does not automatically upgrade/restart the copied runtime.
- No Anthropic cloud-feature compatibility guarantee and no automatic approval of Science tools.
