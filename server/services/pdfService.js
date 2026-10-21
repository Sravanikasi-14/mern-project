import puppeteer from "puppeteer";
import { HttpError } from "../utils/httpError.js";

/**
 * Generate a PDF Buffer from rendered HTML string using Puppeteer
 */
export async function generateOfferLetterPdf(htmlContent) {
  if (!htmlContent || typeof htmlContent !== "string") {
    throw new HttpError(400, "HTML content is required to generate PDF.");
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-extensions",
      ],
    });

    const page = await browser.newPage();

    // Set HTML content
    await page.setContent(htmlContent, {
      waitUntil: ["load", "networkidle0"],
      timeout: 30000,
    });

    // Generate A4 PDF buffer with consistent margins and footer page numbers
    const rawPdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "16mm",
        bottom: "18mm",
        left: "16mm",
        right: "16mm",
      },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 8.5px; color: #94a3b8; width: 100%; display: flex; justify-content: flex-end; padding-right: 16mm;">
          Page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;<span class="totalPages"></span>
        </div>
      `,
    });

    const pdfBuffer = Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new HttpError(500, "Failed to generate PDF document: generated buffer is empty.");
    }

    return pdfBuffer;
  } catch (error) {
    console.error("[pdfService] Puppeteer PDF Generation Error:", error.message);
    throw new HttpError(500, `Failed to generate PDF document: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.warn("[pdfService] Warning closing browser:", closeErr.message);
      }
    }
  }
}
