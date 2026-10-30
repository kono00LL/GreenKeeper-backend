# 腾讯云 COS 图片存储

后端支持 `local` 与 `cos` 两种模式。前端继续调用 `POST /images`；图片内容与 10 MiB 上限继续由后端校验。此接入只改变永久图片的保存位置，SQLite、前端打包资源及 Pl@ntNet 的识别临时图片维持原有用途。

## 1. 存储桶与凭证

- 存储桶：`greenkeeper-1385540619`。
- 地域：上海，地域代码 `ap-shanghai`。
- 桶可以保持私有读写，无需开放匿名写入或读取。
- 在腾讯云 CAM 创建专用子用户并创建 API 密钥；仅在后端运行环境填写 SecretId 与 SecretKey。不要放进前端、`EXPO_PUBLIC_` 变量或 Git。

子用户只需在该桶的 `uploads/*` 范围写入和读取图片。可创建自定义策略并关联到子用户：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["name/cos:PutObject", "name/cos:GetObject", "name/cos:HeadObject"],
      "resource": ["qcs::cos:ap-shanghai:uid/1385540619:greenkeeper-1385540619/uploads/*"]
    }
  ]
}
```

如果桶策略有显式拒绝，还需要在腾讯云控制台核对该策略；子用户的允许策略不能覆盖显式拒绝。

## 2. 配置后端

依赖已经加入 `package.json`。在后端目录执行 `npm install`，然后编辑已有 `.env`（新环境可复制 `.env.example`），加入或更新：

```dotenv
IMAGE_STORAGE=cos
COS_BUCKET=greenkeeper-1385540619
COS_REGION=ap-shanghai
COS_SECRET_ID=填写子用户的SecretId
COS_SECRET_KEY=填写子用户的SecretKey
```

保留原有 JWT、数据库和 PlantNet 配置，重启后端 `npm run dev`。部署到服务器时也要设置这些后端环境变量。缺少必填项或模式拼错会阻止服务启动；COS 上传失败不会偷偷降级保存到本地。

要切回本地，只需设 `IMAGE_STORAGE=local` 并重启。但本地模式不能读取仅存在 COS 中的文件，所以已有 COS 图片的部署应继续使用 COS 模式。

`DATA_DIRECTORY` 仍用于 SQLite 与请求期间的图片暂存，必须保留可写目录。COS 模式不会在本地永久保存新上传的图片。

## 3. 图片读取与数据库引用

上传成功仍返回：

```json
{
  "image": {
    "key": "1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg",
    "url": "/uploads/1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg",
    "mimeType": "image/jpeg",
    "size": 1200,
    "width": 1600,
    "height": 800
  }
}
```

对应 COS 对象 Key 为 `uploads/1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg`。读取应用的 `/uploads/:key` 时先尝试兼容历史本地文件；不存在本地文件时，COS 模式返回 302 跳转到有效期 5 分钟的 HTTPS 签名地址，跳转响应不缓存。再次访问应用地址会重新生成签名。对象不存在时，由 COS 返回错误；签名本身不检查对象是否存在。

数据库应保存稳定的图片引用或对象 Key，不能保存 302 的临时签名目标。已有前端上传预览会把相对路径补全为后端地址，无需更改。

图片读取继续沿用原项目的公开读取语义：知道应用图片地址的人可以查看。**私有桶不代表应用已经实现个人照片权限隔离**。此桶的 `uploads/` 仅用于可分享图片；数据库备份和敏感文件应放独立私有桶，不能复用此访问入口。未来私人花园照片需要单独的归属记录与鉴权读取接口。

如果把上传结果用于帖子图片或头像，需确保客户端接收到的是完整的后端图片地址。现有帖子示例仍引用外部图片，切换存储不会自动把外链图片复制进 COS。

## 4. 验证新上传

1. 登录 App，在拍摄预览页选择「上传图片」。
2. 在 COS 控制台打开桶的 `uploads/` 前缀，确认出现 UUID 图片。
3. 确认 App 能预览图片；后端 `data/uploads` 中不应出现对应的新永久文件。
4. 重新访问后端返回的图片地址，确认返回 302，跳转后图片可打开。直接访问未带签名的 COS 地址，在私有桶中返回 403 属正常现象。

目前链路是 App → 后端 → COS；上传不需要给 COS 配浏览器跨域权限。如果 Web 端以后通过 fetch 或 Canvas 读取跨域图片，再按前端实际 Origin 配置 COS CORS 的 GET/HEAD；不要为此开放桶写权限。

自动化验证：`npm test` 使用模拟上传客户端和真实 SDK 的离线签名测试，不访问真实 COS，也不消耗上传流量。真实桶的密钥权限、地域和网络需要按上述步骤做一次实际上传验证。

## 5. 迁移历史本地图片

切换模式不会自动搬迁历史文件。小规模数据可直接使用 COS 控制台：

1. 备份后端的 `data/uploads`（如自定义过 `DATA_DIRECTORY`，以实际路径为准）。
2. 在桶内创建或进入 `uploads/` 前缀。
3. 将本地 `uploads` 里的图片文件上传进去，保持原 UUID 文件名，不要多嵌套一层 `uploads/uploads/`。
4. 在另一份使用空本地上传目录的测试环境中，以 COS 模式访问历史图片 URL，确认能从 COS 加载。
5. 确认迁移完整且备份可用后，再自行清理旧服务器图片；不要删除 SQLite 或整个 `DATA_DIRECTORY`。

应用路径保持 `/uploads/:key`，迁移到相同对象 Key 后不需要批量修改这些路径。若数据库曾保存了 `http://localhost:8080/...` 等旧环境完整地址，则仍需要按部署域名修正，COS 切换不会自动修复这些地址。
