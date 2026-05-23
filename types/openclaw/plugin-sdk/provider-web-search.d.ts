export interface WebSearchProviderConfig {
  name: string;
  search(params: any): Promise<any>;
  [key: string]: any;
}
export class WebSearchProvider {
  constructor(config: WebSearchProviderConfig);
  [key: string]: any;
}
export function buildSearchCacheKey(...args: any[]): string;
export function formatCliCommand(...args: any[]): string;
export function mergeScopedSearchConfig(...args: any[]): any;
export function readCachedSearchPayload(...args: any[]): any;
export function writeCachedSearchPayload(...args: any[]): void;
export function readConfiguredSecretString(...args: any[]): any;
export function readNumberParam(...args: any[]): number | undefined;
export function readStringParam(...args: any[]): string | undefined;
export function resolveProviderWebSearchPluginConfig(...args: any[]): any;
export function resolveSearchCacheTtlMs(...args: any[]): number;
export function resolveSearchTimeoutSeconds(...args: any[]): number;
export function resolveSiteName(...args: any[]): string | undefined;
export function withTrustedWebSearchEndpoint(...args: any[]): any;
export function wrapWebContent(...args: any[]): any;
export interface SearchConfigRecord {
  [key: string]: any;
}
