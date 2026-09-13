# Cover — широкая панель и референсы

## Фактический выпуск

Активировано 2026-09-11, post-check 22:06:07 UTC. Production index SHA256:
`49e5a9238b78e40ecde9168a1bbf3caffdd15dec38ff241ee8ba9d3ce64f9cb9`.
Добавлены 19 файлов; все 26 файлов candidate совпали, 44 прежних файла
сохранены. server/index.js прежний; owner/mode index корректны.
Сервис active/running, PID287033, NRestarts0, старт остался 20:11:00 UTC.
Локальный health: {ok:true}, capabilities: {gemini:true}.

TypeScript,30тестов/9файлов,build,offline browser-check прошли. Независимое
обязательное HIGH review (gpt-5.6-sol) — PASS без блокирующих замечаний;
reviewer отдельно повторил types/tests/build и проверил точные хеши релиза.
Rehearsal publish+rollback: `/tmp/cover-release-rehearsal-Br74wl` — pass.
Backup `/var/backups/cover-image/20260911-refinements-350720e` содержит old/new
dist, точный frontend-source, release.mjs, verify.mjs, release-note.md и checks.
Старая версия сохранена, реальные данные не удалялись. Commit/push не сделаны.
Authenticated live browser-flow и настоящая платная генерация не проверялись.

## Состав

2026-09-11. Worktree: `/srv/projects/web/AI-cover-worktrees/refinements-20260911`,
ветка `redesign-refinements-20260911`. База: точные frontend-исходники первого
релиза в `foundation-20260911`, git HEAD350720e плюс сохранённый diff. Предыдущий
worktree и его uncommitted изменения не тронуты. Текущий production index до
выпуска: `4bdc89c15f3199fd553f8217c00f1c02f899e44a160cf20b7af0e6b4a60efdd5`.

## Изменения

- Панель Create: 400–480 px на desktop, 360 px на небольшом desktop, одна колонка
  на мобильном. Слоты сцены и кнопки загрузки занимают доступную ширину.
- Локальный Manrope variable с кириллицей: body 15/24, заголовок 26/34 600,
  подписи 13px. Существующий знак Cover сохранён. Удалён внешний Google Fonts
  CSS-запрос. Font source: установленный Google Fonts `ofl/manrope`; файл
  неизменённый, 165420 bytes; OFL поставляется в `/fonts/manrope-OFL.txt`.
- Референс всегда доступен в панели: загрузить файл, открыть сохранённые,
  посмотреть или убрать выбранный. Native dialog с поиском, именами и крупными
  превью без обрезания. Отменяемый запрос; неудачный выбор не меняет предыдущий
  референс и его описание композиции. Ошибка показана в диалоге.
- Страница референсов: компактная шапка, поиск, удобная сетка и названия,
  подтверждение удаления. Существующие формы сохранения и анализа сохранены.
- Страницы «Видео» и «Библиотека» удалены из навигации и lazy render/imports.
  Осталось 7 разделов. Файлы этих компонентов оставлены в исходниках для
  восстановления; их страницы не включаются в новую сборку. Сохранённые
  видео в Истории/Избранном и импорт карт в Create не удалены.

Профиль server, риск HIGH, обязательное свежее Sol review. Skills:
frontend-design, google-fonts, browser-testing-with-devtools, shipping-and-launch.
Защищены server/**, package.json/lock, MySQL, uploads, env и SSO. Никаких миграций,
новых зависимостей, внешних шрифтов или удаления данных.

## Проверка и выпуск

Канонические команды: `npm run lint`, `npm run test`, `npm run build`.
Offline browser-check: `scripts/test-redesign.mjs` с установленным Playwright
OpenDesign; screenshots `/tmp/cover-refinements-acceptance`. Все HTTP-пути
перехватываются; платные операции и настоящая БД не вызываются. Проверяются
7 вкладок, выбор/поиск референса, local font, широкая сцена, theme/state,
mobile modal/focus, семь ширин, прежний генерационный fixture flow.
Live authenticated browser-flow и реальный провайдер таким тестом не доказаны.

Публикация только статики по `/tmp/cover-refinements-release.mjs`:
полная копия старого dist + нового dist + точного frontend source + checks,
добавление hashed assets и одного разрешённого OFL-файла, затем atomic index.
Старые assets не удаляются. Новый backup:
`/var/backups/cover-image/20260911-refinements-350720e`.
Перед запуском обязательны review текущих хешей и повторная rehearsal
публикации/отката. Без рестарта процесса и изменения server/env/БД.

```sh
sudo -n flock -n /run/lock/cover-foundation-release.lock node /tmp/cover-refinements-release.mjs deploy
# Только при необходимости отката именно этого активного релиза:
sudo -n flock -n /run/lock/cover-foundation-release.lock node /var/backups/cover-image/20260911-refinements-350720e/release.mjs rollback
```

Реальный статус активации фиксируется после post-check отдельно. Commit/push
не запрашивались. Пользователь отдельно подтвердил выкладку на свой сервер.
