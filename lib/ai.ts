import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

export const CHAT_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768; // must match vector(768) in db/schema.ts

// Clients are created on first use, not at import time, so `next build`
// works on a machine (like CI) that has no API keys.
let groqClient: Groq | undefined;
let genaiClient: GoogleGenAI | undefined;

function groq() {
  groqClient ??= new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

function genai() {
  genaiClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genaiClient;
}

type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// Turn texts into vectors. Use RETRIEVAL_DOCUMENT for stored resume chunks
// and RETRIEVAL_QUERY for the thing we search with (JD, chat question).
export async function embed(texts: string[], taskType: EmbedTask): Promise<number[][]> {
  const res = await genai().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
  });
  const vectors = res.embeddings?.map((e) => e.values ?? []) ?? [];
  if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Embedding API returned an unexpected result");
  }
  return vectors;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type JsonSchema = { name: string; schema: Record<string, unknown> };

// Ask the LLM for JSON that must match `schema` exactly. Strict mode makes Groq
// constrain the output, so the model can't return broken JSON (e.g. a missing "]").
export async function completeJson(messages: ChatMessage[], format: JsonSchema): Promise<unknown> {
  const res = await groq().chat.completions.create({
    model: CHAT_MODEL,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: format.name, schema: format.schema, strict: true },
    },
    reasoning_effort: "low",
    include_reasoning: false,
    temperature: 0.2,
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return JSON.parse(content);
}

// Ask the LLM for a normal text reply (used by the chat).
export async function completeText(messages: ChatMessage[]): Promise<string> {
  const res = await groq().chat.completions.create({
    model: CHAT_MODEL,
    messages,
    reasoning_effort: "low",
    include_reasoning: false,
    temperature: 0.4,
  });
  const content = res.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM returned an empty response");
  return content;
}
