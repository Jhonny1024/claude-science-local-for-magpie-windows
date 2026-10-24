# Changelog

## 0.3.0

- Publish as **Claude Science Local for Magpie**, package `claude-science-local-for-magpie`; retain the existing agent ID, local data paths and legacy CLI alias for upgrades.

- Format the source for public review and add a pinned development-only formatter.
- Prepare a standalone GitHub distribution, with explicit package contents and concise Chinese setup documentation.
- Register only an Agent. The local bridge already translates model IDs and replies; redundant gateway middleware is no longer registered or shipped.
- Keep an existing installation from this exact GitHub repository registered in Magpie when installing/upgrading the copied service, so marketplace update discovery remains available.
- Keep service upgrades explicit. Rollback pins the saved plugin/runtime together, and a subsequent upgrade can reconnect the original source.
- Add source identity, package-content and published-install lifecycle checks, a reproducible dependency lock and macOS CI.

## 0.2.0

- Use Magpie's list-model Agent interface.
- Expose each selected provider model as an independent Science-compatible model entry.
- Preserve the previous default model, names and limits; internal helper requests follow the last selected main model.
- Reject removed model selections instead of silently substituting another provider.

## 0.1.0

- Initial local adapter derived from upstream v0.1.3, with independent `science-local` identity, managed runtime and reversible configuration.
