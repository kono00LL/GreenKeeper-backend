const { randomUUID } = require('node:crypto');

const seedPosts = [
  { category: 'article', title: '为室内植物建立稳定的浇水节奏', excerpt: '观察土壤和光照，比固定日历更能帮助你判断植物何时需要水。', content: '先检查盆土表层和花盆重量，再决定是否浇水。不同植物、季节和光照环境的需水量都不同。', coverImage: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80' },
  { category: 'article', title: '认识窗边的明亮散射光', excerpt: '叶片颜色、灼斑和徒长都能提供植物光照是否合适的线索。', content: '明亮散射光通常指植物能看清周围环境，但叶片不会长时间受到强烈直射阳光照射的位置。', coverImage: 'https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=1200&q=80' },
  { category: 'article', title: '换盆前先检查根系和排水', excerpt: '换盆不必追求大盆，合适的排水和根系空间更重要。', content: '如果根系已经绕满盆底、浇水后很快流出，或基质长期板结，可以考虑换盆。', coverImage: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1200&q=80' },
];

const additionalSeedPosts = [
  {
    category: 'article',
    title: '给新手的阳台种植起步清单',
    excerpt: '从耐养的植物、带排水孔的花盆和合适的位置开始，慢慢建立自己的养护节奏。',
    content: '想在阳台开始种植物，不必一次买很多。先选一两盆适应力强的绿萝、薄荷或吊兰，观察阳台一天的光照，再把植物放到合适的位置。花盆要有排水孔，浇水后多余的水才能流走。准备一把小铲子和托盘就够用了。记下浇水日期，但先摸土再决定是否浇水。',
    coverImage: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '用一周观察法判断植物是否缺水',
    excerpt: '连续观察盆土、叶片和花盆重量，比照着固定日历浇水更可靠。',
    content: '很多植物出现萎蔫时，原因不一定是缺水，积水伤根也会让叶片失去精神。可以用一周做简单观察：每天在相近时间摸一摸盆土表面，看看颜色是否变浅，再把花盆轻轻拿起，感受重量变化。浇透一次后记下盆土变干需要几天，但不要把这个天数当成固定周期。天气闷热、开窗通风、盆器大小都会改变水分蒸发速度。观察叶片时也要看新叶和老叶的差别。若土还湿而叶片发黄，先检查排水孔和根部气味。这样累积几轮记录，就能找到适合这盆植物的节奏，也能避免一看到叶子下垂就立刻加水。浇水时让水慢慢渗透整个根团，直到盆底有少量水流出，再倒掉托盘里的积水。若土干到与盆壁分开，可以分两三次浇水，让介质重新吸收水分。',
    coverImage: 'https://images.unsplash.com/photo-1525498128493-380d1990a112?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '从叶片变化认识室内光照',
    excerpt: '徒长、褪色或焦边都能给出线索，调整位置时应循序渐进。',
    content: '室内植物不会开口告诉我们光线够不够，但叶片会留下不少线索。新枝变得细长、叶片间距越来越大，常见原因之一是光照不足；叶色变淡、朝窗一侧明显倾斜，也值得检查摆放位置。相反，叶片出现干脆的褐色斑块，尤其集中在受日照的一面，可能是强光灼伤，也可能和缺水或环境骤变有关。观察时不要只看一片叶子，先比较新叶和旧叶，再确认最近是否换过位置、温度是否突然升高。若要增加光照，每隔几天向窗边移动一点，让植物逐步适应。隔着薄窗帘的明亮位置通常比正午的烈日温和。每周转动花盆四分之一圈，可以让各侧受光更均匀，株形也不容易长期偏向一边。记录变化比凭印象判断更准确。不同植物对光线需求不同，不能只凭“绿叶植物都耐阴”安排位置。窗户朝向、楼间遮挡和季节都会改变实际光照。选定新位置后，观察一到两周再判断，同时留意玻璃附近的温度。冬天靠窗可能更冷，夏天西晒则可能让叶面很快升温。家中光线偏弱时，可以先选耐阴品种，或把植物移到离窗更近的位置。',
    coverImage: 'https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '给香草植物搭配透气的盆土',
    excerpt: '香草需要稳定水分，也需要根部呼吸；土壤结构比复杂配方更重要。',
    content: '罗勒、百里香和迷迭香都可以在家里种植，但它们对水分和通风的偏好并不完全相同。配土时先选择干净、疏松的通用营养土，再加入少量珍珠岩或粗颗粒材料，帮助多余的水排出。盆底不需要铺很厚的石子，真正重要的是花盆有孔、土壤不板结，浇水后不会长时间湿黏。罗勒喜欢土壤保持微润，迷迭香则更怕根部持续潮湿，因此最好分别种在不同盆里，方便观察和调整。装土时不要压得太紧，给根系和空气留出空间。换盆后先浇透，让新土与根团贴合，然后放在明亮但不暴晒的位置几天。新叶开始生长后，再逐渐恢复日常光照和少量施肥。若表面长出绿苔或有酸味，通常说明通风或排水需要改善。准备材料时可以少量试配，不必追求固定比例。抓一把微湿的土，轻轻握紧后应能成团，拨动又能散开；若捏成硬块，可以加入颗粒介质。旧土若带虫卵、霉味或曾出现严重烂根，不建议混入新盆。盆器越大，中心越不容易变干，小苗不宜种进特别大的盆。换盆后的头几周先观察新叶和盆土，再决定是否施肥。栽种时先把原有根团轻轻松开，剪掉已经发黑或空心的根，不要为了让根系看起来整齐而大幅修剪。新土填到根团周围后，用手轻压盆边即可，不要把土压实。若香草需要频繁采收，放在方便取用的位置，并定期掐掉过长的顶芽，促使侧枝生长。养护中若出现叶尖发干，先检查环境和浇水，再考虑补肥；肥料过量会让根系受损。',
    coverImage: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '换季时如何调整植物的养护节奏',
    excerpt: '温度、日照和生长速度都会变化，换季养护应以观察为先。',
    content: '春夏和秋冬的日照长度、室内温度与空气流动都可能不同，因此植物的浇水和施肥频率也不应全年固定。进入温暖季节后，许多植物长出新芽，盆土干得更快，可以增加检查频率，但仍要根据土壤状态决定是否浇水。天气转凉时，生长速度变慢，水分消耗减少，继续按照盛夏习惯浇水容易造成积水。换季的第一步是观察窗边光线有没有移动，空调或暖气是否直吹植物，再查看新叶和盆土的变化。一次只调整一个条件，例如先挪开冷风口，几天后再评估浇水。不要因为日历进入某个月就立即大量施肥或换盆。若夜间温度下降明显，可把怕冷的盆栽移到室内较稳定的位置，同时避免紧贴玻璃。清理枯叶、检查虫害，也有助于植物把养分留给健康的新芽。用简单记录比较每周变化，能帮助你在下一次换季时更从容。可以把窗边温度、盆土干燥时间和新叶情况记在备忘录里，不需要购买额外仪器。浇水尽量选在白天，若托盘有积水就及时倒掉。连续阴雨时，湿度高、土壤干得慢，应拉长检查间隔。遇到寒潮，可以暂时远离窗缝，但不要放在暖气正上方。季节变化时偶尔有老叶变黄，只要新芽健康、茎部坚实，就先观察，不必立刻换盆或施肥。还可以把养护分成几个小步骤：先观察温度和光线，再检查土壤，最后才决定是否浇水、修剪或施肥。一次只改变一个条件，过几天再看反应，就容易知道哪种调整真正有效。若家中有多种植物，可以在盆边贴上简单标签，记录名称和最近一次浇水，不需要每天写长篇日记。窗户常开时注意冷风是否直吹，使用空调时也避免把盆栽放在出风口下方。刚从户外搬进室内的植物，先给它们几天适应环境，避免同时换盆、修根和施肥。换季期间发现虫害，可以用清水冲洗叶背并隔离植株，持续观察几天再决定后续处理。',
    coverImage: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '用扦插繁殖一盆新的绿植',
    excerpt: '选择健康枝条、保持工具清洁，并给新根稳定的湿度与温度。',
    content: '扦插能让一株长势良好的绿植变成新的盆栽，也适合和朋友分享枝条。开始前先确认植物适合扦插，并挑选没有病斑、正在生长的枝条。用干净锋利的剪刀，在节位下方剪取一段，去掉会浸入水或土里的叶片。如果选择水培，把枝条放进干净容器，让节位浸在水中，叶片留在水面以上；定期换水并观察切口，出现软烂就及时修剪。若直接插入基质，使用疏松、微湿的介质，插好后轻轻固定，不要频繁拔出查看。新插穗通常还没有根，避免阳光直晒和强风，放在明亮散射光处更稳妥。容器透明时可以观察根系，但不必追求根长得很长才移栽。看到白色新根并开始分枝，就可以换到小盆里。移栽后先保持土壤微湿，等新叶稳定生长后再逐渐增加光照。每种植物生根速度不同，耐心等待比反复挪动更有帮助。剪下枝条后确认每段至少有一个健康节位，因为新根常从节位附近长出。叶片较大的品种可以剪去少量下部叶片，减少水分散失，但不要伤到顶端。水培容器要保持清洁，避免直晒，水量无需淹没整段枝条。土插时先用木签打孔，再放入插穗，避免硬塞损伤切口。若空气干燥，可以短时间套透明罩保湿，但每天通风并检查霉斑。繁殖期间不需要施浓肥，肥料不能代替根系。等新叶持续展开、轻拉时有固定感，再逐步让小苗适应更强光线。可以一次准备两三根插穗，提高成功的机会，也方便比较水培和土插的差异。剪口应平整，不要用手反复触碰，操作后把剪刀洗净擦干。刚扦插的枝条可能暂时停止生长，这是正常现象，只要茎部没有继续变黑或软烂，就不必急着处理。水培时若容器内壁有滑腻感，及时清洗并换水；土插则要避免介质一直湿透。移栽到新盆后，先放在明亮散射光处几天，等植株挺立后再慢慢增加日照。不要在同一天移栽、重剪和施肥，给新根一个适应环境的时间。记录每段枝条的处理日期和方式，等它们生根后就能比较哪种方法更适合家里的环境。若想把成功的小苗送给朋友，先等它在新盆中稳定生长几周，再分享养护方式和植物名称。',
    coverImage: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80',
  },
  {
    category: 'article',
    title: '把阳台规划成四季都有收获的小花园',
    excerpt: '结合光照、空间和家庭习惯安排植物，让种植成为可以长期坚持的日常。',
    content: '一个好打理的阳台花园，不一定要摆满花盆。规划前先观察一天中阳光照到哪些地方、持续多久，同时确认雨水会不会直接淋到盆栽，以及浇水后水流向哪里。把喜阳植物放在光线最充足的位置，把耐阴的观叶植物安排在明亮的边角；高大的盆栽放后排，避免遮住矮小植物。选择花盆时尽量统一几种尺寸，便于整理，也要为每盆预留托盘和通风间距。若空间有限，可以用稳固的架子向上利用空间，但重盆应放低，避免失衡。种植品种不妨按用途搭配：几盆香草提供日常采摘，几株开花植物带来季节变化，再留一块区域专门观察新苗。不同季节的温度和日照会改变植物状态，因此不要把所有盆栽安排成相同的浇水计划。记录播种、换盆和开花时间，来年就能更容易安排轮替。每周花几分钟清理落叶、检查叶背和排水，通常比偶尔进行一次大整理更轻松。刚开始时从少量植物做起，等找到适合自己的节奏，再逐步增加品种。阳台花园的目标不是展示完美，而是让照料者和植物都能舒服地成长。还可以按每天的动线规划区域，把常采摘的香草放在厨房附近，把需要观察的新苗放在视线容易到达的位置。高层阳台先考虑承重和防坠，重盆放低且远离栏杆，架子要稳固并留出清洁地面的空间。风大的地方可选矮盆，必要时给高茎植物加支撑。采摘香草时不要剪掉大部分叶片，保留足够的叶子让植株继续生长。花朵凋谢后清理残花，能减少霉变，也为新花腾出空间。每月检查托盘、架子和排水口，避免泥土堵塞造成积水。发现虫害时先隔离受影响的盆栽，再检查相邻植物，不要马上对整个阳台喷药。家中有儿童或宠物时，把可能引起刺激的植物放在接触不到的位置，并妥善收好工具和肥料。随着季节变化只替换少量品种，就能保持花园活力，也不会让照料任务一下增加太多。规划时也可以先画一张简单草图，标出门、排水口和主要采光区域，再决定花架和盆栽的位置。不要挡住逃生通道或日常开窗，通风顺畅对植物和居住环境都很重要。为浇水准备一个小水壶和抹布，清洁工具集中放在固定位置，维护时就不必临时寻找。若养护时间有限，优先选择需水规律相近的品种，减少每天逐盆判断的负担。种植记录可以包括播种日期、发芽时间、第一次开花和采收量，几个月后回看，就能知道哪些品种最适合这里的光照。春天可以播种生长快的香草，夏天增加遮阴和通风，秋天收集种子，冬天则减少浇水并保护怕冷植物。收获时留下一部分花朵结籽，或者让一盆植物自然生长到下一季，也能观察完整的生命周期。',
    coverImage: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80',
  },
];

const insertPostSql = 'INSERT INTO posts (id, title, excerpt, content, cover_image, category, created_at) VALUES (@id, @title, @excerpt, @content, @coverImage, @category, @createdAt)';

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function initializeDatabase(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      user_name TEXT DEFAULT '匿名用户', avatar_url TEXT,
      gender TEXT NOT NULL DEFAULT 'private' CHECK (gender IN ('male', 'female', 'private')),
      status INTEGER NOT NULL DEFAULT 1, last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, excerpt TEXT NOT NULL, content TEXT NOT NULL,
      cover_image TEXT, category TEXT NOT NULL DEFAULT 'article' CHECK (category IN ('article', 'encyclopedia')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_images (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      url TEXT NOT NULL, position INTEGER NOT NULL CHECK (position >= 0),
      width INTEGER CHECK (width > 0), height INTEGER CHECK (height > 0),
      UNIQUE (post_id, position)
    );
    CREATE TABLE IF NOT EXISTS collections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      revoked_at TEXT, replaced_by TEXT REFERENCES refresh_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions(user_id);
  `);
  addColumnIfMissing(db, 'users', 'user_name', 'TEXT');
  addColumnIfMissing(db, 'users', 'avatar_url', 'TEXT');
  addColumnIfMissing(db, 'users', 'status', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'users', 'last_login_at', 'TEXT');
  addColumnIfMissing(db, 'users', 'gender', "TEXT NOT NULL DEFAULT 'private' CHECK (gender IN ('male', 'female', 'private'))");
  db.prepare("UPDATE users SET gender = 'private' WHERE gender IS NULL OR gender NOT IN ('male', 'female', 'private')").run();
  addColumnIfMissing(db, 'posts', 'category', "TEXT NOT NULL DEFAULT 'article' CHECK (category IN ('article', 'encyclopedia'))");
  db.prepare("UPDATE posts SET category = 'article' WHERE category IS NULL OR category NOT IN ('article', 'encyclopedia')").run();

  const insert = db.prepare(insertPostSql);
  if (db.prepare('SELECT COUNT(*) AS count FROM posts').get().count === 0) {
    db.transaction(() => seedPosts.forEach((post, index) => insert.run({ id: randomUUID(), ...post, createdAt: new Date(Date.now() - (additionalSeedPosts.length + index + 1) * 60000).toISOString() })))();
  }
  const existingTitle = db.prepare('SELECT 1 FROM posts WHERE title = ?');
  db.transaction(() => additionalSeedPosts.forEach((post, index) => {
    if (existingTitle.get(post.title)) return;
    insert.run({ id: randomUUID(), ...post, createdAt: new Date(Date.now() - index * 60000).toISOString() });
  }))();
  // Backfill only posts without an image collection. Re-running startup is safe.
  db.exec(`INSERT INTO post_images (id, post_id, url, position)
    SELECT 'cover:' || id, id, cover_image, 0 FROM posts
    WHERE cover_image IS NOT NULL AND cover_image != ''
      AND NOT EXISTS (SELECT 1 FROM post_images WHERE post_id = posts.id)`);
}

module.exports = { initializeDatabase };
