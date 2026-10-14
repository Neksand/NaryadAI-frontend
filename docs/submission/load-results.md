# Нагрузка (локальный стенд, честные цифры)

Метод: `NaryadAI-FastAPI-Backend/scripts/load.py` (только stdlib), уровни 1/10/50 коннектов по ~5с.
Воспроизведение: `PYTHONPATH=<backend> .venv/bin/python scripts/load.py` при поднятом API.
Сырые данные прогона — в JSON ниже (сводка).

| Эндпоинт | conc | RPS | p50 | p99 | Ошибки |
| --- | --- | --- | --- | --- | --- |
| GET /dict/equipment | 1 | 238 | 4мс | 7мс | 0 |
| GET /dict/equipment | 10 | 1235 | 7мс | 15мс | 0 |
| GET /dict/equipment | 50 | 1362 | 35мс | 70мс | 0 |
| GET /analytics/dashboard | 1 | 224 | 4мс | 6мс | 0 |
| GET /analytics/dashboard | 10 | — | — | — | 3697 conn-errors из 9892 |
| GET /analytics/dashboard | 50 | — | — | — | 13920 conn-errors из 14148 |
| POST /auth/login (nouser, 401) | 1 | 15 | 65мс | 68мс | 0 |
| POST /auth/login (nouser, 401) | 10 | 16 | 611мс | 944мс | 0 |
| POST /auth/login (nouser, 401) | 50 | 16 | 3020мс | 3141мс | 0 |
| GET /work-orders?limit=50 | 1 | 183 | 5мс | 8мс | 0 |
| GET /work-orders?limit=50 | 10 | 1072 | 9мс | 13мс | 0 |
| GET /work-orders?limit=50 | 50 | 1100 | 45мс | 64мс | 0 |

## Границы (не замалчиваем)

1. **Dashboard не держит 10+/50 конкурентных** — тяжёлый агрегирующий запрос + пул `min 1 / max 20`/`command_timeout 5` (`app/db.py:11`): коннекты отваливаются. На 1 коннекте чисто (224 RPS, p99 6мс). Follow-up: разбить запрос/кеш/индексы, затем перемерить.
2. **Логин ~16 RPS** — цена scrypt/argon-хеша (~65мс). Это защита от перебора, а не баг; под нагрузкой латентность растёт очередью. Тесты бьют по несуществующему логину — сид не жжётся.
3. Замеры dev-стенда (docker на ноутбуке), не прод. Стенд после прогона жив (health/login 200).
