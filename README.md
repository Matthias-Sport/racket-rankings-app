# Racket Rankings

Personal tennis/padel results tracker. One static page (`index.html`), no build step.

- **Open it:** serve the folder (`python3 -m http.server`) or publish it with GitHub Pages. Manual matches and contacts live in your browser only.
- **Synced results:** `node scripts/scrape.mjs` reads your matches from the CCVM tennis ranking and the Club de Campo ranking and writes `data.json`, which the page loads. Change the name with `--name "First Last"`.
- **Automatic updates on GitHub:** `.github/workflows/update.yml` runs the scraper daily and commits `data.json` if anything changed. Enable Pages (Settings → Pages → deploy from branch, root).
- **Padel (Padel Team Gourmet):** members-only, so enter matches manually or import a CSV (Data page).
- **Contacts:** the club phone list is a PDF. Run `python3 scripts/contacts-from-pdf.py "Telefonos.pdf"` (needs `pip install pymupdf`) to make `../Racket-Rankings-private/contacts.local.csv`, then import it on the Data page. For the CCVM ranking, run `node scripts/scrape.mjs --contacts` once your new group is published; it saves the phone/email of the players in your current group to `../Racket-Rankings-private/contacts-ccvm.local.csv` (import it the same way). Those CSVs are written to a folder next to the project, never inside it, so they cannot be uploaded to GitHub by accident, and the scraper never stores other players phone numbers or emails.

`data.json` contains opponent names and scores, which are public on those sites. If you'd rather not publish them, keep the repo private (GitHub Pages on private repos needs a paid plan) or just run it locally.
