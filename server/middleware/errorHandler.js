function errorHandler(err, _req, res, _next) {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Server error',
  });
}

module.exports = errorHandler;
