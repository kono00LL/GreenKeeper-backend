function createPlantRepository(db) {
  const categories = db.prepare(
    'SELECT c.id, c.slug, c.name_zh AS nameZh, c.name_en AS nameEn, COUNT(r.plant_id) AS plantCount ' +
    'FROM plant_categories c LEFT JOIN plant_category_relations r ON r.category_id = c.id ' +
    'GROUP BY c.id ORDER BY c.sort_order, c.id',
  );
  const findCategory = db.prepare('SELECT id FROM plant_categories WHERE slug = ?');
  const categoryRefs = db.prepare(
    'SELECT c.slug, c.name_zh AS nameZh, c.name_en AS nameEn FROM plant_categories c ' +
    'JOIN plant_category_relations r ON r.category_id = c.id ' +
    'WHERE r.plant_id = ? ORDER BY c.sort_order, c.id',
  );
  const listColumns = 'p.id, p.name_zh AS nameZh, p.name_en AS nameEn, p.scientific_name AS scientificName, p.identity_status AS identityStatus';
  const allPlants = db.prepare('SELECT ' + listColumns + ' FROM plants p ORDER BY p.name_zh COLLATE NOCASE, p.id');
  const plantsForCategory = db.prepare(
    'SELECT ' + listColumns + ' FROM plants p ' +
    'JOIN plant_category_relations r ON r.plant_id = p.id ' +
    'JOIN plant_categories c ON c.id = r.category_id ' +
    'WHERE c.slug = ? ORDER BY p.name_zh COLLATE NOCASE, p.id',
  );
  const plantById = db.prepare(
    'SELECT id, name_zh AS nameZh, name_en AS nameEn, scientific_name AS scientificName, ' +
    'identity_status AS identityStatus, summary, appearance_features AS appearanceFeatures, ' +
    'temperature_min_c AS temperatureMinC, temperature_max_c AS temperatureMaxC, ' +
    'temperature_notes AS temperatureNotes, sunlight_requirement AS sunlightRequirement, ' +
    'watering_requirement AS wateringRequirement, repotting_requirement AS repottingRequirement, pests ' +
    'FROM plants WHERE id = ?',
  );
  const aliases = db.prepare('SELECT alias AS name, language FROM plant_aliases WHERE plant_id = ? ORDER BY alias');
  const identificationRecords = db.prepare('SELECT id, name_zh AS nameZh, scientific_name AS scientificName, identity_status AS identityStatus, publication_status AS publicationStatus FROM plants');
  const withCategories = (plant) => ({ ...plant, categories: categoryRefs.all(plant.id) });

  return {
    identificationRecords: () => identificationRecords.all(),
    categories: () => categories.all(),
    hasCategory: (slug) => Boolean(findCategory.get(slug)),
    list: (slug) => (slug === undefined ? allPlants.all() : plantsForCategory.all(slug)).map(withCategories),
    detail(id) {
      const plant = plantById.get(id);
      return plant ? { ...withCategories(plant), aliases: aliases.all(id) } : null;
    },
  };
}

module.exports = { createPlantRepository };
