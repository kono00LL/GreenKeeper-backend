function createPlantRepository(db) {
  const categories = db.prepare(
    'SELECT c.id, c.slug, c.name_zh AS nameZh, c.name_en AS nameEn, COUNT(r.plant_id) AS plantCount ' +
    'FROM plant_categories c LEFT JOIN plant_category_relations r ON r.category_id = c.id ' +
    'GROUP BY c.id ORDER BY c.sort_order, c.id',
  );
  const findCategory = db.prepare('SELECT id FROM plant_categories WHERE slug = ?');
  const categoryCover = db.prepare(
    "SELECT p.id AS plantId FROM plants p JOIN plant_category_relations r ON r.plant_id = p.id " +
    "JOIN plant_images i ON i.plant_id = p.id AND i.image_type = 'cover' " +
    "WHERE r.category_id = ? ORDER BY p.name_zh COLLATE NOCASE, p.id LIMIT 1",
  );
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
  const plantsForUser = db.prepare(
    'SELECT ' + listColumns + ' FROM user_plants up ' +
    'JOIN plants p ON p.id = up.plant_id ' +
    'WHERE up.user_id = ? ORDER BY up.created_at DESC, p.name_zh COLLATE NOCASE, p.id',
  );
  const plantById = db.prepare(
    'SELECT id, name_zh AS nameZh, name_en AS nameEn, scientific_name AS scientificName, ' +
    'identity_status AS identityStatus, summary, appearance_features AS appearanceFeatures, ' +
    'temperature_min_c AS temperatureMinC, temperature_max_c AS temperatureMaxC, ' +
    'temperature_notes AS temperatureNotes, sunlight_requirement AS sunlightRequirement, ' +
    'watering_requirement AS wateringRequirement, repotting_requirement AS repottingRequirement, pests ' +
    'FROM plants WHERE id = ?',
  );
  const coverImage = db.prepare(
    "SELECT storage_key AS storageKey, alt_text AS altText, source_name AS sourceName, source_url AS sourceUrl, " +
    "license, license_url AS licenseUrl, attribution FROM plant_images WHERE plant_id = ? AND image_type = 'cover' ORDER BY sort_order LIMIT 1",
  );
  const aliases = db.prepare('SELECT alias AS name, language FROM plant_aliases WHERE plant_id = ? ORDER BY alias');
  const identificationRecords = db.prepare('SELECT id, name_zh AS nameZh, scientific_name AS scientificName, identity_status AS identityStatus, publication_status AS publicationStatus FROM plants');
  const addUserPlant = db.prepare('INSERT OR IGNORE INTO user_plants (user_id, plant_id) VALUES (?, ?)');
  const removeUserPlant = db.prepare('DELETE FROM user_plants WHERE user_id = ? AND plant_id = ?');
  function imageForPlant(id, includeSource = false) {
    const image = coverImage.get(id);
    return image ? {
        url: `/uploads/${image.storageKey}`,
        altText: image.altText,
        ...(includeSource ? { sourceName: image.sourceName, sourceUrl: image.sourceUrl, license: image.license, licenseUrl: image.licenseUrl, attribution: image.attribution } : {}),
      } : null;
  }
  const withCategories = (plant, includeSource = false) => {
    return {
      ...plant,
      categories: categoryRefs.all(plant.id),
      coverImage: imageForPlant(plant.id, includeSource),
    };
  };

  return {
    identificationRecords: () => identificationRecords.all(),
    categories: () => categories.all().map((category) => {
      const cover = categoryCover.get(category.id);
      return { ...category, coverPlantId: cover?.plantId ?? null, coverImage: cover ? imageForPlant(cover.plantId, true) : null };
    }),
    hasCategory: (slug) => Boolean(findCategory.get(slug)),
    list: (slug) => (slug === undefined ? allPlants.all() : plantsForCategory.all(slug)).map((plant) => withCategories(plant)),
    userPlants: (userId) => plantsForUser.all(userId).map((plant) => withCategories(plant)),
    addUserPlant(userId, plantId) {
      const summary = db.prepare('SELECT ' + listColumns + ' FROM plants p WHERE p.id = ?').get(plantId);
      if (!summary) return null;
      addUserPlant.run(userId, plantId);
      return withCategories(summary);
    },
    removeUserPlant(userId, plantId) {
      const exists = db.prepare('SELECT 1 FROM plants WHERE id = ?').get(plantId);
      if (!exists) return null;
      removeUserPlant.run(userId, plantId);
      return { removed: true };
    },
    detail(id) {
      const plant = plantById.get(id);
      return plant ? { ...withCategories(plant, true), aliases: aliases.all(id) } : null;
    },
  };
}

module.exports = { createPlantRepository };
