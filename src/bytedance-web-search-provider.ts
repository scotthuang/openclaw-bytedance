import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search-config-contract";

/**
 * ByteDance (Volcengine Ark) web-search provider.
 *
 * Backend: Volcengine "AskEcho Search Infinity" — the same search service
 * the official `mcp_server_askecho_search_infinity` MCP server wraps and
 * which Agent Plan / Harness bundles as a service plan add-on.
 *
 * Two distinct API keys are involved in this plugin overall:
 *   1. ARK_API_KEY        — for chat-completions / vision (doubao-seed-2.0-pro)
 *   2. ARK_SEARCH_API_KEY — for the search service (this provider)
 * The two are intentionally separate so users can revoke / scope them
 * independently. Either or both may be set.
 *
 * Search credential resolution order:
 *   1. plugins.entries.bytedance.config.webSearch.apiKey
 *   2. ARK_SEARCH_API_KEY
 *   3. ASK_ECHO_SEARCH_INFINITY_API_KEY  (matches the official MCP server)
 *   4. VOLCENGINE_SEARCH_API_KEY
 */

const BYTEDANCE_CREDENTIAL_PATH = "plugins.entries.bytedance.config.webSearch.apiKey";
const BYTEDANCE_SEARCH_ENV_VARS = [
  "ARK_SEARCH_API_KEY",
  "ASK_ECHO_SEARCH_INFINITY_API_KEY",
  "VOLCENGINE_SEARCH_API_KEY",
] as const;

type ByteDanceWebSearchRuntime = typeof import("./bytedance-web-search-provider.runtime.js");

let runtimePromise: Promise<ByteDanceWebSearchRuntime> | undefined;

function loadRuntime(): Promise<ByteDanceWebSearchRuntime> {
  runtimePromise ??= import("./bytedance-web-search-provider.runtime.js");
  return runtimePromise;
}

const ByteDanceSearchSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query string. 1-100 characters. Should be focused and natural-language.",
      minLength: 1,
      maxLength: 100,
    },
    count: {
      type: "number",
      description: "Number of results to return (web: 1-50, image: 1-5). Defaults to 5.",
      minimum: 1,
      maximum: 50,
    },
    searchType: {
      type: "string",
      enum: ["web", "image"],
      description: "Type of search: web pages or images. Defaults to 'web'.",
    },
    timeRange: {
      type: "string",
      description:
        "Restrict to recent results. One of: OneDay | OneWeek | OneMonth | OneYear, or a date range 'YYYY-MM-DD..YYYY-MM-DD'. Web search only.",
    },
    authLevel: {
      type: "number",
      enum: [0, 1],
      description:
        "Authority filter: 0 = default (no filter), 1 = only highly authoritative sources. Web search only.",
    },
  },
  required: ["query"],
} satisfies Record<string, unknown>;

export function createByteDanceWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "bytedance",
    label: "ByteDance Volcengine Search",
    hint: "Web search via Volcengine Ark Harness (AskEcho Search Infinity)",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Volcengine Ark Harness search API key",
    envVars: [...BYTEDANCE_SEARCH_ENV_VARS],
    placeholder: "<harness-search-key>",
    signupUrl: "https://www.volcengine.com/activity/agentplan",
    docsUrl: "https://www.volcengine.com/docs/82379/2301412",
    autoDetectOrder: 30,
    credentialPath: BYTEDANCE_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: BYTEDANCE_CREDENTIAL_PATH,
      searchCredential: { type: "top-level" },
      configuredCredential: { pluginId: "bytedance" },
    }),
    createTool: (ctx) => ({
      description:
        "Search the web (or images) using Volcengine Ark Harness. Returns titles, URLs, snippets, summaries, and publish dates.",
      parameters: ByteDanceSearchSchema,
      execute: async (args) => {
        const { executeByteDanceWebSearchProviderTool } = await loadRuntime();
        return await executeByteDanceWebSearchProviderTool(ctx, args);
      },
    }),
  };
}
