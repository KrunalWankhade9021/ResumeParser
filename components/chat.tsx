"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "What should I change first?",
  "Rewrite my summary for this job",
  "How do I show the missing skills?",
];

export default function Chat({
  evaluationId,
  initialMessages,
}: {
  evaluationId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > initialMessages.length) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, initialMessages.length, sending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    setError("");
    setDraft("");
    setSending(true);
    setMessages((m) => [...m, { role: "user", content: question }]);

    try {
      const res = await fetch(`/api/evaluations/${evaluationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No reply this time. Send your question again.");
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages((m) => m.slice(0, -1));
      setDraft(question);
      setError(err instanceof Error ? err.message : "No reply this time. Send your question again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="chat-heading" className="mt-16 border-t border-rule pt-10">
      <h2 id="chat-heading" className="font-serif text-3xl">
        Ask about your resume
      </h2>
      <p className="mt-2 text-graphite">
        Answers use your resume and this job description.
      </p>

      <div className="mt-8 space-y-6" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-rule bg-sheet px-4 py-2 text-sm hover:border-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-highlight/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-auto max-w-[85%] w-fit rounded-md bg-ink px-4 py-3 text-paper">
              {m.content}
            </p>
          ) : (
            <div key={i} className="max-w-[65ch] whitespace-pre-wrap leading-relaxed">
              {m.content}
            </div>
          )
        )}

        {sending && <p className="text-sm text-graphite">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="mt-8"
      >
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-3 rounded-md border border-rule bg-sheet p-2 focus-within:border-ink focus-within:ring-4 focus-within:ring-highlight/60">
          <textarea
            id="question"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Ask a follow-up question…"
            className="flex-1 resize-none bg-transparent p-2 leading-relaxed placeholder:text-graphite/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-md bg-ink px-5 py-2.5 font-medium text-paper hover:bg-ink/85 focus:outline-none focus-visible:ring-4 focus-visible:ring-highlight disabled:cursor-not-allowed disabled:bg-rule disabled:text-graphite"
          >
            Send
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-2 text-xs text-graphite">Enter to send, Shift + Enter for a new line.</p>
      </form>
    </section>
  );
}
