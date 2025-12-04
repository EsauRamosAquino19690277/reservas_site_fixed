// src/routes/admin.js
import express from 'express';
import { db, id, releaseCapacity, autoExpirePending } from '../db.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import nodemailer from 'nodemailer';

const MAX_FILE_SIZE = 80 * 1024 * 1024; // 80 MB

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Tamaño de página para listados del panel de administración
const ADMIN_PAGE_SIZE = 10;

function getPage(req) {
  const raw = parseInt(req.query.page || '1', 10);
  if (Number.isNaN(raw) || raw < 1) return 1;
  return raw;
}

// ---- Email de confirmación de pago ----
// Transport de correo. Si no hay SMTP configurado, simplemente no envía nada.
let mailTransport = null;
if (process.env.SMTP_HOST) {
  mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true para 465, false para 587/25
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  });
}

// Código tipo "ABCD-EFGH" difícil de adivinar y único
function generateCheckinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0,1,O,I
  while (true) {
    let raw = '';
    for (let i = 0; i < 8; i++) {
      raw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = raw.slice(0, 4) + '-' + raw.slice(4);
    const exists = db.prepare('SELECT 1 FROM reservation WHERE checkin_code=? LIMIT 1').get(code);
    if (!exists) return code;
  }
}

function sendPaymentConfirmationEmail(reservation, code) {
  if (!mailTransport) return;          // no hay SMTP configurado
  if (!reservation.email) return;      // la reserva no tiene correo

  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com';
  const amount = (reservation.amount_cents || 0) / 100;
  const dateStr = reservation.start_at
    ? dayjs(reservation.start_at).format('DD/MM/YYYY HH:mm')
    : '';

  const html = `S
    <p>Hola <strong>${reservation.holder_name || ''}</strong>,</p>
    <p>Tu pago ha sido <strong>confirmado</strong> para la siguiente reserva:</p>
    <ul>
      <li><strong>Actividad:</strong> ${reservation.act_name || ''}</li>
      <li><strong>Código de reserva:</strong> ${reservation.id}</li>
      <li><strong>Horario:</strong> ${dateStr}</li>
      <li><strong>Personas:</strong> ${reservation.party_size || 1}</li>
      <li><strong>Monto pagado:</strong> $ ${amount.toFixed(2)} MXN</li>
    </ul>
    <p>Tu <strong>código de acceso</strong> es:</p>
    <h2 style="letter-spacing:3px;font-family:monospace;">${code}</h2>
    <p>Guarda este correo y muéstralo al llegar al paraje.</p>
    <p>El personal puede verificar este código directamente en el sistema de reservas.</p>
  `;

  mailTransport.sendMail(
    {
      to: reservation.email,
      from,
      subject: `Confirmación de pago - Reserva ${reservation.id}`,
      html,
    },
    (err) => {
      if (err) {
        console.error('Error al enviar correo de confirmación de pago', err);
        return;
      }
      try {
        db.prepare('UPDATE reservation SET paid_email_sent_at = CURRENT_TIMESTAMP WHERE id=?').run(
          reservation.id,
        );
      } catch (e) {
        console.error('Error guardando paid_email_sent_at', e);
      }
    },
  );
}


// ---- Subidas (imágenes / video) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safe) || '';
    cb(null, unique + ext.toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  if (/image\//.test(file.mimetype) || /video\//.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ---- Auth mínima ----
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

router.get('/login', (req, res) => res.render('admin/login', { title: 'Admin - Login', error: null }));
router.post('/login', (req, res) => {
  const pass = req.body.password || '';
  if (pass === (process.env.ADMIN_PASSWORD || 'admin123')) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { title: 'Admin - Login', error: 'Clave incorrecta' });
});

router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// ---- Dashboard ----
// NO usamos r.activity_id. Juntamos reservation -> schedule_slot -> activity
router.get('/', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM reservation').get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const upcoming = db.prepare(`
    SELECT r.*, a.name AS act_name, s.start_at, s.end_at
    FROM reservation r
    JOIN schedule_slot s ON s.id = r.slot_id
    JOIN activity a ON a.id = s.activity_id
    ORDER BY datetime(s.start_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/dashboard', {
    title: 'Admin - Panel',
    upcoming,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/admin' }
  });
});

// ---- Ajustes del sitio ----
// POST /ajustes
router.post('/ajustes', requireAdmin, upload.single('logo_file'), (req, res) => {
  const {
    title = '',
    navbar_color = '',
    phone = '',
    facebook_url = '',
    instagram_url = '',
    tiktok_url = '',
    privacy_text = '',
    address = '',
    maps_embed_url = ''
  } = req.body;

  const logo_url = req.file ? ('/uploads/' + req.file.filename) : '';
  const maps = (typeof maps_embed_url === 'string' &&
                maps_embed_url.startsWith('https://www.google.com/maps/embed?'))
               ? maps_embed_url : '';

  const row = db.prepare('SELECT id FROM site_settings WHERE id=?').get('default');

  if (row) {
    db.prepare(`
      UPDATE site_settings
         SET title = ?,
             navbar_color = ?,
             phone = ?,
             facebook_url = ?,
             instagram_url = ?,
             tiktok_url = ?,
             privacy_text = ?,
             address = ?,
             maps_embed_url = ?,
             logo_url = COALESCE(NULLIF(?, ''), logo_url)
       WHERE id = 'default'
    `).run(
      title, navbar_color, phone,
      facebook_url, instagram_url, tiktok_url,
      privacy_text, address, maps,
      logo_url
    );
  } else {
    db.prepare(`
      INSERT INTO site_settings
      (id, title, navbar_color, phone, facebook_url, instagram_url, tiktok_url, privacy_text, address, maps_embed_url, logo_url)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title, navbar_color, phone,
      facebook_url, instagram_url, tiktok_url,
      privacy_text, address, maps, logo_url
    );
  }

  res.redirect('/admin/ajustes');
});

router.get('/ajustes', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM site_settings WHERE id=?').get('default') || {};
  res.render('admin/settings', { title: 'Admin - Ajustes', s: row });
});

// ---- Datos bancarios (depósitos) ----
router.get('/banco', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM bank_settings WHERE id=?').get('default') || {};
  res.render('admin/bank_settings', { title: 'Admin - Datos bancarios', b: row });
});

router.post('/banco', requireAdmin, (req, res) => {
  const { bank_name, bank_account } = req.body;
  const existing = db.prepare('SELECT id FROM bank_settings WHERE id=?').get('default');

  if (existing) {
    db.prepare(`
      UPDATE bank_settings
         SET bank_name = ?,
             bank_account = ?
       WHERE id = 'default'
    `).run(bank_name || '', bank_account || '');
  } else {
    db.prepare(`
      INSERT INTO bank_settings (id, bank_name, bank_account)
      VALUES ('default', ?, ?)
    `).run(bank_name || '', bank_account || '');
  }

  res.redirect('/admin/banco');
});


// ---- Páginas (Historia) ----
router.get('/paginas', requireAdmin, (req, res) => {
  const historia = db.prepare('SELECT * FROM page WHERE slug=?').get('historia');
  res.render('admin/pages', { title: 'Admin - Páginas', historia });
});

router.post('/paginas/historia', requireAdmin, upload.array('media_files', 12), (req, res) => {
  const { title, subtitle1, body, subtitle2, body2, media_json } = req.body;

  let media = [];
  if (req.files && req.files.length) {
    media = req.files.map(f => '/uploads/' + f.filename);
  } else if (media_json) {
    try {
      media = JSON.parse(media_json);
    } catch {
      media = [];
    }
  }

  const exists = db.prepare('SELECT slug FROM page WHERE slug=?').get('historia');

  if (exists) {
    db.prepare(`
      UPDATE page
         SET title      = ?,
             subtitle1  = ?,
             body       = ?,
             subtitle2  = ?,
             body2      = ?,
             media_json = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE slug = ?
    `).run(
      title,
      subtitle1 || null,
      body || '',
      subtitle2 || null,
      body2 || '',
      JSON.stringify(media),
      'historia'
    );
  } else {
    db.prepare(`
      INSERT INTO page (slug, title, subtitle1, body, subtitle2, body2, media_json)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      'historia',
      title,
      subtitle1 || null,
      body || '',
      subtitle2 || null,
      body2 || '',
      JSON.stringify(media)
    );
  }

  res.redirect('/admin/paginas');
});


const requireAdminPub = (typeof requireAdmin === 'function')
  ? requireAdmin
  : (req, res, next) => {
      if (req.session && req.session.isAdmin) return next();
      return res.redirect('/admin/login');
    };


const uploadAny = (typeof upload !== 'undefined' && upload?.fields)
  ? upload
  : { fields: () => (req, res, next) => next() };

// ---- Publicaciones ----
router.get('/publicaciones', requireAdmin, (req, res) => {
  const pubs = db.prepare(`
    SELECT id, title, body, hero_url, video_url, is_linked, activity_id, cta_label, cta_url,
           published, COALESCE(home_carousel,0) AS home_carousel, COALESCE(carousel_order,0) AS carousel_order
      FROM publication
     ORDER BY created_at DESC
  `).all();
  res.render('admin/publications', { title: 'Admin - Publicaciones', pubs });
});
// CREAR publicación
router.post(
  '/publicaciones',
  requireAdmin,
  upload.fields([
    { name: 'hero_files', maxCount: 10 },   // varias imágenes
    { name: 'video_file', maxCount: 1 }     // un solo video
  ]),
  (req, res) => {
    const title = (req.body.title || '').trim();
    const body  = (req.body.body  || '').trim();

    // Soporta mode=solo|link y compatibilidad con is_linked=0|1
    const mode = (req.body.mode || req.body.type || '').toLowerCase();
    let is_linked = (mode === 'link' || mode === 'enlaza' || mode === 'link_activity');
    if (req.body.is_linked !== undefined) {
      is_linked = (req.body.is_linked === '1' || req.body.is_linked === 'true');
    }

    const activity_id = is_linked ? (req.body.activity_id || null) : null;
    const cta_label   = is_linked ? (req.body.cta_label   || '')  : '';
    let   cta_url     = is_linked ? (req.body.cta_url     || '')  : '';

    if (is_linked && activity_id && !cta_url) {
      cta_url = `/actividad/${activity_id}`;
    }

    const published      = (req.body.published === '1' || req.body.published === 'on');
    const home_carousel  = req.body.home_carousel ? 1 : 0;
    const carousel_order = parseInt(req.body.carousel_order || '0', 10);

    // ----- Imágenes -----
    const images = [];

    const heroFromUrl = (req.body.hero_url || '').trim();
    if (heroFromUrl) images.push(heroFromUrl);

    if (req.files && req.files.hero_files && req.files.hero_files.length) {
      req.files.hero_files.forEach(f => {
        images.push('/uploads/' + f.filename);
      });
    }

    let heroPath = '';
    if (images.length === 1) {
      heroPath = images[0];               // compat: una sola ruta
    } else if (images.length > 1) {
      heroPath = JSON.stringify(images);  // varias imágenes guardadas como JSON
    }

    // ----- Video -----
    let videoPath = (req.body.video_url || '').trim();
    if (req.files?.video_file?.[0]) {
      videoPath = '/uploads/' + req.files.video_file[0].filename;
    }

    db.prepare(`
      INSERT INTO publication
        (id, title, body, hero_url, video_url, is_linked, activity_id, cta_label, cta_url, published, home_carousel, carousel_order)
      VALUES
        (?,  ?,     ?,    ?,        ?,         ?,         ?,           ?,         ?,       ?,         ?,              ?)
    `).run(
      id(),
      title,
      body,
      heroPath,
      videoPath,
      is_linked ? 1 : 0,
      activity_id,
      cta_label,
      cta_url,
      published ? 1 : 0,
      home_carousel,
      carousel_order
    );

    res.redirect('/admin/publicaciones');
  }
);


// Activar / desactivar que una publicación aparezca en el carousel de Home
router.post('/publicaciones/:id/toggle-home', requireAdmin, (req, res) => {
  const pub = db.prepare('SELECT id, home_carousel FROM publication WHERE id=?').get(req.params.id);
  if (!pub) {
    return res.redirect('/admin/publicaciones');
  }

  const newValue = pub.home_carousel ? 0 : 1;
  db.prepare('UPDATE publication SET home_carousel=? WHERE id=?').run(newValue, req.params.id);

  res.redirect('/admin/publicaciones');
});

// (opcional) eliminar
router.post('/publicaciones/:id/delete', requireAdmin, (req,res)=>{
  db.prepare('DELETE FROM publication WHERE id=?').run(req.params.id);
  res.redirect('/admin/publicaciones');
});

// ---- Actividades ----
router.get('/actividades', requireAdmin, (req, res) => {
  const acts = db.prepare('SELECT * FROM activity ORDER BY created_at DESC').all();
  res.render('admin/activities', { title: 'Admin - Actividades', acts });
});

router.post('/actividades', requireAdmin, upload.array('media_files', 12), (req, res) => {
  const { name, description, location, base_price, media_json, policy } = req.body;
  let mediaList = [];
  if (req.files && req.files.length) mediaList = req.files.map(f => '/uploads/' + f.filename);
  else if (media_json) { try { mediaList = JSON.parse(media_json); } catch { mediaList = []; } }

  db.prepare('INSERT INTO activity (id,name,description,location,base_price,media_json,policy) VALUES (?,?,?,?,?,?,?)')
    .run(id(), name, description || '', location || '', parseInt(base_price || '0', 10), JSON.stringify(mediaList), policy || '');
  res.redirect('/admin/actividades');
});

router.post('/actividades/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM activity WHERE id=?').run(req.params.id);
  res.redirect('/admin/actividades');
});

// ---- Horarios ----
router.get('/slots/:actId', requireAdmin, (req, res) => {
  const act = db.prepare('SELECT * FROM activity WHERE id=?').get(req.params.actId);
  const slots = db.prepare('SELECT * FROM schedule_slot WHERE activity_id=? ORDER BY start_at').all(req.params.actId);
  res.render('admin/slots', { title: 'Admin - Horarios', act, slots });
});

router.post('/slots/:actId', requireAdmin, (req, res) => {
  const { start_at, end_at, capacity_total, price_cents, published } = req.body;
  db.prepare('INSERT INTO schedule_slot (id,activity_id,start_at,end_at,capacity_total,capacity_reserved,price_cents,published) VALUES (?,?,?,?,?,?,?,?)')
    .run(id(), req.params.actId, start_at, end_at, parseInt(capacity_total, 10), 0, parseInt(price_cents || '0', 10), published ? 1 : 0);
  res.redirect('/admin/slots/' + req.params.actId);
});

router.post('/slots/:slotId/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM schedule_slot WHERE id=?').run(req.params.slotId);
  res.redirect('back');
});

// ---- Reservas ----
// (Todas las consultas obtienen la actividad a partir del slot)
router.get('/reservas', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM reservation').get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const list = db.prepare(`
    SELECT r.*, a.name AS act_name, s.start_at, s.end_at
    FROM reservation r
    JOIN schedule_slot s ON s.id = r.slot_id
    JOIN activity a ON a.id = s.activity_id
    ORDER BY datetime(s.start_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/reservations', {
    title: 'Admin - Reservas',
    list,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/admin/reservas' }
  });
});


router.get('/reservas/:id', requireAdmin, (req, res) => {
  const r = db.prepare(`
    SELECT r.*, a.name AS act_name, s.start_at, s.end_at, s.id AS slot_id
    FROM reservation r
    JOIN schedule_slot s ON s.id = r.slot_id
    JOIN activity a ON a.id = s.activity_id
    WHERE r.id = ?
  `).get(req.params.id);
  const acts = db.prepare('SELECT * FROM activity ORDER BY name').all();
  res.render('admin/reservation_detail', { title: 'Admin - Reserva', r, acts, dayjs });
});

router.post('/reservas/:id/confirm', requireAdmin, (req, res) => {
  const r = db.prepare(`
    SELECT r.*, a.name AS act_name, s.start_at, s.id AS slot_id
    FROM reservation r
    JOIN schedule_slot s ON s.id = r.slot_id
    JOIN activity a ON a.id = s.activity_id
    WHERE r.id = ?
  `).get(req.params.id);

  if (r) {
    // 1) generar / conservar código de acceso
    let code = r.checkin_code;
    if (!code) {
      code = generateCheckinCode();
      db.prepare('UPDATE reservation SET status=?, checkin_code=? WHERE id=?').run(
        'paid',
        code,
        req.params.id,
      );
    } else {
      db.prepare('UPDATE reservation SET status=? WHERE id=?').run('paid', req.params.id);
    }

    // 2) registrar en historial (igual que antes)
    try {
      const people = [];
      if (r.holder_name) people.push({ name: r.holder_name, age_band: null });
      if (r.companions) {
        String(r.companions)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((n) => people.push({ name: n, age_band: null }));
      }

      db.prepare(`
        INSERT INTO visit_history
          (id, reservation_id, activity_id, activity_name, slot_id, start_at, people_json, phone, email, pay_method, amount_cents, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id(),
        r.id,
        r.activity_id,
        r.act_name,
        r.slot_id,
        r.start_at,
        JSON.stringify(people),
        r.phone || '',
        r.email || '',
        r.pay_method || 'deposit',
        r.amount_cents || 0,
        r.notes || '',
      );
    } catch (e) {
      console.error('historial insert error', e);
    }

    // 3) enviar correo de confirmación de pago (solo una vez)
    try {
      if (!r.paid_email_sent_at) {
        sendPaymentConfirmationEmail({ ...r, checkin_code: code }, code);
      }
    } catch (e) {
      console.error('Error al enviar email de pago', e);
    }
  }

  res.redirect('/admin/reservas/' + req.params.id);
});


router.post('/reservas/:id/cancel', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reservation WHERE id=?').get(req.params.id);
  if (r) {
    releaseCapacity(r.slot_id, r.party_size || 1);
    db.prepare('UPDATE reservation SET status=? WHERE id=?').run('canceled', r.id);
  }
  res.redirect('/admin/reservas/' + req.params.id);
});

router.post('/reservas/:id/extra', requireAdmin, (req, res) => {
  const { activity_id, note } = req.body;
  db.prepare('INSERT INTO extra_visit (id,reservation_id,activity_id,note,visited_at) VALUES (?,?,?,?,?)')
    .run(id(), req.params.id, activity_id, note || '', (req.body.visited_at || null));
  res.redirect('/admin/reservas/' + req.params.id);
});

// ---- Check-in por código de acceso ----
router.get('/checkin', requireAdmin, (req, res) => {
  const rawCode = (req.query.code || '').trim();
  const code = rawCode.toUpperCase();
  let result = null;
  let error = null;

  if (code) {
    const r = db.prepare(`
      SELECT r.*, a.name AS act_name, s.start_at, s.end_at
      FROM reservation r
      JOIN schedule_slot s ON s.id = r.slot_id
      JOIN activity a ON a.id = s.activity_id
      WHERE UPPER(r.checkin_code) = ?
      LIMIT 1
    `).get(code);

    if (!r) {
      error = 'No se encontró una reserva con ese código.';
    } else if (r.status !== 'paid') {
      error = 'La reserva existe pero todavía no está marcada como pagada.';
      result = r;
    } else {
      result = r;
    }
  }

  res.render('admin/checkin', {
    title: 'Admin - Check-in',
    code: rawCode,
    r: result,
    error,
    dayjs
  });
});

router.post('/checkin/:id/marcar-usado', requireAdmin, (req, res) => {
  const code = (req.body.code || '').trim();
  db.prepare('UPDATE reservation SET checked_in_at = CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  res.redirect('/admin/checkin?code=' + encodeURIComponent(code));
});

// ---- Encuestas dinámicas ----

// Lista encuestas activas
router.get('/encuestas', requireAdmin, (req, res) => {
  const surveys = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM survey_response r WHERE r.survey_id = f.id) AS response_count
    FROM survey_form f
    WHERE f.is_active = 1
    ORDER BY datetime(f.created_at) DESC
  `).all();

  res.render('admin/surveys_active', {
    title: 'Admin - Encuestas activas',
    surveys,
    dayjs
  });
});

// Historial de encuestas cerradas
router.get('/encuestas/historial', requireAdmin, (req, res) => {
  const surveys = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM survey_response r WHERE r.survey_id = f.id) AS response_count
    FROM survey_form f
    WHERE f.is_active = 0
    ORDER BY datetime(f.closed_at) DESC, datetime(f.created_at) DESC
  `).all();

  res.render('admin/surveys_archive', {
    title: 'Admin - Encuestas concluidas',
    surveys,
    dayjs
  });
});

// Formulario nueva encuesta
router.get('/encuestas/nueva', requireAdmin, (req, res) => {
  res.render('admin/survey_new', {
    title: 'Admin - Nueva encuesta',
    error: null,
    form: {}
  });
});

// Crear encuesta (POST)
router.post('/encuestas/nueva', requireAdmin, (req, res) => {
  const { title, description, external_url } = req.body;
  const formData = { ...req.body };

  if (!title || !title.trim()) {
    return res.render('admin/survey_new', {
      title: 'Admin - Nueva encuesta',
      error: 'El título es obligatorio.',
      form: formData
    });
  }

  const external = (external_url || '').trim();

  // Si tiene URL externa, no usamos preguntas
  if (external) {
    const sid = id();
    db.prepare(`
      INSERT INTO survey_form (id, title, description, external_url, is_active)
      VALUES (?,?,?,?,1)
    `).run(
      sid,
      title.trim(),
      (description || '').trim(),
      external
    );
    return res.redirect('/admin/encuestas');
  }

  // Construir preguntas (máx 15, mín 5)
  const questions = [];
  for (let i = 1; i <= 15; i++) {
    const text = (req.body[`q_text_${i}`] || '').trim();
    if (!text) continue;
    const kind = (req.body[`q_type_${i}`] || 'choice') === 'open' ? 'open' : 'choice';
    const opts = [];

    if (kind === 'choice') {
      for (let j = 1; j <= 5; j++) {
        const label = (req.body[`q_opt_${i}_${j}`] || '').trim();
        if (label) opts.push(label);
      }
      // al menos 2 opciones para que tenga sentido
      if (opts.length < 2) {
        return res.render('admin/survey_new', {
          title: 'Admin - Nueva encuesta',
          error: `La pregunta ${i} es de opción múltiple y necesita al menos 2 respuestas.`,
          form: formData
        });
      }
    }

    questions.push({ index: i, text, kind, opts });
  }

  if (questions.length < 5) {
    return res.render('admin/survey_new', {
      title: 'Admin - Nueva encuesta',
      error: 'Debes definir al menos 5 preguntas con texto.',
      form: formData
    });
  }

  const sid = id();
  db.prepare(`
    INSERT INTO survey_form (id, title, description, external_url, is_active)
    VALUES (?,?,?,?,1)
  `).run(
    sid,
    title.trim(),
    (description || '').trim(),
    null
  );

  const insertQ = db.prepare(`
    INSERT INTO survey_question (id, survey_id, position, text, kind)
    VALUES (?,?,?,?,?)
  `);
  const insertO = db.prepare(`
    INSERT INTO survey_option (id, question_id, position, label)
    VALUES (?,?,?,?)
  `);

  questions.forEach((q, idx) => {
    const qid = id();
    insertQ.run(qid, sid, idx + 1, q.text, q.kind);
    if (q.kind === 'choice') {
      q.opts.forEach((label, j) => {
        insertO.run(id(), qid, j + 1, label);
      });
    }
  });

  res.redirect('/admin/encuestas');
});

// Cerrar encuesta
router.post('/encuestas/:id/cerrar', requireAdmin, (req, res) => {
  db.prepare(`
    UPDATE survey_form
       SET is_active = 0,
           closed_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `).run(req.params.id);
  res.redirect('/admin/encuestas');
});

// Ver resultados de una encuesta
router.get('/encuestas/:id', requireAdmin, (req, res) => {
  const survey = db.prepare(`
    SELECT *
      FROM survey_form
     WHERE id = ?
  `).get(req.params.id);

  if (!survey) {
    return res.status(404).send('Encuesta no encontrada');
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS c
      FROM survey_response
     WHERE survey_id = ?
  `).get(survey.id);
  const totalResponses = totalRow ? totalRow.c : 0;

  const questions = db.prepare(`
    SELECT *
      FROM survey_question
     WHERE survey_id = ?
     ORDER BY position ASC
  `).all(survey.id);

  const qOptionsMap = {};
  questions.forEach(q => {
    if (q.kind === 'choice') {
      qOptionsMap[q.id] = db.prepare(`
        SELECT *
          FROM survey_option
         WHERE question_id = ?
         ORDER BY position ASC
      `).all(q.id);
    }
  });

  // Para preguntas de opción: conteos por opción
  const statsByQuestion = {};
  questions.forEach(q => {
    if (q.kind === 'choice') {
      const counts = db.prepare(`
        SELECT option_id, COUNT(*) AS c
          FROM survey_answer
         WHERE question_id = ?
           AND option_id IS NOT NULL
         GROUP BY option_id
      `).all(q.id);
      const mapCounts = {};
      counts.forEach(row => { mapCounts[row.option_id] = row.c; });
      statsByQuestion[q.id] = mapCounts;
    }
  });

  // Para preguntas abiertas: respuestas con nombre y experiencia
  const openAnswers = {};
  questions.forEach(q => {
    if (q.kind === 'open') {
      openAnswers[q.id] = db.prepare(`
        SELECT a.text_value, r.name, r.experience, r.created_at
          FROM survey_answer a
          JOIN survey_response r ON r.id = a.response_id
         WHERE a.question_id = ?
           AND a.text_value IS NOT NULL
         ORDER BY r.created_at DESC
      `).all(q.id);
    }
  });

  res.render('admin/survey_results', {
    title: 'Admin - Resultados de encuesta',
    survey,
    questions,
    qOptionsMap,
    statsByQuestion,
    openAnswers,
    totalResponses,
    dayjs
  });
});


// ---- Experiencias de clientes ----

// Pendientes por aprobar
router.get('/experiencias', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS c
      FROM experience_post
     WHERE status = 'pending'
  `).get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const list = db.prepare(`
    SELECT e.*, a.name AS activity_name
      FROM experience_post e
 LEFT JOIN activity a ON a.id = e.activity_id
     WHERE e.status = 'pending'
     ORDER BY datetime(e.created_at) DESC
     LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/experiences', {
    title: 'Admin - Publicaciones pendientes',
    list,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/admin/experiencias' }
  });
});

// Historial de aprobadas
router.get('/experiencias/historial', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS c
      FROM experience_post
     WHERE status = 'approved'
  `).get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const list = db.prepare(`
    SELECT e.*, a.name AS activity_name
      FROM experience_post e
 LEFT JOIN activity a ON a.id = e.activity_id
     WHERE e.status = 'approved'
     ORDER BY datetime(e.approved_at) DESC, datetime(e.created_at) DESC
     LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/experiences_history', {
    title: 'Admin - Publicaciones aprobadas',
    list,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/admin/experiencias/historial' }
  });
});

// Aprobar / Rechazar
router.post('/experiencias/:id/aprobar', requireAdmin, (req, res) => {
  db.prepare(`
    UPDATE experience_post
       SET status = 'approved',
           approved_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `).run(req.params.id);
  res.redirect('/admin/experiencias');
});

router.post('/experiencias/:id/rechazar', requireAdmin, (req, res) => {
  db.prepare(`
    UPDATE experience_post
       SET status = 'rejected',
           approved_at = NULL
     WHERE id = ?
  `).run(req.params.id);
  res.redirect('/admin/experiencias');
});

// Exportar todas en JSON (para descargar URLs de fotos/videos)
router.get('/experiencias/export.json', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, body, media_url, media_type, activity_id, status, created_at, approved_at
      FROM experience_post
     ORDER BY datetime(created_at) DESC
  `).all();
  res.json(rows);
});

// ---- Contactos ----
router.get('/contactos', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM contact_message').get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const msgs = db.prepare(`
    SELECT *
    FROM contact_message
    ORDER BY datetime(created_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/contacts', {
    title: 'Admin - Contactos',
    msgs,
    pagination: { page, totalPages, baseUrl: '/admin/contactos' }
  });
});
router.get('/historial', requireAdmin, (req, res) => {
  const page = getPage(req);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM visit_history').get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const list = db.prepare(`
    SELECT *
    FROM visit_history
    ORDER BY datetime(record_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('admin/history', {
    title: 'Admin - Historial',
    list,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/admin/historial' }
  });
});

router.post('/historial/add', requireAdmin, (req, res) => {
  const {
    record_at = '',
    activity_id = '',
    activity_name = '',
    slot_id = '',
    start_at = '',
    people_json = '[]',
    phone = '',
    email = '',
    pay_method = '',
    amount_cents = 0,
    notes = ''
  } = req.body;

  let safePeople = '[]';
  try { safePeople = JSON.stringify(JSON.parse(people_json)); }
  catch { safePeople = JSON.stringify([{ name: String(people_json).slice(0, 60) }]); }

  db.prepare(`
    INSERT INTO visit_history
    (id, reservation_id, record_at, activity_id, activity_name, slot_id, start_at, people_json, phone, email, pay_method, amount_cents, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id(), null, record_at || null, activity_id, activity_name, slot_id, start_at,
    safePeople, phone, email, pay_method, Number(amount_cents || 0), notes
  );

  res.redirect('/admin/historial');
});

router.post('/historial/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM visit_history WHERE id=?').run(req.params.id);
  res.redirect('/admin/historial');
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    const maxMB = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    return res.status(413).render('admin/upload_error', {
      title: 'Archivo demasiado grande',
      maxMB,
      backUrl: req.headers.referer || '/admin'
    });
  }
  return next(err);
});

export default router;
