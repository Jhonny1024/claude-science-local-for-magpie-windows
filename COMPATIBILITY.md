# Compatibility and verification

## Supported setup

- macOS; original app in `/Applications/Claude Science.app`.
- Windows; per-user Science installation in `~/AppData/Local/Programs/ClaudeScience`, or an explicit `--science` executable. Windows uses PowerShell CIM for process ownership, a private runtime ACL, and Windows Script Host for user-login startup.
- Official Node.js 22 or 24, with system-library linkage.
- Default user configuration directory and an unrelocated Science installation.
- One Science integration active at a time.
- Linux remains unsupported. Anthropic cloud-service compatibility is not guaranteed. Windows ARM64 has not been tested locally.

## Evidence, 2026-10-24

| Check | Result |
|---|---|
| Magpie | 0.1.1364 |
| Claude Science | 0.1.70 |
| Local Node | 24.13.0 |
| v0.2.0 installed model list | Science API returned 9 distinct entries, from DeepSeek and Codex |
| v0.2.0 actual Science conversation | GPT-6-Astra returned the required verification reply |
| v0.2.0 second-provider route | DeepSeek returned through its own bridge model entry; Magpie logged HTTP 200 |
| GUI screenshot | Not verified; native UI inspection service was unavailable |
| v0.3.0 packaging and source migration | See `docs/RELEASE-REVIEW.md`; local tests must pass before publishing |
| v0.3.1 model fallback | Browser regression: old Sonnet selection becomes GPT-6-Astra; manual selection works; reloading repairs the unchanged historical selection again. No inference request sent. |
| v0.3.1 assets and lifecycle | Plain and compressed scripts contain the same repair; rollback/uninstall restore owned files. |

The 9-model catalog describes that test installation, not a fixed catalog bundled with the plugin. Your own enabled Magpie providers determine the list. The v0.2.0 live test is not a claim that v0.3.0 has completed a new paid conversation or that every Science tool has been tested.

Magpie may support more recent Science versions, but this local compatibility layer also depends on Science's local login-record format and model-list behavior. Recheck after updates. Model-provider capability differences (tools, images, reasoning, context size) still apply; listing a model is not evidence that it supports every Science workflow.

Science may estimate costs using its own compatibility-model rules. Use Magpie and the upstream provider as the usage/billing reference.

Starting in 0.3.1, stale composer selections fall back to a currently available default. This optional UI adapter is restricted to the verified Science 0.1.70 web asset, in the plugin's independent data directory. It does not modify the macOS application bundle or historical messages. A different UI version/build leaves the original picker intact and reports `modelFallback: unsupported` in `doctor`; users can still select a model manually. Disconnect, rollback and uninstall restore the owned asset; user edits are preserved as conflicts.

## Windows port verification, 2026-10-26

Local port: `0.3.2-windows.1`, based on upstream `43b28e0` (`0.3.1`). Host: Windows x64, Node 22.22.2, Science 0.1.70. macOS execution was not available on this host; macOS-specific behavior is retained in its original branch and CI now includes both operating systems with Node 22/24. Remote CI results are separate from local evidence.

- Local regression: 76 tests total; 70 passed and 6 skipped (5 file-symlink privilege cases and the macOS launchctl integration fixture). The Windows junction, ACL and lifecycle equivalents ran.
- Windows lifecycle tests exercise copied Node.exe, paths with spaces, hidden login startup, manager logs, install/upgrade, injected upgrade failure recovery, rollback, restart, uninstall after a manager crash, session retention and original-config restoration.
- ACL checks verify a protected current-user FullControl rule. Junction paths are rejected. POSIX-only permission assertions do not pretend to verify Windows ACLs; file-symlink tests skip when Windows does not grant symlink creation.
- The real installed Magpie loaded the staged Windows Agent in an isolated HOME. Legacy selection migration, two-model routing, streamed tools, alias restoration, token counting and isolation from other agents passed against local fake providers. This caught and fixed a Node-import incompatibility in the Agent sandbox; platform selection now happens during deployment, not inside that sandbox.
- The real Windows Science started with its sandbox enabled and initialized the probe's own generated encryption material in DPAPI. Its official nonce form established a local browser session; `/api/auth/status` returned `authenticated: true`, `/api/models` returned the bridge's test model, and `/api/me` returned HTTP 200. The 0.1.70 model-fallback adapter was active. Shutdown restored the probe's original configuration.
- The installed tarball's CLI, Agent contract and dependency deployment passed. Windows runtime files stay in the project by default; npm cache and verification files stay under `work/`.

No paid-provider inference, complete research workflow, graphical desktop interaction, actual sign-out/sign-in cycle, or local macOS run was performed. The Startup script was executed directly in the test, including a Chinese path. Native tests used independent data and did not stop the existing user's Science instance.

## Reopen regression, 0.3.2-windows.2

The reported installation was still running a 0.3.1 copied runtime while Magpie had been changed to the source checkout. That runtime did not recognize the checkout, disconnected and restored the original config; the unqualified desktop entry then opened the native login profile. A regression reproduced this transition before the fix and remained connected after persisting `sourceProject`. Explicitly disabling the Agent still disconnects and restores the native configuration.

The native Windows test now performs two complete starts with the same data and generated local account. Both starts returned authenticated=true, the same account identity, the test model and HTTP 200 from /api/me. No ticket or encryption key is regenerated between starts. `open` checks the managed service before invoking Science with its explicit config and data path. This test does not claim a paid-provider conversation or a Windows reboot test.

Local repair validation: 29 affected lifecycle/installer/config tests passed, one file-symlink privilege case skipped; four process-ownership tests passed. The existing managed installation was upgraded to 0.3.2-windows.2, opened through the explicit managed entry and returned authenticated=true and a non-empty model catalog. No paid inference request was sent.

## Native desktop entry repair, 0.3.2-windows.3

The .2 API-only reopen checks did not cover the standard Windows desktop launcher. That launcher could start an unconfigured daemon in the managed profile; the manager then refused ownership. Also, the previous integration `open` invoked Science's browser command, not its native window.

The .3 installer journals and redirects the existing standard desktop and Start Menu shortcuts to the manager. After readiness, it hands a freshly minted official local sign-in link to Science 0.1.70's existing attach-only native shell. It does not edit the installed Science executable, migrate its window profile, enable debugging, or disable either sandbox. Custom shortcuts are left unchanged.

Local validation: 19 desktop/Windows lifecycle/process/installer tests passed and one file-symlink privilege case skipped. Package installation and formatting checks passed. The native window was opened and inspected: Magpie model names and a routing-group model appeared under More models. The local installation was upgraded to .3 and both standard shortcuts were checked. A subsequent desktop launch attached to the managed daemon and the service reported running with 69 configured models. Existing failed conversation banners remain historical errors; no new paid inference was initiated by this verification, and a fresh user conversation remains the end-to-end inference check.
