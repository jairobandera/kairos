// Dockerfile de cada negocio de Stockify.
// Clona el repo, instala el backend y, al arrancar, si la base está vacía la prepara:
//   - modo demo:       corre scripts/init-db.js (datos de ejemplo) y cambia la clave del superadmin.
//   - modo producción: crea las tablas y solo la empresa, la casa central, el superadmin y el admin.
import { config } from './config.js';

const BOOTSTRAP = `
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const e = process.env;
const conectar = (extra = {}) => mysql.createConnection({
  host: e.DB_HOST, port: Number(e.DB_PORT) || 3306, user: e.DB_USER, password: e.DB_PASS, database: e.DB_NAME, ...extra,
});

let c;
for (let i = 0; i < 30; i++) {
  try { c = await conectar({ multipleStatements: true }); break; }
  catch (err) { console.log('[bootstrap] esperando la base...', err.code || err.message); await new Promise((r) => setTimeout(r, 2000)); }
}
if (!c) { console.error('[bootstrap] no se pudo conectar a la base'); process.exit(1); }

const [[fila]] = await c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'usuario'");
if (fila.n > 0) {
  console.log('[bootstrap] la base ya está preparada');
} else if (e.SEED_DEMO === '1') {
  console.log('[bootstrap] preparando la base con datos de demo');
  await c.end();
  execFileSync('node', ['scripts/init-db.js'], { stdio: 'inherit' });
  c = await conectar();
  const hash = await bcrypt.hash(e.BOOT_SUPERADMIN_PASSWORD, 10);
  await c.query("UPDATE usuario SET contrasenia = ? WHERE rol = 'SUPERADMINISTRADOR'", [hash]);
  if (e.BOOT_EMPRESA) await c.query('UPDATE empresa SET nombre = ? ORDER BY id LIMIT 1', [e.BOOT_EMPRESA]);
} else {
  console.log('[bootstrap] creando las tablas del negocio');
  await c.query(fs.readFileSync('sql/schema.sql', 'utf8'));
  const [emp] = await c.query('INSERT INTO empresa (nombre, suscripcion_ilimitada) VALUES (?, 1)', [e.BOOT_EMPRESA || 'Mi empresa']);
  const [suc] = await c.query(
    'INSERT INTO sucursal (nombre, empresa_id, usa_stock, usa_facturacion) VALUES (?, ?, 1, 1)',
    ['Casa central', emp.insertId],
  );
  const superHash = await bcrypt.hash(e.BOOT_SUPERADMIN_PASSWORD, 10);
  const adminHash = await bcrypt.hash(e.BOOT_ADMIN_PASSWORD, 10);
  await c.query(
    'INSERT INTO usuario (nombre, apellido, nombre_usuario, contrasenia, rol, sucursal_id) VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)',
    ['Soporte', 'Kairos', 'superadmin', superHash, 'SUPERADMINISTRADOR', suc.insertId,
     'Administrador', '', e.BOOT_ADMIN_USER, adminHash, 'ADMINISTRADOR', suc.insertId],
  );
  console.log('[bootstrap] negocio listo');
}
await c.end();
`;

export function dockerfileStockify() {
  const b64 = Buffer.from(BOOTSTRAP, 'utf8').toString('base64');
  const repo = config.stockify.repo;
  return `FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
# Cambia con cada commit nuevo en main -> fuerza a bajar el codigo actualizado
ADD https://api.github.com/repos/${repo}/git/refs/heads/main /tmp/version.json
RUN git clone --depth 1 https://github.com/${repo} . && cd backend && npm ci --omit=dev
WORKDIR /app/backend
RUN echo "${b64}" | base64 -d > bootstrap.mjs
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "node bootstrap.mjs && node server.js"]
`;
}
