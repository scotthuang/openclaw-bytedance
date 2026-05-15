import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createByteDanceWebSearchProvider } from "./src/bytedance-web-search-provider.js";
import { setPluginLogger } from "./src/logger.js";
import { bytedanceMediaUnderstandingProvider } from "./src/media-understanding-provider.js";

export default definePluginEntry({
  id: "bytedance",
  name: "ByteDance (Volcengine Ark)",
  description:
    "OpenClaw plugin for ByteDance Volcengine Ark: web search via Responses API and image understanding via Doubao-Seed-2.0-pro.",
  register(api) {
    setPluginLogger(api.logger);
    api.logger.info(
      "[bytedance] register: installing web-search + media-understanding providers (id=bytedance)",
    );
    api.registerWebSearchProvider(createByteDanceWebSearchProvider());
    api.registerMediaUnderstandingProvider(bytedanceMediaUnderstandingProvider);
    api.logger.info(
      "[bytedance] register: providers installed (vision-default=doubao-seed-2.0-pro, search-tag=ark_mcp_server_openclaw_bytedance)",
    );
  },
});
