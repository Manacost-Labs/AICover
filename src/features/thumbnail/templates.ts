import type { ThumbnailLayout, ThumbnailTypographyTreatment } from './types';

export const THUMBNAIL_MODELS = [
  {
    id: 'openai/gpt-image-2',
    provider: 'openrouter',
    name: 'GPT Image 2',
    description: 'Рекомендуемая: лучший выбор для точной кириллицы и типографики внутри арта',
    badge: 'Лучший текст',
  },
  {
    id: 'gemini-3.1-flash-image',
    provider: 'gemini',
    name: 'Gemini 3.1 Flash',
    description: 'Рекомендуемая: яркий результат, 4K и хорошие референсы',
    badge: 'Баланс',
  },
  {
    id: 'gemini-3-pro-image',
    provider: 'gemini',
    name: 'Gemini 3 Pro',
    description: 'Самая точная композиция и максимальная детализация',
    badge: 'Качество',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    provider: 'gemini',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Быстрые черновики; работает только в 1K',
    badge: 'Быстро',
  },
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
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
  { id: 'auto', name: 'Авто', description: 'ИИ найдёт наиболее свободную и контрастную область' },
  { id: 'text-left', name: 'Текст слева', description: 'Главный герой справа' },
  { id: 'text-right', name: 'Текст справа', description: 'Главный герой слева' },
  { id: 'center', name: 'По центру', description: 'Текст поверх нижней части' },
];

export const THUMBNAIL_FONTS = [
  { value: 'Thumbnail Condensed, sans-serif', label: 'Roboto Condensed' },
  { value: 'Thumbnail Oswald, sans-serif', label: 'Oswald' },
  { value: 'Cover, Inter, sans-serif', label: 'Cover' },
] as const;

export const THUMBNAIL_TREATMENTS: Array<{
  id: ThumbnailTypographyTreatment;
  name: string;
  description: string;
}> = [
  { id: 'poster', name: 'YouTube', description: 'Крупный чистый текст, тонкая обводка и один яркий акцент' },
  { id: 'auto', name: 'Авто', description: 'ИИ подберёт декоративное оформление под палитру арта' },
  { id: 'gold', name: 'Золото', description: 'Тёплый объём и премиальный Hearthstone-акцент' },
  { id: 'arcane', name: 'Аркана', description: 'Фиолетово-бирюзовое магическое свечение' },
  { id: 'frost', name: 'Лёд', description: 'Холодный стальной объём и голубая кромка' },
  { id: 'fel', name: 'Скверна', description: 'Кислотно-зелёный акцент для демонов и Бездны' },
  { id: 'fire', name: 'Огонь', description: 'Горячий оранжево-красный акцент для агрессивных сцен' },
  { id: 'custom', name: 'Свой', description: 'Использовать выбранные ниже основной и акцентный цвета' },
];

export const DEFAULT_THUMBNAIL_STYLE =
  'Explosive vibrant Hearthstone fantasy art, dramatic purple and emerald magic, strong rim light, deep contrast, cinematic particles, sharp readable silhouette, premium YouTube thumbnail quality.';

export const WOOD_FRAME_URL = '/assets/frames/main-page-rail-border.png';
