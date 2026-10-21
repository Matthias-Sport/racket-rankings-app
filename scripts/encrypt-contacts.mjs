#!/usr/bin/env node
// Encrypts your contact list into contacts.enc.json so it can live in the public repo without exposing anyone's number.
//   node scripts/encrypt-contacts.mjs                  (reads the CSVs in ../Racket-Rankings-private/)
//   node scripts/encrypt-contacts.mjs a.csv b.csv      (or pass CSV files explicitly)
// You are asked for a passphrase (typed hidden). In the app, "Unlock contacts" asks for the same passphrase once per device;
// the decrypted contacts are then kept in that device's browser only. Choose a long passphrase: anyone who guesses it can read the list.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import readline from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIV = resolve(ROOT, '..', 'Racket-Rankings-private');
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const inputs = files.length ? files : ['contacts.local.csv', 'contacts-ccvm.local.csv'].map(f => resolve(PRIV, f)).filter(existsSync);
if (!inputs.length) { console.error(`No contact CSVs found in ${PRIV}`); process.exit(1); }

function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(x => x.trim())) rows.push(row); return rows;
}
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const byName = new Map();
for (const file of inputs) {
  const rows = parseCSV(await readFile(file, 'utf8'));
  const head = rows[0].map(plain), col = (...k) => head.findIndex(h => k.some(x => h.includes(x)));
  const iS = col('apellido'), iN = col('nombre', 'name'), iP = col('telefono', 'movil', 'phone'), iE = col('email', 'correo');
  for (const r of rows.slice(1)) {
    const g = i => i < 0 ? '' : String(r[i] || '').trim();
    const name = `${g(iN)} ${g(iS)}`.replace(/\s+/g, ' ').trim(), phone = g(iP), email = g(iE);
    if (name && (phone || email)) byName.set(plain(name), { ...byName.get(plain(name)), name, phone, email });
  }
}
const contacts = [...byName.values()];

function ask(prompt) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(prompt)) process.stdout.write(s); };   // hide what is typed
    rl.question(prompt, a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}
const pw = process.env.RR_PASSPHRASE || await ask('Passphrase (min. 12 characters): ');
if (pw.length < 12) { console.error('Passphrase too short.'); process.exit(1); }
if (!process.env.RR_PASSPHRASE && pw !== await ask('Repeat passphrase: ')) { console.error('Passphrases differ.'); process.exit(1); }

const iter = 250000, salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(pw, salt, iter, 32, 'sha256');
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(JSON.stringify(contacts), 'utf8'), c.final(), c.getAuthTag()]);   // WebCrypto expects the tag appended
await writeFile(resolve(ROOT, 'contacts.enc.json'), JSON.stringify({ v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), data: enc.toString('base64') }) + '\n');
console.log(`Encrypted ${contacts.length} contacts from ${inputs.length} file(s) into contacts.enc.json`);
