class StatusCodeError extends Error {
  constructor(message, statusCode = 500, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'StatusCodeError';
    this.statusCode = statusCode;
    this.code = options.code;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  asyncHandler,
  StatusCodeError,
};
