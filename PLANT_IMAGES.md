# 植物展示图导入

在后端目录执行以下命令。清单已填入首批 20 株植物的 Commons 图片，来源核对记录见 `src/plants/data/plant-images-v1-sources.json`；脚本不会自动抓取网站或确认图片身份/授权。

## 准备图片与清单

默认目录：

```text
src/plants/data/plant-images-v1.json    # 人工核对的图片清单
data/incoming/                        # 自行准备的原图（不提交 Git）
data/uploads/                         # 本地模式生成的 WebP
data/greenkeeper.sqlite               # 植物与图片元数据
data/backups/                         # SQLite 一致性备份
```

`DATA_DIRECTORY` 决定数据库和本地上传目录。可用 `PLANT_IMAGES_MANIFEST` 指定另一份清单，`PLANT_IMAGES_DIRECTORY` 指定原图根目录；相对路径以执行命令时的工作目录解析。清单的 `file` 相对于原图根目录，不能使用 `../` 跳出该目录。

从实际数据库读取 `id`、`name_zh`、`scientific_name`，每株植物恰好填写一条：

```json
[
  {
    "plantId": "从数据库复制的植物 UUID",
    "nameZh": "朱槿",
    "scientificName": "Hibiscus rosa-sinensis",
    "file": "incoming/hibiscus.jpg",
    "sourceName": "Wikimedia Commons",
    "sourceUrl": "https://commons.wikimedia.org/wiki/File:实际文件页面.jpg",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "attribution": "实际作者，Wikimedia Commons；已缩放并转换为 WebP",
    "altText": "朱槿的花朵和叶片",
    "checkedAt": "2026-11-03T00:00:00.000Z"
  }
]
```

上面仅为格式示例，需替换为实际记录和已核对的图片页面。`plantId` 用于关联；中文名和学名必须与库中字符串完全一致，不能通过中文别名猜测关联。`sourceName`、HTTPS `sourceUrl`、`license`、`attribution`、有效日期 `checkedAt` 必填；`licenseUrl` 可省略或为 `null`，填写时必须为 HTTPS；`altText` 可省略或为 `null`。

优先使用自己拍摄、Wikimedia Commons 或其他许可明确允许商业使用的照片。来源页面应能追溯作者及许可；需要时在署名中注明缩放、格式转换等修改。AI 图片应在 `sourceName`、`attribution` 和 `altText` 中明确标注“AI 生成”。脚本校验信息是否填写，图片物种身份及授权范围仍需人工核对。不抓取 PictureThis 图片，也不将 Pl@ntNet 识别结果当作图片许可。

完整清单覆盖的是**当前数据库中的全部植物**，并非固定 20 条。当前资料库已扩展至 100 株；只处理清单中的 20 株时，显式添加 `--partial`。该模式仍核对全部清单条目、重复记录、图片、授权信息和替换冲突，但允许其他植物留在本批范围外，报告 `scope: manifest` 和 `outOfScope`。空的部分清单仍会失败。默认不带 `--partial` 时继续要求覆盖全库；不要删除植物来满足预检。之后扩展清单时保留已有图片条目，已导入条目会按哈希跳过。

## 检查和导入

```bash
npm run plants:images -- --check
npm run plants:images -- --apply
```

`--check` 只读数据库和原图，完整解码图片并在内存中生成 WebP 来计算哈希，不上传、不建表、不创建备份。清单不合法、缺失/重复植物、未知 ID、名称不匹配、缺失/损坏/不支持的图片、同图分配给不同植物或授权元数据缺失时整批失败，退出码为 1。仅接受静态 JPEG、PNG、WebP。

报告包含 `totalPlants`、`ready`（成功准备图片的记录数）、`missing`（未提供条目的植物数）、`invalid`（无效条目数）、`existing`（库中展示图数量）、`conflicts`（已有展示图与本次哈希不同的数量）、`errors` 和 `warnings`。替换冲突默认使 `valid` 为 `false`。

`--apply` 会重新预检，使用 SQLite backup API 备份并检查备份完整性，复用 `IMAGE_STORAGE=local|cos` 配置上传，然后在单个事务中写入图片元数据并检查外键和完整性。旧数据库的 `plant_images` 表在备份之后创建。COS 配置沿用 `COS_STORAGE.md`，需要允许对 `uploads/*` 执行写入、读取及删除。

统一输出：自动按方向旋转，最大长边 1200px，WebP 质量 82，不放大小图。原图不会被覆盖。长边小于 1200px 时先输出警告，人工接受后运行：

```bash
npm run plants:images -- --apply --allow-small
```

相同 SHA-256（针对转换后的 WebP）报告 `unchanged`，不重复上传、不修改元数据。改变图片才会更新元数据；相同图片的署名等文字修订应单独审核维护，当前脚本不提供元数据编辑模式。

首批 20 株在当前 100 株开发库中运行：

```bash
npm run plants:images -- --check --partial
npm run plants:images -- --apply --partial
```

## 替换和失败恢复

默认阻止任何图片替换，上传前完成全部冲突检查。人工确认后可先预检，再应用：

```bash
npm run plants:images -- --check --replace
npm run plants:images -- --apply --replace
# 如确认接受小图，可同时添加 --allow-small
```

替换先上传新文件，事务提交后再删除旧文件；任意上传或写库失败都会回滚本批数据库写入并清理本批已上传文件。旧文件在事务成功前保留。正常重复执行不会增加文件和数据库记录。

删除失败通过 `cleanupPending` 返回，并由 CLI 追加记录到 `DATA_DIRECTORY/plant-image-cleanup.jsonl`，报告中包含该路径。清理记录保存存储类型、文件键、错误及时间；在核对文件未被 `plant_images` 或其他业务引用后再人工重试删除。失败日志同时输出本次备份路径。进程被强制终止可能留下未关联文件，可用上传目录/对象清单与数据库键核对。

备份只包含 SQLite，不包含原图、本地上传目录或 COS 对象。替换后若要回退旧图，需要保留对应旧文件或从原图重新导入，不能只恢复 SQLite 备份。

## 接口与页面

`plant_images` 存 `storage_key`、SHA-256、尺寸、来源、许可、署名及时间；图片字节存文件系统或 COS，不存 SQLite。文字来源 `plant_sources` 保持独立。

列表的 `coverImage` 为 `{ url, altText }`；详情额外返回 `sourceName`、`sourceUrl`、`license`、`licenseUrl`、`attribution`；无图片为 `null`。URL 保持 `/uploads/{key}`，COS 模式通过现有读取路由重定向到签名地址。前端转换为后端绝对 URL，显示缩略图/详情图，加载失败回到灰色占位；详情提供来源和许可链接及署名。首页八类从各自分类中已具备展示图的植物选择代表图，按中文名、UUID 排序选取；接口返回 `coverPlantId` 和包含署名/许可的 `coverImage`，无图时两者为 `null`。分类图片复用植物图片和授权信息；首页“图片署名与许可”可展开查看并进入来源植物详情。没有新增分类图片上传入口。

服务启动时会初始化新表；已有开发服务需重启后读取新版接口。`npm test` 覆盖内存数据库与临时目录/COS 模拟服务，不使用真实图片授权、COS 额度或开发数据库。
