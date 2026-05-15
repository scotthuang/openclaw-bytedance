import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createByteDanceWebSearchProvider } from "./src/bytedance-web-search-provider.js";
import { bytedanceMediaUnderstandingProvider } from "./src/media-understanding-provider.js";

export default definePluginEntry({
  id: "bytedance",
  name: "ByteDance (Volcengine Ark)",
  description:
    "OpenClaw plugin for ByteDance Volcengine Ark: web search via Responses API and image understanding via Doubao-Seed-2.0-pro.",
  register(api) {
    api.registerWebSearchProvider(createByteDanceWebSearchProvider());
    api.registerMediaUnderstandingProvider(bytedanceMediaUnderstandingProvider);
  },
});
