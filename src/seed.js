import { db, id, initDb } from './db.js';

await initDb();

function seed(){
  // Settings por defecto
  const existing = db.prepare('SELECT id FROM site_settings WHERE id=?').get('default');
  if(!existing){
    db.prepare('INSERT INTO site_settings (id, title, navbar_color, phone, privacy_text, address, maps_embed_url) VALUES (?,?,?,?,?,?,?)')
      .run('default', 'Turismo Reservas', '#1b8f3a', '+52 81 1234 5678', '© Todos los derechos reservados. Privacidad: tus datos se usan solo para gestionar reservas.', 'Parque Nacional, S/N, Sierra Verde', 'https://www.google.com/maps/embed?pb=!1m18!');
  }

  const actId = id();
  db.prepare('INSERT INTO activity (id,name,description,location,base_price,media_json,policy) VALUES (?,?,?,?,?,?,?)')
    .run(actId, 'Recorrido Cascadas', 'Tour guiado por las cascadas locales.', 'Sierra Verde', 25000, JSON.stringify(['/img/cascada1.jpg','/img/cascada2.jpg']), 'Llegar 15 min antes. Calzado cómodo.');

  const now = new Date();
  const day = new Date(now.getTime() + 24*3600*1000);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0).toISOString();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0).toISOString();
  db.prepare('INSERT INTO schedule_slot (id,activity_id,start_at,end_at,capacity_total,capacity_reserved,price_cents,published) VALUES (?,?,?,?,?,?,?,?)')
    .run(id(), actId, start, end, 25, 0, 25000, 1);

  db.prepare('INSERT INTO publication (id,title,body,hero_url,is_linked,activity_id,published) VALUES (?,?,?,?,?,?,?)')
    .run(id(), '¡Descubre las Cascadas!', 'Un paraíso natural para toda la familia.', '/img/cascada1.jpg', 1, actId, 1);

  const hasHistoria = db.prepare('SELECT slug FROM page WHERE slug=?').get('historia');
  if(!hasHistoria){
    db.prepare('INSERT INTO page (slug,title,body,media_json) VALUES (?,?,?,?)')
      .run('historia', 'Nuestra Historia', 'Somos una empresa familiar dedicada al ecoturismo en la Sierra Verde.', JSON.stringify(['/img/cascada1.jpg']));
  }

  console.log('Base de datos sembrada con datos de ejemplo.');
}
seed();
