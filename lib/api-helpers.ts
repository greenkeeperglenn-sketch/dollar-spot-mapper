// Tiny helper used by every API route so that thrown errors come back as
// JSON (with the message) instead of as Next's default HTML 500 page. The
// front-end can show a useful message; the server still logs the stack.

import { NextResponse } from "next/server";

export async function jsonRoute<T>(
  fn: () => Promise<T>,
  opts: { context: string }
): Promise<NextResponse> {
  try {
    const result = await fn();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] ${opts.context} failed:`, err);
    return NextResponse.json(
      { error: message, where: opts.context },
      { status: 500 }
    );
  }
}
