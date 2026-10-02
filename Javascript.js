/* =========================================================================
   SEVIDA · Sociedad de Jóvenes — Sistema de Rendición de Cuentas
   Javascript.js
   ========================================================================= */

/* ---------- 1. FIREBASE ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcZ8_1HxETxITytNW6p-tOTppvKihYiNM",
  authDomain: "proyecto-sociedad-f4a0f.firebaseapp.com",
  projectId: "proyecto-sociedad-f4a0f",
  storageBucket: "proyecto-sociedad-f4a0f.firebasestorage.app",
  messagingSenderId: "584833158045",
  appId: "1:584833158045:web:641cefb40ea3ce513f3d74",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Segunda instancia de Firebase — se usa SOLO para crear cuentas de miembros
// sin cerrar la sesión del administrador que las está creando.
const appSecundaria = initializeApp(firebaseConfig, "Secundaria");
const authSecundaria = getAuth(appSecundaria);

// Todos los datos de este sistema viven bajo esta ruta, separados por completo
// del sistema de inventario que ya usa este mismo proyecto de Firebase.
const RUTA = {
  movimientos: "sociedad_jovenes/main/movimientos",
  periodos: "sociedad_jovenes/main/periodos",
  categorias: "sociedad_jovenes/main/categorias",
  usuarios: "sociedad_jovenes/main/usuarios",
  configuracion: "sociedad_jovenes/main/configuracion",
  actividades: "sociedad_jovenes/main/actividades",
};

/* ---------- 2. ESTADO GLOBAL ---------- */
const estado = {
  usuarioActual: null,
  movimientos: [],
  periodos: [],
  categorias: [],
  usuarios: [],
  actividades: [],
  configuracion: {
    nombreSociedad: "Sociedad de Jóvenes Sembradores de Vida (SEVIDA)",
    nombreIglesia: 'Iglesia Evangélica Luterana Boliviana — Congregación "El Buen Pastor"',
    emailContacto: "sembradoresvida.ielb@gmail.com",
    direccion: "Calle Alacama N° 361 Zona Munaypata",
    saldoInicialGeneral: 0,
  },
  vistaActual: "dashboard",
  informeActual: null,
};

const CATEGORIAS_INGRESO_DEFECTO = ["Ofrendas", "Donaciones", "Actividades", "Cuotas", "Otros ingresos"];
const CATEGORIAS_EGRESO_DEFECTO = ["Alimentación", "Transporte", "Materiales", "Evangelismo", "Actividades", "Ayuda social", "Música", "Otros gastos"];

/* ---------- 3. UTILIDADES ---------- */
function formatearMoneda(monto) {
  const n = Number(monto) || 0;
  return "Bs " + n.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearFecha(valor) {
  const d = valor && valor.toDate ? valor.toDate() : (valor instanceof Date ? valor : new Date(valor));
  return d.toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function valorInputFecha(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function badgeComprobante(m) {
  return m.comprobanteURL
    ? '<span class="badge-comprobante-si">✓ Adjunto</span>'
    : '<span class="badge-comprobante-no">⚠ Falta</span>';
}

let toastTimeout;
function mostrarToast(mensaje, tipo = "info") {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimeout);
  toast.textContent = mensaje;
  toast.className = "toast" + (tipo === "exito" ? " toast-exito" : tipo === "error" ? " toast-error" : "");
  toast.classList.remove("oculto");
  toastTimeout = setTimeout(() => toast.classList.add("oculto"), 4200);
}

function abrirModal(id) {
  document.getElementById(id).classList.remove("oculto");
  document.body.style.overflow = "hidden";
}
function cerrarModal(id) {
  document.getElementById(id).classList.add("oculto");
  document.body.style.overflow = "";
}

/* ---------- 4. PERÍODOS TRIMESTRALES ---------- */
function calcularPeriodo(fecha) {
  const mes = fecha.getMonth() + 1;
  const anio = fecha.getFullYear();
  const trimestre = Math.ceil(mes / 3);
  return { id: `${anio}-T${trimestre}`, anio, trimestre };
}
function nombreTrimestre(trimestre) {
  return { 1: "Enero - Marzo", 2: "Abril - Junio", 3: "Julio - Septiembre", 4: "Octubre - Diciembre" }[trimestre];
}
function limitesPeriodo(anio, trimestre) {
  const mesInicio = (trimestre - 1) * 3;
  const inicio = new Date(anio, mesInicio, 1, 0, 0, 0);
  const fin = new Date(anio, mesInicio + 3, 0, 23, 59, 59);
  return { inicio, fin };
}
function parsearIdPeriodo(id) {
  const [anioStr, tStr] = id.split("-T");
  return { anio: parseInt(anioStr, 10), trimestre: parseInt(tStr, 10) };
}
async function asegurarPeriodoExiste(periodoId) {
  if (estado.periodos.some((p) => p.id === periodoId)) return;
  const { anio, trimestre } = parsearIdPeriodo(periodoId);
  const { inicio, fin } = limitesPeriodo(anio, trimestre);
  await setDoc(doc(db, RUTA.periodos, periodoId), {
    anio, trimestre, nombre: `${nombreTrimestre(trimestre)} ${anio}`,
    fechaInicio: Timestamp.fromDate(inicio), fechaFin: Timestamp.fromDate(fin),
    cerrado: false, fechaCierre: null, cerradoPor: null,
  });
  await cargarPeriodos();
}
function listaPeriodosDisponibles() {
  const actual = calcularPeriodo(new Date());
  const mapa = new Map();
  estado.periodos.forEach((p) => mapa.set(p.id, p));
  if (!mapa.has(actual.id)) {
    const { inicio, fin } = limitesPeriodo(actual.anio, actual.trimestre);
    mapa.set(actual.id, {
      id: actual.id, anio: actual.anio, trimestre: actual.trimestre,
      nombre: `${nombreTrimestre(actual.trimestre)} ${actual.anio}`,
      cerrado: false, fechaInicio: Timestamp.fromDate(inicio), fechaFin: Timestamp.fromDate(fin),
    });
  }
  return [...mapa.values()].sort((a, b) => b.id.localeCompare(a.id));
}

/* ---------- 5. CARGA DE DATOS ---------- */
async function cargarMovimientos() {
  const snap = await getDocs(collection(db, RUTA.movimientos));
  estado.movimientos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function cargarPeriodos() {
  const snap = await getDocs(collection(db, RUTA.periodos));
  estado.periodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function cargarCategorias() {
  const snap = await getDocs(collection(db, RUTA.categorias));
  estado.categorias = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
async function cargarConfiguracion() {
  const snap = await getDoc(doc(db, RUTA.configuracion, "general"));
  if (snap.exists()) estado.configuracion = { ...estado.configuracion, ...snap.data() };
}
async function cargarActividades() {
  const snap = await getDocs(collection(db, RUTA.actividades));
  estado.actividades = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
async function cargarUsuarios() {
  if (estado.usuarioActual.rol !== "admin") return;
  const snap = await getDocs(collection(db, RUTA.usuarios));
  estado.usuarios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function sembrarCategoriasSiVacio() {
  if (estado.categorias.length > 0) return;
  for (const nombre of CATEGORIAS_INGRESO_DEFECTO) await addDoc(collection(db, RUTA.categorias), { nombre, tipo: "ingreso", activo: true });
  for (const nombre of CATEGORIAS_EGRESO_DEFECTO) await addDoc(collection(db, RUTA.categorias), { nombre, tipo: "egreso", activo: true });
  await cargarCategorias();
}
async function cargarDatosIniciales() {
  await Promise.all([cargarMovimientos(), cargarPeriodos(), cargarCategorias(), cargarConfiguracion(), cargarActividades()]);
  if (estado.categorias.length === 0 && estado.usuarioActual.rol === "admin") {
    await sembrarCategoriasSiVacio();
  }
}

/* ---------- 6. AUTENTICACIÓN ---------- */
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = document.getElementById("btn-login");
  const errorBox = document.getElementById("login-error");
  errorBox.classList.add("oculto");
  btn.disabled = true; btn.textContent = "Ingresando…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    let msg = "No se pudo iniciar sesión. Intenta nuevamente.";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(err.code)) msg = "Correo o contraseña incorrectos.";
    if (err.code === "auth/too-many-requests") msg = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
    if (err.code === "auth/invalid-email") msg = "El correo no es válido.";
    errorBox.textContent = msg;
    errorBox.classList.remove("oculto");
  } finally {
    btn.disabled = false; btn.textContent = "Ingresar";
  }
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snapUsuario = await getDoc(doc(db, RUTA.usuarios, user.uid));
      if (!snapUsuario.exists()) {
        const errorBox = document.getElementById("login-error");
        errorBox.textContent = "Esta cuenta no está habilitada en el sistema. Contacta al administrador.";
        errorBox.classList.remove("oculto");
        await signOut(auth);
        return;
      }
      estado.usuarioActual = { uid: user.uid, ...snapUsuario.data() };

      document.getElementById("usuario-nombre").textContent = estado.usuarioActual.nombre || estado.usuarioActual.email;
      document.getElementById("usuario-rol").textContent = estado.usuarioActual.rol === "admin" ? "Administrador" : "Miembro";
      document.querySelectorAll(".solo-admin").forEach((el) => el.classList.toggle("oculto", estado.usuarioActual.rol !== "admin"));

      document.getElementById("pantalla-login").classList.add("oculto");
      document.getElementById("app").classList.remove("oculto");
      document.getElementById("form-login").reset();

      await cargarDatosIniciales();
      mostrarVista("dashboard");
    } catch (err) {
      console.error(err);
      mostrarToast("Ocurrió un error al cargar tu cuenta.", "error");
    }
  } else {
    estado.usuarioActual = null;
    document.getElementById("app").classList.add("oculto");
    document.getElementById("pantalla-login").classList.remove("oculto");
  }
});

/* ---------- 7. NAVEGACIÓN ---------- */
const RENDERIZADORES = {
  dashboard: renderizarDashboard,
  ingresos: () => renderizarTablaTipo("ingreso"),
  egresos: () => renderizarTablaTipo("egreso"),
  historial: renderizarHistorial,
  informes: prepararVistaInformes,
  actividades: renderizarActividades,
  categorias: renderizarCategorias,
  usuarios: async () => { await cargarUsuarios(); renderizarUsuarios(); },
  configuracion: cargarFormularioConfiguracion,
};

function mostrarVista(nombre) {
  document.querySelectorAll(".vista").forEach((v) => v.classList.add("oculto"));
  const vista = document.getElementById(`vista-${nombre}`);
  if (vista) vista.classList.remove("oculto");
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("nav-activo", a.dataset.vista === nombre));
  estado.vistaActual = nombre;
  cerrarSidebarMovil();
  const render = RENDERIZADORES[nombre];
  if (render) render();
}
function actualizarVistaActual() {
  const render = RENDERIZADORES[estado.vistaActual];
  if (render) render();
}
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarVista(link.dataset.vista);
  });
});

function abrirSidebarMovil() {
  document.getElementById("sidebar").classList.add("sidebar-abierto");
  document.getElementById("fondo-sidebar-movil").classList.remove("oculto");
}
function cerrarSidebarMovil() {
  document.getElementById("sidebar").classList.remove("sidebar-abierto");
  document.getElementById("fondo-sidebar-movil").classList.add("oculto");
}
document.getElementById("btn-menu-movil").addEventListener("click", abrirSidebarMovil);
document.getElementById("fondo-sidebar-movil").addEventListener("click", cerrarSidebarMovil);

/* ---------- 8. MODALES: cierre genérico ---------- */
document.querySelectorAll("[data-cerrar]").forEach((btn) => {
  btn.addEventListener("click", () => cerrarModal(btn.dataset.cerrar));
});
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(modal.id); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal:not(.oculto)").forEach((m) => cerrarModal(m.id));
});

// Delegación de clics para botones generados dinámicamente (filas de tablas)
document.body.addEventListener("click", (evento) => {
  const botonAccion = evento.target.closest("[data-accion]");
  if (botonAccion) {
    const id = botonAccion.dataset.id;
    const accion = botonAccion.dataset.accion;
    if (accion === "ver-comprobante") mostrarComprobante(botonAccion.dataset.url, botonAccion.dataset.nombre);
    else if (accion === "ver-movimiento") abrirModalMovimientoExistente(id);
    else if (accion === "quitar-usuario") quitarUsuario(id, botonAccion.dataset.nombre);
    return;
  }
  const fila = evento.target.closest("tr[data-id]");
  if (fila && fila.closest("tbody")) abrirModalMovimientoExistente(fila.dataset.id);
});

function mostrarComprobante(url, nombre) {
  const contenedor = document.getElementById("comprobante-contenido");
  const esPDF = /\.pdf($|\?)/i.test(nombre || url);
  if (esPDF) {
    contenedor.innerHTML = `<p>${escaparHTML(nombre || "Documento PDF")}</p><a href="${url}" target="_blank" rel="noopener" class="btn btn-primario btn-ancho">Abrir PDF en una pestaña nueva</a>`;
  } else {
    contenedor.innerHTML = `<img src="${url}" alt="Comprobante" style="width:100%;border-radius:10px;display:block;">`;
  }
  abrirModal("modal-comprobante");
}

/* ---------- 9. DASHBOARD ---------- */
function renderizarDashboard() {
  const activos = estado.movimientos.filter((m) => m.estado === "activo");
  const ingresos = activos.filter((m) => m.tipo === "ingreso");
  const egresos = activos.filter((m) => m.tipo === "egreso");
  const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalEgresos = egresos.reduce((s, m) => s + m.monto, 0);
  const saldoActual = (estado.configuracion.saldoInicialGeneral || 0) + totalIngresos - totalEgresos;

  document.getElementById("dash-saldo").textContent = formatearMoneda(saldoActual);
  document.getElementById("dash-total-ingresos").textContent = formatearMoneda(totalIngresos);
  document.getElementById("dash-total-egresos").textContent = formatearMoneda(totalEgresos);
  document.getElementById("dash-cant-ingresos").textContent = ingresos.length;
  document.getElementById("dash-cant-egresos").textContent = egresos.length;

  const { trimestre, anio } = calcularPeriodo(new Date());
  document.getElementById("dash-periodo-actual").textContent = `Período actual: ${nombreTrimestre(trimestre)} ${anio}`;

  const conComprobante = estado.movimientos.filter((m) => m.comprobanteURL).length;
  const sinComprobante = activos.filter((m) => !m.comprobanteURL).length;
  document.getElementById("dash-con-comprobante").textContent = conComprobante;
  document.getElementById("dash-sin-comprobante").textContent = sinComprobante;

  const recientes = [...estado.movimientos].sort((a, b) => (b.creadoEn?.toMillis() || 0) - (a.creadoEn?.toMillis() || 0)).slice(0, 8);
  const tbody = document.getElementById("dash-tabla-recientes");
  tbody.innerHTML = recientes.length
    ? recientes.map(filaRecienteHTML).join("")
    : '<tr><td colspan="7" class="celda-vacia">Todavía no hay movimientos registrados.</td></tr>';
}
function filaRecienteHTML(m) {
  return `<tr data-id="${m.id}" class="fila-clicable ${m.estado === "anulado" ? "fila-anulada" : ""}">
    <td>${formatearFecha(m.fecha)}</td>
    <td>${m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</td>
    <td>${escaparHTML(m.concepto)}</td>
    <td>${escaparHTML(m.categoria)}</td>
    <td class="num ${m.tipo === "ingreso" ? "texto-ingreso" : "texto-egreso"}">${formatearMoneda(m.monto)}</td>
    <td>${badgeComprobante(m)}</td>
    <td><button class="btn-fila" data-accion="ver-movimiento" data-id="${m.id}" type="button">Ver</button></td>
  </tr>`;
}

/* ---------- 10. TABLAS DE INGRESOS / EGRESOS ---------- */
function renderizarTablaTipo(tipo) {
  const lista = estado.movimientos.filter((m) => m.tipo === tipo).sort((a, b) => b.fecha.toDate() - a.fecha.toDate());
  const tbody = document.getElementById(tipo === "ingreso" ? "tabla-ingresos" : "tabla-egresos");
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="celda-vacia">Todavía no hay ${tipo === "ingreso" ? "ingresos" : "egresos"} registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map((m) => `
    <tr data-id="${m.id}" class="fila-clicable ${m.estado === "anulado" ? "fila-anulada" : ""}">
      <td>${m.numero}</td>
      <td>${formatearFecha(m.fecha)}</td>
      <td>${escaparHTML(m.concepto)}</td>
      <td>${escaparHTML(m.categoria)}</td>
      <td>${escaparHTML(m.responsable)}</td>
      <td class="num ${tipo === "ingreso" ? "texto-ingreso" : "texto-egreso"}">${formatearMoneda(m.monto)}</td>
      <td>${badgeComprobante(m)}</td>
      <td><button class="btn-fila" data-accion="ver-movimiento" data-id="${m.id}" type="button">Ver</button></td>
    </tr>`).join("");
}
document.getElementById("btn-nuevo-ingreso").addEventListener("click", () => abrirModalNuevoMovimiento("ingreso"));
document.getElementById("btn-nuevo-egreso").addEventListener("click", () => abrirModalNuevoMovimiento("egreso"));

/* ---------- 11. MODAL DE MOVIMIENTO ---------- */
function poblarSelectCategorias(tipo) {
  const sel = document.getElementById("mov-categoria");
  const opciones = estado.categorias.filter((c) => c.tipo === tipo);
  sel.innerHTML = opciones.length
    ? opciones.map((c) => `<option value="${escaparHTML(c.nombre)}">${escaparHTML(c.nombre)}</option>`).join("")
    : '<option value="">(agrega categorías primero)</option>';
}
function poblarSelectActividades(actividadIdSeleccionada) {
  const sel = document.getElementById("mov-actividad");
  sel.innerHTML = '<option value="">Selecciona una actividad…</option>' +
    estado.actividades.map((a) => `<option value="${a.id}">${escaparHTML(a.nombre)}</option>`).join("") +
    '<option value="__nueva__">+ Crear nueva actividad</option>';
  if (actividadIdSeleccionada) sel.value = actividadIdSeleccionada;
}
function habilitarCamposMovimiento(habilitar) {
  ["mov-fecha", "mov-concepto", "mov-categoria", "mov-responsable", "mov-proveedor", "mov-monto", "mov-metodo", "mov-observacion", "mov-comprobante",
    "mov-modo-individual", "mov-modo-actividad", "mov-actividad", "mov-actividad-nueva"]
    .forEach((id) => { document.getElementById(id).disabled = !habilitar; });
}
function limpiarFormularioMovimiento() {
  document.getElementById("form-movimiento").reset();
  document.getElementById("mov-id-edicion").value = "";
  document.getElementById("mov-numero-display").textContent = "Se asignará al guardar";
  document.getElementById("mov-fecha").value = valorInputFecha(new Date());
  document.getElementById("mov-comprobante-actual").classList.add("oculto");
  document.getElementById("mov-comprobante-actual").innerHTML = "";
  document.getElementById("mov-estado-info").classList.add("oculto");
  document.getElementById("mov-modo-individual").checked = true;
  document.getElementById("campo-actividad").classList.add("oculto");
  document.getElementById("mov-actividad-nueva").classList.add("oculto");
  document.getElementById("mov-actividad-nueva").value = "";
  poblarSelectActividades();
  habilitarCamposMovimiento(true);
  document.getElementById("btn-anular-movimiento").classList.add("oculto");
  document.getElementById("btn-habilitar-edicion").classList.add("oculto");
  document.getElementById("btn-guardar-movimiento").classList.remove("oculto");
}

function abrirModalNuevoMovimiento(tipo) {
  limpiarFormularioMovimiento();
  document.getElementById("mov-tipo").value = tipo;
  document.getElementById("modal-movimiento-titulo").textContent = tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo egreso";
  document.getElementById("label-metodo").textContent = tipo === "ingreso" ? "Método de ingreso" : "Método de pago";
  document.getElementById("campo-proveedor").classList.toggle("oculto", tipo !== "egreso");
  poblarSelectCategorias(tipo);
  abrirModal("modal-movimiento");
}

function abrirModalMovimientoExistente(id) {
  const m = estado.movimientos.find((x) => x.id === id);
  if (!m) return;
  limpiarFormularioMovimiento();
  document.getElementById("mov-id-edicion").value = m.id;
  document.getElementById("mov-tipo").value = m.tipo;
  document.getElementById("modal-movimiento-titulo").textContent = `Detalle de ${m.tipo === "ingreso" ? "ingreso" : "egreso"} N° ${m.numero}`;
  document.getElementById("label-metodo").textContent = m.tipo === "ingreso" ? "Método de ingreso" : "Método de pago";
  document.getElementById("campo-proveedor").classList.toggle("oculto", m.tipo !== "egreso");
  poblarSelectCategorias(m.tipo);

  document.getElementById("mov-numero-display").textContent = m.numero;
  document.getElementById("mov-fecha").value = valorInputFecha(m.fecha.toDate());
  document.getElementById("mov-concepto").value = m.concepto;
  document.getElementById("mov-categoria").value = m.categoria;
  document.getElementById("mov-responsable").value = m.responsable;
  document.getElementById("mov-proveedor").value = m.proveedor || "";
  document.getElementById("mov-monto").value = m.monto;
  document.getElementById("mov-metodo").value = m.metodo || "Efectivo";
  document.getElementById("mov-observacion").value = m.observacion || "";

  if (m.actividadId) {
    document.getElementById("mov-modo-actividad").checked = true;
    document.getElementById("campo-actividad").classList.remove("oculto");
    poblarSelectActividades(m.actividadId);
  } else {
    document.getElementById("mov-modo-individual").checked = true;
    document.getElementById("campo-actividad").classList.add("oculto");
  }

  if (m.comprobanteURL) {
    const cont = document.getElementById("mov-comprobante-actual");
    cont.classList.remove("oculto");
    cont.innerHTML = `✓ Comprobante actual: <button type="button" data-accion="ver-comprobante" data-url="${m.comprobanteURL}" data-nombre="${escaparHTML(m.comprobanteNombre || "")}" class="btn-fila" style="text-decoration:underline;">${escaparHTML(m.comprobanteNombre || "ver archivo")}</button>`;
  }
  if (m.estado === "anulado") {
    const info = document.getElementById("mov-estado-info");
    info.classList.remove("oculto");
    info.textContent = `Este movimiento fue anulado. Motivo: ${m.motivoAnulacion || "no especificado"}`;
  }

  const periodo = estado.periodos.find((p) => p.id === m.periodoId);
  const periodoCerrado = periodo ? periodo.cerrado : false;
  const puedeGestionar = estado.usuarioActual.rol === "admin" && m.estado === "activo";

  habilitarCamposMovimiento(false);
  document.getElementById("btn-guardar-movimiento").classList.add("oculto");
  document.getElementById("btn-anular-movimiento").classList.toggle("oculto", !puedeGestionar);
  document.getElementById("btn-habilitar-edicion").classList.toggle("oculto", !puedeGestionar || periodoCerrado);

  abrirModal("modal-movimiento");
}

document.getElementById("btn-habilitar-edicion").addEventListener("click", () => {
  habilitarCamposMovimiento(true);
  document.getElementById("btn-habilitar-edicion").classList.add("oculto");
  document.getElementById("btn-guardar-movimiento").classList.remove("oculto");
});
document.getElementById("btn-anular-movimiento").addEventListener("click", () => {
  const id = document.getElementById("mov-id-edicion").value;
  if (id) anularMovimiento(id);
});

document.querySelectorAll('input[name="mov-modo"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const esActividad = document.getElementById("mov-modo-actividad").checked;
    document.getElementById("campo-actividad").classList.toggle("oculto", !esActividad);
    if (!esActividad) document.getElementById("mov-actividad-nueva").classList.add("oculto");
  });
});
document.getElementById("mov-actividad").addEventListener("change", (e) => {
  document.getElementById("mov-actividad-nueva").classList.toggle("oculto", e.target.value !== "__nueva__");
});

async function subirComprobante(archivo, tipo) {
  const nombreSeguro = `${Date.now()}_${archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const referencia = ref(storage, `sociedad_jovenes/comprobantes/${tipo}/${nombreSeguro}`);
  await uploadBytes(referencia, archivo);
  const url = await getDownloadURL(referencia);
  return { url, nombre: archivo.name };
}

async function obtenerSiguienteNumero(tipo) {
  const referencia = doc(db, RUTA.configuracion, "contadores");
  return runTransaction(db, async (transaccion) => {
    const snap = await transaccion.get(referencia);
    const datos = snap.exists() ? snap.data() : { ultimoIngreso: 0, ultimoEgreso: 0 };
    const campo = tipo === "ingreso" ? "ultimoIngreso" : "ultimoEgreso";
    const siguiente = (datos[campo] || 0) + 1;
    transaccion.set(referencia, { ...datos, [campo]: siguiente }, { merge: true });
    return siguiente;
  });
}

document.getElementById("form-movimiento").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const idEdicion = document.getElementById("mov-id-edicion").value;
  if (idEdicion && estado.usuarioActual.rol !== "admin") {
    mostrarToast("Solo el administrador puede modificar un movimiento existente.", "error");
    return;
  }

  const tipo = document.getElementById("mov-tipo").value;
  const fechaStr = document.getElementById("mov-fecha").value;
  const fecha = new Date(fechaStr + "T00:00:00");
  const concepto = document.getElementById("mov-concepto").value.trim();
  const categoria = document.getElementById("mov-categoria").value;
  const responsable = document.getElementById("mov-responsable").value.trim();
  const proveedor = document.getElementById("mov-proveedor").value.trim();
  const monto = parseFloat(document.getElementById("mov-monto").value);
  const metodo = document.getElementById("mov-metodo").value;
  const observacion = document.getElementById("mov-observacion").value.trim();
  const archivo = document.getElementById("mov-comprobante").files[0];
  const modoActividad = document.getElementById("mov-modo-actividad").checked;
  const valorActividadSel = document.getElementById("mov-actividad").value;
  const nombreActividadNueva = document.getElementById("mov-actividad-nueva").value.trim();

  if (!fechaStr || !concepto || !categoria || !responsable || isNaN(monto) || monto <= 0) {
    mostrarToast("Completa todos los campos obligatorios con valores válidos.", "error");
    return;
  }
  if (modoActividad && !valorActividadSel) {
    mostrarToast("Selecciona una actividad o crea una nueva.", "error");
    return;
  }
  if (modoActividad && valorActividadSel === "__nueva__" && !nombreActividadNueva) {
    mostrarToast("Escribe el nombre de la nueva actividad.", "error");
    return;
  }

  const btnGuardar = document.getElementById("btn-guardar-movimiento");
  btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";

  try {
    const { id: periodoId } = calcularPeriodo(fecha);

    let actividadId = null, actividadNombre = null;
    if (modoActividad) {
      if (valorActividadSel === "__nueva__") {
        const creada = await crearActividad(nombreActividadNueva);
        actividadId = creada.id;
        actividadNombre = creada.nombre;
      } else {
        actividadId = valorActividadSel;
        actividadNombre = estado.actividades.find((a) => a.id === valorActividadSel)?.nombre || "";
      }
    }

    if (idEdicion) {
      const movOriginal = estado.movimientos.find((m) => m.id === idEdicion);
      const periodoOriginal = estado.periodos.find((p) => p.id === movOriginal?.periodoId);
      if (periodoOriginal && periodoOriginal.cerrado) {
        mostrarToast("No se puede editar un movimiento de un período cerrado. Anúlalo y registra uno nuevo si necesitas corregirlo.", "error");
        return;
      }
      const datosActualizados = {
        fecha: Timestamp.fromDate(fecha), concepto, categoria, responsable,
        proveedor: tipo === "egreso" ? proveedor : "", monto, metodo, observacion,
        actividadId, actividadNombre,
        periodoId, actualizadoEn: serverTimestamp(),
      };
      if (archivo) {
        const comprobante = await subirComprobante(archivo, tipo);
        datosActualizados.comprobanteURL = comprobante.url;
        datosActualizados.comprobanteNombre = comprobante.nombre;
      }
      await updateDoc(doc(db, RUTA.movimientos, idEdicion), datosActualizados);
      await asegurarPeriodoExiste(periodoId);
      mostrarToast("Movimiento actualizado correctamente.", "exito");
    } else {
      const numero = await obtenerSiguienteNumero(tipo);
      let comprobante = null;
      if (archivo) comprobante = await subirComprobante(archivo, tipo);
      await addDoc(collection(db, RUTA.movimientos), {
        numero, tipo, fecha: Timestamp.fromDate(fecha), concepto, categoria, responsable,
        proveedor: tipo === "egreso" ? proveedor : "", monto, metodo, observacion,
        comprobanteURL: comprobante ? comprobante.url : null,
        comprobanteNombre: comprobante ? comprobante.nombre : null,
        actividadId, actividadNombre,
        periodoId, estado: "activo", motivoAnulacion: null,
        creadoPor: estado.usuarioActual.uid, creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
      });
      await asegurarPeriodoExiste(periodoId);
      mostrarToast(`${tipo === "ingreso" ? "Ingreso" : "Egreso"} registrado correctamente.`, "exito");
    }

    cerrarModal("modal-movimiento");
    await cargarMovimientos();
    actualizarVistaActual();
  } catch (error) {
    console.error(error);
    mostrarToast("Ocurrió un error al guardar. Revisa tu conexión e inténtalo de nuevo.", "error");
  } finally {
    btnGuardar.disabled = false; btnGuardar.textContent = "Guardar";
  }
});

async function anularMovimiento(id) {
  const motivo = prompt("Indica el motivo de la anulación (quedará registrado en el historial):");
  if (motivo === null) return;
  if (!motivo.trim()) { mostrarToast("Debes indicar un motivo para anular.", "error"); return; }
  try {
    await updateDoc(doc(db, RUTA.movimientos, id), { estado: "anulado", motivoAnulacion: motivo.trim(), actualizadoEn: serverTimestamp() });
    mostrarToast("Movimiento anulado.", "exito");
    cerrarModal("modal-movimiento");
    await cargarMovimientos();
    actualizarVistaActual();
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo anular el movimiento.", "error");
  }
}

/* ---------- 12. HISTORIAL ---------- */
function poblarFiltrosHistorial() {
  const selCat = document.getElementById("hist-categoria");
  const catActual = selCat.value;
  const nombresCategorias = [...new Set(estado.categorias.map((c) => c.nombre))].sort();
  selCat.innerHTML = '<option value="">Todas</option>' + nombresCategorias.map((n) => `<option value="${escaparHTML(n)}">${escaparHTML(n)}</option>`).join("");
  selCat.value = catActual;

  const selPer = document.getElementById("hist-periodo");
  const perActual = selPer.value;
  const periodosOrdenados = [...estado.periodos].sort((a, b) => b.id.localeCompare(a.id));
  selPer.innerHTML = '<option value="">Todos</option>' + periodosOrdenados.map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)}</option>`).join("");
  selPer.value = perActual;

  const selAct = document.getElementById("hist-actividad");
  const actActual = selAct.value;
  selAct.innerHTML = '<option value="">Todas</option>' + estado.actividades.map((a) => `<option value="${a.id}">${escaparHTML(a.nombre)}</option>`).join("");
  selAct.value = actActual;
}
function aplicarFiltrosHistorial() {
  const texto = document.getElementById("hist-buscar").value.trim().toLowerCase();
  const tipo = document.getElementById("hist-tipo").value;
  const categoria = document.getElementById("hist-categoria").value;
  const periodo = document.getElementById("hist-periodo").value;
  const actividad = document.getElementById("hist-actividad").value;
  const desde = document.getElementById("hist-desde").value;
  const hasta = document.getElementById("hist-hasta").value;

  return estado.movimientos.filter((m) => {
    if (tipo && m.tipo !== tipo) return false;
    if (categoria && m.categoria !== categoria) return false;
    if (periodo && m.periodoId !== periodo) return false;
    if (actividad && m.actividadId !== actividad) return false;
    const fechaMov = m.fecha.toDate();
    if (desde && fechaMov < new Date(desde + "T00:00:00")) return false;
    if (hasta && fechaMov > new Date(hasta + "T23:59:59")) return false;
    if (texto && !(m.concepto.toLowerCase().includes(texto) || String(m.numero).includes(texto))) return false;
    return true;
  }).sort((a, b) => b.fecha.toDate() - a.fecha.toDate());
}
function renderizarHistorial() {
  poblarFiltrosHistorial();
  const resultados = aplicarFiltrosHistorial();
  document.getElementById("historial-contador").textContent = `${resultados.length} movimiento(s) encontrado(s).`;
  const tbody = document.getElementById("tabla-historial");
  if (resultados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="celda-vacia">No se encontraron movimientos con esos filtros.</td></tr>';
    return;
  }
  tbody.innerHTML = resultados.map((m) => `
    <tr data-id="${m.id}" class="fila-clicable ${m.estado === "anulado" ? "fila-anulada" : ""}">
      <td>${m.numero}</td>
      <td>${formatearFecha(m.fecha)}</td>
      <td>${m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</td>
      <td>${escaparHTML(m.concepto)}</td>
      <td>${escaparHTML(m.categoria)}</td>
      <td>${m.actividadNombre ? escaparHTML(m.actividadNombre) : "—"}</td>
      <td>${escaparHTML(m.responsable)}</td>
      <td class="num ${m.tipo === "ingreso" ? "texto-ingreso" : "texto-egreso"}">${formatearMoneda(m.monto)}</td>
      <td>${m.estado === "anulado" ? '<span class="badge-anulado">Anulado</span>' : '<span class="badge-activo">Activo</span>'}</td>
      <td>${badgeComprobante(m)}</td>
      <td><button class="btn-fila" data-accion="ver-movimiento" data-id="${m.id}" type="button">Ver</button></td>
    </tr>`).join("");
}
["hist-buscar", "hist-tipo", "hist-categoria", "hist-periodo", "hist-actividad", "hist-desde", "hist-hasta"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderizarHistorial);
});
document.getElementById("btn-limpiar-filtros").addEventListener("click", () => {
  ["hist-buscar", "hist-tipo", "hist-categoria", "hist-periodo", "hist-actividad", "hist-desde", "hist-hasta"].forEach((id) => { document.getElementById(id).value = ""; });
  renderizarHistorial();
});

/* ---------- 13. INFORMES ---------- */
function prepararVistaInformes() {
  const sel = document.getElementById("informe-periodo");
  const actual = sel.value;
  const lista = listaPeriodosDisponibles();
  sel.innerHTML = lista.map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)}${p.cerrado ? " (cerrado)" : ""}</option>`).join("");
  if (actual && lista.some((p) => p.id === actual)) sel.value = actual;
  document.getElementById("informe-resultado").classList.add("oculto");
}
document.getElementById("btn-generar-informe").addEventListener("click", () => {
  const periodoId = document.getElementById("informe-periodo").value;
  if (periodoId) generarInforme(periodoId);
});

function calcularSaldoHasta(timestampMs) {
  const activos = estado.movimientos.filter((m) => m.estado === "activo" && m.fecha.toDate().getTime() <= timestampMs);
  const ingresos = activos.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0);
  const egresos = activos.filter((m) => m.tipo === "egreso").reduce((s, m) => s + m.monto, 0);
  return (estado.configuracion.saldoInicialGeneral || 0) + ingresos - egresos;
}

function generarInforme(periodoId) {
  const periodo = listaPeriodosDisponibles().find((p) => p.id === periodoId);
  if (!periodo) return;
  const inicioMs = periodo.fechaInicio.toDate().getTime();
  const finMs = periodo.fechaFin.toDate().getTime();

  const movimientosPeriodo = estado.movimientos.filter((m) => {
    const t = m.fecha.toDate().getTime();
    return t >= inicioMs && t <= finMs;
  });
  const ingresos = movimientosPeriodo.filter((m) => m.tipo === "ingreso" && m.estado === "activo").sort((a, b) => a.fecha.toDate() - b.fecha.toDate());
  const egresos = movimientosPeriodo.filter((m) => m.tipo === "egreso" && m.estado === "activo").sort((a, b) => a.fecha.toDate() - b.fecha.toDate());
  const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalEgresos = egresos.reduce((s, m) => s + m.monto, 0);
  const saldoInicial = calcularSaldoHasta(inicioMs - 1);
  const saldoFinal = saldoInicial + totalIngresos - totalEgresos;
  const movimientosSinComprobante = movimientosPeriodo.filter((m) => m.estado === "activo" && !m.comprobanteURL);

  estado.informeActual = { periodo, ingresos, egresos, totalIngresos, totalEgresos, saldoInicial, saldoFinal, movimientosSinComprobante };
  renderizarInformeEnPantalla();
}

function filaInformeHTML(m) {
  return `<tr><td>${formatearFecha(m.fecha)}</td><td>${m.numero}</td><td>${escaparHTML(m.concepto)}</td><td>${escaparHTML(m.categoria)}</td><td>${escaparHTML(m.responsable)}</td><td class="num">${formatearMoneda(m.monto)}</td><td>${badgeComprobante(m)}</td></tr>`;
}

function renderizarInformeEnPantalla() {
  const inf = estado.informeActual;
  const cfg = estado.configuracion;

  document.getElementById("informe-nombre-sociedad").textContent = cfg.nombreSociedad || "Sociedad de Jóvenes";
  document.getElementById("informe-nombre-iglesia").textContent = cfg.nombreIglesia || "";
  document.getElementById("informe-titulo-periodo").textContent = `Informe Trimestral — ${inf.periodo.nombre}`;
  document.getElementById("informe-fecha-generacion").textContent = `Generado el ${formatearFecha(new Date())}`;

  document.getElementById("informe-saldo-inicial").textContent = formatearMoneda(inf.saldoInicial);
  document.getElementById("informe-total-ingresos").textContent = formatearMoneda(inf.totalIngresos);
  document.getElementById("informe-total-egresos").textContent = formatearMoneda(inf.totalEgresos);
  document.getElementById("informe-saldo-final").textContent = formatearMoneda(inf.saldoFinal);

  document.getElementById("informe-tabla-ingresos").innerHTML = inf.ingresos.length
    ? inf.ingresos.map(filaInformeHTML).join("") : '<tr><td colspan="7" class="celda-vacia">Sin ingresos en este período.</td></tr>';
  document.getElementById("informe-tabla-egresos").innerHTML = inf.egresos.length
    ? inf.egresos.map(filaInformeHTML).join("") : '<tr><td colspan="7" class="celda-vacia">Sin egresos en este período.</td></tr>';

  const totalMov = inf.ingresos.length + inf.egresos.length;
  const conComprobante = totalMov - inf.movimientosSinComprobante.length;
  document.getElementById("informe-resumen-documentacion").textContent = totalMov === 0
    ? "No hay movimientos registrados en este período."
    : `${conComprobante} de ${totalMov} movimiento(s) cuentan con comprobante adjunto.` +
      (inf.movimientosSinComprobante.length ? ` Sin comprobante: ${inf.movimientosSinComprobante.map((m) => "N°" + m.numero).join(", ")}.` : "");

  const badge = document.getElementById("informe-estado-periodo");
  badge.textContent = inf.periodo.cerrado ? "Período cerrado" : "Período abierto";
  badge.className = "badge-estado " + (inf.periodo.cerrado ? "estado-cerrado" : "estado-abierto");

  document.getElementById("btn-cerrar-periodo").classList.toggle("oculto", inf.periodo.cerrado || estado.usuarioActual.rol !== "admin");
  document.getElementById("informe-resultado").classList.remove("oculto");
}

async function cerrarPeriodo(periodoId) {
  const periodo = listaPeriodosDisponibles().find((p) => p.id === periodoId);
  if (!periodo || periodo.cerrado) return;
  const hoy = new Date();
  const yaTermino = hoy > periodo.fechaFin.toDate();
  const confirmacion = yaTermino
    ? confirm(`¿Cerrar definitivamente el período ${periodo.nombre}? Sus movimientos ya no se podrán editar directamente.`)
    : confirm("Este período todavía no ha terminado. ¿Deseas cerrarlo de todas formas?");
  if (!confirmacion) return;

  try {
    await asegurarPeriodoExiste(periodoId);
    await updateDoc(doc(db, RUTA.periodos, periodoId), { cerrado: true, fechaCierre: serverTimestamp(), cerradoPor: estado.usuarioActual.uid });
    mostrarToast("Período cerrado correctamente.", "exito");
    await cargarPeriodos();
    generarInforme(periodoId);
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo cerrar el período.", "error");
  }
}
document.getElementById("btn-cerrar-periodo").addEventListener("click", () => {
  if (estado.informeActual) cerrarPeriodo(estado.informeActual.periodo.id);
});
document.getElementById("btn-imprimir-informe").addEventListener("click", () => window.print());

/* ---------- 14. EXPORTAR INFORME A WORD ---------- */
async function exportarInformeAWord() {
  if (!estado.informeActual) return;
  const btn = document.getElementById("btn-exportar-word");
  const textoOriginal = btn.textContent;
  btn.disabled = true; btn.textContent = "Generando…";

  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign, ImageRun, Footer, PageNumber } = docx;
    const ANCHO_TABLA = 10466;
    const ANCHOS = [1300, 600, 2600, 1500, 1466, 1500, 1500];
    const AZUL_BORDE = "9CC2E5";
    const AZUL_FILA = "DEEAF6";
    const VERDE_TOTAL = "00FF00";
    const CELESTE_SALDO = "00FFFF";
    const BORDE_TABLA = { style: BorderStyle.SINGLE, size: 4, color: AZUL_BORDE };
    const BORDES_TABLA = { top: BORDE_TABLA, bottom: BORDE_TABLA, left: BORDE_TABLA, right: BORDE_TABLA, insideHorizontal: BORDE_TABLA, insideVertical: BORDE_TABLA };
    const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

    // Logo del encabezado. Si por algún motivo no carga, el informe se genera igual, solo sin logo.
    let logoImagen = null;
    try {
      const respuestaLogo = await fetch("logo-sevida.png");
      const bufferLogo = await respuestaLogo.arrayBuffer();
      logoImagen = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: "png", data: bufferLogo, transformation: { width: 64, height: 64 } })],
      });
    } catch (e) {
      console.warn("No se pudo cargar el logo para el Word:", e);
    }

    // Estilo de cuadros tomado del informe de referencia de SEVIDA: encabezado en
    // blanco con la fecha en cursiva, filas de datos en celeste uniforme, bordes
    // celestes, y los totales resaltados en verde / los saldos en celeste fuerte.
    function celda(texto, opciones = {}) {
      const { encabezado = false, alinear = AlignmentType.LEFT, ancho, italica = false, resaltado = null, spanColumnas } = opciones;
      return new TableCell({
        width: { size: ancho, type: WidthType.DXA },
        columnSpan: spanColumnas,
        shading: resaltado ? { type: ShadingType.CLEAR, color: "auto", fill: resaltado } : (encabezado ? undefined : { type: ShadingType.CLEAR, color: "auto", fill: AZUL_FILA }),
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 70, bottom: 70, left: 90, right: 90 },
        children: [new Paragraph({ alignment: alinear, children: [new TextRun({ text: String(texto), bold: encabezado, italics: italica, color: "000000", size: 18 })] })],
      });
    }
    function filaTabla(valores, encabezado = false) {
      return new TableRow({ tableHeader: encabezado, children: valores.map((v, i) => celda(v, { encabezado, italica: i === 0, ancho: ANCHOS[i], alinear: i === 5 ? AlignmentType.RIGHT : AlignmentType.LEFT })) });
    }
    function filaTotalDetalle(totalMonto) {
      const anchoEtiqueta = ANCHOS[0] + ANCHOS[1] + ANCHOS[2] + ANCHOS[3] + ANCHOS[4];
      return new TableRow({ children: [
        celda("TOTAL", { italica: true, ancho: anchoEtiqueta, spanColumnas: 5, alinear: AlignmentType.RIGHT }),
        celda(formatearMoneda(totalMonto), { ancho: ANCHOS[5], alinear: AlignmentType.RIGHT, resaltado: VERDE_TOTAL }),
        celda("", { ancho: ANCHOS[6] }),
      ] });
    }
    function bloqueDetalle(lista) {
      if (lista.length === 0) return [new Paragraph({ children: [new TextRun({ text: "No se registraron movimientos en este período.", italics: true, size: 19, color: "5B7184" })] })];
      const filas = [filaTabla(["Fecha", "N°", "Concepto", "Categoría", "Responsable", "Monto", "Comprobante"], true)];
      lista.forEach((m) => filas.push(filaTabla([formatearFecha(m.fecha), String(m.numero), m.concepto, m.categoria, m.responsable, formatearMoneda(m.monto), m.comprobanteURL ? "Sí" : "No"])));
      filas.push(filaTotalDetalle(lista.reduce((s, m) => s + m.monto, 0)));
      return [new Table({ width: { size: ANCHO_TABLA, type: WidthType.DXA }, columnWidths: ANCHOS, borders: BORDES_TABLA, rows: filas })];
    }
    function filaResumen(etiqueta, valor, opciones = {}) {
      const { destacado = false, resaltado = null } = opciones;
      return new TableRow({
        children: [
          new TableCell({ width: { size: 5233, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: etiqueta, bold: destacado, size: destacado ? 22 : 20 })] })] }),
          new TableCell({ width: { size: 5233, type: WidthType.DXA }, shading: resaltado ? { type: ShadingType.CLEAR, color: "auto", fill: resaltado } : undefined, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: valor, bold: true, size: destacado ? 22 : 20 })] })] }),
        ],
      });
    }
    function lineaFirma(etiqueta) {
      return [
        new Paragraph({ spacing: { before: 500 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } }, children: [new TextRun({ text: " " })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: etiqueta, size: 19 })] }),
      ];
    }

    const inf = estado.informeActual;
    const cfg = estado.configuracion;
    const totalMov = inf.ingresos.length + inf.egresos.length;
    const conComprobante = totalMov - inf.movimientosSinComprobante.length;
    const textoDocumentacion = totalMov === 0
      ? "No hay movimientos registrados en este período."
      : `${conComprobante} de ${totalMov} movimiento(s) cuentan con comprobante adjunto.` +
        (inf.movimientosSinComprobante.length ? ` Movimientos sin comprobante: ${inf.movimientosSinComprobante.map((m) => "N°" + m.numero).join(", ")}.` : "");

    // Pie de página estilo "barra celeste con datos de contacto", tomado del informe de referencia.
    const partesPie = [cfg.nombreSociedad || "SEVIDA"];
    if (cfg.emailContacto) partesPie.push(`✉ ${cfg.emailContacto}`);
    if (cfg.direccion) partesPie.push(cfg.direccion);
    const textoPie = partesPie.join("   ·   ");

    const pieDePagina = new Footer({
      children: [new Table({
        width: { size: ANCHO_TABLA, type: WidthType.DXA },
        borders: { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
        rows: [new TableRow({ children: [new TableCell({
          width: { size: ANCHO_TABLA, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "D3E9F5" },
          margins: { top: 90, bottom: 90, left: 150, right: 150 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: textoPie, size: 16, color: "20303D" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [
              new TextRun({ text: "Página ", size: 14, color: "5B7184" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: "5B7184" }),
              new TextRun({ text: " de ", size: 14, color: "5B7184" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: "5B7184" }),
            ] }),
          ],
        })] })],
      })],
    });

    const documento = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 1000, left: 720, right: 720 } } },
        footers: { default: pieDePagina },
        children: [
          ...(logoImagen ? [logoImagen] : []),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: logoImagen ? 120 : 0 }, children: [new TextRun({ text: cfg.nombreSociedad || "Sociedad de Jóvenes", bold: true, size: 32 })] }),
          ...(cfg.nombreIglesia ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: cfg.nombreIglesia, size: 22 })] })] : []),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 }, children: [new TextRun({ text: `Informe Trimestral — ${inf.periodo.nombre}`, bold: true, size: 26 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Fecha de generación: ${formatearFecha(new Date())}`, size: 18, color: "5B7184" })] }),
          new Paragraph({ spacing: { after: 280 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "1E88C7", space: 4 } }, children: [new TextRun({ text: " " })] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Resumen financiero")] }),
          new Table({ width: { size: ANCHO_TABLA, type: WidthType.DXA }, columnWidths: [5233, 5233], rows: [
            filaResumen("Saldo inicial", formatearMoneda(inf.saldoInicial), { resaltado: CELESTE_SALDO }),
            filaResumen("Total ingresos", formatearMoneda(inf.totalIngresos), { resaltado: VERDE_TOTAL }),
            filaResumen("Total egresos", formatearMoneda(inf.totalEgresos), { resaltado: VERDE_TOTAL }),
            filaResumen("Saldo final", formatearMoneda(inf.saldoFinal), { destacado: true, resaltado: CELESTE_SALDO }),
          ] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun("Detalle de ingresos")] }),
          ...bloqueDetalle(inf.ingresos),

          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun("Detalle de egresos")] }),
          ...bloqueDetalle(inf.egresos),

          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun("Documentación")] }),
          new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: textoDocumentacion, size: 19 })] }),

          ...lineaFirma("Tesorero"),
          ...lineaFirma("Revisor/a"),
          ...lineaFirma("Presidente de la Sociedad de Jóvenes"),
        ],
      }],
    });

    const blob = await Packer.toBlob(documento);
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `Informe_${inf.periodo.id}.docx`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    mostrarToast("Informe exportado a Word correctamente.", "exito");
  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo generar el archivo Word. Intenta nuevamente.", "error");
  } finally {
    btn.disabled = false; btn.textContent = textoOriginal;
  }
}
document.getElementById("btn-exportar-word").addEventListener("click", exportarInformeAWord);

/* ---------- 14b. ACTIVIDADES ---------- */
function renderizarActividades() {
  const tbody = document.getElementById("tabla-actividades");
  if (estado.actividades.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="celda-vacia">Todavía no hay actividades creadas.</td></tr>'; return; }
  tbody.innerHTML = estado.actividades.map((a) => {
    const movs = estado.movimientos.filter((m) => m.actividadId === a.id && m.estado === "activo");
    const ingresos = movs.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0);
    const egresos = movs.filter((m) => m.tipo === "egreso").reduce((s, m) => s + m.monto, 0);
    return `<tr>
      <td>${escaparHTML(a.nombre)}</td>
      <td class="num texto-ingreso">${formatearMoneda(ingresos)}</td>
      <td class="num texto-egreso">${formatearMoneda(egresos)}</td>
      <td>${movs.length}</td>
    </tr>`;
  }).join("");
}
async function crearActividad(nombre) {
  const refNueva = await addDoc(collection(db, RUTA.actividades), { nombre, creadoPor: estado.usuarioActual.uid, creadoEn: serverTimestamp() });
  await cargarActividades();
  return { id: refNueva.id, nombre };
}
document.getElementById("form-nueva-actividad").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = document.getElementById("act-nombre").value.trim();
  if (!nombre) return;
  try {
    await crearActividad(nombre);
    document.getElementById("act-nombre").value = "";
    renderizarActividades();
    mostrarToast("Actividad creada.", "exito");
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo crear la actividad.", "error");
  }
});

/* ---------- 15. CATEGORÍAS ---------- */
function renderizarCategorias() {
  const ingresoUl = document.getElementById("lista-categorias-ingreso");
  const egresoUl = document.getElementById("lista-categorias-egreso");
  const ingresos = estado.categorias.filter((c) => c.tipo === "ingreso");
  const egresos = estado.categorias.filter((c) => c.tipo === "egreso");
  ingresoUl.innerHTML = ingresos.length ? ingresos.map((c) => `<li>${escaparHTML(c.nombre)}</li>`).join("") : '<li class="texto-ayuda">Sin categorías todavía.</li>';
  egresoUl.innerHTML = egresos.length ? egresos.map((c) => `<li>${escaparHTML(c.nombre)}</li>`).join("") : '<li class="texto-ayuda">Sin categorías todavía.</li>';
}
document.getElementById("form-nueva-categoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (estado.usuarioActual.rol !== "admin") return;
  const nombre = document.getElementById("cat-nombre").value.trim();
  const tipo = document.getElementById("cat-tipo").value;
  if (!nombre) return;
  try {
    await addDoc(collection(db, RUTA.categorias), { nombre, tipo, activo: true });
    document.getElementById("cat-nombre").value = "";
    await cargarCategorias();
    renderizarCategorias();
    mostrarToast("Categoría agregada.", "exito");
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo agregar la categoría.", "error");
  }
});

/* ---------- 16. USUARIOS ---------- */
function renderizarUsuarios() {
  const tbody = document.getElementById("tabla-usuarios");
  if (estado.usuarios.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="celda-vacia">No hay usuarios registrados.</td></tr>'; return; }
  tbody.innerHTML = estado.usuarios.map((u) => `
    <tr>
      <td>${escaparHTML(u.nombre || "")}</td>
      <td>${escaparHTML(u.email || "")}</td>
      <td>${u.rol === "admin" ? "Administrador" : "Miembro"}</td>
      <td>${u.id === estado.usuarioActual.uid ? "" : `<button class="btn-fila" data-accion="quitar-usuario" data-id="${u.id}" data-nombre="${escaparHTML(u.nombre || u.email || "")}" type="button" style="color:var(--rojo);">Quitar</button>`}</td>
    </tr>`).join("");
}
async function quitarUsuario(uid, nombre) {
  if (uid === estado.usuarioActual.uid) return;
  const confirmacion = confirm(`¿Quitar a ${nombre} del sistema? Ya no podrá entrar ni consultar los movimientos. Esto no borra su acceso a Firebase, solo su permiso dentro de la app — si necesitas bloquearlo por completo, deshabilita su cuenta desde Authentication en la consola de Firebase.`);
  if (!confirmacion) return;
  try {
    await deleteDoc(doc(db, RUTA.usuarios, uid));
    mostrarToast(`${nombre} fue quitado del sistema.`, "exito");
    await cargarUsuarios();
    renderizarUsuarios();
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo quitar al usuario.", "error");
  }
}
document.getElementById("form-nuevo-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (estado.usuarioActual.rol !== "admin") return;
  const nombre = document.getElementById("usr-nombre").value.trim();
  const email = document.getElementById("usr-email").value.trim();
  const password = document.getElementById("usr-password").value;
  const rol = document.getElementById("usr-rol").value;
  const btn = document.getElementById("btn-crear-usuario");
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password);
    await setDoc(doc(db, RUTA.usuarios, credencial.user.uid), { nombre, email, rol, creadoEn: serverTimestamp() });
    await signOut(authSecundaria);
    document.getElementById("form-nuevo-usuario").reset();
    await cargarUsuarios();
    renderizarUsuarios();
    mostrarToast(`Cuenta creada para ${nombre}.`, "exito");
  } catch (err) {
    console.error(err);
    let msg = "No se pudo crear el usuario.";
    if (err.code === "auth/email-already-in-use") msg = "Ese correo ya está registrado.";
    if (err.code === "auth/weak-password") msg = "La contraseña es muy débil (mínimo 6 caracteres).";
    if (err.code === "auth/invalid-email") msg = "El correo no es válido.";
    mostrarToast(msg, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Crear usuario";
  }
});

/* ---------- 17. CONFIGURACIÓN ---------- */
function cargarFormularioConfiguracion() {
  document.getElementById("config-nombre-sociedad").value = estado.configuracion.nombreSociedad || "";
  document.getElementById("config-nombre-iglesia").value = estado.configuracion.nombreIglesia || "";
  document.getElementById("config-email-contacto").value = estado.configuracion.emailContacto || "";
  document.getElementById("config-direccion").value = estado.configuracion.direccion || "";
  document.getElementById("config-saldo-inicial").value = estado.configuracion.saldoInicialGeneral || 0;
}
document.getElementById("form-configuracion").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (estado.usuarioActual.rol !== "admin") return;
  const nombreSociedad = document.getElementById("config-nombre-sociedad").value.trim();
  const nombreIglesia = document.getElementById("config-nombre-iglesia").value.trim();
  const emailContacto = document.getElementById("config-email-contacto").value.trim();
  const direccion = document.getElementById("config-direccion").value.trim();
  const saldoInicialGeneral = parseFloat(document.getElementById("config-saldo-inicial").value) || 0;
  try {
    await setDoc(doc(db, RUTA.configuracion, "general"), { nombreSociedad, nombreIglesia, emailContacto, direccion, saldoInicialGeneral }, { merge: true });
    estado.configuracion = { ...estado.configuracion, nombreSociedad, nombreIglesia, emailContacto, direccion, saldoInicialGeneral };
    mostrarToast("Configuración guardada.", "exito");
    renderizarDashboard();
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo guardar la configuración.", "error");
  }
});