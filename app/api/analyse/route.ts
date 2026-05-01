import { NextResponse } from "next/server";
import { analyseRectifiedJpeg } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  imageBase64?: string;
  sensitivity?: number;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  if (!body.imageBase64) {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }
  const sensitivity = Number(body.sensitivity ?? 3);

  const stripped = body.imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  try {
    const { prompt, result, modelId } = await analyseRectifiedJpeg(
      stripped,
      sensitivity
    );
    return NextResponse.json({
      result,
      prompt: {
        version: prompt.version,
        hash: prompt.hash,
        sensitivity: prompt.sensitivity,
      },
      modelId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
