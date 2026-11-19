-- ====================================================================
-- Esquema de Base de Datos para VoxelStudio (Visor 3D y Gestor de Piezas)
-- Compatible con PostgreSQL 12+ (Supabase, Neon, Docker, Local)
-- ====================================================================

-- 1. Tabla de Modelos 3D
CREATE TABLE IF NOT EXISTS models (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,
    format VARCHAR(20) DEFAULT 'glb',
    piece_count INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Piezas / Componentes del Modelo
CREATE TABLE IF NOT EXISTS pieces (
    id VARCHAR(64) PRIMARY KEY,
    model_id VARCHAR(64) NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    mesh_name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(150),
    material VARCHAR(150),
    status VARCHAR(50) DEFAULT 'Inspeccionado', -- 'Calibrado', 'Ensamblado', 'Inspeccionado', 'Pendiente'
    polygons INT DEFAULT 0,
    width_x NUMERIC(10, 3) DEFAULT 0.0,
    height_y NUMERIC(10, 3) DEFAULT 0.0,
    depth_z NUMERIC(10, 3) DEFAULT 0.0,
    unit VARCHAR(20) DEFAULT 'mm',
    color_hex VARCHAR(20) DEFAULT '#0F2537',
    notes TEXT,
    custom_attributes JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_model_mesh UNIQUE (model_id, mesh_name)
);

-- 3. Índices para consultas de alta velocidad
CREATE INDEX IF NOT EXISTS idx_pieces_model_id ON pieces(model_id);
CREATE INDEX IF NOT EXISTS idx_pieces_mesh_name ON pieces(mesh_name);
CREATE INDEX IF NOT EXISTS idx_pieces_code ON pieces(code);

-- 4. Inserción de Modelo por Defecto (Motor Aeroespacial)
INSERT INTO models (id, name, filename, file_url, file_size_bytes, format, piece_count, description)
VALUES (
    'model_default_motor',
    'Motor Propulsor AeroV1',
    'Motor_Propulsor_AeroV1.glb',
    '/models/default_engine.glb',
    1845000,
    'glb',
    6,
    'Turborreactor de demostración con 6 componentes desacoplables'
)
ON CONFLICT (id) DO NOTHING;

-- 5. Piezas iniciales del modelo por defecto
INSERT INTO pieces (id, model_id, mesh_name, code, name, category, material, status, polygons, width_x, height_y, depth_z, unit, color_hex, notes)
VALUES
('p1', 'model_default_motor', 'part_01', 'PART-01_TURBINE', 'Turbina Frontal Rotatoria', 'Propulsor • Etapa Primaria', 'Titanio Anodizado', 'Calibrado', 18400, 140.0, 140.0, 60.0, 'mm', '#0F2537', 'Álabes de alta compresión inspeccionados.'),
('p2', 'model_default_motor', 'part_02', 'PART-02_CORE_CHAMBER', 'Cámara de Combustión Central', 'Núcleo Térmico', 'Aleación Níquel-Cromo', 'Ensamblado', 24600, 110.0, 110.0, 120.0, 'mm', '#1E3E62', 'Recubrimiento cerámico para 1800°C.'),
('p3', 'model_default_motor', 'part_03', 'PART-03_NOZZLE', 'Tobera de Escape Convergente', 'Sistema de Empuje', 'Grafito Reforzado', 'Inspeccionado', 14800, 160.0, 160.0, 90.0, 'mm', '#2A475E', 'Vectores de empuje alineados.'),
('p4', 'model_default_motor', 'part_04', 'PART-04_INJECTOR_UPPER', 'Módulo de Inyección Superior', 'Alimentación Fluídica', 'Acero Aeroespacial 316L', 'Conectado', 8900, 40.0, 80.0, 40.0, 'mm', '#334155', 'Válvula solenoide de inyección rápida.'),
('p5', 'model_default_motor', 'part_05', 'PART-05_INJECTOR_LOWER', 'Válvula de Retorno Inferior', 'Alimentación Fluídica', 'Acero Aeroespacial 316L', 'Conectado', 8200, 40.0, 75.0, 40.0, 'mm', '#334155', 'Línea de retorno criogénico.'),
('p6', 'model_default_motor', 'part_06', 'PART-06_SENSOR_RING', 'Anillo de Sensores Telemétricos', 'Electrónica e Instrumentación', 'Polímero Cerámico', 'Activo', 9300, 125.0, 125.0, 25.0, 'mm', '#0369A1', 'Red de 16 termocuplas y acelerómetros.')
ON CONFLICT (model_id, mesh_name) DO NOTHING;
