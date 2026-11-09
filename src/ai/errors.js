class AiError extends Error {
  constructor(code, status, message, options = {}) {
    super(message, options);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

module.exports = { AiError };
