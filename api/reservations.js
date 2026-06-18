// ============================================================
// api/reservations.js – ReservaLab USM
// Vercel Serverless Function  (Node.js runtime)
// Métodos: GET / POST / DELETE
// Storage:  Vercel KV (Upstash Redis – plan gratuito)
// ============================================================

const { kv } = require('@vercel/kv');

const KV_KEY     = 'reservalab:v1';
const USM_PATTERN = /^[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9\-]+\.)*usm\.cl$/i;

module.exports = async function handler(req, res) {
  // ── CORS (útil en dev local) ──────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET /api/reservations ─────────────────────────────
    // Devuelve todas las reservas (para mostrar slots ocupados a todos los usuarios)
    if (req.method === 'GET') {
      const data = (await kv.get(KV_KEY)) ?? {};
      return res.status(200).json({ success: true, data });
    }

    // ── POST /api/reservations ────────────────────────────
    // Body: { email: string, reservations: Reservation[] }
    // Añade reservas al registro del email (sin duplicados)
    if (req.method === 'POST') {
      const body = req.body ?? {};
      const { email, reservations } = body;

      if (!email || !Array.isArray(reservations) || reservations.length === 0) {
        return res.status(400).json({ success: false, error: 'Datos inválidos' });
      }
      if (!USM_PATTERN.test(email)) {
        return res.status(400).json({ success: false, error: 'Correo no válido (@usm.cl requerido)' });
      }

      // Leer estado actual
      const all = (await kv.get(KV_KEY)) ?? {};
      if (!all[email]) all[email] = [];

      // Agregar sólo las reservas que no existan ya
      for (const r of reservations) {
        const dup = all[email].some(e =>
          e.weekKey  === r.weekKey  &&
          e.blockId  === r.blockId  &&
          e.dayIndex === r.dayIndex &&
          e.machine  === r.machine
        );
        if (!dup) all[email].push(r);
      }

      // Validar límite de 3 bloques por semana por máquina por persona
      const weekPrefix = reservations[0]?.weekKey?.slice(0, 10) ?? '';
      const weekCount  = all[email].filter(r =>
        r.weekKey?.startsWith(weekPrefix) &&
        r.machine === (reservations[0]?.machine ?? '')
      ).length;

      if (weekCount > 3) {
        // Revertir si se pasa del límite
        all[email] = all[email].filter(r =>
          !reservations.some(nr =>
            nr.weekKey === r.weekKey && nr.blockId === r.blockId &&
            nr.dayIndex === r.dayIndex && nr.machine === r.machine
          )
        );
        return res.status(400).json({ success: false, error: 'Límite de 3 bloques por semana excedido' });
      }

      await kv.set(KV_KEY, all);
      return res.status(200).json({ success: true, data: all[email] });
    }

    // ── DELETE /api/reservations ──────────────────────────
    // Body: { email, weekKey, blockId, dayIndex, machine }
    // Elimina una reserva específica
    if (req.method === 'DELETE') {
      const body = req.body ?? {};
      const { email, weekKey, blockId, dayIndex, machine } = body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email requerido' });
      }

      const all = (await kv.get(KV_KEY)) ?? {};
      if (all[email]) {
        all[email] = all[email].filter(r => !(
          r.weekKey  === weekKey  &&
          r.blockId  === blockId  &&
          r.dayIndex === dayIndex &&
          r.machine  === machine
        ));
        if (all[email].length === 0) delete all[email];
      }

      await kv.set(KV_KEY, all);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido' });

  } catch (err) {
    console.error('[ReservaLab API]', err);
    // Si KV no está configurado aún, devuelve error descriptivo
    const msg = err.message?.includes('KV_') || err.message?.includes('token')
      ? 'Base de datos KV no configurada. Crea y vincula un KV store en el dashboard de Vercel.'
      : 'Error interno del servidor';
    return res.status(500).json({ success: false, error: msg });
  }
};
