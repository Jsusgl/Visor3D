require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase Storage para modelos 3D
let supabaseClient = null;
const supabaseUrl = process.env.SUPABASE_URL || (() => {
  const dbUrl = process.env.DATABASE_URL || '';
  const match = dbUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/);
  return match ? `https://${match[1]}.supabase.co` : '';
})();

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'models3d';

if (supabaseUrl && supabaseKey) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey);
    console.log(`[Storage] Supabase Storage configurado para: ${supabaseUrl} (Bucket: ${SUPABASE_BUCKET})`);
  } catch (err) {
    console.warn('[Storage] Error al inicializar Supabase Client:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Cabeceras de endurecimiento de seguridad HTTP
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' })); // Límite reducido a 2mb para prevenir DoS
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Limitador de tasa de peticiones en memoria (Rate Limiter defensivo)
const rateLimitMap = new Map();
function rateLimiter(limit, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
    } else {
      record.count++;
    }

    rateLimitMap.set(ip, record);

    if (record.count > limit) {
      return res.status(429).json({
        success: false,
        error: 'Demasiadas solicitudes desde tu dirección IP. Por favor espera unos momentos.'
      });
    }
    next();
  };
}

// Middleware de Control de Acceso y Protección contra mutaciones no autorizadas
function accessControl(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const configuredKey = process.env.ADMIN_API_KEY;

  // Si hay ADMIN_API_KEY configurada en .env, proteger operaciones destructivas (DELETE)
  if (req.method === 'DELETE' && configuredKey && apiKey !== configuredKey) {
    return res.status(403).json({
      success: false,
      error: 'Acceso denegado: Se requiere autorización (x-api-key) para eliminar piezas.'
    });
  }

  // Validación de Origen contra ataques CSRF en peticiones de modificación
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && (!process.env.ALLOWED_ORIGINS || !process.env.ALLOWED_ORIGINS.includes(originHost))) {
        return res.status(403).json({ success: false, error: 'Origen no autorizado (Protección CORS/CSRF).' });
      }
    } catch (e) {
      // Ignorar errores de parseo de URL
    }
  }

  next();
}

app.use(accessControl);

// Carpetas de archivos estáticos y subidas
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// Configuración de Multer para recepción de modelos 3D
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
    cb(null, `${cleanName}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB
  fileFilter: (req, file, cb) => {
    const validExtensions = ['.glb', '.gltf', '.obj', '.stl', '.fbx', '.bin'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (validExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato no soportado (${ext}). Usa GLB, GLTF, OBJ o STL.`));
    }
  }
});

// --- API Endpoints ---

// Estado de la Base de Datos y Almacenamiento
app.get('/api/db-status', (req, res) => {
  try {
    const status = db.getDbStatus();
    const hasSupabase = !!supabaseClient;
    res.json({
      success: true,
      ...status,
      storage: {
        provider: hasSupabase ? `Supabase Storage (Bucket: ${SUPABASE_BUCKET})` : 'Local Disk (uploads/)',
        isSupabase: hasSupabase,
        bucket: SUPABASE_BUCKET
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Listar todos los modelos
app.get('/api/models', async (req, res) => {
  try {
    const models = await db.getModels();
    res.json({ success: true, models });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener modelo específico
app.get('/api/models/:id', async (req, res) => {
  try {
    const model = await db.getModel(req.params.id);
    if (!model) return res.status(404).json({ success: false, error: 'Modelo no encontrado' });
    const pieces = await db.getPiecesByModel(req.params.id);
    res.json({ success: true, model, pieces });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Subir un nuevo archivo de modelo 3D (con limitador de tasa de 30 subidas por 15 min)
app.post('/api/upload', rateLimiter(30, 15 * 60 * 1000), upload.single('modelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se subió ningún archivo' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
    const modelName = req.body.name || path.basename(file.originalname, path.extname(file.originalname));
    const modelId = 'model_' + Date.now();

    let fileUrl = `/uploads/${file.filename}`;
    let storageProvider = 'local';

    // 1. Prioridad: Subida a Supabase Storage Bucket
    if (supabaseClient) {
      try {
        console.log(`[Storage] Subiendo ${file.filename} a Supabase Storage (Bucket: "${SUPABASE_BUCKET}")...`);
        const fileBuffer = fs.readFileSync(file.path);
        const storagePath = `models/${file.filename}`;

        const { data: uploadData, error: uploadErr } = await supabaseClient.storage
          .from(SUPABASE_BUCKET)
          .upload(storagePath, fileBuffer, {
            contentType: file.mimetype || 'application/octet-stream',
            upsert: true
          });

        if (uploadErr) {
          throw uploadErr;
        }

        const { data: publicUrlData } = supabaseClient.storage
          .from(SUPABASE_BUCKET)
          .getPublicUrl(storagePath);

        if (publicUrlData && publicUrlData.publicUrl) {
          fileUrl = publicUrlData.publicUrl;
          storageProvider = 'supabase_storage';
          console.log('[Storage] Archivo subido con éxito a Supabase Storage CDN:', fileUrl);

          // Limpieza automática: eliminar el archivo temporal del disco local tras subida a la nube
          fs.unlink(file.path, (unlinkErr) => {
            if (unlinkErr) console.warn('[Storage] Advertencia al eliminar archivo temporal local:', unlinkErr.message);
            else console.log('[Storage] Archivo temporal local eliminado correctamente:', file.filename);
          });
        }
      } catch (supaErr) {
        console.warn('[Storage] Falló subida a Supabase Storage, manteniendo copia local:', supaErr.message);
      }
    }

    const newModel = await db.createModel({
      id: modelId,
      name: modelName,
      filename: file.filename,
      file_url: fileUrl,
      file_size_bytes: file.size,
      format: ext,
      piece_count: parseInt(req.body.pieceCount, 10) || 0,
      description: req.body.description || `Modelo 3D cargado (${ext.toUpperCase()})`
    });

    res.json({
      success: true,
      message: storageProvider === 'supabase_storage' 
        ? 'Archivo 3D subido a Supabase Storage exitosamente (CDN Global)'
        : 'Archivo 3D guardado localmente',
      storageProvider,
      model: newModel
    });
  } catch (err) {
    console.error('[Upload Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener todas las piezas registradas de un modelo
app.get('/api/models/:modelId/pieces', async (req, res) => {
  try {
    const pieces = await db.getPiecesByModel(req.params.modelId);
    res.json({ success: true, pieces });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener una pieza específica por nombre de malla (mesh_name)
app.get('/api/models/:modelId/pieces/:meshName', async (req, res) => {
  try {
    const piece = await db.getPiece(req.params.modelId, req.params.meshName);
    if (!piece) {
      return res.status(404).json({ success: false, found: false, message: 'Pieza no registrada aún en la base de datos' });
    }
    res.json({ success: true, found: true, piece });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Guardar o actualizar pieza (Upsert - protegido con limitador de tasa)
app.post('/api/models/:modelId/pieces', rateLimiter(120, 60 * 1000), async (req, res) => {
  try {
    const { modelId } = req.params;
    const pieceData = req.body;

    if (!pieceData.mesh_name) {
      return res.status(400).json({ success: false, error: 'El campo mesh_name es obligatorio' });
    }

    const savedPiece = await db.upsertPiece(modelId, pieceData);
    res.json({
      success: true,
      message: 'Pieza guardada exitosamente en la base de datos',
      piece: savedPiece
    });
  } catch (err) {
    console.error('[Piece Upsert Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar registro de pieza
app.delete('/api/models/:modelId/pieces/:meshName', async (req, res) => {
  try {
    const deleted = await db.deletePiece(req.params.modelId, req.params.meshName);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback a index.html para SPA si se requiere
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Inicio del servidor
async function startServer() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 Visor 3D 3DStudio corriendo en: http://localhost:${PORT}`);
    console.log(`📁 Carpeta de subidas: ${UPLOADS_DIR}`);
    console.log(`📊 Base de datos: ${db.getDbStatus().type}`);
    console.log(`=================================================\n`);
  });
}

startServer();
