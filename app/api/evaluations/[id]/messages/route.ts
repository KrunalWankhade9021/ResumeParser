import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { evaluations, messages } from "@/db/schema";
import { completeText, embed } from "@/lib/ai";
import { findRelevantChunks, formatChunks } from "@/lib/rag";

const HISTORY_LIMIT = 12;

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

// POST /api/evaluations/:id/messages  { message: string }
export async function POST(request: Request, ctx: RouteContext<"/api/evaluations/[id]/messages">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(404, "Evaluation not found.");

  const body = await request.json().catch(() => null);
  const question = String(body?.message ?? "").trim();
  if (!question) return fail(400, "Type a question first.");
  if (question.length > 2000) return fail(400, "Keep questions under 2,000 characters.");

  const evaluation = await db.query.evaluations.findFirst({ where: eq(evaluations.id, id) });
  if (!evaluation) return fail(404, "Evaluation not found.");

  try {
    const history = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.evaluationId, id))
      .orderBy(asc(messages.createdAt));

    // RAG for the question: find the resume parts it's about
    const [questionVector] = await embed([question], "RETRIEVAL_QUERY");
    const relevant = await findRelevantChunks(id, questionVector, 4);

    const reply = await completeText([
      {
        role: "system",
        content: `You help a candidate improve their resume for one specific job. Be direct, specific, and encouraging.
Only state facts that appear in the resume or job description below. If something isn't in the resume, say so.
Write in plain text: short paragraphs, and "- " for lists. No markdown headings, bold, or tables. Keep replies under 200 words unless asked for more.

JOB DESCRIPTION:
${evaluation.jobDescription}

RESUME (structured):
${JSON.stringify(evaluation.parsedResume)}

EVALUATION ALREADY SHOWN TO THE CANDIDATE:
${JSON.stringify(evaluation.result)}

RESUME EXCERPTS MOST RELEVANT TO THE QUESTION:
${formatChunks(relevant)}`,
      },
      ...history.slice(-HISTORY_LIMIT),
      { role: "user", content: question },
    ]);

    await db.insert(messages).values([
      { evaluationId: id, role: "user", content: question },
      { evaluationId: id, role: "assistant", content: reply },
    ]);

    return Response.json({ reply });
  } catch (err) {
    console.error("Chat failed:", err);
    return fail(500, "No reply this time. Send your question again.");
  }
}
