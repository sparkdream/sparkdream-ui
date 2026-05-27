import { NextRequest, NextResponse } from "next/server";

// Runtime LCD_ENDPOINT wins over the build-time NEXT_PUBLIC_* fallback so the
// proxy target tracks the same source as /api/config without a rebuild.
const LCD_ENDPOINT =
  process.env.LCD_ENDPOINT || process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const upstream = `${LCD_ENDPOINT.replace(/\/+$/, "")}/${path.join("/")}`;
  const qs = request.nextUrl.searchParams.toString();
  const url = qs ? `${upstream}?${qs}` : upstream;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  // The name module returns 404 when an address has no registered name.
  // That's an expected outcome, not a failure — translate to 200 with an
  // empty name so it doesn't surface as a network error in the browser.
  if (res.status === 404 && path[0] === "sparkdream" && path[1] === "name" && path[3] === "reverse_resolve") {
    return NextResponse.json({ name: "" });
  }

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
