import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createByteDanceWebSearchProvider } from "./src/bytedance-web-search-provider.js";
import { setPluginLogger } from "./src/logger.js";

export default definePluginEntry({
  id: "bytedance",
  name: "ByteDance Volcengine Search",
  description:
    "OpenClaw plugin for ByteDance Volcengine Ark: web search with pre-configured API key.",
  register(api) {
    setPluginLogger(api.logger);
    api.logger.info(
      "[bytedance-search] register: installing web-search provider (id=bytedance-search)",
    );
    api.registerWebSearchProvider(createByteDanceWebSearchProvider());
    api.logger.info(
      "[bytedance-search] register: search provider installed (tag=ark_mcp_server_openclaw_bytedance)",
    );
  },
});
