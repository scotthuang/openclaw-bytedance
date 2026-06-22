# Changelog

All notable changes to `@scotthuang/openclaw-bytedance` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-06-22

### Fixed

- **web_search:** tolerate unresolved OpenClaw SecretRef values for
  `plugins.entries.bytedance.config.webSearch.apiKey` during local capability
  execution, then fall back to the real `ARK_SEARCH_API_KEY` environment
  variable instead of failing before the Volcengine request is sent.
- **web_search:** surface Volcengine `ResponseMetadata.Error` envelopes as
  explicit provider errors instead of treating HTTP 200 responses with no
  result data as empty searches.
- **web_search:** send a demo-compatible web `Filter` payload
  (`NeedContent`, `NeedUrl`, `AuthInfoLevel`) while keeping `SearchType: "web"`
  for users without `web_summary` permission.

### Removed

- Removed the bundled hardcoded fallback search API key. Search now uses only
  explicit config or the documented search env vars, so calls do not silently
  bypass the user's `ARK_SEARCH_API_KEY`.

### Tests

- Added opt-in live Volcengine search tests gated by
  `RUN_ARK_SEARCH_LIVE_TEST=1`, covering both the Python-demo-equivalent API
  payload and the normalized OpenClaw provider result shape.

## [0.1.5] - 2026-06-15

### Added

- **Search API key:** hardcoded default search API key as lowest-priority
  fallback, so the search APK works without any env-var or config setup.
- `index-search.ts` entry point and `openclaw.plugin-search.json` manifest
  for standalone search-only deployments.

### Changed

- Plugin entry split into two build targets from a single codebase:
  - `index.ts` → Vision + Search (default, both providers).
  - `index-search.ts` → Search-only (standalone APK).

### Fixed

- `openclaw.plugin-search.json` was missing from the published package in
  0.1.3; added to `files` in `package.json`.

## [0.1.2] - 2026-05-23

### Fixed

- Migrated `providerAuthEnvVars` to `setup.providers[].envVars` to fix build
  errors against newer OpenClaw SDK types.

## [0.1.1] - 2026-05-16

### Fixed

- **web_search:** Volcengine Ark search calls were failing with
  `TypeError: readProviderJsonResponse is not a function` on host runtimes
  whose `openclaw/plugin-sdk/provider-http` build did not yet export that
  helper (notably OpenClaw `2026.5.12`). The error was swallowed by
  OpenClaw's web-search fallback chain, so requests silently routed to
  another provider (e.g. `tavily`) instead of `bytedance`. The runtime now
  parses Ark responses with the standard `Response#json()` and no longer
  depends on that unstable SDK export.

### Removed

- Internal `src/openclaw-augmentations.d.ts` ambient module shim that was
  previously needed to type the now-unused `readProviderJsonResponse`
  import.

### Notes

- No public API or configuration changes. Existing `tools.web.search.provider:
  "bytedance"` and `plugins.entries.bytedance.config.*` setups keep working
  unchanged after upgrading.

## [0.1.0] - 2026-05-15

### Added

- Initial release of the OpenClaw plugin for ByteDance Volcengine Ark.
- `registerWebSearchProvider({ id: "bytedance" })` backed by Volcengine Ark
  Harness ("AskEcho Search Infinity") via
  `POST open.feedcoopapi.com/search_api/web_search`.
  - Supports `searchType` (`web` | `image`), `count` clamping
    (web 1-50 / image 1-5), `timeRange` (`OneDay`/`OneWeek`/`OneMonth`/
    `OneYear` or `YYYY-MM-DD..YYYY-MM-DD`), and `authLevel` (0/1).
  - Returns titles, URLs, snippets, AI-generated summaries, publish dates,
    and site names, all wrapped in OpenClaw's untrusted-content envelope.
- `registerMediaUnderstandingProvider({ id: "bytedance", capabilities:
  ["image"] })` backed by Doubao multimodal models on Volcengine Ark Agent
  Plan (default model: `doubao-seed-2.0-pro`) via OpenAI-compatible
  `/chat/completions`.
  - Inlines images as base64 data URLs; falls back to `image/jpeg` for
    unknown MIME types.
  - Honours `req.timeoutMs`, `req.maxTokens`, and `req.prompt`; supports
    multi-image batches with per-image indexed prompts.
- Two-key credential model so vision and search quotas stay independent:
  - Vision/chat: `ARK_API_KEY` (alias: `VOLCENGINE_API_KEY`).
  - Search: `ARK_SEARCH_API_KEY` (aliases: `ASK_ECHO_SEARCH_INFINITY_API_KEY`,
    `VOLCENGINE_SEARCH_API_KEY`).
  - Or via config: `plugins.entries.bytedance.config.vision.{apiKey,baseUrl,model}`
    and `plugins.entries.bytedance.config.webSearch.{apiKey,baseUrl,searchType,timeRange}`.
- Plugin-scoped logger captured from `api.logger` at register time, with
  `[bytedance]` prefix on all lines:
  - `info` on register / successful tool invocation.
  - `debug` on HTTP request preparation, cache hits, response codes,
    per-image batch progress.
  - `warn` on missing API keys, oversize/empty queries, invalid time
    ranges, HTTP non-2xx responses, and provider error envelopes.
  - `error` on JSON decode failures, network aborts/timeouts, and
    end-to-end invocation failures.
- Untrusted-content wrapping (`wrapWebContent`) on all returned titles,
  snippets, and summaries.
- Trusted-endpoint enforcement via `withTrustedWebSearchEndpoint`
  (private-network egress blocked).
- `X-Traffic-Tag: ark_mcp_server_openclaw_bytedance` on search requests.
- Vitest unit tests covering credential resolution, payload construction,
  time-range validation, count clamping, response parsing, request shape,
  data URL formatting, and error handling (67 tests).

[Unreleased]: https://github.com/scotthuang/openclaw-bytedance/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/scotthuang/openclaw-bytedance/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/scotthuang/openclaw-bytedance/compare/v0.1.2...v0.1.5
[0.1.2]: https://github.com/scotthuang/openclaw-bytedance/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/scotthuang/openclaw-bytedance/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/scotthuang/openclaw-bytedance/releases/tag/v0.1.0
