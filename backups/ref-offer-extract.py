import pymupdf
from pathlib import Path
src = Path(r"C:\Users\SRAVANI\Downloads\Sravani Kasi Offer Letter.pdf")
out = Path(r"c:\Users\SRAVANI\mern-project\backups\ref-offer-pages")
doc = pymupdf.open(src)
print("pages", doc.page_count)
meta = []
for i, page in enumerate(doc):
    # render at ~150 dpi for readable screenshots
    pix = page.get_pixmap(matrix=pymupdf.Matrix(150/72, 150/72), alpha=False)
    path = out / f"page-{i+1:02d}.png"
    pix.save(str(path))
    text = page.get_text("text")[:800].replace("\n", " | ")
    meta.append({"page": i+1, "w": page.rect.width, "h": page.rect.height, "png": path.name, "textPreview": text})
    print(f"PAGE {i+1} size={page.rect.width:.0f}x{page.rect.height:.0f} png={path.name}")
import json
(out / "index.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print("DONE")
