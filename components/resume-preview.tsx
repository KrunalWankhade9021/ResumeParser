"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  file: File;
};

// Renders page 1 of a PDF onto a canvas, entirely in the browser.
export default function ResumePreview({ file }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;

    async function render() {
      setState("loading");
      try {
        // Imported here, not at the top, because pdf.js needs browser APIs
        // and this component is also pre-rendered on the server.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        const page = await pdf.getPage(1);

        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        // Fit the page to the canvas' displayed width, sharp on high-DPI screens.
        const cssWidth = canvas.clientWidth || 400;
        const base = page.getViewport({ scale: 1 });
        const scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;

        if (!cancelled) {
          setPageCount(pdf.numPages);
          setState("ready");
        }
      } catch (err) {
        console.error("PDF preview failed:", err);
        if (!cancelled) setState("error");
      }
    }

    render();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [file]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`First page of ${file.name}`}
        className={`block h-auto w-full transition-opacity duration-300 ${
          state === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
      {state === "loading" && (
        <p className="absolute inset-0 grid place-items-center text-sm text-graphite">
          Rendering preview…
        </p>
      )}
      {state === "error" && (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-graphite">
          Couldn&apos;t draw a preview of this PDF. It will still be evaluated.
        </p>
      )}
      {state === "ready" && pageCount > 1 && (
        <p className="absolute bottom-2 right-2 rounded-sm bg-ink/80 px-2 py-0.5 text-xs text-paper tabular-nums">
          Page 1 of {pageCount}
        </p>
      )}
    </div>
  );
}
