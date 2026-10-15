> **Исторический материал исходного репозитория (`d906330`).** Числа, статусы проверок и эксплуатационные утверждения ниже относятся к прежней работе и не подтверждают текущий прогон. Актуальные функции, доказательства и ограничения перечислены в [матрице требований](../../../NaryadAI-FastAPI-Backend/CASE_REQUIREMENTS_MATRIX.md). Для текущего показа используйте обновлённые `presentation.html` и backend `DEMO_SCRIPT.md`.

> ИСТОРИЧЕСКИЙ ОТЧЁТ до изменений 14.10.2026. Числа и утверждения ниже не подтверждены текущим прогоном. Актуальные результаты и ограничения: [TEST_REPORT.md](../../../NaryadAI-FastAPI-Backend/TEST_REPORT.md).

# Verification summary (факт / граница)

| Проверка | Факт | Граница |
|---|---|---|
| Backend тесты | 808 passed (+1 skip) | — |
| Backend покрытие | 94.8% lines / 90.2% branches | Порог 90% пройден; `coverage.json` обновлён свежим прогоном |
| Frontend unit | 510 тестов, 51 файл — passed | — |
| Frontend E2E | 142/144 passed (+2 skip: условные guard'ы), 52 файла: все живые против настоящего API (моки — 0) + live full-cycle 13/13 | CI-guard: без стенда скип |
| Live full-cycle | 13/13 против настоящего API (`docs/submission/public-smoke.json`): выдача→видна ~15мс, принятие→видно ~15мс, double-accept 409, AI-ready 4–53с (зависит от загрузки воркера), close→closed | Замеры локального стенда, не прод |
| Новые фичи из живых тестов | QR-карточка `/equipment/:id` + by-qr поиск; ассистент `/assistant` (Q&A с citations); Excel-импорт endpoint (dry-run/атомарность) | Импорт-UI в работе |
| Live-баги, убитые живыми тестами | plan-order 500→200 (due_at str→datetime), confidence "0.520"→0.52 (Decimal→float), PDF failed→валидный PDF (fallback шрифтов) | Проверено живьём после рестарта |
| AI evidence | 67/67 mock (100%/100%/0%) + Estimin3n v1 52,5% / v2 22,5% на 40 кейсах (backend `docs/AI_RESEARCH.md`) | Малая локальная LLM хрупка к промпту — поэтому конвейер «правила→LLM→пост-правила»; сравнение с большими моделями на GPU некорректно |
| Нагрузка | equipment 1362 RPS p99 70мс, orders 1100 RPS, login 16 RPS, dashboard падает на 10+ коннектах (`docs/submission/load-results.md`) | Dev-стенд; dashboard — честный провал под нагрузкой, follow-up открыт |
| Lint | `oxlint src` green | — |
| Typecheck | `tsc --noEmit` green | — |
| Build | Production PWA (Vite) и Tauri Android-конфиг собираются | Физические Android/iPhone в этом прогоне не использовались |
| Contract-check | 14 required paths present, health 200 | Проверяет наличие путей, не поведение сервера |
| PWA / офлайн | Manifest + SW, очередь IndexedDB, реплей без дублей, 409 с объяснением | Офлайн-прогон ручной, на демо-стенде |
| Push | In-app + WS | **FCM отсутствует** (честно по контракту) |
| Домен | Локальный стенд + env-прод `api.naryad-ai.kz` | **Live-домен не проверялся**, демо-логины только на seeded dev |
| Backend lint строгий | ruff select (`E,F,I,UP,B,SIM,RUF`) + format + mypy + mypy `--strict` clean (38 файлов) + wheel в CI, всё green | Остаток-долг с числами: E501 — 160, B008 — 99 (FastAPI DI-идиома, чинить нельзя), RUF001/2/3 — 54 (кириллица UI); `requirements.lock` (138 пинов) — repro-артефакт, CI ставит по `requirements-dev.txt` |
| ИИ | Mock-профиль без ключей; external: Estimin3n / Gemini + Groq | Внешние провайдеры на жюрийском стенде не вызываются |
