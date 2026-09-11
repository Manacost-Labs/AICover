import type { ThumbnailLayout } from './types';

export const THUMBNAIL_MODELS = [
  {
    id: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash',
    description: 'Рекомендуемая: яркий результат, 4K и хорошие референсы',
    badge: 'Баланс',
  },
  {
    id: 'gemini-3-pro-image',
    name: 'Gemini 3 Pro',
    description: 'Самая точная композиция и максимальная детализация',
    badge: 'Качество',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Быстрые черновики; работает только в 1K',
    badge: 'Быстро',
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash',
    description: 'Совместимый экономичный режим предыдущего поколения',
    badge: 'Legacy',
  },
] as const;

export const THUMBNAIL_LAYOUTS: Array<{
  id: ThumbnailLayout;
  name: string;
  description: string;
}> = [
  { id: 'text-left', name: 'Текст слева', description: 'Главный герой справа' },
  { id: 'text-right', name: 'Текст справа', description: 'Главный герой слева' },
  { id: 'center', name: 'По центру', description: 'Текст поверх нижней части' },
];

export const THUMBNAIL_FONTS = [
  { value: 'Impact, Arial Black, sans-serif', label: 'Impact' },
  { value: 'Arial Black, Arial, sans-serif', label: 'Arial Black' },
  { value: 'Cover, Inter, sans-serif', label: 'Cover' },
  { value: 'Trebuchet MS, Arial, sans-serif', label: 'Trebuchet' },
] as const;

export const DEFAULT_THUMBNAIL_STYLE =
  'Explosive vibrant Hearthstone fantasy art, dramatic purple and emerald magic, strong rim light, deep contrast, cinematic particles, sharp readable silhouette, premium YouTube thumbnail quality.';

export const WOOD_FRAME_URL = '/assets/frames/main-page-rail-border.png';
