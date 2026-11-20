# 3DStudio — Visor 3D y Gestor de Piezas WebGL

Aplicación web interactiva de ingeniería y visualización 3D que permite cargar modelos tridimensionales compatibles con WebGL, inspeccionar componentes individuales mediante selección por clic (Raycasting), calcular automáticamente sus dimensiones espaciales ($X, Y, Z$) y persistir sus especificaciones técnicas en una base de datos.

Link: https://visor3d-production-c4cdd9a3.up.railway.app/

---

## 🚀 Características Principales

- **Compatibilidad WebGL:** Carga nativa de modelos en formato **GLTF**, **GLB**, **OBJ** y **STL** (con compresión y jerarquías CAD).
- **Inspección por Clic (Raycasting 3D):** Haz clic sobre cualquier pieza del modelo para seleccionarla, resaltarla con resplandor (*glow*) y cargar su ficha técnica.
- **Medición Geométrica Automática:** Cálculo en tiempo real del tamaño de la caja delimitadora (*Bounding Box* $X, Y, Z$) en milímetros (`mm`), centímetros (`cm`), metros (`m`) o pulgadas (`in`).
- **Persistencia en Base de Datos:** Guarda y actualiza metadatos de las piezas (código SKU, material, dimensiones, estado de calibración, notas técnicas).
- **Doble Modo de Base de Datos:**
  - 🟢 **PostgreSQL:** Conexión directa mediante `DATABASE_URL` en `.env` con soporte para esquemas relacionales.
  - 🟡 **Respaldo Local Automático:** Si no hay base de datos conectada, funciona de inmediato sin errores guardando en `data/database.json`.
- **Despiece 3D (*Exploded View*):** Desplaza automáticamente las piezas hacia afuera en sus vectores normales con un deslizador de 0% a 100%.
- **Herramientas de Visor:** Modo malla alámbrica (*wireframe*), rotación automática continua, presets de cámara rápida (Isométrica, Frontal, Superior) y aislamiento de piezas.
- **Subida de Archivos:** Arrastra y suelta modelos 3D de hasta 250 MB.

---

## 🛠️ Stack Tecnológico

- **Frontend:** HTML5, Tailwind CSS, Google Fonts, Material Symbols.
- **Motor 3D:** Three.js (v0.160.0) con `OrbitControls`, `GLTFLoader`, `OBJLoader`, `STLLoader` vía módulos ES e Import Maps.
- **Backend:** Node.js con Express 5, Multer (subida de archivos binarios 3D) y CORS.
- **Base de Datos:** PostgreSQL con `pg` (driver nativo de alto rendimiento) + JSON Store de respaldo.

---

## 📦 Estructura del Proyecto

```
c:\Users\Usuario\Documents\visor3d\
├── data/                       # Almacén de respaldo local (database.json)
├── public/                     # Frontend cliente
│   ├── index.html              # Interfaz de usuario basada en VoxelStudio
│   └── js/
│       └── app.js              # Lógica Three.js, Raycasting y cliente API
├── server/                     # Backend y Capa de Datos
│   ├── db.js                   # Módulo de conexión (PostgreSQL / Local)
│   ├── schema.sql              # Esquema SQL listo para PostgreSQL
│   └── server.js               # Servidor Express y endpoints REST
├── uploads/                    # Almacenamiento de modelos 3D cargados (.glb, .obj, .stl)
├── .env                        # Variables de entorno activas
├── .env.example                # Plantilla de configuración de entorno
├── DATABASE_SETUP.md           # Guía detallada para conectar tu base de datos
├── package.json                # Dependencias y scripts de arranque
└── README.md                   # Documentación general del sistema
```

---

## ⚡ Inicio Rápido

### 1. Iniciar el Servidor

Desde la terminal en `c:\Users\Usuario\Documents\visor3d`:

```bash
npm start
```
O en modo desarrollo:
```bash
npm run dev
```

### 2. Abrir en el Navegador

Visita:
```
http://localhost:3000
```

---

## 🗄️ Conexión de la Base de Datos

Para conectar tu base de datos PostgreSQL, consulta la guía paso a paso en [DATABASE_SETUP.md](file:///c:/Users/Usuario/Documents/visor3d/DATABASE_SETUP.md).

Basta con:
1. Crear la base `CREATE DATABASE visor3d;`.
2. Ejecutar el script [schema.sql](file:///c:/Users/Usuario/Documents/visor3d/server/schema.sql).
3. Añadir tu URL en `.env`:
   ```env
   DATABASE_URL=postgresql://usuario:password@localhost:5432/visor3d
   ```
Al recargar la aplicación, el indicador de estado en la barra superior pasará automáticamente a **🟢 BD: PostgreSQL Conectada**.
