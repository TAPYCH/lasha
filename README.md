# Апсны-Гид

PWA + Express API (туры, отели, авторизация, загрузки).

## Что хранит админку и пользователей

| Путь | Содержимое |
|------|------------|
| `server/data/tours.json` | экскурсии, описания, ссылки на медиа |
| `server/data/hotels.json` | отели |
| `server/data/users.db` | пользователи и профили (SQLite) |
| `server/uploads/` | загруженные фото/видео (пути вида `/uploads/...` в JSON) |

Всё это **входит в репозиторий**, кроме временных файлов `users.db-wal` / `users.db-shm` (см. ниже).

### Перед `git add` / push

1. Останови локальный сервер (`Ctrl+C`), если запущен.
2. В каталоге `server` выполни слияние WAL в основной файл БД:

```bash
cd server
npm run db:checkpoint
```

3. Убедись, что в коммит попали `server/data/tours.json`, `hotels.json`, `users.db` и папка `server/uploads/`.

Репозиторий лучше сделать **приватным** на GitHub: в БД есть хеши паролей и данные пользователей.

## Сервер (Ubuntu): установка с нуля

Подставь свой URL репозитория и домен позже.

```bash
apt update && apt upgrade -y
apt install -y git nginx ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

mkdir -p /var/www && cd /var/www
git clone https://github.com/ВАШ_ЛОГИН/ВАШ_РЕПО.git lasha
cd lasha/server
npm install --omit=dev

openssl rand -hex 32
```

Сохрани вывод `openssl` как секрет и запусти приложение (подставь `JWT_SECRET`):

```bash
cd /var/www/lasha/server
JWT_SECRET='ВСТАВЬ_СЮДА' NODE_ENV=production PORT=8080 pm2 start server.js --name apsny-guide
pm2 save
pm2 startup
# выполни команду, которую выведет pm2 startup
```

Проверка:

```bash
curl -s http://127.0.0.1:8080/api/health
```

Дальше: в nginx прокси на `127.0.0.1:8080` и Let's Encrypt (Certbot) — когда будет домен.

## Локально

```bash
cd server
npm install
npm start
```

Открыть в браузере: `http://localhost:8080`.

## GitHub: первый раз

До первого коммита ветки `master` может не быть под именем `main`. Сделай так:

```powershell
cd $HOME\Desktop\lasha
git checkout -b main
git commit -m "Апсны-Гид: исходники, данные админки и загрузки"
git remote remove origin   # если добавлял неверный URL-заглушку
git remote add origin https://github.com/ЛОГИН/РЕПО.git
git push -u origin main
```

Если видишь **`index.lock`**: закрой Cursor/Git GUI, удали файл `.git\index.lock`, повтори `git commit`.

## Ошибка better-sqlite3 / NODE_MODULE_VERSION

Нативный модуль собран под другую версию Node (например, обновили Node до v24, а пакет ставили под v20).

1. Полностью **останови** `node server.js` и любые процессы, которые держат порт 8080.
2. В папке `server`:

```powershell
cd server
Remove-Item -Recurse -Force node_modules\better-sqlite3\build -ErrorAction SilentlyContinue
npm install
npm run db:checkpoint
```

Если снова **`EBUSY` / `EPERM`**, перезагрузи ПК или закрой антивирус на минуту и повтори. Для стабильности локально удобно стоять на **Node 20 LTS** (как на сервере в инструкции выше).

