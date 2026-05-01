import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// Pinned to a Sonnet 4.6 dated snapshot. Audit JSON records this verbatim,
// so reanalysing at a future date won't silently drift onto a different model.
// Override with ANTHROPIC_MODEL_ID env var if you want a different snapshot.
export const ANTHROPIC_MODEL_ID =
  process.env.ANTHROPIC_MODEL_ID ?? "claude-sonnet-4-6";

export const PROMPT_VERSION = "folky-count-v1";

const SENSITIVITY_INSTRUCTIONS: Record<number, string> = {
  1: "Sensitivity 1 (strict): Count only large (>2 cm), unambiguous, fully-formed dollar spot lesions. Ignore anything faint or borderline.",
  2: "Sensitivity 2: Count obvious dollar spot lesions; skip very faint or partial ones.",
  3: "Sensitivity 3 (default): Count clearly visible dollar spot infection points.",
  4: "Sensitivity 4: Count clearly visible lesions plus moderately confident borderline cases.",
  5: "Sensitivity 5 (permissive): Count all possible infection points, including faint or early-stage lesions.",
};

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const path = join(process.cwd(), "prompts", "folky-count-v1.md");
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

export type AnalysisResult = {
  folky_count: number;
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
    max_tokens: 1024,
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

function parseAnalysis(text: string): {
  folky_count: number;
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
    folky_count?: number;
    disease_pct?: number;
    reasoning?: string;
  };
  return {
    folky_count: Math.max(0, Math.round(Number(obj.folky_count ?? 0))),
    disease_pct: Math.max(0, Math.min(100, Number(obj.disease_pct ?? 0))),
    reasoning: String(obj.reasoning ?? ""),
  };
}
