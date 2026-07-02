# 🧳 Gladys Traveltur — Sistema de Gestión de Viajes

Sistema web para una agencia de viajes real: un **sitio público** donde los clientes buscan
ofertas, filtran por categoría, ven el detalle completo de cada paquete en un modal, consultan
precios convertidos a pesos en tiempo real y reservan por WhatsApp — y un **panel de
administración** protegido donde el equipo carga viajes, gestiona clientes, registra ventas con
promociones, controla pagos parciales y monitorea bonificaciones por volumen de ventas.

**Demo desplegada (sitio público):** https://majestic-taffy-fe71e6.netlify.app
**Panel admin:** https://majestic-taffy-fe71e6.netlify.app/admin.html

Proyecto realizado por **Kevin Vega** como challenge técnico para AranguriApps.

---

## 📌 De qué trata el proyecto

Gladys Traveltur es una agencia de turismo real que vende paquetes (en micro o vía aérea) a
distintos destinos, a través de distintas empresas de transporte mayoristas. El sistema resuelve
necesidades operativas reales de la agencia:

1. **Vidriera pública**: los clientes buscan/filtran salidas por destino, fecha, categoría
   (Micros, Vuelos, Escapadas, Playa, Promos) y precio. Cada tarjeta muestra fecha exacta,
   imagen contextual del destino, y precio — con **conversión automática a pesos en tiempo real**
   cuando el paquete está cotizado en dólares (vía API pública de cotización). Las promociones
   activas (2x1/3x2/4x3) se destacan en una franja propia arriba de todo, con badge llamativo y
   borde distintivo en la tarjeta.
2. **Modal de detalle**: al elegir un paquete se abre una ficha completa (fechas, duración,
   transporte, qué incluye el paquete) con un botón único que arma un mensaje de WhatsApp
   pre-completado con todos los datos de la reserva — sin pasarelas de pago, tal como opera la
   agencia realmente.
3. **Asistente virtual con IA**: un chatbot (Gemini) integrado en el sitio público responde
   consultas de los clientes usando como única fuente de verdad las salidas activas reales de
   la base de datos — no inventa destinos ni precios.
4. **Panel administrativo**: carga de viajes (con plantillas automáticas de "qué incluye" según
   la combinación empresa/destino, que la agencia usa realmente), registro de clientes,
   ventas con promociones, registro de pagos parciales sobre reservas señadas, búsqueda de
   reservas por apellido/DNI/empresa/estado de pago, y un dashboard de métricas comerciales
   (recaudado, reservas activas, destino más vendido).
5. **Control de bonificaciones**: cada 12 pasajeros vendidos por combinación empresa+destino
   (ajustado proporcionalmente si hubo promoción — por ejemplo una venta 4x3 con 4 pasajeros
   solo computa 3 para el bono real de la mayorista) la agencia recibe un pasaje gratis. Un
   "radar" avisa proactivamente, con un indicador visible en cualquier pestaña del panel, cuando
   una salida está a 1-2 pasajeros de liberar un nuevo bono.

## 🛠️ Tecnologías y arquitectura, y por qué

- **Backend:** Node.js + Express, API REST sobre Supabase (Postgres administrado).
- **Validación:** Zod en los endpoints que reciben datos del usuario, con mensajes de error
  claros en vez de dejar pasar errores crudos de la base de datos.
- **Logging:** Winston con rotación diaria de logs (`app-*.log` y `error-*.log` separados) +
  logging de cada request (método, ruta, status, tiempo de respuesta) vía middleware propio.
- **IA generativa:** Google Gemini (`@google/genai`), con el contexto de viajes activos inyectado
  como *system instruction* en cada request, para que el asistente nunca invente información.
- **Cotización de dólar:** consumo de la API pública `dolarapi.com` (tipo "tarjeta") en el
  frontend, con valor de respaldo fijo si la API externa no responde.
- **Frontend:** HTML + CSS + JavaScript vanilla (sin framework ni build step). Se eligió
  deliberadamente así por el tamaño del proyecto: permite deploy instantáneo como sitio estático
  sin paso de compilación, y la lógica de UI de dos pantallas no justifica la complejidad de un
  bundler.
- **Autenticación del panel admin:** contraseña única (`ADMIN_PASSWORD`) + tokens de sesión en
  memoria, header `x-admin-token`. La tabla `usuarios` ya existe en el esquema de Supabase para
  evolucionar a login por usuario con contraseñas hasheadas — quedó fuera de alcance por tiempo.
- **UX del panel admin:** sistema de notificaciones tipo toast (no bloqueantes, con colores por
  tipo) en reemplazo de `alert()` nativo del navegador.

### Arquitectura

```
frontend/index.html   → sitio público (búsqueda, filtros, modal de detalle, chatbot, promos)
frontend/admin.html   → panel admin (login, ABM de viajes/clientes/reservas, dashboard, radar)
backend/index.js      → API REST (Express) sobre Supabase + integración Gemini
backend/logger.js     → configuración de Winston
backend/request-logger.js → middleware de logging de requests
database/schema-notes.md → documentación completa del esquema de Supabase
database/der-gladys-traveltur.svg → diagrama Entidad-Relación
database/diagrama-clases-gladys-traveltur.svg → diagrama de clases / módulos del sistema
```

Las rutas de **lectura** (`GET`) son públicas porque el sitio del cliente las necesita. Las rutas
que **modifican datos** (`POST`/`PUT`/`DELETE`) están protegidas con el middleware `requireAuth`.

## 🤖 Herramientas de IA utilizadas y cómo aceleraron el desarrollo

Se usó **Claude (Anthropic)** como copiloto durante todo el desarrollo, y **Google Gemini** como
motor del asistente virtual embebido en el producto final (dos usos distintos: uno como
herramienta de desarrollo, otro como feature del propio sistema).

Ejemplos concretos de auditoría y corrección de código generado (no fue copy-paste directo):

- Se detectó, a partir de capturas del editor de tablas de Supabase, que el backend original
  consultaba una columna `destino` en la tabla `salidas` que **no existe** (el destino real se
  obtiene por relación con `destinos`), y que generaba un registro duplicado en `destinos` en
  cada alta de viaje. Se corrigió con `findOrCreate` y joins reales de Supabase.
- Se corrigieron múltiples bugs de integración típicos de sesiones largas de desarrollo asistido:
  middlewares de CORS duplicados que se pisaban entre sí, reglas CSS duplicadas que rompían el
  estilo de las tarjetas, event listeners de JavaScript ejecutándose antes de que el HTML del
  modal existiera en el DOM, y HTML mal anidado que cerraba un `<div>` contenedor antes de tiempo
  y rompía el layout de pestañas enteras del panel admin.
- Se implementó lógica de negocio real y no trivial: cálculo proporcional de pasajeros que
  cuentan para el bono cuando hay una promoción activa, sistema de bonos acumulativo por
  múltiplos de 12, y conversión de moneda en tiempo real con normalización de precios para que el
  ordenamiento "Menor Precio" compare correctamente viajes en pesos y en dólares.
- Para las imágenes de las tarjetas de destinos, se verificaron manualmente (vía búsqueda web)
  los archivos de Wikimedia Commons usados en vez de asumir de memoria qué mostraba cada
  fotografía — varias URLs generadas inicialmente resultaron genéricas o inexactas y se
  reemplazaron por fotos confirmadas de los lugares reales (Glaciar Perito Moreno, Garganta del
  Diablo, Cerro de los Siete Colores, Cristo Redentor, viñedos de Mendoza, etc.).
- Se diagnosticaron a distancia (a partir de capturas de pantalla y logs de consola/terminal)
  errores de deploy reales: puertos ocupados, CORS mal configurado en producción, una URL de
  backend incorrecta pegada por error en el frontend, y una confusión de proyectos duplicados en
  Netlify Drop que se resolvió migrando a deploy continuo conectado directamente al repositorio
  de GitHub (mismo mecanismo ya usado para el backend en Render).

## 🖥️ Pantallas

1. **Sitio público** — hero, buscador con filtros de fecha/orden, barra de categorías, franja de
   promos destacadas, grilla de ofertas con conversión de moneda en vivo, modal de detalle
   completo, chatbot flotante.
2. **Panel admin → Cargar Viaje** — alta de salidas con autocompletado de "qué incluye" según
   empresa/destino, listado con acciones (activar/agotar/eliminar).
3. **Panel admin → Clientes** — alta y listado.
4. **Panel admin → Ventas** — carga de reservas con búsqueda de cliente por apellido y nombre por
   separado, cálculo automático de precio y soporte de promociones.
5. **Panel admin → Reservas Hechas** — historial con búsqueda por apellido/DNI/empresa, filtro
   por estado de pago, registro de pagos parciales y cancelación.
6. **Panel admin → Control de Ventas** — dashboard de métricas (recaudado, reservas activas,
   destino estrella) + tabla de bonificaciones por empresa/destino con radar de alertas visible
   globalmente en el panel.

## ▶️ Cómo instalarlo y correrlo localmente

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Completá `.env` con `SUPABASE_URL`, `SUPABASE_KEY`, `ADMIN_PASSWORD` y `GEMINI_API_KEY`.

```bash
npm start
```

El servidor levanta en `http://localhost:3000` (o el `PORT` que definas).

### 2. Frontend

Es HTML estático. Abrí `frontend/index.html` / `frontend/admin.html` con la extensión "Live
Server" de VS Code, o servilo con `npx serve frontend`. Ajustá la constante `API` al inicio de
cada `<script>` si tu backend corre en otro puerto/host.

## 🚀 Deploy

- **Backend:** Render (Node.js), conectado por deploy continuo al repositorio de GitHub —
  Root Directory `backend`, Build `npm install`, Start `npm start`, variables de entorno cargadas
  en el panel de Render. Cada `git push` a `main` redeploya automáticamente.
- **Frontend:** Netlify, también conectado por deploy continuo al mismo repositorio —
  Base directory `frontend`, sin build command. Cada `git push` a `main` redeploya
  automáticamente.

> ⚠️ El backend corre en el plan gratuito de Render, que "duerme" tras inactividad — la primera
> petición después de un rato puede tardar 30-50 segundos en responder. Es una limitación
> esperable del plan free, no un bug.

## 📂 Estructura del repo

```
.
├── backend/
│   ├── index.js
│   ├── logger.js
│   ├── request-logger.js
│   ├── package.json
│   ├── .env.example
│   └── tests/
├── frontend/
│   ├── index.html
│   └── admin.html
├── database/
│   ├── schema-notes.md
│   ├── der-gladys-traveltur.svg
│   └── diagrama-clases-gladys-traveltur.svg
└── README.md
```

## 🗂️ Diagramas

**Modelo Entidad-Relación:**

![DER Gladys Traveltur](database/der-gladys-traveltur.svg)

**Diagrama de clases / módulos del sistema:**

![Diagrama de Clases](database/diagrama-clases-gladys-traveltur.svg)

## ✅ Mejoras futuras (documentadas a propósito, no implementadas por tiempo)

- Migrar el login admin de contraseña única a la tabla `usuarios` con bcrypt.
- Columna `categoria` real en Supabase para reemplazar las heurísticas de categorización por
  nombre de destino en el frontend.
- Modal de "Registrar Pago" con UI propia en vez de `prompt()` nativo del navegador.
- CI (GitHub Actions) corriendo los tests en cada push.
