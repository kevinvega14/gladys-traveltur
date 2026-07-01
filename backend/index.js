const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
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

app.post('/admin/nuevo-viaje', requireAuth, async (req, res) => {
    const { destino, precio, moneda, fecha, fecha_regreso, tipo, empresa, imagen_url } = req.body;
    try {
        if (!destino || !precio || !fecha) {
            return res.status(400).json({ error: 'Destino, precio y fecha son obligatorios' });
        }

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
app.post('/admin/nuevo-cliente', requireAuth, async (req, res) => {
    try {
        const { apellido, nombre, dni, telefono } = req.body;
        if (!apellido || !dni) return res.status(400).json({ error: 'Apellido y DNI son obligatorios' });

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
app.post('/admin/nueva-reserva', requireAuth, async (req, res) => {
    try {
        const { id_cliente, id_salida, cantidad_pasajeros, monto_total, monto_pagado } = req.body;
        if (!id_cliente || !id_salida || !cantidad_pasajeros) {
            return res.status(400).json({ error: 'Cliente, viaje y cantidad de pasajeros son obligatorios' });
        }

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

        // Actualizamos el contador de vendidos de la salida (para el ranking de bonificaciones)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Gladys OK en puerto ${PORT}`));

module.exports = { app, capitalizar };
