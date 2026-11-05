# 首批 20 种植物展示图

图片来自 Wikimedia Commons，使用 CC BY、CC BY-SA 或 CC0。来源文件、下载地址、原文件 SHA-1 及作者信息记录在 `src/plants/data/plant-images-v1-sources.json`；最终清单为 `src/plants/data/plant-images-v1.json`。原图位于忽略提交的 `data/incoming/plant-images-v1/`，导入结果沿用当前配置的 COS 存储。

这批图片按已有 UUID 关联，核对来源物种页面与文件说明并检查图片内容；不修改植物学名、已有身份审核或发布状态。金琥来源接受名为 Kroenleinia grusonii，数据库仍沿用 Echinocactus grusonii；朱槿来源标题包含杂交符号，仍使用已有 UUID。波士顿蕨使用 Bostoniensis 栽培品种，朱槿使用 Brilliant 栽培品种，替代文本注明品种。

| 植物 | 作者 / 署名 | 许可证 | 来源 |
|---|---|---|---|
| 铁线蕨 | Balles2601 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Adiantum_capillus-veneris_2601.jpg) |
| 波士顿蕨 | Dinesh Valke from Thane, India | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) | [Commons](https://commons.wikimedia.org/wiki/File:Nephrolepis_exaltata_%27Bostoniensis%27_(49387866103).jpg) |
| 金琥 | André Karwath aka Aka | [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5) | [Commons](https://commons.wikimedia.org/wiki/File:Echinocactus_grusonii_(aka).jpg) |
| 蟹爪兰 | Carlos SGP | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons](https://commons.wikimedia.org/wiki/File:Cactus_de_Navidad,_Zygocactus_truncatus.jpg) |
| 朱槿 | Andy / Andrew Fogg from near Cambridge, UK | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons](https://commons.wikimedia.org/wiki/File:Hibiscus_Brilliant.jpg) |
| 非洲菊 | Alexey Yakovlev | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Gerbera_jamesonii_(Asteraceae).jpg) |
| 向日葵 | Johann Jaritz / CC BY-SA 4.0 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Eberndorf_K%C3%B6cking_Sonnenblumenfeld_Biohof_Tomic_18072014_0792.jpg) |
| 卷丹 | Amada44 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [Commons](https://commons.wikimedia.org/wiki/File:Lilium_lancifolium_7757.jpg) |
| 番茄 | Softeis | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Tomato_je.jpg) |
| 草莓 | Ivar Leidus | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Garden_strawberry_(Fragaria_%C3%97_ananassa)_single2.jpg) |
| 垂盆草 | Navin Sasikumar | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Sedum_sarmentosum_plant_(02).jpg) |
| 柠檬 | Elena Chochkova | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:P1030323.JPG) |
| 罗勒 | Photo by David J. Stang | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Ocimum_basilicum_8zz.jpg) |
| 迷迭香 | Margalob | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Rosemary_in_bloom.JPG) |
| 绿薄荷 | Simon Eugster -- Simon 13:07, 2 July 2006 (UTC) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Minze.jpg) |
| 百里香 | Balles2601 / Wikimedia Commons / CC BY-SA 4.0 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Thymus_vulgaris_2601.JPG) |
| 山茶 | PumpkinSky | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [Commons](https://commons.wikimedia.org/wiki/File:Camellia_japonica_NBG.jpg) |
| 栀子 | Adriel anv00 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Gardenia_jasminoides_flower_Argentina.jpg) |
| 大叶绣球 | belvedere04 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:(Natural)_Hydrangea_macrophylla,_Iwafune,_Isumi,_Chiba,_Japan_2.jpg) |
| 麦冬 | Shabicht | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons](https://commons.wikimedia.org/wiki/File:Japonska_ka%C4%8Dja_brada.jpg) |

预检与导入命令：

```bash
npm run plants:images -- --check --partial
npm run plants:images -- --apply --partial
```

预期：本批 20 张展示图，其他 80 株不在本批范围；全库植物条数保持 100，八类通过所属植物展示代表图。图片统一转换为最大长边 1200px、质量 82 的 WebP，保留原图；署名说明缩放与格式转换。重复执行报告 `unchanged`，不会重复上传。
