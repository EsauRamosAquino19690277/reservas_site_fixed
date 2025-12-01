// src/routes/public.js
import express from 'express';
import { db, id } from '../db.js';
import dayjs from 'dayjs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ---- Subidas para experiencias (fotos / videos) ----
const storageExp = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safe) || '';
    cb(null, unique + ext.toLowerCase());
  }
});
const fileFilterExp = (req, file, cb) => {
  /image\//.test(file.mimetype) || /video\//.test(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Tipo de archivo no permitido'));
};
const uploadExperience = multer({
  storage: storageExp,
  fileFilter: fileFilterExp,
  limits: { fileSize: 50 * 1024 * 1024 }   // 50 MB
});

const EXP_PAGE_SIZE = 9;
function getExpPage(req) {
  const raw = parseInt(req.query.page || '1', 10);
  return Number.isNaN(raw) || raw < 1 ? 1 : raw;
}

// HOME: carrusel + últimas publicaciones + actividades
router.get('/', (req, res) => {
  const carouselPubs = db.prepare(
    `SELECT *
       FROM publication
      WHERE published = 1 AND COALESCE(home_carousel, 0) = 1
      ORDER BY COALESCE(carousel_order, 0) ASC, created_at DESC
      LIMIT 10`
  ).all();

  const pubs = db.prepare(
    `SELECT *
       FROM publication
      WHERE published = 1
      ORDER BY created_at DESC
      LIMIT 6`
  ).all();

  const acts = db.prepare(
    `SELECT *
       FROM activity
      ORDER BY created_at DESC
      LIMIT 6`
  ).all();

  res.render('index', { title: 'Inicio', carouselPubs, pubs, acts, dayjs });
});

// LISTADO PUBLICACIONES
router.get('/publicaciones', (req, res) => {
  const pubs = db.prepare(
    `SELECT *
       FROM publication
      WHERE published = 1
      ORDER BY created_at DESC`
  ).all();
  res.render('publications', { title: 'Publicidad', pubs });
});

// LISTADO EXPERIENCIAS (solo aprobadas, con paginación)
router.get('/experiencias', (req, res) => {
  const page = getExpPage(req);
  const limit = EXP_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS c
      FROM experience_post
     WHERE status = 'approved'
  `).get();
  const total = totalRow ? totalRow.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const posts = db.prepare(`
    SELECT e.*, a.name AS activity_name
      FROM experience_post e
 LEFT JOIN activity a ON a.id = e.activity_id
     WHERE e.status = 'approved'
     ORDER BY datetime(e.approved_at) DESC, datetime(e.created_at) DESC
     LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.render('experiences', {
    title: 'Experiencias',
    posts,
    dayjs,
    pagination: { page, totalPages, baseUrl: '/experiencias' }
  });
});

// FORMULARIO NUEVA EXPERIENCIA (GET)
router.get('/experiencias/nueva', (req, res) => {
  const acts = db.prepare(`
    SELECT id, name
      FROM activity
     ORDER BY name ASC
  `).all();
  res.render('experience_new', {
    title: 'Nueva experiencia',
    acts,
    error: null,
    success: false,
    formData: {}
  });
});

// FORMULARIO NUEVA EXPERIENCIA (POST)
router.post('/experiencias/nueva', (req, res) => {
  const acts = db.prepare(`SELECT id, name FROM activity ORDER BY name ASC`).all();

  uploadExperience.single('media')(req, res, function (err) {
    const title = (req.body.title || '').trim();
    const body  = (req.body.body  || '').trim();
    const activity_id = (req.body.activity_id || '').trim() || null;
    const formData = { title, body, activity_id };

    // Si hubo error al subir el archivo (tamaño, tipo, etc.)
    if (err) {
      let msg = 'Error al subir el archivo.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        msg = 'El archivo es demasiado grande. El tamaño máximo permitido es de 50 MB.';
      } else if (err.message) {
        msg = err.message;
      }

      return res.render('experience_new', {
        title: 'Nueva experiencia',
        acts,
        error: msg,
        success: false,
        formData
      });
    }

    // Validaciones normales del formulario
    if (!title || !body) {
      return res.render('experience_new', {
        title: 'Nueva experiencia',
        acts,
        error: 'Título y descripción son obligatorios.',
        success: false,
        formData
      });
    }

    let media_url = null;
    let media_type = null;
    if (req.file) {
      media_url = '/uploads/' + req.file.filename;
      media_type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    }

    db.prepare(`
      INSERT INTO experience_post
        (id, title, body, media_url, media_type, activity_id, status)
      VALUES (?,?,?,?,?,?, 'pending')
    `).run(
      id(),
      title,
      body,
      media_url,
      media_type,
      activity_id
    );

    return res.render('experience_new', {
      title: 'Nueva experiencia',
      acts,
      error: null,
      success: true,
      formData: {}
    });
  });
});

// LISTADO DE ENCUESTAS ACTIVAS
router.get('/encuestas', (req, res) => {
  const surveys = db.prepare(`
    SELECT *
      FROM survey_form
     WHERE is_active = 1
     ORDER BY datetime(created_at) DESC
  `).all();

  res.render('surveys_list', {
    title: 'Encuestas',
    surveys
  });
});

router.get('/encuestas/gracias', (req, res) => {
  res.render('survey_thanks', { title: 'Gracias por tu opinión' });
});

// MOSTRAR UNA ENCUESTA
router.get('/encuestas/:id', (req, res) => {
  const survey = db.prepare(`
    SELECT *
      FROM survey_form
     WHERE id = ?
  `).get(req.params.id);

  if (!survey) {
    return res.status(404).send('Encuesta no encontrada');
  }

  if (survey.external_url) {
    // Si es de enlace externo, sólo mostramos un botón para ir al link
    return res.render('survey_fill', {
      title: survey.title,
      survey,
      questions: [],
      qOptionsMap: {},
      error: null
    });
  }

  if (!survey.is_active) {
    // Cerrada pero interna: se puede mostrar mensaje de cerrada
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

    return res.render('survey_fill', {
      title: survey.title,
      survey,
      questions,
      qOptionsMap,
      error: 'Esta encuesta ya fue cerrada. Puedes ver las preguntas pero no enviar más respuestas.'
    });
  }

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

  res.render('survey_fill', {
    title: survey.title,
    survey,
    questions,
    qOptionsMap,
    error: null
  });
});

// RESPONDER UNA ENCUESTA
router.post('/encuestas/:id', (req, res) => {
  const survey = db.prepare(`
    SELECT *
      FROM survey_form
     WHERE id = ?
  `).get(req.params.id);

  if (!survey) {
    return res.status(404).send('Encuesta no encontrada');
  }
  if (!survey.is_active || survey.external_url) {
    return res.redirect('/encuestas');
  }

  const name = (req.body.name || '').trim();
  const experience = (req.body.experience || '').trim();

  const responseId = id();
  db.prepare(`
    INSERT INTO survey_response (id, survey_id, name, experience)
    VALUES (?,?,?,?)
  `).run(responseId, survey.id, name, experience);

  const questions = db.prepare(`
    SELECT *
      FROM survey_question
     WHERE survey_id = ?
     ORDER BY position ASC
  `).all(survey.id);

  const insertAnswer = db.prepare(`
    INSERT INTO survey_answer (id, response_id, question_id, option_id, text_value)
    VALUES (?,?,?,?,?)
  `);

  questions.forEach(q => {
    if (q.kind === 'choice') {
      const val = req.body['q_' + q.id];
      if (val) {
        insertAnswer.run(id(), responseId, q.id, val, null);
      }
    } else {
      const txt = (req.body['q_text_' + q.id] || '').trim();
      if (txt) {
        insertAnswer.run(id(), responseId, q.id, null, txt);
      }
    }
  });

  res.redirect('/encuestas/gracias');
});


// LISTADO ACTIVIDADES
router.get('/actividades', (req, res) => {
  const acts = db.prepare(
    `SELECT *
       FROM activity
      ORDER BY created_at DESC`
  ).all();
  res.render('activities', { title: 'Actividades', acts });
});

// DETALLE ACTIVIDAD
router.get('/actividad/:id', (req, res) => {
  const act = db.prepare('SELECT * FROM activity WHERE id = ?').get(req.params.id);
  if (!act) return res.status(404).render('404', { title: 'No encontrado' });

  const slots = db.prepare(
    `SELECT *
       FROM schedule_slot
      WHERE activity_id = ? AND published = 1
      ORDER BY start_at`
  ).all(act.id);

  res.render('activity_detail', { title: act.name, act, slots, dayjs });
});

// CHECKOUT (GET)
// Mostrar checkout de un horario
router.get('/reservar/:slotId', (req, res) => {
  const slot = db.prepare(`
    SELECT s.*, a.name AS act_name, a.id AS act_id, a.media_json
    FROM schedule_slot s
    JOIN activity a ON a.id = s.activity_id
    WHERE s.id = ?
  `).get(req.params.slotId);

  if (!slot) {
    return res.status(404).render('404', { title: 'No encontrado' });
  }

  const act = { id: slot.act_id, name: slot.act_name, media_json: slot.media_json };

  res.render('checkout', {
    title: 'Reservar',
    act,
    slot,                // <- usa slot.price_cents en la vista
    error: null,
    MP_PUBLIC_KEY: res.locals.MP_PUBLIC_KEY,
    PAYPAL_CLIENT_ID: res.locals.PAYPAL_CLIENT_ID,
    dayjs
  });
});

// CHECKOUT (POST)
// Crear la reserva del horario (con datos por persona)
router.post('/reservar/:slotId', (req, res) => {
  const slot = db.prepare(`SELECT * FROM schedule_slot WHERE id=?`).get(req.params.slotId);
  if (!slot) {
    return res.status(404).render('404', { title: 'No encontrado' });
  }

 const available = (slot.capacity_total - (slot.capacity_reserved || 0));
  const qty = parseInt(req.body.party_size || '1', 10);

  if (qty > available) {
    const act = db.prepare(`SELECT * FROM activity WHERE id=?`).get(slot.activity_id);
    return res.render('checkout', {
      title: 'Reservar',
      act,
      slot,
      error: 'No hay cupos suficientes',
      MP_PUBLIC_KEY: res.locals.MP_PUBLIC_KEY,
      PAYPAL_CLIENT_ID: res.locals.PAYPAL_CLIENT_ID,
      dayjs
    });
  }

  const email = (req.body.email || '').trim();
  const emailConfirm = (req.body.email_confirm || '').trim();

  if (email !== emailConfirm) {
    const act = db.prepare(`SELECT * FROM activity WHERE id=?`).get(slot.activity_id);
    return res.render('checkout', {
      title: 'Reservar',
      act,
      slot,
      error: 'El correo y la confirmación no coinciden.',
      MP_PUBLIC_KEY: res.locals.MP_PUBLIC_KEY,
      PAYPAL_CLIENT_ID: res.locals.PAYPAL_CLIENT_ID,
      dayjs
    });
  }

  // Normalizar miembros (req.body.members llega como array o como objeto indexado)
  let members = [];
  if (req.body.members) {
    if (Array.isArray(req.body.members)) {
      members = req.body.members;
    } else {
      members = Object.keys(req.body.members)
        .sort((a,b)=>Number(a)-Number(b))
        .map(k => req.body.members[k]);
    }
  }

  // Validación: debe haber datos completos de cada persona
  if (members.length !== qty || members.some(m => !(m?.first_name && m?.last_name_p && m?.last_name_m && m?.age_range))) {
    const act = db.prepare(`SELECT * FROM activity WHERE id=?`).get(slot.activity_id);
    return res.render('checkout', {
      title: 'Reservar',
      act,
      slot,
      error: 'Completa los datos (nombre y apellidos) y rango de edad para cada persona.',
      MP_PUBLIC_KEY: res.locals.MP_PUBLIC_KEY,
      PAYPAL_CLIENT_ID: res.locals.PAYPAL_CLIENT_ID,
      dayjs
    });
  }

  // Bloquear cupos
  db.prepare(`UPDATE schedule_slot SET capacity_reserved = capacity_reserved + ? WHERE id=?`).run(qty, slot.id);

  const unit_price_cents = slot.price_cents || 0;

  const r = {
    id: id(),
    slot_id: slot.id,
    activity_id: slot.activity_id,
    holder_name: req.body.holder_name,
    phone: req.body.phone,
    email,
    party_size: qty,
    companions: JSON.stringify(members), // guardamos los datos por persona
    notes: req.body.notes || '',
    pay_method: req.body.pay_method || 'deposit',
    amount_cents: unit_price_cents * qty,
    status: 'pending'
  };

  db.prepare(`
    INSERT INTO reservation (id, slot_id, activity_id, holder_name, phone, email, party_size, companions, notes, pay_method, amount_cents, status)
    VALUES (@id,@slot_id,@activity_id,@holder_name,@phone,@email,@party_size,@companions,@notes,@pay_method,@amount_cents,@status)
  `).run(r);

  const act = db.prepare('SELECT * FROM activity WHERE id=?').get(slot.activity_id);

  res.render('reservation_success', {
    title: 'Reserva creada',
    r,
    members,
    slot,
    act,
    dayjs
  });
});




// BUSCAR MIS RESERVAS
router.get('/mis-reservas', (req, res) => {
  res.render('reservation_lookup', { title: 'Mis reservas', results: null, error: null });
});

router.post('/mis-reservas', (req, res) => {
  const { code, phone_last } = req.body;
  const rows = db.prepare(`
    SELECT r.*, a.name AS act_name, s.start_at, s.end_at
      FROM reservation r
      JOIN activity a      ON a.id = r.activity_id
      JOIN schedule_slot s ON s.id = r.slot_id
     WHERE r.id = ? AND substr(r.phone, length(r.phone) - 1, 2) = ?
  `).all(code, phone_last);

  if (!rows.length) {
    return res.render('reservation_lookup', { title: 'Mis reservas', results: null, error: 'No se encontró la reserva' });
  }
  res.render('reservation_lookup', { title: 'Mis reservas', results: rows, error: null });
});

// Páginas informativas
router.get('/historia', (req, res) => {
  const page = db.prepare('SELECT * FROM page WHERE slug = ?').get('historia');
  res.render('historia', { title: 'Historia', page });
});

router.get('/contacto', (req, res) => {
  res.render('contacto', { title: 'Contacto', sent: false });
});

router.post('/contacto', (req, res) => {
  const { name, email, message } = req.body;
  db.prepare('INSERT INTO contact_message (id, name, email, message) VALUES (?, ?, ?, ?)')
    .run(id(), name || '', email || '', message || '');
  res.render('contacto', { title: 'Contacto', sent: true });
});

export default router;
