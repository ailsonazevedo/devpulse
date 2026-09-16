import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url().default("http://localhost:3000"),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GITLAB_CLIENT_ID: z.string().optional().default(""),
  GITLAB_CLIENT_SECRET: z.string().optional().default(""),
  AZURE_CLIENT_ID: z.string().optional().default(""),
  AZURE_CLIENT_SECRET: z.string().optional().default(""),
});

export const env = schema.parse({
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_URL: process.env.AUTH_URL,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GITLAB_CLIENT_ID: process.env.GITLAB_CLIENT_ID,
  GITLAB_CLIENT_SECRET: process.env.GITLAB_CLIENT_SECRET,
  AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
});

export const isDev = process.env.NODE_ENV !== "production";
