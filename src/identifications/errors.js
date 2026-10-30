class IdentificationError extends Error {
  constructor(status, code, message, upstreamStatus) {
    super(message);
    this.status = status;
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

module.exports = { IdentificationError };
