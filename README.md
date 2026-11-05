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

Development mode prints structured HTTP request diagnostics and error details in the backend terminal. Each response includes `X-Request-ID`; the same ID appears in request logs so it can be matched with frontend diagnostics. Logs omit query strings, request bodies, and credentials; upstream integrations log only safe error categories and status metadata. Start development mode with:

```bash
npm run dev
```

Set `DEBUG=1` to force request metadata logs in production. Internal exception details remain development-only, and API responses keep their existing safe error format.

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

### AI plant-care advice (DeepSeek)

Set `DEEPSEEK_API_KEY` in the ignored `.env` to enable `POST /ai/plant-advice`. The optional settings are `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `DEEPSEEK_MODEL` (default `deepseek-flash`) and `DEEPSEEK_TIMEOUT_MS` (default `30000`). The endpoint requires an access token and accepts `{ "plantId": "...", "question": "..." }`; the backend loads the plant record, sends grounded system/user messages to DeepSeek's OpenAI-compatible `/chat/completions` endpoint, and returns `{ "answer": "...", "model": "..." }`.

The key never reaches the frontend. Missing configuration returns `503 AI_NOT_CONFIGURED`; upstream limits, failures and timeouts map to `429`, `502` and `504` without exposing provider response bodies or credentials. Tests inject a fake client and do not call DeepSeek.

Except for multipart image requests and image downloads, request and response bodies use JSON. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`.

### Health

- `GET /health`

### Authentication

- `POST /user/register` and `POST /user/login` return `user`, `access_token`, and `refresh_token`.
- `GET /user/refresh` accepts `Authorization: Bearer <refresh_token>` and rotates both tokens.
- `GET /user/userinfo`, `PUT /user/userinfo`, and `POST /user/logout` manage the authenticated user session.
- `POST /auth/*` and `GET /auth/*` authentication routes remain available as compatibility aliases.
- `POST /auth/email-code` sends a `login` or `password_reset` code through Tencent SES `SendEmail`; `POST /auth/email-code/verify` automatically registers a new verified email or signs in an existing account.
- `POST /auth/password/reset` resets a legacy password account and revokes its active refresh sessions. Existing password register/login routes remain supported.

Send access tokens on protected routes as `Authorization: Bearer <accessToken>`.

### Email verification (Tencent SES)

The backend uses Tencent Cloud SES's single-recipient `SendEmail` API and an approved SES template. `BatchSendEmail` requires a managed recipient list and is not used for user-entered verification addresses. In the SES console, finish domain and sender verification, approve the template, and create a CAM sub-user restricted to SES sending. Configure these backend-only values in the ignored `.env`:

```env
TENCENTCLOUD_SECRET_ID=
TENCENTCLOUD_SECRET_KEY=
SES_REGION=ap-guangzhou
SES_FROM_EMAIL=GreenKeeper <noreply@mail.your-domain.example>
SES_TEMPLATE_ID=
EMAIL_CODE_SECRET=
```

The approved template must define `code` and `expire_minutes` variables. Generate `EMAIL_CODE_SECRET` independently from the Tencent credentials and `JWT_SECRET`. The API does not return verification codes or log them. Codes expire after 5 minutes, are single-use, and allow at most 5 failed attempts. Sending is limited to once per email per 60 seconds, 5 times per email per hour, and 20 times per IP per hour. Password reset sends a generic accepted response regardless of account existence. Tests inject a fake sender; a real credential-backed end-to-end send must be verified after deployment.

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

These read-only endpoints are public and do not modify the database or require authentication. They include pending starter candidates for the current preview; `identityStatus: pending` does not imply a verified identity. Lists include `coverImage` (URL and alt text), and details include image source, license and attribution. Missing covers return `null`. Personal garden writes remain unavailable. See `openapi.yaml` for response types.

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

### 批量导入植物展示图

准备本地图片和 `src/plants/data/plant-images-v1.json` 后，执行 `npm run plants:images -- --check` 只读预检，再用 `npm run plants:images -- --apply` 备份并导入。支持本地/COS 存储、WebP 转换、重复执行跳过、显式 `--replace` 替换与失败清理。清单已填入首批 20 张经来源核对的 Commons 图片；只导入这批时添加 `--partial`，其余植物保留缺图状态。首页八类自动复用所属植物的展示图。字段、目录、低分辨率处理和故障恢复见 [植物展示图导入说明](PLANT_IMAGES.md)。
