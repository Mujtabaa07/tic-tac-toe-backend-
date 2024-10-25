/* eslint-disable @typescript-eslint/no-require-imports */
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const migrationQuery = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'games') THEN
    CREATE TABLE games (
      id SERIAL PRIMARY KEY,
      board TEXT[] NOT NULL,
      winner TEXT,
      loser TEXT,
      mode TEXT NOT NULL DEFAULT 'pvp',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'mode') THEN
      ALTER TABLE games ADD COLUMN mode TEXT DEFAULT 'pvp';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'loser') THEN
      ALTER TABLE games ADD COLUMN loser TEXT;
    END IF;

    UPDATE games SET mode = 'pvp' WHERE mode IS NULL;
    ALTER TABLE games ALTER COLUMN mode SET NOT NULL;
  END IF;
END $$;
`;

async function migrate() {
  try {
    await pool.query(migrationQuery);
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrate();