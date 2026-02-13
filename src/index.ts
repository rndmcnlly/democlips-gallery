/**
 * DemoClips Gallery — Cloudflare Worker
 *
 * A Hono app for UCSC students to share short video clips of their game
 * engine projects, organized by Canvas course/assignment.
 *
 * Stack: Hono + D1 (SQLite) + Cloudflare Stream + Google OAuth
 *
 * This file is the thin orchestrator — it creates the app, wires up
 * middleware, and mounts route modules. See AGENTS.md for the full
 * file map and guidance on where to add new features.
 */

import { Hono } from "hono";
import { Bindings, Variables } from "./types";
import { softAuth } from "./auth";
import { authRoutes } from "./auth";
import { apiRoutes } from "./api";
import { uploadKeyRoutes } from "./upload-key";
import { pageRoutes } from "./pages";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Global Middleware ──────────────────────────────────────────

app.use("*", softAuth);

// ─── Mount Route Modules ────────────────────────────────────────

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);
app.route("/", uploadKeyRoutes);
app.route("/", pageRoutes);

// ─── Export ─────────────────────────────────────────────────────

export default app;
