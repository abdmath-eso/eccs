import { PUBLIC_PAGE_PATH } from "@eccs/shared";
import type { NextRequest } from "next/server";

import { chooseLanguage, pageHeaders, renderNothing, renderPoster, TOKEN_PATTERN } from "@/lib/public-page";
import { qrSvg } from "@/lib/qr-svg";
import { createTranslator } from "@eccs/i18n";

// The printable poster for a customer page: /k/<token>/poster. It is only the QR
// code of the page's own address, a line saying what scanning it shows, and the
// disclaimer in short (ECCS is a private company working for the restaurant, not
// a government body; this is not a government rating). So it asks the API nothing
// and shows nothing about the restaurant. The Owner opens it from the app and
// prints it with the browser's own Print.

/**
 * The address the QR code must hold: PUBLIC_PAGE_BASE_URL when it is set for this web
 * server, otherwise the address the poster itself was opened at (the app opens it at
 * the public address, so the two agree).
 */
function baseUrl(request: NextRequest): string {
  if (process.env.PUBLIC_PAGE_BASE_URL) return process.env.PUBLIC_PAGE_BASE_URL.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function GET(request: NextRequest, context: RouteContext<"/k/[token]/poster">) {
  const { token } = await context.params;
  const language = chooseLanguage(request.nextUrl.searchParams.get("lang"), request.headers.get("accept-language"));
  if (!TOKEN_PATTERN.test(token)) {
    return new Response(renderNothing(token, language), { status: 404, headers: pageHeaders({ cacheSeconds: 0 }) });
  }
  const address = `${baseUrl(request)}${PUBLIC_PAGE_PATH}/${token}`;
  const qr = qrSvg(address, createTranslator(language)("public.poster.scan"));
  return new Response(renderPoster(token, language, qr), { status: 200, headers: pageHeaders({ cacheSeconds: 0, script: true }) });
}
