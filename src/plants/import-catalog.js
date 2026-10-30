const { createHash, randomUUID } = require('node:crypto');
const { starterPlants } = require('./starter-plants');
const { normalizeScientificName: normalize } = require('./match-identification');

const columns = ['id', 'scientific_name', 'name_zh', 'name_en', 'identity_status', 'summary', 'appearance_features',
  'temperature_min_c', 'temperature_max_c', 'temperature_notes', 'sunlight_requirement', 'watering_requirement',
  'repotting_requirement', 'pests', 'publication_status', 'content_version', 'updated_at'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const date = (value) => text(value) && Number.isFinite(Date.parse(value));
const webUrl = (value) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
const sourceId = (id, url) => createHash('sha256').update(`${id}\n${url}`).digest('hex');
const sourceRows = (plant) => plant.sources.map((source) => ({ id: sourceId(plant.id, source.source_url), plant_id: plant.id,
  source_name: source.source_name, source_url: source.source_url, checked_at: source.checked_at, review_status: source.review_status }));

function preflightCatalog(db, plants) {
  if (!Array.isArray(plants)) return { valid: false, errors: ['Catalog must be an array'], actions: [] };
  const errors = [], actions = [];
  const seenIds = new Set(), seenNames = new Set();
  const categories = new Set(db.prepare('SELECT id FROM plant_categories').all().map((c) => c.id));
  const existingPlants = db.prepare('SELECT * FROM plants').all();
  for (const plant of plants) {
    const initialErrors = errors.length;
    const fail = (reason) => errors.push(`${plant?.name_zh || plant?.id || 'unknown'}: ${reason}`);
    if (!plant || !uuid.test(plant.id) || seenIds.has(plant.id)) { fail('invalid or duplicate UUID'); continue; }
    seenIds.add(plant.id);
    if (!text(plant.scientific_name) || !text(plant.name_zh)) { fail('missing name'); continue; }
    const name = normalize(plant.scientific_name);
    if (seenNames.has(name)) fail('duplicate normalized scientific name');
    seenNames.add(name);
    if (!Array.isArray(plant.categories) || !plant.categories.length || new Set(plant.categories).size !== plant.categories.length || plant.categories.some((c) => !categories.has(c))) fail('unknown or duplicate category');
    if (!Array.isArray(plant.aliases) || plant.aliases.some((a) => !text(a.alias) || (a.language !== null && !text(a.language))) || new Set(plant.aliases.map((a) => a.alias)).size !== plant.aliases.length) fail('invalid aliases');
    if (!Array.isArray(plant.sources) || !plant.sources.length || plant.sources.some((s) => !text(s.source_name) || !webUrl(s.source_url) || !date(s.checked_at) || !['unreviewed', 'approved', 'rejected'].includes(s.review_status)) || new Set(plant.sources.map((s) => s.source_url)).size !== plant.sources.length) fail('invalid sources');
    if (!['pending', 'verified'].includes(plant.identity_status) || !['draft', 'published'].includes(plant.publication_status)) fail('invalid review status');
    if (!Number.isInteger(plant.content_version) || plant.content_version < 1 || !date(plant.updated_at)) fail('invalid version or date');
    for (const column of columns.filter((c) => !['temperature_min_c', 'temperature_max_c', 'content_version'].includes(c))) {
      if (plant[column] !== null && !text(plant[column])) fail(`invalid ${column}`);
    }
    const min = plant.temperature_min_c, max = plant.temperature_max_c;
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max)) fail('invalid temperatures');
    const review = plant.review?.plantnet;
    if (plant.identity_status === 'verified' && (review?.status !== 'confirmed' || !text(review.scientificName) || normalize(review.scientificName) !== name || !date(review.checkedAt) || !webUrl(review.sourceUrl))) fail('identity evidence not confirmed');
    if (plant.publication_status === 'published' && (plant.identity_status !== 'verified' || plant.review?.horticulture?.status !== 'approved' || !webUrl(plant.review?.horticulture?.sourceUrl) || !date(plant.review?.horticulture?.checkedAt) || !plant.summary || !plant.appearance_features || !plant.sunlight_requirement || !plant.watering_requirement || !plant.sources?.length || plant.sources.some((s) => s.review_status !== 'approved'))) fail('publication evidence incomplete');
    if (errors.length !== initialErrors) continue;
    if (existingPlants.some((p) => p.id !== plant.id && normalize(p.scientific_name) === name)) fail('scientific name conflicts with another UUID');
    const current = existingPlants.find((p) => p.id === plant.id);
    if (!current) { actions.push({ plant, kind: 'inserted' }); continue; }
    const relations = db.prepare('SELECT category_id FROM plant_category_relations WHERE plant_id = ?').all(plant.id).map((r) => r.category_id);
    const aliases = db.prepare('SELECT alias, language FROM plant_aliases WHERE plant_id = ?').all(plant.id);
    const sources = db.prepare('SELECT * FROM plant_sources WHERE plant_id = ?').all(plant.id);
    const unchanged = columns.every((c) => current[c] === plant[c]) && same([...relations].sort(), [...plant.categories].sort()) &&
      same(sorted(aliases), sorted(plant.aliases)) && same(sorted(sources), sorted(sourceRows(plant)));
    if (unchanged) { actions.push({ plant, kind: 'unchanged' }); continue; }
    const starter = starterPlants.find((p) => p.id === plant.id);
    const untouchedStarter = starter && current.name_zh === starter.nameZh && current.scientific_name === starter.scientificName && current.identity_status === 'pending' &&
      columns.filter((c) => !['id', 'name_zh', 'scientific_name', 'identity_status'].includes(c)).every((c) => current[c] === null) &&
      aliases.length === 0 && sources.length === 0 && relations.every((c) => starter.categories.includes(c));
    if (!untouchedStarter) fail('conflict with existing manually edited content');
    actions.push({ plant, kind: 'updated' });
  }
  return { valid: errors.length === 0, errors, total: plants.length,
    inserted: actions.filter((a) => a.kind === 'inserted').length,
    updated: actions.filter((a) => a.kind === 'updated').length,
    unchanged: actions.filter((a) => a.kind === 'unchanged').length,
    verified: plants.filter((p) => p.identity_status === 'verified').length,
    published: plants.filter((p) => p.publication_status === 'published').length,
    pending: plants.filter((p) => p.identity_status === 'pending').map((p) => ({ id: p.id, name: p.name_zh, reason: p.review?.note ?? '待核对' })),
    actions };
}

function importCatalog(db, plants) {
  return db.transaction(() => {
    const report = preflightCatalog(db, plants);
    if (!report.valid) throw new Error(`Catalog 预检 conflict:\n${report.errors.join('\n')}`);
    const insert = db.prepare(`INSERT INTO plants (${columns.join(',')}) VALUES (${columns.map((c) => `@${c}`).join(',')})`);
    const update = db.prepare(`UPDATE plants SET ${columns.filter((c) => c !== 'id').map((c) => `${c} = @${c}`).join(',')} WHERE id = @id`);
    const relation = db.prepare('INSERT OR IGNORE INTO plant_category_relations (plant_id, category_id) VALUES (?, ?)');
    // Older development databases have a separate mandatory alias ID. Keep both schemas usable.
    const aliasHasId = db.prepare('PRAGMA table_info(plant_aliases)').all().some((column) => column.name === 'id');
    const alias = db.prepare(aliasHasId
      ? 'INSERT INTO plant_aliases (id, plant_id, alias, language) VALUES (?, ?, ?, ?)'
      : 'INSERT INTO plant_aliases (plant_id, alias, language) VALUES (?, ?, ?)');
    const source = db.prepare('INSERT INTO plant_sources (id, plant_id, source_name, source_url, checked_at, review_status) VALUES (@id, @plant_id, @source_name, @source_url, @checked_at, @review_status)');
    for (const { plant, kind } of report.actions) {
      if (kind === 'unchanged') continue;
      (kind === 'inserted' ? insert : update).run(Object.fromEntries(columns.map((c) => [c, plant[c]])));
      plant.categories.forEach((c) => relation.run(plant.id, c));
      plant.aliases.forEach((a) => alias.run(...(aliasHasId ? [randomUUID(), plant.id, a.alias, a.language] : [plant.id, a.alias, a.language])));
      sourceRows(plant).forEach((s) => source.run(s));
    }
    const { actions, ...summary } = report;
    return summary;
  })();
}

module.exports = { preflightCatalog, importCatalog };
