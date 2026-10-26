# Racket Rankings: handover

Personal tennis and padel results tracker for Matthias Homan. This file is for anyone (including a new Claude session) who continues the work. Read it fully before changing anything.

## 1. What it is

- A phone-first web app, installed on Matthias's Android phone as a home-screen app.
- **Live address:** https://matthias-sport.github.io/racket-rankings-app/
- **Repo:** https://github.com/Matthias-Sport/racket-rankings-app (public, GitHub Pages from `main` / root)
- **Local copy:** `~/Downloads/Racket-Rankings` (git remote `origin` points at the repo above)
- It shows results, head-to-head, ladder position, group standings, the next opponent(s) with contact, message, calendar events and result email, and a scouting report.
- Rankings followed: **Club de Campo ladder** (rankingclubdecampo.es) and **CCVM adult ranking** (escuelatenisccvm.com, groups of 5). Padel (Padel Team Gourmet, behind a member login) is entered by hand. Apostol Santiago (Madrid) may be added after Matthias joins.

## 2. How it is built

- **One file, no build step, no dependencies:** `index.html` (vanilla JS + CSS, SVG charts drawn by hand). Keep it that way unless there is a strong reason.
- Hash routing: `#/dashboard`, `#/matches`, `#/opponents[/name]`, `#/rankings[/id]`, `#/data`.
- Layout: bottom tab bar and floating "+ Match" button on phones (max-width 720px), top nav on larger screens.

| File | Purpose |
|---|---|
| `index.html` | The whole app |
| `data.json` | Synced results, written by the scraper, committed by the daily GitHub Action |
| `contacts.enc.json` | Club phone list, **encrypted** (AES-GCM, PBKDF2). Unlocked in the app with a passphrase |
| `sw.js` | Service worker, network-first, gives offline fallback and makes the app installable |
| `manifest.webmanifest`, `icon*.png/svg` | Home-screen app settings and icons. Manifest `id` is `/racket-rankings-app/` |
| `scripts/scrape.mjs` | Node script that reads both ranking sites and writes `data.json` |
| `scripts/encrypt-contacts.mjs` | Encrypts the private contact CSVs into `contacts.enc.json` |
| `scripts/contacts-from-pdf.py` | Converts the club phone-list PDF to a CSV (needs PyMuPDF) |
| `.github/workflows/update.yml` | Runs the scraper daily at 06:00 UTC and commits `data.json` only |

## 3. Data flow

```
ranking sites --scrape.mjs--> data.json --(daily GitHub Action commits)--> GitHub Pages --> app
contact PDF --contacts-from-pdf.py--> private CSV --encrypt-contacts.mjs--> contacts.enc.json --> app (unlock once per device)
hand-entered matches, notes, statuses  -->  browser localStorage only (per device)
```

**`data.json` shape:** `generated`, `player`, `rankings[]`, `matches[]`, `upcoming[]`, `standings[]` (Club de Campo ladder position), `groups[]` (latest CCVM group table), `scouting{}` (recent results of upcoming opponents).

**Match object:** `id`, `ts`, `date`, `rankingId`, `type` (singles/doubles), `partner`, `opponents[]`, `score` (your games first, e.g. `6-3 4-6 10-8`; `[1-0]` = match tiebreak with unknown margin; `(5-4)` = unfinished set after a retirement), `result` (W/L), `notes`, plus `ext` (synced from a site), `pos` (ladder position), `planKey` (created from a result you entered on a Next up card).

**Browser storage keys** (all prefixed `courtlog.v1`): the main store, `.contacts`, `.plans`, `.notes`, `.msgtpl`, `.msgtpl2`, `.rmail`, `.rtpl`. Storage is **per web address**, so moving the site to a new address starts every device fresh. Use the Data page "Copy backup code" before any move.

**De-duplication:** a result entered on a Next up card becomes a local match (`plan:` id). When the club site later posts the same match (same ranking, opponent and label), the synced one wins and the local one is dropped.

## 4. How the scraper works (and its limits)

- **Club de Campo:** public HTML pages `cuadro-N` (312 to the newest; it probes for newer ones). Rows are `Pos | surname | name | contra | Pos | surname | name | Gana | Resultados`. The result text is written **from the winner's point of view** (converted to yours). No exact match dates exist, so the match is dated to the **end of the cuadro's play window**.
- **CCVM:** JSON endpoint `POST /app/api/ranking.do` with `{codigo, accion}`. `recuperarGrupos` (codigo = phase) lists groups of a phase, `recuperarGrupo` (codigo = group id) gives players and matches. Ranking id 49 is the adult ranking. By default it rescans only the latest 8 phases (`--full` for everything), never deletes stored results, and keeps the old data if the site is down.
- The name used to find Matthias is `Matthias Homan` (`--name` to change).
- **The CCVM site has refused connections from Matthias's Mac since about 20 Oct 2026** (also in the browser there), possibly after heavy early scanning (the cause is not confirmed). GitHub's servers can still reach it, so the daily Action works. Do not scan it aggressively again.
- The CCVM group flow (several opponents, standings, scouting) was tested only against a **mock** group. Check it with real data when the new phase starts (1 Nov 2026).

## 5. Credentials, accounts and privacy

- **GitHub:** user `mhoman05`; the repo lives in the free organisation `Matthias-Sport`. Pages and the daily Action are enabled there. The Action needs "Read and write" workflow permission (set at organisation level).
- **How Claude pushes:** Matthias created a GitHub personal access token once and entered it at the first `git push` in Terminal. macOS Keychain stored it (`credential.helper = osxkeychain`). Later pushes from this Mac reuse it automatically. The token was never given to Claude. Commits use Matthias's git identity (`mhoman05`) with a `Co-Authored-By: Claude` line. To revoke access: github.com/settings/tokens, delete the token.
- **Claude never created the repo or the organisation.** Matthias did, on github.com.
- **Contacts are other people's phone numbers. Never commit them in plain text.**
  - Plain CSVs live in `~/Downloads/Racket-Rankings-private/` (outside the repo on purpose) and are git-ignored.
  - Only `contacts.enc.json` is committed. The passphrase is known only to Matthias.
  - The scraper never writes phones or emails to `data.json`. `--contacts` writes them to the private folder only.
- Contacts unlocked in the app are stored on that device only.

## 6. Working on it

- **Test at phone width** (375px) and desktop before pushing. Use fake or sample data for anything involving contacts.
- **Local server note:** on macOS, a server started inside `Downloads` can fail with a permission error. Serve a copy from a temp folder, or move the project out of Downloads (recommended, see section 8).
- **Ask before every commit and push.** Matthias has approved each push explicitly so far. Commit messages end with the Claude co-author line.
- After a push, GitHub Pages takes 1 to 2 minutes. The service worker is network-first, so a reload picks up changes.
- Do not rename or transfer the repo again without warning: it changes the web address and wipes each device's local data. (This was done once to escape a stale Chrome install record, see section 7.)

## 7. History worth knowing

- Chrome on Android reported "This app is already installed" under `mhoman05.github.io` although nothing was installed (a stale record). Changing the app id and path did not help. Moving to the `Matthias-Sport` organisation (new domain) fixed it.
- Early contacts file was briefly in a public repo by mistake. The repo was deleted and recreated without it, and contacts are now only stored encrypted.

## 8. Open items and suggestions

- Check the CCVM group view on/after 1 Nov 2026.
- First scheduled "Update results" run under the organisation: confirm it stays green.
- Matthias keeps a lot of personal files in `~/Downloads`, including a `CLAUDE.md` for an unrelated project that Claude sessions here pick up. Moving this project to its own folder (for example `~/Projects/racket-rankings`) is recommended.
- Ideas offered and **not** wanted yet: ntfy phone notifications, follow-up nudge after the match date, weather on match day, season recap, padel partner stats, season filter, ladder what-if, share-a-result card. Offered and declined or undecided: live scoreboard, own rating, deeper score stats, equipment tracker, court-cost ledger, Spanish version, suggested times in the message.
- Apostol Santiago: add its tennis and padel rankings once Matthias has joined; if results are behind a login, use paste or screenshot import (no automated login).

## 9. Prompt to start a new Claude session

> I'm continuing work on my Racket Rankings web app. Read `HANDOVER.md` in this folder first. Keep it a single-file app with no build step, test at phone width, never put plain contacts in the repo, and ask me before committing and pushing. Today I want to: ...
