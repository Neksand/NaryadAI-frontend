# FRONTEND_CONTRACT.md — реальный контракт FastAPI-бэкенда НарядAI

> Источник истины: живой бэкенд `http://79.108.160.125:8080` (проверено 2026-10-08:
> `GET /openapi.json` → OpenAPI 3.1.0, 93 paths; `GET /health` → `{"status":"ok","database":"ok","ai":"mock"}`).
> Локальный источник: `NaryadAI-FastAPI-Backend/app/{main,routers/*,deps,errors,security}.py`, `migrations/001_initial.sql`.
> Приоритет: live behavior > live OpenAPI > source > README. Дизайн-токены: `NaryadAI-design/project/tokens.json` + `src/kit.css`.

## 1. База и окружение

| Назначение | Значение |
|---|---|
| Dev (seed, демо-логины работают) | `VITE_API_URL=http://localhost:8080/api/v1`, `VITE_WS_URL=ws://localhost:8080/api/ws` |
| Live dev (seed отключён, нужны реальные креды) | `VITE_API_URL=http://79.108.160.125:8080/api/v1`, `VITE_WS_URL=ws://79.108.160.125:8080/api/ws` |
| Prod (только env, без смены кода) | `VITE_API_URL=https://api.naryad-ai.kz/api/v1`, `VITE_WS_URL=wss://api.naryad-ai.kz/api/ws` |

URL только из env (`src/lib/env.ts`). CORS бэкенда уже разрешает `http://localhost:5173` (`.env.example: CORS_ORIGINS`).

## 2. Auth / токены / роли

- `POST /auth/login {login, pin:/^\d{4,8}$/}` → `{access_token, refresh_token, user}`. 5 неверных → `423 account_locked`.
- `POST /auth/refresh {refresh_token}` — ротация (старый отзывается). `POST /auth/logout [{refresh_token}]` → 204.
- `GET /me`, `GET /auth/me` (алиас), `POST /devices {platform, fcm_token}`, `PATCH /users/me/preferences {language: ru|kk}`.
- Access JWT HS256 `iss=naryadai-api`, claims `{sub, role, area_ids, crew_id, authv, sid}`, TTL ~900с; refresh ~30д. Заголовок `Authorization: Bearer …`, язык `Accept-Language: ru|kk`.
- Роли `worker|master|manager|admin`. Скоупы на сервере: master — по `area_ids`, worker — `assignee_id==id || crew==crewId`. Фронт-роутинг (`/worker/*`, `/master/*`, `/manager/*`, `/admin/*`) — только UX; RBAC финально на бэкенде.
- Демо (только seeded dev!): `admin/1234`, `master1/3333`, `master2/4444`, `manager1/2222`, `worker01..worker15/1001..1015`. На live-проде seed отключён — `401 unauthorized` ожидаем.

## 3. Наряды и state machine

- Статусы: `issued, accepted, queued, rejected, in_progress, paused, rework, done, ai_review, closed, cancelled`.
- Приоритеты: `critical, high, normal, planned` (маппинг спеки CRITICAL→critical, MEDIUM→normal, LOW→planned).
- Эндпоинты: `GET/POST /work-orders`, `GET /work-orders/my|my/active|my/history`, `GET/PATCH /work-orders/:id`,
  `POST /work-orders/:id/transitions {action, reason_code?, comment?, assignee_id?, form?, client_at?}` (предпочтительно),
  per-action алиасы `POST /work-orders/:id/{assign,accept,reject,start,pause,resume,complete,close,rework}`,
  `GET /:id/events|ai-review|report?audience=worker|master`, `POST /:id/review/decision {decision: agree_ai|override, score?, comment?}`,
  `POST /:id/materials {items:[{material_id, quantity}]}`, `GET /shift/board|summary`, `GET /equipment/:id/history`.
- **Фронт рисует кнопки ТОЛЬКО из `allowed_actions`** ответа `GET /work-orders/:id`. Mismatch → `409 invalid_transition` (`translation_key: error.invalid_work_order_state`).
- Создание: `{kind, description, description_source?, area_id, equipment_id, assignee_id XOR crew_id, priority, due_at, norm_minutes, equipment_stopped, comment, photo_ids}`.
- `complete.form = {work_done_text, fault_code_id, materials[], equipment_restored}`; `kind=unplanned` требует ≥1 `after`-фото.
- `PATCH` блокируется на терминальных `done|ai_review|closed|cancelled`.

## 4. Пагинация / фильтры

Курсорная: `?limit&cursor → {items, next_cursor}`. Фильтры: `status, priority, area_id, equipment_id, assignee_id, crew_id, overdue, from, to, shift, q`. Серверная фильтрация обязательна (не качать 500+ и не фильтровать в браузере).

## 5. Фото

`POST /photos` (до создания, `kind=before`, master) и `POST /work-orders/:id/photos` (multipart `file+kind=before|after`), `GET /work-orders/:id/photos`, `GET /photos/:id/url` (signed 300с). JPEG/PNG/WebP ≤ `MAX_UPLOAD_BYTES` (10 МБ), caps 5×before/10×after, dedupe SHA256+dHash. Клиент сжимает (1600px JPEG q0.8 + thumb 320px), прогресс на плитке, таймаут 10–30с, ретрай.

## 6. ИИ (advisory, `AI_MODE=mock` без ключей)

- `POST /ai/suggest-assignee {area_id, equipment_id, priority, description}` → топ-3 `{employee_id, score, reasons, confidence, explanation}`.
- `POST /ai/suggest-fault-code {description, equipment_id}` → `{fault_code_id|code|name|norm_minutes|confidence|alternatives}`.
- `POST /ai/work-orders/:id/recommend-worker`, `POST /ai/work-orders/:id/inspect` → `ai_jobs`, `GET /ai/work-orders/:id/inspection` (алиас `GET /work-orders/:id/ai-review`).
- Verdicts `accepted|accepted_with_remarks|needs_rework|needs_master_review`, `score 0–100`, `confidence`, `explanation`, `checks{completeness|relevance|materials|timing|photos}`. `needs_rework` авто-переводит в `rework`. Мастер решает отдельно (`review/decision`). `conf<0.6 → needs_master_review`.
- `POST /ai/transcribe` (multipart audio + `work_order_id?`) → `{text, confidence}`. `GET /ai/insights`.

## 7. Уведомления / realtime

- `GET /notifications[?unread_only&limit]`, `POST /notifications/:id/read`, `POST /notifications/read-all`. In-app + WS, без внешних push.
- WS: `GET /api/ws?token=<JWT>` (алиас `/ws`), `{op:subscribe, channels:[≤50]}` → `{type:SUBSCRIBED}`, `op:ping→PONG`.
  Каналы: `user:{id}|user:me`, `order:{uuid}`, `shift:current|shift`, `manager`. Envelope `{event, channels, payload, seq, at}`; пропуск `seq` → `invalidateQueries` (перезапрос экрана). События: `WORK_ORDER_* (order.created|transition|updated|rejected|reassigned|closed|ai_review_started|ai_review_ready)`, `AI_INSPECTION_*`, `DEADLINE_*`, `employee.status_changed`, `counters.updated`, `insight.created`. Reconnect 1/2/4/8/15с + баннер «связь восстановлена», подсветка карточки 2с.

## 8. Аналитика / отчёты / каталоги / админ

- `GET /analytics/{dashboard|overview|areas|areas/:id|equipment|equipment/ranking|equipment/:id|insights|insights/generate|patterns|downtime|materials|ratings|ratings/:id|quality|faults|trends|work-orders|workers|ai-insights}`, `PATCH /analytics/insights/:id {seen|in_plan|dismissed}`, `POST /analytics/insights/:id/plan-order {assignee_id xor crew_id, due_at}`, `POST /analytics/query {question, filters}`.
- Отчёты async: `POST /reports/export {type: orders|shift|ratings|materials|downtime|dashboard, format: pdf|xlsx, filters}` → `202 {job_id}` → `GET /reports/export/:job_id → {signed_url}`.
- Каталоги (чтение): `GET /sites|teams|equipment|materials|fault-codes`, `GET /equipment/by-qr/:token`. Мутации (admin): `GET/POST/PATCH/DELETE /dict/:type` (`areas|equipment|crews|employees|fault-codes|materials|norms|reasons`), `GET/PUT /settings/ai`, `GET /audit`, `POST /users/:id/reset-pin|unblock`, `GET /alerts`.
- Расширение контракта (локальный бэкенд, требует редеплоя сервера): `GET /dict/employees` и `POST /dict/employees` возвращают `area_ids`; `PATCH /dict/:id` для `employees` принимает `area_ids: string[]` и пересоздаёт привязки в `employee_areas`. Без участков мастер видит пустые списки везде (скоупы по `areaIds`).

## 9. Ошибки

`{error:{code, message, translation_key: "error.<code>", details?}, request_id}`. Коды: `unauthorized` 401, `forbidden` 403, `not_found` 404, `invalid_transition|conflict|idempotency_key_reused` 409, `validation_error` 422, `account_locked` 423, `file_too_large` 413, `rate_limited` 429. `translation_key` → `src/i18n/ru.ts`, `src/i18n/kk.ts` (интерфейс RU/KZ с переключателем, `Accept-Language` следует за выбором). Никогда не показывать stack trace.

## 10. Идемпотентность / офлайн

Все POST-мутации шлют `Idempotency-Key: <UUID>` (`src/lib/api-client.ts: idempotencyHeaders`). Один UUID на одну логическую мутацию; повтор той же операции — тем же ключом (иначе дубль). Офлайн-очередь (IndexedDB `naryadai.offline-queue`): `accept|queue|start|pause|resume|complete` с `client_at ≤24ч`; при reconnect — по порядку, затем инвалидация. `auto-<uuid>` серверный fallback — без реплея, поэтому фронт всегда шлёт настоящий UUID.
