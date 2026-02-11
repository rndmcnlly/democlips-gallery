-- DemoClips Gallery — D1 Schema
-- Run with: wrangler d1 execute democlips-gallery --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- Google 'sub' claim
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  picture TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,              -- Cloudflare Stream video UID
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL,          -- from URL: canvas-{courseId}
  assignment_id TEXT NOT NULL,      -- from URL: assignment-{assignmentId}
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration REAL,                    -- seconds, filled on first gallery view after processing
  thumbnail_pct REAL DEFAULT 0.5,
  hidden INTEGER NOT NULL DEFAULT 0, -- 1 = hidden by moderator
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_videos_assignment ON videos(course_id, assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id);

CREATE TABLE IF NOT EXISTS stars (
  user_id TEXT NOT NULL REFERENCES users(id),
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
) STRICT;
