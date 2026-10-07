import { existsSync } from 'node:fs';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import puppeteer from 'puppeteer-core';
import { env } from '../config/env.js';
import { escapeHtml, REPORT_FONTS, REPORT_MARGIN } from './report-page.js';

// Where a Chromium-based browser is usually installed. A report is laid out as a web
// page and printed to PDF by a browser, so text in any Indian script comes out right.
const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * Prints a web page to a PDF. The one place that knows how: every report
 * (service report, inspection report) lays itself out as HTML and hands it here.
 */
@Injectable()
export class PdfPrinterService {
  /**
   * Lays the page out in a browser without a window and prints it on A4.
   * `footer` is a short line repeated at the bottom of every page, with
   * "Page 2 of 5" beside it, so a loose page can be put back in its report.
   */
  async print(html: string, options: { footer?: string } = {}): Promise<Buffer> {
    const executablePath = env.PDF_BROWSER_PATH ?? BROWSER_PATHS.find((path) => existsSync(path));
    if (!executablePath) {
      throw new ServiceUnavailableException('PDF reports are not set up on this server yet');
    }
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: REPORT_MARGIN,
          ...(options.footer !== undefined && {
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            // The browser draws this in the bottom margin of each page. It does not see the
            // page's own styles, so the size, colour and side padding are written out here.
            footerTemplate: `<div style="box-sizing:border-box;width:100%;padding:0 ${REPORT_MARGIN.left};display:flex;justify-content:space-between;font-family:${REPORT_FONTS.replace(/"/g, "'")};font-size:8pt;color:#5b6770;">
              <span>${escapeHtml(options.footer)}</span>
              <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            </div>`,
          }),
        }),
      );
    } finally {
      await browser.close();
    }
  }
}
