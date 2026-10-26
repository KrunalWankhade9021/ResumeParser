import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  serial,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

// One row per "Evaluate" click
export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobDescription: text("job_description").notNull(),
  resumeText: text("resume_text").notNull(),
  parsedResume: jsonb("parsed_resume"),
  score: integer("score"),
  result: jsonb("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Small pieces of the resume + their embedding vectors (the RAG part)
export const resumeChunks = pgTable(
  "resume_chunks",
  {
    id: serial("id").primaryKey(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
  },
  (t) => [
    index("resume_chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
  ]
);

// Chat history
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  evaluationId: uuid("evaluation_id")
    .notNull()
    .references(() => evaluations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
