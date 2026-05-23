export interface MediaUnderstandingProviderConfig {
  name: string;
  understand(params: any): Promise<any>;
  [key: string]: any;
}
export class MediaUnderstandingProvider {
  constructor(config: MediaUnderstandingProviderConfig);
  [key: string]: any;
}
export interface ImageDescriptionRequest {
  [key: string]: any;
}
export interface ImageDescriptionResult {
  [key: string]: any;
}
export interface ImagesDescriptionInput {
  [key: string]: any;
}
export interface ImagesDescriptionRequest {
  [key: string]: any;
}
export interface ImagesDescriptionResult {
  [key: string]: any;
}
