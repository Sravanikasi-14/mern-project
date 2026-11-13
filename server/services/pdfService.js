import { HttpError } from "../utils/httpError.js";
import {
  assertPdfHtmlBounds,
  getPdfBrowserDiagnostics,
  renderHtmlWithPuppeteer,
  resetPdfBrowserRuntimeForTests,
  setPdfBrowserLauncherForTests,
  ensurePdfBrowser,
  resolveBrowserLaunch,
} from "./pdfBrowserRuntime.js";

export {
  getPdfBrowserDiagnostics,
  resetPdfBrowserRuntimeForTests,
  setPdfBrowserLauncherForTests,
  ensurePdfBrowser,
  resolveBrowserLaunch,
};

function escapePdfText(str) {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function stripHtmlToTextLines(html) {
  const clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n\n$1\n" + "=".repeat(40) + "\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n\n$1\n" + "-".repeat(40) + "\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n\n$1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n\n$1\n")
    .replace(/<tr[^>]*>/gi, "\n")
    .replace(/<td[^>]*>(.*?)<\/td>/gi, "$1  |  ")
    .replace(/<th[^>]*>(.*?)<\/th>/gi, "$1  |  ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines = [];
  for (const rawLine of clean.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }
    if (trimmed.length <= 80) {
      lines.push(trimmed);
    } else {
      let current = "";
      for (const word of trimmed.split(/\s+/)) {
        if ((current + " " + word).trim().length > 80) {
          if (current) lines.push(current.trim());
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
      }
      if (current) lines.push(current.trim());
    }
  }
  return lines;
}

export function generatePureJsPdf(htmlContent) {
  const lines = stripHtmlToTextLines(htmlContent);
  const LINES_PER_PAGE = 45;
  const pages = [];

  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) {
    pages.push(["Offer Letter"]);
  }

  const pageCount = pages.length;
  const pageObjIds = [];
  let currentObjId = 5;
  const pageDefs = [];

  for (let p = 0; p < pageCount; p++) {
    const streamObjId = currentObjId++;
    const pageObjId = currentObjId++;
    pageObjIds.push(pageObjId);
    pageDefs.push({ p, streamObjId, pageObjId, lines: pages[p] });
  }

  const pagesObjStr = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let finalOut = "%PDF-1.4\n";
  const finalOffsets = [];

  function writeFinalObj(id, content) {
    finalOffsets.push(Buffer.byteLength(finalOut));
    finalOut += `${id} 0 obj\n${content}\nendobj\n`;
  }

  writeFinalObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeFinalObj(2, pagesObjStr);
  writeFinalObj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  writeFinalObj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  for (const def of pageDefs) {
    let stream = "BT\n";
    stream += `/F2 10 Tf\n50 800 Td\n(OFFICIAL OFFER LETTER) Tj\n`;
    stream += `/F1 9 Tf\n420 0 Td\n(Page ${def.p + 1} of ${pageCount}) Tj\n`;
    stream += `/F1 10 Tf\n-420 -30 Td\n14 TL\n`;

    for (const l of def.lines) {
      stream += `(${escapePdfText(l)}) '\n`;
    }
    stream += "ET\n";

    const streamBytes = Buffer.from(stream, "utf8");
    writeFinalObj(def.streamObjId, `<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`);
    writeFinalObj(
      def.pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${def.streamObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );
  }

  const xrefOffset = Buffer.byteLength(finalOut);
  finalOut += `xref\n0 ${finalOffsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of finalOffsets) {
    finalOut += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  finalOut += `trailer\n<< /Size ${finalOffsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(finalOut, "utf8");
}

/**
 * Generate a PDF Buffer from rendered HTML using a warm-process shared Chromium
 * (F40). Pure-JS is a last-resort safety net only (layout not preserved).
 */
export async function generateOfferLetterPdf(htmlContent) {
  assertPdfHtmlBounds(htmlContent);

  try {
    return await renderHtmlWithPuppeteer(htmlContent);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 400 || error.status === 413)) {
      throw error;
    }
    if (error instanceof HttpError && error.code === "PDF_GENERATION_BUSY") {
      throw error;
    }
    console.warn(
      "[pdfService] Puppeteer PDF Generation Error (falling back to lightweight renderer):",
      error?.message || error
    );
    try {
      const fallbackPdf = generatePureJsPdf(htmlContent);
      if (fallbackPdf && Buffer.isBuffer(fallbackPdf) && fallbackPdf.length > 0) {
        return fallbackPdf;
      }
    } catch (fbErr) {
      console.error("[pdfService] Fallback PDF generation failed:", fbErr.message);
    }
    throw new HttpError(
      500,
      `Failed to generate PDF document: ${error?.message || error}`
    );
  }
}
