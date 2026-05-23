export interface PluginApi {
  registerProvider(provider: any): void;
  registerMediaUnderstandingProvider(provider: any): void;
  logger: any;
  registerWebSearchProvider(provider: any): void;
  [key: string]: any;
}

export interface PluginEntryOptions {
  id: string;
  name: string;
  description: string;
  register(api: PluginApi): void | Promise<void>;
  [key: string]: any;
}

export type PluginEntry = (options: PluginEntryOptions) => any;
export function definePluginEntry(options: PluginEntryOptions): any;
