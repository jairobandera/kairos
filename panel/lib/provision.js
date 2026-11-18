// Alta, seguimiento, suspensión y baja de negocios.
import crypto from 'node:crypto';
import { config, RESERVADOS } from './config.js';
import { coolify } from './coolify.js';
import {
  negocios, crearEsquemaPostgres, borrarEsquemaPostgres, crearBaseMysql, borrarBaseMysql,
} from './db.js';
import { dockerfileStockify } from './stockify.js';
import { registrarEnEatsy, quitarDeEatsy } from './eatsy.js';

const clave = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');

// Coolify solo acepta letras, números, espacios y algo de puntuación en la descripción.
const descripcion = (producto, nombre) => `${producto} - ${nombre}`
  .replace(/[^\p{L}\p{N} \-_.,!?()'"+=*/@&]/gu, '').slice(0, 200);

/** "Mini Market Sur" -> "minimarketsur" (solo letras, números y guiones). */
export function slugDesde(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40);
}

export const urlDe = (slug) => `https://${slug}.${config.dominio}`;

export async function validarAlta({ producto, nombre, slug, modo, admin_user, admin_password }) {
  const errores = [];
  if (!['eatsy', 'stockify'].includes(producto)) errores.push('Elegí el producto.');
  if (!nombre || String(nombre).trim().length < 2) errores.push('Poné el nombre del negocio.');
  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug || '')) errores.push('El subdominio solo puede tener letras minúsculas, números y guiones (2 a 40).');
  if (RESERVADOS.has(slug)) errores.push(`"${slug}" está reservado. Elegí otro subdominio.`);
  if (!['produccion', 'demo'].includes(modo)) errores.push('Elegí el modo.');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(admin_user || '')) errores.push('El usuario administrador: 3 a 40 letras, números, punto, guion o guion bajo.');
  if (!admin_password || admin_password.length < 8) errores.push('La clave del administrador tiene que tener 8 caracteres o más.');
  if (!errores.length) {
    if (await negocios.porSlug(slug)) errores.push(`Ya existe un negocio con el subdominio "${slug}".`);
    else {
      const apps = await coolify.listarApps();
      const host = `${slug}.${config.dominio}`;
      if (apps.some((a) => String(a.fqdn || '').split(',').some((u) => u.trim().replace(/^https?:\/\//, '') === host))) {
        errores.push(`${host} ya está en uso por otra app del servidor.`);
      }
    }
  }
  return errores;
}

/** Crea el registro y lanza el despliegue en segundo plano. */
export async function altaNegocio(datos) {
  const base = datos.producto === 'eatsy' ? `eatsy_${datos.slug.replace(/-/g, '_')}` : `stk_${datos.slug.replace(/-/g, '_')}`;
  const n = await negocios.crear({ ...datos, base, base_user: base });
  desplegarNegocio(n, datos.admin_password).catch(async (err) => {
    console.error(`[alta ${n.slug}]`, err);
    await negocios.actualizar(n.id, { estado: 'error', error: String(err.message || err).slice(0, 1000) });
  });
  return n;
}

async function desplegarNegocio(n, adminPassword) {
  const dominio = urlDe(n.slug);
  const claveBase = clave();
  let uuid;

  if (n.producto === 'eatsy') {
    await negocios.actualizar(n.id, { estado: 'creando base' });
    await crearEsquemaPostgres(n.base, n.base_user, claveBase);

    await negocios.actualizar(n.id, { estado: 'creando app' });
    const app = await coolify.crearAppGit({
      name: `eatsy-${n.slug}`,
      description: descripcion('Eatsy', n.nombre),
      git_repository: config.eatsy.repo,
      git_branch: 'main',
      build_pack: 'nixpacks',
      ports_exposes: '3000',
      domains: dominio,
      health_check_enabled: true,
      health_check_path: '/api/salud',
    });
    uuid = app.uuid;
    await negocios.actualizar(n.id, { app_uuid: uuid });

    const pg = config.postgres;
    await coolify.ponerEnvs(uuid, {
      NIXPACKS_NODE_VERSION: '22',
      NODE_ENV: 'production',
      PORT: '3000',
      APP_MODE: n.modo,
      TRUST_PROXY: '1',
      APP_TIMEZONE: config.eatsy.zonaHoraria,
      PUBLIC_URL: dominio,
      DB_SCHEMA: n.base,
      DB_SSL: 'false',
      DATABASE_URL: `postgresql://${n.base_user}:${claveBase}@${pg.host}:${pg.port}/${pg.database}`,
      SESSION_SECRET: clave(32),
      ADMIN_USER: n.admin_user,
      ADMIN_PASSWORD: adminPassword,
      SUPERADMIN_USER: config.eatsy.superadminUser,
      SUPERADMIN_PASSWORD: config.eatsy.superadminPassword,
      SUPERADMIN_API_KEY: config.eatsy.apiKey,
    });
    await coolify.crearVolumen(uuid, `${uuid}-uploads`, '/app/uploads');
  } else {
    await negocios.actualizar(n.id, { estado: 'creando base' });
    await crearBaseMysql(n.base, n.base_user, claveBase);

    await negocios.actualizar(n.id, { estado: 'creando app' });
    const app = await coolify.crearAppDockerfile({
      name: `stockify-${n.slug}`,
      description: descripcion('Stockify', n.nombre),
      dockerfile: Buffer.from(dockerfileStockify()).toString('base64'),
      ports_exposes: '8080',
      domains: dominio,
    });
    uuid = app.uuid;
    await negocios.actualizar(n.id, { app_uuid: uuid });
    await coolify.actualizarApp(uuid, { ports_exposes: '8080' });

    await coolify.ponerEnvs(uuid, {
      NODE_ENV: 'production',
      PORT: '8080',
      DB_HOST: config.mysql.host,
      DB_PORT: String(config.mysql.port),
      DB_NAME: n.base,
      DB_USER: n.base_user,
      DB_PASS: claveBase,
      JWT_SECRET: clave(32),
      SERVE_FRONTEND: 'true',
      CORS_ORIGIN: dominio,
      SEED_DEMO: n.modo === 'demo' ? '1' : '0',
      BOOT_EMPRESA: n.nombre,
      BOOT_ADMIN_USER: n.admin_user,
      BOOT_ADMIN_PASSWORD: adminPassword,
      BOOT_SUPERADMIN_PASSWORD: config.stockify.superadminPassword,
    });
  }

  await negocios.actualizar(n.id, { estado: 'desplegando' });
  const deploy = await coolify.desplegar(uuid);
  await negocios.actualizar(n.id, { deploy_uuid: deploy });
  await esperarDespliegue(n.id, deploy);

  if (n.producto === 'eatsy') {
    try {
      await registrarEnEatsy(n.nombre, dominio);
    } catch (err) {
      console.warn(`[alta ${n.slug}] no se pudo agregar al panel central de Eatsy:`, err.message);
    }
  }
}

async function esperarDespliegue(id, deployUuid) {
  const limite = Date.now() + 20 * 60_000;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 10_000));
    let d;
    try { d = await coolify.despliegue(deployUuid); } catch { continue; }
    if (d.status === 'finished') {
      await negocios.actualizar(id, { estado: 'activo', error: null });
      return;
    }
    if (['failed', 'cancelled-by-user', 'cancelled'].includes(d.status)) {
      let detalle = '';
      try {
        const logs = JSON.parse(d.logs || '[]').filter((l) => !l.hidden).slice(-6).map((l) => l.output).join('\n');
        detalle = logs ? `\n${logs}` : '';
      } catch { /* sin logs */ }
      throw new Error(`El despliegue falló.${detalle}`);
    }
  }
  throw new Error('El despliegue tardó más de 20 minutos. Revisalo en Coolify.');
}

/** Estado actual consultando a Coolify (para negocios ya creados). */
export async function refrescarEstado(n) {
  if (!n.app_uuid || !['activo', 'suspendido', 'desplegando'].includes(n.estado)) return n;
  try {
    const app = await coolify.app(n.app_uuid);
    return { ...n, coolify_estado: app.status };
  } catch {
    return { ...n, coolify_estado: 'desconocido' };
  }
}

export async function suspender(n) {
  await coolify.detener(n.app_uuid);
  await negocios.actualizar(n.id, { estado: 'suspendido' });
}

export async function reactivar(n) {
  await coolify.iniciar(n.app_uuid);
  await negocios.actualizar(n.id, { estado: 'activo' });
}

export async function redesplegar(n) {
  const deploy = await coolify.desplegar(n.app_uuid);
  await negocios.actualizar(n.id, { estado: 'desplegando', deploy_uuid: deploy, error: null });
  esperarDespliegue(n.id, deploy).catch((err) => negocios.actualizar(n.id, { estado: 'error', error: String(err.message).slice(0, 1000) }));
}

/** Borra la app, su volumen y su base. No se puede deshacer. */
export async function eliminar(n) {
  if (n.app_uuid) {
    try { await coolify.eliminar(n.app_uuid); } catch (err) { if (!/404/.test(err.message)) throw err; }
  }
  if (n.producto === 'eatsy') {
    await borrarEsquemaPostgres(n.base, n.base_user);
    try { await quitarDeEatsy(urlDe(n.slug)); } catch (err) { console.warn('[baja] panel central de Eatsy:', err.message); }
  } else {
    await borrarBaseMysql(n.base, n.base_user);
  }
  await negocios.borrar(n.id);
}
