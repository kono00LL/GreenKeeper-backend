const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchLocalPlant, normalizeScientificName } = require('../src/plants/match-identification');

const plant = (overrides = {}) => ({ id: 'uuid', nameZh: '铁线蕨', scientificName: 'Adiantum capillus-veneris', identityStatus: 'verified', publicationStatus: 'published', ...overrides });
const noMatch = (status) => ({ status, plant: null });

test('matches exact names after NFC, case and whitespace normalization, returning stable identity only', () => {
  assert.equal(normalizeScientificName('  ADIANTUM\t capillus-veneris  '), 'adiantum capillus-veneris');
  assert.deepEqual(matchLocalPlant(' ADIANTUM\tCAPILLUS-VENERIS ', [plant()]), { status: 'matched', plant: { id: 'uuid', nameZh: '铁线蕨' } });
  assert.deepEqual(matchLocalPlant('Test cafe\u0301', [plant({ scientificName: 'Test café' })]).status, 'matched');
});

test('distinguishes absence, unpublished identity and duplicates across all records', () => {
  assert.deepEqual(matchLocalPlant('Unknown species', [plant()]), noMatch('unmatched'));
  for (const overrides of [{ identityStatus: 'pending' }, { publicationStatus: 'draft' }, { publicationStatus: null }]) {
    assert.deepEqual(matchLocalPlant(plant().scientificName, [plant(overrides)]), noMatch('not_ready'));
  }
  assert.deepEqual(matchLocalPlant(plant().scientificName, [plant(), plant({ id: 'other', identityStatus: 'pending', publicationStatus: 'draft' })]), noMatch('ambiguous'));
});

test('preserves authorship, hybrid signs, hyphens, subspecies and varieties; no aliases or fuzzy matching', () => {
  const names = ['Adiantum capillus veneris', 'Adiantum capillus-veneris L.', 'Adiantum capillus-veneris subsp. test'];
  for (const name of names) assert.deepEqual(matchLocalPlant(name, [plant()]), noMatch('unmatched'));
  assert.deepEqual(matchLocalPlant('Fragaria ananassa', [plant({ scientificName: 'Fragaria × ananassa' })]), noMatch('unmatched'));
  assert.deepEqual(matchLocalPlant('Fragaria x ananassa', [plant({ scientificName: 'Fragaria × ananassa' })]), noMatch('unmatched'));
  assert.deepEqual(matchLocalPlant('Dracaena reflexa var. angustifolia', [plant({ scientificName: 'Dracaena reflexa' })]), noMatch('unmatched'));
  assert.deepEqual(matchLocalPlant('铁线蕨', [plant()]), noMatch('unmatched'));
  assert.deepEqual(matchLocalPlant('Rosmarinus officinalis', [plant({ scientificName: 'Salvia rosmarinus' })]), noMatch('unmatched'));
});
