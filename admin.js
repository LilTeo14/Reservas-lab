/* ============================================================
   admin.js – ReservaLab USM
   Gestión de Reservas, Estadísticas y Cambio de Estados
   ============================================================ */

'use strict';

// ── VARIABLES & CONSTANTES ──────────────────────────────────
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const BLOCKS = [
  { id: 'b56',   label: 'Bloque 5-6',   time: '11:05 – 12:15' },
  { id: 'b78',   label: 'Bloque 7-8',   time: '12:30 – 13:40' },
  { id: 'b910',  label: 'Bloque 9-10',  time: '14:40 – 15:50' },
  { id: 'b1112', label: 'Bloque 11-12', time: '16:05 – 17:15' },
];

const API_URL = '/api/reservations';
const LS_KEY  = 'reservalab_v2'; // fallback local

let allReservations = {}; // Caché local del JSON
let activeFilters = {
  week: 'all',     // 'all' | '0' | '1' | '2' | 'other'
  machine: 'all',  // 'all' | 'laser' | 'cnc'
  status: 'all'    // 'all' | 'pending' | 'attended' | 'noshow'
};
let pendingConfirmAction = null; // Para el modal de confirmación
let currentSort = {
  column: 'ts',
  ascending: false
};

// ── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('admin_password');
  if (token) {
    showDashboard();
  } else {
    showLogin();
  }
  setupSortingHeaders();
});

// ── NAVEGACIÓN DE VISTAS ────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').style.display = 'grid';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('pw-input').value = '';
  document.getElementById('pw-input').focus();
}

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  refreshData();
}

// ── AUTENTICACIÓN ───────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const pwInput = document.getElementById('pw-input');
  const btn = document.getElementById('btn-login');
  const errorDiv = document.getElementById('login-error');

  const password = pwInput.value.trim();
  if (!password) return;

  btn.disabled = true;
  btn.textContent = 'Verificando...';
  errorDiv.textContent = '';

  try {
    // Si estamos en local sin API
    if (window.location.origin.includes('localhost') && !await checkApiAvailable()) {
      // Local fallback sin backend: usar una pass por defecto directamente en frontend
      if (password === 'ReservaLabAdmin2026') {
        sessionStorage.setItem('admin_password', password);
        showDashboard();
        showToast('🔓 Ingreso exitoso (Modo Local)', 'ok');
      } else {
        errorDiv.textContent = 'Contraseña incorrecta para modo offline.';
      }
      return;
    }

    // Backend real
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_admin', password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      sessionStorage.setItem('admin_password', password);
      showDashboard();
      showToast('🔓 Acceso concedido', 'ok');
    } else {
      errorDiv.textContent = data.error || 'Contraseña incorrecta';
    }
  } catch (err) {
    console.error(err);
    errorDiv.textContent = 'Error al conectar con la API';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

function logout() {
  sessionStorage.removeItem('admin_password');
  showLogin();
}

function togglePw() {
  const input = document.getElementById('pw-input');
  const btn = document.getElementById('toggle-pw-btn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

// ── FECHAS / SEMANAS HELPERS ────────────────────────────────
function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

// 0 = esta semana, 1 = proxima semana
function getWeekMonday(offset) {
  const mon = getMondayOf(new Date());
  mon.setDate(mon.getDate() + offset * 7);
  return mon;
}

function toISODate(date) { return date.toISOString().slice(0, 10); }

// ── CARGAR DATOS ────────────────────────────────────────────
async function checkApiAvailable() {
  try {
    const res = await fetch(API_URL);
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshData() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="9"><span class="spinner"></span> Cargando datos...</td></tr>';
  
  try {
    const hasApi = await checkApiAvailable();
    if (hasApi) {
      const res = await fetch(API_URL);
      const json = await res.json();
      allReservations = json.data || {};
    } else {
      // LocalStorage fallback
      console.warn('[ReservaLab Admin] Usando localStorage fallback');
      allReservations = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      showToast('⚠️ Datos cargados de LocalStorage', 'warn');
    }

    renderStats();
    renderTable();
    updateLastUpdatedTime();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">❌ Error al cargar los datos</td></tr>';
    showToast('Error de conexión con el servidor', 'err');
  }
}

function updateLastUpdatedTime() {
  const el = document.getElementById('last-update');
  if (el) {
    const now = new Date();
    el.textContent = `Actualizado: ${now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

// ── CÁLCULO DE ESTADÍSTICAS y RENDER ─────────────────────────
function getFlatReservations() {
  const list = [];
  for (const [email, rList] of Object.entries(allReservations)) {
    if (!Array.isArray(rList)) continue;
    rList.forEach(r => {
      list.push({
        email,
        machine: r.machine,
        blockId: r.blockId,
        dayIndex: r.dayIndex,
        day: r.day,
        block: r.block,
        ayudante: r.ayudante,
        weekKey: r.weekKey,
        status: r.status || 'pending',
        ts: r.ts
      });
    });
  }
  return list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function renderStats() {
  const list = getFlatReservations();
  
  const total = list.length;
  const attended = list.filter(r => r.status === 'attended').length;
  const noshow = list.filter(r => r.status === 'noshow').length;
  const pending = list.filter(r => r.status === 'pending').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-attended').textContent = attended;
  document.getElementById('stat-noshow').textContent = noshow;
  document.getElementById('stat-pending').textContent = pending;
}

// ── FILTROS ─────────────────────────────────────────────────
function setFilter(type, value) {
  activeFilters[type] = value;
  
  // Actualizar botones de UI
  const parentSelector = type === 'week' ? '.filters-row button[onclick*="\'week\'"]' :
                         type === 'machine' ? '.filters-row button[onclick*="\'machine\'"]' :
                         '.filters-row button[onclick*="\'status\'"]';
  document.querySelectorAll(parentSelector).forEach(btn => btn.classList.remove('active'));
  
  const activeId = type === 'week' ? `fw-${value}` :
                   type === 'machine' ? `fm-${value}` :
                   `fs-${value}`;
  const btn = document.getElementById(activeId);
  if (btn) btn.classList.add('active');

  renderTable();
}

// ── TABLA DE RESERVAS ───────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const list = getFlatReservations();
  const mon0 = toISODate(getWeekMonday(0));
  const mon1 = toISODate(getWeekMonday(1));
  const mon2 = toISODate(getWeekMonday(2));

  const filtered = list.filter(r => {
    // 1. Filtrar por Semana
    if (activeFilters.week !== 'all') {
      const isWeek0 = r.weekKey && r.weekKey.startsWith(mon0);
      const isWeek1 = r.weekKey && r.weekKey.startsWith(mon1);
      const isWeek2 = r.weekKey && r.weekKey.startsWith(mon2);
      if (activeFilters.week === '0' && !isWeek0) return false;
      if (activeFilters.week === '1' && !isWeek1) return false;
      if (activeFilters.week === '2' && !isWeek2) return false;
    }

    // 2. Filtrar por Máquina
    if (activeFilters.machine !== 'all' && r.machine !== activeFilters.machine) return false;

    // 3. Filtrar por Estado
    if (activeFilters.status !== 'all' && r.status !== activeFilters.status) return false;

    return true;
  });

  // Ordenar la lista según el criterio actual
  filtered.sort((a, b) => {
    if (currentSort.column === 'ts') {
      const valA = a.ts || 0;
      const valB = b.ts || 0;
      return currentSort.ascending ? valA - valB : valB - valA;
    }

    let valA, valB;
    switch (currentSort.column) {
      case 'correo':
        valA = a.email.toLowerCase();
        valB = b.email.toLowerCase();
        break;
      case 'maquina':
        valA = a.machine;
        valB = b.machine;
        break;
      case 'bloque':
      case 'horario':
        valA = BLOCKS.findIndex(bk => bk.id === a.blockId);
        valB = BLOCKS.findIndex(bk => bk.id === b.blockId);
        break;
      case 'dia':
        valA = DAYS.indexOf(a.day);
        valB = DAYS.indexOf(b.day);
        break;
      case 'ayudante':
        valA = (a.ayudante || '').toLowerCase();
        valB = (b.ayudante || '').toLowerCase();
        break;
      case 'semana':
        valA = a.weekKey || '';
        valB = b.weekKey || '';
        break;
      case 'estado':
        valA = a.status || 'pending';
        valB = b.status || 'pending';
        break;
      default:
        return 0;
    }

    if (valA < valB) return currentSort.ascending ? -1 : 1;
    if (valA > valB) return currentSort.ascending ? 1 : -1;
    return 0;
  });

  updateHeadersUI();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No se encontraron reservas con los filtros aplicados.</td></tr>';
    return;
  }

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    
    // Asignar clase de estado a la fila para feedback visual
    if (r.status === 'attended') tr.classList.add('attended-row');
    if (r.status === 'noshow') tr.classList.add('noshow-row');

    // Label de la máquina
    const mLabel = r.machine === 'laser' ? '🔴 Láser' : '🔩 CNC';
    const mBadgeClass = r.machine === 'laser' ? 'laser' : 'cnc';

    // Label de la semana
    const wkDate = r.weekKey ? r.weekKey.slice(0, 10) : '';
    let weekLabel = 'Otra';
    if (wkDate === mon0) weekLabel = 'Esta';
    if (wkDate === mon1) weekLabel = 'Próxima';
    if (wkDate === mon2) weekLabel = 'Subsiguiente';
    const weekSpan = `${weekLabel} (${wkDate})`;

    // Badge de estado
    let stText = 'Pendiente';
    let stClass = 'pending';
    if (r.status === 'attended') { stText = 'Asistió'; stClass = 'attended'; }
    if (r.status === 'noshow') { stText = 'No asistió'; stClass = 'noshow'; }

    // Bloque horario
    const blockObj = BLOCKS.find(b => b.id === r.blockId);
    const blockLabel = blockObj ? blockObj.label : (r.block?.label || r.block || r.blockId);
    const blockTime = blockObj ? blockObj.time : '';

    tr.innerHTML = `
      <td class="email-cell">${r.email}</td>
      <td><span class="machine-badge ${mBadgeClass}">${mLabel}</span></td>
      <td><strong>${blockLabel}</strong></td>
      <td>${r.day}</td>
      <td><span style="color:var(--muted);font-size:.78rem;">${blockTime}</span></td>
      <td>${r.ayudante || '—'}</td>
      <td style="font-size:.8rem;color:var(--muted);">${weekSpan}</td>
      <td><span class="status-badge ${stClass}">${stText}</span></td>
      <td class="actions-cell"></td>
    `;

    // Botones de acción en la celda final
    const actionsCell = tr.querySelector('.actions-cell');

    // Botón Asistió
    const btnAttend = document.createElement('button');
    btnAttend.className = 'action-btn attend';
    btnAttend.textContent = 'Asistió';
    btnAttend.disabled = r.status === 'attended';
    btnAttend.addEventListener('click', () => updateStatus(r, 'attended'));
    actionsCell.appendChild(btnAttend);

    // Botón Faltó
    const btnNoShow = document.createElement('button');
    btnNoShow.className = 'action-btn noshow';
    btnNoShow.textContent = 'Faltó';
    btnNoShow.disabled = r.status === 'noshow';
    btnNoShow.addEventListener('click', () => updateStatus(r, 'noshow'));
    actionsCell.appendChild(btnNoShow);

    // Botón Cancelar (Eliminar)
    const btnCancel = document.createElement('button');
    btnCancel.className = 'action-btn cancel';
    btnCancel.textContent = 'Cancelar';
    btnCancel.addEventListener('click', () => openConfirmDialog(r));
    actionsCell.appendChild(btnCancel);

    tbody.appendChild(tr);
  });
}

// ── ACCIONES: ACTUALIZAR ESTADO ─────────────────────────────
async function updateStatus(r, newStatus) {
  const token = sessionStorage.getItem('admin_password');
  
  try {
    if (window.location.origin.includes('localhost') && !await checkApiAvailable()) {
      // Local fallback
      const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (all[r.email]) {
        all[r.email] = all[r.email].map(item => {
          if (
            item.weekKey === r.weekKey &&
            item.blockId === r.blockId &&
            item.dayIndex === r.dayIndex &&
            item.machine === r.machine
          ) {
            return { ...item, status: newStatus };
          }
          return item;
        });
        localStorage.setItem(LS_KEY, JSON.stringify(all));
        allReservations = all;
        renderStats();
        renderTable();
        showToast(`Estado actualizado a: ${newStatus === 'attended' ? 'Asistió' : 'Faltó'}`, 'ok');
      }
      return;
    }

    // API real
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({
        email: r.email,
        weekKey: r.weekKey,
        blockId: r.blockId,
        dayIndex: r.dayIndex,
        machine: r.machine,
        status: newStatus
      })
    });

    const json = await res.json();
    if (res.ok && json.success) {
      allReservations[r.email] = json.data;
      renderStats();
      renderTable();
      showToast(`Estado actualizado a: ${newStatus === 'attended' ? 'Asistió' : 'Faltó'}`, 'ok');
    } else {
      showToast(`Error: ${json.error || 'No autorizado'}`, 'err');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de red al actualizar estado', 'err');
  }
}

// ── ACCIONES: CANCELAR RESERVA (CONFIRMACIÓN) ───────────────
function openConfirmDialog(r) {
  const overlay = document.getElementById('confirm-overlay');
  const msg = document.getElementById('c-msg');
  const confirmBtn = document.getElementById('btn-confirm-action');

  msg.innerHTML = `¿Estás seguro de que deseas cancelar la reserva de:<br>
    <strong>${r.email}</strong><br>
    para la máquina ${r.machine === 'laser' ? 'Cortadora Láser' : 'CNC'} el día ${r.day} (${r.blockId})?`;

  overlay.classList.add('open');
  pendingConfirmAction = r;

  // Limpiar event listener previo
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  newConfirmBtn.addEventListener('click', async () => {
    newConfirmBtn.disabled = true;
    newConfirmBtn.textContent = 'Cancelando...';
    await executeCancel(pendingConfirmAction);
    closeConfirm();
  });
}

function closeConfirm() {
  const overlay = document.getElementById('confirm-overlay');
  overlay.classList.remove('open');
  pendingConfirmAction = null;
  // Restaurar el botón original
  const confirmBtn = document.getElementById('btn-confirm-action');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar';
  }
}

async function executeCancel(r) {
  const token = sessionStorage.getItem('admin_password');

  try {
    if (window.location.origin.includes('localhost') && !await checkApiAvailable()) {
      // Local fallback
      const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (all[r.email]) {
        all[r.email] = all[r.email].filter(item => !(
          item.weekKey === r.weekKey &&
          item.blockId === r.blockId &&
          item.dayIndex === r.dayIndex &&
          item.machine === r.machine
        ));
        if (all[r.email].length === 0) delete all[r.email];
        localStorage.setItem(LS_KEY, JSON.stringify(all));
        allReservations = all;
        renderStats();
        renderTable();
        showToast('Reserva cancelada exitosamente', 'warn');
      }
      return;
    }

    // API real
    const res = await fetch(API_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({
        email: r.email,
        weekKey: r.weekKey,
        blockId: r.blockId,
        dayIndex: r.dayIndex,
        machine: r.machine
      })
    });

    const json = await res.json();
    if (res.ok && json.success) {
      if (allReservations[r.email]) {
        allReservations[r.email] = allReservations[r.email].filter(item => !(
          item.weekKey === r.weekKey &&
          item.blockId === r.blockId &&
          item.dayIndex === r.dayIndex &&
          item.machine === r.machine
        ));
        if (allReservations[r.email].length === 0) delete allReservations[r.email];
      }
      renderStats();
      renderTable();
      showToast('Reserva cancelada exitosamente', 'warn');
    } else {
      showToast(`Error: ${json.error || 'No autorizado'}`, 'err');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de red al cancelar reserva', 'err');
  }
}

// ── TOAST MESSAGES ──────────────────────────────────────────
let toastTimeout = null;
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

// ── ORDENACIÓN DE TABLA ─────────────────────────────────────
function setupSortingHeaders() {
  const headers = document.querySelectorAll('.reservations-table th');
  const cols = ['correo', 'maquina', 'bloque', 'dia', 'horario', 'ayudante', 'semana', 'estado', 'acciones'];
  headers.forEach((th, idx) => {
    const colName = cols[idx];
    if (colName === 'acciones') return;
    th.addEventListener('click', () => {
      if (currentSort.column === colName) {
        currentSort.ascending = !currentSort.ascending;
      } else {
        currentSort.column = colName;
        currentSort.ascending = true;
      }
      renderTable();
    });
  });
}

function updateHeadersUI() {
  const headers = document.querySelectorAll('.reservations-table th');
  const cols = ['correo', 'maquina', 'bloque', 'dia', 'horario', 'ayudante', 'semana', 'estado', 'acciones'];
  headers.forEach((th, idx) => {
    const colName = cols[idx];
    if (colName === 'acciones') return;
    
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    
    let cleanText = th.textContent.replace(/[ ▲▼]/g, '');
    
    if (currentSort.column === colName) {
      th.innerHTML = `${cleanText} ${currentSort.ascending ? '▲' : '▼'}`;
      th.style.color = 'var(--accent2)';
    } else {
      th.innerHTML = cleanText;
      th.style.color = 'var(--muted)';
    }
  });
}
