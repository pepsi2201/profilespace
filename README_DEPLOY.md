# ProfileSpace — публикация в интернете

Проект подготовлен для Render.

## Вариант 1 — Render + GitHub

1. Создай репозиторий на GitHub и загрузи содержимое этой папки.
2. Открой Render и создай **New → Blueprint**.
3. Подключи GitHub-репозиторий.
4. Render увидит `render.yaml` и создаст web service.
5. В сервисе должен быть подключён persistent disk `/var/data`.
6. После деплоя Render выдаст публичный адрес вида `https://...onrender.com`.

Важно: SQLite и фото сохраняются на persistent disk. Без постоянного диска данные на Render могут исчезнуть после перезапуска/деплоя.

## Вариант 2 — обычный Node.js сервер

```bash
npm install
set NODE_ENV=production
set SESSION_SECRET=сложный-секрет
npm start
```

Для Linux/macOS:
```bash
NODE_ENV=production SESSION_SECRET='сложный-секрет' npm start
```

Сервер слушает `PORT` и `0.0.0.0`, поэтому его можно разместить за reverse proxy.

## Что уже настроено

- регистрация и вход;
- профили и фото;
- общий feed;
- посты;
- лайки;
- подписки;
- личные сообщения;
- SQLite в `/var/data/data.sqlite`;
- фото в `/var/data/uploads`;
- `SESSION_SECRET` берётся из переменной окружения;
- HTTPS cookie включается в production;
- health check: `/api/health`.
