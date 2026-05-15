import { describe, expect, it } from "vitest";

import { __testing } from "./bytedance-web-search-provider.runtime.js";

const {
  resolveSearchType,
  resolveAuthLevel,
  readTimeRange,
  clampCount,
  buildPayload,
  normalizeReference,
  extractReferences,
  SEARCH_PATH,
} = __testing;

describe("bytedance web search runtime — pure helpers", () => {
  describe("constants", () => {
    it("uses askecho search path", () => {
      expect(SEARCH_PATH).toBe("/search_api/web_search");
    });
  });

  describe("resolveSearchType", () => {
    it("prefers args.searchType", () => {
      expect(resolveSearchType({ searchType: "image" }, undefined)).toBe("image");
    });
    it("accepts snake_case alias", () => {
      expect(resolveSearchType({ search_type: "image" }, undefined)).toBe("image");
    });
    it("falls back to searchConfig", () => {
      expect(resolveSearchType({}, { searchType: "image" })).toBe("image");
    });
    it("defaults to web", () => {
      expect(resolveSearchType({}, undefined)).toBe("web");
      expect(resolveSearchType({ searchType: "video" }, undefined)).toBe("web");
    });
  });

  describe("resolveAuthLevel", () => {
    it("returns 1 when explicitly set to 1", () => {
      expect(resolveAuthLevel({ authLevel: 1 })).toBe(1);
      expect(resolveAuthLevel({ auth_level: 1 })).toBe(1);
      expect(resolveAuthLevel({ authLevel: "1" })).toBe(1);
    });
    it("defaults to 0 otherwise", () => {
      expect(resolveAuthLevel({})).toBe(0);
      expect(resolveAuthLevel({ authLevel: 0 })).toBe(0);
      expect(resolveAuthLevel({ authLevel: 5 })).toBe(0);
    });
  });

  describe("readTimeRange", () => {
    it("accepts shortcut values", () => {
      for (const v of ["OneDay", "OneWeek", "OneMonth", "OneYear"]) {
        expect(readTimeRange(v)).toBe(v);
      }
    });
    it("accepts well-formed date ranges", () => {
      expect(readTimeRange("2026-01-01..2026-05-15")).toBe("2026-01-01..2026-05-15");
    });
    it("returns undefined for empty/missing", () => {
      expect(readTimeRange(undefined)).toBeUndefined();
      expect(readTimeRange("")).toBeUndefined();
      expect(readTimeRange(null)).toBeUndefined();
    });
    it("rejects malformed values", () => {
      expect(() => readTimeRange("yesterday")).toThrow(/Invalid timeRange/);
      expect(() => readTimeRange("2026/01/01..2026/05/15")).toThrow(/Invalid timeRange/);
    });
    it("rejects start > end", () => {
      expect(() => readTimeRange("2026-05-15..2026-01-01")).toThrow(
        /start date must not be after end date/,
      );
    });
  });

  describe("clampCount", () => {
    it("defaults to 5 when undefined", () => {
      expect(clampCount(undefined, "web")).toBe(5);
    });
    it("clamps to web max 50", () => {
      expect(clampCount(100, "web")).toBe(50);
    });
    it("clamps to image max 5", () => {
      expect(clampCount(20, "image")).toBe(5);
    });
    it("clamps to min 1", () => {
      expect(clampCount(0, "web")).toBe(1);
      expect(clampCount(-3, "web")).toBe(1);
    });
    it("floors fractional", () => {
      expect(clampCount(7.9, "web")).toBe(7);
    });
  });

  describe("buildPayload", () => {
    it("includes NeedSummary=true for web type", () => {
      const p = buildPayload({ Query: "x", SearchType: "web", Count: 5 });
      expect(p.NeedSummary).toBe(true);
    });
    it("omits NeedSummary for image type", () => {
      const p = buildPayload({ Query: "x", SearchType: "image", Count: 3 });
      expect(p).not.toHaveProperty("NeedSummary");
    });
    it("includes Filter only when provided (web)", () => {
      const p = buildPayload({
        Query: "x",
        SearchType: "web",
        Count: 5,
        Filter: { AuthInfoLevel: 1 },
      });
      expect(p.Filter).toEqual({ AuthInfoLevel: 1 });
    });
    it("includes TimeRange only when provided (web)", () => {
      const p = buildPayload({
        Query: "x",
        SearchType: "web",
        Count: 5,
        TimeRange: "OneWeek",
      });
      expect(p.TimeRange).toBe("OneWeek");
    });
    it("uses PascalCase field names matching Volcengine OpenAPI", () => {
      const p = buildPayload({ Query: "test", SearchType: "web", Count: 3 });
      expect(p).toEqual({
        Query: "test",
        SearchType: "web",
        Count: 3,
        NeedSummary: true,
      });
    });
  });

  describe("normalizeReference", () => {
    it("returns undefined when Url is missing", () => {
      expect(normalizeReference({ Title: "no-url" })).toBeUndefined();
    });

    it("wraps Title and Snippet with untrusted markers", () => {
      const ref = normalizeReference({
        Url: "https://example.com",
        Title: "Hello",
        Snippet: "World",
      });
      expect(ref?.title).toContain("Hello");
      expect(ref?.title).toContain("EXTERNAL_UNTRUSTED_CONTENT");
      expect(ref?.description).toContain("World");
    });

    it("includes Summary when present", () => {
      const ref = normalizeReference({
        Url: "https://example.com",
        Summary: "longer summary text",
      });
      expect(ref?.summary).toContain("longer summary text");
      expect(ref?.summary).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    });

    it("uses SiteName from response when provided", () => {
      const ref = normalizeReference({
        Url: "https://news.example.com/article",
        SiteName: "Example News",
      });
      expect(ref?.siteName).toBe("Example News");
    });

    it("derives SiteName from URL when missing", () => {
      const ref = normalizeReference({ Url: "https://news.example.com/article" });
      expect(ref?.siteName).toBeDefined();
    });

    it("preserves PublishTime as string", () => {
      const ref = normalizeReference({ Url: "https://x", PublishTime: "2026-05-01" });
      expect(ref?.published).toBe("2026-05-01");
    });
  });

  describe("extractReferences", () => {
    it("collects from Result.WebResults for web type", () => {
      const refs = extractReferences(
        {
          Result: {
            WebResults: [
              { Url: "https://a.example.com", Title: "A" },
              { Url: "https://b.example.com", Title: "B" },
            ],
          },
        },
        "web",
        10,
      );
      expect(refs).toHaveLength(2);
      expect(refs[0]?.url).toBe("https://a.example.com");
    });

    it("collects from Result.ImageResults for image type", () => {
      const refs = extractReferences(
        {
          Result: {
            ImageResults: [{ Url: "https://img.example.com/a.jpg", Title: "img" }],
          },
        },
        "image",
        10,
      );
      expect(refs).toHaveLength(1);
    });

    it("respects count cap", () => {
      const refs = extractReferences(
        {
          Result: {
            WebResults: Array.from({ length: 8 }, (_, i) => ({
              Url: `https://r${i}.example.com`,
              Title: `R${i}`,
            })),
          },
        },
        "web",
        3,
      );
      expect(refs).toHaveLength(3);
    });

    it("skips entries without Url", () => {
      const refs = extractReferences(
        {
          Result: {
            WebResults: [{ Title: "no-url" }, { Url: "https://valid", Title: "ok" }],
          },
        },
        "web",
        10,
      );
      expect(refs).toHaveLength(1);
      expect(refs[0]?.url).toBe("https://valid");
    });

    it("returns empty array when payload has nothing", () => {
      expect(extractReferences({}, "web", 10)).toEqual([]);
      expect(extractReferences({ Result: {} }, "web", 10)).toEqual([]);
    });
  });
});
