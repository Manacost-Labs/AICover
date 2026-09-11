export type ThumbnailLayout = 'text-left' | 'text-right' | 'center';

export type ThumbnailAsset = {
  id: string;
  name: string;
  cardId?: string;
  imageUrl: string;
  source: 'constructed' | 'battlegrounds' | 'hero' | 'upload';
};

export type ThumbnailGenerationSettings = {
  model: string;
  imageSize: '1K' | '2K' | '4K';
  batchSize: 1 | 2 | 3 | 4;
  layout: ThumbnailLayout;
  stylePrompt: string;
};

export type ThumbnailTextSettings = {
  text: string;
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  accentLines: number;
  strokeWidth: number;
  shadowBlur: number;
  lineHeight: number;
};

export type ThumbnailRenderSettings = {
  layout: ThumbnailLayout;
  text: ThumbnailTextSettings;
  darken: number;
  frameEnabled: boolean;
};
