"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ResumePreview from "@/components/resume-preview";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [resumeUrl, setResumeUrl] = useState("");
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Free the temporary PDF link when leaving the page.
  useEffect(() => {
    return () => {
      if (resumeUrl) URL.revokeObjectURL(resumeUrl);
    };
  }, [resumeUrl]);

  function pickFile(file: File | undefined) {
    setStatus("");
    if (!file) return;
    if (file.type !== "application/pdf") {
      setFileError("That file isn't a PDF. Export your resume as PDF and try again.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`That PDF is ${formatSize(file.size)}. The limit is 5 MB.`);
      return;
    }
    setFileError("");
    setResume(file);
    // A temporary local link to the PDF, so "Open full PDF" works without uploading it.
    setResumeUrl(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resume) {
      setFileError("Add your resume as a PDF to continue.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    setStatus("Reading your resume and comparing it to the job. This takes about 20 seconds.");

    const body = new FormData();
    body.append("jobDescription", jobDescription);
    body.append("resume", resume);

    try {
      const res = await fetch("/api/evaluate", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The evaluation didn't finish. Try again in a moment.");
      router.push(`/evaluation/${data.id}`);
    } catch (err) {
      setSubmitting(false);
      setStatus("");
      setSubmitError(err instanceof Error ? err.message : "The evaluation didn't finish. Try again in a moment.");
    }
  }

  const canSubmit = jobDescription.trim().length > 0 && resume !== null && !submitting;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-20">
      <header className="max-w-2xl">
        <p className="text-sm font-medium text-graphite">Resume Evaluator</p>
        <h1 className="mt-3 font-serif text-4xl leading-[1.1] tracking-tight sm:text-5xl">
          See how your resume reads against a specific job.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-graphite">
          Paste the job description and add your resume. You&apos;ll get a match
          score, what&apos;s strong, what&apos;s missing, and a chat to dig into the details.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mt-12 grid gap-8 md:grid-cols-[1.35fr_1fr] md:gap-10">
        <div className="flex flex-col">
          <label htmlFor="jd" className="font-medium">
            Job description
          </label>
          <p id="jd-hint" className="mt-1 text-sm text-graphite">
            Include the responsibilities and requirements sections.
          </p>
          <textarea
            id="jd"
            aria-describedby="jd-hint"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="We're looking for a backend engineer who…"
            className="mt-3 min-h-80 flex-1 resize-y rounded-md border border-rule bg-sheet p-4 leading-relaxed placeholder:text-graphite/60 focus:border-ink focus:outline-none focus:ring-4 focus:ring-highlight/60"
          />
          <p className="mt-2 text-right text-xs text-graphite tabular-nums">
            {jobDescription.trim().length.toLocaleString()} characters
          </p>
        </div>

        <div className="flex flex-col">
          <span id="resume-label" className="font-medium">
            Your resume
          </span>
          <p className="mt-1 text-sm text-graphite">PDF, up to 5 MB.</p>

          {/* The sheet: a drop target in both states */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              pickFile(e.dataTransfer.files[0]);
            }}
            className={`relative mt-3 overflow-hidden rounded-sm border bg-sheet transition-[border-color,box-shadow] duration-200 ${
              isDragging
                ? "border-ink shadow-[0_0_0_4px_var(--highlight)]"
                : resume
                  ? "border-rule"
                  : "border-dashed border-rule hover:border-graphite"
            }`}
          >
            {resume ? (
              <ResumePreview file={resume} />
            ) : (
              <button
                type="button"
                aria-labelledby="resume-label"
                aria-describedby={fileError ? "file-error" : undefined}
                onClick={() => fileInput.current?.click()}
                className="flex aspect-[1/1.3] w-full flex-col items-start justify-end p-6 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-highlight/60"
              >
                {/* folded corner, so the drop area reads as a sheet of paper */}
                <span
                  aria-hidden
                  className="absolute right-0 top-0 h-7 w-7 border-b border-l border-rule bg-paper [clip-path:polygon(0_0,100%_100%,0_100%)]"
                />
                <span className="font-serif text-xl">Drop your PDF here</span>
                <span className="mt-1 text-sm text-graphite">or click to choose a file</span>
              </button>
            )}
          </div>

          {resume && (
            <div className="mt-3">
              <p className="flex items-baseline gap-2">
                <span className="truncate font-medium" title={resume.name}>
                  {resume.name}
                </span>
                <span className="shrink-0 text-sm text-graphite">{formatSize(resume.size)}</span>
              </p>
              <p className="mt-1 flex gap-4 text-sm">
                <a
                  href={resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-rule underline-offset-4 hover:decoration-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
                >
                  Open full PDF
                </a>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="underline decoration-rule underline-offset-4 hover:decoration-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
                >
                  Replace file
                </button>
              </p>
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {fileError && (
            <p id="file-error" role="alert" className="mt-3 text-sm text-danger">
              {fileError}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-4 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between md:col-span-2">
          {submitError ? (
            <p role="alert" className="text-sm text-danger">
              {submitError}
            </p>
          ) : (
            <p className="text-sm text-graphite" aria-live="polite">
              {status || "Your resume is only used for this evaluation."}
            </p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            className="w-full shrink-0 rounded-md bg-ink px-6 py-3 font-medium text-paper transition-colors hover:bg-ink/85 focus:outline-none focus-visible:ring-4 focus-visible:ring-highlight disabled:cursor-not-allowed disabled:bg-rule disabled:text-graphite sm:w-auto"
          >
            {submitting ? "Evaluating…" : "Evaluate resume"}
          </button>
        </div>
      </form>
    </main>
  );
}
