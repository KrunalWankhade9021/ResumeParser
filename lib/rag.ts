import { cosineDistance, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumeChunks } from "@/db/schema";

// The "R" in RAG: find the resume chunks whose meaning is closest to the query vector.
export async function findRelevantChunks(
  evaluationId: string,
  queryVector: number[],
  limit: number
): Promise<string[]> {
  const distance = cosineDistance(resumeChunks.embedding, queryVector);
  const rows = await db
    .select({ content: resumeChunks.content })
    .from(resumeChunks)
    .where(eq(resumeChunks.evaluationId, evaluationId))
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => r.content);
}

export function formatChunks(chunks: string[]): string {
  return chunks.map((c, i) => `[Excerpt ${i + 1}]\n${c}`).join("\n\n");
}
