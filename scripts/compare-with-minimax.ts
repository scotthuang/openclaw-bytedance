/**
 * Side-by-side comparison: ByteDance (Volcengine Ark) vs MiniMax
 *
 * Web search: ByteDance uses AskEcho Search Infinity (POST /search_api/web_search
 * on https://open.feedcoopapi.com), the same backend the official Volcengine
 * MCP server wraps. MiniMax uses POST /v1/coding_plan/search.
 *
 * Vision: ByteDance uses Agent Plan chat completions
 * (POST /api/plan/v3/chat/completions) with doubao-seed-2.0-pro. MiniMax uses
 * POST /v1/coding_plan/vlm with MiniMax-VL-01.
 *
 * Usage:
 *   ARK_API_KEY=ark-...                    \
 *   ARK_SEARCH_API_KEY=<harness-search-key> \
 *   MINIMAX_CODE_PLAN_KEY=sk-cp-...        \
 *   MINIMAX_API_HOST=https://api.minimaxi.com \
 *   pnpm run compare
 *
 *   pnpm run compare:search
 *   pnpm run compare:vision
 *
 * Optional env vars:
 *   QUERY              search query (default: about OpenClaw)
 *   COUNT              number of search results (default 5)
 *   IMAGE_PATH         local image; bytes are sent inline as base64
 *   IMAGE_URL          remote image URL (used when IMAGE_PATH is not set)
 *   IMAGE_PROMPT       vision prompt
 *   ARK_BASE_URL       override Agent Plan base URL
 *   ARK_SEARCH_BASE_URL override AskEcho base URL
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  DEFAULT_VISION_MODEL,
  SEARCH_TRAFFIC_TAG,
  buildArkEndpoint,
  resolveArkApiKey,
  resolveArkBaseUrl,
  resolveArkSearchApiKey,
  resolveArkSearchBaseUrl,
} from "../src/credentials.js";

// ---------- CLI parsing -------------------------------------------------

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const runSearch = !onlyArg || onlyArg === "search";
const runVision = !onlyArg || onlyArg === "vision";

const QUERY = process.env.QUERY?.trim() || "What is OpenClaw and what does it do?";
const IMAGE_PROMPT =
  process.env.IMAGE_PROMPT?.trim() ||
  "Describe this image in detail. What objects, colors, and scene do you see?";
const COUNT = Number.parseInt(process.env.COUNT ?? "5", 10) || 5;

const DEFAULT_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/640px-PNG_transparency_demonstration_1.png";
const IMAGE_URL = process.env.IMAGE_URL?.trim() || DEFAULT_IMAGE_URL;
const IMAGE_PATH = process.env.IMAGE_PATH?.trim();

// ---------- Helpers -----------------------------------------------------

function ms(start: number): number {
  return Math.round(performance.now() - start);
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function header(label: string): void {
  console.log("");
  console.log(bold(`═══ ${label} ${"═".repeat(Math.max(0, 70 - label.length))}`));
}

function subheader(label: string): void {
  console.log(bold(`\n── ${label}`));
}

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function loadImageAsDataUrl(): Promise<{ dataUrl: string; bytes: number; source: string }> {
  if (IMAGE_PATH) {
    const abs = resolve(process.cwd(), IMAGE_PATH);
    const buf = readFileSync(abs);
    return {
      dataUrl: `data:${mimeFromPath(abs)};base64,${buf.toString("base64")}`,
      bytes: buf.byteLength,
      source: `file:${abs}`,
    };
  }
  const res = await fetch(IMAGE_URL);
  if (!res.ok) throw new Error(`download IMAGE_URL ${IMAGE_URL}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = (res.headers.get("content-type") || "image/png").split(";")[0]!.trim() || "image/png";
  return {
    dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
    bytes: buf.byteLength,
    source: IMAGE_URL,
  };
}

type SearchOutcome = {
  ok: boolean;
  provider: string;
  durationMs: number;
  error?: string;
  count?: number;
  requestId?: string;
  results?: Array<{
    title: string;
    url: string;
    description?: string;
    summary?: string;
    published?: string;
    siteName?: string;
  }>;
};

type VisionOutcome = {
  ok: boolean;
  provider: string;
  model: string;
  durationMs: number;
  error?: string;
  text?: string;
};

// ---------- ByteDance: Web search via AskEcho ---------------------------

async function searchByteDance(): Promise<SearchOutcome> {
  const provider = "bytedance";
  const start = performance.now();
  try {
    const apiKey = resolveArkSearchApiKey();
    if (!apiKey) {
      return {
        ok: false,
        provider,
        durationMs: ms(start),
        error: "Missing ARK_SEARCH_API_KEY (or ASK_ECHO_SEARCH_INFINITY_API_KEY)",
      };
    }
    const endpoint = buildArkEndpoint(resolveArkSearchBaseUrl(), "/search_api/web_search");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Traffic-Tag": SEARCH_TRAFFIC_TAG,
      },
      body: JSON.stringify({
        Query: QUERY.slice(0, 100), // service caps queries at 100 chars
        SearchType: "web",
        Count: COUNT,
        NeedSummary: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider,
        durationMs: ms(start),
        error: `HTTP ${res.status}: ${truncate(text, 300)}`,
      };
    }
    const data = (await res.json()) as {
      ResponseMetadata?: { RequestId?: string };
      Result?: {
        WebResults?: Array<{
          Title?: string;
          Url?: string;
          Snippet?: string;
          Summary?: string;
          PublishTime?: string;
          SiteName?: string;
        }>;
      };
    };
    const list = data.Result?.WebResults ?? [];
    return {
      ok: true,
      provider,
      durationMs: ms(start),
      count: list.length,
      requestId: data.ResponseMetadata?.RequestId,
      results: list.slice(0, COUNT).map((r) => ({
        title: r.Title ?? "",
        url: r.Url ?? "",
        description: r.Snippet,
        summary: r.Summary,
        published: r.PublishTime,
        siteName: r.SiteName,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      durationMs: ms(start),
      error: (err as Error).message,
    };
  }
}

// ---------- MiniMax: Web search via /v1/coding_plan/search --------------

function resolveMiniMaxApiKey(): string | undefined {
  const cands = [
    process.env.MINIMAX_CODE_PLAN_KEY,
    process.env.MINIMAX_CODING_API_KEY,
    process.env.MINIMAX_OAUTH_TOKEN,
    process.env.MINIMAX_API_KEY,
  ];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c.trim();
  return undefined;
}

function resolveMiniMaxBase(): string {
  const host = process.env.MINIMAX_API_HOST?.trim() ?? "";
  if (host && host.includes("minimaxi.com")) return "https://api.minimaxi.com";
  return "https://api.minimax.io";
}

async function searchMiniMax(): Promise<SearchOutcome> {
  const provider = "minimax";
  const start = performance.now();
  try {
    const apiKey = resolveMiniMaxApiKey();
    if (!apiKey) {
      return {
        ok: false,
        provider,
        durationMs: ms(start),
        error: "Missing MINIMAX_API_KEY / MINIMAX_CODE_PLAN_KEY",
      };
    }
    const res = await fetch(`${resolveMiniMaxBase()}/v1/coding_plan/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "MM-API-Source": "OpenClaw-Compare",
      },
      body: JSON.stringify({ q: QUERY }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider,
        durationMs: ms(start),
        error: `HTTP ${res.status}: ${truncate(text, 300)}`,
      };
    }
    const data = (await res.json()) as {
      organic?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
      }>;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return {
        ok: false,
        provider,
        durationMs: ms(start),
        error: `${data.base_resp.status_code}: ${data.base_resp.status_msg ?? "unknown"}`,
      };
    }
    const list = (data.organic ?? []).slice(0, COUNT);
    return {
      ok: true,
      provider,
      durationMs: ms(start),
      count: list.length,
      results: list.map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        description: r.snippet,
        published: r.date,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      durationMs: ms(start),
      error: (err as Error).message,
    };
  }
}

// ---------- ByteDance: Vision via Agent Plan chat completions -----------

async function visionByteDance(dataUrl: string): Promise<VisionOutcome> {
  const provider = "bytedance";
  const model = DEFAULT_VISION_MODEL;
  const start = performance.now();
  try {
    const apiKey = resolveArkApiKey();
    if (!apiKey) {
      return {
        ok: false,
        provider,
        model,
        durationMs: ms(start),
        error: "Missing ARK_API_KEY",
      };
    }
    const endpoint = buildArkEndpoint(resolveArkBaseUrl(), "/chat/completions");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: IMAGE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider,
        model,
        durationMs: ms(start),
        error: `HTTP ${res.status}: ${truncate(text, 300)}`,
      };
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("\n");
    }
    return {
      ok: true,
      provider,
      model: data.model ?? model,
      durationMs: ms(start),
      text,
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model,
      durationMs: ms(start),
      error: (err as Error).message,
    };
  }
}

// ---------- MiniMax: Vision via /v1/coding_plan/vlm ---------------------

async function visionMiniMax(dataUrl: string): Promise<VisionOutcome> {
  const provider = "minimax";
  const model = "MiniMax-VL-01";
  const start = performance.now();
  try {
    const apiKey = resolveMiniMaxApiKey();
    if (!apiKey) {
      return {
        ok: false,
        provider,
        model,
        durationMs: ms(start),
        error: "Missing MINIMAX_API_KEY",
      };
    }
    const res = await fetch(`${resolveMiniMaxBase()}/v1/coding_plan/vlm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "MM-API-Source": "OpenClaw-Compare",
      },
      body: JSON.stringify({ prompt: IMAGE_PROMPT, image_url: dataUrl }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider,
        model,
        durationMs: ms(start),
        error: `HTTP ${res.status}: ${truncate(text, 300)}`,
      };
    }
    const data = (await res.json()) as {
      content?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return {
        ok: false,
        provider,
        model,
        durationMs: ms(start),
        error: `${data.base_resp.status_code}: ${data.base_resp.status_msg ?? "unknown"}`,
      };
    }
    return {
      ok: true,
      provider,
      model,
      durationMs: ms(start),
      text: data.content ?? "",
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model,
      durationMs: ms(start),
      error: (err as Error).message,
    };
  }
}

// ---------- Reporting ---------------------------------------------------

function reportSearch(byteDance: SearchOutcome, miniMax: SearchOutcome): void {
  header("WEB SEARCH COMPARISON");
  console.log(`Query: ${bold(QUERY)}`);
  console.log(`Requested count: ${COUNT}`);

  subheader("ByteDance (Volcengine Ark Harness — AskEcho Search Infinity)");
  if (!byteDance.ok) {
    console.log(red(`  ✗ ${byteDance.error}`));
  } else {
    console.log(`  Time: ${byteDance.durationMs}ms`);
    console.log(`  Results: ${byteDance.count}`);
    if (byteDance.requestId) console.log(dim(`  RequestId: ${byteDance.requestId}`));
    byteDance.results?.forEach((r, i) => {
      console.log(`    ${i + 1}. ${r.title || dim("(no title)")}`);
      console.log(`       ${dim(r.url)}`);
      if (r.siteName) console.log(`       ${dim(`Site: ${r.siteName}`)}`);
      if (r.published) console.log(`       ${dim(`Date: ${r.published}`)}`);
      if (r.description) console.log(`       Snippet: ${truncate(r.description, 180)}`);
      if (r.summary) console.log(`       ${green("Summary")}: ${truncate(r.summary, 240)}`);
    });
  }

  subheader("MiniMax (search via /coding_plan/search)");
  if (!miniMax.ok) {
    console.log(red(`  ✗ ${miniMax.error}`));
  } else {
    console.log(`  Time: ${miniMax.durationMs}ms`);
    console.log(`  Results: ${miniMax.count}`);
    miniMax.results?.forEach((r, i) => {
      console.log(`    ${i + 1}. ${r.title || dim("(no title)")}`);
      console.log(`       ${dim(r.url)}`);
      if (r.published) console.log(`       ${dim(`Date: ${r.published}`)}`);
      if (r.description) console.log(`       Snippet: ${truncate(r.description, 180)}`);
    });
  }

  subheader("Summary");
  console.log(
    `  Latency:      ByteDance ${byteDance.durationMs}ms  vs  MiniMax ${miniMax.durationMs}ms`,
  );
  console.log(
    `  Result count: ByteDance ${byteDance.count ?? "—"}    vs  MiniMax ${miniMax.count ?? "—"}`,
  );
  const bdSummaries = byteDance.results?.filter((r) => r.summary && r.summary.length > 0).length ?? 0;
  console.log(
    `  Summaries:    ByteDance ${bdSummaries > 0 ? green(String(bdSummaries)) : red("0")}     vs  MiniMax ${red("0")} ${dim("(snippet-only API)")}`,
  );
}

function reportVision(byteDance: VisionOutcome, miniMax: VisionOutcome, source: string): void {
  header("IMAGE UNDERSTANDING COMPARISON");
  console.log(`Image source: ${source}`);
  console.log(`Prompt: ${bold(IMAGE_PROMPT)}`);

  subheader(`ByteDance (model=${byteDance.model})`);
  if (!byteDance.ok) {
    console.log(red(`  ✗ ${byteDance.error}`));
  } else {
    console.log(`  Time: ${byteDance.durationMs}ms`);
    console.log(`  Length: ${byteDance.text?.length ?? 0} chars`);
    console.log(dim("  ─── Description ───"));
    console.log(dim(`  ${(byteDance.text ?? "").replace(/\n/g, "\n  ")}`));
  }

  subheader(`MiniMax (model=${miniMax.model})`);
  if (!miniMax.ok) {
    console.log(red(`  ✗ ${miniMax.error}`));
  } else {
    console.log(`  Time: ${miniMax.durationMs}ms`);
    console.log(`  Length: ${miniMax.text?.length ?? 0} chars`);
    console.log(dim("  ─── Description ───"));
    console.log(dim(`  ${(miniMax.text ?? "").replace(/\n/g, "\n  ")}`));
  }

  subheader("Summary");
  console.log(
    `  Latency:       ByteDance ${byteDance.durationMs}ms vs MiniMax ${miniMax.durationMs}ms`,
  );
  console.log(
    `  Output length: ByteDance ${byteDance.text?.length ?? 0} vs MiniMax ${miniMax.text?.length ?? 0}`,
  );
}

// ---------- Entry point -------------------------------------------------

async function main(): Promise<void> {
  console.log(bold("OpenClaw — ByteDance vs MiniMax comparison"));
  console.log(`Modes: ${runSearch ? "search " : ""}${runVision ? "vision" : ""}`);

  if (runSearch) {
    const [bd, mm] = await Promise.all([searchByteDance(), searchMiniMax()]);
    reportSearch(bd, mm);
  }

  if (runVision) {
    let imageInfo: { dataUrl: string; bytes: number; source: string };
    try {
      imageInfo = await loadImageAsDataUrl();
      console.log(`\n${dim(`Loaded image: ${imageInfo.bytes} bytes from ${imageInfo.source}`)}`);
    } catch (err) {
      console.log(red(`\nFailed to load image: ${(err as Error).message}`));
      console.log(yellow("Vision comparison skipped."));
      return;
    }
    const [bd, mm] = await Promise.all([
      visionByteDance(imageInfo.dataUrl),
      visionMiniMax(imageInfo.dataUrl),
    ]);
    reportVision(bd, mm, imageInfo.source);
  }
}

main().catch((err) => {
  console.error(red(`\nFatal error: ${(err as Error).message}`));
  console.error((err as Error).stack);
  process.exit(1);
});
