# Архитектура НарядAI

## Компоненты

| Слой | Технологии |
|---|---|
| API | FastAPI (Python), JWT HS256 (`iss=naryadai-api`, access ~900 с, refresh ~30 д, ротация) |
| Данные | PostgreSQL (транзакции + неизменяемый журнал событий нарядов), Redis (фон/кэш), S3-совместимое хранилище (фото, приватный бакет, signed URL 300 с) |
| Клиент | React PWA (Vite, manifest + service worker) + Tauri-обёртка (`src-tauri/`, `VITE_TAURI=1` сборка, Android-конфиг) |
| ИИ | `AI_MODE=mock` (локальные правила, без ключей) / `external`: локальный Estimin3n на ноутбуке либо серверный Gemini (текст/фото) + Groq Whisper (аудио) |

Источник контракта: `FRONTEND_CONTRACT.md` (10 разделов) — истина по локальному коду бэкенда, его OpenAPI и миграциям.

## Ключевые решения

- **Сервер — финальный арбитр.** Фронт рисует кнопки только из `allowed_actions` (`GET /work-orders/:id`); mismatch → `409 invalid_transition`. Скоупы ролей (`worker|master|manager|admin`) проверяются на сервере; фронт-роутинг — только UX.
- **Realtime без внешних push.** WebSocket `GET /api/ws?token=<JWT>` (алиас `/ws`), каналы `user:{id}|user:me`, `order:{uuid}`, `shift:*`, `manager`. Envelope `{event, channels, payload, seq, at}`; пропуск `seq` → инвалидация и перезапрос. События: `WORK_ORDER_*`, `AI_INSPECTION_*`, `DEADLINE_*`, `counters.updated`, `insight.created`. Reconnect 1/2/4/8/15 с + баннер. Уведомления persistятся в БД (in-app + WS).
- **Transactional outbox.** События пишутся в одной транзакции с мутацией (`app/services/background.py`, `app/routers/work_orders.py`), развозятся фоновыми воркерами — без потерь. Дедлайны мониторит планировщик.
- **Идемпотентность / офлайн.** Все POST-мутации шлют `Idempotency-Key: <UUID>`, один UUID на логическую операцию; повтор — тем же ключом. Офлайн-очередь IndexedDB (`accept|queue|start|pause|resume|complete`, `client_at ≤ 24 ч`), реплей по порядку. Серверный fallback `auto-<uuid>` — без реплея.
- **ИИ — advisory.** Вердикты `accepted|accepted_with_remarks|needs_rework|needs_master_review`, `score 0–100`, `confidence`, `checks{completeness|relevance|materials|timing|photos}`. `needs_rework` авто-переводит в `rework`; закрывает всегда мастер (`review/decision: agree_ai|override`). `conf < 0.6 → needs_master_review`. Без ключей работает mock-профиль.
- **Фото.** `POST /photos` (before, до создания) и `POST /work-orders/:id/photos` (multipart), caps 5×before / 10×after, JPEG/PNG/WebP ≤ 10 МБ, dedupe SHA256+dHash, клиентское сжатие (1600px q0.8 + thumb 320px). `kind=unplanned` требует ≥1 after-фото.
- **Отчёты async.** `POST /reports/export {type, format: pdf|xlsx} → 202 {job_id} → GET /reports/export/:job_id → {signed_url}`.
- **Ошибки.** Единый формат `{error:{code, message, translation_key}, request_id}`, `translation_key → src/i18n/{ru,kk}.ts`, интерфейс RU/KK.

## Честные границы

- Push — только in-app + WS, **без FCM** (по контракту, раздел 7).
- E2E-прогоны — **на моках** (`page.route(**/api/v1/**)`), не живой PostgreSQL-стенд; физические телефоны в этом прогоне не использовались.
- Backend `ruff strict` (237 ошибок) и `mypy` — техдолг, в CI остаётся lenient gate.
- Демо-логины работают только на seeded dev; на live-проде seed отключён (`401` ожидаем).
