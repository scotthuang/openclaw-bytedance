import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytedanceMediaUnderstandingProvider } from "./media-understanding-provider.js";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function mockFetchOnce(payload: unknown, status = 200): {
  fetchSpy: ReturnType<typeof vi.fn>;
  capturedCalls: FetchCall[];
} {
  const capturedCalls: FetchCall[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedCalls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { fetchSpy, capturedCalls };
}

function buildChatCompletionsResponse(text: string, model = "doubao-seed-2.0-pro") {
  return {
    id: "chatcmpl-fake",
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

const PNG_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic bytes

const ENV_KEYS = ["ARK_API_KEY", "VOLCENGINE_API_KEY", "ARK_BASE_URL", "VOLCENGINE_BASE_URL"];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("bytedanceMediaUnderstandingProvider", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("declares the expected static contract", () => {
    expect(bytedanceMediaUnderstandingProvider.id).toBe("bytedance");
    expect(bytedanceMediaUnderstandingProvider.capabilities).toEqual(["image"]);
    expect(bytedanceMediaUnderstandingProvider.defaultModels?.image).toBe("doubao-seed-2.0-pro");
    expect(bytedanceMediaUnderstandingProvider.autoPriority?.image).toBe(45);
    expect(typeof bytedanceMediaUnderstandingProvider.describeImage).toBe("function");
    expect(typeof bytedanceMediaUnderstandingProvider.describeImages).toBe("function");
  });

  describe("describeImage", () => {
    it("throws a clear error when no API key is configured", async () => {
      await expect(
        bytedanceMediaUnderstandingProvider.describeImage!({
          buffer: PNG_BUFFER,
          fileName: "test.png",
          mime: "image/png",
          timeoutMs: 5_000,
          agentDir: "/tmp",
          cfg: {} as never,
          model: "bytedance",
          provider: "bytedance",
        }),
      ).rejects.toThrow(/missing ARK_API_KEY/i);
    });

    it("uses ARK_API_KEY env var as fallback", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { fetchSpy, capturedCalls } = mockFetchOnce(
        buildChatCompletionsResponse("A red panda playing."),
      );

      const result = await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      expect(result.text).toBe("A red panda playing.");
      expect(result.model).toBe("doubao-seed-2.0-pro");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const call = capturedCalls[0]!;
      expect(call.url).toBe("https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions");
      expect((call.init.headers as Record<string, string>).Authorization).toBe(
        "Bearer ark-env-key",
      );
    });

    it("sends a base64 data URL in image_url block", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      const body = JSON.parse(capturedCalls[0]!.init.body as string) as {
        model: string;
        messages: Array<{
          role: string;
          content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
        }>;
      };
      expect(body.model).toBe("doubao-seed-2.0-pro");
      const imgBlock = body.messages[0]!.content.find((c) => c.type === "image_url");
      expect(imgBlock?.image_url?.url).toMatch(/^data:image\/png;base64,/);
      const expectedBase64 = PNG_BUFFER.toString("base64");
      expect(imgBlock?.image_url?.url).toBe(`data:image/png;base64,${expectedBase64}`);
    });

    it("honors custom prompt and maxTokens", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        prompt: "Tell me what brand the logo is.",
        maxTokens: 256,
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      const body = JSON.parse(capturedCalls[0]!.init.body as string) as {
        max_tokens: number;
        messages: Array<{ content: Array<{ type: string; text?: string }> }>;
      };
      expect(body.max_tokens).toBe(256);
      const textBlock = body.messages[0]!.content.find((c) => c.type === "text");
      expect(textBlock?.text).toContain("brand");
    });

    it("uses model from cfg.plugins.entries.bytedance.config.vision.model when 'bytedance' provider id is given", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {
          plugins: {
            entries: {
              bytedance: { config: { vision: { model: "doubao-vision-custom" } } },
            },
          },
        } as never,
        model: "bytedance", // sentinel — should be overridden by cfg
        provider: "bytedance",
      });

      const body = JSON.parse(capturedCalls[0]!.init.body as string) as { model: string };
      expect(body.model).toBe("doubao-vision-custom");
    });

    it("respects an explicitly requested model over the default", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "doubao-seed-1-6-251015", // explicit non-sentinel
        provider: "bytedance",
      });

      const body = JSON.parse(capturedCalls[0]!.init.body as string) as { model: string };
      expect(body.model).toBe("doubao-seed-1-6-251015");
    });

    it("uses ARK_BASE_URL when provided", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      process.env.ARK_BASE_URL = "https://custom.example.com/api/v3";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      expect(capturedCalls[0]!.url).toBe("https://custom.example.com/api/v3/chat/completions");
    });

    it("normalizes image/jpg to image/jpeg", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const { capturedCalls } = mockFetchOnce(buildChatCompletionsResponse("ok"));

      await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.jpg",
        mime: "image/jpg",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      const body = JSON.parse(capturedCalls[0]!.init.body as string) as {
        messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
      };
      const imgBlock = body.messages[0]!.content.find((c) => c.type === "image_url");
      expect(imgBlock?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("throws an informative error on non-2xx responses", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("rate limited", { status: 429 })),
      );

      await expect(
        bytedanceMediaUnderstandingProvider.describeImage!({
          buffer: PNG_BUFFER,
          fileName: "test.png",
          mime: "image/png",
          timeoutMs: 5_000,
          agentDir: "/tmp",
          cfg: {} as never,
          model: "bytedance",
          provider: "bytedance",
        }),
      ).rejects.toThrow(/HTTP 429/);
    });

    it("throws when payload contains an error field", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      mockFetchOnce({ error: { message: "bad model id", code: "invalid_model" } });

      await expect(
        bytedanceMediaUnderstandingProvider.describeImage!({
          buffer: PNG_BUFFER,
          fileName: "test.png",
          mime: "image/png",
          timeoutMs: 5_000,
          agentDir: "/tmp",
          cfg: {} as never,
          model: "bytedance",
          provider: "bytedance",
        }),
      ).rejects.toThrow(/bad model id/);
    });

    it("supports content as array of text blocks (defensive parse)", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      mockFetchOnce({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "Line 1." },
                { type: "text", text: "Line 2." },
              ],
            },
          },
        ],
      });

      const result = await bytedanceMediaUnderstandingProvider.describeImage!({
        buffer: PNG_BUFFER,
        fileName: "test.png",
        mime: "image/png",
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      expect(result.text).toBe("Line 1.\nLine 2.");
    });
  });

  describe("describeImages", () => {
    it("returns empty result when no images provided", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      const result = await bytedanceMediaUnderstandingProvider.describeImages!({
        images: [],
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });
      expect(result.text).toBe("");
      expect(result.model).toBe("doubao-seed-2.0-pro");
    });

    it("calls API once per image and prefixes each response in batch mode", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      let callIndex = 0;
      const fetchSpy = vi.fn(async () => {
        callIndex += 1;
        return new Response(
          JSON.stringify(buildChatCompletionsResponse(`Description ${callIndex}.`)),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchSpy);

      const result = await bytedanceMediaUnderstandingProvider.describeImages!({
        images: [
          { buffer: PNG_BUFFER, fileName: "a.png", mime: "image/png" },
          { buffer: PNG_BUFFER, fileName: "b.png", mime: "image/png" },
        ],
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.text).toContain("Image 1: Description 1.");
      expect(result.text).toContain("Image 2: Description 2.");
    });

    it("does not prefix when only one image", async () => {
      process.env.ARK_API_KEY = "ark-env-key";
      mockFetchOnce(buildChatCompletionsResponse("Just one description."));

      const result = await bytedanceMediaUnderstandingProvider.describeImages!({
        images: [{ buffer: PNG_BUFFER, fileName: "a.png", mime: "image/png" }],
        timeoutMs: 5_000,
        agentDir: "/tmp",
        cfg: {} as never,
        model: "bytedance",
        provider: "bytedance",
      });

      expect(result.text).toBe("Just one description.");
      expect(result.text).not.toMatch(/^Image 1:/);
    });
  });
});
