CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  name TEXT PRIMARY KEY,
  display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  short_label TEXT NOT NULL,
  tone TEXT NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS columns (
  country TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  source_label TEXT NOT NULL,
  letter TEXT NOT NULL,
  index_position INTEGER NOT NULL,
  display_order INTEGER NOT NULL,
  PRIMARY KEY (country, key),
  FOREIGN KEY (country) REFERENCES countries(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  band_key TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  source_color TEXT,
  source_font_colors_json TEXT NOT NULL,
  source_colors_by_column_json TEXT NOT NULL,
  source_font_colors_by_column_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (country) REFERENCES countries(name) ON DELETE CASCADE,
  FOREIGN KEY (band_key) REFERENCES sections(key)
);

CREATE INDEX IF NOT EXISTS idx_programs_country_band
ON programs(country, band_key, row_number);

CREATE INDEX IF NOT EXISTS idx_programs_country_row
ON programs(country, row_number);

CREATE TABLE IF NOT EXISTS edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL,
  previous_json TEXT NOT NULL,
  next_json TEXT NOT NULL,
  edited_at TEXT NOT NULL,
  edited_by TEXT,
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
);
