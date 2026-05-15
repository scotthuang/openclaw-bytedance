# @scotthuang/openclaw-bytedance

> OpenClaw plugin for **ByteDance Volcengine Ark** — adds two tools to your OpenClaw agent:
>
> 1. **Web Search** — via Volcengine Ark Harness ("AskEcho Search Infinity"), the same backend the official `volcengine/mcp-server` package wraps
> 2. **Image Understanding** — via Doubao multimodal models (default: `doubao-seed-2.0-pro`)

This plugin is open-source and **never bundles any API key**. You configure your own credentials via environment variables or the OpenClaw config file.

---

## Features

| Capability         | Backend                                                        | Default Model           |
| ------------------ | -------------------------------------------------------------- | ----------------------- |
| Web Search         | `POST open.feedcoopapi.com/search_api/web_search`              | (no model — direct API) |
| Image Understanding| `POST {ARK_BASE_URL}/chat/completions` (Agent Plan)            | `doubao-seed-2.0-pro`   |

The web-search tool returns **titles, URLs, snippets, AI-generated summaries, publish dates, and site names** — wrapped in OpenClaw's untrusted-content envelope so prompts stay safe.

---

## Two API keys, by design

Volcengine Ark splits chat/vision and search across two products with separate quotas. The plugin reflects that:

| Capability          | Env var                                  | Console location                                      |
| ------------------- | ---------------------------------------- | ----------------------------------------------------- |
| Vision / chat       | `ARK_API_KEY`                            | Agent Plan → API Key 管理                              |
| Web search          | `ARK_SEARCH_API_KEY` (or `ASK_ECHO_SEARCH_INFINITY_API_KEY`) | Agent Plan → 使用配置 → 配置 Harness → 联网 API Key |

You can configure either, both, or neither. Tools whose key is missing return a clear "missing key" error.

---

## Installation

End users (let OpenClaw install it from npm):

```bash
# inside your OpenClaw config / extension manager
# add @scotthuang/openclaw-bytedance to the plugins list
```

Or globally:

```bash
npm install -g @scotthuang/openclaw-bytedance
```

Local development:

```bash
git clone https://github.com/scotthuang/openclaw-bytedance.git ~/github/openclaw-bytedance
cd ~/github/openclaw-bytedance
npm install
# Link a local OpenClaw checkout for type resolution + tests
# (override OPENCLAW_REPO if it lives somewhere other than ../openclaw)
npm run setup:openclaw
npm run build
```

---

## Configuration

### Env vars (most users)

```bash
# Vision / chat (Agent Plan)
export ARK_API_KEY="ark-xxxxxxxxxxxx"
# Optional override (default: https://ark.cn-beijing.volces.com/api/plan/v3)
# export ARK_BASE_URL="..."

# Web search (Harness AskEcho Search Infinity)
export ARK_SEARCH_API_KEY="<your-harness-search-key>"
# Optional override (default: https://open.feedcoopapi.com)
# export ARK_SEARCH_BASE_URL="..."
```

Aliases also accepted:

| Primary               | Aliases (lower priority)                                              |
| --------------------- | --------------------------------------------------------------------- |
| `ARK_API_KEY`         | `VOLCENGINE_API_KEY`                                                  |
| `ARK_BASE_URL`        | `VOLCENGINE_BASE_URL`                                                 |
| `ARK_SEARCH_API_KEY`  | `ASK_ECHO_SEARCH_INFINITY_API_KEY`, `VOLCENGINE_SEARCH_API_KEY`       |

### OpenClaw config file (alternative)

```toml
[plugins.entries.bytedance.config.webSearch]
# apiKey = "<harness-search-key>"  # falls back to ARK_SEARCH_API_KEY
# baseUrl = "https://open.feedcoopapi.com"
searchType = "web"               # or "image"

[plugins.entries.bytedance.config.vision]
# apiKey = "ark-..."              # falls back to ARK_API_KEY
# baseUrl = "..."                 # falls back to ARK_BASE_URL
model = "doubao-seed-2.0-pro"
```

---

## Tool surface

### `web_search` (ByteDance / Volcengine Ark Harness)

| Field        | Type           | Description                                                                                                  |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `query`      | string (req'd) | 1–100 characters                                                                                             |
| `count`      | number         | Web: 1–50, Image: 1–5. Defaults to 5                                                                         |
| `searchType` | enum           | `web` (default) or `image`                                                                                   |
| `timeRange`  | string         | `OneDay` / `OneWeek` / `OneMonth` / `OneYear`, or `YYYY-MM-DD..YYYY-MM-DD` (web only)                        |
| `authLevel`  | 0 \| 1         | 0 = default, 1 = only highly authoritative sources (web only)                                                |

**Response** (abridged):

```jsonc
{
  "query": "OpenClaw",
  "provider": "bytedance",
  "searchType": "web",
  "count": 3,
  "tookMs": 315,
  "requestId": "202605160209109A2F527379DE92B5997E",
  "results": [
    {
      "title": "<wrapped: OpenClaw 入驻微博...>",
      "url": "https://...",
      "description": "<wrapped: snippet>",
      "summary": "<wrapped: longer model-generated summary>",
      "published": "2026-03-04T08:27:25+08:00",
      "siteName": "中华网"
    }
  ],
  "externalContent": { "untrusted": true, "source": "web_search", "provider": "bytedance", "wrapped": true }
}
```

### Image Understanding (auto-invoked by OpenClaw media pipeline)

The plugin sends each image as a base64 data URL inside an OpenAI-compatible multimodal user message and returns the model's textual description.

Supported MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Unknown types fall back to `image/jpeg`.

The image must be at least **14×14 pixels** (Volcengine Ark service-side requirement).

---

## Security notes

- **No bundled credentials.** Keys are resolved at runtime from config or env vars only.
- **Untrusted-content envelope.** All web-fetched titles, snippets, and summaries are wrapped via OpenClaw's `wrapWebContent` helper.
- **Trusted endpoints.** HTTP requests go through OpenClaw's `withTrustedWebSearchEndpoint` (private-network egress blocked).
- **Search-key separation.** Vision and search keys are separate so users can revoke one without affecting the other.
- **Traffic tag.** Search requests carry `X-Traffic-Tag: ark_mcp_server_openclaw_bytedance`, matching the Volcengine MCP convention so traffic is attributable.

---

## Development

### Run unit tests

```bash
pnpm install
pnpm test         # vitest run, all suites
pnpm test:watch
```

Pure unit tests (no network):

- `credentials.test.ts` — env-var fallback chains for both keys (vision + search)
- `bytedance-web-search-provider.runtime.test.ts` — payload builder, time-range validation, count clamping, response parsing
- `media-understanding-provider.test.ts` — request shape (data URL, image_url block, max_tokens), error handling, model selection from cfg

The `vitest.config.ts` aliases `openclaw/plugin-sdk/*` to a local OpenClaw checkout. Set `OPENCLAW_REPO=/path/to/openclaw` to override the default `~/github/openclaw`.

### Compare against MiniMax (live API)

```bash
ARK_API_KEY=ark-... \
ARK_SEARCH_API_KEY=<harness-search-key> \
MINIMAX_CODE_PLAN_KEY=sk-cp-... \
MINIMAX_API_HOST=https://api.minimaxi.com \
QUERY="OpenClaw 是什么开源项目" \
COUNT=3 \
pnpm run compare
```

Modes:

```bash
pnpm run compare          # search + vision
pnpm run compare:search
pnpm run compare:vision   # set IMAGE_PATH=./img.png or IMAGE_URL=https://...
```

The runner hits both providers in parallel and prints latency, result count, summaries, and full descriptions.

#### Real-world result (May 2026)

| Test                     | ByteDance                                                          | MiniMax                                          |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------ |
| Search "OpenClaw"        | **315 ms**, 3 results + 3 AI summaries + SiteName + PublishTime    | 642 ms, 3 results, snippet only                  |
| Vision (32×32 red shape) | 4759 ms, 199 chars, **correctly identifies circle**                | 3631 ms, 84 chars, identifies as square          |

ByteDance Search wins on latency, summary quality, and metadata richness. MiniMax VL wins on vision latency. Doubao 2.0 Pro produces longer, more accurate vision descriptions on small images.

---

## License

MIT — see [LICENSE](./LICENSE).

## Links

- Volcengine Ark Agent Plan: <https://www.volcengine.com/activity/agentplan>
- Harness web search docs: <https://www.volcengine.com/docs/82379/2301412>
- Official MCP server (search backend reference): <https://github.com/volcengine/mcp-server>
- Image understanding docs: <https://www.volcengine.com/docs/82379/1362931>
- Doubao Seed 2.0 series: <https://www.volcengine.com/docs/82379/1330310>
