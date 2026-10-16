const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const templateDirectory = path.join(__dirname, '..', 'supabase', 'templates');

for (const name of ['invite.html', 'recovery.html']) {
  test(`${name} envia somente OTP de uso único e abre URL pública`, () => {
    const html = fs.readFileSync(path.join(templateDirectory, name), 'utf8');

    assert.match(html, /\{\{\s*\.Token\s*\}\}/, 'template deve renderizar o OTP');
    assert.doesNotMatch(html, /\{\{\s*\.TokenHash\s*\}\}|\.ConfirmationURL|token_hash/i,
      'template não deve incluir token_hash ou URL de confirmação com token');
    assert.match(html, /https:\/\/nexa-gm\.vercel\.app(?:\/index\.html)?/,
      'template deve apontar para o site público');
    assert.match(html, /6\s*(?:dígitos|digitos)/i, 'template deve identificar o código de seis dígitos');
    assert.match(html, /1\s*hora/i, 'template deve informar validade de uma hora');
    assert.match(html, /uso\s+único|uma\s+vez/i, 'template deve informar uso único');
  });
}
