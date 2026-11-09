const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const additionsPath = path.join(root, 'src/plants/data/indoor-balcony-v4-additions.json');
const manifestPath = path.join(root, 'src/plants/data/plant-images-v1.json');
const sourcesPath = path.join(root, 'src/plants/data/plant-images-v1-sources.json');
const imageDir = path.join(dataDir, 'incoming/plant-images-v4');
const startIndex = Number(process.env.V4_START || 0);

const definitions = [
  ['长叶铁角蕨', 'Asplenium scolopendrium', 'Hart\'s-tongue fern', 'ferns'],
  ['雌性鳞毛蕨', 'Athyrium filix-femina', 'Lady fern', 'ferns'],
  ['雄性鳞毛蕨', 'Dryopteris filix-mas', 'Male fern', 'ferns'],
  ['圆叶剑蕨', 'Microsorum punctatum', 'Kangaroo fern', 'ferns'],
  ['纽西兰肋毛蕨', 'Pellaea rotundifolia', 'Button fern', 'ferns'],
  ['岩生铁线蕨', 'Pteris vittata', 'Ladder fern', 'ferns'],
  ['普通蕨', 'Polypodium vulgare', 'Common polypody', 'ferns'],
  ['透明球', 'Mammillaria gracilis', 'Thimble cactus', 'cacti'],
  ['羽毛球', 'Mammillaria plumosa', 'Feather cactus', 'cacti'],
  ['白星球', 'Echinopsis subdenudata', 'Domino cactus', 'cacti'],
  ['龙角牡丹', 'Astrophytum capricorne', 'Goat\'s horn cactus', 'cacti'],
  ['秘鲁苹果', 'Cereus repandus', 'Peruvian apple cactus', 'cacti'],
  ['单刺仙人掌', 'Opuntia monacantha', 'Drooping prickly pear', 'cacti'],
  ['青龙柱', 'Rhipsalis cereuscula', 'Rice cactus', 'cacti'],
  ['郁金香', 'Tulipa gesneriana', 'Garden tulip', 'flowers'],
  ['黄水仙', 'Narcissus pseudonarcissus', 'Daffodil', 'flowers'],
  ['三色堇', 'Viola × wittrockiana', 'Garden pansy', 'flowers'],
  ['大丽花', 'Dahlia pinnata', 'Dahlia', 'flowers'],
  ['唐菖蒲', 'Gladiolus × hortulanus', 'Garden gladiolus', 'flowers'],
  ['石竹', 'Dianthus chinensis', 'China pink', 'flowers'],
  ['洋葱', 'Allium cepa', 'Onion', 'vegetables-fruits'],
  ['胡萝卜', 'Daucus carota', 'Carrot', 'vegetables-fruits'],
  ['甜瓜', 'Cucumis melo', 'Melon', 'vegetables-fruits'],
  ['西瓜', 'Citrullus lanatus', 'Watermelon', 'vegetables-fruits'],
  ['马铃薯', 'Solanum tuberosum', 'Potato', 'vegetables-fruits'],
  ['秋葵', 'Abelmoschus esculentus', 'Okra', 'vegetables-fruits'],
  ['彩叶芋', 'Caladium bicolor', 'Fancy-leaved caladium', 'herbs'],
  ['竹芋草', 'Ctenanthe burle-marxii', 'Fishbone prayer plant', 'herbs'],
  ['雷克斯秋海棠', 'Begonia rex-cultorum', 'Rex begonia', 'herbs'],
  ['到手香', 'Plectranthus amboinicus', 'Cuban oregano', 'herbs'],
  ['藤叶椒草', 'Peperomia scandens', 'Cupid peperomia', 'herbs'],
  ['白花吊竹梅', 'Tradescantia fluminensis', 'Small-leaf spiderwort', 'herbs'],
  ['夹竹桃', 'Nerium oleander', 'Oleander', 'shrubs'],
  ['连翘', 'Forsythia suspensa', 'Weeping forsythia', 'shrubs'],
  ['珊瑚树', 'Viburnum odoratissimum', 'Sweet viburnum', 'shrubs'],
  ['日本黄杨', 'Ilex crenata', 'Japanese holly', 'shrubs'],
  ['女贞', 'Ligustrum lucidum', 'Glossy privet', 'shrubs'],
  ['日本卫矛', 'Euonymus japonicus', 'Japanese spindle', 'shrubs'],
  ['铺地百里香', 'Thymus serpyllum', 'Creeping thyme', 'groundcover'],
  ['匍匐荨麻草', 'Glechoma hederacea', 'Ground ivy', 'groundcover'],
  ['银米草', 'Herniaria glabra', 'Green carpet', 'groundcover'],
  ['雪叶莲', 'Cerastium tomentosum', 'Snow-in-summer', 'groundcover'],
  ['鱼腥草', 'Houttuynia cordata', 'Chameleon plant', 'groundcover'],
  ['蔓长春花', 'Ajuga genevensis', 'Geneva bugleweed', 'groundcover'],
  ['香蕉', 'Musa acuminata', 'Banana', 'edible-plants'],
  ['牛油果', 'Persea americana', 'Avocado', 'edible-plants'],
  ['芒果', 'Mangifera indica', 'Mango', 'edible-plants'],
  ['柑橘', 'Citrus reticulata', 'Mandarin orange', 'edible-plants'],
  ['山药', 'Dioscorea opposita', 'Chinese yam', 'edible-plants'],
  ['空心菜', 'Ipomoea aquatica', 'Water spinach', 'edible-plants'],
];

const categoryText = {
  ferns: ['多年生观赏蕨类，适合室内盆栽或庭院阴湿处栽培。', '蕨类植物通常以羽状或带状叶片形成观赏叶丛。', '明亮散射光至半阴', '保持基质湿润并确保排水良好。'],
  cacti: ['多肉类观赏植物，适合阳台或窗边容器种植。', '茎体肥厚，常具有刺座、棱脊或节状分枝等特征。', '充足光照或明亮散射光', '盆土大部干燥后再浇透，避免积水。'],
  flowers: ['常见观花植物，可用于阳台、庭院或容器栽培。', '以显著的花朵、花序或花色作为主要观赏特征。', '明亮光照或全日照', '表土干燥后浇水，开花期根据温度和盆土调整。'],
  'vegetables-fruits': ['适合家庭菜园或阳台容器种植的蔬菜和果实类植物。', '通常具有可食用的叶、根、果实或块茎，生长季节性明显。', '全日照至明亮光照', '生长期保持土壤均匀湿润并避免长期积水。'],
  herbs: ['适合室内观叶或阳台容器栽培的草本植物。', '植株多为柔软草本，叶形、叶色或香气具有观赏价值。', '明亮散射光至半阴', '保持基质微湿，浇水后让多余水分排出。'],
  shrubs: ['常见庭院或阳台木本植物，适合盆栽或地栽。', '具木质化枝条，株形、叶色或花果具有观赏价值。', '全日照至半阴', '表层土干燥后浇透，雨季注意通风和排水。'],
  groundcover: ['低矮或匍匐生长的植物，可用于花坛边缘、容器或地面覆盖。', '茎叶贴近地面扩展，常形成连续的叶毯或小型群落。', '全日照至半阴', '保持土壤不过度干燥，避免长期积水。'],
  'edible-plants': ['可用于家庭菜园、阳台或果树容器栽培的食用植物。', '可食用部分可能为果实、根、茎或叶，具体用途以物种资料为准。', '充足光照或全日照', '生长期按盆土干湿浇水，确保容器排水良好。'],
};

function stableUuid(scientificName) {
  const bytes = crypto.createHash('sha256').update(`greenkeeper-v4:${scientificName}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function curlJson(args) {
  const result = spawnSync('curl', ['-L', '--max-time', '30', '--retry', '5', '--retry-all-errors', '-A', 'GreenKeeper-plant-catalog/1.0', '-sS', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`curl failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function commonsSearch(scientificName) {
  const query = `${scientificName} filetype:bitmap`;
  const json = curlJson(['-G', 'https://commons.wikimedia.org/w/api.php', '--data-urlencode', 'action=query', '--data-urlencode', 'generator=search', '--data-urlencode', `gsrsearch=${query}`, '--data-urlencode', 'gsrnamespace=6', '--data-urlencode', 'gsrlimit=10', '--data-urlencode', 'prop=imageinfo', '--data-urlencode', 'iiprop=url|mime|size|extmetadata', '--data-urlencode', 'iiurlwidth=1600', '--data-urlencode', 'format=json']);
  const pages = Object.values(json.query?.pages || {});
  return pages.map((page) => ({ page, info: page.imageinfo?.[0] })).find(({ info }) => info && /^image\/(jpeg|png|webp)$/i.test(info.mime || '') && info.thumburl);
}

function download(url, destination) {
  const result = spawnSync('curl', ['-L', '--fail', '--max-time', '60', '--retry', '5', '--retry-all-errors', '-A', 'GreenKeeper-plant-catalog/1.0', '-sS', '-o', destination, url], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`download failed: ${result.stderr}`);
}

function stripHtml(value) { return String(value || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').trim(); }

fs.mkdirSync(imageDir, { recursive: true });
const existingCatalog = [...require(path.join(root, 'src/plants/data/indoor-balcony-v1.json')), ...require(path.join(root, 'src/plants/data/indoor-balcony-v2-additions.json')), ...require(path.join(root, 'src/plants/data/indoor-balcony-v3-additions.json'))];
const existingNames = new Set(existingCatalog.map((plant) => plant.scientific_name.normalize('NFC').toLowerCase()));
const additions = [];
const manifestAdditions = [];
const sourceAdditions = [];
const now = new Date().toISOString();

for (const [nameZh, scientificName, nameEn, category] of definitions.slice(startIndex)) {
  if (existingNames.has(scientificName.normalize('NFC').toLowerCase())) throw new Error(`duplicate scientific name: ${scientificName}`);
  existingNames.add(scientificName.normalize('NFC').toLowerCase());
  const id = stableUuid(scientificName);
  const [summary, appearance, sunlight, watering] = categoryText[category];
  const plantnetUrl = `https://my-api.plantnet.org/v2/species?prefix=${encodeURIComponent(scientificName)}`;
  additions.push({ id, name_zh: nameZh, scientific_name: scientificName, name_en: nameEn, aliases: [], categories: [category], selection_category: category,
    identity_status: 'pending', summary, appearance_features: `${appearance} 本批资料先以物种名录为身份候选，待逐株核对。`, temperature_min_c: null, temperature_max_c: null, temperature_notes: null,
    sunlight_requirement: sunlight, watering_requirement: watering, repotting_requirement: null, pests: null, publication_status: 'draft', content_version: 1, updated_at: now,
    sources: [{ source_name: 'Pl@ntNet 可识别物种名录（待核对）', source_url: plantnetUrl, checked_at: now, review_status: 'approved' }],
    review: { family: null, originalScientificName: scientificName, plantnet: { status: 'pending', scientificName, checkedAt: now, sourceUrl: plantnetUrl, taxa: [] }, horticulture: { status: 'pending', sourceTitle: null, sourceUrl: null, checkedAt: null }, note: '第 4 批候选，身份和物种级养护资料待人工核对；暂不发布。' } });

  spawnSync('sleep', ['3']);
  const found = commonsSearch(scientificName);
  if (!found) throw new Error(`no Wikimedia Commons image found for ${scientificName}`);
  const file = `${id}.jpg`;
  const target = path.join(imageDir, file);
  const originalUrl = found.info.url;
  if (!fs.existsSync(target) || fs.statSync(target).size < 1000) download(originalUrl, target);
  spawnSync('sleep', ['3']);
  const meta = found.info.extmetadata || {};
  const title = found.page.title;
  const sourceUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const license = stripHtml(meta.LicenseShortName?.value) || 'Wikimedia Commons license; verify before publication';
  const licenseUrl = meta.LicenseUrl?.value || 'https://commons.wikimedia.org/wiki/Commons:Licensing';
  const artist = stripHtml(meta.Artist?.value) || 'Wikimedia Commons contributor';
  manifestAdditions.push({ plantId: id, nameZh, scientificName, file: `incoming/plant-images-v4/${file}`, sourceName: 'Wikimedia Commons', sourceUrl, license, licenseUrl, attribution: `${artist}；Wikimedia Commons；已缩放并转换为 WebP`, altText: `${nameZh}植株或花果的展示照片`, checkedAt: now });
  sourceAdditions.push({ plantId: id, nameZh, scientificName, commonsFile: title, downloadUrl: originalUrl, description: stripHtml(meta.ImageDescription?.value), artistHtml: meta.Artist?.value || null, license, licenseUrl, checkedAt: now });
  console.log(`prepared ${nameZh} ${scientificName}`);
}

fs.writeFileSync(additionsPath, `${JSON.stringify(additions, null, 2)}\n`);
const manifest = require(manifestPath);
const sources = require(sourcesPath);
fs.writeFileSync(manifestPath, `${JSON.stringify([...manifest, ...manifestAdditions], null, 2)}\n`);
fs.writeFileSync(sourcesPath, `${JSON.stringify([...sources, ...sourceAdditions], null, 2)}\n`);
console.log(JSON.stringify({ additions: additions.length, manifest: manifestAdditions.length, images: fs.readdirSync(imageDir).length }, null, 2));
