# Changelog

## 0.3.1

- 旧会话的模型选择失效时，自动使用可用的默认模型，否则使用列表中的第一个可用模型；保留有效选择，列表加载失败或执行任务时不切换。
- 在插件独立运行目录中适配 Science 0.1.70 的模型菜单；退出接入或卸载时恢复。其他界面版本暂不启用自动回退，可手动选择模型。

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
