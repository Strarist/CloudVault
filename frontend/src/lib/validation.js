const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailAddress(email) {
  return EMAIL_PATTERN.test(email.trim());
}

module.exports = {
  isValidEmailAddress,
};
