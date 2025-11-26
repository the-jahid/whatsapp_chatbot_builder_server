// prisma.config.ts (in the root folder)
import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // required when using datasource in config (and for Prisma 7)
  engine: "classic",

  // where your schema file lives
  schema: path.join("prisma", "schema.prisma"),

  // optional but good to set
  migrations: {
    path: path.join("prisma", "migrations"),
  },

  // this replaces `url = env("DATABASE_URL")` in schema.prisma
  datasource: {
    url: env("DATABASE_URL"),
  },
});
