# Производительность Cover — чеклист аудита

Документ дополняет ручной прогон плана: измерения в **production** (`npm run build` + `npm run preview`), не в dev.

## A. Анализ бандла

1. Обычная сборка: `npm run build` — смотреть таблицу gzip по чанкам в выводе.
2. Визуализация дерева: `npm run build:analyze` — открыть `dist/stats.html` в браузере (treemap, gzip).
3. Ожидаемые крупные чанки: `vendor-genai`, `vendor-motion`, entry `index-*.js` (в т.ч. из-за синхронного импорта `geminiService` в `App.tsx`).

Пример порядка величин (gzip, ориентир): `vendor-genai` ~55 KB, `index-*.js` ~96 KB, `vendor-motion` ~32 KB, CSS ~10 KB — пересчитывать после `npm run build`.

## B. Lighthouse (после `npm run preview`)

- Chrome → DevTools → Lighthouse → Navigation, Mobile и Desktop.
- Зафиксировать: **LCP**, **TBT**, **CLS**, **INP** (если доступен).
- Повторить после значимых изменений бандла или шрифтов.

## C. React Profiler

- React DevTools → Profiler → сценарии: смена вкладок, открытие модалок, скролл истории.
- Искать лишние коммиты корня `App` без изменения пропсов детей.

## D. Медиа и память

- Долгая сессия с большим числом превью (data URL) в сетках — Performance → Memory, снимки до/после.
- Несколько `<video>` на вкладке «Видео» — следить за декодерами при batch.

## E. Сеть

- Network при генерации обложки / Veo: длительность, 429, дубли запросов.
- Supabase: число запросов при старте (`loadData`).

## Приоритеты улучшений (гипотезы)

| Приоритет | Действие |
|-----------|----------|
| P0 | После метрик: рассмотреть отложенный импорт частей `geminiService` (уменьшение initial JS). |
| P1 | Виртуализация длинных списков истории, если Profiler покажет jank. |
| P2 | Точечная оптимизация анимаций `motion` по записям Performance. |

## Шрифты

- Основной UI: **Cover** (`public/fonts/cover-display.otf`) + fallback **Inter** с Google Fonts.
- `font-display: swap` у `@font-face` снижает блокировку отрисовки.
