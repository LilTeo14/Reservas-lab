/* ============================================================
   app.js – ReservaLab USM
   Almacenamiento: Vercel KV via /api/reservations
   Fallback:       localStorage (para dev local sin vercel dev)
   ============================================================ */

'use strict';

// ── DATA ──────────────────────────────────────────────────────
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

const BLOCKS = [
  { id: 'b56',   label: 'Bloque 5-6',   time: '11:05 – 12:15' },
  { id: 'b78',   label: 'Bloque 7-8',   time: '12:30 – 13:40' },
  { id: 'b910',  label: 'Bloque 9-10',  time: '14:40 – 15:50' },
  { id: 'b1112', label: 'Bloque 11-12', time: '16:05 – 17:15' },
];

// null = sin ayudante (bloques no reservables)
const SCHEDULE = {
  b56:   ['Renato Rivera', 'Ignacio Trujillo', 'Ignacio Trujillo', 'Bastian Pizarro', 'Mateo Morales'],
  b78:   ['Bastian Pizarro', null,              'Matías Zamora',   null,               'Matías Zamora'],
  b910:  ['Juan Espinoza',   'María Urtecho',   'Paula Aravena',   'Mateo Morales',    'Hans Toledo'],
  b1112: ['Juan Espinoza',   'María Urtecho',   'Paula Aravena',   'Hans Toledo',      'Renato Rivera'],
};

const MAX_BLOCKS = 3;
const LS_KEY     = 'reservalab_v2';   // clave de fallback en localStorage
const API_URL    = '/api/reservations';

// ── WEEK HELPERS ──────────────────────────────────────────────
function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function getWeekMonday(offset) {
  const mon = getMondayOf(new Date());
  mon.setDate(mon.getDate() + offset * 7);
  return mon;
}
function toISODate(date) { return date.toISOString().slice(0, 10); }
function shortDate(date) {
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
}
function getDayDate(weekOffset, dayIndex) {
  const mon = getWeekMonday(weekOffset);
  mon.setDate(mon.getDate() + dayIndex);
  return mon;
}

// ── STATE ─────────────────────────────────────────────────────
let selectedMachine    = null;    // 'laser' | 'cnc'
let emailValid         = false;
let currentEmail       = '';
let selectedWeekOffset = 0;       // 0 = esta semana, 1 = próxima
let currentSelections  = [];      // pendientes de confirmar
let allReservations    = {};      // caché de todos los datos del servidor
let useLocalStorage    = false;   // true si la API no está disponible

// ── API LAYER ─────────────────────────────────────────────────
async function apiFetch(method, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_URL, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Carga todas las reservas desde el servidor (o localStorage como fallback). */
async function fetchAllReservations() {
  try {
    const json = await apiFetch('GET');
    if (!json.success) throw new Error(json.error);
    useLocalStorage = false;
    return json.data ?? {};
  } catch (e) {
    console.warn('[ReservaLab] API no disponible → usando localStorage:', e.message);
    useLocalStorage = true;
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch { return {}; }
  }
}

/** Guarda nuevas reservas para un email. */
async function postReservations(email, reservations) {
  if (useLocalStorage) {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (!all[email]) all[email] = [];
    reservations.forEach(r => {
      if (!all[email].some(e =>
        e.weekKey === r.weekKey && e.blockId === r.blockId &&
        e.dayIndex === r.dayIndex && e.machine === r.machine
      )) all[email].push(r);
    });
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    return all[email];
  }
  const json = await apiFetch('POST', { email, reservations });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Elimina una reserva específica. */
async function deleteReservation(email, { weekKey, blockId, dayIndex, machine }) {
  if (useLocalStorage) {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (all[email]) {
      all[email] = all[email].filter(r => !(
        r.weekKey === weekKey && r.blockId === blockId &&
        r.dayIndex === dayIndex && r.machine === machine
      ));
      if (all[email].length === 0) delete all[email];
    }
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    return;
  }
  const json = await apiFetch('DELETE', { email, weekKey, blockId, dayIndex, machine });
  if (!json.success) throw new Error(json.error);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setLoadingOverlay(true, 'Cargando reservas...');
  try {
    allReservations = await fetchAllReservations();
    if (useLocalStorage) {
      showToast('⚠️ Modo local – los datos no se comparten entre usuarios', 'warning');
    }
  } catch (e) {
    showToast('⚠️ Error al conectar con el servidor', 'error');
  } finally {
    setLoadingOverlay(false);
  }
  buildWeekSelector();
  buildScheduleTable();
  updateConfirmBox();
  updateConfirmButton();
});

// ── LOADING OVERLAY ───────────────────────────────────────────
function setLoadingOverlay(visible, message = '') {
  const overlay = document.getElementById('loading-overlay');
  const msg     = document.getElementById('loading-message');
  if (!overlay) return;
  if (msg && message) msg.textContent = message;
  overlay.classList.toggle('active', visible);
  overlay.setAttribute('aria-hidden', !visible);
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = '<span class="btn-spinner"></span> Guardando...';
  } else {
    btn.innerHTML = btn.dataset.original || '🗓️ Confirmar Reserva';
  }
}

// ── MACHINE SELECTION ─────────────────────────────────────────
function selectMachine(machine) {
  selectedMachine = machine;
  document.getElementById('card-laser').setAttribute('aria-pressed', machine === 'laser');
  document.getElementById('card-cnc').setAttribute('aria-pressed', machine === 'cnc');
  currentSelections = [];
  refreshScheduleTable();
  updateConfirmBox();
  updateConfirmButton();
  showToast(
    machine === 'laser' ? '🔴 Cortadora Láser seleccionada' : '🔩 Máquina CNC seleccionada',
    'success'
  );
}

// ── EMAIL VALIDATION ──────────────────────────────────────────
// Acepta @usm.cl y cualquier subdominio: @sansano.usm.cl, @alumnos.usm.cl, etc.
function validateEmail() {
  const input    = document.getElementById('email-input');
  const feedback = document.getElementById('email-feedback');
  const val      = input.value.trim();
  const pattern  = /^[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9\-]+\.)*usm\.cl$/i;

  if (!val) {
    input.classList.remove('valid', 'invalid');
    feedback.textContent = '';
    feedback.className   = 'email-feedback';
    emailValid = false; currentEmail = '';
  } else if (pattern.test(val)) {
    input.classList.add('valid'); input.classList.remove('invalid');
    feedback.textContent = '✅ Correo válido – ¡puedes reservar!';
    feedback.className   = 'email-feedback ok';
    emailValid   = true;
    currentEmail = val.toLowerCase();
    refreshScheduleTable();
    updateConfirmBox();
  } else {
    input.classList.add('invalid'); input.classList.remove('valid');
    feedback.textContent = '❌ Debes usar un correo @usm.cl o @subdominio.usm.cl';
    feedback.className   = 'email-feedback err';
    emailValid = false; currentEmail = '';
  }
  updateConfirmButton();
}

// ── WEEK SELECTOR ─────────────────────────────────────────────
function buildWeekSelector() {
  const container = document.getElementById('week-selector');
  if (container) renderWeekSelector(container);
}

function renderWeekSelector(container) {
  container.innerHTML = '';
  [0, 1].forEach(offset => {
    const mon = getWeekMonday(offset);
    const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
    const btn = document.createElement('button');
    btn.className = 'week-btn' + (selectedWeekOffset === offset ? ' active' : '');
    btn.id = `week-btn-${offset}`;
    btn.setAttribute('aria-pressed', selectedWeekOffset === offset);
    btn.innerHTML = `
      <span class="week-label">${offset === 0 ? '📅 Esta semana' : '📅 Próxima semana'}</span>
      <span class="week-range">${shortDate(mon)} – ${shortDate(fri)}</span>
    `;
    btn.addEventListener('click', () => selectWeek(offset));
    container.appendChild(btn);
  });
}

function selectWeek(offset) {
  if (selectedWeekOffset === offset) return;
  selectedWeekOffset = offset;
  currentSelections  = [];
  const container = document.getElementById('week-selector');
  if (container) renderWeekSelector(container);
  // Actualizar fechas en cabeceras del horario
  DAYS.forEach((_, dayIndex) => {
    const el = document.getElementById(`head-day-${dayIndex}`);
    if (el) {
      const d = getDayDate(selectedWeekOffset, dayIndex);
      el.innerHTML = `${DAYS[dayIndex]}<br><span class="head-date">${shortDate(d)}</span>`;
    }
  });
  refreshScheduleTable();
  updateConfirmBox();
  updateConfirmButton();
  document.getElementById('blocks-used').textContent =
    countPersistedBlocks(currentEmail, selectedMachine) + currentSelections.length;
  showToast(offset === 0 ? '📅 Mostrando esta semana' : '📅 Mostrando próxima semana', 'success');
}

// ── SLOT KEY (incluye semana) ─────────────────────────────────
function slotKey(blockId, dayIndex, weekOffset) {
  return `${toISODate(getWeekMonday(weekOffset))}__${blockId}__${dayIndex}`;
}

function getSlotReservations(blockId, dayIndex, machine) {
  const key = slotKey(blockId, dayIndex, selectedWeekOffset);
  const occupants = [];
  for (const [email, rList] of Object.entries(allReservations)) {
    for (const r of rList) {
      if (r.weekKey === key && r.machine === machine) occupants.push(email);
    }
  }
  return occupants;
}

function countPersistedBlocks(email, machine) {
  if (!email || !allReservations[email]) return 0;
  const wk = toISODate(getWeekMonday(selectedWeekOffset));
  return allReservations[email].filter(r =>
    r.machine === machine && r.weekKey && r.weekKey.startsWith(wk)
  ).length;
}

// ── BUILD SCHEDULE TABLE ──────────────────────────────────────
function buildScheduleTable() {
  const table = document.getElementById('schedule-table');
  table.innerHTML = '';

  // Cabecera: columna "Bloque"
  const th0 = document.createElement('div');
  th0.className = 'sch-head bloque-head';
  th0.textContent = 'Bloque';
  table.appendChild(th0);

  // Cabecera: columnas de días con fechas
  DAYS.forEach((day, dayIndex) => {
    const th = document.createElement('div');
    th.className = 'sch-head';
    th.id = `head-day-${dayIndex}`;
    const d = getDayDate(selectedWeekOffset, dayIndex);
    th.innerHTML = `${day}<br><span class="head-date">${shortDate(d)}</span>`;
    table.appendChild(th);
  });

  // Filas de bloques
  BLOCKS.forEach(block => {
    const bloqueTd = document.createElement('div');
    bloqueTd.className = 'sch-bloque';
    bloqueTd.innerHTML = `
      <span class="bloque-num">${block.label}</span>
      <span class="bloque-time">${block.time}</span>
    `;
    table.appendChild(bloqueTd);

    DAYS.forEach((day, dayIndex) => {
      const ayudante = SCHEDULE[block.id][dayIndex];
      const cell = document.createElement('div');
      cell.id = `cell-${block.id}-${dayIndex}`;
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', ayudante ? '0' : '-1');
      cell.setAttribute('aria-label',
        `${block.label} ${day}${ayudante ? ' – ' + ayudante : ' – Sin ayudante'}`);
      cell.addEventListener('click', () => toggleBlock(block.id, dayIndex, block, day, ayudante));
      cell.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && ayudante) {
          e.preventDefault();
          toggleBlock(block.id, dayIndex, block, day, ayudante);
        }
      });
      table.appendChild(cell);
    });
  });

  refreshScheduleTable();
}

function refreshScheduleTable() {
  BLOCKS.forEach(block => {
    DAYS.forEach((day, dayIndex) => {
      const ayudante = SCHEDULE[block.id][dayIndex];
      const cell = document.getElementById(`cell-${block.id}-${dayIndex}`);
      if (!cell) return;

      cell.className = 'sch-cell';
      cell.innerHTML = '';

      const selIcon = document.createElement('div');
      selIcon.className = 'cell-selected-icon';
      selIcon.textContent = '✓';
      cell.appendChild(selIcon);

      if (!ayudante) {
        cell.classList.add('blocked');
        cell.appendChild(Object.assign(document.createElement('span'), {
          className: 'blocked-label', textContent: 'Sin ayudante'
        }));
        return;
      }

      const isSel = currentSelections.some(s => s.blockId === block.id && s.dayIndex === dayIndex);
      const occupants = selectedMachine ? getSlotReservations(block.id, dayIndex, selectedMachine) : [];
      const isTaken   = occupants.some(e => e !== currentEmail);

      if (isSel) {
        cell.classList.add('selected');
      } else if (isTaken) {
        cell.classList.add('taken');
        cell.appendChild(Object.assign(document.createElement('span'), { className: 'cell-status', textContent: 'Ocupado' }));
        cell.appendChild(Object.assign(document.createElement('span'), { className: 'cell-ayudante', textContent: ayudante }));
        return;
      } else {
        cell.classList.add('available');
      }

      cell.appendChild(Object.assign(document.createElement('span'), { className: 'cell-ayudante', textContent: ayudante }));
    });
  });
}

// ── TOGGLE BLOCK ──────────────────────────────────────────────
function toggleBlock(blockId, dayIndex, block, day, ayudante) {
  if (!ayudante) return;
  if (!selectedMachine) {
    showToast('⚠️ Primero selecciona una máquina', 'warning');
    document.getElementById('section-machine').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (!emailValid) {
    showToast('⚠️ Ingresa tu correo @usm.cl primero', 'warning');
    document.getElementById('section-email').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (getSlotReservations(blockId, dayIndex, selectedMachine).some(e => e !== currentEmail)) {
    showToast('❌ Este bloque ya está ocupado', 'error');
    return;
  }

  const idx = currentSelections.findIndex(s => s.blockId === blockId && s.dayIndex === dayIndex);
  if (idx >= 0) {
    currentSelections.splice(idx, 1);
  } else {
    const total = countPersistedBlocks(currentEmail, selectedMachine) + currentSelections.length;
    if (total >= MAX_BLOCKS) {
      showToast(`⛔ Máximo ${MAX_BLOCKS} bloques por persona por semana`, 'error');
      return;
    }
    const wk = slotKey(blockId, dayIndex, selectedWeekOffset);
    currentSelections.push({ blockId, dayIndex, day, block, ayudante, weekKey: wk });
    showToast(`✅ Bloque agregado: ${block.label} – ${day}`, 'success');
  }

  document.getElementById('blocks-used').textContent =
    countPersistedBlocks(currentEmail, selectedMachine) + currentSelections.length;
  refreshScheduleTable();
  updateConfirmBox();
  updateConfirmButton();
}

// ── CONFIRM BOX ───────────────────────────────────────────────
function updateConfirmBox() {
  const box = document.getElementById('confirm-box');
  box.innerHTML = '';
  const wk = toISODate(getWeekMonday(selectedWeekOffset));

  const persisted = emailValid && selectedMachine && allReservations[currentEmail]
    ? allReservations[currentEmail].filter(r =>
        r.machine === selectedMachine && r.weekKey && r.weekKey.startsWith(wk)
      )
    : [];

  if (!selectedMachine && currentSelections.length === 0 && persisted.length === 0) {
    box.innerHTML = '<p class="confirm-hint">Completa los pasos anteriores para ver el resumen aquí.</p>';
    return;
  }

  if (persisted.length > 0) {
    addConfirmLabel(box, '✅ Ya reservados');
    persisted.forEach(r => box.appendChild(buildConfirmItem(r, true)));
  }
  if (currentSelections.length > 0) {
    addConfirmLabel(box, '⏳ Pendientes de confirmación', persisted.length > 0);
    currentSelections.forEach((s, i) => {
      box.appendChild(buildConfirmItem(
        { machine: selectedMachine, blockId: s.blockId, dayIndex: s.dayIndex,
          day: s.day, block: s.block, ayudante: s.ayudante, weekKey: s.weekKey },
        false, i
      ));
    });
  }
  if (persisted.length === 0 && currentSelections.length === 0) {
    box.innerHTML = '<p class="confirm-hint">Selecciona bloques en el horario de arriba.</p>';
  }
}

function addConfirmLabel(parent, text, marginTop = false) {
  const lbl = document.createElement('div');
  lbl.style.cssText =
    `font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;` +
    `color:var(--text-muted);margin-bottom:6px;${marginTop ? 'margin-top:14px;' : ''}`;
  lbl.textContent = text;
  parent.appendChild(lbl);
}

function buildConfirmItem(r, persisted, selIdx) {
  const icon  = r.machine === 'laser' ? '🔴' : '🔩';
  const label = r.machine === 'laser' ? 'Cortadora Láser' : 'Máquina CNC';
  const blockObj = BLOCKS.find(b => b.id === r.blockId);
  const time  = blockObj ? blockObj.time : '';
  const wm    = r.weekKey ? r.weekKey.slice(0, 10) : '';
  const sem   = wm ? ` · sem. ${wm.slice(8,10)}/${wm.slice(5,7)}` : '';

  const item = document.createElement('div');
  item.className = 'confirm-item';
  item.innerHTML = `
    <div class="confirm-icon">${icon}</div>
    <div class="confirm-details">
      <div class="confirm-machine ${r.machine}">${label}</div>
      <div class="confirm-block">${r.block.label ?? r.block} &mdash; ${r.day}${sem}</div>
      <div class="confirm-ayudante">🕐 ${time} &nbsp;·&nbsp; 👤 Ayudante: <strong>${r.ayudante}</strong></div>
      ${persisted ? '<div style="font-size:.72rem;color:var(--success);margin-top:3px;">✔ Confirmado</div>' : ''}
    </div>
  `;

  if (!persisted) {
    const btn = document.createElement('button');
    btn.className = 'confirm-remove'; btn.title = 'Eliminar'; btn.textContent = '✕';
    btn.addEventListener('click', () => {
      currentSelections.splice(selIdx, 1);
      document.getElementById('blocks-used').textContent =
        countPersistedBlocks(currentEmail, selectedMachine) + currentSelections.length;
      refreshScheduleTable(); updateConfirmBox(); updateConfirmButton();
    });
    item.appendChild(btn);
  }
  return item;
}

async function cancelPersistedReservation(r) {
  try {
    await deleteReservation(currentEmail, r);
    if (allReservations[currentEmail]) {
      allReservations[currentEmail] = allReservations[currentEmail].filter(e => !(
        e.weekKey === r.weekKey && e.blockId === r.blockId &&
        e.dayIndex === r.dayIndex && e.machine === r.machine
      ));
      if (allReservations[currentEmail].length === 0) delete allReservations[currentEmail];
    }
    document.getElementById('blocks-used').textContent =
      countPersistedBlocks(currentEmail, selectedMachine) + currentSelections.length;
    refreshScheduleTable(); updateConfirmBox(); updateConfirmButton();
    showToast('🗑️ Reserva cancelada', 'warning');
  } catch (e) {
    showToast('❌ Error al cancelar. Intenta de nuevo.', 'error');
  }
}

// ── CONFIRM BUTTON ────────────────────────────────────────────
function updateConfirmButton() {
  const btn = document.getElementById('btn-confirm');
  const ok  = selectedMachine && emailValid && currentSelections.length > 0;
  if (!btn.dataset.loading) btn.disabled = !ok;
}

// ── CONFIRM RESERVATION ───────────────────────────────────────
async function confirmReservation() {
  if (!selectedMachine || !emailValid || currentSelections.length === 0) return;

  const btn = document.getElementById('btn-confirm');
  btn.dataset.loading = '1';
  setButtonLoading(btn, true);

  try {
    const toPost = currentSelections.map(s => ({
      machine:  selectedMachine,
      blockId:  s.blockId,
      dayIndex: s.dayIndex,
      day:      s.day,
      block:    s.block,
      ayudante: s.ayudante,
      weekKey:  s.weekKey,
      ts:       Date.now(),
    }));

    const updatedList = await postReservations(currentEmail, toPost);
    allReservations[currentEmail] = updatedList; // actualizar caché local

    const count = currentSelections.length;
    currentSelections = [];
    document.getElementById('blocks-used').textContent =
      countPersistedBlocks(currentEmail, selectedMachine);
    refreshScheduleTable(); updateConfirmBox();
    showToast(
      `🎉 ¡${count} bloque${count > 1 ? 's' : ''} reservado${count > 1 ? 's' : ''} con éxito!`,
      'success'
    );
    document.getElementById('section-confirm').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    showToast('❌ Error al guardar. Intenta de nuevo.', 'error');
  } finally {
    delete btn.dataset.loading;
    setButtonLoading(btn, false);
    updateConfirmButton();
  }
}

// ── MY RESERVATIONS MODAL ─────────────────────────────────────
function openMyReservations() {
  const overlay = document.getElementById('modal-overlay');
  const body    = document.getElementById('modal-body');
  body.innerHTML = '';
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('open');

  const emails = Object.keys(allReservations);
  if (emails.length === 0) {
    body.innerHTML = '<p class="modal-empty">No hay reservas registradas aún.</p>';
    return;
  }

  const targetEmails = emailValid ? [currentEmail] : emails;
  const filtered = targetEmails.filter(e => allReservations[e]?.length > 0);

  if (filtered.length === 0) {
    body.innerHTML = '<p class="modal-empty">No tienes reservas activas con este correo.</p>';
    return;
  }

  filtered.forEach(email => {
    const emailHeader = document.createElement('div');
    emailHeader.className = 'modal-email-header';
    emailHeader.innerHTML = `<span class="modal-email-icon">✉️</span><span class="modal-email-addr">${email}</span>`;
    body.appendChild(emailHeader);

    const byWeek = {};
    allReservations[email].forEach(r => {
      const wk = r.weekKey?.slice(0, 10) ?? 'sin-semana';
      if (!byWeek[wk]) byWeek[wk] = {};
      if (!byWeek[wk][r.machine]) byWeek[wk][r.machine] = [];
      byWeek[wk][r.machine].push(r);
    });

    for (const [wk, byMachine] of Object.entries(byWeek).sort()) {
      const weekLabel = wk !== 'sin-semana'
        ? `Semana del ${wk.slice(8,10)}/${wk.slice(5,7)}/${wk.slice(0,4)}` : 'Sin semana';
      const wTitle = document.createElement('div');
      wTitle.className = 'modal-section-title week-section-title';
      wTitle.innerHTML = `📅 ${weekLabel}`;
      body.appendChild(wTitle);

      for (const [machine, rList] of Object.entries(byMachine)) {
        const mTitle = document.createElement('div');
        mTitle.className = 'modal-machine-subtitle';
        mTitle.textContent = machine === 'laser' ? '🔴 Cortadora Láser' : '🔩 Máquina CNC';
        body.appendChild(mTitle);

        rList.forEach(r => {
          const blockObj = BLOCKS.find(b => b.id === r.blockId);
          const time = blockObj?.time ?? '';
          const row = document.createElement('div');
          row.className = 'modal-reservation';
          row.innerHTML = `
            <div class="modal-res-info">
              <div class="modal-res-block">${r.block.label ?? r.block} &mdash; ${r.day}</div>
              <div class="modal-res-detail">🕐 ${time} &nbsp;·&nbsp; 👤 ${r.ayudante}</div>
            </div>
          `;
          body.appendChild(row);
        });
      }
    }
  });
}

function closeMyReservations() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}
function closeModal(event) {
  if (event.target === document.getElementById('modal-overlay')) closeMyReservations();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMyReservations(); });

// ── TOAST ─────────────────────────────────────────────────────
let toastTimeout = null;
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.className = `toast ${type}`; }, 3400);
}
