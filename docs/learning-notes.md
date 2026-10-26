# Resume Evaluator: Learning Notes

> A study guide for this project: what we built, how each part works, and the deployment concepts learned so far.
>
> **Purpose of the project:** learn how to deploy a real application on AWS EC2. The resume evaluator is the example application; the deployment is the lesson.

---

## Table of contents

1. [Where we are](#1-where-we-are)
2. [What the app does](#2-what-the-app-does)
3. [Architecture](#3-architecture)
4. [Technology choices and why](#4-technology-choices-and-why)
5. [Project structure](#5-project-structure)
6. [How an evaluation works (step by step)](#6-how-an-evaluation-works-step-by-step)
7. [How the chat works (RAG)](#7-how-the-chat-works-rag)
8. [Database concepts](#8-database-concepts)
9. [Docker concepts](#9-docker-concepts)
10. [Secrets: how `.env` values reach the app](#10-secrets-how-env-values-reach-the-app)
11. [Automatic migrations on startup](#11-automatic-migrations-on-startup)
12. [Lessons from bugs we hit](#12-lessons-from-bugs-we-hit)
13. [Command cheat sheet](#13-command-cheat-sheet)
14. [What comes next](#14-what-comes-next)
15. [Self-check questions](#15-self-check-questions)

---

## 1. Where we are

```mermaid
flowchart LR
    P1["Phase 1<br/>Local setup"]:::done --> P2["Phase 2<br/>Build the app"]:::done
    P2 --> P3a["3a. Dockerfile"]:::done
    P3a --> P3b["3b. Auto-migrations"]:::done
    P3b --> P3c["3c. Compose: app + db"]:::next
    P3c --> P4["Phase 4<br/>Deploy to EC2 by hand"]:::todo
    P4 --> P5["Phase 5<br/>CI/CD with GitHub Actions"]:::todo
    P5 --> P6["Later<br/>ECR, RDS, HTTPS"]:::todo

    classDef done fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef next fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef todo fill:#f3f4f6,stroke:#9ca3af,color:#374151
```

Green is finished, yellow is the next step, grey is still to come.

**First command when you return:** rebuild the image so it includes the new `instrumentation.ts` file.

```bash
docker build -t resume-evaluator .
```

---

## 2. What the app does

The user experience is two pages:

1. **Page 1, the form.** The user pastes a job description (JD) and uploads their resume as a PDF. The first page of the resume is shown as a live preview, drawn entirely in the browser.
2. **Page 2, the result.** After clicking **Evaluate resume**, the user sees a match score out of 100, a short summary, what is strong, what is missing, numbered suggested edits, and a chat where they can ask follow-up questions about their resume.

```mermaid
flowchart LR
    A["User pastes JD<br/>and uploads PDF"] --> B["Clicks<br/>Evaluate resume"]
    B --> C["Server processes<br/>about 20 seconds"]
    C --> D["Page 2: score,<br/>strengths, gaps, edits"]
    D --> E["User chats with<br/>the assistant"]
    E --> E
```

There is no login. Each evaluation gets its own unguessable URL, such as `/evaluation/587a3412-851f-...`, and the chat history is saved, so refreshing the page loses nothing.

---

## 3. Architecture

### Target setup on EC2

```mermaid
flowchart LR
    U(["Browser"]) -->|"HTTP, port 80"| N["nginx<br/>reverse proxy"]

    subgraph EC2["EC2 instance: t3.micro, Elastic IP 13.53.153.177"]
        N -->|"port 3000"| A["Next.js app<br/>container"]
        A -->|"SQL, port 5432"| D[("Postgres + pgvector<br/>container")]
        D --- V[["Docker volume<br/>on the EBS disk"]]
    end

    A -->|"HTTPS"| G["Groq API<br/>LLM: gpt-oss-120b"]
    A -->|"HTTPS"| M["Gemini API<br/>embeddings"]
```

**How to read this diagram:**

- **nginx** is the front door. It receives every request on port 80 and forwards it to the app on port 3000. This is called a *reverse proxy*. It lets us add HTTPS, compression and security rules later without touching the app.
- **The Next.js container** is the whole application: both the web pages and the API routes.
- **The Postgres container** stores evaluations, resume chunks with their vectors, and chat messages. Its data lives in a **Docker volume** on the EC2's EBS disk, so it survives container restarts and redeployments.
- **Groq** and **Gemini** are external AI services reached over the internet. The app calls them; nothing about them runs on our server.

---

## 4. Technology choices and why

| Part | Choice | Reason |
|---|---|---|
| Frontend and backend | **One Next.js app** | One container to build and deploy instead of two. Lighter on a 1 GB RAM server. |
| Database | **Postgres with pgvector**, in Docker on the same EC2 | Free, and teaches Docker volumes. Moving to AWS RDS is a planned later lesson. |
| Large language model | **Groq** running `openai/gpt-oss-120b` | Very fast, free tier, open-weight model. |
| Embeddings | **Gemini** `gemini-embedding-001`, reduced to 768 numbers | Groq does not offer embeddings. Using an API keeps the small server free of a heavy local model. 768 dimensions fits pgvector's fast index (limit 2000). |
| ORM | **Drizzle** | Has built-in support for vector columns and vector search. Prisma would need raw SQL for every vector operation. |
| PDF text (server) | **unpdf** | Extracts text from PDFs on the server. |
| PDF preview (browser) | **pdf.js** (`pdfjs-dist`) | Draws page 1 of the resume onto a canvas without uploading it. |
| Validation | **zod** | Checks that data from the LLM has exactly the expected shape. |
| Secrets | `.env.local` locally, **GitHub Secrets** in CI | Keys never appear in Git or inside the Docker image. |
| Image registry | **GHCR** (GitHub Container Registry) | Simplest option to start. AWS ECR is a later lesson. |

---

## 5. Project structure

```
resume-evaluator/
├── app/
│   ├── page.tsx                                Page 1: form and resume preview
│   ├── evaluation/[id]/page.tsx                Page 2: score, feedback, chat
│   └── api/
│       ├── evaluate/route.ts                   POST: the full evaluation pipeline
│       └── evaluations/[id]/messages/route.ts  POST: chat replies
├── components/
│   ├── resume-preview.tsx                      draws PDF page 1 in the browser
│   └── chat.tsx                                chat interface
├── lib/
│   ├── pdf.ts         PDF to plain text (server)
│   ├── chunk.ts       splits text into ~700-character chunks
│   ├── ai.ts          Groq and Gemini clients
│   ├── rag.ts         vector similarity search
│   └── resume.ts      prompts, JSON schemas, zod validation
├── db/
│   ├── schema.ts      the three tables, defined in TypeScript
│   └── index.ts       the database connection
├── drizzle/           migration SQL files (generated)
├── docs/              these notes
├── drizzle.config.ts  settings for the drizzle-kit command-line tool
├── instrumentation.ts runs database migrations when the server starts
├── docker-compose.yml Postgres today; the app joins it in step 3c
├── Dockerfile         recipe for building the app image
├── .dockerignore      files that must never be copied into the image
└── .env.local         API keys and DATABASE_URL (git-ignored, never committed)
```

**Rule of thumb:** configuration files live at the **project root**, next to `package.json`. Tools such as `docker`, `npm` and `drizzle-kit` look for them in the folder you run the command from. Only pages, layouts and API routes belong inside `app/`.

---

## 6. How an evaluation works (step by step)

When the user clicks **Evaluate resume**, the browser sends the JD and the PDF to `POST /api/evaluate`. The server then runs this pipeline:

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as /api/evaluate
    participant G as Groq (LLM)
    participant E as Gemini (embeddings)
    participant DB as Postgres + pgvector

    B->>API: FormData with JD and PDF
    API->>API: Validate input, extract text from PDF
    API->>API: Split resume text into chunks

    par Run in parallel to save time
        API->>G: Parse resume into structured JSON
        G-->>API: name, skills, experience, education, projects
    and
        API->>E: Embed every resume chunk
        E-->>API: one 768-number vector per chunk
    and
        API->>E: Embed the job description
        E-->>API: one 768-number vector
    end

    API->>DB: Insert evaluation and chunks with vectors
    API->>DB: Find the 6 chunks closest to the JD vector
    DB-->>API: most relevant resume excerpts
    API->>G: Evaluate: JD + structured resume + excerpts
    G-->>API: score, summary, strengths, gaps, suggestions
    API->>DB: Save score and result
    API-->>B: Evaluation id
    B->>B: Navigate to /evaluation/[id]
```

**Why the three AI calls run in parallel:** they don't depend on each other, so running them at the same time cuts the waiting time roughly in half.

**Why the LLM must return strict JSON:** the code needs to read fields like `score` and `strengths`. We send Groq a *JSON schema* in **strict mode**, which forces the model's output to match the shape exactly. Then **zod** double-checks it on our side. (See the bug story in section 12.)

---

## 7. How the chat works (RAG)

**RAG** stands for *Retrieval-Augmented Generation*. Instead of hoping the LLM remembers everything, we **retrieve** the most relevant pieces of the resume for each question and **give them to the model** together with the question.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as /api/evaluations/[id]/messages
    participant E as Gemini (embeddings)
    participant DB as Postgres + pgvector
    participant G as Groq (LLM)

    B->>API: "How do I show the missing skills?"
    API->>DB: Load evaluation and chat history
    API->>E: Embed the question
    E-->>API: question vector
    API->>DB: Find the 4 chunks closest to the question
    DB-->>API: relevant resume excerpts
    API->>G: System prompt (JD, resume, evaluation, excerpts) + history + question
    G-->>API: reply
    API->>DB: Save the question and the reply
    API-->>B: reply
```

**Why retrieval helps:** the model receives the resume parts that matter for *this* question, so answers stay grounded in what the resume actually says. This is the same idea behind most "chat with your documents" products.

---

## 8. Database concepts

### The three tables

```mermaid
erDiagram
    evaluations ||--o{ resume_chunks : "has many"
    evaluations ||--o{ messages : "has many"

    evaluations {
        uuid id PK
        text job_description
        text resume_text
        jsonb parsed_resume
        integer score
        jsonb result
        timestamp created_at
    }
    resume_chunks {
        serial id PK
        uuid evaluation_id FK
        text content
        vector_768 embedding
    }
    messages {
        serial id PK
        uuid evaluation_id FK
        text role
        text content
        timestamp created_at
    }
```

- **`evaluations`** is the main record. One row is created for each click on *Evaluate resume*.
- **`resume_chunks`** holds small pieces of the resume, each with its embedding vector. This is the table that RAG searches.
- **`messages`** holds the chat history. `role` is either `user` or `assistant`.
- **Foreign keys with cascade:** each chunk and message belongs to one evaluation. Deleting an evaluation automatically deletes its chunks and messages.
- **`uuid` ids** are long random identifiers. Unlike 1, 2, 3, nobody can guess another person's evaluation URL.
- **HNSW index** on `embedding`: a navigation structure that lets Postgres find the closest vectors quickly without comparing against every row. It is like the index at the back of a book.

### What a vector is

A **vector** is a list of numbers that represents the *meaning* of a piece of text. Texts with similar meaning get vectors that are close together.

```mermaid
flowchart LR
    T1["'Built REST APIs<br/>with Node.js'"] --> V1["[0.12, -0.03, ... 768 numbers]"]
    T2["'Backend development<br/>experience'"] --> V2["[0.10, -0.05, ... 768 numbers]"]
    T3["'Won a chess<br/>tournament'"] --> V3["[-0.41, 0.33, ... 768 numbers]"]
    V1 <-->|"small distance:<br/>similar meaning"| V2
    V1 <-->|"large distance:<br/>different meaning"| V3
```

We tested this in `psql`:

```sql
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector;   -- 5.196
```

RAG retrieval is simply: *order the chunks by distance to the question's vector and take the closest few.* We use **cosine distance**, the standard measure for text meaning.

### Migrations

A **migration** is a SQL file that changes the database structure. Think of migrations as **version control for the database**.

```mermaid
flowchart LR
    S["db/schema.ts<br/>(tables in TypeScript)"] -->|"npx drizzle-kit generate"| M["drizzle/0001_init_tables.sql<br/>(SQL file)"]
    M -->|"npx drizzle-kit migrate<br/>or migrate() on startup"| DB[("Postgres")]
    DB --> J["drizzle.__drizzle_migrations<br/>(record of applied files)"]
```

- `generate` compares `schema.ts` with the previous migrations and writes a new SQL file containing only the changes.
- `migrate` applies the files that have not run yet. Drizzle records each applied file, so running `migrate` again is safe: it skips what is already done.
- `0000_enable_pgvector.sql` contains `CREATE EXTENSION IF NOT EXISTS vector;`. A brand-new database, like the one on EC2, needs this before the `resume_chunks` table can use the `vector` type.

### Two configuration files, two jobs

| File | Used by | When |
|---|---|---|
| `drizzle.config.ts` | the **drizzle-kit** command-line tool | only when you run `generate` or `migrate` on your laptop |
| `db/index.ts` | **the application** | every time the app reads or writes data |

### Local port conflict

Ubuntu already runs its own Postgres on port **5432**, so our container is published on **5433** instead:

```mermaid
flowchart LR
    L1["Laptop port 5432"] --> U["Ubuntu's own Postgres<br/>(left untouched)"]
    L2["Laptop port 5433"] --> C["resume-db container<br/>internal port 5432"]
```

---

## 9. Docker concepts

### Image and container

```mermaid
flowchart LR
    DF["Dockerfile<br/>(the recipe)"] -->|"docker build"| IMG["Image<br/>(sealed, shareable box)"]
    IMG -->|"docker run /<br/>docker compose up"| C1["Container<br/>(the box, switched on)"]
    IMG -->|"same image,<br/>anywhere"| C2["Container on EC2"]
```

- A **Dockerfile** is a recipe: a list of instructions for assembling the application.
- An **image** is the result: a sealed package containing Node.js, the built app and its libraries. It can be pushed to a registry and pulled onto any machine.
- A **container** is a running instance of an image.

Because the image contains everything, the app behaves the same on your laptop and on EC2. This removes the classic "it works on my machine" problem.

### Multi-stage build

Our Dockerfile has three stages. Only the last one becomes the final image.

```mermaid
flowchart LR
    subgraph S1["Stage 1: deps"]
        A1["Copy package.json<br/>and package-lock.json"] --> A2["npm ci<br/>(install exact versions)"]
    end
    subgraph S2["Stage 2: builder"]
        B1["Copy node_modules<br/>and source code"] --> B2["npm run build<br/>(creates .next/standalone)"]
    end
    subgraph S3["Stage 3: runner (shipped)"]
        C1["Copy only standalone output,<br/>static files and drizzle/"] --> C2["Run as non-root user<br/>CMD node server.js"]
    end
    S1 --> S2 --> S3
```

An analogy: stage 1 buys the ingredients, stage 2 cooks in a messy kitchen, and stage 3 serves the dish on a clean plate. Customers receive only the plate, never the kitchen.

### Why `output: "standalone"`

Set in `next.config.ts`. During the build, Next.js traces which files the app actually uses and copies only those, plus a small `server.js` that starts the app. Our result:

| Measure | Value | Meaning |
|---|---|---|
| Content size | **76.7 MB** | Compressed size: roughly what EC2 downloads on each deploy |
| Disk usage | **307 MB** | Unpacked size on disk. About 160 MB of this is Node.js and Alpine Linux itself |

Without multi-stage builds and standalone output, a comparable image would exceed 1 GB.

### Layer caching

Each Dockerfile instruction produces a cached *layer*. We copy `package.json` and `package-lock.json` and run `npm ci` **before** copying the source code. When only code changes, Docker reuses the cached install layer (you will see `Using cache`), so rebuilds are much faster.

### `.dockerignore`

Works like `.gitignore`, but for the Docker build. It keeps `node_modules`, `.next`, `.git` and, most importantly, **`.env*`** out of the image. **Secrets must never be baked into an image.**

### Key lines in the final stage

| Line | Purpose |
|---|---|
| `FROM node:24-alpine` | A tiny Linux distribution (Alpine) with Node.js 24 preinstalled |
| `ENV HOSTNAME=0.0.0.0` | Listen on all network addresses. `127.0.0.1` would make the app unreachable from outside the container. |
| `adduser nextjs` and `USER nextjs` | Run the app as a normal user, not root. If the app were ever compromised, the attacker would have far less power. |
| `COPY --from=builder /app/drizzle ./drizzle` | Ships the migration files so they can run at startup |
| `EXPOSE 3000` | Documents the port the app listens on |
| `CMD ["node", "server.js"]` | The command executed when the container starts |

---

## 10. Secrets: how `.env` values reach the app

**Core rule: secrets are never inside the image. They are provided to the container when it starts, as environment variables.**

```mermaid
flowchart TB
    subgraph BUILD["Build time: docker build"]
        SRC["Source code"] --> IMG["Image<br/>(contains NO secrets)"]
        ENVX[".env.local"] -.->|"blocked by .dockerignore"| IMG
    end
    subgraph RUN["Run time: docker compose up"]
        IMG2["Image"] --> CT["Running container"]
        SEC[".env file<br/>(local or on EC2)"] -->|"injected as<br/>environment variables"| CT
        CT --> CODE["process.env.GROQ_API_KEY<br/>process.env.DATABASE_URL"]
    end
    IMG --> IMG2
```

**Why:** an image is shared. It is pushed to GHCR and pulled by EC2, and anyone who obtains it can open it and read every file inside. If keys were baked in, they would leak, just like the old repository flagged by GitGuardian.

An analogy: the image is a car and the secrets are its key. You can ship the car anywhere; only someone holding the key can drive it.

### Where secrets come from in each environment

```mermaid
flowchart LR
    subgraph LOCAL["Your laptop"]
        L1[".env.local"] --> L2["npm run dev<br/>(Next.js reads it)"]
        L1 --> L3["Docker Compose<br/>env_file: .env.local"]
    end
    subgraph CICD["CI/CD (Phase 5)"]
        GS["GitHub Secrets"] -->|"GitHub Actions,<br/>over SSH"| EF[".env on EC2<br/>(never in Git)"]
        EF --> C["Docker Compose on EC2"]
    end
```

**Why `next build` works without any keys:** the Groq client, the Gemini client and the database pool are created **lazily**, on first use, rather than when a file is imported. The build never touches them, so the image can be built on GitHub's servers without access to any secret.

### The `DATABASE_URL` changes inside Docker

```mermaid
flowchart LR
    subgraph LAPTOP["npm run dev on the laptop"]
        APP1["App"] -->|"localhost:5433"| DB1[("resume-db")]
    end
    subgraph DOCKER["Inside Docker Compose"]
        APP2["app container"] -->|"db:5432<br/>(service name)"| DB2[("db container")]
    end
```

```
Laptop:          postgresql://resume:resume_dev_pw@localhost:5433/resume_evaluator
Inside Docker:   postgresql://resume:resume_dev_pw@db:5432/resume_evaluator
```

Inside a container, `localhost` means *that container itself*, not your laptop. Containers on the same Compose network find each other by **service name** (`db`) and talk on the **internal** port (5432). In step 3c we override `DATABASE_URL` for the app service accordingly.

---

## 11. Automatic migrations on startup

**The problem:** the database on EC2 starts completely empty: no `vector` extension and no tables. We don't want to SSH in and run migrations by hand on every deploy, and `drizzle-kit` is a development tool that isn't included in the image.

**The solution:** Next.js calls the `register()` function in `instrumentation.ts` **once, when the server starts**. We apply pending migrations there using Drizzle's built-in migrator, which is part of `drizzle-orm` and already inside the image.

```mermaid
sequenceDiagram
    participant D as Docker
    participant S as Next.js server
    participant I as instrumentation.ts
    participant DB as Postgres

    D->>S: start container (node server.js)
    S->>I: register()
    I->>DB: Which migrations are already applied?
    DB-->>I: list from __drizzle_migrations
    I->>DB: Apply only the new SQL files
    I-->>S: "Database migrations applied"
    S->>S: Start accepting requests
```

- The `NEXT_RUNTIME !== "nodejs"` check skips the lightweight Edge runtime, where Postgres connections are not possible.
- Because Drizzle tracks what it has already applied, this runs safely on every start, both in Docker and in `npm run dev`.

---

## 12. Lessons from bugs we hit

| Symptom | Root cause | Lesson |
|---|---|---|
| `zsh: command not found: CREATE` | SQL was typed into the shell | SQL belongs in `.sql` files or inside `psql`. The shell only understands shell commands. |
| Terminal stuck at a `>` prompt | The heredoc end marker `EOF` had spaces in front of it | `Ctrl + C` always cancels and returns the normal prompt. |
| `address already in use` on port 5432 | Ubuntu's own Postgres already used that port | Find the owner with `sudo ss -tlnp \| grep 5432`, then map a different host port. |
| Page rendered black with wrong fonts | The dev server served a **stale** copy of `globals.css` | Clear the cache: `rm -rf .next`, then restart `npm run dev`. |
| "The evaluation didn't finish" | The LLM omitted one `]`, so its JSON was invalid (`json_validate_failed`) | **Read the server log, not the message on screen.** Fixed by switching Groq to strict `json_schema` mode, which makes malformed JSON impossible. |
| GitGuardian "Critical" alert | Real API keys had been committed in an old repository's `.env.example` | Deleting the file is not enough, because Git history keeps it. **The real fix is revoking the key.** |

### The debugging method we used

```mermaid
flowchart TD
    A["Friendly error on screen"] --> B["Find the real error<br/>in the server log"]
    B --> C["Test each component alone<br/>(Groq, Gemini, database)"]
    C --> D["Form one hypothesis<br/>and test it in isolation"]
    D --> E{"Confirmed?"}
    E -->|"Yes"| F["Apply a single fix,<br/>then verify end to end"]
    E -->|"No"| C
```

**Where real errors are printed:**

- Local development: the terminal running `npm run dev`, or `.next/dev/logs/next-development.log`
- Docker and EC2: `docker logs <container-name>` or `docker compose logs app`

---

## 13. Command cheat sheet

```bash
# Development
npm run dev                                  # start the dev server at localhost:3000
rm -rf .next && npm run dev                  # restart with a clean cache

# Local database (Docker)
docker compose up -d                         # start Postgres in the background
docker compose ps                            # show container status
docker exec -it resume-db psql -U resume -d resume_evaluator              # SQL shell (\q to quit)
docker exec -it resume-db psql -U resume -d resume_evaluator -c "\dt"     # list tables

# Migrations (on the laptop)
npx drizzle-kit generate --name=<what_changed>
npx drizzle-kit migrate

# Docker image
docker build -t resume-evaluator .           # build the image
docker images resume-evaluator               # show its size

# Git: always check before committing
git status                                   # .env.local must never appear here
```

---

## 14. What comes next

### Step 3c: run the whole stack in Docker Compose

We add an `app` service next to the existing `db` service in `docker-compose.yml`. It uses the image we built, reads secrets from `.env.local`, overrides `DATABASE_URL` to point at `db:5432`, publishes port 3000, and waits for the database to start first.

```mermaid
flowchart LR
    U(["Browser<br/>localhost:3000"]) --> APP["app service<br/>(our image)"]
    ENV[".env.local"] -->|"env_file"| APP
    APP -->|"db:5432"| DB[("db service<br/>pgvector")]
    DB --- VOL[["pgdata volume"]]
```

This is exactly how the app will run on EC2, so once it works locally, the server deployment is mostly copying files.

### Phase 4: deploy to EC2 by hand

Install Docker on EC2, copy `docker-compose.yml` and a `.env` file to the server, start the stack, and configure nginx to forward port 80 to port 3000. Doing this by hand once means you will understand every step that the pipeline later automates.

### Phase 5: CI/CD with GitHub Actions

```mermaid
flowchart LR
    DEV(["git push"]) --> GA["GitHub Actions"]
    GA -->|"docker build"| IMG["Image"]
    IMG -->|"docker push"| GHCR[("GHCR registry")]
    GA -->|"SSH"| EC2["EC2"]
    GS["GitHub Secrets"] -.->|"write .env"| EC2
    EC2 -->|"docker compose pull<br/>docker compose up -d"| LIVE(["New version live<br/>at 13.53.153.177"])
    GHCR -.->|"pull image"| EC2
```

The image is built on GitHub's servers because the 1 GB EC2 instance does not have enough memory to run `next build` reliably. EC2 only downloads and runs the finished image.

---

## 15. Self-check questions

Try to answer these without looking back; every answer is in the sections above.

1. Why do we keep the frontend and backend in one Next.js app for this project?
2. What does RAG stand for, and which two moments in the app use it?
3. Why does the evaluation pipeline run three AI calls in parallel?
4. What is the difference between `drizzle.config.ts` and `db/index.ts`?
5. Why must `0000_enable_pgvector.sql` run before the tables migration?
6. What is the difference between an image and a container?
7. What does each of the three Dockerfile stages do, and which one is shipped?
8. Why does `output: "standalone"` make the image smaller?
9. Why are `package.json` and `package-lock.json` copied before the rest of the code?
10. Why must secrets never be inside an image, and how do they reach the container instead?
11. Why does `next build` succeed without any API keys?
12. Why is `DATABASE_URL` different inside Docker, and what does `localhost` mean inside a container?
13. What does `instrumentation.ts` do, and why is it safe to run on every start?
14. When the screen says "The evaluation didn't finish", where do you look first?
15. If an API key is committed to Git, why is deleting the file not enough?
