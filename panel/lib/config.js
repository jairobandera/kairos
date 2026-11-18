// Configuración del panel: todo viene de variables de entorno (cargadas en Coolify).
const env = process.env;

function requerida(nombre) {
  const v = env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export const config = {
  port: Number(env.PORT) || 3000,
  produccion: env.NODE_ENV === 'production',
  panel: {
    usuario: requerida('PANEL_USER'),
    password: requerida('PANEL_PASSWORD'),
    secreto: requerida('SESSION_SECRET'),
  },
  dominio: env.BASE_DOMAIN || 'pckairos.cloud',
  coolify: {
    url: (env.COOLIFY_URL || 'http://coolify:8080').replace(/\/+$/, ''),
    token: requerida('COOLIFY_TOKEN'),
    servidor: requerida('COOLIFY_SERVER_UUID'),
    proyecto: requerida('COOLIFY_PROJECT_UUID'),
    entorno: env.COOLIFY_ENVIRONMENT || 'production',
  },
  postgres: {
    host: requerida('PG_HOST'),
    port: Number(env.PG_PORT) || 5432,
    user: requerida('PG_USER'),
    password: requerida('PG_PASSWORD'),
    database: env.PG_DATABASE || 'apps',
  },
  eatsy: {
    repo: env.EATSY_REPO || 'https://github.com/jairobandera/eatsy',
    principal: (env.EATSY_MAIN_URL || 'https://eatsy.pckairos.cloud').replace(/\/+$/, ''),
    superadminUser: env.EATSY_SUPERADMIN_USER || '',
    superadminPassword: env.EATSY_SUPERADMIN_PASSWORD || '',
    apiKey: env.EATSY_SUPERADMIN_API_KEY || '',
    zonaHoraria: env.APP_TIMEZONE || 'America/Montevideo',
  },
  stockify: {
    repo: env.STOCKIFY_REPO || 'jairobandera/StockyFy3.0',
    superadminPassword: requerida('STOCKIFY_SUPERADMIN_PASSWORD'),
  },
};

// Subdominios que no se pueden usar para un negocio.
export const RESERVADOS = new Set([
  'www', 'panel', 'coolify', 'api', 'mail', 'smtp', 'ftp', 'admin', 'app', 'apps', 'static', 'cdn', 'dev', 'test', 'demo',
  'eatsy', 'stockify', 'acordes', 'seguridad', 'guardiel', 'kairos', 'soporte', 'status', 'descargas',
]);
