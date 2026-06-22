/**
 * Shared credential / endpoint resolution for the ByteDance (Volcengine Ark) plugin.
 *
 * This plugin uses the **Volcengine Ark Agent Plan** product surface, which has
 * two independent API surfaces:
 *
 * 1. **Vision (image understanding)** — OpenAI-compatible Chat Completions:
 *      Endpoint: ${ARK_BASE_URL}/chat/completions
 *      Auth:     Authorization: Bearer ${ARK_API_KEY}
 *      Default:  https://ark.cn-beijing.volces.com/api/plan/v3
 *
 * 2. **Web search (Harness "AskEcho Search Infinity")** — separate service
 *    with its own quota and its own API key:
 *      Endpoint: ${ARK_SEARCH_BASE_URL}/search_api/web_search
 *      Auth:     Authorization: Bearer ${ARK_SEARCH_API_KEY}
 *      Default:  https://open.feedcoopapi.com
 *
 * Both keys are read at runtime from configuration or environment variables
 * — this plugin **never bundles any credentials**.
 */

// --- Vision / chat-completions ------------------------------------------

export const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3";
export const ARK_API_KEY_ENV_VARS = ["ARK_API_KEY", "VOLCENGINE_API_KEY"] as const;
export const ARK_BASE_URL_ENV_VARS = ["ARK_BASE_URL", "VOLCENGINE_BASE_URL"] as const;

// --- Web search (AskEcho Search Infinity) -------------------------------

export const DEFAULT_ARK_SEARCH_BASE_URL = "https://open.feedcoopapi.com";

export const ARK_SEARCH_API_KEY_ENV_VARS = [
  "ARK_SEARCH_API_KEY",
  // Match the variable name used by Volcengine's official MCP server, so
  // existing Harness setups can drop in without renaming.
  "ASK_ECHO_SEARCH_INFINITY_API_KEY",
  "VOLCENGINE_SEARCH_API_KEY",
] as const;
export const ARK_SEARCH_BASE_URL_ENV_VARS = ["ARK_SEARCH_BASE_URL"] as const;

// --- Defaults -----------------------------------------------------------

export const DEFAULT_VISION_MODEL = "doubao-seed-2.0-pro";

// "Traffic tag" header value used by the official Volcengine MCP server to
// identify the calling tool. We follow the same convention so search-side
// dashboards can attribute traffic to this plugin.
export const SEARCH_TRAFFIC_TAG = "ark_mcp_server_openclaw_bytedance";

// --- Helpers ------------------------------------------------------------

function readEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

// --- Public resolvers (vision/chat) -------------------------------------

/** Resolve the Ark API key from (in order): explicit override → env vars. */
export function resolveArkApiKey(explicit?: unknown): string | undefined {
  return readString(explicit) ?? readEnv(ARK_API_KEY_ENV_VARS);
}

/** Resolve the Ark Base URL with fallback to env vars and the built-in default. */
export function resolveArkBaseUrl(explicit?: unknown): string {
  return stripTrailingSlashes(
    readString(explicit) ?? readEnv(ARK_BASE_URL_ENV_VARS) ?? DEFAULT_ARK_BASE_URL,
  );
}

// --- Public resolvers (search) ------------------------------------------

/** Resolve the AskEcho Search Infinity API key. */
export function resolveArkSearchApiKey(explicit?: unknown): string | undefined {
  return readString(explicit) ?? readEnv(ARK_SEARCH_API_KEY_ENV_VARS);
}

/** Resolve the AskEcho Search Infinity base URL. */
export function resolveArkSearchBaseUrl(explicit?: unknown): string {
  return stripTrailingSlashes(
    readString(explicit) ?? readEnv(ARK_SEARCH_BASE_URL_ENV_VARS) ?? DEFAULT_ARK_SEARCH_BASE_URL,
  );
}

// --- URL builder --------------------------------------------------------

/**
 * Build a full endpoint URL for an Ark API path (e.g. `/responses`,
 * `/chat/completions`). Path must begin with a leading slash.
 */
export function buildArkEndpoint(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Ark API path must start with '/': got ${path}`);
  }
  return `${stripTrailingSlashes(baseUrl)}${path}`;
}
