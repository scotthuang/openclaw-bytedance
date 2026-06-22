import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ARK_API_KEY_ENV_VARS,
  ARK_BASE_URL_ENV_VARS,
  ARK_SEARCH_API_KEY_ENV_VARS,
  ARK_SEARCH_BASE_URL_ENV_VARS,
  DEFAULT_ARK_BASE_URL,
  DEFAULT_ARK_SEARCH_BASE_URL,
  DEFAULT_VISION_MODEL,
  buildArkEndpoint,
  resolveArkApiKey,
  resolveArkBaseUrl,
  resolveArkSearchApiKey,
  resolveArkSearchBaseUrl,
} from "./credentials.js";

const ALL_ENV_VARS = [
  ...ARK_API_KEY_ENV_VARS,
  ...ARK_BASE_URL_ENV_VARS,
  ...ARK_SEARCH_API_KEY_ENV_VARS,
  ...ARK_SEARCH_BASE_URL_ENV_VARS,
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ALL_ENV_VARS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ALL_ENV_VARS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("credentials", () => {
  let snap: Record<string, string | undefined>;

  beforeEach(() => {
    snap = snapshotEnv();
    for (const k of ALL_ENV_VARS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(snap);
  });

  describe("vision: resolveArkApiKey", () => {
    it("returns undefined when no key is configured anywhere", () => {
      expect(resolveArkApiKey()).toBeUndefined();
    });

    it("prefers explicit string over env vars", () => {
      process.env.ARK_API_KEY = "env-key";
      expect(resolveArkApiKey("explicit-key")).toBe("explicit-key");
    });

    it("falls back through ARK_API_KEY then VOLCENGINE_API_KEY", () => {
      process.env.VOLCENGINE_API_KEY = "volc-key";
      expect(resolveArkApiKey()).toBe("volc-key");
      process.env.ARK_API_KEY = "ark-key";
      expect(resolveArkApiKey()).toBe("ark-key");
    });

    it("treats whitespace-only env values as missing", () => {
      process.env.ARK_API_KEY = "   ";
      process.env.VOLCENGINE_API_KEY = "real-key";
      expect(resolveArkApiKey()).toBe("real-key");
    });

    it("ignores non-string explicit values", () => {
      process.env.ARK_API_KEY = "env-key";
      expect(resolveArkApiKey(undefined)).toBe("env-key");
      expect(resolveArkApiKey(null)).toBe("env-key");
      expect(resolveArkApiKey(123)).toBe("env-key");
      expect(resolveArkApiKey({})).toBe("env-key");
    });
  });

  describe("vision: resolveArkBaseUrl", () => {
    it("returns Agent Plan endpoint by default", () => {
      expect(resolveArkBaseUrl()).toBe(DEFAULT_ARK_BASE_URL);
      expect(DEFAULT_ARK_BASE_URL).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
    });

    it("strips trailing slashes", () => {
      expect(resolveArkBaseUrl("https://example.com/api/v3///")).toBe(
        "https://example.com/api/v3",
      );
    });

    it("falls back through ARK_BASE_URL then VOLCENGINE_BASE_URL", () => {
      process.env.VOLCENGINE_BASE_URL = "https://volc.example.com/api/v3";
      expect(resolveArkBaseUrl()).toBe("https://volc.example.com/api/v3");
      process.env.ARK_BASE_URL = "https://ark.example.com/api/v3";
      expect(resolveArkBaseUrl()).toBe("https://ark.example.com/api/v3");
    });
  });

  describe("search: resolveArkSearchApiKey", () => {
    it("returns undefined when no env var or explicit key is configured", () => {
      expect(resolveArkSearchApiKey()).toBeUndefined();
    });

    it("prefers explicit string over env vars", () => {
      process.env.ARK_SEARCH_API_KEY = "env-key";
      expect(resolveArkSearchApiKey("explicit-key")).toBe("explicit-key");
    });

    it("falls back through the documented env-var chain", () => {
      // Lowest priority env var first
      process.env.VOLCENGINE_SEARCH_API_KEY = "volc-key";
      expect(resolveArkSearchApiKey()).toBe("volc-key");
      // Mid priority — matches official Volcengine MCP server var name
      process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY = "askecho-key";
      expect(resolveArkSearchApiKey()).toBe("askecho-key");
      // Highest priority alias
      process.env.ARK_SEARCH_API_KEY = "ark-search-key";
      expect(resolveArkSearchApiKey()).toBe("ark-search-key");
    });

    it("is independent from the chat/vision key", () => {
      process.env.ARK_API_KEY = "vision-key";
      expect(resolveArkSearchApiKey()).toBeUndefined();
    });
  });

  describe("search: resolveArkSearchBaseUrl", () => {
    it("returns AskEcho endpoint by default", () => {
      expect(resolveArkSearchBaseUrl()).toBe(DEFAULT_ARK_SEARCH_BASE_URL);
      expect(DEFAULT_ARK_SEARCH_BASE_URL).toBe("https://open.feedcoopapi.com");
    });

    it("respects ARK_SEARCH_BASE_URL env var", () => {
      process.env.ARK_SEARCH_BASE_URL = "https://search.example.com";
      expect(resolveArkSearchBaseUrl()).toBe("https://search.example.com");
    });

    it("explicit value takes priority over env", () => {
      process.env.ARK_SEARCH_BASE_URL = "https://env.example.com";
      expect(resolveArkSearchBaseUrl("https://explicit.example.com")).toBe(
        "https://explicit.example.com",
      );
    });
  });

  describe("buildArkEndpoint", () => {
    it("joins base + path", () => {
      expect(buildArkEndpoint("https://x.example.com/api/v3", "/responses")).toBe(
        "https://x.example.com/api/v3/responses",
      );
    });

    it("handles trailing slashes in base", () => {
      expect(buildArkEndpoint("https://x.example.com/api/v3//", "/chat/completions")).toBe(
        "https://x.example.com/api/v3/chat/completions",
      );
    });

    it("requires leading slash on path", () => {
      expect(() => buildArkEndpoint("https://x.example.com", "responses")).toThrow(
        /must start with '\/'/,
      );
    });
  });

  describe("constants", () => {
    it("default vision model is doubao-seed-2.0-pro", () => {
      expect(DEFAULT_VISION_MODEL).toBe("doubao-seed-2.0-pro");
    });
  });
});
