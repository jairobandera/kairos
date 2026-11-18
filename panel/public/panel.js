const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: { 'X-Requested-With': 'fetch', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/login') { mostrarLogin(); throw new Error(datos.message || 'Sesión vencida.'); }
  if (!res.ok) throw new Error(datos.message || `Error ${res.status}`);
  return datos;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- Login ----------
function mostrarLogin() {
  $('#vista-panel').hidden = true;
  $('#vista-login').hidden = false;
  clearTimeout(cargar.t);
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#login-error');
  err.hidden = true;
  try {
    await api('POST', '/login', { usuario: f.usuario.value.trim(), clave: f.clave.value });
    f.reset();
    iniciar();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('#btn-salir').addEventListener('click', async () => {
  await api('POST', '/logout').catch(() => {});
  mostrarLogin();
});

// ---------- Lista ----------
let filtro = 'todos';
let lista = [];
const EN_PROCESO = ['creando', 'creando base', 'creando app', 'desplegando'];
const TEXTO_ESTADO = {
  creando: 'Preparando', 'creando base': 'Creando base', 'creando app': 'Creando app', desplegando: 'Desplegando',
  activo: 'Activo', suspendido: 'Suspendido', error: 'Error',
};

document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('activo', x === b));
  filtro = b.dataset.filtro;
  pintar();
}));

function claseEstado(e) {
  if (EN_PROCESO.includes(e)) return 'proceso';
  return e;
}

function pintar() {
  const items = lista.filter((n) => filtro === 'todos' || n.producto === filtro);
  if (!items.length) {
    $('#lista').innerHTML = `<div class="vacio">${lista.length ? 'No hay negocios de este producto.' : 'Todavía no creaste ningún negocio. Tocá <b>+ Nuevo negocio</b> para empezar.'}</div>`;
    return;
  }
  $('#lista').innerHTML = items.map((n) => {
    const proceso = EN_PROCESO.includes(n.estado);
    const fecha = new Date(n.creado).toLocaleDateString('es-UY', { day: '2-digit', month: 'short', year: 'numeric' });
    const acciones = [];
    if (n.estado === 'activo') {
      acciones.push(`<a class="btn mini" href="${esc(n.url)}" target="_blank" rel="noopener">Abrir</a>`);
      acciones.push(`<button class="btn ghost mini" data-acc="suspender" data-id="${n.id}">Suspender</button>`);
    }
    if (n.estado === 'suspendido') acciones.push(`<button class="btn mini" data-acc="reactivar" data-id="${n.id}">Reactivar</button>`);
    if (['activo', 'error'].includes(n.estado)) acciones.push(`<button class="btn ghost mini" data-acc="redesplegar" data-id="${n.id}">Redesplegar</button>`);
    if (!proceso) acciones.push(`<button class="btn ghost mini" data-acc="eliminar" data-id="${n.id}">Eliminar</button>`);
    return `<article class="neg">
      <div class="neg-ic ${esc(n.producto)}" aria-hidden="true">${n.producto === 'eatsy' ? 'E' : 'S'}</div>
      <div>
        <h3>${esc(n.nombre)} <span class="estado ${claseEstado(n.estado)}">${esc(TEXTO_ESTADO[n.estado] || n.estado)}</span>
          ${n.modo === 'demo' ? '<span class="tag">demo</span>' : ''}</h3>
        <div class="meta">
          <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.url.replace('https://', ''))}</a>
          <span>${n.producto === 'eatsy' ? 'Eatsy' : 'Stockify'}</span>
          <span>admin: <code>${esc(n.admin_user)}</code></span>
          <span>creado ${esc(fecha)}</span>
        </div>
      </div>
      <div class="neg-acc">${acciones.join('')}</div>
      ${proceso ? '<p class="muted small" style="grid-column:1/-1">Esto tarda unos minutos (crea la base, construye la app y saca el certificado HTTPS). Podés cerrar esta página.</p>' : ''}
      ${n.estado === 'error' && n.error ? `<pre class="err">${esc(n.error)}</pre>` : ''}
    </article>`;
  }).join('');
}

async function cargar() {
  clearTimeout(cargar.t);
  try {
    lista = await api('GET', '/negocios');
    pintar();
  } catch (ex) {
    if ($('#vista-panel').hidden) return;
    $('#lista').innerHTML = `<div class="vacio">No se pudo cargar la lista: ${esc(ex.message)}</div>`;
  }
  const hayProceso = lista.some((n) => EN_PROCESO.includes(n.estado));
  cargar.t = setTimeout(cargar, hayProceso ? 5000 : 30000);
}

$('#lista').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acc]');
  if (!b) return;
  const n = lista.find((x) => x.id === Number(b.dataset.id));
  if (!n) return;
  if (b.dataset.acc === 'eliminar') return abrirBorrar(n);
  const textos = { suspender: `¿Suspender ${n.nombre}? La app deja de estar disponible hasta que la reactives.`, reactivar: null, redesplegar: `¿Redesplegar ${n.nombre} con la última versión del código?` };
  if (textos[b.dataset.acc] && !confirm(textos[b.dataset.acc])) return;
  b.disabled = true;
  try {
    await api('POST', `/negocios/${n.id}/${b.dataset.acc}`);
    toast({ suspender: 'Negocio suspendido.', reactivar: 'Reactivando…', redesplegar: 'Redesplegando…' }[b.dataset.acc]);
    cargar();
  } catch (ex) {
    toast(ex.message);
    b.disabled = false;
  }
});

// ---------- Alta ----------
const dlg = $('#dlg-nuevo');
const fn = $('#form-nuevo');
let slugEditado = false;

$('#btn-nuevo').addEventListener('click', () => {
  fn.reset();
  slugEditado = false;
  $('#nuevo-error').hidden = true;
  fn.admin_password.value = generarClave();
  dlg.showModal();
  fn.nombre.focus();
});
$('#btn-cancelar').addEventListener('click', () => dlg.close());

function generarClave() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (x) => abc[x % abc.length]).join('');
}
$('#btn-generar').addEventListener('click', () => { fn.admin_password.value = generarClave(); });

const slugLocal = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
fn.nombre.addEventListener('input', () => { if (!slugEditado) fn.slug.value = slugLocal(fn.nombre.value); });
fn.slug.addEventListener('input', () => { slugEditado = true; fn.slug.value = fn.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });

fn.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-crear');
  const err = $('#nuevo-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const datos = Object.fromEntries(new FormData(fn));
    await api('POST', '/negocios', datos);
    dlg.close();
    toast(`Creando ${datos.slug}.${$('.dom').textContent}… tarda unos minutos.`);
    cargar();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear negocio';
  }
});

// ---------- Baja ----------
const dlgB = $('#dlg-borrar');
let aBorrar = null;
function abrirBorrar(n) {
  aBorrar = n;
  $('#borrar-host').textContent = n.url.replace('https://', '');
  $('#borrar-slug').textContent = n.slug;
  $('#borrar-error').hidden = true;
  $('#form-borrar').reset();
  dlgB.showModal();
}
$('#btn-no-borrar').addEventListener('click', () => dlgB.close());
$('#form-borrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const conf = e.target.confirmar.value.trim();
  if (conf !== aBorrar.slug) {
    $('#borrar-error').textContent = 'El subdominio no coincide.';
    $('#borrar-error').hidden = false;
    return;
  }
  const btn = e.target.querySelector('.peligro');
  btn.disabled = true;
  try {
    await api('DELETE', `/negocios/${aBorrar.id}`, { confirmar: conf });
    dlgB.close();
    toast(`${aBorrar.nombre} eliminado.`);
    cargar();
  } catch (ex) {
    $('#borrar-error').textContent = ex.message;
    $('#borrar-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Inicio ----------
async function iniciar() {
  try {
    const s = await api('GET', '/sesion');
    document.querySelectorAll('.dom').forEach((d) => { d.textContent = s.dominio; });
    $('#vista-login').hidden = true;
    $('#vista-panel').hidden = false;
    cargar();
  } catch {
    mostrarLogin();
  }
}
iniciar();
