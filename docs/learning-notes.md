# Resume Evaluator: Learning Notes

> What we built, how it works, and the deployment concepts so far.
> Goal of this project: **learn real deployment on AWS EC2.** The app is the example we deploy.

---

## Where we are

```
PHASE 1: Local setup                                  ✅ done
PHASE 2: Build the app                                ✅ done
PHASE 3: Dockerize
  ✅ 3a. Dockerfile + .dockerignore + standalone build
  ✅ 3b. Auto-run database migrations on startup (instrumentation.ts)
  ⬜ 3c. Run app + database together with Docker Compose   ← continue here
PHASE 4: Deploy to EC2 by hand
PHASE 5: CI/CD with GitHub Actions
Later:   ECR, RDS, HTTPS
```

**Next command when you're back:** rebuild the image (it now includes `instrumentation.ts`):

```bash
docker build -t resume-evaluator .
```

---

## 1. What the app does

1. **Page 1:** paste a job description (JD), upload a PDF resume, and see a live preview of page 1 of the resume.
2. Click **Evaluate resume**, and the server:
   - extracts text from the PDF
   - asks the LLM to turn it into **structured data** (name, skills, experience…)
   - splits the resume into **chunks** and turns each into a **vector** (embedding)
   - saves everything in **Postgres + pgvector**
   - finds the chunks most related to the JD (**RAG retrieval**)
   - asks the LLM to **evaluate**: score, strengths, gaps, suggestions
3. **Page 2:** score card + feedback + **chat**. Each chat question also uses RAG.

## 2. Architecture (target, on EC2)

```
                         EC2 (t3.micro, 13.53.153.177)
Browser ──► port 80 ──► nginx ──► Next.js container (port 3000)
                                      │          │            │
                                      ▼          ▼            ▼
                              Postgres +     Groq API      Gemini API
                              pgvector       (LLM)         (embeddings)
                              container
                              (data on EBS)
```

| Piece | Choice | Why |
|---|---|---|
| Frontend + backend | **One Next.js app** | One container to deploy, light on 1 GB RAM |
| Database | **Postgres + pgvector in Docker** on the same EC2 | Free, teaches Docker volumes; RDS later |
| LLM | **Groq**, `openai/gpt-oss-120b` | Fast, free tier, open-weight model |
| Embeddings | **Gemini** `gemini-embedding-001`, 768 dimensions | Groq has no embeddings; API keeps the VM light |
| ORM | **Drizzle** | Built-in pgvector support (Prisma needs raw SQL for vectors) |
| Secrets | `.env.local` locally → **GitHub Secrets** in CI | Keys never in Git or in the image |
| Image registry | **GHCR** (GitHub Container Registry) | Simplest; ECR later |

## 3. Project map

```
resume-evaluator/
├── app/
│   ├── page.tsx                              Page 1 (form + preview)
│   ├── evaluation/[id]/page.tsx              Page 2 (score + feedback + chat)
│   └── api/
│       ├── evaluate/route.ts                 POST: the whole evaluation pipeline
│       └── evaluations/[id]/messages/route.ts  POST: chat
├── components/
│   ├── resume-preview.tsx                    draws PDF page 1 in the browser (pdf.js)
│   └── chat.tsx                              chat UI
├── lib/
│   ├── pdf.ts        PDF → text (server)
│   ├── chunk.ts      text → ~700-char chunks
│   ├── ai.ts         Groq + Gemini clients
│   ├── rag.ts        vector search (cosine distance)
│   └── resume.ts     prompts + JSON schemas + zod validation
├── db/
│   ├── schema.ts     3 tables (Drizzle)
│   └── index.ts      DB connection
├── drizzle/          migration SQL files (generated)
├── drizzle.config.ts settings for the drizzle-kit CLI
├── instrumentation.ts runs migrations when the server starts
├── docker-compose.yml Postgres (+ app, next step)
├── Dockerfile        how to build the app image
├── .dockerignore     what NOT to copy into the image
└── .env.local        API keys + DATABASE_URL (git-ignored, never committed)
```

**Rule:** config files (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `package.json`, `.env.local`, `drizzle.config.ts`, `instrumentation.ts`) live at the **root**, next to `package.json`. Only pages and routes go in `app/`.

---

## 4. Database concepts

### Tables

```
evaluations (1) ──< resume_chunks (many)     ← the RAG part, vector(768)
            (1) ──< messages (many)          ← chat history
```

- `id` is a **uuid** (random), so nobody can guess other people's URLs.
- **FK + cascade:** deleting an evaluation deletes its chunks and messages.
- **HNSW index** on the vectors: a "map" so similarity search doesn't compare every row.

### Vectors in one line
A vector is a list of numbers that captures *meaning*. **Small distance = similar meaning.**
`SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector` → `5.196`. RAG = "find the chunks with the smallest distance to the question".

### Migrations
- `npx drizzle-kit generate` writes SQL files in `drizzle/` from `db/schema.ts`
- `npx drizzle-kit migrate` applies the SQL files that haven't run yet
- Drizzle records applied migrations in the table `drizzle.__drizzle_migrations`, so it's **safe to run on every start**
- `0000_enable_pgvector.sql` has `CREATE EXTENSION IF NOT EXISTS vector;`. A fresh DB (like on EC2) needs it before the tables.

### Local Postgres port
Ubuntu already had its own Postgres on **5432**, so our container uses **5433 → 5432**:

```
Laptop :5432 → Ubuntu's own Postgres (leave it)
Laptop :5433 → resume-db container :5432
```

---

## 5. Docker concepts (Phase 3)

### Image vs container

```
Dockerfile ──(docker build)──► Image ──(docker run)──► Container
 (recipe)                     (sealed box)             (box switched on)
```

### Multi-stage Dockerfile: kitchen 🍳 → plate
| Stage | Job | Shipped? |
|---|---|---|
| `deps` | `npm ci`: install exact versions from the lock file | ❌ |
| `builder` | `npm run build`: creates `.next/standalone` | ❌ |
| `runner` | copies only what's needed to run, runs as a non-root user | ✅ |

### Why `output: "standalone"` (in `next.config.ts`)
Next.js copies **only the files the app actually uses** + a tiny `server.js`.
Result: **76.7 MB compressed / 307 MB on disk** instead of 1 GB+.

### Layer caching
`COPY package.json package-lock.json` → `RUN npm ci` happen **before** `COPY . .`.
If only code changes, Docker reuses the cached `npm ci` step (`Using cache`), so rebuilds are fast.

### `.dockerignore`
Keeps `node_modules`, `.next`, `.git` and **`.env*`** out of the build. **Secrets must never be baked into an image.**

### Important lines in the runner stage
| Line | Why |
|---|---|
| `HOSTNAME=0.0.0.0` | Listen on all addresses; `127.0.0.1` would be unreachable from outside the container |
| `USER nextjs` | Don't run as root, so a hacked app has less power |
| `COPY ... ./drizzle` | Migration files are inside the image so they can run on startup |
| `CMD ["node", "server.js"]` | What runs when the container starts |

---

## 6. Secrets: how `.env` values reach the app

**Secrets are NOT inside the image. They are injected when the container starts.**

```
BUILD TIME (docker build)         RUN TIME (docker run / compose up)
❌ no secrets                      ✅ secrets as environment variables
```

An image is like a zip file you share (pushed to GHCR, pulled by EC2). Anything inside it is readable.
Car 🚗 = image, key 🔑 = secrets. Ship the car anywhere; only the key holder can drive.

| Where | How secrets get in |
|---|---|
| Laptop, `npm run dev` | Next.js reads `.env.local` |
| Laptop, Docker | `docker-compose.yml` → `env_file: .env.local` |
| EC2 | a `.env` file **on the server** (never in Git), read by Compose |
| CI/CD | **GitHub Secrets** → GitHub Actions writes `.env` on EC2 over SSH |

**Why `next build` works without keys:** the Groq/Gemini clients and the DB pool are created **lazily** (on first use), not when the file is imported.

### ⚠️ `DATABASE_URL` is different inside Docker
```
Laptop:          postgresql://resume:resume_dev_pw@localhost:5433/resume_evaluator
Inside Docker:   postgresql://resume:resume_dev_pw@db:5432/resume_evaluator
```
Inside a container, `localhost` means **that container itself**. Containers reach each other by **service name** (`db`) on the **internal** port (5432).

---

## 7. Auto-migrations: `instrumentation.ts`

Next.js calls `register()` **once when the server starts**:

```
Container starts → register() → apply new migrations from ./drizzle → app serves requests
```

- Uses Drizzle's migrator from `drizzle-orm` (already in the image). `drizzle-kit` is a dev tool and isn't in the image.
- Skips the Edge runtime (`NEXT_RUNTIME !== "nodejs"`), where Postgres doesn't work.
- Logs `Database migrations applied`.

---

## 8. Lessons from bugs we hit

| Problem | Cause | Lesson |
|---|---|---|
| `zsh: command not found: CREATE` | Typed SQL into the terminal | SQL goes in `.sql` files or inside `psql`; the shell runs shell commands |
| Terminal stuck at `>` | Heredoc end marker `EOF` had spaces before it | `Ctrl + C` always gets you out |
| `address already in use :5432` | Ubuntu's own Postgres had the port | Check with `sudo ss -tlnp \| grep 5432`; map a different host port |
| Page black / wrong fonts | Dev server served a **stale** `globals.css` | `rm -rf .next` and restart `npm run dev` |
| "The evaluation didn't finish" | LLM forgot a `]`, so the JSON was invalid (`json_validate_failed`) | **Read the server log, not the UI message.** Fixed with Groq **strict `json_schema`** mode |
| GitGuardian alert | Real keys committed in an old repo's `.env.example` | Deleting the file isn't enough (Git history keeps it). **Revoke the key.** |

**Where the real errors are:**
- Local dev: the terminal running `npm run dev`, or `.next/dev/logs/next-development.log`
- Docker / EC2: `docker logs <container>` or `docker compose logs app`

---

## 9. Command cheat sheet

```bash
# Dev
npm run dev                                  # start dev server (localhost:3000)
rm -rf .next && npm run dev                  # restart with a clean cache

# Database (local, in Docker)
docker compose up -d                         # start Postgres
docker compose ps                            # status
docker exec -it resume-db psql -U resume -d resume_evaluator        # SQL shell (\q to quit)
docker exec -it resume-db psql -U resume -d resume_evaluator -c "\dt"   # list tables

# Migrations (laptop)
npx drizzle-kit generate --name=<what_changed>
npx drizzle-kit migrate

# Docker image
docker build -t resume-evaluator .           # build
docker images resume-evaluator               # size

# Git: always check before committing
git status                                   # .env.local must NOT appear
```

---

## 10. Next steps (preview)

**3c. Docker Compose with app + db**: add an `app` service to `docker-compose.yml`:
`env_file: .env.local`, override `DATABASE_URL` to use `db:5432`, map port `3000:3000`, `depends_on: db`.
Then `docker compose up -d --build` and open http://localhost:3000. This is exactly how it will run on EC2.

**Phase 4, EC2 by hand:** install Docker on EC2 → copy the compose file + `.env` → run → nginx forwards port 80 → port 3000.

**Phase 5, CI/CD:** on `git push` → GitHub Actions builds the image → pushes to GHCR → SSH to EC2 → `docker compose pull && up -d`.
