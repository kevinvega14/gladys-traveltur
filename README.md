# 🧳 Gladys Traveltur — Sistema de Gestión de Viajes

Sistema web para una agencia de viajes: un **sitio público** donde los clientes ven las ofertas
disponibles, y un **panel de administración** donde el equipo carga viajes, gestiona clientes,
registra reservas/ventas y controla bonificaciones por volumen de ventas.

Proyecto realizado como challenge técnico para AranguriApps.

---

## 📌 De qué trata el proyecto

Gladys Traveltur es una agencia de turismo que vende paquetes (en micro o vía aérea) a distintos
destinos, a través de distintas empresas de transporte. El sistema resuelve tres necesidades reales:

1. **Vidriera pública** (`index.html`): los clientes buscan y filtran las salidas disponibles por
   destino, fecha y precio, y consultan directamente por WhatsApp.
2. **Panel administrativo** (`admin.html`, protegido por contraseña): carga de nuevos viajes,
   registro de clientes, carga de reservas/ventas y control de pagos.
3. **Ranking de bonificaciones**: cada 6 pasajeros vendidos por combinación empresa+destino se
   genera un lugar gratis (política habitual de las agencias de viaje con los micros/charters).

## 🛠️ Tecnologías y arquitectura, y por qué

- **Backend:** Node.js + Express, exponiendo una API REST simple sobre Supabase.
- **Base de datos / BaaS:** Supabase (Postgres administrado), usando el cliente
  `@supabase/supabase-js` para consultas con *joins* declarativos (`select('*, tabla(...)')`),
  que evita tener que escribir SQL a mano para las relaciones.
- **Frontend:** HTML + CSS + JavaScript vanilla (sin framework ni build step). Se eligió
  deliberadamente así para un proyecto de este tamaño: dos pantallas con lógica de UI moderada
  no justifican la complejidad de un bundler; permite además desplegarlo como sitio estático en
  segundos (Vercel/Netlify) sin paso de compilación.
- **Autenticación del panel admin:** contraseña única (`ADMIN_PASSWORD`) + tokens de sesión en
  memoria del servidor, enviados por header `x-admin-token`. Es intencionalmente simple para el
  alcance del challenge; la tabla `usuarios` ya existe en el esquema para evolucionar a un login
  por usuario con contraseñas hasheadas (bcrypt) o Supabase Auth — ver `database/schema-notes.md`.

### Arquitectura

```
frontend/index.html   → sitio público (solo lectura, consume GET /admin/ranking)
frontend/admin.html   → panel admin (login + CRUD de viajes, clientes, reservas)
backend/index.js      → API REST (Express) sobre Supabase
database/schema-notes.md → documentación del esquema real de Supabase
```

Todas las rutas de **lectura** (`GET`) son públicas porque el sitio del cliente las necesita.
Las rutas que **modifican datos** (`POST` / `PUT` / `DELETE`) están protegidas con el middleware
`requireAuth`, que exige el token obtenido en `/admin/login`.

## 🤖 Herramientas de IA utilizadas y cómo aceleraron el desarrollo

Se usó **Claude (Anthropic)** como copiloto de desarrollo durante todo el proceso, en particular para:

- **Auditoría del código existente**: a partir de capturas de pantalla del editor de tablas de
  Supabase, se detectó que el backend original consultaba/escribía una columna `destino` en la
  tabla `salidas` que **no existe** en el esquema real (el destino se obtiene por relación con
  `destinos`), y que el campo `clientes.teléfono` no coincidía con la clave `telefono` que mandaba
  el frontend. Esto explicaba fallos silenciosos en el panel admin.
- **Generación de los endpoints corregidos**, incluyendo los *joins* anidados de Supabase
  (`salidas → destinos`, `salidas → empresas`, `reservas → clientes/salidas`) y funciones
  `findOrCreate` para evitar destinos/empresas duplicados en cada alta (el problema original
  generaba un registro nuevo en `destinos` por cada viaje cargado, incluso repitiendo el mismo
  nombre).
- **Diseño de la capa de autenticación simple** del panel admin y su integración en el frontend
  (pantalla de login, manejo de token en `sessionStorage`, wrapper `authFetch`).
- **Redacción de esta documentación y del esquema de base de datos**.

Todo el código generado fue revisado, ejecutado localmente (`node --check` sobre cada archivo) y
ajustado manualmente donde el criterio del desarrollador lo requirió — por ejemplo, se optó
deliberadamente por **no** tocar columnas con nombres acentuados de bajo uso (`duración_días`,
`ubicación`, etc.) para minimizar el riesgo de romper la conexión real sin poder verificarlas en
vivo, dejándolas documentadas como mejora futura en lugar de adivinar su comportamiento.

## 🖥️ Pantallas

1. **Sitio público** — listado y búsqueda de ofertas activas, separadas por Aéreo/Micro.
2. **Panel admin → Cargar Viaje** — alta de nuevas salidas, con listado y acciones (activar/agotar/eliminar).
3. **Panel admin → Clientes** — alta y listado de clientes.
4. **Panel admin → Ventas** — carga de reservas con autocompletado de cliente y cálculo automático de precio.
5. **Panel admin → Reservas Hechas** — historial con estado de pago y cancelación.
6. **Panel admin → Control de Ventas** — ranking de bonificaciones por empresa/destino.

## ▶️ Cómo instalarlo y correrlo localmente

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Completá `.env` con tu `SUPABASE_URL`, `SUPABASE_KEY` (podés usar la `anon key` si tenés RLS
desactivado, como en este proyecto) y elegí una `ADMIN_PASSWORD` para el panel.

```bash
npm start        # o: npm run dev  (recarga automática)
```

El servidor levanta en `http://localhost:3000`.

### 2. Frontend

Es HTML estático, no necesita build. La forma más simple:

```bash
cd frontend
npx serve .
# o simplemente abrí index.html / admin.html con la extensión "Live Server" de VS Code
```

Si servís el frontend en otro puerto/dominio, la constante `API` al inicio del `<script>` de
cada HTML apunta a `http://localhost:3000` — cambiala por la URL real de tu backend cuando
despliegues (ver más abajo).

### 3. Tests

```bash
cd backend
npm test
```

## 🚀 Deploy

- **Backend:** Render / Railway (Node.js). Configurar las variables de entorno del `.env` en el
  panel del proveedor. Recordá que el plan gratuito de Render "duerme" el servicio tras
  inactividad — la primera petición puede tardar unos segundos.
- **Frontend:** Vercel / Netlify, apuntando la carpeta `frontend/` como raíz del sitio estático.
  Antes de desplegar, reemplazá en `index.html` y `admin.html`:

  ```js
  const API = "http://localhost:3000";
  ```

  por la URL pública de tu backend ya desplegado, por ejemplo:

  ```js
  const API = "https://gladys-traveltur-api.onrender.com";
  ```

## 📂 Estructura del repo

```
.
├── backend/
│   ├── index.js
│   ├── package.json
│   ├── .env.example
│   └── tests/
│       └── capitalizar.test.js
├── frontend/
│   ├── index.html
│   └── admin.html
├── database/
│   └── schema-notes.md
└── README.md
```

## ✅ Pendientes / mejoras futuras (documentadas a propósito, no implementadas por tiempo)

- Migrar el login admin de contraseña única a la tabla `usuarios` con bcrypt (o Supabase Auth).
- Aprovechar `destinos.descripción` y `destinos.ubicación` en las tarjetas del sitio público.
- Subida de imágenes de destino (hoy se acepta una URL manual) a Supabase Storage.
- CI (GitHub Actions) corriendo `npm test` en cada push.
