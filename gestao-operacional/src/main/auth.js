'use strict';
/** Hash de senhas com scrypt (módulo crypto nativo do Node) — senhas nunca são gravadas em texto puro. */
const crypto = require('crypto');

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, PARAMS).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(String(password), salt, KEYLEN, PARAMS);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }
}

module.exports = { hashPassword, verifyPassword, validatePasswordStrength };
