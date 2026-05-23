import {
  createProviderHttpError,
  formatProviderHttpErrorMessage,
} from "openclaw/plugin-sdk/provider-http";
import {
  buildSearchCacheKey,
  formatCliCommand,
  mergeScopedSearchConfig,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readNumberParam,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
  type SearchConfigRecord,
} from "openclaw/plugin-sdk/provider-web-search";

import {
  SEARCH_TRAFFIC_TAG,
  buildArkEndpoint,
  resolveArkSearchApiKey,
  resolveArkSearchBaseUrl,
} from "./credentials.js";
import { formatErr, log } from "./logger.js";

/**
 * ByteDance (Volcengine Ark) web-search provider runtime.
 *
 * Backed by Volcengine's "AskEcho Search Infinity" service, which is the same
 * search engine the official `mcp_server_askecho_search_infinity` MCP server
 * wraps. This is the search backend bundled with Agent Plan / Harness.
 *
 *   POST https://open.feedcoopapi.com/search_api/web_search
 *   Authorization: Bearer <ARK_SEARCH_API_KEY>
 *   Content-Type: application/json
 *   X-Traffic-Tag: ark_mcp_server_<tag>
 *   { "Query": "...", "SearchType": "web", "Count": 10, "NeedSummary": true,
 *     "TimeRange": "OneDay|OneWeek|OneMonth|OneYear|YYYY-MM-DD..YYYY-MM-DD",
 *     "Filter": { "AuthInfoLevel": 0|1 } }
 *
 * Note: Search requires its **own** API key, separate from the chat key:
 *   - Vision/chat key  → ARK_API_KEY  → Authorization for /api/plan/v3/*
 *   - Search       key → ARK_SEARCH_API_KEY (alias: ASK_ECHO_SEARCH_INFINITY_API_KEY)
 */

const SEARCH_PATH = "/search_api/web_search";

const TIME_RANGE_SHORTCUTS = new Set([
  "OneDay",
  "OneWeek",
  "OneMonth",
  "OneYear",
] as const);
const DATE_RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

const MAX_QUERY_LENGTH = 100;
const MAX_WEB_COUNT = 50;
const DEFAULT_COUNT = 5;

type SearchType = "web" | "image";

type AskEchoWebSearchRequest = {
  Query: string;
  SearchType: SearchType;
  Count: number;
  NeedSummary?: boolean;
  TimeRange?: string;
  Filter?: { AuthInfoLevel?: number };
};

type AskEchoSearchResult = {
  Id?: string;
  SortId?: number;
  Title?: string;
  Snippet?: string;
  SiteName?: string;
  Url?: string;
  Summary?: string;
  Content?: string;
  PublishTime?: string;
  LogoUrl?: string;
  RankScore?: number;
};

type AskEchoSearchResponse = {
  ResponseMetadata?: { RequestId?: string };
  Result?: {
    ResultCount?: number;
    WebResults?: AskEchoSearchResult[];
    ImageResults?: AskEchoSearchResult[];
  };
  // The API may also return error envelopes; we surface them defensively.
  error?: { message?: string; code?: string | number; type?: string };
};

type ExtractedReference = {
  title: string;
  url: string;
  description: string;
  summary?: string;
  published?: string;
  siteName?: string;
};

function readSearchType(value: unknown): SearchType | undefined {
  if (value === "web" || value === "image") return value;
  return undefined;
}

function truncate(text: string, max: number): string {
  if (typeof text !== "string") return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function resolveSearchType(
  args: Record<string, unknown>,
  searchConfig: SearchConfigRecord | undefined,
): SearchType {
  return (
    readSearchType(args.searchType) ??
    readSearchType(args.search_type) ??
    readSearchType(searchConfig?.searchType) ??
    "web"
  );
}

function resolveAuthLevel(args: Record<string, unknown>): 0 | 1 {
  const v = args.authLevel ?? args.auth_level;
  if (v === 1 || v === "1") return 1;
  return 0;
}

function readTimeRange(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (TIME_RANGE_SHORTCUTS.has(trimmed as never)) return trimmed;
  const match = DATE_RANGE_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid timeRange '${trimmed}'. Use OneDay/OneWeek/OneMonth/OneYear or YYYY-MM-DD..YYYY-MM-DD.`,
    );
  }
  const start = new Date(match[1]!);
  const end = new Date(match[2]!);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid date in timeRange '${trimmed}'.`);
  }
  if (start > end) {
    throw new Error(`timeRange start date must not be after end date.`);
  }
  return trimmed;
}

function clampCount(count: number | undefined, searchType: SearchType): number {
  const raw = typeof count === "number" && Number.isFinite(count) ? Math.floor(count) : DEFAULT_COUNT;
  const max = searchType === "web" ? MAX_WEB_COUNT : 5;
  if (raw < 1) return 1;
  if (raw > max) return max;
  return raw;
}

function buildPayload(req: AskEchoWebSearchRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Query: req.Query,
    SearchType: req.SearchType,
    Count: req.Count,
  };
  if (req.SearchType === "web") {
    payload.NeedSummary = true;
    if (req.Filter) payload.Filter = req.Filter;
    if (req.TimeRange) payload.TimeRange = req.TimeRange;
  }
  return payload;
}

function normalizeReference(raw: AskEchoSearchResult): ExtractedReference | undefined {
  const url = typeof raw.Url === "string" && raw.Url.length > 0 ? raw.Url : undefined;
  if (!url) return undefined;
  const title = typeof raw.Title === "string" ? raw.Title : "";
  // Snippet is short; Summary is the longer model-generated abstract.
  const description = typeof raw.Snippet === "string" ? raw.Snippet : "";
  const summary =
    typeof raw.Summary === "string" && raw.Summary.length > 0 ? raw.Summary : undefined;
  return {
    title: title ? wrapWebContent(title, "web_search") : "",
    url,
    description: description ? wrapWebContent(description, "web_search") : "",
    summary: summary ? wrapWebContent(summary, "web_search") : undefined,
    published: typeof raw.PublishTime === "string" ? raw.PublishTime : undefined,
    siteName:
      (typeof raw.SiteName === "string" && raw.SiteName.length > 0
        ? raw.SiteName
        : resolveSiteName(url)) || undefined,
  };
}

function extractReferences(
  payload: AskEchoSearchResponse,
  searchType: SearchType,
  count: number,
): ExtractedReference[] {
  const list =
    searchType === "image" ? payload.Result?.ImageResults : payload.Result?.WebResults;
  if (!Array.isArray(list)) return [];
  const out: ExtractedReference[] = [];
  for (const raw of list) {
    const ref = normalizeReference(raw);
    if (ref) out.push(ref);
    if (out.length >= count) break;
  }
  return out;
}

async function runAskEchoSearch(params: {
  apiKey: string;
  baseUrl: string;
  body: AskEchoWebSearchRequest;
  timeoutSeconds: number;
}): Promise<AskEchoSearchResponse> {
  const endpoint = buildArkEndpoint(params.baseUrl, SEARCH_PATH);
  log.debug(
    `web_search: POST ${endpoint} type=${params.body.SearchType} count=${params.body.Count} ` +
      `timeRange=${params.body.TimeRange ?? "-"} authLevel=${params.body.Filter?.AuthInfoLevel ?? 0} ` +
      `query="${truncate(params.body.Query, 80)}" timeoutSec=${params.timeoutSeconds}`,
  );

  const startedAt = Date.now();
  return withTrustedWebSearchEndpoint(
    {
      url: endpoint,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Traffic-Tag": SEARCH_TRAFFIC_TAG,
        },
        body: JSON.stringify(buildPayload(params.body)),
      },
    },
    async (res: any) => {
      const elapsed = Date.now() - startedAt;
      if (!res.ok) {
        log.warn(
          `web_search: HTTP ${res.status} from ${endpoint} after ${elapsed}ms ` +
            `(query="${truncate(params.body.Query, 60)}")`,
        );
        throw await createProviderHttpError(res, "Volcengine Ark Web Search error");
      }
      let data: AskEchoSearchResponse;
      try {
        // Use the standard fetch Response#json() so we don't depend on a
        // specific openclaw/plugin-sdk/provider-http export (which has been
        // unstable across versions). The malformed-JSON fallback message is
        // preserved for parity with provider-http error formatting.
        data = (await res.json()) as AskEchoSearchResponse;
      } catch (err) {
        log.error(
          `web_search: malformed JSON from ${endpoint} after ${elapsed}ms: ${formatErr(err)}`,
        );
        throw new Error(
          `Volcengine Ark Web Search error: malformed JSON response (${formatErr(err)})`,
          { cause: err instanceof Error ? err : undefined },
        );
      }
      if (data.error?.message) {
        log.warn(
          `web_search: provider returned error envelope (code=${data.error.code ?? "?"}, ` +
            `type=${data.error.type ?? "?"}): ${truncate(data.error.message, 200)}`,
        );
        throw new Error(
          formatProviderHttpErrorMessage({
            label: "Volcengine Ark Web Search error",
            status: typeof data.error.code === "number" ? data.error.code : 0,
            detail: data.error.message,
          }),
        );
      }
      const resultsLen = Array.isArray(
        params.body.SearchType === "image" ? data.Result?.ImageResults : data.Result?.WebResults,
      )
        ? (params.body.SearchType === "image"
            ? data.Result!.ImageResults!.length
            : data.Result!.WebResults!.length)
        : 0;
      log.debug(
        `web_search: HTTP 200 in ${elapsed}ms requestId=${data.ResponseMetadata?.RequestId ?? "-"} ` +
          `rawResults=${resultsLen}`,
      );
      return data;
    },
  );
}

function missingApiKeyPayload(): Record<string, unknown> {
  return {
    error: "missing_ark_search_api_key",
    message:
      `web_search (bytedance) needs a Volcengine Ark Harness search key. ` +
      `Set ARK_SEARCH_API_KEY (or ASK_ECHO_SEARCH_INFINITY_API_KEY) in the environment, ` +
      `or run \`${formatCliCommand("openclaw configure --section web")}\` to store it. ` +
      `Get a key from the Volcengine console (Agent Plan → 使用配置 → 配置 Harness → 联网 API Key).`,
    docs: "https://www.volcengine.com/docs/82379/2301412",
  };
}

export async function executeByteDanceWebSearchProviderTool(
  ctx: { config?: Record<string, unknown>; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const invokeStartedAt = Date.now();
  const searchConfig = mergeScopedSearchConfig(
    ctx.searchConfig,
    "bytedance",
    resolveProviderWebSearchPluginConfig(ctx.config, "bytedance"),
    { mirrorApiKeyToTopLevel: true },
  ) as SearchConfigRecord | undefined;

  const explicitApiKey = readConfiguredSecretString(
    searchConfig?.apiKey,
    "tools.web.search.apiKey",
  );
  const apiKey = resolveArkSearchApiKey(explicitApiKey);
  if (!apiKey) {
    log.warn(
      "web_search: missing ARK_SEARCH_API_KEY (and no plugins.entries.bytedance.config.webSearch.apiKey); " +
        "returning structured missing_ark_search_api_key payload",
    );
    return missingApiKeyPayload();
  }

  const baseUrl = resolveArkSearchBaseUrl(searchConfig?.baseUrl);

  // Validate query
  const queryRaw = readStringParam(args, "query", { required: true });
  const query = queryRaw!.trim();
  if (query.length === 0) {
    log.warn("web_search: rejected empty query");
    throw new Error("query must not be empty");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    log.warn(
      `web_search: rejected oversize query (len=${query.length}, max=${MAX_QUERY_LENGTH})`,
    );
    throw new Error(`query length must be 1-${MAX_QUERY_LENGTH} characters`);
  }

  const searchType = resolveSearchType(args, searchConfig);
  const requestedCount = readNumberParam(args, "count", { integer: true });
  const count = clampCount(requestedCount ?? searchConfig?.maxResults, searchType);
  let timeRange: string | undefined;
  try {
    timeRange =
      readTimeRange(args.timeRange) ??
      readTimeRange(args.time_range) ??
      readTimeRange(searchConfig?.timeRange);
  } catch (err) {
    log.warn(`web_search: invalid timeRange parameter: ${formatErr(err)}`);
    throw err;
  }
  const authLevel = resolveAuthLevel(args);
  const filter = authLevel > 0 ? { AuthInfoLevel: authLevel } : undefined;

  log.debug(
    `web_search: invoke type=${searchType} count=${count} requested=${requestedCount ?? "-"} ` +
      `timeRange=${timeRange ?? "-"} authLevel=${authLevel} baseUrl=${baseUrl} ` +
      `query="${truncate(query, 80)}"`,
  );

  const cacheKey = buildSearchCacheKey([
    "bytedance",
    baseUrl,
    searchType,
    query,
    count,
    timeRange ?? "",
    authLevel,
  ]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) {
    log.debug(
      `web_search: cache hit (key=${cacheKey.slice(0, 16)}…) skipping HTTP for query="${truncate(query, 60)}"`,
    );
    return cached;
  }

  const start = Date.now();
  const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
  const cacheTtlMs = resolveSearchCacheTtlMs(searchConfig);

  let data: AskEchoSearchResponse;
  try {
    data = await runAskEchoSearch({
      apiKey,
      baseUrl,
      body: {
        Query: query,
        SearchType: searchType,
        Count: count,
        NeedSummary: searchType === "web" ? true : undefined,
        TimeRange: timeRange,
        Filter: filter,
      },
      timeoutSeconds,
    });
  } catch (err) {
    log.error(
      `web_search: request failed after ${Date.now() - start}ms ` +
        `(query="${truncate(query, 60)}"): ${formatErr(err)}`,
    );
    throw err;
  }

  const references = extractReferences(data, searchType, count);

  const tookMs = Date.now() - start;
  const payload: Record<string, unknown> = {
    query,
    provider: "bytedance",
    searchType,
    count: references.length,
    tookMs,
    requestId: data.ResponseMetadata?.RequestId,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "bytedance",
      wrapped: true,
    },
    results: references,
  };
  if (timeRange) payload.timeRange = timeRange;

  writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
  log.info(
    `web_search: ok type=${searchType} returned=${references.length}/${count} ` +
      `tookMs=${tookMs} totalMs=${Date.now() - invokeStartedAt} ` +
      `requestId=${data.ResponseMetadata?.RequestId ?? "-"} ` +
      `query="${truncate(query, 60)}"`,
  );
  return payload;
}

export const __testing = {
  resolveSearchType,
  resolveAuthLevel,
  readTimeRange,
  clampCount,
  buildPayload,
  normalizeReference,
  extractReferences,
  SEARCH_PATH,
};
