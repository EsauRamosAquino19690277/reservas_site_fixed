import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { db } from './db.js';
import publicRouter from './routes/public.js';
import adminRouter from './routes/admin.js';
import paymentsRouter from './routes/payments.js';
import { getCheckinKeys } from './signing.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret',
  resave: false,
  saveUninitialized: false,
}));

// Ajustes del sitio a cada request
app.use((req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM site_settings WHERE id=?').get('default') || {};
    const bank = db.prepare('SELECT * FROM bank_settings WHERE id=?').get('default') || {};

    res.locals.MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || '';
    res.locals.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';

    res.locals.site = {
      title: row.title || 'Turismo Reservas',
      logo_url: row.logo_url || '',
      navbar_color: row.navbar_color || '#1b8f3a',
      phone: row.phone || '',
      facebook_url: row.facebook_url || '',
      instagram_url: row.instagram_url || '',
      tiktok_url: row.tiktok_url || '',
      privacy_text: row.privacy_text || '',
      address: row.address || '',
      maps_embed_url: row.maps_embed_url || '',
      bank_name: bank.bank_name || '',
      bank_account: bank.bank_account || ''
    };
  } catch (e) {
    res.locals.site = { title: 'Turismo Reservas', navbar_color: '#1b8f3a' };
  }
  next();
});

app.use((req, res, next) => {
  try {
    const { publicKey } = getCheckinKeys();
    res.locals.CHECKIN_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
  } catch (e) {
    res.locals.CHECKIN_PUBLIC_KEY = '';
  }
  next();
});

app.use('/', publicRouter);
app.use('/admin', adminRouter);
app.use('/payments', paymentsRouter);

app.use((req,res)=>{
  res.status(404).render('404', { title: 'No encontrado' });
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>{
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
