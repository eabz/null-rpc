-- Migration number: 0001 	 2025-12-28T19:33:00.000Z
DROP TABLE IF EXISTS chains;

CREATE TABLE chains (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL, -- e.g. 'eth'
  chainId INTEGER,
  nodes TEXT, -- JSON array of standard nodes
  archive_nodes TEXT, -- JSON array of archive nodes
  mev_protection TEXT, -- string URL or JSON
  icon TEXT,
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_chains_slug ON chains(slug);
