export type ThumbnailLayout = 'auto' | 'text-left' | 'text-right' | 'center';
export type ThumbnailTypographyTreatment = 'auto' | 'poster' | 'gold' | 'arcane' | 'frost' | 'fel' | 'fire' | 'custom';
export type ResolvedThumbnailTypographyTreatment = Exclude<ThumbnailTypographyTreatment, 'auto'>;

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
  typographyPrompt: string;
  fontFamily: string;
  treatment: ThumbnailTypographyTreatment;
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  accentLines: number;
  strokeWidth: number;
  shadowBlur: number;
  lineHeight: number;
};

export type ThumbnailAutoLayout = {
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  align: 'left' | 'center' | 'right';
  fontScale: number;
  lineHeight: number;
  rotation: number;
  lineScales: number[];
  lineOffsets: number[];
  accentLineIndexes: number[];
  dominantLineIndex?: number;
  treatment: ResolvedThumbnailTypographyTreatment;
  placement?: 'left' | 'right' | 'center';
  safeMargin?: number;
  backdropStrength?: number;
  freeSpaceScore?: number;
  accentTone?: 'lime' | 'violet' | 'pink' | 'cyan' | 'orange' | 'yellow';
  gazeDirection?: 'left' | 'right' | 'center';
  protectedRegions?: ThumbnailProtectedRegion[];
};

export type ThumbnailProtectedRegion = {
  label: 'face' | 'subject' | 'hand' | 'weapon' | 'effect';
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ThumbnailCtrScore = {
  overall: number;
  mobileReadability: number;
  subjectImpact: number;
  contrast: number;
  curiosity: number;
  clutterControl: number;
  summary: string;
  issues: string[];
};

export type GeneratedThumbnailBackground = {
  imageUrl: string;
  autoLayout: ThumbnailAutoLayout | null;
  textRenderedByAi: boolean;
  textVerified: boolean | null;
  sourceHeadline: string;
  ctrScore: ThumbnailCtrScore | null;
};

export type ThumbnailRenderSettings = {
  layout: ThumbnailLayout;
  text: ThumbnailTextSettings;
  darken: number;
  frameEnabled: boolean;
  autoLayout?: ThumbnailAutoLayout | null;
  drawText?: boolean;
};
