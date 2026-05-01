import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// Pinned to a Sonnet 4.6 dated snapshot. Audit JSON records this verbatim,
// so reanalysing at a future date won't silently drift onto a different model.
// Override with ANTHROPIC_MODEL_ID env var if you want a different snapshot.
export const ANTHROPIC_MODEL_ID =
  process.env.ANTHROPIC_MODEL_ID ?? "claude-sonnet-4-6";

export const PROMPT_VERSION = "foci-count-v2";

const SENSITIVITY_INSTRUCTIONS: Record<number, string> = {
  1: "Sensitivity 1 (strict): Count only large (>2 cm), unambiguous, fully-formed dollar spot foci. Ignore anything faint or borderline.",
  2: "Sensitivity 2: Count obvious dollar spot foci; skip very faint or partial ones.",
  3: "Sensitivity 3 (default): Count clearly visible dollar spot foci.",
  4: "Sensitivity 4: Count clearly visible foci plus moderately confident borderline cases.",
  5: "Sensitivity 5 (permissive): Count all possible foci, including faint or early-stage lesions.",
};

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const path = join(process.cwd(), "prompts", `${PROMPT_VERSION}.md`);
  cachedTemplate = readFileSync(path, "utf8");
  return cachedTemplate;
}

export type BuiltPrompt = {
  text: string;
  hash: string;
  version: string;
  sensitivity: number;
};

export function buildPrompt(sensitivity: number): BuiltPrompt {
  const s = Math.max(1, Math.min(5, Math.round(sensitivity)));
  const tpl = loadTemplate();
  const text = tpl.replace(
    "{{SENSITIVITY_INSTRUCTION}}",
    SENSITIVITY_INSTRUCTIONS[s]
  );
  return {
    text,
    hash: "sha256:" + createHash("sha256").update(text).digest("hex"),
    version: PROMPT_VERSION,
    sensitivity: s,
  };
}

export type Focus = {
  id: number;
  x: number;
  y: number;
  radius_px: number;
  confidence?: "low" | "medium" | "high";
};

export type AnalysisResult = {
  foci_count: number;
  foci: Focus[];
  disease_pct: number;
  reasoning: string;
  raw_text: string;
};

export async function analyseRectifiedJpeg(
  jpegBase64: string,
  sensitivity: number
): Promise<{ prompt: BuiltPrompt; result: AnalysisResult; modelId: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(sensitivity);
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL_ID,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: jpegBase64,
            },
          },
          { type: "text", text: prompt.text },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = parseAnalysis(raw);

  return {
    prompt,
    modelId: ANTHROPIC_MODEL_ID,
    result: { ...parsed, raw_text: raw },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseAnalysis(text: string): {
  foci_count: number;
  foci: Focus[];
  disease_pct: number;
  reasoning: string;
} {
  // The model is instructed to return only JSON, but it sometimes wraps in
  // ```json ... ``` fences or adds a sentence. Strip and find the first {...}.
  let s = text.trim();
  s = s.replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON object in model response: ${text.slice(0, 200)}`);
  }
  const obj = JSON.parse(match[0]) as {
    foci_count?: number;
    foci?: Array<{
      id?: number;
      x?: number;
      y?: number;
      radius_px?: number;
      confidence?: string;
    }>;
    disease_pct?: number;
    reasoning?: string;
  };

  const foci: Focus[] = [];
  if (Array.isArray(obj.foci)) {
    for (let i = 0; i < obj.foci.length; i++) {
      const f = obj.foci[i];
      const x = Number(f.x);
      const y = Number(f.y);
      const r = Number(f.radius_px);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) {
        continue;
      }
      const focus: Focus = {
        id: Number.isFinite(Number(f.id)) ? Number(f.id) : i + 1,
        x: clamp(Math.round(x), 0, 1000),
        y: clamp(Math.round(y), 0, 1000),
        radius_px: clamp(Math.round(r), 2, 250),
      };
      if (
        f.confidence === "low" ||
        f.confidence === "medium" ||
        f.confidence === "high"
      ) {
        focus.confidence = f.confidence;
      }
      foci.push(focus);
    }
  }

  // Prefer the model's explicit count, but if it's clearly missing fall back
  // to the array length so the UI shows something coherent.
  const reportedCount = Math.max(0, Math.round(Number(obj.foci_count ?? NaN)));
  const foci_count = Number.isFinite(reportedCount) ? reportedCount : foci.length;

  return {
    foci_count,
    foci,
    disease_pct: clamp(Number(obj.disease_pct ?? 0), 0, 100),
    reasoning: String(obj.reasoning ?? ""),
  };
}
