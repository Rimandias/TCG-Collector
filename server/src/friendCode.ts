import crypto from 'node:crypto';
import { db } from './db.js';

// Alfabeto sem caracteres visualmente ambíguos (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

const codeExists = db.prepare('SELECT 1 FROM users WHERE friend_code = ?');

export function generateUniqueFriendCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    if (!codeExists.get(code)) return code;
  }
  throw new Error('Não foi possível gerar um código de amigo único.');
}

export function formatFriendCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
