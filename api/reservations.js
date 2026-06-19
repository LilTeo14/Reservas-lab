// ============================================================
// api/reservations.js – ReservaLab USM
// Vercel Serverless Function  (Node.js runtime)
// Métodos: GET / POST / DELETE
// Storage:  Upstash Redis (marketplace gratuito de Vercel)
//
// Variables de entorno (se añaden automáticamente al conectar
// Upstash desde el dashboard de Vercel → Storage → Upstash):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ============================================================

const { Redis } = require('@upstash/redis');

// Las variables de entorno son inyectadas automáticamente por Vercel al conectar
// la base de datos Upstash desde el dashboard (Storage → Upstash → Connect to Project).
// El prefijo "reservalab_redis_" viene del nombre de la base de datos creada.
const redis = new Redis({
  url:   process.env.reservalab_redis_KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.reservalab_redis_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KV_KEY      = 'reservalab:v1';
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
      const data = (await redis.get(KV_KEY)) ?? {};
      return res.status(200).json({ success: true, data });
    }

    // ── POST /api/reservations ────────────────────────────
    // Body: { email: string, reservations: Reservation[] }
    // Añade reservas al registro del email (sin duplicados)
    // O si action === 'verify_admin', verifica la contraseña.
    if (req.method === 'POST') {
      const body = req.body ?? {};
      
      if (body.action === 'verify_admin') {
        const { password } = body;
        const expected = process.env.ADMIN_PASSWORD || 'ReservaLabAdmin2026';
        if (password === expected) {
          return res.status(200).json({ success: true });
        } else {
          return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        }
      }

      const { email, reservations } = body;

      if (!email || !Array.isArray(reservations) || reservations.length === 0) {
        return res.status(400).json({ success: false, error: 'Datos inválidos' });
      }
      if (!USM_PATTERN.test(email)) {
        return res.status(400).json({ success: false, error: 'Correo no válido (@usm.cl requerido)' });
      }

      // Leer estado actual
      const all = (await redis.get(KV_KEY)) ?? {};
      if (!all[email]) all[email] = [];

      // Agregar sólo las reservas que no existan ya (con status por defecto 'pending')
      for (const r of reservations) {
        const dup = all[email].some(e =>
          e.weekKey  === r.weekKey  &&
          e.blockId  === r.blockId  &&
          e.dayIndex === r.dayIndex &&
          e.machine  === r.machine
        );
        if (!dup) {
          all[email].push({
            ...r,
            status: r.status || 'pending'
          });
        }
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

      await redis.set(KV_KEY, all);
      return res.status(200).json({ success: true, data: all[email] });
    }

    // Helper para verificar admin
    const verifyAdmin = (req) => {
      const auth = req.headers['authorization'];
      const expected = process.env.ADMIN_PASSWORD || 'ReservaLabAdmin2026';
      return auth === expected;
    };

    // ── PUT /api/reservations ─────────────────────────────
    // Body: { email, weekKey, blockId, dayIndex, machine, status }
    // Actualiza el estado de una reserva específica
    if (req.method === 'PUT') {
      if (!verifyAdmin(req)) {
        return res.status(401).json({ success: false, error: 'No autorizado' });
      }

      const body = req.body ?? {};
      const { email, weekKey, blockId, dayIndex, machine, status } = body;

      if (!email || !weekKey || !blockId || dayIndex === undefined || !machine || !status) {
        return res.status(400).json({ success: false, error: 'Datos incompletos para actualizar status' });
      }

      const all = (await redis.get(KV_KEY)) ?? {};
      if (all[email]) {
        all[email] = all[email].map(r => {
          if (
            r.weekKey  === weekKey  &&
            r.blockId  === blockId  &&
            r.dayIndex === parseInt(dayIndex) &&
            r.machine  === machine
          ) {
            return { ...r, status };
          }
          return r;
        });
        await redis.set(KV_KEY, all);
        return res.status(200).json({ success: true, data: all[email] });
      }

      return res.status(404).json({ success: false, error: 'Reserva no encontrada' });
    }

    // ── DELETE /api/reservations ──────────────────────────
    // Body: { email, weekKey, blockId, dayIndex, machine }
    // Elimina una reserva específica (requiere autenticación de admin)
    if (req.method === 'DELETE') {
      if (!verifyAdmin(req)) {
        return res.status(401).json({ success: false, error: 'No autorizado' });
      }

      const body = req.body ?? {};
      const { email, weekKey, blockId, dayIndex, machine } = body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email requerido' });
      }

      const all = (await redis.get(KV_KEY)) ?? {};
      if (all[email]) {
        all[email] = all[email].filter(r => !(
          r.weekKey  === weekKey  &&
          r.blockId  === blockId  &&
          r.dayIndex === parseInt(dayIndex) &&
          r.machine  === machine
        ));
        if (all[email].length === 0) delete all[email];
      }

      await redis.set(KV_KEY, all);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido' });

  } catch (err) {
    console.error('[ReservaLab API]', err);
    const msg = err.message?.includes('UPSTASH') || err.message?.includes('token') || err.message?.includes('fetch')
      ? 'Base de datos no configurada. Conecta Upstash Redis desde el dashboard de Vercel → Storage.'
      : 'Error interno del servidor';
    return res.status(500).json({ success: false, error: msg });
  }
};
