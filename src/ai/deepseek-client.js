const { AiError } = require('./errors');

function createDeepSeekClient({
  apiKey = process.env.DEEPSEEK_API_KEY || '',
  baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model = process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 30_000),
  logger = process.env.NODE_ENV === 'production' && process.env.DEBUG !== '1' ? null : console,
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  function logFailure(error, startedAt, upstreamStatus = null, requestId = null) {
    if (typeof logger?.error !== 'function') return;
    try {
      logger.error({
        event: 'ai-service-error',
        requestId,
        code: error.code,
        upstreamStatus,
        model,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // Diagnostics must not replace the request error.
    }
  }

  async function chat(messages, { signal, requestId } = {}) {
    const startedAt = Date.now();
    if (!apiKey) {
      const error = new AiError('AI_NOT_CONFIGURED', 503, 'AI service is not configured');
      logFailure(error, startedAt, null, requestId);
      throw error;
    }
    if (typeof fetchImpl !== 'function') {
      const error = new AiError('AI_UNAVAILABLE', 502, 'AI service is unavailable');
      logFailure(error, startedAt, null, requestId);
      throw error;
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) throw signal.reason || new Error('Request canceled');
      signal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error('DeepSeek request timed out')), timeoutMs);
    let upstreamStatus = null;

    try {
      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            thinking: { type: 'enabled' },
            reasoning_effort: 'high',
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
          throw new AiError('AI_TIMEOUT', 504, 'AI service timed out', { cause: error });
        }
        if (signal?.aborted) throw signal.reason || error;
        throw new AiError('AI_UNAVAILABLE', 502, 'AI service is unavailable', { cause: error });
      }
      upstreamStatus = response.status;

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AiError('AI_CONFIGURATION_ERROR', 503, 'AI service configuration is invalid');
        }
        if (response.status === 429) throw new AiError('AI_RATE_LIMITED', 429, 'AI service rate limit reached');
        throw new AiError('AI_UNAVAILABLE', 502, 'AI service is unavailable');
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new AiError('AI_UNAVAILABLE', 502, 'AI service returned an invalid response', { cause: error });
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AiError('AI_UNAVAILABLE', 502, 'AI service returned an invalid response');
      }
      return { content: content.trim() };
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (error instanceof AiError) logFailure(error, startedAt, upstreamStatus, requestId);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return { model, chat };
}

module.exports = { createDeepSeekClient };
