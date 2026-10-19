import type { NextRequest } from "next/server";

import { API_URL, TOKEN_PATTERN, visitorHeaders } from "@/lib/public-page";

// One photo of a customer page: /k/<token>/p/<place>. Passed straight through from
// the API, so the diner's phone only ever talks to this one web address, and the
// only photos reachable are the ones the page itself lists.

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, context: RouteContext<"/k/[token]/p/[place]">) {
  const { token, place } = await context.params;
  if (!TOKEN_PATTERN.test(token) || !/^\d{1,2}$/.test(place)) return notFound();

  let response: Response;
  try {
    response = await fetch(`${API_URL}/public/pages/${encodeURIComponent(token)}/photos/${place}`, { cache: "no-store", headers: visitorHeaders(request) });
  } catch {
    return new Response(null, { status: 503, headers: { "Retry-After": "60" } });
  }
  if (!response.ok || !response.body) return notFound();

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
      // Short, because a photo's place changes when one is approved or removed.
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
