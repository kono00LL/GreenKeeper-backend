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

## Debugging

Development mode prints every HTTP request and uncaught server error in the backend terminal. Start it with:

```bash
npm run dev
```

To force the same logs when `NODE_ENV=production`, set `DEBUG=1`. The response still hides internal error details from clients; inspect the backend terminal for the stack trace.

## API

### Photo identification (Pl@ntNet)

Set `PLANTNET_API_KEY` in the ignored backend `.env` and restart `npm run dev`. The key is optional: without it only identification returns `503 IDENTIFICATION_NOT_CONFIGURED`. Never expose this key through an `EXPO_PUBLIC_` variable.

`POST /plant-identifications` requires an access token and a single multipart `image` file (JPEG/PNG, at most 10 MiB). It returns `{ bestMatch, candidates: [{ scientificName, commonNames, score }] }` with up to three candidates. No match returns `200` with `bestMatch: null` and an empty candidate list. Scores are model matching scores, not accuracy guarantees.

The backend sends binary files to Pl@ntNet, cleans up temporary files after completion, and does not store photos or identification history. Object storage and publicly accessible image URLs are unnecessary. Requests use the `all` project, `lang=zh`, `nb-results=3`, a 25-second upstream timeout and no automatic retries. Pl@ntNet credential failures map to `503`, limits to `429`, network/invalid-response errors to `502`, and timeouts to `504`. Error logs contain only the category, upstream status and duration.

```bash
curl --request POST http://localhost:8080/plant-identifications \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --form 'image=@/absolute/path/to/plant.jpg'
```

Tests inject a fake Pl@ntNet client and never use real quota. See `openapi.yaml` for the complete contract.

Except for multipart image requests and image downloads, request and response bodies use JSON. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`.

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
- `POST /images` accepts one authenticated multipart image in the `image` field (JPEG, PNG, or WebP; maximum 10 MiB). `IMAGE_STORAGE=local` (default) stores it under `DATA_DIRECTORY/uploads`; `IMAGE_STORAGE=cos` stores it in Tencent COS. Both return a stable public application URL at `/uploads/:key`. COS reads redirect to a short-lived signed HTTPS URL, allowing the bucket to remain private. See [COS 配置与历史图片迁移](COS_STORAGE.md).

## Development and tests

### Plant library reads

- `GET /plants/categories` returns `{ categories }`, ordered by the database category sort order, including `plantCount`.
- `GET /plants?category=ferns` returns `{ items }` for a category. Omit the filter to list all plants once; an empty, repeated or unknown category filter returns `400 INVALID_CATEGORY`. Each plant includes every category it belongs to.
- `GET /plants/:id` returns `{ plant }`, including identity review status, aliases, categories, nullable introduction and care fields. Missing plants return `404 PLANT_NOT_FOUND`.

These read-only endpoints are public and do not modify the database or require authentication. They include pending starter candidates for the current preview; `identityStatus: pending` does not imply a verified identity. Images and personal garden writes are not part of these endpoints. See `openapi.yaml` for response types.

```sh
npm run dev
npm test
```

Tests use an in-memory SQLite database and do not modify the local data file.

### Community browsing details

Public reads accept guests. If an Authorization header is supplied it must contain a valid access token (invalid/expired tokens return 401). Existing single covers are backfilled into `post_images` without deleting user data. Post content remains plain text.

For browser clients, configure `CORS_ORIGINS` with a comma-separated allowlist of frontend origins. The default permits `http://localhost:8081` and `http://127.0.0.1:8081`. Native clients require no CORS configuration.

Community regression tests cover migration, stable pagination, no-image posts, authorization, collection isolation/idempotency, and browser preflight. Run `npm test`; all fixtures use in-memory databases.

### 扩充植物资料与识别关联

已提供 100 种室内／阳台植物资料清单、安全导入和逐条核对报告，详见 [植物资料库说明](PLANT_CATALOG.md)。`npm run plants:catalog` 只读预检；`npm run plants:catalog -- --apply` 备份后导入，遇到人工资料冲突整批停止。

识别候选返回 `scientificNameWithoutAuthor` 和 `localMatch`；仅唯一、已核对且已发布的植物提供本地详情 UUID，接口契约见 `openapi.yaml`。
