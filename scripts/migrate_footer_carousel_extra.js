
import { db } from '../src/db.js';

function colExists(table, col){
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}
function settingEnsure(key, value){
  db.prepare(`INSERT INTO site_settings (key,value) VALUES (?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

try{
  if(!colExists('publication','home_carousel')){
    db.exec(`ALTER TABLE publication ADD COLUMN home_carousel INTEGER DEFAULT 0;`);
    console.log('✔ publication.home_carousel agregado');
  }
  if(!colExists('publication','carousel_order')){
    db.exec(`ALTER TABLE publication ADD COLUMN carousel_order INTEGER DEFAULT 0;`);
    console.log('✔ publication.carousel_order agregado');
  }
  if(!colExists('extra_visit','visited_at')){
    db.exec(`ALTER TABLE extra_visit ADD COLUMN visited_at TEXT;`);
    console.log('✔ extra_visit.visited_at agregado');
  }
  // Ensure site settings
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT)`);
  }catch{}
  settingEnsure('footer_bg_color', '#146c2e');
}catch(e){
  console.error('Error de migración:', e.message);
  process.exit(1);
}
console.log('Migración OK');
