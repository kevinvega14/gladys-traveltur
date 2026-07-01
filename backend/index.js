const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const { z } = require('zod');

// Middleware genérico: valida req.body contra un schema de Zod
function validar(schema) {
    return (req, res, next) => {
        const resultado = schema.safeParse(req.body);
        if (!resultado.success) {
            const errores = resultado.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
            return res.status(400).json({ error: 'Datos inválidos', detalles: errores });
        }
        req.body = resultado.data; // body ya "limpio" y tipado
        next();
    };
}

// Schemas
const schemaNuevoViaje = z.object({
    destino: z.string().trim().min(2, 'El destino es obligatorio'),
    precio: z.coerce.number().positive('El precio debe ser mayor a 0'),
    moneda: z.enum(['ARS', 'USD']).optional().default('ARS'),
    fecha: z.string().min(1, 'La fecha de salida es obligatoria'),
    fecha_regreso: z.string().optional(),
    tipo: z.string().optional().default('Micro'),
    empresa: z.string().trim().optional(),
    imagen_url: z.string().url('La imagen debe ser una URL válida').optional().or(z.literal(''))
});

const schemaNuevoCliente = z.object({
    apellido: z.string().trim().min(2, 'El apellido es obligatorio'),
    nombre: z.string().trim().optional(),
    dni: z.string().trim().min(6, 'DNI inválido'),
    telefono: z.string().trim().optional()
});

const schemaNuevaReserva = z.object({
    id_cliente: z.coerce.number().int().positive('Cliente inválido'),
    id_salida: z.coerce.number().int().positive('Viaje inválido'),
    cantidad_pasajeros: z.coerce.number().int().positive('La cantidad de pasajeros debe ser mayor a 0'),
    monto_total: z.coerce.number().nonnegative().optional().default(0),
    monto_pagado: z.coerce.number().nonnegative().optional().default(0)
});
// CORS explícito para desarrollo local con Live Server
const ORIGENES_PERMITIDOS = [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://localhost:4000'
];

app.use(cors({
    origin: function (origin, callback) {
        // Permite también pedidos sin "origin" (Postman, curl, etc.)
        if (!origin || ORIGENES_PERMITIDOS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('⛔ Origen bloqueado por CORS:', origin);
            callback(new Error('No autorizado por CORS'));
        }
    }
}));

app.use(express.json());

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ Faltan SUPABASE_URL / SUPABASE_KEY en el archivo .env');
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Primera letra mayúscula, resto minúsculas
const capitalizar = (t) => t ? t.toString().trim().charAt(0).toUpperCase() + t.toString().trim().slice(1).toLowerCase() : "";

// ============================================================
// AUTENTICACIÓN SIMPLE (panel admin)
// Sesiones en memoria: token -> timestamp de expiración
// ============================================================
const sessions = new Map();
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas

function requireAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'No autorizado. Iniciá sesión nuevamente.' });
    }
    const exp = sessions.get(token);
    if (Date.now() > exp) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Sesión expirada. Iniciá sesión nuevamente.' });
    }
    next();
}

app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada en el servidor (.env)' });
    }
    if (!password || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ ok: true, token });
});

app.post('/admin/logout', requireAuth, (req, res) => {
    sessions.delete(req.headers['x-admin-token']);
    res.json({ ok: true });
});

// ============================================================
// HELPERS: buscar o crear destino / empresa (evita duplicados)
// ============================================================
async function findOrCreateDestino(nombre) {
    const nombreCap = capitalizar(nombre);
    if (!nombreCap) throw new Error('El destino es obligatorio');

    const { data: existentes, error: errBusqueda } = await supabase
        .from('destinos')
        .select('id_destino')
        .ilike('nombre', nombreCap)
        .limit(1);
    if (errBusqueda) throw errBusqueda;
    if (existentes && existentes.length > 0) return existentes[0].id_destino;

    const { data: creado, error: errCrear } = await supabase
        .from('destinos')
        .insert([{ nombre: nombreCap }])
        .select();
    if (errCrear) throw errCrear;
    return creado[0].id_destino;
}

async function findOrCreateEmpresa(nombre) {
    const nombreLimpio = (nombre || 'GENERAL').toString().trim().toUpperCase();

    const { data: existentes, error: errBusqueda } = await supabase
        .from('empresas')
        .select('id_empresa')
        .ilike('nombre', nombreLimpio)
        .limit(1);
    if (errBusqueda) throw errBusqueda;
    if (existentes && existentes.length > 0) return existentes[0].id_empresa;

    const { data: creada, error: errCrear } = await supabase
        .from('empresas')
        .insert([{ nombre: nombreLimpio }])
        .select();
    if (errCrear) throw errCrear;
    return creada[0].id_empresa;
}

// ============================================================
// VIAJES (salidas)
// ============================================================

// Listado completo (lo usa tanto el admin como la web pública)
app.get('/admin/ranking', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('salidas')
            .select(`
                id_salida, fecha_salida, fecha_regreso, precio_total, moneda,
                tipo_viaje, activo, vendidos,
                destinos ( id_destino, nombre, imagen_url ),
                empresas ( id_empresa, nombre )
            `)
            .order('fecha_salida', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/empresas', async (req, res) => {
    try {
        const { data, error } = await supabase.from('empresas').select('*').order('nombre');
        if (error) throw error;
        res.json(data);
    } catch (e) { res.json([]); }
});

app.get('/admin/destinos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('destinos').select('*').order('nombre');
        if (error) throw error;
        res.json(data);
    } catch (e) { res.json([]); }
});

app.post('/admin/nuevo-viaje', requireAuth, validar(schemaNuevoViaje), async (req, res) => {
    const { destino, precio, moneda, fecha, fecha_regreso, tipo, empresa, imagen_url } = req.body;
    try {
        const id_destino = await findOrCreateDestino(destino);
        const id_empresa = await findOrCreateEmpresa(empresa);

        // Si mandaron una URL de imagen y el destino no tenía una, la guardamos
        if (imagen_url) {
            await supabase.from('destinos')
                .update({ imagen_url })
                .eq('id_destino', id_destino)
                .is('imagen_url', null);
        }

        const { error: errS } = await supabase.from('salidas').insert([{
            id_destino,
            id_empresa,
            fecha_salida: fecha,
            fecha_regreso: fecha_regreso || fecha,
            precio_total: parseFloat(precio),
            moneda: moneda || 'ARS',
            tipo_viaje: tipo || 'Micro',
            activo: true,
            vendidos: 0
        }]);
        if (errS) throw errS;

        res.json({ ok: true });
    } catch (e) {
        console.error('Error en /admin/nuevo-viaje:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/admin/eliminar-viaje/:id', requireAuth, async (req, res) => {
    try {
        await supabase.from('reservas').delete().eq('id_salida', req.params.id);
        await supabase.from('salidas').delete().eq('id_salida', req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/toggle-viaje/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabase.from('salidas').update({ activo: req.body.estado }).eq('id_salida', req.params.id);
        if (error) throw error;
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// CLIENTES
// ============================================================
app.post('/admin/nuevo-cliente', requireAuth, validar(schemaNuevoCliente), async (req, res) => {
    try {
        const { apellido, nombre, dni, telefono } = req.body;

        const payload = {
            apellido: capitalizar(apellido),
            nombre: capitalizar(nombre),
            dni: dni.toString().trim(),
            'teléfono': telefono || null
        };
        const { error } = await supabase.from('clientes').insert([payload]);
        if (error) throw error;
        res.json({ ok: true });
    } catch (e) {
        console.error('Error en /admin/nuevo-cliente:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/admin/clientes', async (req, res) => {
    try {
        const { data, error } = await supabase.from('clientes').select('*').order('apellido');
        if (error) throw error;
        res.json(data);
    } catch (e) { res.json([]); }
});

// ============================================================
// RESERVAS
// ============================================================
app.post('/admin/nueva-reserva', requireAuth, validar(schemaNuevaReserva), async (req, res) => {
    try {
        const { id_cliente, id_salida, cantidad_pasajeros, monto_total, monto_pagado } = req.body;

        const pax = parseInt(cantidad_pasajeros);
        const total = parseFloat(monto_total) || 0;
        const pagado = parseFloat(monto_pagado) || 0;

        let estado_pago = 'Pendiente';
        if (pagado > 0 && pagado >= total) estado_pago = 'Completo';
        else if (pagado > 0) estado_pago = 'Parcial';

        const { error } = await supabase.from('reservas').insert([{
            id_cliente, id_salida,
            cantidad_pasajeros: pax,
            monto_total: total,
            monto_pagado: pagado,
            estado_pago,
            estado: 'Confirmada'
        }]);
        if (error) throw error;

        const { data: salidaActual } = await supabase.from('salidas').select('vendidos').eq('id_salida', id_salida).single();
        if (salidaActual) {
            await supabase.from('salidas')
                .update({ vendidos: (salidaActual.vendidos || 0) + pax })
                .eq('id_salida', id_salida);
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('Error en /admin/nueva-reserva:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/admin/reservas/:id/cancelar', requireAuth, async (req, res) => {
    try {
        const { data: reserva, error: errR } = await supabase
            .from('reservas').select('id_salida, cantidad_pasajeros, estado')
            .eq('id_reserva', req.params.id).single();
        if (errR) throw errR;
        if (reserva.estado === 'Cancelada') return res.json({ ok: true });

        await supabase.from('reservas').update({ estado: 'Cancelada' }).eq('id_reserva', req.params.id);

        const { data: salida } = await supabase.from('salidas').select('vendidos').eq('id_salida', reserva.id_salida).single();
        if (salida) {
            await supabase.from('salidas')
                .update({ vendidos: Math.max(0, (salida.vendidos || 0) - reserva.cantidad_pasajeros) })
                .eq('id_salida', reserva.id_salida);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/historial-reservas', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reservas')
            .select(`
                id_reserva, cantidad_pasajeros, monto_total, monto_pagado, estado_pago, estado, fecha_reserva,
                clientes ( nombre, apellido ),
                salidas ( fecha_salida, tipo_viaje, destinos ( nombre ), empresas ( nombre ) )
            `)
            .order('id_reserva', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (e) { res.json([]); }
});

// ============================================================
// RANKING DE VENTAS (bonificación cada 6 pasajeros vendidos)
// ============================================================
app.get('/admin/ranking-ventas', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('salidas')
            .select(`vendidos, destinos ( nombre ), empresas ( nombre )`)
            .gt('vendidos', 0);
        if (error) throw error;

        const rank = {};
        (data || []).forEach(s => {
            const destino = s.destinos ? s.destinos.nombre : 'N/D';
            const empresa = s.empresas ? s.empresas.nombre : 'N/D';
            const k = `${empresa}-${destino}`;
            if (!rank[k]) rank[k] = { empresa, destino, vendidos: 0 };
            rank[k].vendidos += (s.vendidos || 0);
        });

        const resultado = Object.values(rank).map(v => {
            const resto = v.vendidos % 6;
            return { ...v, gratis: Math.floor(v.vendidos / 6), falta: resto === 0 ? 6 : 6 - resto };
        }).sort((a, b) => b.vendidos - a.vendidos);

        res.json(resultado);
    } catch (e) { res.json([]); }
});
// ============================================================
// ASISTENTE VIRTUAL (Gemini) — /api/chat
// ============================================================
const { GoogleGenAI } = require('@google/genai');
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body;
    console.log("📩 Mensaje recibido en el backend:", message);

    try {
        if (!ai) {
            console.error("❌ GEMINI_API_KEY no está configurada en .env");
            return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en el servidor' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Falta el mensaje' });
        }

        const { data: viajes, error } = await supabase
            .from('salidas')
            .select(`fecha_salida, precio_total, moneda, tipo_viaje, destinos ( nombre ), empresas ( nombre )`)
            .eq('activo', true)
            .order('fecha_salida', { ascending: true });
        if (error) throw error;

        const contextoViajes = (viajes || []).map(v =>
            `- ${v.destinos ? v.destinos.nombre : 'Destino'} | Empresa: ${v.empresas ? v.empresas.nombre : 'N/D'} | Salida: ${v.fecha_salida} | ${v.tipo_viaje} | ${v.moneda} ${v.precio_total}`
        ).join('\n') || 'No hay salidas activas cargadas por el momento.';

        const systemInstruction = `Sos "Gladys Bot", el asistente virtual de ventas de la agencia de viajes Gladys Traveltur.

Estas son las salidas ACTIVAS disponibles ahora mismo (es tu única fuente de verdad):
${contextoViajes}

Reglas: respondé en español rioplatense, tono cálido y profesional, máximo 3-4 líneas, invitá a reservar por WhatsApp, no inventes datos que no estén en la lista.`;

        const historialFormateado = (history || []).map(h => ({
            role: h.role === 'bot' ? 'model' : 'user',
            parts: [{ text: h.text }]
        }));

        const chat = ai.chats.create({
            model: 'gemini-3.5-flash',
            config: { systemInstruction },
            history: historialFormateado
        });

        // Timeout de seguridad: si Gemini no responde en 15s, no dejamos el pedido colgado
        const respuesta = await Promise.race([
            chat.sendMessage({ message }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_GEMINI')), 15000))
        ]);

        console.log("✅ Respuesta generada correctamente");
        res.json({ reply: respuesta.text });

    } catch (e) {
        console.error('❌ Error en /api/chat:', e.message);
        if (e.message === 'TIMEOUT_GEMINI') {
            return res.status(504).json({ error: 'El asistente tardó demasiado en responder. Probá de nuevo.' });
        }
        res.status(500).json({ error: 'No se pudo generar la respuesta del asistente. Probá de nuevo en un momento.' });
    }
});
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Servidor Gladys OK en puerto ${PORT}`));
}

module.exports = { app, capitalizar };
