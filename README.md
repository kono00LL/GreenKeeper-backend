# GreenKeeper Backend

Node.js community API with SQLite storage. The first version supports email registration and login, access and refresh tokens, post browsing, and post collections.

完整接口说明见 [docs/核心/API.md](./docs/核心/API.md)。

## Requirements

- Node.js 20 or newer
- npm

## Run

```sh
npm install
cp .env.example .env
npm start
```

The service listens on `http://localhost:8080` by default. SQLite data is stored in `data/greenkeeper.sqlite`; the first startup inserts three basic and seven longer sample plant care articles. Existing databases receive the seven additional articles once, while existing posts are preserved. Set `JWT_SECRET` to a long random value before exposing the service beyond local development.

## API

All request and response bodies use JSON. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`.

### Health

- `GET /health`

### Authentication

- `POST /user/register` and `POST /user/login` return `user`, `access_token`, and `refresh_token`.
- `GET /user/refresh` accepts `Authorization: Bearer <refresh_token>` and rotates both tokens.
- `GET /user/userinfo`, `PUT /user/userinfo`, and `POST /user/logout` manage the authenticated user session.
- `POST /auth/*` and `GET /auth/*` authentication routes remain available as compatibility aliases.

Send access tokens on protected routes as `Authorization: Bearer <accessToken>`.

### Posts and collections

- `GET /posts?page=1&pageSize=10` returns posts ordered newest first and pagination metadata, ordered images, collection counts, and viewer collection state. `pageSize` accepts 1 to 50.
- `GET /posts/:id` returns a post detail.
- `PUT /posts/:id/collection` with `{ "collected": true }` collects a post; set `false` to remove it. Repeating either request is safe; the response includes the authoritative collection count.
- `GET /me/collections` returns the authenticated user's collected posts.

## Development and tests

```sh
npm run dev
npm test
```

Tests use an in-memory SQLite database and do not modify the local data file.

### Community browsing details

Public reads accept guests. If an Authorization header is supplied it must contain a valid access token (invalid/expired tokens return 401). Existing single covers are backfilled into `post_images` without deleting user data. Post content remains plain text.

For browser clients, configure `CORS_ORIGINS` with a comma-separated allowlist of frontend origins. The default permits `http://localhost:8081` and `http://127.0.0.1:8081`. Native clients require no CORS configuration.

Community regression tests cover migration, stable pagination, no-image posts, authorization, collection isolation/idempotency, and browser preflight. Run `npm test`; all fixtures use in-memory databases.
