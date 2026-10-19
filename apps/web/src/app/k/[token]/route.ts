import type { PublicPageDto } from "@eccs/shared";
import { PUBLIC_PAGE_RULES } from "@eccs/shared";
import type { NextRequest } from "next/server";

import { API_URL, chooseLanguage, pageHeaders, renderNothing, renderPage, TOKEN_PATTERN, visitorHeaders } from "@/lib/public-page";

// The customer QR page: /k/<token>. A route handler, not a React page, so that
// what reaches the diner's phone is one small HTML document with no JavaScript
// and none of the console (its layout, its login, its styles) attached.

export async function GET(request: NextRequest, context: RouteContext<"/k/[token]">) {
  const { token } = await context.params;
  const language = chooseLanguage(request.nextUrl.searchParams.get("lang"), request.headers.get("accept-language"));
  // The language can come from the phone's own setting, so a shared cache must keep the versions apart.
  const vary = { Vary: "Accept-Language" };

  let page: PublicPageDto | null = null;
  if (TOKEN_PATTERN.test(token)) {
    try {
      // The API keeps each answer for a minute itself; this server does not keep a second copy.
      const response = await fetch(`${API_URL}/public/pages/${encodeURIComponent(token)}`, { cache: "no-store", headers: visitorHeaders(request) });
      if (response.ok) page = (await response.json()) as PublicPageDto;
      else if (response.status !== 404) throw new Error(`The API answered ${response.status}`);
    } catch {
      // Our own server is not answering: say so, and ask the phone to try again shortly.
      return new Response(renderNothing(token, language, true), {
        status: 503,
        headers: { ...pageHeaders({ cacheSeconds: 0 }), ...vary, "Retry-After": "60" },
      });
    }
  }

  // One answer for every link with nothing to show, whatever the reason.
  if (!page) return new Response(renderNothing(token, language), { status: 404, headers: { ...pageHeaders({ cacheSeconds: 0 }), ...vary } });

  return new Response(renderPage(page, token, language), {
    status: 200,
    headers: { ...pageHeaders({ cacheSeconds: PUBLIC_PAGE_RULES.cacheSeconds }), ...vary },
  });
}
