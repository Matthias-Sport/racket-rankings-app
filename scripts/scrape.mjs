#!/usr/bin/env node
// Pulls your results from the public ranking sites and writes data.json for Racket Rankings.
//   node scripts/scrape.mjs                       (uses the default name)
//   node scripts/scrape.mjs --name "Jane Doe"
// Only match data goes into data.json. Phone numbers and emails of other players are never stored there.
//   --full       rescan every CCVM phase back to the start (the default only rescans the latest 8 and keeps older results
//                from data.json, which is much lighter on the club's server).
//   --contacts   also writes ../Racket-Rankings-private/contacts-ccvm.local.csv with the phone/email of the players in YOUR current CCVM
//                group(s) (the details the club shows to group members). That folder sits OUTSIDE the project so it can never be uploaded by accident; import it
//                on the Data page. Use --contacts-since YYYY-MM-DD to include groups that ended after that date.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]); };
const NAME = opt('name', 'Matthias Homan');
const TODAY = new Date().toISOString().slice(0, 10);
const WANT_CONTACTS = args.includes('--contacts');
const FULL = args.includes('--full');
const RECENT_PHASES = 8;
const CONTACTS_SINCE = opt('contacts-since', TODAY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const nameTokens = norm(NAME).split(' ');
const isMe = s => { const n = norm(s); return nameTokens.every(t => n.includes(t)); };
const tidy = s => { s = String(s || '').replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim(); return s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y)\b/g, w => w.toLowerCase()) : s; };
const iso = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const flip = sc => sc.split(' ').map(t => { const m = t.match(/^(\(?)(\d+)[/-](\d+)(\)?)$/); return m ? `${m[1]}${m[3]}-${m[2]}${m[4]}` : t; }).join(' ');

async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (racket-rankings personal results sync)' } });
      if (r.status === 404) return null;
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(800 * (i + 1));
  }
  throw new Error('Failed to fetch ' + url);
}

/* ---------- CCVM (escuelatenisccvm.com) ---------- */
const CCVM = { id: 'ccvm', name: 'Ranking CCVM Adultos', sport: 'tennis' };
async function ccvmApi(body) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://www.escuelatenisccvm.com/app/api/ranking.do', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await sleep(800 * (i + 1));
  }
  throw new Error('CCVM API failed');
}
function ccvmSets(p, mineIsFirst) {
  const sets = [];
  for (let i = 1; i <= 5; i++) {
    const a = p['r' + i], b = p['c' + i];
    if (!a && !b) continue;
    const [m, t] = mineIsFirst ? [a, b] : [b, a];
    sets.push(Math.max(a, b) <= 1 ? `[${m}-${t}]` : `${m}-${t}`);   // 1/0 = match tie-break, margin not recorded
  }
  return sets.join(' ');
}
async function scrapeCCVM(prevMatches = []) {
  const matches = [], upcoming = [], contacts = new Map();
  const scout = new Map();                                               // group opponents -> their other results in the group
  let lastGroup = null;                                                  // standings of your most recent group (phases are scanned newest first)
  let phases = 0;
  let top = 270;                                                         // then probe upwards for newer phases
  while (((await ccvmApi({ codigo: top + 1, accion: 'recuperarGrupos' })).data || []).length) top++;
  const floor = FULL || !prevMatches.length ? 1 : Math.max(1, top - RECENT_PHASES);
  for (let fase = top; fase >= floor; fase--) {
    const groups = (await ccvmApi({ codigo: fase, accion: 'recuperarGrupos' })).data || [];
    await sleep(100);
    if (!groups.length || groups[0].codigoRanking !== 49) continue;     // 49 = the adult ranking
    for (const g of groups) {
      const me = (g.jugadores || []).find(j => isMe(j.nombreCuadro));
      if (!me) continue;
      phases++;
      const d = await ccvmApi({ codigo: g.codigo, accion: 'recuperarGrupo' });
      await sleep(100);
      const label = `Fase ${fase} · ${g.nombreGrupo}`;
      if (!lastGroup) {
        const players = (d.grupo?.jugadores || []).map(j => ({
          name: tidy(j.nombreCuadro), pos: j.posicion || 0, pts: j.puntos || 0, pj: j.PJ || 0, pg: j.PG || 0, pp: j.PP || 0,
          sg: j.SG || 0, sp: j.SP || 0, jg: j.JG || 0, jp: j.JP || 0, me: j.codigo === me.codigo,
        })).sort((a, b) => (a.pos || 99) - (b.pos || 99));
        const numbered = /^grupo \d+$/i.test(g.nombreGrupo || '');
        const above = groups.filter(x => x.orden < g.orden).reduce((n, x) => n + (x.jugadores || []).length, 0);
        const myPos = players.find(x => x.me)?.pos || 0;
        lastGroup = {
          rankingId: 'ccvm', phase: fase, name: g.nombreGrupo, start: iso(g.fechaInicio), end: iso(g.fechaFin),
          current: iso(g.fechaFin) >= TODAY, players,
          overall: numbered && myPos ? { pos: above + myPos, of: groups.reduce((n, x) => n + (x.jugadores || []).length, 0) } : undefined,
        };
      }
      if (WANT_CONTACTS && iso(g.fechaFin) >= CONTACTS_SINCE) {
        for (const p of d.partidos || []) for (const side of [p.jugador, p.contrario]) {
          const c = side?.datos?.[0];
          if (!c || isMe(side.nombre)) continue;
          const phone = String(c.movil || c.telefono || '').replace(/\D/g, '');
          if (phone || c.email) contacts.set(norm(side.nombre), [`${c.apellido1 || ''} ${c.apellido2 || ''}`.trim(), c.nombre || '', phone, c.email || '']);
        }
      }
      for (const p of d.partidos || []) {
        const first = p.codigoJugador === me.codigo, second = p.codigoContrario === me.codigo;
        if (!first && !second) continue;
        const opp = first ? p.contrario : p.jugador;
        const oppName = tidy(opp?.nombre);
        if (!p.ganador) {
          if (iso(g.fechaFin) >= TODAY) {
            upcoming.push({ rankingId: 'ccvm', opponent: oppName, deadline: iso(g.fechaFin), label: `${label} · Jornada ${p.jornada}`,
                            phase: fase, group: g.nombreGrupo, jornada: p.jornada, oppCode: first ? p.codigoContrario : p.codigoJugador });
          }
          continue;
        }
        const won = p.ganador === me.codigo;
        let score = ccvmSets(p, first);
        if (p.wo || p.woContrario) score = score ? score + ' W.O.' : 'W.O.';
        if (p.abandono || p.abandonoContrario) score += ' ret.';
        matches.push({
          ext: `ccvm:${p.codigo}`, phase: fase, date: iso(p.fecha) || iso(g.fechaFin), rankingId: 'ccvm', type: 'singles', partner: '',
          opponents: [oppName], score: score.trim(), result: won ? 'W' : 'L', notes: `${label} · Jornada ${p.jornada}`,
        });
      }
      for (const u of upcoming.filter(x => x.phase === fase && x.group === g.nombreGrupo && x.oppCode)) {
        const code = u.oppCode;
        const rows = (d.partidos || []).filter(p => p.ganador && (p.codigoJugador === code || p.codigoContrario === code) && p.codigoJugador !== me.codigo && p.codigoContrario !== me.codigo);
        scout.set(norm(u.opponent), {
          name: u.opponent, source: 'group', pos: (d.grupo?.jugadores || []).find(j => j.codigo === code)?.posicion || undefined,
          matches: rows.map(p => {
            const f = p.codigoJugador === code, other = f ? p.contrario : p.jugador;
            return { date: iso(p.fecha) || iso(g.fechaFin), label, vs: tidy(other?.nombre), score: ccvmSets(p, f) + (p.wo || p.woContrario ? ' W.O.' : ''), result: p.ganador === code ? 'W' : 'L' };
          }).sort((a, b) => b.date.localeCompare(a.date)),
        });
        delete u.oppCode;
      }
    }
  }
  const phaseOf = m => m.phase ?? +((m.notes || '').match(/Fase (\d+)/) || [])[1];
  const have = new Set(matches.map(m => m.ext));                          // never lose a stored result just because a rescan came back empty
  const older = prevMatches.filter(m => !have.has(m.ext)).map(m => ({ ...m, phase: phaseOf(m) }));
  return { matches: [...older, ...matches], upcoming, phases, contacts: [...contacts.values()], groups: lastGroup ? [lastGroup] : null, scouting: Object.fromEntries(scout) };
}

/* ---------- Ranking Club de Campo (rankingclubdecampo.es) ---------- */
const CDC = { id: 'cdc', name: 'Ranking Club de Campo', sport: 'tennis', note: 'The site does not publish exact match dates, so each match is dated to the end of its cuadro\'s play window. Position is your ladder number in that cuadro (lower is better).' };
const MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const cellText = h => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
function cdcWindowEnd(html) {
  const text = cellText(html);
  const m = text.match(/entre el [^,]*,? ?(\d+) de (\p{L}+)(?: de (\d{4}))? y el [^,]*,? ?(\d+) de (\p{L}+) de (\d{4})/iu);
  if (!m) return '';
  return `${m[6]}-${String(MONTHS[m[5].toLowerCase()] || 1).padStart(2, '0')}-${String(m[4]).padStart(2, '0')}`;
}
function cdcSet(score, iAmWinner) {
  // Result column is written from the WINNER's point of view; flip to mine if I lost.
  const txt = score.replace(/\s+/g, ' ').trim();
  const retired = /lesi|retirad|abandon/iu.test(txt);
  const parts = txt.replace(/(lesi|retirad|abandon)\p{L}*/giu, '').trim().split(' ').filter(Boolean);
  const done = (a, b) => (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) || [a, b].sort().join() === '5,7' || [a, b].sort().join() === '6,7' || Math.max(a, b) >= 10;
  const out = parts.map((t, i) => {
    const m = t.match(/^(\d+)\/(\d+)$/);
    if (!m) return t;
    let [a, b] = [+m[1], +m[2]];
    const complete = !(retired && i === parts.length - 1 && !done(a, b));
    if (!iAmWinner) [a, b] = [b, a];
    return complete ? `${a}-${b}` : `(${a}-${b})`;
  });
  return (out.join(' ') + (retired ? ' ret.' : '')).trim();
}
async function scrapeCDC() {
  const matches = [], upcoming = [], standings = [];
  const scout = new Map();                                               // upcoming opponents -> their recent results (every cuadro lists everybody's matches)
  const start = await getText('https://rankingclubdecampo.es/cuadro-426/');
  const nums = [...start.matchAll(/\/cuadro-(\d+)\//g)].map(m => +m[1]);
  let lo = Math.min(...nums), hi = Math.max(...nums);
  while (await getText(`https://rankingclubdecampo.es/cuadro-${hi + 1}/`)) hi++;   // newer phases, once published
  for (let n = hi; n >= lo; n--) {
    const html = await getText(`https://rankingclubdecampo.es/cuadro-${n}/`);
    await sleep(150);
    if (!html) continue;
    const end = cdcWindowEnd(html);
    const serie = (cellText(html).match(/Serie \d+/) || [''])[0];
    const label = `Cuadro ${n}${serie ? ' · ' + serie : ''}`;
    const rows = (html.match(/<tr[\s\S]*?<\/tr>/g) || []).map(tr => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => cellText(m[1])))
      .filter(c => c.length === 9 && /^contra/i.test(c[3]));
    const maxPos = Math.max(0, ...rows.flatMap(c => [+c[0], +c[4]]).filter(Number.isFinite));
    for (const c of rows) {
      for (const [k, v] of scout) {                                          // collect the scouted opponent's results from this cuadro
        const aIs = norm(`${c[2]} ${c[1]}`) === k, bIs = norm(`${c[6]} ${c[5]}`) === k;
        if (!(aIs || bIs) || v.matches.length >= 10 || !c[7] || !c[8] || /no jugado/i.test(c[8])) continue;
        if (isMe(`${c[2]} ${c[1]}`) || isMe(`${c[6]} ${c[5]}`)) continue;     // matches against you are in your own head-to-head
        const [their, vs, vsName] = aIs ? [c[0], c[4], `${c[6]} ${c[5]}`] : [c[4], c[0], `${c[2]} ${c[1]}`];
        const won = c[7] === their;
        v.matches.push({ date: end, label, vs: vsName.replace(/\s+/g, ' ').trim(), vsPos: +vs || undefined, theirPos: +their || undefined, score: cdcSet(c[8], won), result: won ? 'W' : 'L' });
      }
      const left = isMe(`${c[2]} ${c[1]}`), right = isMe(`${c[6]} ${c[5]}`);
      if (!left && !right) continue;
      const [myPos, oppPos, oS, oN] = left ? [c[0], c[4], c[5], c[6]] : [c[4], c[0], c[1], c[2]];
      if (/sin contrario/i.test(oS)) continue;                               // bye
      if (!standings.length && +myPos) standings.push({ rankingId: 'cdc', kind: 'ladder', label, pos: +myPos, of: maxPos, cuadro: n });   // newest cuadro you appear in
      const opp = `${oN} ${oS}`.replace(/\s+/g, ' ').trim();
      const winner = c[7], res = c[8];
      if (!winner && !res) {
        if (n === hi || (end && end >= TODAY)) { upcoming.push({ rankingId: 'cdc', opponent: opp, deadline: end, label, myPos: +myPos || undefined, oppPos: +oppPos || undefined }); scout.set(norm(opp), { name: opp, source: 'cuadros', pos: +oppPos || undefined, matches: [] }); }
        continue;
      }
      if (/no jugado/i.test(res) || !winner) continue;
      const won = winner === myPos;
      matches.push({
        ext: `cdc:${n}:${c[0]}-${c[4]}`, date: end, rankingId: 'cdc', type: 'singles', partner: '', opponents: [opp],
        score: cdcSet(res, won), result: won ? 'W' : 'L', notes: label, pos: +myPos || undefined,
      });
    }
  }
  return { matches, upcoming, standings, scouting: Object.fromEntries(scout), cuadros: hi - lo + 1 };
}

/* ---------- main ---------- */
console.log(`Syncing results for "${NAME}"…`);
const file = resolve(ROOT, 'data.json');
const prev = await readFile(file, 'utf8').then(JSON.parse, () => null);
let ccvm;
try { ccvm = await scrapeCCVM((prev?.matches || []).filter(m => m.rankingId === 'ccvm')); if (!ccvm.groups) ccvm.groups = prev?.groups || []; }
catch (e) {                                                              // site down or blocking: keep what we had instead of losing it
  console.warn(`CCVM site unavailable (${e.message}); keeping the previous CCVM data.`);
  ccvm = { matches: (prev?.matches || []).filter(m => m.rankingId === 'ccvm'), upcoming: (prev?.upcoming || []).filter(u => u.rankingId === 'ccvm'),
           groups: prev?.groups || [], contacts: [], phases: 0,
           scouting: Object.fromEntries(Object.entries(prev?.scouting || {}).filter(([, v]) => v.source === 'group')) };
}
const cdc = await scrapeCDC();
const matches = [...ccvm.matches, ...cdc.matches].sort((a, b) => (a.date + a.ext).localeCompare(b.date + b.ext));
const out = {
  generated: new Date().toISOString(), player: NAME,
  rankings: [CCVM, CDC],
  matches,
  upcoming: [...ccvm.upcoming, ...cdc.upcoming],
  standings: cdc.standings,                                              // ladder position per ranking
  scouting: { ...cdc.scouting, ...(ccvm.scouting || {}) },                                                // recent results of your upcoming opponents (Club de Campo)
  groups: ccvm.groups,                                                   // your latest CCVM group, with the full table
};
const same = prev && JSON.stringify({ ...prev, generated: '' }) === JSON.stringify({ ...out, generated: '' });
if (!same) await writeFile(file, JSON.stringify(out, null, 1) + '\n');     // keep the file (and git history) quiet when nothing changed
if (WANT_CONTACTS) {
  const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const priv = resolve(ROOT, '..', 'Racket-Rankings-private');          // outside the repo folder on purpose
  await mkdir(priv, { recursive: true });
  await writeFile(resolve(priv, 'contacts-ccvm.local.csv'), ['Apellidos,Nombre,Teléfono,Email', ...ccvm.contacts.map(r => r.map(q).join(','))].join('\n') + '\n');
  console.log(`Contacts: ${ccvm.contacts.length} players from your current CCVM group(s) -> ../Racket-Rankings-private/contacts-ccvm.local.csv`);
}
console.log(`CCVM: ${ccvm.matches.length} matches in ${ccvm.phases} groups · Club de Campo: ${cdc.matches.length} matches across ${cdc.cuadros} cuadros`);
console.log(`Upcoming: ${out.upcoming.map(u => u.opponent + ' (' + u.label + ')').join('; ') || 'none'}`);
