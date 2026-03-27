PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS qr_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_qr TEXT NOT NULL,
    second_qr TEXT NOT NULL,
    created_at TEXT NOT NULL,
    operator_name TEXT DEFAULT '',
    note TEXT DEFAULT '',
    CHECK (length(trim(first_qr)) > 0),
    CHECK (length(trim(second_qr)) > 0),
    CHECK (first_qr <> second_qr),
    UNIQUE (first_qr, second_qr)
);

CREATE TABLE IF NOT EXISTS used_qr_codes (
    qr_value TEXT PRIMARY KEY,
    match_id INTEGER NOT NULL,
    qr_role TEXT NOT NULL CHECK (qr_role IN ('first', 'second')),
    FOREIGN KEY (match_id) REFERENCES qr_matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
    settings_key TEXT PRIMARY KEY,
    settings_value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_matches_created_at
    ON qr_matches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_matches_first_qr
    ON qr_matches (first_qr);

CREATE INDEX IF NOT EXISTS idx_qr_matches_second_qr
    ON qr_matches (second_qr);

INSERT OR IGNORE INTO app_settings (settings_key, settings_value)
VALUES
    ('first_qr_length', '0'),
    ('second_qr_length', '0');
