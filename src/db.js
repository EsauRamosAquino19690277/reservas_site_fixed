import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const db = new Database(path.join(__dirname, '..', 'data.sqlite'));

export function id(){ return randomUUID(); }


export function initDb(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      location TEXT,
      base_price INTEGER DEFAULT 0,
      media_json TEXT,
      policy TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS visit_history (
    id TEXT PRIMARY KEY,
    reservation_id TEXT,
    record_at TEXT DEFAULT CURRENT_TIMESTAMP,
    activity_id TEXT,
    activity_name TEXT,
    slot_id TEXT,
    start_at TEXT,
    people_json TEXT,
    phone TEXT,
    email TEXT,
    pay_method TEXT,
    amount_cents INTEGER,
    notes TEXT
  );
    CREATE TABLE IF NOT EXISTS schedule_slot (
      id TEXT PRIMARY KEY,
      activity_id TEXT,
      start_at TEXT,
      end_at TEXT,
      capacity_total INTEGER,
      capacity_reserved INTEGER DEFAULT 0,
      price_cents INTEGER DEFAULT 0,
      published INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS publication (
      id TEXT PRIMARY KEY,
      title TEXT,
      body TEXT,
      hero_url TEXT,
      video_url TEXT,
      is_linked INTEGER DEFAULT 0,
      activity_id TEXT,
      cta_label TEXT,
      cta_url TEXT,
      published INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
      CREATE TABLE IF NOT EXISTS experience_post (
      id TEXT PRIMARY KEY,
      title TEXT,
      body TEXT,
      media_url TEXT,
      media_type TEXT,
      activity_id TEXT,
      status TEXT DEFAULT 'pending',            -- pending | approved | rejected
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT
    );
        CREATE TABLE IF NOT EXISTS survey_form (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      external_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS survey_question (
      id TEXT PRIMARY KEY,
      survey_id TEXT,
      position INTEGER,
      text TEXT,
      kind TEXT, -- 'choice' o 'open'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS survey_option (
      id TEXT PRIMARY KEY,
      question_id TEXT,
      position INTEGER,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS survey_response (
      id TEXT PRIMARY KEY,
      survey_id TEXT,
      name TEXT,
      experience TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS survey_answer (
      id TEXT PRIMARY KEY,
      response_id TEXT,
      question_id TEXT,
      option_id TEXT,
      text_value TEXT
    );

        CREATE TABLE IF NOT EXISTS reservation (
      id TEXT PRIMARY KEY,
      slot_id TEXT,
      activity_id TEXT,
      holder_name TEXT,
      phone TEXT,
      email TEXT,
      party_size INTEGER,
      companions TEXT,
      notes TEXT,
      pay_method TEXT,
      amount_cents INTEGER,
      status TEXT DEFAULT 'pending',
      checkin_code TEXT,
      paid_email_sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS survey (
      token TEXT PRIMARY KEY,
      reservation_id TEXT,
      rating INTEGER,
      liked TEXT,
      improve TEXT,
      visited_more TEXT,
      recommend TEXT,
      comments TEXT,
      sent_at TEXT,
      answered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS extra_visit (
      id TEXT PRIMARY KEY,
      reservation_id TEXT,
      activity_id TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      id TEXT PRIMARY KEY,
      title TEXT,
      logo_url TEXT,
      navbar_color TEXT,
      phone TEXT,
      facebook_url TEXT,
      instagram_url TEXT,
      tiktok_url TEXT,
      privacy_text TEXT,
      address TEXT,
      maps_embed_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
     CREATE TABLE IF NOT EXISTS bank_settings (
      id TEXT PRIMARY KEY,
      bank_name TEXT,
      bank_account TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS page (
      slug TEXT PRIMARY KEY,
      title TEXT,
      body TEXT,
      media_json TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contact_message (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

    const pageCols = db.prepare('PRAGMA table_info(page)').all().map(c => c.name);

  if (!pageCols.includes('subtitle1')) {
    db.exec('ALTER TABLE page ADD COLUMN subtitle1 TEXT');
  }
  if (!pageCols.includes('subtitle2')) {
    db.exec('ALTER TABLE page ADD COLUMN subtitle2 TEXT');
  }
  if (!pageCols.includes('body2')) {
    db.exec('ALTER TABLE page ADD COLUMN body2 TEXT');
  }
    // Asegurar columnas nuevas en reservation (para proyectos viejos)
  const resCols = db.prepare('PRAGMA table_info(reservation)').all().map(c => c.name);
  if (!resCols.includes('checkin_code')) {
    db.exec('ALTER TABLE reservation ADD COLUMN checkin_code TEXT');
  }
  if (!resCols.includes('paid_email_sent_at')) {
    db.exec('ALTER TABLE reservation ADD COLUMN paid_email_sent_at TEXT');
  }
  if (!resCols.includes('checked_in_at')) {
    db.exec('ALTER TABLE reservation ADD COLUMN checked_in_at TEXT');
  }
}


export function releaseCapacity(slotId, qty){
  const s = db.prepare('SELECT capacity_reserved FROM schedule_slot WHERE id=?').get(slotId);
  if(!s) return;
  const newVal = Math.max(0, (s.capacity_reserved||0) - qty);
  db.prepare('UPDATE schedule_slot SET capacity_reserved=? WHERE id=?').run(newVal, slotId);
}

export function autoExpirePending(){
  // Aquí podrías cambiar reservas pending a expired según tiempo, si quieres.
  return;
}

initDb();
