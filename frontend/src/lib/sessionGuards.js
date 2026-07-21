function shouldBootstrapAuth({ hasInitialized, isAuthenticated, loading }) {
  return !hasInitialized && !isAuthenticated && !loading;
}

function shouldRedirectToLogin({ hasInitialized, isAuthenticated, loading }) {
  return hasInitialized && !isAuthenticated && !loading;
}

module.exports = {
  shouldBootstrapAuth,
  shouldRedirectToLogin,
};
