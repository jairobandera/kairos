// Cliente mínimo de la API de Coolify (corre en la red interna "coolify" del VPS).
import { config } from './config.js';

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(`${config.coolify.url}/api/v1${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${config.coolify.token}`,
      Accept: 'application/json',
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await res.text();
  let datos;
  try { datos = texto ? JSON.parse(texto) : {}; } catch { datos = { message: texto }; }
  if (!res.ok) {
    const detalle = datos.errors ? ` ${JSON.stringify(datos.errors)}` : '';
    throw new Error(`Coolify ${metodo} ${ruta}: ${res.status} ${datos.message || ''}${detalle}`.trim());
  }
  return datos;
}

const base = () => ({
  project_uuid: config.coolify.proyecto,
  server_uuid: config.coolify.servidor,
  environment_name: config.coolify.entorno,
  instant_deploy: false,
});

export const coolify = {
  listarApps: () => api('GET', '/applications'),
  app: (uuid) => api('GET', `/applications/${uuid}`),

  crearAppGit: (datos) => api('POST', '/applications/public', { ...base(), ...datos }),
  crearAppDockerfile: (datos) => api('POST', '/applications/dockerfile', { ...base(), ...datos }),
  actualizarApp: (uuid, datos) => api('PATCH', `/applications/${uuid}`, datos),

  async ponerEnv(uuid, clave, valor) {
    try {
      return await api('POST', `/applications/${uuid}/envs`, { key: clave, value: String(valor), is_preview: false });
    } catch (err) {
      if (!/already exists/i.test(err.message)) throw err;
      return api('PATCH', `/applications/${uuid}/envs`, { key: clave, value: String(valor) });
    }
  },
  async ponerEnvs(uuid, vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined || v === null || v === '') continue;
      await this.ponerEnv(uuid, k, v);
    }
  },
  crearVolumen: (uuid, nombre, ruta) => api('POST', `/applications/${uuid}/storages`, { type: 'persistent', name: nombre, mount_path: ruta }),

  async desplegar(uuid) {
    const r = await api('POST', '/deploy', { uuid, force: false });
    return r.deployments?.[0]?.deployment_uuid;
  },
  despliegue: (uuid) => api('GET', `/deployments/${uuid}`),
  iniciar: (uuid) => api('POST', `/applications/${uuid}/start`),
  reiniciar: (uuid) => api('POST', `/applications/${uuid}/restart`),
  detener: (uuid) => api('POST', `/applications/${uuid}/stop`),
  eliminar: (uuid) => api('DELETE', `/applications/${uuid}?delete_configurations=true&delete_volumes=true&docker_cleanup=true&delete_connected_networks=false`),
};
