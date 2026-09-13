# Cover — видимый выбор моделей и редактор «Обложка»

## Scope и направление

2026-09-11. Worktree `/srv/projects/web/AI-cover-worktrees/model-picker-20260911`,
ветка `redesign-model-picker-20260911`, базовый HEAD350720e. Точные исходники
предыдущего опубликованного image-tools-20260911 перенесены без изменений до
начала нового среза. Предыдущие worktrees сохранены. Commit/push не запрашивались.
Пользователь отдельно подтвердил production deploy переименования и выбора моделей.

Проблема: четыре активных места выбора модели используют разные элементы;
выпадающий список скрывает доступные варианты. «HS-обложка» слишком техническое
название. Старые тёмные поверхности редактора плохо согласованы со светлой темой.

Сохраняем шесть разделов, их порядок и идентификаторы, локальный Manrope,
мягкую нейтральную палитру с зелёным акцентом, работу редактора и API.
Навигация и h1 теперь «Обложка». Один общий ModelPicker: компактные видимые
radio-варианты с локальным изображением логотипа, названием, провайдером и
описанием выбранной модели. Четыре варианта редактора располагаются 2×2.
Выбранный вариант отличается и фоном, и отметкой; есть focus, hover, active,
disabled, управление стрелками и fallback при ошибке изображения.

Использован оригинальный Gemini SVG из Google gstatic, без изменения логотипа;
происхождение записано в src/assets/model-logos/README.md. Браузер не обращается
к внешнему CDN за логотипом. Новые провайдеры добавляются отдельными option-
записями с собственным logoSrc; серверная поддержка новых моделей в этот срез
не входит. Все текущие model IDs сохранены, включая отдельные ID редактора.
Ограничения Pro 512px→1K и Thumbnail Lite/2.5→1K сохранены.

Поверхности, подписи, поля и кнопки редактора приведены к существующим tokens.
Из пустого превью убран декоративный градиент. Canvas, текст на изображении,
деревянная рамка и PNG-экспорт не изменены. Мобильная сетка не опирается на
min-content ширину панели. Изображения не фильтруются и не перекрашиваются.

## Проверки и границы

Профиль server, риск HIGH. Skills: frontend-design,
browser-testing-with-devtools, shipping-and-launch. Luna scout завершён;
свежий независимый Sol review обязателен до активации.
Защищены server/**, package.json/lock, env, SSO, MySQL и uploads.
Новые зависимости, серверные изменения и рестарт не нужны.

Канонические проверки: npm run lint, npm run test, npm run build.
Добавлены проверки native radio/disabled/fallback/будущего провайдера,
совместного состояния модального окна и Create, ограничения разрешений.
Offline Chromium: scripts/test-redesign.mjs, артефакты
`/tmp/cover-model-picker-acceptance`; все HTTP-запросы отвечают локальные fixtures.
Проверяются четыре выбора моделей, ID запросов, клавиатура, обе темы,
7 ширин от 320 до 1920, реальный canvas и скачивание PNG 1920×1080.
Это не проверка authenticated production flow или платного провайдера.
Dependency audit: 0 high/critical, прежние 1 low и 1 moderate; зависимости не менялись.

## Static-only выпуск и откат

Release script: `/tmp/cover-model-picker-release.mjs`.
Verification: `/tmp/cover-model-picker-verify.mjs`.
Backup: `/var/backups/cover-image/20260911-model-picker-350720e`.
Ожидаемый прежний index SHA256:
`b684cd3672389ce621c2b59cf3de0c2255a2ecb7c9a85b433915ad84bfa3d936`.
Ожидаемый server/index.js SHA256:
`cf91242d9b3cb52db122be7d4c5aedbf2573a9d5ccefc42ccca62a73aa0efb7a`.

Скрипт проверяет baseline и коллизии, сохраняет previous/candidate dist,
точные frontend-source и checks. Hashed assets добавляются без перезаписи
старых; index заменяется атомарно под общим lock. Rollback разрешён только
для точного активного candidate и сохраняет assets открытых ранее сессий.
Процедура publish+rollback проверяется в отдельном временном каталоге.

```sh
sudo -n flock -n /run/lock/cover-foundation-release.lock node /tmp/cover-model-picker-release.mjs deploy
# Только при необходимости отката этого активного выпуска:
sudo -n flock -n /run/lock/cover-foundation-release.lock node /var/backups/cover-image/20260911-model-picker-350720e/release.mjs rollback
```

## Фактический статус

Перед активацией: TypeScript, 47 тестов / 12 файлов, production build,
git diff --check и offline Chromium PASS. Обе темы и мобильные screenshots
просмотрены; выбор модели заметен, canvas не фильтруется, прежнее игровое
оформление остаётся только внутри редактируемого изображения. Все десять
групп браузерных проверок прошли, page errors и missing assets отсутствуют.
Исходники server и dependency files не изменены. Audit сообщает прежние
2 уязвимые зависимости (1 low, 1 moderate); это не чистый audit PASS.

Publish+rollback rehearsal финальной сборки:
`/tmp/cover-release-rehearsal-HRFCTG`, PASS, production не затронут.
Проверенные SHA256:
- candidate index: `a8238e23f4b3641abbdc117d539d5e30d910c33d0bcd4a3a36e0b5be024c033a`
- release script: `f3d3f28507b74c8ee91551b8f53734fb4603bd1338af7518237920d1392391d3`
- verify script: `bc5d5c85c2985a02df9ded6767a16c909a277aa76af5348e7253b85a5794ada8`

Свежий независимый Sol review `/root/model_picker_release_review` — PASS
для точного candidate и scripts выше, блокирующих замечаний нет. Reviewer
проверил delta к реально опубликованному baseline, артефакты и rollback;
не запускал production flow.
Публичный сайт без сессии направляет на SSO; успешные origin/disk проверки
не означают проверки входа и реальной генерации. Обход авторизации не делается.

Активировано 2026-09-11; post-check 23:18:54 UTC. Добавлено 14 hashed assets,
все 26 файлов candidate совпадают с manifest; сохранены 78 прежних файлов.
Владелец/права index корректны. Серверный файл прежний. Сервис active/running,
PID287033, NRestarts0, время старта осталось 20:11:00 UTC.
Локальный origin отдаёт точный новый index и entry `/assets/index-CuLpzsJR.js`;
SHA256 entry `19db3c1515b8b3066a09044bf430245b850571601475aa3b99d17e5a772ee3e4`.
Health `{ok:true}`, capabilities `{gemini:true}`. Публичный root без сессии
HTTP302 на hearthpulse.net/api/auth/cover/start, query не раскрывался.
Authenticated live browser flow и платная генерация не проверены.
Backup содержит previous/candidate dist, frontend-source, checks, release script;
verify script и итоговая release-note добавляются отдельными файлами без перезаписи.
Commit: нет; Push: нет — отдельного запроса не было. Scope guard PASS;
server/package/lock не изменены, production DB/uploads/env/SSO не затронуты.
