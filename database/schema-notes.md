# Esquema de Base de Datos — Gladys Traveltur

Relevado desde Supabase (Table Editor). Todas las tablas están en el esquema `public`, sin RLS activado (proyecto de challenge / uso interno).

## Diagrama de relaciones

```
usuarios                    empresas
├─ id_usuario (PK)          ├─ id_empresa (PK)
├─ nombre                   └─ nombre
├─ correo_electronico
├─ hash_de_contraseña              ▲
└─ es_admin                        │
                                    │
clientes                    salidas
├─ id_cliente (PK)          ├─ id_salida (PK)
├─ dni                      ├─ id_destino (FK → destinos)
├─ teléfono                 ├─ id_empresa (FK → empresas)
├─ fecha_registro           ├─ fecha_salida
├─ nombre                   ├─ fecha_regreso
└─ apellido                 ├─ duración_días
      ▲                     ├─ duración_noches
      │                     ├─ precio_total
reservas                    ├─ bus_piso_preferencia
├─ id_reserva (PK)          ├─ activo
├─ id_cliente (FK)          ├─ vendidos
├─ id_salida (FK) ──────────┤
├─ cantidad_pasajeros       ├─ tipo_viaje
├─ monto_total              └─ moneda
├─ monto_pagado                     │
├─ estado_pago                      ▼
├─ fecha_reserva             destinos
├─ notas                    ├─ id_destino (PK)
└─ estado                   ├─ nombre
                             ├─ ubicación
                             ├─ descripción
                             └─ imagen_url
```

## Notas importantes sobre nombres de columnas

- La tabla `salidas` **no tiene** una columna `destino` de texto. El destino real es
  siempre la relación `id_destino → destinos.nombre`. El proyecto original tenía un bug
  que intentaba leer/escribir esa columna inexistente — ya está corregido en `backend/index.js`.
- `clientes.teléfono` y `usuarios.correo_electronico` / `usuarios.hash_de_contraseña`
  fueron creadas con esos nombres exactos (algunas con tilde) desde el editor de Supabase.
  Si en tu proyecto real los nombres difieren (por ejemplo `telefono` sin tilde), ajustá
  las referencias en `backend/index.js` — están todas centralizadas en los handlers de
  `/admin/nuevo-cliente`.
- `reservas` tiene dos campos de estado con propósitos distintos:
  - `estado_pago`: Pendiente / Parcial / Completo (según cuánto pagó el cliente).
  - `estado`: Confirmada / Cancelada (ciclo de vida de la reserva).
- `salidas.vendidos` se usa como contador acumulado de pasajeros vendidos por salida,
  y es la base del ranking de bonificaciones (cada 6 pasajeros = 1 lugar gratis).
- La tabla `usuarios` está creada pero **no se usa todavía**: el login del panel admin
  actual es una contraseña única (`ADMIN_PASSWORD` en `.env`) para simplificar el challenge
  dentro del tiempo disponible. Migrar a `usuarios` con hash de contraseña (bcrypt) y
  Supabase Auth queda documentado como mejora futura en el README principal.

## Columnas no utilizadas actualmente (potenciales mejoras futuras)

- `salidas.duración_días`, `duración_noches`, `bus_piso_preferencia`
- `destinos.ubicación`, `descripción` (si se completan, se pueden mostrar en el sitio público)
