import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Path to a local OpenClaw repo used to resolve `openclaw/plugin-sdk/*`
 * imports during tests. Override via OPENCLAW_REPO env var.
 *
 * If neither the env var nor the default path exists, tests that depend on
 * the OpenClaw SDK will be skipped (vitest will surface a clear resolver
 * error). Pure tests (credentials, media-understanding mocks) work without
 * the alias.
 */
const repoRoot =
  process.env.OPENCLAW_REPO?.trim() || join(homedir(), "github", "openclaw");

const sdkDir = resolve(repoRoot, "src", "plugin-sdk");
const haveSdk = existsSync(sdkDir);

const sdkAliases = haveSdk
  ? [
      // Map specific subpaths first; vitest matches in declaration order.
      {
        find: /^openclaw\/plugin-sdk\/provider-http$/,
        replacement: resolve(sdkDir, "provider-http.ts"),
      },
      {
        find: /^openclaw\/plugin-sdk\/plugin-entry$/,
        replacement: resolve(sdkDir, "plugin-entry.ts"),
      },
      {
        find: /^openclaw\/plugin-sdk\/media-understanding$/,
        replacement: resolve(sdkDir, "media-understanding.ts"),
      },
      {
        find: /^openclaw\/plugin-sdk\/provider-web-search$/,
        replacement: resolve(sdkDir, "provider-web-search.ts"),
      },
      {
        find: /^openclaw\/plugin-sdk\/provider-web-search-config-contract$/,
        replacement: resolve(sdkDir, "provider-web-search-config-contract.ts"),
      },
    ]
  : [];

if (!haveSdk) {
  // eslint-disable-next-line no-console
  console.warn(
    `[vitest.config] OpenClaw SDK not found at ${sdkDir}. ` +
      `Set OPENCLAW_REPO=/path/to/openclaw to enable SDK-dependent tests.`,
  );
}

export default defineConfig({
  resolve: {
    alias: sdkAliases,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
    hookTimeout: 10_000,
    pool: "threads",
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
