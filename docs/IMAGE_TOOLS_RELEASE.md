# Cover — мягкая визуальная система и «Размер и качество»

## Scope и design direction

2026-09-11. Ветка `redesign-image-tools-20260911`, отдельный worktree
`/srv/projects/web/AI-cover-worktrees/image-tools-20260911`, HEAD350720e.
За основу взяты точные frontend-файлы опубликованного refinements-20260911:
перед началом нового среза `diff -qr old/src new/src` не показал различий.
Предыдущие worktrees и их незакоммиченные файлы не изменялись.

Проблемы исходного экрана: два инструмента с дублирующими загрузчиками,
слишком большой вводный блок, скрытые настройки, независимые исходники;
резкие чёрно-белые перепады поверхностей и яркое синее выделение.
Сохраняем навигационные группы, локальный Manrope, плотность панели Create,
светлую/тёмную темы, референсы и работающие функции обработки.

Направление: спокойный редактор изображений. Светлая тема — тёплые
нейтральные поверхности с приглушённым зелёным акцентом; тёмная — мягкий
серо-зелёный фон вместо почти чёрного. Текст остаётся контрастным.
Manrope 15/24, заголовок экрана 26/34 550, секции 16/24 600, подписи 13px.
Radii 5/8/10px, модальные 12px; одна поверхность настроек, рабочий холст
и компактный список версий. Секции разделены отступами/линиями, не карточками.
Шкала отступов 4/8/12/16/20/24/28. Без градиентов, glow и фильтров изображений.

## Поведение

- Шесть разделов; вместо «Апскейл» и «Расширить» — «Размер и качество».
- Общий исходник; переключение «Формат / Качество», отдельные значения
  параметров, общий выбор модели. Существующие модели и 14 форматов сохранены.
- Формат по-прежнему дорисовывает края через expandImage, не обрезает.
- Качество по-прежнему использует upscaleImage; ограничения точного размера
  Gemini 2.5 Flash объяснены рядом с настройкой.
- Файл, drop, paste; проверка JPG/PNG/WEBP, до 10 МБ и декодирование изображения.
  Гонка чтений не заменяет более поздний выбор. Исходник не удаляется при запуске.
- Каждый запрос хранит исходник, операцию, модель, параметры и id. Retry
  использует этот снимок; переключение разделов не прерывает локальное ожидание.
- Общие версии, исходник/результат, скачивание, использование результата для
  другой операции и переход в редактор. Ошибка сохранения не скрывает изображение.
- Внешние действия апскейла из Create/History/Favorites сохраняют назначение.

## Границы и проверка

Профиль server, риск HIGH. Skills: frontend-design,
browser-testing-with-devtools, shipping-and-launch (дополнительные reference
checklists последнего отсутствуют в установленном skill; использовано основное руководство).
Luna scout завершён. Обязательный свежий Sol review до активации.
Защищены server/**, package.json/lock, MySQL, uploads, env и SSO.
Зависимости не меняются. Commit/push не запрашивались; пользователь отдельно
подтвердил production deploy этого среза.

Канонические проверки: npm run lint, npm run test, npm run build.
41 тест / 11 файлов проходят на финальном срезе, включая гонки загрузки файла.
Offline Chromium: scripts/test-redesign.mjs, артефакты
/tmp/cover-image-tools-acceptance. Все HTTP запросы отвечают локальные fixtures;
это не проверка authenticated production flow или реальной платной генерации.
Production audit: 0 high/critical, прежние 1 low и 1 moderate; зависимости
вне среза. Статус browser/review/активации ниже фиксируется по факту.

## Static-only выпуск и откат

Ожидаемый старый index:
49e5a9238b78e40ecde9168a1bbf3caffdd15dec38ff241ee8ba9d3ce64f9cb9.
Ожидаемый server/index.js:
cf91242d9b3cb52db122be7d4c5aedbf2573a9d5ccefc42ccca62a73aa0efb7a.
Release script: /tmp/cover-image-tools-release.mjs.
Backup: /var/backups/cover-image/20260911-image-tools-350720e.
Новые hashed assets добавляются без перезаписи старых; index меняется атомарно.
Backup хранит previous-dist, candidate-dist, точный frontend-source и проверки.
Рестарт сервиса не требуется, текущий серверный код не синхронизируется с checkout.
Rehearsal publish + rollback финальной сборки пройдена: /tmp/cover-release-rehearsal-hVrB3e.

```sh
sudo -n flock -n /run/lock/cover-foundation-release.lock node /tmp/cover-image-tools-release.mjs deploy
# Только при необходимости отката этого активного выпуска:
sudo -n flock -n /run/lock/cover-foundation-release.lock node /var/backups/cover-image/20260911-image-tools-350720e/release.mjs rollback
```

## Фактический статус

Активировано на сервере 2026-09-11; post-check 22:51:29 UTC. TypeScript, 41 тест, build и offline
Chromium пройдены. Свежее обязательное Sol review — PASS; после добавления
3 upload-race tests gate повторно подтверждён для текущего diff.
Desktop light/dark и mobile просмотрены; основные действия различимы,
изображения не фильтруются, одно полотно и одна панель, без карточного шума.
Проверена читаемость текста и primary action по палитре; вторичный текст на
canvas >=4.5:1 в обеих темах, primary label >=6:1. Границы полей >=3:1.
Артефакты: /tmp/cover-image-tools-acceptance/checks.json и screenshots.
Реальный платный/provider и authenticated browser flow не проверялся.

Проверенные перед активацией SHA256:
- dist/index.html: b684cd3672389ce621c2b59cf3de0c2255a2ecb7c9a85b433915ad84bfa3d936
- release script: 443e22204894d07b0c24d73b1185777b0fc57beb64ebd85e0878d998c09bd78d
- verify script: 7305ee78e6fe0a3f76a5b2cd7137ddf9108395f165346f130d3dc1c7e5c31153

Добавлено 15 hashed assets, проверено совпадение всех 25 файлов candidate,
сохранены 63 прежних файла. server/index.js прежний, index owner/mode корректны.
Сервис active/running, PID287033, NRestarts0, время старта осталось 20:11:00 UTC.
Локальные health {ok:true} и capabilities {gemini:true}. Entry JS через локальный
HTTP совпадает с candidate (fec37d34414d801e93402eea7c619ce20398e76c451f37201cd6e89d8a1dc844).
Публичный root и asset без сессии возвращают HTTP302; authenticated public
доставку и реальную генерацию эта проверка не доказывает. Обход авторизации не делался.
Backup хранит previous/candidate dist, frontend-source, release/verify scripts,
release-note и checks. Старый index доступен для guarded rollback.
Commit: нет; Push: нет — пользователь не запрашивал. Защищённые пути не менялись.
