import Anthropic from "@anthropic-ai/sdk";

interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  /** Optional model override; defaults to the latest Opus. */
  ANTHROPIC_MODEL?: string;
}

interface OptimizeRequest {
  resume?: unknown;
  jobDescription?: unknown;
  targetRole?: unknown;
  language?: unknown;
}

const DEFAULT_MODEL = "claude-opus-4-8";

// JSON Schema for the structured analysis. Kept within the structured-output
// constraints: every object sets additionalProperties:false and lists required.
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    overall_score: {
      type: "integer",
      description: "Overall resume quality from 0 to 100.",
    },
    summary: {
      type: "string",
      description: "A two to three sentence overall assessment.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "Concrete things the resume already does well.",
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
      description: "The most impactful problems holding the resume back.",
    },
    suggestions: {
      type: "array",
      description: "Specific, actionable rewrites ordered by impact.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          section: {
            type: "string",
            description: "Which part of the resume this applies to.",
          },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          issue: { type: "string", description: "What is wrong today." },
          recommendation: {
            type: "string",
            description: "Exactly what to change, with example wording.",
          },
        },
        required: ["section", "priority", "issue", "recommendation"],
      },
    },
    keywords: {
      type: "object",
      additionalProperties: false,
      description: "ATS keyword coverage relative to the target role / JD.",
      properties: {
        present: { type: "array", items: { type: "string" } },
        missing: { type: "array", items: { type: "string" } },
      },
      required: ["present", "missing"],
    },
    optimized_resume: {
      type: "string",
      description:
        "A fully rewritten, ready-to-use resume in clean Markdown that applies the suggestions.",
    },
  },
  required: [
    "overall_score",
    "summary",
    "strengths",
    "weaknesses",
    "suggestions",
    "keywords",
    "optimized_resume",
  ],
} as const;

function systemPrompt(language: string): string {
  const langLine =
    language === "en"
      ? "Write every field of your response in English."
      : "Write every field of your response in Simplified Chinese (简体中文).";
  return [
    "You are a senior technical recruiter and professional resume coach.",
    "You optimize resumes so they pass ATS screening and impress hiring managers.",
    "Be specific and honest: quantify impact, cut filler, surface achievements,",
    "and rewrite weak bullet points into strong, results-oriented ones using the",
    "'accomplished X by doing Y, measured by Z' pattern. Do not invent facts or",
    "fabricate metrics the candidate did not provide — when a metric is missing,",
    "show a placeholder like [X%] for the candidate to fill in.",
    langLine,
  ].join(" ");
}

function userPrompt(req: {
  resume: string;
  jobDescription: string;
  targetRole: string;
}): string {
  const parts = [`# Candidate resume\n\n${req.resume}`];
  if (req.targetRole.trim()) {
    parts.push(`# Target role\n\n${req.targetRole}`);
  }
  if (req.jobDescription.trim()) {
    parts.push(`# Target job description\n\n${req.jobDescription}`);
  } else {
    parts.push(
      "# Target job description\n\nNone provided — optimize for the candidate's apparent target role and general best practices.",
    );
  }
  parts.push(
    "Analyze the resume against the target and return the structured analysis.",
  );
  return parts.join("\n\n");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleOptimize(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "Server is missing ANTHROPIC_API_KEY. Run: wrangler secret put ANTHROPIC_API_KEY" },
      500,
    );
  }

  let payload: OptimizeRequest;
  try {
    payload = (await request.json()) as OptimizeRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const resume = typeof payload.resume === "string" ? payload.resume.trim() : "";
  if (resume.length < 30) {
    return jsonResponse(
      { error: "Please paste a resume with at least 30 characters." },
      400,
    );
  }

  const jobDescription =
    typeof payload.jobDescription === "string" ? payload.jobDescription : "";
  const targetRole =
    typeof payload.targetRole === "string" ? payload.targetRole : "";
  const language = payload.language === "en" ? "en" : "zh";

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      system: systemPrompt(language),
      messages: [
        {
          role: "user",
          content: userPrompt({ resume, jobDescription, targetRole }),
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text) {
      return jsonResponse(
        { error: "The model returned no analysis. Please try again." },
        502,
      );
    }

    const analysis = JSON.parse(text);
    return jsonResponse({ analysis });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const status = error.status === 429 ? 429 : 502;
      return jsonResponse(
        { error: `Claude API error (${error.status ?? "unknown"}): ${error.message}` },
        status,
      );
    }
    const reason = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: `Failed to analyze resume: ${reason}` }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/optimize") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405);
      }
      return handleOptimize(request, env);
    }

    // Everything else is served from the static assets bundle (./public).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
