-- Phase 7: published customer-facing releases and download assets.

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  release_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, version),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS release_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  download_url TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_releases_product_status ON releases(product_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_release_assets_release ON release_assets(release_id);