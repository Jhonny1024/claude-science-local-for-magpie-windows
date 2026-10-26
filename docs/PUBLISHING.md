# Standalone GitHub publishing

This project uses Magpie's **unofficial GitHub discovery** path, not the `@magpie-community` organization or its automatic publishing pipeline.

## Repository and discovery

- Repository: `Jhonny1024/claude-science-local-for-magpie-windows`.
- Create a normal public repository, **not a GitHub fork**. Keep the upstream MIT license and attribution in the repository.
- Keep `package.json`, `README.md`, and all referenced `src/` entries committed at the root. There is no generated `dist` directory or install/build hook.
- Add the `magpie-plugin` topic. Useful additional topics: `magpie`, `claude-science`, `macos`, `windows`.
- Magpie discovers tagged repositories in its unofficial section. GitHub discovery is cached for up to ten minutes and is ordered by stars. Publication does not guarantee an immediate card or an official review.
- `magpie plugin add Jhonny1024/claude-science-local-for-magpie-windows` installs directly from this repository; npm publication is not required.

## Before each release

```sh
npm ci --ignore-scripts
npm test
npm run check:package
MAGPIE_BUN=/path/to/magpie-bun npm run test:integration
```

Review the actual staged file list. Publish only source, tests, the dependency lock, the CI workflow, and public documentation. Never add `work/`, local runtime directories, logs, credentials, backup journals, `node_modules/`, or personal verification artifacts.

Use the package `files` allowlist for the tarball. `check:package` inspects that tarball, installs it in a temporary folder, loads its Agent contract, exercises its CLI help and checks a copied deployment with the resolved production dependency. It publishes nothing and starts no real Science daemon.

Bump `package.json` and its lock, update `CHANGELOG.md`, then commit and tag the matching version. The CI workflow tests Node 22 and 24 on macOS and Windows; it has read-only repository permissions and no publish credentials. A tag is a release marker, while ordinary GitHub plugin installs follow the repository revision unless users pin a ref.

The installed GitHub plugin and copied runtime are separate. Tell users to finish tasks, update the plugin in Magpie, update their clone, then run `node src/cli.js upgrade`. Do not claim automatic background-runtime updates.

## Optional later listing

To request inclusion in Magpie's curated registry, publish an installable package and submit a registry entry with `kind: "agent"`, no `providers`, and English/Chinese summaries to `magpie-community/plugins`. Inclusion requires their acceptance; adding a topic alone does not do this.

Moving the package into their monorepo is a different route, with the `@magpie-community/agent-...` package name and their release workflow. Do not use that namespace or claim community maintenance for this independent repository.

## Sources checked 2026-10-24

- [Magpie publishing and listing](https://usemagpie.ai/docs/plugins#publishing-and-listing)
- [Agent contract](https://usemagpie.ai/docs/plugins#agent-plugins)
- [Magpie plugin install behavior](https://usemagpie.ai/docs/plugins#how-magpie-runs-plugins)
- [Community repository](https://github.com/magpie-community/plugins)
- [Community registry](https://github.com/magpie-community/plugins/blob/main/registry.json)

The community's `scripts/check.mjs` explicitly skips Agent-only packages. It is therefore not evidence that this adapter was exercised; this repository's Agent, runtime and actual-Magpie integration checks supply that evidence.

## Windows local-port distribution

`0.3.2-windows.1` is the Windows port published in this repository, not a release of the original upstream. Windows installation pins Magpie to the staged runtime's static `agent-windows.js` entry because Agent hooks cannot import Node modules or read `process.platform`. macOS keeps the original Agent entry and GitHub registration behavior. Update the checkout and run `upgrade`; do not advertise automatic Windows plugin/runtime updates.
