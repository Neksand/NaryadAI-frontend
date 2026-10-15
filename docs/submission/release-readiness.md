> **Исторический материал исходного репозитория (`d906330`).** Числа, статусы проверок и эксплуатационные утверждения ниже относятся к прежней работе и не подтверждают текущий прогон. Актуальные функции, доказательства и ограничения перечислены в [матрице требований](../../../NaryadAI-FastAPI-Backend/CASE_REQUIREMENTS_MATRIX.md). Для текущего показа используйте обновлённые `presentation.html` и backend `DEMO_SCRIPT.md`.

# Release readiness

- Backend: 583 passed, coverage 94.25%, contract 14 paths, health /health/ready.
- Frontend: 510 unit + 14 e2e passed, lint/typecheck/build green.
- PWA: manifest + service worker собираются.
- Офлайн: очередь IndexedDB, 409-конфликты с объяснением, snapshot-кэш.
- Известно: ruff strict debt, FCM отсутствует (in-app+WS), E2E на моках.
