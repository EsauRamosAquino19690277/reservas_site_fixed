import { db } from '../src/db.js';

function colExists(table, col){
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}

try{
  if(!colExists('publication','home_carousel')){
    db.exec(`ALTER TABLE publication ADD COLUMN home_carousel INTEGER DEFAULT 0;`);
    console.log('✔ publication.home_carousel agregado');
  } else {
    console.log('• publication.home_carousel ya existe');
  }
  if(!colExists('publication','carousel_order')){
    db.exec(`ALTER TABLE publication ADD COLUMN carousel_order INTEGER DEFAULT 0;`);
    console.log('✔ publication.carousel_order agregado');
  } else {
    console.log('• publication.carousel_order ya existe');
  }

  // extra_visit: add visited_at and slot_id if missing
  if(!colExists('extra_visit','visited_at')){
    db.exec(`ALTER TABLE extra_visit ADD COLUMN visited_at TEXT;`);
    console.log('✔ extra_visit.visited_at agregado');
  } else {
    console.log('• extra_visit.visited_at ya existe');
  }
  if(!colExists('extra_visit','slot_id')){
    db.exec(`ALTER TABLE extra_visit ADD COLUMN slot_id TEXT;`);
    console.log('✔ extra_visit.slot_id agregado');
  } else {
    console.log('• extra_visit.slot_id ya existe');
  }

}catch(e){
  console.error('Error de migración:', e.message);
  process.exit(1);
}

console.log('Migración completada');
