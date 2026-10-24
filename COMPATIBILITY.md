# Compatibility and verification

## Supported setup

- macOS; original app in `/Applications/Claude Science.app`.
- Official Node.js 22 or 24, with system-library linkage.
- Default user configuration directory and an unrelocated Science installation.
- One Science integration active at a time.
- No claim of Windows/Linux support or Anthropic cloud-service compatibility.

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

The 9-model catalog describes that test installation, not a fixed catalog bundled with the plugin. Your own enabled Magpie providers determine the list. The v0.2.0 live test is not a claim that v0.3.0 has completed a new paid conversation or that every Science tool has been tested.

Magpie may support more recent Science versions, but this local compatibility layer also depends on Science's local login-record format and model-list behavior. Recheck after updates. Model-provider capability differences (tools, images, reasoning, context size) still apply; listing a model is not evidence that it supports every Science workflow.

Science may estimate costs using its own compatibility-model rules. Use Magpie and the upstream provider as the usage/billing reference.
