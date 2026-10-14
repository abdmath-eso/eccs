import { findLegalDocument, legalPageHeaders, renderLegalNotFound, renderLegalPage } from "@/lib/legal-page";

// A legal document's public page: /legal/<key>. A route handler, not a React page,
// so what is sent is one small HTML document with no JavaScript and none of the
// console attached, the same way as the customer QR page (/k/<token>).

// The words change only with a new release of the site, so a browser may keep a page for an hour.
const CACHE_SECONDS = 3600;

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const document = findLegalDocument(key);
  if (!document) return new Response(renderLegalNotFound(), { status: 404, headers: legalPageHeaders(0) });
  return new Response(renderLegalPage(document), { status: 200, headers: legalPageHeaders(CACHE_SECONDS) });
}
