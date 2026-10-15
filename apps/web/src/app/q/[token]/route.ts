import { isLinkPreviewAgent, type PublicQuoteDto } from "@eccs/shared";
import type { NextRequest } from "next/server";

import { API_URL, TOKEN_PATTERN } from "@/lib/public-page";
import { quotePageHeaders, renderQuoteNotFound, renderQuotePage } from "@/lib/quote-page";

// A quote's public page: /q/<token> (15 Oct 2026). A route handler, not a React page, so
// what reaches the owner's phone is one small HTML document with no JavaScript and none
// of the console attached, the same way as the customer QR page (/k/<token>).
//
// Each visit by a person is recorded on the lead as "quote opened" (the API keeps one per
// 30 minutes). Not counted: link-preview robots (WhatsApp fetches every link the moment
// it is pasted), and ECCS's own look at the page from the lead (?preview=1).

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return new Response(renderQuoteNotFound(), { status: 404, headers: quotePageHeaders() });

  let quote: PublicQuoteDto | null = null;
  try {
    const response = await fetch(`${API_URL}/public/quotes/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (response.ok) quote = (await response.json()) as PublicQuoteDto;
    else if (response.status !== 404) throw new Error(`The API answered ${response.status}`);
  } catch {
    return new Response(renderQuoteNotFound(true), { status: 503, headers: { ...quotePageHeaders(), "Retry-After": "60" } });
  }
  if (!quote) return new Response(renderQuoteNotFound(), { status: 404, headers: quotePageHeaders() });

  const preview = request.nextUrl.searchParams.get("preview") === "1";
  const agent = request.headers.get("user-agent");
  if (!preview && !isLinkPreviewAgent(agent)) {
    try {
      // The visitor's browser name goes along, so the API can tell a robot too. A failure here never stops the page.
      await fetch(`${API_URL}/public/quotes/${encodeURIComponent(token)}/opened`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agent?.slice(0, 400) ?? null }),
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // The page still shows; this open is simply not recorded.
    }
  }

  return new Response(renderQuotePage(quote, preview), { status: 200, headers: quotePageHeaders() });
}
