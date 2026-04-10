import { NextRequest, NextResponse } from "next/server";

const LCD_ENDPOINT =
  process.env.NEXT_PUBLIC_LCD_ENDPOINT || process.env.LCD_ENDPOINT || "https://api-test.sparkdream.io";

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

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
