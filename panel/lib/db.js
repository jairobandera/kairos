// Conexiones a las bases del VPS:
// - PostgreSQL: guarda los datos del panel (esquema "panel") y aloja un esquema por negocio de Eatsy.
// - MySQL: aloja una base por negocio de Stockify.
import pg from 'pg';
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = new pg.Pool({ ...config.postgres, max: 5 });

export async function iniciarBase() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS panel;
    CREATE TABLE IF NOT EXISTS panel.negocios (
      id          SERIAL PRIMARY KEY,
      producto    TEXT NOT NULL CHECK (producto IN ('eatsy', 'stockify')),
      nombre      TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      modo        TEXT NOT NULL DEFAULT 'produccion',
      admin_user  TEXT NOT NULL,
      app_uuid    TEXT,
      deploy_uuid TEXT,
      estado      TEXT NOT NULL DEFAULT 'creando',
      error       TEXT,
      base        TEXT,
      base_user   TEXT,
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export const negocios = {
  listar: async () => (await pool.query('SELECT * FROM panel.negocios ORDER BY creado DESC')).rows,
  obtener: async (id) => (await pool.query('SELECT * FROM panel.negocios WHERE id = $1', [id])).rows[0],
  porSlug: async (slug) => (await pool.query('SELECT * FROM panel.negocios WHERE slug = $1', [slug])).rows[0],
  async crear(n) {
    const { rows } = await pool.query(
      `INSERT INTO panel.negocios (producto, nombre, slug, modo, admin_user, base, base_user)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [n.producto, n.nombre, n.slug, n.modo, n.admin_user, n.base, n.base_user],
    );
    return rows[0];
  },
  async actualizar(id, campos) {
    const claves = Object.keys(campos);
    if (!claves.length) return;
    const sets = claves.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE panel.negocios SET ${sets}, actualizado = now() WHERE id = $1`, [id, ...claves.map((k) => campos[k])]);
  },
  borrar: (id) => pool.query('DELETE FROM panel.negocios WHERE id = $1', [id]),
};

// ---------- PostgreSQL: un esquema y un usuario propios por negocio de Eatsy ----------
const ident = (s) => `"${s.replace(/"/g, '')}"`;
const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function crearEsquemaPostgres(esquema, usuario, clave) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const existe = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [usuario]);
    if (existe.rowCount) await c.query(`ALTER ROLE ${ident(usuario)} LOGIN PASSWORD ${literal(clave)}`);
    else await c.query(`CREATE ROLE ${ident(usuario)} LOGIN PASSWORD ${literal(clave)}`);
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${ident(esquema)} AUTHORIZATION ${ident(usuario)}`);
    // CONNECT para entrar y CREATE porque la app hace "CREATE SCHEMA IF NOT EXISTS" al arrancar.
    await c.query(`GRANT CONNECT, CREATE ON DATABASE ${ident(config.postgres.database)} TO ${ident(usuario)}`);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

export async function borrarEsquemaPostgres(esquema, usuario) {
  const c = await pool.connect();
  try {
    await c.query(`DROP SCHEMA IF EXISTS ${ident(esquema)} CASCADE`);
    const existe = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [usuario]);
    if (existe.rowCount) {
      await c.query(`REVOKE ALL ON DATABASE ${ident(config.postgres.database)} FROM ${ident(usuario)}`);
      await c.query(`DROP OWNED BY ${ident(usuario)}`);
      await c.query(`DROP ROLE ${ident(usuario)}`);
    }
  } finally {
    c.release();
  }
}

// ---------- MySQL: una base y un usuario propios por negocio de Stockify ----------
async function mysqlRoot() {
  return mysql.createConnection({ host: config.mysql.host, port: config.mysql.port, user: 'root', password: config.mysql.rootPassword });
}

export async function crearBaseMysql(base, usuario, clave) {
  const c = await mysqlRoot();
  try {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.query('CREATE USER IF NOT EXISTS ?@\'%\' IDENTIFIED BY ?', [usuario, clave]);
    await c.query('ALTER USER ?@\'%\' IDENTIFIED BY ?', [usuario, clave]);
    await c.query(`GRANT ALL PRIVILEGES ON \`${base}\`.* TO ?@'%'`, [usuario]);
    await c.query('FLUSH PRIVILEGES');
  } finally {
    await c.end();
  }
}

export async function borrarBaseMysql(base, usuario) {
  const c = await mysqlRoot();
  try {
    await c.query(`DROP DATABASE IF EXISTS \`${base}\``);
    await c.query('DROP USER IF EXISTS ?@\'%\'', [usuario]);
  } finally {
    await c.end();
  }
}
