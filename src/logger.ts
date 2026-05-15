/**
 * Module-level logger for the openclaw-bytedance plugin.
 *
 * The OpenClaw host hands the plugin a `PluginLogger` only at `register(api)`
 * time. Provider plugins (web search / media understanding) are plain data
 * objects whose runtime methods are invoked later by the host without a
 * logger argument, so we capture the host logger at registration time and
 * expose it through this module to the runtime files.
 *
 * Design:
 *   - Default is a no-op so unit tests / direct imports never crash.
 *   - `setPluginLogger(api.logger)` is called from `index.ts` register().
 *   - All log lines are prefixed with `[bytedance] ...` to match OpenClaw's
 *     extension convention (matches `extensions/voice-call`,
 *     `extensions/memory-core`, etc).
 *   - `debug` is optional on `PluginLogger`, so we forward it through `?.`
 *     and silently drop debug lines when the host did not wire a debug sink.
 */

/** Minimal subset of openclaw's PluginLogger we depend on. */
export interface PluginLoggerLike {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const PREFIX = "[bytedance]";

const NOOP_LOGGER: PluginLoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let activeLogger: PluginLoggerLike = NOOP_LOGGER;

/** Inject the host-provided logger. Called once from `index.ts#register`. */
export function setPluginLogger(logger: PluginLoggerLike | undefined): void {
  activeLogger = logger ?? NOOP_LOGGER;
}

/** Reset to no-op (useful for tests). */
export function resetPluginLogger(): void {
  activeLogger = NOOP_LOGGER;
}

function withPrefix(message: string): string {
  return `${PREFIX} ${message}`;
}

export const log = {
  debug(message: string): void {
    activeLogger.debug?.(withPrefix(message));
  },
  info(message: string): void {
    activeLogger.info(withPrefix(message));
  },
  warn(message: string): void {
    activeLogger.warn(withPrefix(message));
  },
  error(message: string): void {
    activeLogger.error(withPrefix(message));
  },
};

/**
 * Format an error/exception consistently for log output.
 * Keeps it short (no stack flood) while preserving useful detail.
 */
export function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message ? `${err.name}: ${err.message}` : err.name;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
