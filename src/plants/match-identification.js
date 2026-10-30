function normalizeScientificName(name) {
  return name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function matchLocalPlant(name, plants) {
  const normalized = normalizeScientificName(name);
  const matches = plants.filter((plant) => normalizeScientificName(plant.scientificName) === normalized);
  if (matches.length === 0) return { status: 'unmatched', plant: null };
  if (matches.length > 1) return { status: 'ambiguous', plant: null };
  const plant = matches[0];
  if (plant.identityStatus !== 'verified' || plant.publicationStatus !== 'published') {
    return { status: 'not_ready', plant: null };
  }
  return { status: 'matched', plant: { id: plant.id, nameZh: plant.nameZh } };
}

module.exports = { normalizeScientificName, matchLocalPlant };
