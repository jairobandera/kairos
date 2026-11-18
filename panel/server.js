// Panel de Kairos: alta automática de negocios con su propio subdominio.
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';
import { config } from './lib/config.js';
import { iniciarBase, negocios } from './lib/db.js';
import {
  altaNegocio, eliminar, reactivar, redesplegar, refrescarEstado, slugDesde, suspender, urlDe, validarAlta,
} from './lib/provision.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// ---------- Sesión: cookie firmada con HMAC ----------
const COOKIE = 'kp_session';
const HORAS = 12;
const firmar = (datos) => crypto.createHmac('sha256', config.panel.secreto).update(datos).digest('base64url');

function crearToken() {
  const datos = Buffer.from(JSON.stringify({ u: config.panel.usuario, exp: Date.now() + HORAS * 3600_000 })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}
function tokenValido(token) {
  const [datos, firma] = String(token || '').split('.');
  if (!datos || !firma) return false;
  const esperada = firmar(datos);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return false;
  try { return JSON.parse(Buffer.from(datos, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function leerCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const opcionesCookie = () => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${HORAS * 3600}${config.produccion ? '; Secure' : ''}`;

// La clave del panel puede venir en texto o como hash bcrypt ($2...).
const claveCorrecta = (clave) => (config.panel.password.startsWith('$2')
  ? bcrypt.compare(clave, config.panel.password)
  : Promise.resolve(clave.length === config.panel.password.length
    && crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(config.panel.password))));

// Freno simple de fuerza bruta: 10 intentos fallidos por IP cada 15 minutos.
const intentos = new Map();
function bloqueado(ip) {
  const r = intentos.get(ip);
  if (!r || r.hasta < Date.now()) return false;
  return r.n >= 10;
}
function fallo(ip) {
  const r = intentos.get(ip);
  if (!r || r.hasta < Date.now()) intentos.set(ip, { n: 1, hasta: Date.now() + 15 * 60_000 });
  else r.n += 1;
}

app.post('/api/login', async (req, res) => {
  if (bloqueado(req.ip)) return res.status(429).json({ message: 'Demasiados intentos. Probá en 15 minutos.' });
  const { usuario, clave } = req.body || {};
  const okUsuario = typeof usuario === 'string' && usuario === config.panel.usuario;
  const okClave = typeof clave === 'string' && (await claveCorrecta(clave));
  if (!okUsuario || !okClave) {
    fallo(req.ip);
    return res.status(401).json({ message: 'Usuario o clave incorrectos.' });
  }
  intentos.delete(req.ip);
  res.set('Set-Cookie', `${COOKIE}=${crearToken()}; ${opcionesCookie()}`);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/salud', (_req, res) => res.json({ ok: true }));

// Todo lo demás de /api exige sesión y la cabecera anti-CSRF.
app.use('/api', (req, res, next) => {
  if (!tokenValido(leerCookie(req))) return res.status(401).json({ message: 'Sesión vencida. Volvé a entrar.' });
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'fetch') return res.status(403).json({ message: 'Petición rechazada.' });
  next();
});

const publico = (n) => ({
  id: n.id, producto: n.producto, nombre: n.nombre, slug: n.slug, url: urlDe(n.slug), modo: n.modo,
  admin_user: n.admin_user, estado: n.estado, error: n.error, creado: n.creado, coolify_estado: n.coolify_estado,
});

app.get('/api/sesion', (_req, res) => res.json({ usuario: config.panel.usuario, dominio: config.dominio }));

app.get('/api/negocios', async (_req, res) => {
  const lista = await Promise.all((await negocios.listar()).map(refrescarEstado));
  res.json(lista.map(publico));
});

app.get('/api/slug', (req, res) => res.json({ slug: slugDesde(req.query.nombre) }));

app.post('/api/negocios', async (req, res) => {
  const b = req.body || {};
  const datos = {
    producto: String(b.producto || ''),
    nombre: String(b.nombre || '').trim().slice(0, 80),
    slug: String(b.slug || '').trim().toLowerCase(),
    modo: String(b.modo || 'produccion'),
    admin_user: String(b.admin_user || '').trim(),
    admin_password: String(b.admin_password || ''),
  };
  const errores = await validarAlta(datos);
  if (errores.length) return res.status(422).json({ message: errores.join(' ') });
  const n = await altaNegocio(datos);
  res.status(201).json(publico(n));
});

async function conNegocio(req, res, accion) {
  const n = await negocios.obtener(Number(req.params.id));
  if (!n) return res.status(404).json({ message: 'No existe ese negocio.' });
  await accion(n);
  res.json({ ok: true });
}

app.post('/api/negocios/:id/suspender', (req, res) => conNegocio(req, res, suspender));
app.post('/api/negocios/:id/reactivar', (req, res) => conNegocio(req, res, reactivar));
app.post('/api/negocios/:id/redesplegar', (req, res) => conNegocio(req, res, redesplegar));
app.delete('/api/negocios/:id', async (req, res) => {
  const n = await negocios.obtener(Number(req.params.id));
  if (!n) return res.status(404).json({ message: 'No existe ese negocio.' });
  if (req.body?.confirmar !== n.slug) return res.status(422).json({ message: 'Para eliminar escribí el subdominio exacto.' });
  await eliminar(n);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ message: 'Ruta no encontrada.' }));

// ---------- Frontend ----------
app.use(express.static(path.join(import.meta.dirname, 'public'), { index: 'index.html', maxAge: '1h' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Error inesperado.' });
});

await iniciarBase();
app.listen(config.port, () => console.log(`Panel de Kairos en el puerto ${config.port}`));
