// Agrega o quita un negocio de la lista "Todas mis instalaciones" de la Eatsy principal,
// entrando como superadmin por la API (así la app lo toma al instante, sin reiniciar).
import { config } from './config.js';

async function sesion() {
  const { principal, superadminUser, superadminPassword } = config.eatsy;
  if (!superadminUser || !superadminPassword) throw new Error('Faltan EATSY_SUPERADMIN_USER / EATSY_SUPERADMIN_PASSWORD');
  const res = await fetch(`${principal}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ nombre: superadminUser, contrasena: superadminPassword }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`login superadmin: ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  return async (metodo, ruta, cuerpo) => {
    const r = await fetch(`${principal}${ruta}`, {
      method: metodo,
      headers: { Cookie: cookie, 'X-Requested-With': 'fetch', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status}`);
    return r.json();
  };
}

async function listaActual(api) {
  const panel = await api('GET', '/api/superadmin/instalaciones');
  return (panel.instalaciones || []).map((i) => ({ nombre: i.nombre || '', url: i.url }));
}

export async function registrarEnEatsy(nombre, url) {
  const api = await sesion();
  const lista = await listaActual(api);
  if (!lista.some((i) => i.url.replace(/\/+$/, '') === url)) {
    lista.push({ nombre, url });
    await api('PUT', '/api/superadmin/instalaciones', { lista });
  }
  // El nombre del negocio en la instalación nueva (por defecto dice "Eatsy"), vía el panel central.
  const n = (await listaActual(api)).findIndex((i) => i.url.replace(/\/+$/, '') === url);
  if (n < 0) return;
  const { config: c } = await api('GET', `/api/superadmin/remota/${n}`);
  if (c.negocio.nombre === nombre) return;
  await api('PUT', `/api/superadmin/remota/${n}`, {
    paquete: c.paquete, licencia: c.licencia, limites: c.limites, modulos: c.modulos,
    negocio: { nombre: String(nombre).slice(0, 60), color: c.negocio.color },
  });
}

export async function quitarDeEatsy(url) {
  const api = await sesion();
  const lista = (await listaActual(api)).filter((i) => i.url.replace(/\/+$/, '') !== url);
  await api('PUT', '/api/superadmin/instalaciones', { lista });
}
