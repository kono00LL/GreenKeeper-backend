const { IdentificationError } = require('./errors');

function unavailable(upstreamStatus) {
  return new IdentificationError(502, 'IDENTIFICATION_UNAVAILABLE', '植物识别服务暂不可用，请稍后重试', upstreamStatus);
}

function normalizeResult(body) {
  if (!body || !Array.isArray(body.results)) throw unavailable();
  const candidates = body.results.slice(0, 3).map(({ species, score }) => {
    if (typeof species?.scientificName !== 'string' || !species.scientificName.trim() ||
        !Number.isFinite(score) || score < 0 || score > 1 ||
        (species.commonNames != null && (!Array.isArray(species.commonNames) || species.commonNames.some((name) => typeof name !== 'string')))) {
      throw unavailable();
    }
    const scientificNameWithoutAuthor = typeof species.scientificNameWithoutAuthor === 'string' && species.scientificNameWithoutAuthor.trim()
      ? species.scientificNameWithoutAuthor : null;
    return { scientificName: species.scientificName, scientificNameWithoutAuthor, commonNames: species.commonNames ?? [], score };
  });
  return { bestMatch: candidates[0]?.scientificName ?? null, candidates };
}

function createPlantnetClient({ apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 25_000, logger = console } = {}) {
  return {
    async identify(file, { signal } = {}) {
      if (!apiKey.trim()) throw new IdentificationError(503, 'IDENTIFICATION_NOT_CONFIGURED', '植物识别功能尚未配置');
      const url = new URL('https://my-api.plantnet.org/v2/identify/all');
      url.search = new URLSearchParams({ 'api-key': apiKey.trim(), lang: 'zh', 'nb-results': '3', 'include-related-images': 'false', detailed: 'false' });
      const form = new FormData();
      form.append('images', new Blob([file.buffer], { type: file.mimetype }), file.mimetype === 'image/png' ? 'plant.png' : 'plant.jpg');
      const timeout = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const startedAt = Date.now();
      let upstreamStatus;
      try {
        const response = await fetchImpl(url, { method: 'POST', body: form, signal: requestSignal });
        upstreamStatus = response.status;
        if (response.status === 404) return { bestMatch: null, candidates: [] };
        if (response.status === 401 || response.status === 403) {
          throw new IdentificationError(503, 'IDENTIFICATION_CONFIGURATION_ERROR', '植物识别服务配置异常，请联系管理员', response.status);
        }
        if (response.status === 429) {
          throw new IdentificationError(429, 'IDENTIFICATION_LIMIT_REACHED', '识别额度已用完或请求过于频繁，请稍后再试', response.status);
        }
        if (!response.ok) throw unavailable(response.status);
        return normalizeResult(await response.json());
      } catch (error) {
        if (signal?.aborted && !timeout.aborted) throw signal.reason;
        const failure = timeout.aborted
          ? new IdentificationError(504, 'IDENTIFICATION_TIMEOUT', '植物识别超时，请重试', upstreamStatus)
          : error instanceof IdentificationError ? error : unavailable(upstreamStatus);
        // Only log explicit safe fields; fetch errors may contain the API key in their URL.
        logger.error({ event: 'plant-identification-error', code: failure.code, upstreamStatus, durationMs: Date.now() - startedAt });
        throw failure;
      }
    },
  };
}

module.exports = { createPlantnetClient };
