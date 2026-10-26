import { eq } from "drizzle-orm";
import { db } from "@/db";
import { evaluations, resumeChunks } from "@/db/schema";
import { embed } from "@/lib/ai";
import { chunkText } from "@/lib/chunk";
import { pdfToText } from "@/lib/pdf";
import { findRelevantChunks, formatChunks } from "@/lib/rag";
import { evaluateResume, parseResume } from "@/lib/resume";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_JD_CHARS = 20_000;

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

// POST /api/evaluate  (multipart form: jobDescription, resume)
export async function POST(request: Request) {
  const form = await request.formData();
  const jobDescription = String(form.get("jobDescription") ?? "").trim();
  const resume = form.get("resume");

  if (jobDescription.length < 50) {
    return fail(400, "The job description is too short. Paste the full posting, including requirements.");
  }
  if (jobDescription.length > MAX_JD_CHARS) {
    return fail(400, "The job description is over 20,000 characters. Paste only the role's description and requirements.");
  }
  if (!(resume instanceof File) || resume.type !== "application/pdf") {
    return fail(400, "Add your resume as a PDF.");
  }
  if (resume.size > MAX_FILE_BYTES) {
    return fail(400, "The resume PDF is over 5 MB.");
  }

  try {
    // 1. PDF → text
    const resumeText = await pdfToText(await resume.arrayBuffer());
    if (resumeText.length < 200) {
      return fail(
        422,
        "No readable text found in this PDF. If it's a scanned image, export your resume as a text-based PDF."
      );
    }

    // 2. In parallel: structured data (LLM), resume chunk vectors, JD vector
    const chunks = chunkText(resumeText);
    const [parsedResume, chunkVectors, [jdVector]] = await Promise.all([
      parseResume(resumeText),
      embed(chunks, "RETRIEVAL_DOCUMENT"),
      embed([jobDescription.slice(0, 8000)], "RETRIEVAL_QUERY"),
    ]);

    // 3. Save the evaluation and its chunks
    const [evaluation] = await db
      .insert(evaluations)
      .values({ jobDescription, resumeText, parsedResume })
      .returning({ id: evaluations.id });

    await db.insert(resumeChunks).values(
      chunks.map((content, i) => ({
        evaluationId: evaluation.id,
        content,
        embedding: chunkVectors[i],
      }))
    );

    // 4. RAG: retrieve the chunks closest to the JD, then ask the LLM to evaluate
    const relevant = await findRelevantChunks(evaluation.id, jdVector, 6);
    const result = await evaluateResume(jobDescription, parsedResume, formatChunks(relevant));

    await db
      .update(evaluations)
      .set({ score: result.score, result })
      .where(eq(evaluations.id, evaluation.id));

    return Response.json({ id: evaluation.id });
  } catch (err) {
    console.error("Evaluation failed:", err);
    return fail(500, "The evaluation didn't finish. Try again in a moment.");
  }
}
