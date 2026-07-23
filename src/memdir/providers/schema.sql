-- Memory provider SQLite schema

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT,
  scope TEXT DEFAULT 'private',
  content TEXT NOT NULL,
  file_path TEXT,
  mtime_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  name,
  description,
  content,
  content='memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, name, description, content)
  VALUES (NEW.rowid, NEW.name, NEW.description, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, name, description, content)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, name, description, content)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.content);
  INSERT INTO memories_fts(rowid, name, description, content)
  VALUES (NEW.rowid, NEW.name, NEW.description, NEW.content);
END;

-- Skill usage tracking (for skill lifecycle)
CREATE TABLE IF NOT EXISTS skill_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  invoked_at INTEGER NOT NULL,
  success INTEGER,
  feedback TEXT
);

-- Skill self-improvement history
CREATE TABLE IF NOT EXISTS skill_improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  section TEXT NOT NULL,
  change TEXT NOT NULL,
  reason TEXT,
  applied_at INTEGER NOT NULL,
  reverted_at INTEGER
);

-- Skill lifecycle states
CREATE TABLE IF NOT EXISTS skill_states (
  skill_name TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'active',  -- active, archived, developing
  archived_at INTEGER,
  archive_reason TEXT,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_mtime ON memories(mtime_ms DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_states_state ON skill_states(state);