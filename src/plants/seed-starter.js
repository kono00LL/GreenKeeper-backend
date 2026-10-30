const { starterPlants } = require('./starter-plants');

function seedStarterPlants(db) {
  const insertPlant = db.prepare(`
    INSERT INTO plants (id, scientific_name, name_zh, identity_status)
    VALUES (@id, @scientificName, @nameZh, 'pending')
    ON CONFLICT(id) DO NOTHING
  `);
  const findPlant = db.prepare('SELECT scientific_name, name_zh FROM plants WHERE id = ?');
  const findScientificName = db.prepare(`
    SELECT id FROM plants
    WHERE scientific_name = ? COLLATE NOCASE AND id != ?
    LIMIT 1
  `);
  const findCategory = db.prepare('SELECT id FROM plant_categories WHERE slug = ?');
  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO plant_category_relations (plant_id, category_id)
    VALUES (?, ?)
  `);

  return db.transaction(() => {
    let inserted = 0;
    let linked = 0;
    for (const plant of starterPlants) {
      const existing = findPlant.get(plant.id);
      if (existing) {
        if (existing.scientific_name !== plant.scientificName || existing.name_zh !== plant.nameZh) {
          throw new Error(`Starter plant ID conflicts with an existing record: ${plant.nameZh}`);
        }
      } else {
        const duplicate = findScientificName.get(plant.scientificName, plant.id);
        if (duplicate) {
          throw new Error(`Starter scientific name already exists in another record: ${plant.scientificName}`);
        }
        const result = insertPlant.run(plant);
        inserted += result.changes;
      }

      for (const slug of plant.categories) {
        const category = findCategory.get(slug);
        if (!category) throw new Error(`Unknown starter plant category: ${slug}`);
        linked += insertRelation.run(plant.id, category.id).changes;
      }
    }
    return { inserted, linked };
  })();
}

module.exports = { seedStarterPlants };
