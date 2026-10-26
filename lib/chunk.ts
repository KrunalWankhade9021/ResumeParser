const TARGET_CHARS = 700;

// Split resume text into ~700 character pieces on line boundaries.
// Each chunk repeats the last line of the previous one, so a bullet point
// that sits on a boundary is never cut off from its context.
export function chunkText(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const line of lines) {
    if (length + line.length > TARGET_CHARS && current.length > 0) {
      chunks.push(current.join("\n"));
      const overlap = current[current.length - 1];
      current = [overlap];
      length = overlap.length;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));

  return chunks;
}
