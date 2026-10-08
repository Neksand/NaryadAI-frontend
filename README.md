# НарядAI Frontend

React + TypeScript + Vite + Tailwind + React Router + TanStack Query + Zod + Axios + Zustand + i18next (русский + казахский) + PWA.
Реальный клиент существующего FastAPI-бэкенда (`NaryadAI-FastAPI-Backend/`). Никаких моков: кнопки из `allowed_actions`, причины из справочника `reasons`, все данные с сервера. На сервер уходят только английские коды (`worker`, `in_progress`, `no_materials`…).

## Запуск

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # + typecheck
npm run preview
npm run check:contract  # безопасные GET-проверки живого бэкенда (health + openapi paths)
```

## Env

```sh
cp .env.example .env.local   # и поправьте под свой стенд
```

| Var | Dev (seed) | Live | Prod |
|---|---|---|---|
| `VITE_API_URL` | `http://localhost:8080/api/v1` | `http://79.108.160.125:8080/api/v1` | `https://api.naryad-ai.kz/api/v1` |
| `VITE_WS_URL` | `ws://localhost:8080/api/ws` | `ws://79.108.160.125:8080/api/ws` | `wss://api.naryad-ai.kz/api/ws` |

Только env меняются при переезде dev → prod, код не трогаем.

## Демо-стенд

Поднимите seeded backend локально (seed даёт `admin/1234`, `master1/3333`, `manager1/2222`, `worker01/1001`…):

```sh
cd ../NaryadAI-FastAPI-Backend
python -m scripts.migrate && python -m scripts.seed
uvicorn app.main:app --reload  # :8080
```

Live-бэкенд (`79.108.160.125:8080`) — прод-сид отключён, демо-ПИНы там НЕ работают (ожидаемо `401`). Для хакатон-демо используйте локальный сид.

## Маршруты

`/login` → `/worker` (мобайл) · `/master`, `/master/board`, `/master/new`, `/master/orders/:id`, `/master/review/:id` ·
`/manager` · `/admin` · `/notifications`. Редирект по роли после `GET /me`.

## Что реализовано

Auth (login/refresh/logout/me, 401→refresh, 423 lock), РО allowed_actions, worker lifecycle + reason sheets + complete-форма,
before/after фото (сжатие 1600px q0.8, прогресс), AI suggest/recommend/inspect + вердикт, master приёмка (agree/rework),
WS `/api/ws?token=` + seq-gap refetch + reconnect, уведомления (unread badge, read/read-all, toasts через инвалидацию),
аналитика dashboard/insights/ratings + plan-order, админ dict-CRUD, ru/kk, cursor-пагинация, offline-очередь IndexedDB
с reuse Idempotency-Key, PWA manifest + service worker, skeletons/empty/error везде.

## Проверка хакатон-флоу (вручную, 10 мин)

1. `master1/3333` → Смена → Выдать аварийный наряд (течь масла), AI-подсказка → назначить `worker01`.
2. `worker01/1001` → принять → начать → after-фото → завершить (work_done + fault code).
3. Дождаться `ai_review` (≤30с) → как мастер открыть приёмку → закрыть.
4. Просрочка: создать наряд с `due_at` в прошлом → баннер + фильтр overdue → вернуть в rework.
5. Как `manager1/2222` → аналитика, инсайты, рейтинги. Всё — живые данные, см. `scripts/e2e-demo.md`.
