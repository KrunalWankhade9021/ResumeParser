import { extractText, getDocumentProxy } from "unpdf";

// Pull plain text out of a PDF (server side). Scanned/image-only PDFs return little or no text.
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
