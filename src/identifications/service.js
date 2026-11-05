const { validateImage } = require('../images/service');
const { matchLocalPlant } = require('../plants/match-identification');

function createIdentificationService(client, plantRepository) {
  return {
    async identify(file, signal, requestId) {
      await validateImage(file, ['image/jpeg', 'image/png']);
      const result = await client.identify(file, { signal, requestId });
      if (signal?.aborted) throw signal.reason;
      if (result.candidates.length === 0) return result;
      const plants = plantRepository.identificationRecords();
      return { ...result, candidates: result.candidates.map((candidate) => ({ ...candidate,
        localMatch: matchLocalPlant(candidate.scientificNameWithoutAuthor || candidate.scientificName, plants),
      })) };
    },
  };
}

module.exports = { createIdentificationService };
