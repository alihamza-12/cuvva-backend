const crypto = require("crypto");

const POLICY_PREFIX = "PPWAKF";
const RANDOM_LENGTH = 11;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generatePolicyNumber() {
  let randomPart = "";

  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    randomPart += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }

  return `${POLICY_PREFIX}${randomPart}`;
}

module.exports = { generatePolicyNumber };
