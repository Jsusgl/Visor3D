# Guía de Conexión de Base de Datos — VoxelStudio

Esta guía te explica paso a paso cómo conectar tu base de datos al visualizador 3D.

> [!NOTE]
> El sistema incluye un **modo de respaldo local automático** (`data/database.json`). Si aún no has creado tu base de datos o está apagada, la aplicación funcionará de inmediato guardando piezas y modelos localmente sin dar errores.

---

## 1. Crear la Base de Datos en PostgreSQL

Puedes usar cualquier servicio de PostgreSQL (Local en tu PC, Docker, Supabase, Neon, Railway, Render, etc.):

```sql
CREATE DATABASE visor3d;
```

---

## 2. Ejecutar el Esquema de Tablas (`schema.sql`)

El archivo con la estructura completa de tablas, índices y datos iniciales está en:
`server/schema.sql`

Puedes ejecutarlo de cualquiera de las siguientes formas:

### Opción A: Desde consola / terminal con `psql`
```bash
psql -U tu_usuario -d visor3d -f server/schema.sql
```

### Opción B: Desde pgAdmin / DBeaver / TablePlus / Supabase
1. Abre tu gestor de base de datos favorito y conéctate a la base `visor3d`.
2. Abre el archivo `server/schema.sql`.
3. Ejecuta todo el script.

### Tablas creadas:
- **`models`**: Almacena los modelos 3D cargados (nombre, ruta del archivo `.glb`/`.obj`, tamaño, etc.).
- **`pieces`**: Almacena cada pieza identificada en el modelo 3D (nombre de la malla `mesh_name`, código SKU, material, dimensiones $X, Y, Z$, polígonos, estado de inspección, notas técnicas y atributos personalizados).

---

## 3. Configurar la Conexión en `.env`

Abre el archivo `.env` en la raíz del proyecto (`c:\Users\Usuario\Documents\visor3d\.env`) y asigna tu variable `DATABASE_URL`:

### Ejemplos de formato:

- **PostgreSQL local en Windows / Mac / Linux:**
  ```env
  DATABASE_URL=postgresql://postgres:tu_contraseña@localhost:5432/visor3d
  ```

- **Supabase / Neon / Cloud (con SSL):**
  ```env
  DATABASE_URL=postgresql://usuario:password@ep-xyz.us-east-2.aws.neon.tech/visor3d?sslmode=require
  ```

---

## 4. Iniciar la Aplicación

Inicia el servidor Node.js:

```bash
npm start
```
O en modo desarrollo con recarga automática:
```bash
npm run dev
```

Abre en tu navegador:
`http://localhost:3000`

### Verificación de Estado:
- En la barra superior de la aplicación verás un indicador:
  - 🟢 **Base de Datos: PostgreSQL Conectada** (cuando la conexión a PostgreSQL sea exitosa).
  - 🟡 **Modo Local (JSON Fallback)** (cuando `.env` no tiene `DATABASE_URL` o no se pudo conectar).
- También puedes consultar directamente el endpoint: `http://localhost:3000/api/db-status`.

---

## 5. Configurar Supabase Storage para los Modelos 3D

Para almacenar los archivos 3D (`.glb`, `.gltf`, `.obj`, `.stl`) en tu propio proyecto de Supabase con CDN global:

1. Ve a tu panel de **Supabase** y entra a tu proyecto.
2. En el menú lateral izquierdo, haz clic en **Storage**.
3. Haz clic en **New bucket** (Nuevo bucket):
   - **Name**: `models3d`
   - **Public bucket**: Marca la casilla **Public bucket** en verde (esto permite que el visor Three.js descargue el archivo 3D directamente desde la web).
   - Haz clic en **Save**.
4. Ahora ve a **Project Settings** (el icono de engranaje abajo a la izquierda) -> **API**.
5. Copia tu clave **`anon` (public)** o **`service_role` (secret)**.
6. Pégala en tu archivo `.env`:
   ```env
   SUPABASE_KEY=tu_clave_anon_o_service_role
   ```
7. ¡Listo! A partir de ese momento, cada modelo 3D que subas se guardará directamente en tu bucket de Supabase y su URL pública se registrará en tu base de datos.
