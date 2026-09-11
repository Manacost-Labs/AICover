# Cover — контекст проекта для ИИ-агентов

Этот файл даёт **единый обзор** репозитория: назначение, архитектура, данные, API и соглашения. Тот же текст — в **`CLAUDE.md`** (удобно для Claude Code и других агентов).

---

## Назначение

**Cover** — веб-приложение (React + Vite + TypeScript) для генерации **обложек** из нескольких изображений персонажей через **Google Gemini** (image + vision). Пользователь загружает 2–4 арта, опционально задаёт референс композиции, настраивает модель/формат/промпт и получает варианты обложки. Есть апскейл, расширение кадра (outpaint), история, избранное, библиотеки карт и референсов. Данные хранятся в MySQL и файловом storage этого сервиса.

Историческое имя в коде: «Fusion» (типы `FusionSource`, `generateFusedCover` и т.д.) — **не переименовывать без отдельной задачи**, это не пользовательский бренд.

---

## Стек

| Слой | Технологии |
|------|------------|
| UI | React 19, Tailwind CSS 4 (`@tailwindcss/vite`), `motion` (анимации), `lucide-react` |
| Сборка | Vite 6, TypeScript 5.8 |
| AI | `@google/genai` — same-origin `/api/gemini` proxy; ключ хранится только на сервере |
| Офлайн-хранилище | `idb-keyval` — IndexedDB |
| Сервер | Express + MySQL (`server/index.js`) — API, media storage и Gemini proxy |
| Прочее | `deckstrings` — импорт колод Hearthstone (см. `hearthstoneService.ts`) |

---

## Структура каталогов

```
src/
  App.tsx              # Корень UI: вкладки, состояние, генерация, миграции, lightbox
  main.tsx             # Точка входа, StrictMode
  index.css            # Глобальные стили + Tailwind
  constants.ts         # ASPECT_RATIOS, RESOLUTIONS
  vite-env.d.ts
  components/
    tabs/              # Вкладки: Create, History, Favorites, Upscale, Expand, Library, References
    ResultCard.tsx, UpscaleResultCard.tsx, OptimizedImage.tsx, DeckImportSection.tsx
  services/
    geminiService.ts   # Генерация обложки, vision-QA, апскейл, expand, анализ референса/избранного
    thumbnailService.ts # Генерация art-only фонов для HS-обложек
    hearthstoneAssetService.ts # Поиск игровых артов через db.kolodahs.ru
    serverStorageService.ts # CRUD API сервиса + fallback на IDB, URL → ImageSource
    hearthstoneService.ts
  features/thumbnail/  # Типы, шаблоны, промпт и Canvas-рендер HS-обложки
```

Корень репозитория: `vite.config.ts`, `vercel.json`, `metadata.json` (имя приложения), `index.html`, `README.md`.

---

## Скрипты

- `npm run dev` — dev-сервер (порт 3000)
- `npm run build` — production
- `npm run lint` — `tsc --noEmit`

---

## Переменные окружения

- **`GEMINI_API_KEY`** — хранится в server-only environment file; браузер его не получает.
- Параметры MySQL и storage — server-only environment file. Не коммитить реальные значения.

---

## Хранение данных и ключи совместимости

**IndexedDB (`idb-keyval`) — ключи с префиксом `fusion_`:**

- `fusion_history` — история генераций
- `fusion_liked` — избранное (URL/data URL)
- `fusion_favorite_choice_notes` — текст анализа «почему выбран этот вариант из батча»

**Не переименовывать** эти ключи без миграции — иначе потеряются данные у существующих пользователей.

IndexedDB остаётся локальным fallback. Основной источник данных — API Cover: история, избранное, библиотеки и media uploads.

---

## Сервисы (логика)

### `geminiService.ts`

- **`generateFusedCover`** — основной pipeline: источники `FusionSource` (с опциональными `SceneRole`: left/center/right), референс, настройки, `baseImage` (режим доработки), `likedImages` (эталоны качества), `referenceCompositionNotes`.
- **Vision:** анализ персонажей (`analyzeSourceCharactersForFusion`), при необходимости — описание композиции референса; ответы **укорачиваются** (`SOURCE_BRIEF_MAX_CHARS`), чтобы не раздувать промпт.
- **Лайки/URL:** `likedUrlToInlineData` — поддержка `data:` и URL файлов из storage Cover.
- **Strict mode:** после генерации — vision-QA и при необходимости refine; параллелизм **ограничен** (`STRICT_VISION_CONCURRENCY`), чтобы снизить 429/нестабильность.
- Отдельно: `upscaleImage`, `expandImage`, `analyzeReferenceCompositionVision`, `analyzeFavoriteChoiceVision` и др.

### `serverStorageService.ts` и `server/index.js`

Клиент обращается к same-origin API. Express-сервис хранит метаданные в MySQL, media — в локальном storage, и проксирует допустимые Gemini-запросы, не раскрывая ключ браузеру.

### `hearthstoneService.ts`

Разбор колоды и привязка к артам карт для быстрого добавления в источники.

---

## UI: вкладки (`App.tsx`)

| id | Компонент | Назначение |
|----|-----------|------------|
| `create` | `CreateTab` | Источники, сцена/cover, референс, генерация, результаты |
| `history` | `HistoryTab` | История сервиса с IDB fallback |
| `favorites` | `FavoritesTab` | Избранное, анализ выбора (Gemini) |
| `upscale` | `UpscaleTab` | Апскейл |
| `expand` | `ExpandTab` | Outpaint / расширение |
| `library` | `LibraryTab` | Библиотека карт |
| `references` | `ReferencesTab` | Библиотека референсов |
| `thumbnail` | `ThumbnailTab` | HS-обложки: игровые ассеты, Gemini-фон, точный Canvas-текст и PNG |

Шапка: бренд **Cover**, переключение вкладок, при необходимости AI Studio API key (`window.aistudio`).

### Просмотр изображения (lightbox)

Полноэкранный просмотр рендерится **вне** `<main>` с `z-index` выше шапки; при открытии шапка скрывается. Поверх картинки — canvas для временных пометок (несколько цветов, режим «Рисовать», очистка); **обводки не сохраняются**. Компонент: `src/components/ImageLightbox.tsx`.

---

## Сборка и чанки

`vite.config.ts` задаёт `manualChunks` для react, motion, genai, ui, deckstrings — кэширование на CDN.

Вкладки могут подгружаться **лениво** (`React.lazy`) — см. актуальный `App.tsx`.

---

## Деплой

Сервис запускается systemd на production-сервере. Сборка: `npm run build`, выход `dist/`; Express раздаёт SPA и API.

---

## Что проверять перед коммитом

1. `npm run lint`, `npm run test` и `npm run build`
2. Не добавлять секреты в репозиторий
3. Любые изменения ключей IDB — только с миграцией и тестом

---

## Полезные файлы для чтения при задаче

| Задача | Файлы |
|--------|--------|
| Генерация / промпты / токены | `src/services/geminiService.ts` |
| Хранилище и IDB | `src/services/serverStorageService.ts` |
| Создание обложки UI | `src/components/tabs/CreateTab.tsx` |
| Глобальное состояние и табы | `src/App.tsx` |

---

*Обновляйте этот документ при существенных изменениях архитектуры или данных.*
