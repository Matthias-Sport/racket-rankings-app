#!/usr/bin/env python3
"""Turn the club's "Listado de Jugadores" phone-list PDF into contacts.local.csv for Court Log.
Usage: python3 scripts/contacts-from-pdf.py "path/to/Telefonos.pdf"   (needs PyMuPDF: pip install pymupdf)
The CSV holds other people's phone numbers, so it is written next to the project folder, never inside it. Import it on the app's Data page."""
import csv, sys, re, os
import fitz

src = sys.argv[1]
priv = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Racket-Rankings-private')   # outside the repo folder on purpose
os.makedirs(priv, exist_ok=True)
out = os.path.join(priv, 'contacts.local.csv')
# column x-ranges, taken from the PDF header: Apellido 1 | Apellido 2 | Nombre | Tel Casa | Tel Trabajo | Tel Móvil
EDGES = [150, 265, 370, 430, 500]
def col(x): return sum(x >= e for e in EDGES)

rows = []
for page in fitz.open(src):
    lines = {}
    for x0, y0, x1, y1, w, *_ in page.get_text('words'):
        if y0 < 58: continue                                   # title + header row
        lines.setdefault(round(y0 / 4), []).append((x0, w))
    for k in sorted(lines):
        cells = [[] for _ in range(6)]
        for x, w in sorted(lines[k]): cells[col(x)].append(w)
        c = [' '.join(x) for x in cells]
        if not c[2] or c[0].lower().startswith('apellido'): continue
        phone = next((re.sub(r'\D', '', p) for p in (c[5], c[3], c[4]) if re.sub(r'\D', '', p)), '')
        rows.append([f'{c[0]} {c[1]}'.strip(), c[2], phone, re.sub(r'\D', '', c[5]), re.sub(r'\D', '', c[3]), re.sub(r'\D', '', c[4])])

with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['Apellidos', 'Nombre', 'Teléfono', 'Móvil', 'Casa', 'Trabajo'])
    w.writerows(rows)
print(f'{len(rows)} players written to {os.path.normpath(out)} ({sum(1 for r in rows if r[2])} with a phone number)')
