const { randomUUID } = require('node:crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;

function createRequestId(value) {
  return REQUEST_ID_PATTERN.test(value || '') ? value : randomUUID();
}

function requestPath(req) {
  return (req.originalUrl || req.url || '/').split('?')[0];
}

function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s?]+\?[^\s)]+/gi, (url) => `${url.split('?')[0]}?[redacted]`)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|secret|signature|sign)\s*[:=]\s*)[^\s&,;]+/gi, '$1[redacted]');
}

function errorDetails(error) {
  if (!(error instanceof Error)) return { name: 'Error', message: redact(error) };
  const details = {
    name: error.name,
    message: redact(error.message),
    stack: error.stack ? redact(error.stack) : null,
  };
  if (error.cause && error.cause !== error) details.cause = errorDetails(error.cause);
  return details;
}

function logRequestError(req, error, event = 'request-error') {
  if (process.env.NODE_ENV === 'production') return;
  console.error(JSON.stringify({
    event,
    requestId: req.requestId,
    method: req.method,
    path: requestPath(req),
    error: errorDetails(error),
  }));
}

module.exports = { createRequestId, requestPath, errorDetails, logRequestError };
