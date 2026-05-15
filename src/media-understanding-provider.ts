import type {
  ImageDescriptionRequest,
  ImageDescriptionResult,
  ImagesDescriptionInput,
  ImagesDescriptionRequest,
  ImagesDescriptionResult,
  MediaUnderstandingProvider,
} from "openclaw/plugin-sdk/media-understanding";

import {
  DEFAULT_VISION_MODEL,
  buildArkEndpoint,
  resolveArkApiKey,
  resolveArkBaseUrl,
} from "./credentials.js";

/**
 * ByteDance (Volcengine Ark) media-understanding provider.
 *
 * Default model: doubao-seed-2.0-pro
 *
 * Strategy:
 *   - Volcengine Ark exposes the OpenAI-compatible Chat Completions API at
 *     `/api/v3/chat/completions`. We send a multimodal user message with
 *     `image_url` content blocks and ask the model to describe the image(s).
 *   - Image bytes are inlined as base64 data URLs since the framework hands
 *     us a raw `Buffer` per image. (Ark also accepts http/https URLs but
 *     here we always have local bytes.)
 *
 * Credentials/baseUrl are resolved from the ByteDance plugin config or env
 * vars (ARK_API_KEY / ARK_BASE_URL); falling back to the public CN endpoint.
 */

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const DEFAULT_PROMPT = "Describe the image in detail.";
const DEFAULT_MAX_TOKENS = 1024;

type ChatMessageContentText = { type: "text"; text: string };
type ChatMessageContentImage = {
  type: "image_url";
  image_url: { url: string };
};
type ChatMessageContent = ChatMessageContentText | ChatMessageContentImage;

type ChatCompletionsRequest = {
  model: string;
  messages: Array<{
    role: "user" | "system";
    content: ChatMessageContent[];
  }>;
  max_tokens?: number;
  temperature?: number;
};

type ChatCompletionsResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | ChatMessageContent[];
    };
    finish_reason?: string;
  }>;
  error?: { message?: string; code?: string | number; type?: string };
};

function normalizeMime(mime?: string): string {
  if (typeof mime === "string") {
    const lower = mime.trim().toLowerCase();
    if (SUPPORTED_IMAGE_MIME_TYPES.has(lower)) {
      // Ark expects standard image/jpeg, image/png, etc.
      return lower === "image/jpg" ? "image/jpeg" : lower;
    }
  }
  // Fall back to jpeg for unknown/unspecified types.
  return "image/jpeg";
}

function bufferToDataUrl(buffer: Buffer, mime?: string): string {
  const normalizedMime = normalizeMime(mime);
  const base64 = buffer.toString("base64");
  return `data:${normalizedMime};base64,${base64}`;
}

function resolveCredentialsFromConfig(cfg: unknown): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} {
  if (!cfg || typeof cfg !== "object") return {};
  const config = cfg as Record<string, unknown>;
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const entries = plugins?.entries as Record<string, unknown> | undefined;
  const bytedance = entries?.bytedance as Record<string, unknown> | undefined;
  const pluginConfig = bytedance?.config as Record<string, unknown> | undefined;
  const vision = pluginConfig?.vision as Record<string, unknown> | undefined;

  if (!vision) return {};
  return {
    apiKey: typeof vision.apiKey === "string" ? vision.apiKey : undefined,
    baseUrl: typeof vision.baseUrl === "string" ? vision.baseUrl : undefined,
    model: typeof vision.model === "string" ? vision.model : undefined,
  };
}

function resolveModel(requested: string | undefined, fromConfig: string | undefined): string {
  if (typeof requested === "string" && requested.trim().length > 0 && requested !== "bytedance") {
    return requested.trim();
  }
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig.trim();
  }
  return DEFAULT_VISION_MODEL;
}

function extractTextFromChoice(resp: ChatCompletionsResponse): string {
  const choice = resp.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c && c.type === "text" && typeof c.text === "string") {
        parts.push(c.text);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

function buildErrorMessage(prefix: string, status: number, body: string): string {
  const trimmed = body.length > 500 ? `${body.slice(0, 500)}…` : body;
  return `${prefix} (HTTP ${status}): ${trimmed || "<empty body>"}`;
}

async function callArkChatCompletions(params: {
  apiKey: string;
  baseUrl: string;
  body: ChatCompletionsRequest;
  timeoutMs: number;
}): Promise<ChatCompletionsResponse> {
  const url = buildArkEndpoint(params.baseUrl, "/chat/completions");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, params.timeoutMs));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Volcengine Ark vision request timed out after ${params.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(buildErrorMessage("Volcengine Ark vision error", res.status, text));
  }

  const data = (await res.json()) as ChatCompletionsResponse;
  if (data.error?.message) {
    throw new Error(`Volcengine Ark vision error: ${data.error.message}`);
  }
  return data;
}

async function describeImage(req: ImageDescriptionRequest): Promise<ImageDescriptionResult> {
  const { apiKey: cfgKey, baseUrl: cfgBaseUrl, model: cfgModel } = resolveCredentialsFromConfig(
    req.cfg,
  );
  const apiKey = resolveArkApiKey(cfgKey);
  if (!apiKey) {
    throw new Error(
      "Volcengine Ark vision: missing ARK_API_KEY. Set the environment variable or configure plugins.entries.bytedance.config.vision.apiKey.",
    );
  }
  const baseUrl = resolveArkBaseUrl(cfgBaseUrl);
  const model = resolveModel(req.model, cfgModel);

  const dataUrl = bufferToDataUrl(req.buffer, req.mime);
  const prompt = (req.prompt && req.prompt.trim().length > 0 ? req.prompt : DEFAULT_PROMPT).trim();

  const body: ChatCompletionsRequest = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: req.maxTokens && req.maxTokens > 0 ? req.maxTokens : DEFAULT_MAX_TOKENS,
  };

  const data = await callArkChatCompletions({
    apiKey,
    baseUrl,
    body,
    timeoutMs: req.timeoutMs,
  });

  return {
    text: extractTextFromChoice(data),
    model: data.model ?? model,
  };
}

async function describeSingleImageFromBatch(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  image: ImagesDescriptionInput,
  index: number,
  total: number,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const dataUrl = bufferToDataUrl(image.buffer, image.mime);
  const indexedPrompt =
    total > 1 ? `${prompt}\n(Describe image ${index + 1} of ${total} independently.)` : prompt;

  const body: ChatCompletionsRequest = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: indexedPrompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: maxTokens,
  };

  const data = await callArkChatCompletions({ apiKey, baseUrl, body, timeoutMs });
  return extractTextFromChoice(data);
}

async function describeImages(req: ImagesDescriptionRequest): Promise<ImagesDescriptionResult> {
  const { apiKey: cfgKey, baseUrl: cfgBaseUrl, model: cfgModel } = resolveCredentialsFromConfig(
    req.cfg,
  );
  const apiKey = resolveArkApiKey(cfgKey);
  if (!apiKey) {
    throw new Error(
      "Volcengine Ark vision: missing ARK_API_KEY. Set the environment variable or configure plugins.entries.bytedance.config.vision.apiKey.",
    );
  }
  const baseUrl = resolveArkBaseUrl(cfgBaseUrl);
  const model = resolveModel(req.model, cfgModel);

  if (req.images.length === 0) {
    return { text: "", model };
  }

  const prompt = (req.prompt && req.prompt.trim().length > 0 ? req.prompt : DEFAULT_PROMPT).trim();
  const maxTokens = req.maxTokens && req.maxTokens > 0 ? req.maxTokens : DEFAULT_MAX_TOKENS;

  // Run sequentially to keep behavior predictable and to match how MiniMax's
  // VLM provider handles batches. Could be parallelized later if needed.
  const parts: string[] = [];
  for (let i = 0; i < req.images.length; i += 1) {
    const image = req.images[i];
    if (!image) continue;
    const text = await describeSingleImageFromBatch(
      apiKey,
      baseUrl,
      model,
      prompt,
      image,
      i,
      req.images.length,
      maxTokens,
      req.timeoutMs,
    );
    parts.push(req.images.length > 1 ? `Image ${i + 1}: ${text}` : text);
  }

  return {
    text: parts.join("\n\n").trim(),
    model,
  };
}

export const bytedanceMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "bytedance",
  capabilities: ["image"],
  defaultModels: { image: DEFAULT_VISION_MODEL },
  autoPriority: { image: 45 },
  describeImage,
  describeImages,
};
