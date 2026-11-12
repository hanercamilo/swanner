# Swanner — Administrador de APIs y Documentación Interactiva OpenAPI 3.0.3

Aplicación web Full-Stack construida con **React + Vite + TypeScript**, **Tailwind CSS**, **Zustand**, **React Hook Form + Zod**, **CodeMirror 6**, **OpenAPI 3.0.3 (`swagger-ui-react`)** y **Supabase** (Auth, PostgreSQL con RLS y Edge Functions) para documentar, compartir y consumir APIs externas reales desde el navegador sin depender de Postman.

---

## Características Principales

- **Gestor de paquetes seguro (`pnpm`)**: Configurado con `.npmrc` (`ignore-scripts=true` y `enable-pre-post-scripts=false`) para bloquear la ejecución automática de scripts arbitrarios en dependencias.
- **Editores JSON con CodeMirror 6**: Numeración de líneas, resaltado de sintaxis JSON, plegado de objetos (`foldGutter`), formateador en un clic y validación en tiempo real con detección exacta de **Línea y Columna** del error en Request Body, ejemplos de Responses, visor de `swagger.json` y consola interactiva *Try it out*.
- **Extracción Automática y Recursiva de Esquemas OpenAPI 3.0.3**: Analiza cualquier JSON de ejemplo (objetos anidados, arreglos de objetos, arreglos simples, strings, números enteros/decimales, booleanos y valores `null`) y genera el esquema OpenAPI editable visualmente.
- **Configuración de Seguridad / Authorize Personalizable por Proyecto**:
  - Permite elegir el header (`Authorization`, `JwtToken`, `Authorize` o nombre personalizado) y el prefijo (`Bearer`, `Ninguno` o personalizado).
  - En la documentación, el botón **Authorize** solicita **únicamente el valor del `Token`**. El sistema construye la cabecera exacta automáticamente.
  - El token vive **exclusivamente en memoria RAM** (`useConsumerAuthStore`) durante la sesión activa; jamás se persiste en PostgreSQL, `localStorage` ni logs.
- **Consumo Real sin Bloqueos CORS (`execute-upstream`)**:
  - Las peticiones ejecutadas desde **Execute** viajan a la Supabase Edge Function `supabase/functions/execute-upstream/index.ts`, la cual valida el proyecto y endpoint en base de datos, aplica protección anti-SSRF y realiza la llamada HTTP real hacia la API original.
- **Rutas Públicas Oficiales**:
  - Documentación interactiva de solo lectura: `https://tu-dominio.com/{slug}/swagger/index.html`
  - Especificación OpenAPI JSON real (`Content-Type: application/json`): `https://tu-dominio.com/{slug}/swagger/swagger.json`

---

## Estructura del Proyecto

```text
api-studio/
├── api/
│   └── swagger.ts                                 # Función Serverless de Vercel para /{slug}/swagger/swagger.json
├── public/
│   └── favicon.svg                                # Identidad visual provisional SVG
├── supabase/
│   ├── functions/
│   │   └── execute-upstream/
│   │       └── index.ts                           # Edge Function intermediaria (CORS + Anti-SSRF + Auth Header)
│   └── migrations/
│       └── 001_initial_schema.sql                 # Esquema PostgreSQL + Índices + Triggers + Políticas RLS
├── src/
│   ├── components/
│   │   ├── editor/
│   │   │   ├── CodeMirrorJsonEditor.tsx           # Editor CodeMirror 6 con numeración de líneas y validador
│   │   │   ├── EndpointFormPanel.tsx              # Formulario de Endpoints (General, Parameters, Body, Responses)
│   │   │   └── SchemaVisualEditor.tsx             # Editor visual recursivo de esquemas OpenAPI 3.0.3
│   │   ├── modals/
│   │   │   ├── AuthorizeModal.tsx                 # Modal Authorize (solicita únicamente el Token en RAM)
│   │   │   ├── ProjectModal.tsx                   # Crear/editar proyecto y seguridad Authorize
│   │   │   └── SwaggerJsonModal.tsx               # Visor CodeMirror de swagger.json con copia y descarga
│   │   ├── swagger/
│   │   │   └── SwaggerDocViewer.tsx               # Consola Swagger Studio + swagger-ui-react con requestInterceptor
│   │   └── ui/
│   │       └── AppLogo.tsx                        # Componente de marca con SVG provisional
│   ├── lib/
│   │   ├── json-schema-infer.ts                   # Inferencia recursiva de JSON a OpenAPI + detector de línea/columna
│   │   ├── openapi-generator.ts                   # Generador dinámico OpenAPI 3.0.3 con $ref y securitySchemes
│   │   ├── schemas.ts                             # Esquemas de validación con Zod
│   │   ├── supabase.ts                            # Cliente Supabase tipado
│   │   └── utils.ts                               # Helpers y colores por verbo HTTP
│   ├── pages/
│   │   ├── LoginPage.tsx                          # /login con Supabase Auth y recuperación de contraseña
│   │   ├── DashboardPage.tsx                      # /dashboard de proyectos
│   │   ├── ProjectEditorPage.tsx                  # /projects/:projectId (Editor de 2 paneles + Vista previa)
│   │   └── PublicSwaggerPage.tsx                  # /:slug/swagger/index.html (Documentación pública de solo lectura)
│   ├── services/
│   │   └── apiStudioService.ts                    # Operaciones CRUD con Supabase y llamada a Edge Function
│   └── store/
│       └── useAppStores.ts                        # Stores Zustand (Auth, Tema Light/Dark, Token en memoria RAM)
├── .env.example
├── .npmrc                                         # Configuración segura para pnpm
├── package.json
├── vercel.json                                    # Rewrites para /{slug}/swagger/swagger.json y SPA
└── vite.config.ts                                 # Incluye middleware local para /{slug}/swagger/swagger.json
```

---

## Instalación y Puesta en Marcha con `pnpm`

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar variables de entorno

Copia el archivo `.env.example` a `.env` en la raíz del proyecto:

```bash
cp .env.example .env
```

Edita `.env` con las credenciales públicas de tu proyecto en Supabase:

```env
VITE_SUPABASE_URL=https://tu-proyecto-id.supabase.co
VITE_SUPABASE_ANON_KEY=tu_supabase_anon_key_publica
```

### 3. Aplicar la migración SQL y políticas RLS en Supabase

Tienes dos opciones:

- **Opción A (Panel Web de Supabase)**: Abre el **SQL Editor** en tu proyecto de Supabase, pega el contenido completo de `supabase/migrations/001_initial_schema.sql` y pulsa **Run**.
- **Opción B (Supabase CLI)**:
  ```bash
  pnpm run supabase:db:push
  ```

### 4. Provisionar tu usuario administrador en Supabase Auth

Como el registro público está deshabilitado por diseño:
1. Ve a **Authentication -> Users** en tu panel de Supabase.
2. Haz clic en **Add user -> Create new user** y registra tu correo y contraseña.

### 5. Desplegar la Supabase Edge Function (`execute-upstream`)

Para que el botón **Execute** consuma APIs externas reales a través de Supabase evitando errores de CORS:

```bash
supabase login
supabase link --project-ref tu-proyecto-id
pnpm run supabase:functions:deploy
```

> **Nota sobre restricciones de red y CORS**: Al utilizar la Edge Function `execute-upstream`, el navegador ya no requiere permisos CORS del servidor externo porque se comunica con Supabase. Sin embargo, esto no elimina restricciones de red corporativa, VPN, listas blancas de IP (IP allowlist) ni firewalls del servidor destino: la API original debe ser alcanzable desde la infraestructura de ejecución de Supabase.

### 6. Ejecutar en desarrollo local

```bash
pnpm run dev
```

La aplicación estará disponible en `http://localhost:5173`. Durante el desarrollo local, el plugin integrado en `vite.config.ts` también resuelve `http://localhost:5173/{slug}/swagger/swagger.json` entregando `Content-Type: application/json`.

---

## Despliegue en Vercel

1. Sube el repositorio a GitHub e impórtalo en **Vercel**.
2. Vercel detectará automáticamente `vercel.json` (que utiliza `pnpm install --ignore-scripts` y `pnpm run build`).
3. Configura en el panel de Vercel (**Settings -> Environment Variables**):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Una vez desplegado:
   - `https://tu-dominio.com/{slug}/swagger/index.html` abrirá la documentación pública interactiva.
   - `https://tu-dominio.com/{slug}/swagger/swagger.json` ejecutará `/api/swagger.ts` devolviendo el documento OpenAPI 3.0.3 real con `Content-Type: application/json`.
