# Resume Optimizer · 简历优化应用

A small, self-contained **Cloudflare Worker** app that optimizes resumes with the
Claude API. Paste a resume (optionally with a target role and job description) and
get back:

- an **overall score** (0–100),
- concrete **strengths and weaknesses**,
- **prioritized, rewrite-ready suggestions**,
- **ATS keyword** coverage (present vs. missing, against the JD), and
- a **fully rewritten resume** in Markdown you can copy and use.

The Worker serves a single-page UI from `public/` and proxies analysis requests to
Claude through `POST /api/optimize`, so the API key never reaches the browser.

> This lives under `examples/` and is intentionally **not** part of the mosoo
> bun workspaces — it has its own dependencies and CI does not build it. It is a
> standalone reference app you can copy out and deploy on its own.

## Architecture

```
Browser (public/index.html)
   │  POST /api/optimize  { resume, targetRole?, jobDescription?, language }
   ▼
Cloudflare Worker (src/index.ts)
   │  Anthropic SDK · messages.create with output_config.format (JSON schema)
   ▼
Claude (claude-opus-4-8, adaptive thinking) → structured analysis JSON
```

- **Model:** `claude-opus-4-8` with adaptive thinking. Override per-environment
  with the `ANTHROPIC_MODEL` var.
- **Structured output:** the response is constrained to a JSON schema
  (`ANALYSIS_SCHEMA` in `src/index.ts`), so the frontend always receives
  well-formed fields — no brittle text parsing.
- **Bilingual:** the UI defaults to Simplified Chinese; toggle to English and the
  model writes every field in the chosen language.

## Run locally

```bash
cd examples/resume-optimizer
npm install

# Provide your Claude API key for local dev (.dev.vars is git-ignored):
echo 'ANTHROPIC_API_KEY = "sk-ant-..."' > .dev.vars

npm run dev          # wrangler dev → http://localhost:8787
```

## Deploy

```bash
npm run deploy                       # publishes the Worker + static assets
wrangler secret put ANTHROPIC_API_KEY  # set the production key (one time)
```

To pin or change the model in production:

```bash
wrangler deploy --var ANTHROPIC_MODEL:claude-opus-4-8
```

## API

`POST /api/optimize`

```jsonc
// request
{
  "resume": "…full resume text…",   // required, ≥ 30 chars
  "targetRole": "Senior Frontend Engineer", // optional
  "jobDescription": "…JD text…",            // optional
  "language": "zh"                          // "zh" (default) | "en"
}
```

```jsonc
// response 200
{
  "analysis": {
    "overall_score": 72,
    "summary": "…",
    "strengths": ["…"],
    "weaknesses": ["…"],
    "suggestions": [
      { "section": "Experience", "priority": "high", "issue": "…", "recommendation": "…" }
    ],
    "keywords": { "present": ["React"], "missing": ["TypeScript"] },
    "optimized_resume": "# Name\n…markdown…"
  }
}
```

Errors return `{ "error": "…" }` with a 4xx/5xx status.

## Notes

- The model is instructed **not to fabricate** metrics. Where a number is missing
  it inserts a `[X%]` placeholder for the candidate to fill in.
- `max_tokens` is 12000 (non-streaming) to comfortably fit the rewritten resume.
- Requires `nodejs_compat` (already set in `wrangler.jsonc`) for the Anthropic SDK.
