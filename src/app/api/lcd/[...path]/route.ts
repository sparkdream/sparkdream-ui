import { NextRequest, NextResponse } from "next/server";

// Runtime LCD_ENDPOINT wins over the build-time NEXT_PUBLIC_* fallback so the
// proxy target tracks the same source as /api/config without a rebuild.
const LCD_ENDPOINT =
  process.env.LCD_ENDPOINT || process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io";

// Matches the client-side ceiling in lib/api.ts: a sentry that accepts the
// connection but never answers must not hold a proxy request open forever.
const UPSTREAM_TIMEOUT_MS = 15_000;

// The proxy answers JSON or nothing. When the node is down, the thing in front
// of it (Cloudflare, a load balancer, Next's own error page) replies with an
// HTML document; forwarding that under a JSON content type is what used to put
// a wall of markup on screen. Anything unparseable is replaced here.
function errorBody(status: number, message: string) {
  return NextResponse.json({ code: status, message }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const upstream = `${LCD_ENDPOINT.replace(/\/+$/, "")}/${path.join("/")}`;
  const qs = request.nextUrl.searchParams.toString();
  const url = qs ? `${upstream}?${qs}` : upstream;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return errorBody(
      503,
      timedOut ? "Chain node did not respond in time" : "Chain node unreachable"
    );
  }

  // The name module returns 404 when an address has no registered name.
  // That's an expected outcome, not a failure — translate to 200 with an
  // empty name so it doesn't surface as a network error in the browser.
  if (res.status === 404 && path[0] === "sparkdream" && path[1] === "name" && path[3] === "reverse_resolve") {
    return NextResponse.json({ name: "" });
  }

  const body = await res.text();
  try {
    JSON.parse(body);
  } catch {
    return errorBody(
      res.status === 200 ? 502 : res.status,
      `Chain node unreachable (${res.status})`
    );
  }
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
