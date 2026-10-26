import { z } from "zod";
import { completeJson, type JsonSchema } from "./ai";

// JSON Schemas sent to the LLM (strict mode: every key required, no extra keys).
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const strList = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const parsedResumeSchema: JsonSchema = {
  name: "parsed_resume",
  schema: obj({
    name: strOrNull,
    email: strOrNull,
    phone: strOrNull,
    location: strOrNull,
    summary: strOrNull,
    skills: strList,
    experience: {
      type: "array",
      items: obj({ title: strOrNull, company: strOrNull, start: strOrNull, end: strOrNull, highlights: strList }),
    },
    education: { type: "array", items: obj({ degree: strOrNull, institution: strOrNull, year: strOrNull }) },
    projects: { type: "array", items: obj({ name: strOrNull, description: strOrNull, tech: strList }) },
  }),
};

const evaluationSchema: JsonSchema = {
  name: "evaluation",
  schema: obj({
    score: { type: "integer" },
    summary: str,
    strengths: strList,
    gaps: strList,
    suggestions: strList,
  }),
};

const text = z.string().nullish().transform((v) => v ?? null);
const list = z.array(z.string()).nullish().transform((v) => v ?? []);

export const ParsedResume = z.object({
  name: text,
  email: text,
  phone: text,
  location: text,
  summary: text,
  skills: list,
  experience: z
    .array(
      z.object({
        title: text,
        company: text,
        start: text,
        end: text,
        highlights: list,
      })
    )
    .nullish()
    .transform((v) => v ?? []),
  education: z
    .array(z.object({ degree: text, institution: text, year: text }))
    .nullish()
    .transform((v) => v ?? []),
  projects: z
    .array(z.object({ name: text, description: text, tech: list }))
    .nullish()
    .transform((v) => v ?? []),
});
export type ParsedResume = z.infer<typeof ParsedResume>;

export const Evaluation = z.object({
  score: z.coerce.number().min(0).max(100).transform(Math.round),
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type Evaluation = z.infer<typeof Evaluation>;

// Resume text → structured JSON.
export async function parseResume(resumeText: string): Promise<ParsedResume> {
  const json = await completeJson([
    {
      role: "system",
      content: `You extract structured data from resumes. Reply with one JSON object with exactly these keys:
{"name": string|null, "email": string|null, "phone": string|null, "location": string|null, "summary": string|null,
 "skills": string[],
 "experience": [{"title": string|null, "company": string|null, "start": string|null, "end": string|null, "highlights": string[]}],
 "education": [{"degree": string|null, "institution": string|null, "year": string|null}],
 "projects": [{"name": string|null, "description": string|null, "tech": string[]}]}
Only use information present in the resume. Use null or [] when something is missing.`,
    },
    { role: "user", content: resumeText },
  ], parsedResumeSchema);
  return ParsedResume.parse(json);
}

// JD + structured resume + retrieved excerpts → score and feedback.
export async function evaluateResume(
  jobDescription: string,
  parsed: ParsedResume,
  excerpts: string
): Promise<Evaluation> {
  const json = await completeJson([
    {
      role: "system",
      content: `You are an experienced technical recruiter. Compare a candidate's resume to a job description.
Reply with one JSON object:
{"score": integer 0-100 (how well the resume matches the job's requirements),
 "summary": string (2-3 sentences, plain language, addressed to the candidate as "you"),
 "strengths": string[] (3-6 items: requirements the resume clearly meets, with evidence),
 "gaps": string[] (2-6 items: requirements that are missing or weakly shown),
 "suggestions": string[] (3-6 concrete edits to the resume for this job)}
Be specific and honest. Base every point on the resume content provided; never invent experience.`,
    },
    {
      role: "user",
      content: `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME (structured):\n${JSON.stringify(parsed, null, 2)}\n\nMOST RELEVANT RESUME EXCERPTS:\n${excerpts}`,
    },
  ], evaluationSchema);
  return Evaluation.parse(json);
}
