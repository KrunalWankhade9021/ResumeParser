import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { evaluations, messages } from "@/db/schema";
import { Evaluation, ParsedResume } from "@/lib/resume";
import Chat from "@/components/chat";

export default function EvaluationPage(props: PageProps<"/evaluation/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <Link
        href="/"
        className="text-sm font-medium underline decoration-rule underline-offset-4 hover:decoration-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
      >
        Start a new evaluation
      </Link>
      <Suspense fallback={<p className="mt-10 text-graphite">Loading your evaluation…</p>}>
        <EvaluationView params={props.params} />
      </Suspense>
    </main>
  );
}

function verdict(score: number) {
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Good match with gaps";
  if (score >= 40) return "Partial match";
  return "Weak match";
}

async function EvaluationView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const row = await db.query.evaluations.findFirst({ where: eq(evaluations.id, id) });
  if (!row || !row.result) notFound();

  const result = Evaluation.parse(row.result);
  const parsed = ParsedResume.safeParse(row.parsedResume);
  const name = parsed.success ? parsed.data.name : null;

  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.evaluationId, id))
    .orderBy(asc(messages.createdAt));

  return (
    <>
      <header className="mt-10 grid gap-8 md:grid-cols-[auto_1fr] md:items-end md:gap-12">
        <div>
          <p className="text-sm font-medium text-graphite">Match score</p>
          <p className="mt-1 font-serif leading-none">
            <span className="relative inline-block text-8xl tracking-tight tabular-nums sm:text-9xl">
              <span aria-hidden className="absolute inset-x-0 bottom-2 h-5 bg-highlight sm:h-6" />
              <span className="relative">{result.score}</span>
            </span>
            <span className="ml-1 text-3xl text-graphite">/100</span>
          </p>
        </div>
        <div className="max-w-2xl">
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">
            {verdict(result.score)}
            {name ? ` for ${name}` : ""}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-graphite">{result.summary}</p>
        </div>
      </header>

      <div className="mt-14 grid gap-10 border-t border-rule pt-10 md:grid-cols-2">
        <FeedbackList title="What's strong" items={result.strengths} />
        <FeedbackList title="What's missing" items={result.gaps} />
      </div>

      <section className="mt-12 border-t border-rule pt-10">
        <h2 className="font-serif text-2xl">Suggested edits</h2>
        <ol className="mt-5 max-w-3xl space-y-4">
          {result.suggestions.map((s, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr] leading-relaxed">
              <span className="font-serif text-lg text-graphite tabular-nums">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <Chat evaluationId={id} initialMessages={history} />
    </>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h2 className="font-serif text-2xl">{title}</h2>
      <ul className="mt-5 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="border-l-2 border-rule pl-4 leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
