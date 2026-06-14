import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { setPluginLogger } from "./src/logger.js";
import { bytedanceMediaUnderstandingProvider } from "./src/media-understanding-provider.js";

export default definePluginEntry({
  id: "bytedance",
  name: "ByteDance (Volcengine Ark)",
  description:
    "OpenClaw plugin for ByteDance Volcengine Ark: image understanding via Doubao-Seed-2.0-pro.",
  register(api) {
    setPluginLogger(api.logger);
    api.logger.info(
      "[bytedance] register: installing media-understanding provider (id=bytedance)",
    );
    api.registerMediaUnderstandingProvider(bytedanceMediaUnderstandingProvider);
    api.logger.info(
      "[bytedance] register: vision provider installed (default=doubao-seed-2.0-pro)",
    );
  },
});
