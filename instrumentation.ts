export async function register() {
  // Only on the Node.js server (not the Edge runtime), once per server start.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { db } = await import("@/db");

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied");
}
