/**
 * Visual validation for the HRMS default offer master (Letter, signatures).
 *
 *   node scripts/offerPhase1VisualCheck.js [outDir]
 *
 * - Builds the offer HTML with sample data and two fake signature PNGs (HR + candidate)
 * - Renders a PDF with Puppeteer (via generateOfferLetterPdf) and the unsigned variant
 * - Rasterises pages with PyMuPDF (python -m pymupdf / fitz) into outDir/page-NN.png
 * - Compares the page count with the 10-page reference (backups/ref-offer-pages)
 *
 * Output (default): ../backups/phase1-gen-pages/
 * No database access; nothing is deployed or deleted (outDir files are overwritten).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildMasterOfferHtml,
  getDefaultLegalSections,
  getMasterSectionConfig,
  injectCandidateSignature,
} from "../assets/offer-templates/hrms-default-master.js";
import { generateOfferLetterPdf } from "../services/pdfService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "backups", "phase1-gen-pages"));
const REFERENCE_PAGES = 10;

// ---- tiny PNG encoder (no dependencies) -----------------------------------
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Transparent RGBA PNG with a hand-drawn looking squiggle in the given colour. */
function fakeSignaturePng({ width = 220, height = 70, color = [30, 58, 138], phase = 0 }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const plot = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const o = py * (width * 4 + 1) + 1 + px * 4;
        raw[o] = color[0];
        raw[o + 1] = color[1];
        raw[o + 2] = color[2];
        raw[o + 3] = 255;
      }
    }
  };
  for (let x = 6; x < width - 6; x += 0.25) {
    const t = (x / width) * Math.PI * 6 + phase;
    const y = height / 2 + Math.sin(t) * (height / 3) * Math.sin((x / width) * Math.PI);
    plot(x, y);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const toDataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;

// ---- sample context -------------------------------------------------------
const config = getMasterSectionConfig();
const baseContext = {
  companyName: "Sample Media Co",
  companyWebsite: "https://samplemedia.example",
  companyEmail: "hello@samplemedia.example",
  companyPhone: "+91 90000 00000",
  companyAddress: "Hyderabad, Telangana",
  candidateName: "Ms. Sample Candidate",
  candidateEmail: "candidate@example.test",
  designation: "SDE Intern",
  department: "Engineering",
  employmentType: "Intern",
  workLocation: "Hyderabad, Telangana",
  reportingManager: "Team Lead",
  joiningDate: new Date("2026-10-11"),
  offerDate: new Date("2026-10-09"),
  place: "Hyderabad, Telangana",
  monthlySalary: 15000,
  annualSalary: 180000,
  signatoryName: "Sample Founder",
  signatoryTitle: "Co-Founder",
  probationMonths: 2,
  probationNoticeDays: 15,
  noticeDays: 30,
  nonSolicitationMonths: 6,
  defaults: config.defaults,
  cover: config.cover,
  execution: config.execution,
  sections: getDefaultLegalSections(),
};

const hrPng = toDataUrl(fakeSignaturePng({ color: [20, 20, 60], phase: 0 }));
const candidatePng = toDataUrl(fakeSignaturePng({ width: 180, height: 50, color: [30, 70, 160], phase: 1.7 }));

function isPureJsFallback(buf) {
  return buf.includes(Buffer.from("OFFICIAL OFFER LETTER"));
}

function rasterize(pdfPath, prefix) {
  const code = [
    "import sys, warnings",
    "warnings.filterwarnings('ignore')",
    "try:\n    import pymupdf as fitz\nexcept Exception:\n    import fitz",
    "doc = fitz.open(sys.argv[1])",
    "for i, page in enumerate(doc, 1):",
    "    page.get_pixmap(dpi=100).save(sys.argv[2] + 'page-%02d.png' % i)",
    "print(len(doc))",
  ].join("\n");
  const run = (cmd) => spawnSync(cmd, ["-c", code, pdfPath, prefix], { encoding: "utf8" });
  let res = run("python");
  if (res.status !== 0) res = run("py");
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.error?.message || "").trim() };
  const pages = Number(String(res.stdout).trim().split(/\s+/).pop());
  return { ok: true, pages };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const unsignedHtml = buildMasterOfferHtml({ ...baseContext, hrSignatureDataUrl: hrPng });
  const { html: signedHtml } = injectCandidateSignature(unsignedHtml, {
    dataUrl: candidatePng,
    signedAt: new Date("2026-10-11"),
  });
  fs.writeFileSync(path.join(OUT_DIR, "offer-unsigned.html"), unsignedHtml);
  fs.writeFileSync(path.join(OUT_DIR, "offer-signed.html"), signedHtml);

  const results = {};
  for (const [name, html] of [["unsigned", unsignedHtml], ["signed", signedHtml]]) {
    const pdf = await generateOfferLetterPdf(html);
    if (isPureJsFallback(pdf)) {
      console.warn(`[${name}] Puppeteer unavailable - pure-JS fallback PDF produced (layout not preserved).`);
      results[name] = { puppeteer: false };
      continue;
    }
    const pdfPath = path.join(OUT_DIR, `offer-${name}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    // Only the signed variant is rasterised into page-NN.png (the unsigned one is compared by count).
    const prefix = name === "signed" ? `${OUT_DIR}${path.sep}` : path.join(OUT_DIR, `${name}-`);
    const r = rasterize(pdfPath, prefix);
    results[name] = { puppeteer: true, pdf: pdfPath, bytes: pdf.length, ...r };
  }

  console.log(JSON.stringify({ outDir: OUT_DIR, referencePages: REFERENCE_PAGES, results }, null, 2));
  const signed = results.signed;
  if (signed?.ok) {
    const verdict =
      signed.pages === REFERENCE_PAGES
        ? "MATCH"
        : `DIFF (${signed.pages > REFERENCE_PAGES ? "+" : ""}${signed.pages - REFERENCE_PAGES} pages)`;
    console.log(`Page count: ${signed.pages} vs reference ${REFERENCE_PAGES} -> ${verdict}`);
    process.exitCode = signed.pages === REFERENCE_PAGES ? 0 : 2;
  } else {
    console.warn("Could not rasterise / count pages (see results above).");
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
