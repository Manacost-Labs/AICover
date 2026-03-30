<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Fusion AI — AI Cover Generator

**Профессиональный инструмент генерации обложек на основе Google Gemini API.**
Слияние персонажей · Апскейл до 4K · Расширение формата — всё в одном интерфейсе.

[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.1-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com)
[![Gemini](https://img.shields.io/badge/Gemini_API-1.29-4285F4?logo=google&logoColor=white&style=flat-square)](https://ai.google.dev)

</div>

---

## Оглавление

- [Что это такое](#что-это-такое)
- [Возможности](#возможности)
- [Стек технологий](#стек-технологий)
- [Структура проекта](#структура-проекта)
- [Быстрый старт](#быстрый-старт)
- [Конфигурация](#конфигурация)
- [Архитектура](#архитектура)
- [API и сервисы](#api-и-сервисы)
- [Хранение данных](#хранение-данных)
- [Производительность](#производительность)
- [Аудит качества](#аудит-качества)

---

## Что это такое

**Fusion AI** — React-приложение для создания обложек методом слияния нескольких изображений персонажей в единую сцену. Работает на базе Google Gemini API и разработано для запуска в среде [Google AI Studio](https://aistudio.google.com).

**Типичный сценарий:** загружаете 2–4 арта персонажей, выбираете референс композиции, нажимаете «Создать» — и ИИ генерирует единую обложку в стиле фэнтези-цифровой живописи с правильным светом, тенями и атмосферой.

Просмотр в AI Studio: https://ai.studio/apps/e70ca8f3-3795-4efa-8853-59952ea91b6f

---

## Возможности

### Создать (Create)
- Загрузка **2–4 исходных изображений** персонажей (drag & drop, вставка из буфера Ctrl+V, файловый диалог)
- Опциональный **референс композиции** — задаёт расположение персонажей в кадре
- **Библиотека шаблонов** с предустановленными композициями (Центральный объект, Дуэль, Группа героев, Пейзаж, Портрет)
- **Режим доработки** — использует существующее изображение как базу для правок
- **Пакетная генерация** до 4 вариантов за раз
- Настройки:
  - 3 модели Gemini (2.5 Flash / 3.1 Flash / 3 Pro)
  - 14 соотношений сторон (от 1:1 до 21:9)
  - 4 разрешения (512px, 1K, 2K, 4K)
  - Положительный и отрицательный промпт
  - Режим максимальной точности (запрещает ИИ изменять лица и детали персонажей)
- **Эталоны качества** — до 3 избранных изображений используются как benchmark для новых генераций

### Апскейл (Upscale)
- Увеличение разрешения до **1K / 2K / 4K**
- Устранение артефактов сжатия, резкость краёв, улучшение текстур
- Трекинг статуса каждого задания (loading / done / error)
- Повтор при ошибке без потери очереди

### Расширение формата (Expand)
- AI-outpainting: достраивает края изображения до нового соотношения сторон
- 14 форматов на выбор
- Промпт для управления расширяемой областью
- Результат автоматически сохраняется в историю

### История (History)
- Автоматически сохраняет последние **50 генераций**
- Хранение в IndexedDB (офлайн, без сервера)
- Полный набор действий: лайк, апскейл, доработка, скачивание, полный экран
- Очистка истории одним кликом

### Избранное (Favorites)
- Отдельная коллекция понравившихся работ
- Используется как обучающий эталон для Gemini при следующих генерациях
- Постоянное хранение в IndexedDB

---

## Стек технологий

| Категория          | Технология                    | Версия    |
|--------------------|-------------------------------|-----------|
| UI Framework       | React                         | 19.0.0    |
| Language           | TypeScript                    | 5.8.2     |
| Build Tool         | Vite                          | 6.2.0     |
| Styling            | TailwindCSS                   | 4.1.14    |
| Animation          | Framer Motion (motion/react)  | 12.23.24  |
| Icons              | Lucide React                  | 0.546.0   |
| AI API             | @google/genai                 | 1.29.0    |
| Storage            | idb-keyval (IndexedDB)        | 6.2.2     |
| Env vars           | dotenv                        | 17.2.3    |

---

## Структура проекта

```
manacost-image/
├── src/
│   ├── App.tsx                    # Корневой компонент, стейт, бизнес-логика
│   ├── main.tsx                   # Точка входа React
│   ├── index.css                  # Глобальные стили (Tailwind + кастомный скроллбар)
│   ├── constants.ts               # Соотношения сторон, разрешения, библиотека шаблонов
│   ├── services/
│   │   └── geminiService.ts       # Интеграция с Gemini API (генерация / апскейл / расширение)
│   └── components/
│       ├── ResultCard.tsx         # Карточка результата с действиями (memo)
│       ├── UpscaleResultCard.tsx  # Карточка апскейла/расширения со статусом (memo)
│       └── tabs/
│           ├── CreateTab.tsx      # Вкладка создания (~500 строк)
│           ├── UpscaleTab.tsx     # Вкладка апскейла
│           ├── ExpandTab.tsx      # Вкладка расширения формата
│           ├── HistoryTab.tsx     # История генераций
│           └── FavoritesTab.tsx   # Избранные работы
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example
└── metadata.json                  # Метаданные для Google AI Studio
```

---

## Быстрый старт

### Требования

- **Node.js** 18+
- **Gemini API ключ** (бесплатно: [aistudio.google.com/apikey](https://aistudio.google.com/apikey))

### Установка

```bash
git clone <repo-url>
cd manacost-image
npm install
```

### Настройка окружения

```bash
cp .env.example .env
```

Откройте `.env` и добавьте ваш ключ:

```env
GEMINI_API_KEY=your_api_key_here
```

### Запуск

```bash
# Разработка (порт 3000, доступно по сети)
npm run dev

# Проверка типов TypeScript
npm run lint

# Продакшн-сборка в папку dist/
npm run build

# Превью продакшн-сборки
npm run preview

# Очистка dist/
npm run clean
```

> **Google AI Studio**: ключ вставляется автоматически через интерфейс `window.aistudio` — ручная настройка `.env` не нужна при работе в AI Studio.

---

## Конфигурация

### vite.config.ts — ключевые настройки

```typescript
define: {
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  // Ключ встраивается в JS-бандл при сборке
},
server: {
  hmr: process.env.DISABLE_HMR !== 'true'
  // HMR отключается в AI Studio через env var
}
```

### Модели Gemini

| Модель                           | Применение              | imageSize | Особенности                    |
|----------------------------------|-------------------------|-----------|--------------------------------|
| `gemini-2.5-flash-image`         | Создание / Апскейл      | Нет       | Самая быстрая                  |
| `gemini-3.1-flash-image-preview` | Создание / Апскейл      | Да        | Баланс скорости и качества     |
| `gemini-3-pro-image-preview`     | Создание / Апскейл      | Да        | Максимальное качество, мин. 1K |

> `imageSize` работает только с `gemini-3.1-flash-image-preview` и `gemini-3-pro-image-preview`.
> При выборе `gemini-3-pro-image-preview` настройка `512px` отключается автоматически.

---

## Архитектура

### Потоки данных

```
App.tsx (центральный стейт)
  ├── sources[]           → CreateTab ──→ generateFusedCover() → results[]
  ├── reference           → CreateTab ──→ (анализ композиции)
  ├── baseImage           → CreateTab ──→ (режим доработки)
  ├── upscaleSource       → UpscaleTab → upscaleImage()     → upscaleResults[]
  ├── expandSource        → ExpandTab  → expandImage()      → expandResults[]
  ├── history[]           ←──────────────────────────────── IndexedDB
  └── likedImages[]       ←──────────────────────────────── IndexedDB
```

### Управление состоянием

Весь стейт хранится в `App.tsx` через хуки React. Дочерние компоненты получают пропсы.

**Мемоизация:**
| Хук | Что мемоизирует |
|-----|----------------|
| `React.useMemo` | `likedSet` — Set из массива лайков |
| `React.useCallback` | `handleUpscale`, `handleExpand`, `toggleLike` |
| `React.memo` | `ResultCard`, `UpscaleResultCard` |

### Error Boundary

Компонент `ErrorBoundary` оборачивает всё приложение. При краше показывает экран ошибки с кнопкой перезагрузки. Все тексты на русском языке.

---

## API и сервисы

### `generateFusedCover(sources, reference, settings, baseImage, likedImages)`

**Алгоритм:**
1. Если передан `reference` — анализирует его через `gemini-3.1-flash-lite-preview`, получает текстовое описание пространственной композиции (только расположение, без внешности)
2. Формирует multipart-запрос с лейблами `SOURCE CHARACTER N (USE THIS EXACTLY)`
3. Если `baseImage` — активирует режим хирургической доработки (нулевое перерисовывание лиц и деталей)
4. Если `likedImages` (до 3 штук) — добавляются как эталоны качества с пометкой `EXAMPLES OF HIGH-QUALITY RESULTS`
5. Запускает `batchSize` параллельных генераций через `Promise.all`
6. Возвращает плоский массив base64 data URLs

### `upscaleImage(image, targetSize, model)`

Отправляет изображение с инструкцией super-resolution. Явный запрет на изменение контента, цветов и композиции — только улучшение детализации.

**Целевые размеры:** 1K (1024px) / 2K (2048px) / 4K (4096px)

### `expandImage(image, targetAspectRatio, prompt, model)`

AI-outpainting: расширяет изображение до нужного соотношения сторон, заполняя края контентом, согласующимся со стилем оригинала. Опциональный промпт управляет тем, что появится в расширенной области.

---

## Хранение данных

### IndexedDB (idb-keyval)

| Ключ             | Тип          | Содержимое              | Лимит       |
|------------------|--------------|-------------------------|-------------|
| `fusion_history` | `string[]`   | base64 data URLs        | 50 записей  |
| `fusion_liked`   | `string[]`   | base64 data URLs        | Без лимита  |

### Автоматическая миграция

При первом запуске приложение проверяет наличие данных в `localStorage` (`fusion_history`, `fusion_liked`). Если данные есть в localStorage, но нет в IndexedDB — мигрирует их и удаляет из localStorage. Это одноразовая операция для обратной совместимости со старыми версиями.

---

## Производительность

### Оптимизации в коде

| Оптимизация | Описание |
|-------------|----------|
| `requestAnimationFrame` throttling | Обновления parallax-фона синхронизированы с FPS монитора |
| `passive: true` на mousemove | Не блокирует нативный scroll браузера |
| `React.memo` на картах | ResultCard и UpscaleResultCard не ре-рендерятся без изменений пропсов |
| `useCallback` на обработчиках | Стабильные ссылки → нет лишних ре-рендеров дочерних компонентов |
| `useMemo` для likedSet | `Set` пересоздаётся только при изменении likedImages |
| Framer Motion values | Параллакс-анимации работают вне React render loop (через MotionValue) |
| Lazy fetch библиотеки | Изображения шаблонов загружаются только при клике |

### Известные ограничения

| Ограничение | Описание |
|-------------|----------|
| Объём памяти | 50 изображений 4K в base64 в IndexedDB ≈ 200–500 МБ |
| Дублирование данных | Одно изображение в истории И в избранном хранится дважды в полном размере |
| Нет сжатия при загрузке | Большие изображения отправляются в Gemini API как есть |
| API key в бандле | `GEMINI_API_KEY` встраивается в JS-бандл — ожидаемое поведение для AI Studio |

---

## Аудит качества

### Исправленные баги

| # | Место | Проблема | Статус |
|---|-------|----------|--------|
| 1 | `App.tsx:471` | `selectFromLibrary` пытался парсить HTTP URL picsum.photos как base64 regex → кнопки библиотеки шаблонов молча не работали | ✅ Исправлено |
| 2 | `App.tsx:269` | `handleOpenKeyDialog` ставил `hasKey=true` независимо от того, выбрал ли пользователь ключ | ✅ Исправлено |
| 3 | `App.tsx:173` | mousemove обработчик стрелял на каждый пиксель без throttling | ✅ Исправлено |
| 4 | `HistoryTab/FavoritesTab` | `key={url}` использовал полную base64 строку (тысячи символов) как React reconciliation key | ✅ Исправлено |

### Функциональное покрытие

| Функция | Статус |
|---------|--------|
| Загрузка изображений (drag & drop) | ✅ |
| Загрузка изображений (файловый диалог) | ✅ |
| Вставка из буфера обмена (Ctrl+V) | ✅ |
| Библиотека шаблонов композиции | ✅ |
| Генерация с 2–4 источниками | ✅ |
| Пакетная генерация (до 4 вариантов) | ✅ |
| Режим доработки существующего изображения | ✅ |
| Апскейл до 4K | ✅ |
| Расширение формата (outpainting) | ✅ |
| Сохранение в историю (до 50) | ✅ |
| Лайк / убрать лайк | ✅ |
| Скачивание изображений | ✅ |
| Полноэкранный просмотр | ✅ |
| Миграция localStorage → IndexedDB | ✅ |
| Error Boundary при краше | ✅ |
| Проверка / выбор API ключа | ✅ |

---

## Переменные окружения

| Переменная       | Обязательна | Описание                                    |
|------------------|-------------|---------------------------------------------|
| `GEMINI_API_KEY` | Да          | Ключ Google Gemini API                      |
| `APP_URL`        | Нет         | URL Cloud Run сервиса (для AI Studio)       |
| `DISABLE_HMR`    | Нет         | `true` — отключить HMR (для AI Studio)     |

---

## Лицензия

Apache-2.0 — см. заголовки исходных файлов.
