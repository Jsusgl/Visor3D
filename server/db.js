const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JSON_DB_FILE = path.join(DATA_DIR, 'database.json');

// Estado de la conexión
let isPostgres = false;
let pgPool = null;
let dbStatusMessage = 'Iniciando conexión...';

// Estructura por defecto para almacenamiento local (fallback)
const defaultLocalData = {
  models: [
    {
      id: 'model_default_motor',
      name: 'Motor Propulsor AeroV1',
      filename: 'Motor_Propulsor_AeroV1.glb',
      file_url: '/models/default_engine.glb',
      file_size_bytes: 1845000,
      format: 'glb',
      piece_count: 6,
      description: 'Turborreactor de demostración con 6 componentes desacoplables',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  pieces: [
    {
      id: 'p1',
      model_id: 'model_default_motor',
      mesh_name: 'part_01',
      code: 'PART-01_TURBINE',
      name: 'Turbina Frontal Rotatoria',
      category: 'Propulsor • Etapa Primaria',
      material: 'Titanio Anodizado',
      status: 'Calibrado',
      polygons: 18400,
      width_x: 140.0,
      height_y: 140.0,
      depth_z: 60.0,
      unit: 'mm',
      color_hex: '#0F2537',
      notes: 'Álabes de alta compresión inspeccionados y balanceados dinámicamente.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'p2',
      model_id: 'model_default_motor',
      mesh_name: 'part_02',
      code: 'PART-02_CORE_CHAMBER',
      name: 'Cámara de Combustión Central',
      category: 'Núcleo Térmico',
      material: 'Aleación Níquel-Cromo',
      status: 'Ensamblado',
      polygons: 24600,
      width_x: 110.0,
      height_y: 110.0,
      depth_z: 120.0,
      unit: 'mm',
      color_hex: '#1E3E62',
      notes: 'Recubrimiento cerámico para 1800°C.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'p3',
      model_id: 'model_default_motor',
      mesh_name: 'part_03',
      code: 'PART-03_NOZZLE',
      name: 'Tobera de Escape Convergente',
      category: 'Sistema de Empuje',
      material: 'Grafito Reforzado',
      status: 'Inspeccionado',
      polygons: 14800,
      width_x: 160.0,
      height_y: 160.0,
      depth_z: 90.0,
      unit: 'mm',
      color_hex: '#2A475E',
      notes: 'Vectores de empuje alineados.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'p4',
      model_id: 'model_default_motor',
      mesh_name: 'part_04',
      code: 'PART-04_INJECTOR_UPPER',
      name: 'Módulo de Inyección Superior',
      category: 'Alimentación Fluídica',
      material: 'Acero Aeroespacial 316L',
      status: 'Conectado',
      polygons: 8900,
      width_x: 40.0,
      height_y: 80.0,
      depth_z: 40.0,
      unit: 'mm',
      color_hex: '#334155',
      notes: 'Válvula solenoide de inyección rápida.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'p5',
      model_id: 'model_default_motor',
      mesh_name: 'part_05',
      code: 'PART-05_INJECTOR_LOWER',
      name: 'Válvula de Retorno Inferior',
      category: 'Alimentación Fluídica',
      material: 'Acero Aeroespacial 316L',
      status: 'Conectado',
      polygons: 8200,
      width_x: 40.0,
      height_y: 75.0,
      depth_z: 40.0,
      unit: 'mm',
      color_hex: '#334155',
      notes: 'Línea de retorno criogénico.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'p6',
      model_id: 'model_default_motor',
      mesh_name: 'part_06',
      code: 'PART-06_SENSOR_RING',
      name: 'Anillo de Sensores Telemétricos',
      category: 'Electrónica e Instrumentación',
      material: 'Polímero Cerámico',
      status: 'Activo',
      polygons: 9300,
      width_x: 125.0,
      height_y: 125.0,
      depth_z: 25.0,
      unit: 'mm',
      color_hex: '#0369A1',
      notes: 'Red de 16 termocuplas y acelerómetros piezoeléctricos.',
      custom_attributes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

// --- Manejo de Base Local (JSON Fallback) ---
function ensureLocalDbFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JSON_DB_FILE)) {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(defaultLocalData, null, 2), 'utf8');
  }
}

function readLocalDb() {
  ensureLocalDbFile();
  try {
    const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[DB-Local] Error leyendo base local:', err);
    return defaultLocalData;
  }
}

function writeLocalDb(data) {
  ensureLocalDbFile();
  fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// --- Inicialización y Conexión ---
async function initDb() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString && connectionString.trim() !== '') {
    try {
      console.log('[DB] Intentando conectar a PostgreSQL con DATABASE_URL...');
      pgPool = new Pool({
        connectionString,
        ssl: connectionString.includes('sslmode=require') || connectionString.includes('supabase.co')
          ? { rejectUnauthorized: false }
          : false
      });

      // Prueba de conexión
      const client = await pgPool.connect();
      console.log('[DB] Conectado exitosamente a PostgreSQL.');
      client.release();

      // Ejecutar esquema para asegurar tablas
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await pgPool.query(schemaSql);
        console.log('[DB] Esquema y tablas de PostgreSQL verificados.');
      }

      isPostgres = true;
      dbStatusMessage = 'Conectado a PostgreSQL en producción/desarrollo.';
      return;
    } catch (error) {
      console.warn('[DB] No fue posible conectar a PostgreSQL:', error.message);
      console.warn('[DB] Activando modo almacenamiento local (JSON) para mantener el sistema operativo.');
      isPostgres = false;
      dbStatusMessage = `Error de conexión a PostgreSQL (${error.message}). Modo local activo.`;
    }
  } else {
    console.log('[DB] DATABASE_URL no configurada. Activando modo almacenamiento local.');
    isPostgres = false;
    dbStatusMessage = 'Modo de almacenamiento local activo. Configura DATABASE_URL en .env para conectar tu base de datos.';
  }

  ensureLocalDbFile();
}

function getDbStatus() {
  const dbUrl = process.env.DATABASE_URL || '';
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  return {
    isPostgres,
    type: isPostgres ? 'PostgreSQL' : 'Local Fallback (JSON/SQLite)',
    message: dbStatusMessage,
    configuredUrl: maskedUrl || '(Ninguna configurada en .env)'
  };
}

// --- Métodos de Modelos ---
async function getModels() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT * FROM models ORDER BY created_at DESC');
    return res.rows;
  }
  const db = readLocalDb();
  return db.models || [];
}

async function getModel(id) {
  if (isPostgres) {
    const res = await pgPool.query('SELECT * FROM models WHERE id = $1', [id]);
    return res.rows[0] || null;
  }
  const db = readLocalDb();
  return db.models.find(m => m.id === id) || null;
}

async function createModel(model) {
  const newModel = {
    id: model.id || 'model_' + Date.now(),
    name: model.name || 'Modelo 3D',
    filename: model.filename || 'model.glb',
    file_url: model.file_url,
    file_size_bytes: model.file_size_bytes || 0,
    format: model.format || 'glb',
    piece_count: model.piece_count || 0,
    description: model.description || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (isPostgres) {
    const query = `
      INSERT INTO models (id, name, filename, file_url, file_size_bytes, format, piece_count, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const values = [
      newModel.id,
      newModel.name,
      newModel.filename,
      newModel.file_url,
      newModel.file_size_bytes,
      newModel.format,
      newModel.piece_count,
      newModel.description,
      newModel.created_at,
      newModel.updated_at
    ];
    const res = await pgPool.query(query, values);
    return res.rows[0];
  }

  const db = readLocalDb();
  db.models = db.models || [];
  db.models.unshift(newModel);
  writeLocalDb(db);
  return newModel;
}

// --- Métodos de Piezas ---
async function getPiecesByModel(modelId) {
  if (isPostgres) {
    const res = await pgPool.query('SELECT * FROM pieces WHERE model_id = $1 ORDER BY code ASC, name ASC', [modelId]);
    return res.rows;
  }
  const db = readLocalDb();
  return (db.pieces || []).filter(p => p.model_id === modelId);
}

async function getPiece(modelId, meshName) {
  if (isPostgres) {
    const res = await pgPool.query('SELECT * FROM pieces WHERE model_id = $1 AND mesh_name = $2', [modelId, meshName]);
    return res.rows[0] || null;
  }
  const db = readLocalDb();
  return (db.pieces || []).find(p => p.model_id === modelId && p.mesh_name === meshName) || null;
}

async function upsertPiece(modelId, pieceData) {
  const meshName = pieceData.mesh_name;
  if (!meshName) throw new Error('mesh_name es requerido');

  const now = new Date().toISOString();
  const id = pieceData.id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const code = pieceData.code || `PIEZA_${meshName.toUpperCase()}`;
  const name = pieceData.name || meshName;
  const category = pieceData.category || 'General';
  const material = pieceData.material || 'Estándar';
  const status = pieceData.status || 'Inspeccionado';
  const polygons = parseInt(pieceData.polygons, 10) || 0;
  const widthX = parseFloat(pieceData.width_x) || 0.0;
  const heightY = parseFloat(pieceData.height_y) || 0.0;
  const depthZ = parseFloat(pieceData.depth_z) || 0.0;
  const unit = pieceData.unit || 'mm';
  const colorHex = pieceData.color_hex || '#0F2537';
  const notes = pieceData.notes || '';
  const customAttributes = pieceData.custom_attributes || {};

  if (isPostgres) {
    const query = `
      INSERT INTO pieces (
        id, model_id, mesh_name, code, name, category, material, status,
        polygons, width_x, height_y, depth_z, unit, color_hex, notes,
        custom_attributes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (model_id, mesh_name) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        material = EXCLUDED.material,
        status = EXCLUDED.status,
        polygons = EXCLUDED.polygons,
        width_x = EXCLUDED.width_x,
        height_y = EXCLUDED.height_y,
        depth_z = EXCLUDED.depth_z,
        unit = EXCLUDED.unit,
        color_hex = EXCLUDED.color_hex,
        notes = EXCLUDED.notes,
        custom_attributes = EXCLUDED.custom_attributes,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;
    const values = [
      id, modelId, meshName, code, name, category, material, status,
      polygons, widthX, heightY, depthZ, unit, colorHex, notes,
      JSON.stringify(customAttributes), now, now
    ];
    const res = await pgPool.query(query, values);
    return res.rows[0];
  }

  const db = readLocalDb();
  db.pieces = db.pieces || [];
  const existingIdx = db.pieces.findIndex(p => p.model_id === modelId && p.mesh_name === meshName);

  const pieceRecord = {
    id: existingIdx >= 0 ? db.pieces[existingIdx].id : id,
    model_id: modelId,
    mesh_name: meshName,
    code,
    name,
    category,
    material,
    status,
    polygons,
    width_x: widthX,
    height_y: heightY,
    depth_z: depthZ,
    unit,
    color_hex: colorHex,
    notes,
    custom_attributes: customAttributes,
    created_at: existingIdx >= 0 ? db.pieces[existingIdx].created_at : now,
    updated_at: now
  };

  if (existingIdx >= 0) {
    db.pieces[existingIdx] = pieceRecord;
  } else {
    db.pieces.push(pieceRecord);
  }

  writeLocalDb(db);
  return pieceRecord;
}

async function deletePiece(modelId, meshName) {
  if (isPostgres) {
    const res = await pgPool.query('DELETE FROM pieces WHERE model_id = $1 AND mesh_name = $2 RETURNING *', [modelId, meshName]);
    return res.rowCount > 0;
  }
  const db = readLocalDb();
  const initialLength = (db.pieces || []).length;
  db.pieces = (db.pieces || []).filter(p => !(p.model_id === modelId && p.mesh_name === meshName));
  writeLocalDb(db);
  return db.pieces.length < initialLength;
}

module.exports = {
  initDb,
  getDbStatus,
  getModels,
  getModel,
  createModel,
  getPiecesByModel,
  getPiece,
  upsertPiece,
  deletePiece
};
