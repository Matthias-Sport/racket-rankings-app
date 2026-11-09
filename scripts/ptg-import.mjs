#!/usr/bin/env node
// Merges a PTG payload file (exported from app.padelteamgourmet.com) into data.json.
// Usage: node scripts/ptg-import.mjs path/to/ptg-payload.json
// Payload shape: { "matches": [...], "upcoming": [...], "standings": [...] }
// Every provided array REPLACES all existing rows with rankingId 'ptg' for that key;
// keys left out of the payload stay untouched. Tennis (ccvm/cdc) rows are never modified.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payloadArg = process.argv[2];
if (!payloadArg) {
  console.error('Usage: node scripts/ptg-import.mjs <ptg-payload.json>');
  process.exit(1);
}

const file = resolve(ROOT, 'data.json');
const data = JSON.parse(await readFile(file, 'utf8'));
const payload = JSON.parse(await readFile(resolve(process.cwd(), payloadArg), 'utf8'));

for (const key of ['matches', 'upcoming', 'standings']) {
  if (!Array.isArray(payload[key])) continue;
  data[key] = [...(data[key] || []).filter(x => x.rankingId !== 'ptg'), ...payload[key]];
}
if (Array.isArray(payload.matches)) {
  data.matches.sort((a, b) => (a.date + a.ext).localeCompare(b.date + b.ext));
}
data.generated = new Date().toISOString();
await writeFile(file, JSON.stringify(data, null, 1) + '\n');
console.log(`PTG merged into data.json: ${payload.matches?.length ?? '-'} matches · ${payload.upcoming?.length ?? '-'} upcoming · ${payload.standings?.length ?? '-'} standings`);
