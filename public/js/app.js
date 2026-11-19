import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// ====================================================================
// Estado Global de la Aplicación
// ====================================================================
const state = {
  currentModelId: null,
  currentModelData: null,
  dbStatus: { isPostgres: false, type: 'Local Fallback' },
  partMeshes: [],          // Mallas THREE.Mesh presentes en la escena
  piecesMap: new Map(),     // mesh_name -> metadatos técnicos (combinados 3D + BD)
  activeMeshName: null,     // Pieza seleccionada
  isolatedMeshName: null,   // Pieza en modo aislamiento (las demás ocultas)
  autoRotate: true,
  wireframeActive: false,
  isExploded: false,
  explodeFactor: 0,
  currentLighting: 'studio',
  modelCenter: new THREE.Vector3(),
  modelSize: new THREE.Vector3()
};

// ====================================================================
// Inicialización del Motor WebGL Three.js
// ====================================================================
const container = document.getElementById('threeContainer');
let width = container.clientWidth || window.innerWidth;
let height = container.clientHeight || window.innerHeight;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF8FAFC);

const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
camera.position.set(4.5, 3.2, 5.8);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setSize(width, height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Controles de Cámara Suaves (OrbitControls)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 60;
controls.minDistance = 0.5;

// Iluminación
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
keyLight.position.set(6, 12, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 1024;
keyLight.shadow.mapSize.height = 1024;
keyLight.shadow.bias = -0.0001;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xBAE6FD, 0.5);
fillLight.position.set(-6, -2, -6);
scene.add(fillLight);

// Cuadrícula sutil de suelo de referencia
const gridHelper = new THREE.GridHelper(12, 24, 0x94A3B8, 0xE2E8F0);
gridHelper.position.y = -2.2;
scene.add(gridHelper);

// Grupo principal donde se aloja el modelo 3D activo
const assemblyGroup = new THREE.Group();
scene.add(assemblyGroup);

// Raycasting para selección por clic
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ====================================================================
// Gestión de Base de Datos y API REST
// ====================================================================
async function checkDbStatus() {
  try {
    const res = await fetch('/api/db-status');
    const data = await res.json();
    if (data.success) {
      state.dbStatus = data;
      updateDbStatusUI(data);
    }
  } catch (err) {
    console.warn('[API] Error verificando estado de BD:', err);
    updateDbStatusUI({ isPostgres: false, type: 'Desconectado / Local', message: err.message });
  }
}

function updateDbStatusUI(info) {
  const badge = document.getElementById('dbStatusBadge');
  const indicator = document.getElementById('dbStatusIndicator');
  const text = document.getElementById('dbStatusText');
  const modalDetail = document.getElementById('modalDbStatusDetail');

  if (badge && indicator && text) {
    if (info.isPostgres) {
      badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-label transition-all cursor-pointer bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100';
      indicator.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
      text.textContent = 'BD: PostgreSQL Conectada';
    } else {
      badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-label transition-all cursor-pointer bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100';
      indicator.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
      text.textContent = 'BD: Modo Local (Sin DB)';
    }
  }

  if (modalDetail) {
    modalDetail.textContent = `Tipo: ${info.type} | Info: ${info.message || 'Operativo'}`;
  }
}

async function fetchSavedPiecesFromDb(modelId) {
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/pieces`);
    const data = await res.json();
    if (data.success && Array.isArray(data.pieces)) {
      return data.pieces;
    }
  } catch (err) {
    console.warn('[API] Error cargando piezas de la BD:', err);
  }
  return [];
}

async function savePieceToDb(modelId, piecePayload) {
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/pieces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(piecePayload)
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[API] Error guardando pieza en BD:', err);
    return { success: false, error: err.message };
  }
}

// ====================================================================
// Cálculo de Dimensiones Geométricas (Bounding Box 3D)
// ====================================================================
function calculateMeshDimensions(mesh, unit = 'mm') {
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Escalar según unidad deseada (asumiendo que 1 unidad de Three.js = 100mm en este contexto)
  let scaleFactor = 100;
  if (unit === 'cm') scaleFactor = 10;
  if (unit === 'm') scaleFactor = 0.1;
  if (unit === 'in') scaleFactor = 100 / 25.4;

  return {
    widthX: parseFloat((size.x * scaleFactor).toFixed(1)),
    heightY: parseFloat((size.y * scaleFactor).toFixed(1)),
    depthZ: parseFloat((size.z * scaleFactor).toFixed(1)),
    rawBox: box
  };
}

function calculateMeshTriangles(mesh) {
  if (!mesh.geometry) return 0;
  if (mesh.geometry.index) {
    return Math.round(mesh.geometry.index.count / 3);
  }
  if (mesh.geometry.attributes.position) {
    return Math.round(mesh.geometry.attributes.position.count / 3);
  }
  return 0;
}

// ====================================================================
// Construcción del Modelo Demo (Motor Propulsor AeroV1)
// ====================================================================
function buildDefaultEngineModel() {
  clearCurrentAssembly();

  state.currentModelId = 'model_default_motor';
  state.currentModelData = {
    id: 'model_default_motor',
    name: 'Motor Propulsor AeroV1',
    piece_count: 6,
    format: 'glb'
  };

  const defaultPartsMeta = [
    {
      mesh_name: 'part_01',
      code: 'PART-01_TURBINE',
      name: 'Turbina Frontal Rotatoria',
      category: 'Propulsor • Etapa Primaria',
      material: 'Titanio Anodizado',
      color: 0x0F2537,
      explodeOffset: new THREE.Vector3(0, 0, 2.8),
      meshType: 'cylinder',
      args: [1.2, 0.9, 0.5, 32],
      pos: [0, 0, 0.9]
    },
    {
      mesh_name: 'part_02',
      code: 'PART-02_CORE_CHAMBER',
      name: 'Cámara de Combustión Central',
      category: 'Núcleo Térmico',
      material: 'Aleación Níquel-Cromo',
      color: 0x1E3E62,
      explodeOffset: new THREE.Vector3(0, 0, 0),
      meshType: 'cylinder',
      args: [0.9, 1.1, 1.4, 32],
      pos: [0, 0, 0]
    },
    {
      mesh_name: 'part_03',
      code: 'PART-03_NOZZLE',
      name: 'Tobera de Escape Convergente',
      category: 'Sistema de Empuje',
      material: 'Grafito Reforzado',
      color: 0x2A475E,
      explodeOffset: new THREE.Vector3(0, 0, -2.6),
      meshType: 'cylinder',
      args: [1.3, 0.7, 0.9, 32],
      pos: [0, 0, -1.1]
    },
    {
      mesh_name: 'part_04',
      code: 'PART-04_INJECTOR_UPPER',
      name: 'Módulo de Inyección Superior',
      category: 'Alimentación Fluídica',
      material: 'Acero Aeroespacial 316L',
      color: 0x334155,
      explodeOffset: new THREE.Vector3(0, 2.2, 0.2),
      meshType: 'box',
      args: [0.45, 0.9, 0.45],
      pos: [0, 1.05, 0.1]
    },
    {
      mesh_name: 'part_05',
      code: 'PART-05_INJECTOR_LOWER',
      name: 'Válvula de Retorno Inferior',
      category: 'Alimentación Fluídica',
      material: 'Acero Aeroespacial 316L',
      color: 0x334155,
      explodeOffset: new THREE.Vector3(0, -2.2, 0.2),
      meshType: 'box',
      args: [0.45, 0.8, 0.45],
      pos: [0, -1.05, 0.1]
    },
    {
      mesh_name: 'part_06',
      code: 'PART-06_SENSOR_RING',
      name: 'Anillo de Sensores Telemétricos',
      category: 'Electrónica e Instrumentación',
      material: 'Polímero Cerámico',
      color: 0x0369A1,
      explodeOffset: new THREE.Vector3(1.8, 0, 0.5),
      meshType: 'torus',
      args: [1.15, 0.1, 16, 48],
      pos: [0, 0, 0.3]
    }
  ];

  defaultPartsMeta.forEach(p => {
    let geom;
    if (p.meshType === 'cylinder') {
      geom = new THREE.CylinderGeometry(p.args[0], p.args[1], p.args[2], p.args[3]);
      geom.rotateX(Math.PI / 2);
    } else if (p.meshType === 'box') {
      geom = new THREE.BoxGeometry(p.args[0], p.args[1], p.args[2]);
    } else if (p.meshType === 'torus') {
      geom = new THREE.TorusGeometry(p.args[0], p.args[1], p.args[2], p.args[3]);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: p.color,
      roughness: 0.35,
      metalness: 0.55
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = p.mesh_name;
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.userData = {
      meshName: p.mesh_name,
      basePosition: mesh.position.clone(),
      explodeDirection: p.explodeOffset.clone().normalize(),
      explodeDistance: p.explodeOffset.length()
    };

    assemblyGroup.add(mesh);
    state.partMeshes.push(mesh);
  });

  centerAndFitModel();
  syncModelWithDatabase();
}

// ====================================================================
// Carga de Modelos 3D WebGL (GLTF, GLB, OBJ, STL)
// ====================================================================
async function loadExternal3DModel(url, filename, modelId, modelName) {
  showLoader(true, `Cargando archivo 3D (${filename})...`);
  clearCurrentAssembly();

  state.currentModelId = modelId;
  state.currentModelData = {
    id: modelId,
    name: modelName || filename,
    format: filename.split('.').pop().toLowerCase()
  };

  const ext = state.currentModelData.format;

  try {
    let loadedObject;

    if (ext === 'glb' || ext === 'gltf') {
      const gltfLoader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject);
      });
      loadedObject = gltf.scene || gltf.scenes[0];
    } else if (ext === 'obj') {
      const objLoader = new OBJLoader();
      loadedObject = await new Promise((resolve, reject) => {
        objLoader.load(url, resolve, undefined, reject);
      });
    } else if (ext === 'stl') {
      const stlLoader = new STLLoader();
      const geometry = await new Promise((resolve, reject) => {
        stlLoader.load(url, resolve, undefined, reject);
      });
      const material = new THREE.MeshStandardMaterial({
        color: 0x1E3E62,
        roughness: 0.4,
        metalness: 0.6
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'mesh_stl_pieza_01';
      loadedObject = new THREE.Group();
      loadedObject.add(mesh);
    } else {
      throw new Error(`Formato .${ext} no compatible con el visor WebGL`);
    }

    // Travesía de la escena para identificar piezas (Meshes)
    let meshIndex = 1;
    const modelTotalBox = new THREE.Box3().setFromObject(loadedObject);
    const modelCenter = modelTotalBox.getCenter(new THREE.Vector3());

    loadedObject.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        // Asignar nombre único si no viene definido en el CAD
        if (!child.name || child.name.trim() === '') {
          child.name = `pieza_${String(meshIndex).padStart(2, '0')}`;
        }
        meshIndex++;

        // Asegurar que el material responda a resaltados
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map(m => m.clone());
          } else {
            child.material = child.material.clone();
          }
        }

        // Vector de despiece automático basado en su distancia al centro
        const childBox = new THREE.Box3().setFromObject(child);
        const childCenter = childBox.getCenter(new THREE.Vector3());
        let explodeDir = childCenter.clone().sub(modelCenter);
        if (explodeDir.lengthSq() < 0.0001) {
          explodeDir.set(0, 1, 0); // desplazamiento vertical si está en el centro exacto
        }
        const explodeDist = explodeDir.length();
        explodeDir.normalize();

        child.userData = {
          meshName: child.name,
          basePosition: child.position.clone(),
          explodeDirection: explodeDir,
          explodeDistance: Math.max(1.2, explodeDist)
        };

        state.partMeshes.push(child);
      }
    });

    assemblyGroup.add(loadedObject);
    centerAndFitModel();
    await syncModelWithDatabase();

    showToast(`Modelo "${state.currentModelData.name}" cargado con éxito. (${state.partMeshes.length} piezas)`, 'success');
  } catch (err) {
    console.error('[Loader Error]', err);
    showToast(`Error al procesar modelo 3D: ${err.message}`, 'error');
    buildDefaultEngineModel();
  } finally {
    showLoader(false);
  }
}

function clearCurrentAssembly() {
  while (assemblyGroup.children.length > 0) {
    const obj = assemblyGroup.children[0];
    assemblyGroup.remove(obj);
  }
  state.partMeshes = [];
  state.piecesMap.clear();
  state.activeMeshName = null;
  state.isolatedMeshName = null;
  state.isExploded = false;
  state.explodeFactor = 0;
  document.getElementById('explodeSlider').value = 0;
  document.getElementById('explodeSliderVal').textContent = '0%';
  document.getElementById('explodeBtnText').textContent = 'Despiece 3D';
}

function centerAndFitModel() {
  assemblyGroup.position.set(0, 0, 0);
  assemblyGroup.rotation.set(0, 0, 0);
  assemblyGroup.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(assemblyGroup);
  state.modelCenter = box.getCenter(new THREE.Vector3());
  state.modelSize = box.getSize(new THREE.Vector3());

  // Centrar en el origen
  assemblyGroup.position.x = -state.modelCenter.x;
  assemblyGroup.position.y = -state.modelCenter.y;
  assemblyGroup.position.z = -state.modelCenter.z;

  // Ajustar posición del grid de suelo
  gridHelper.position.y = - (state.modelSize.y / 2) - 0.2;

  // Ajustar cámara para encuadre óptimo
  const maxDim = Math.max(state.modelSize.x, state.modelSize.y, state.modelSize.z, 2.0);
  camera.position.set(maxDim * 1.6, maxDim * 1.1, maxDim * 2.0);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ====================================================================
// Sincronización de Piezas con la Base de Datos
// ====================================================================
async function syncModelWithDatabase() {
  const modelId = state.currentModelId;
  const dbPieces = await fetchSavedPiecesFromDb(modelId);
  const dbPiecesByMesh = new Map();
  dbPieces.forEach(p => dbPiecesByMesh.set(p.mesh_name, p));

  let totalTriangles = 0;

  state.partMeshes.forEach(mesh => {
    const meshName = mesh.userData.meshName || mesh.name;
    const tris = calculateMeshTriangles(mesh);
    totalTriangles += tris;
    const dims = calculateMeshDimensions(mesh, 'mm');

    const dbRecord = dbPiecesByMesh.get(meshName);

    const pieceMeta = {
      isSavedInDb: !!dbRecord,
      mesh_name: meshName,
      code: dbRecord ? dbRecord.code : `PART-${meshName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
      name: dbRecord ? dbRecord.name : (meshName.charAt(0).toUpperCase() + meshName.slice(1)),
      category: dbRecord ? dbRecord.category : 'Componente Mecánico',
      material: dbRecord ? dbRecord.material : 'Aleación Industrial',
      status: dbRecord ? dbRecord.status : 'Calibrado',
      polygons: dbRecord ? dbRecord.polygons : tris,
      width_x: dbRecord ? parseFloat(dbRecord.width_x) : dims.widthX,
      height_y: dbRecord ? parseFloat(dbRecord.height_y) : dims.heightY,
      depth_z: dbRecord ? parseFloat(dbRecord.depth_z) : dims.depthZ,
      unit: dbRecord ? dbRecord.unit : 'mm',
      color_hex: dbRecord ? dbRecord.color_hex : (mesh.material && mesh.material.color ? '#' + mesh.material.color.getHexString() : '#0F2537'),
      notes: dbRecord ? dbRecord.notes : '',
      meshRef: mesh
    };

    state.piecesMap.set(meshName, pieceMeta);
  });

  // Actualizar UI
  document.getElementById('currentModelName').textContent = state.currentModelData.name;
  document.getElementById('currentModelPiecesSummary').textContent = `${state.partMeshes.length} piezas ensambladas`;
  document.getElementById('partsCountBadge').textContent = `${state.partMeshes.length} piezas`;
  document.getElementById('totalTrianglesLabel').textContent = `Total: ${totalTriangles.toLocaleString()} tris`;

  renderPartsList();

  // Seleccionar la primera pieza por defecto si existe
  if (state.partMeshes.length > 0) {
    selectPiece(state.partMeshes[0].userData.meshName);
  }
}

// ====================================================================
// Funciones de Seguridad y Sanitización
// ====================================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================================================================
// Renderizado de UI y Árbol de Piezas
// ====================================================================
function resetInspector() {
  document.getElementById('inspectorPartTitle').textContent = 'Ninguna pieza seleccionada';
  document.getElementById('inspectorPartSubtitle').textContent = 'Sube un modelo 3D y haz clic en una pieza';
  document.getElementById('inspectorMeshBadge').textContent = '-';
  const dbBadge = document.getElementById('inspectorDbBadge');
  if (dbBadge) {
    dbBadge.textContent = '⚪ Sin pieza activa';
    dbBadge.className = 'inline-block px-2 py-0.5 font-label text-[10px] font-bold rounded-full uppercase tracking-wider bg-slate-100 text-slate-500';
  }
  document.getElementById('inputPartName').value = '';
  document.getElementById('inputPartCode').value = '';
  document.getElementById('inputPartCategory').value = '';
  document.getElementById('inputPartMaterial').value = '';
  document.getElementById('inputWidthX').value = '';
  document.getElementById('inputHeightY').value = '';
  document.getElementById('inputDepthZ').value = '';
  document.getElementById('partTrianglesCount').textContent = '0 triángulos';
  document.getElementById('inputPartNotes').value = '';
}

function renderPartsList() {
  const container = document.getElementById('partsListContainer');
  container.innerHTML = '';

  const entries = Array.from(state.piecesMap.values());

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="py-12 px-4 text-center flex flex-col items-center justify-center gap-2.5 text-slate-400">
        <span class="material-symbols-outlined text-slate-300" style="font-size: 32px;">view_in_ar</span>
        <p class="text-xs font-semibold text-slate-600">Ningún modelo activo</p>
        <p class="text-[11px] text-slate-400 leading-relaxed">Haz clic en <strong>"Subir Modelo"</strong> para cargar tu primer archivo 3D (.glb, .gltf, .obj, .stl).</p>
      </div>
    `;
    return;
  }

  entries.forEach(p => {
    const isSelected = (p.mesh_name === state.activeMeshName);
    const isIsolated = (p.mesh_name === state.isolatedMeshName);
    const safeName = escapeHtml(p.name);
    const safeCode = escapeHtml(p.code);
    const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(p.color_hex) ? p.color_hex : '#0F2537';

    const row = document.createElement('div');
    row.className = `flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
      isSelected 
        ? 'bg-ocean-navy text-white shadow-sm ring-1 ring-accent' 
        : 'hover:bg-slate-100 text-ocean-navy'
    }`;

    row.innerHTML = `
      <div class="flex items-center gap-2 overflow-hidden">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${safeColor}"></span>
        <div class="truncate">
          <p class="font-label text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-ocean-navy'}">${safeName}</p>
          <div class="flex items-center gap-1.5 text-[10px] font-mono">
            <span class="${isSelected ? 'text-slate-200' : 'text-slate-500'}">${safeCode}</span>
            <span class="${p.isSavedInDb ? 'text-emerald-400 font-bold' : 'text-amber-500'}">• ${p.isSavedInDb ? 'BD' : 'Nuevo'}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${isIsolated ? '<span class="px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[9px] font-mono font-bold">Aislada</span>' : ''}
        <span class="material-symbols-outlined ${isSelected ? 'text-white' : 'text-slate-400'}" style="font-size: 16px;">chevron_right</span>
      </div>
    `;

    row.addEventListener('click', () => {
      selectPiece(p.mesh_name);
    });

    container.appendChild(row);
  });
}

function selectPiece(meshName) {
  state.activeMeshName = meshName;
  const piece = state.piecesMap.get(meshName);

  if (!piece) return;

  // Actualizar resaltado en la escena 3D
  state.partMeshes.forEach(mesh => {
    const isThis = (mesh.userData.meshName === meshName);
    if (mesh.material) {
      if (isThis) {
        mesh.material.emissive = new THREE.Color(0x00A8CC);
        mesh.material.emissiveIntensity = 0.45;
      } else {
        mesh.material.emissive = new THREE.Color(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    }
  });

  // Actualizar Formulario del Inspector
  document.getElementById('inspectorPartTitle').textContent = piece.name;
  document.getElementById('inspectorPartSubtitle').textContent = `${piece.category} • Malla: ${piece.mesh_name}`;
  document.getElementById('inspectorMeshBadge').textContent = piece.mesh_name;

  const dbBadge = document.getElementById('inspectorDbBadge');
  if (piece.isSavedInDb) {
    dbBadge.textContent = '🟢 Guardado en Base de Datos';
    dbBadge.className = 'inline-block px-2 py-0.5 font-label text-[10px] font-bold rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-800';
  } else {
    dbBadge.textContent = '🟡 No registrado en BD';
    dbBadge.className = 'inline-block px-2 py-0.5 font-label text-[10px] font-bold rounded-full uppercase tracking-wider bg-amber-100 text-amber-800';
  }

  document.getElementById('inputPartName').value = piece.name;
  document.getElementById('inputPartCode').value = piece.code;
  document.getElementById('inputPartCategory').value = piece.category;
  document.getElementById('inputPartMaterial').value = piece.material;
  document.getElementById('selectPartStatus').value = piece.status;

  document.getElementById('selectDimensionUnit').value = piece.unit || 'mm';
  document.getElementById('inputWidthX').value = piece.width_x;
  document.getElementById('inputHeightY').value = piece.height_y;
  document.getElementById('inputDepthZ').value = piece.depth_z;

  document.getElementById('partTrianglesCount').textContent = `${piece.polygons.toLocaleString()} triángulos poligonales`;
  document.getElementById('inputPartNotes').value = piece.notes || '';

  const isolateBtnText = document.getElementById('isolateBtnText');
  isolateBtnText.textContent = (state.isolatedMeshName === meshName) ? 'Restaurar Vista' : 'Aislar Pieza';

  renderPartsList();
}

// ====================================================================
// Guardar Pieza en Base de Datos
// ====================================================================
document.getElementById('savePartBtn').addEventListener('click', async () => {
  if (!state.activeMeshName) {
    showToast('Selecciona primero una pieza para guardar', 'error');
    return;
  }

  const piece = state.piecesMap.get(state.activeMeshName);
  if (!piece) return;

  const saveBtn = document.getElementById('savePartBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `
    <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
    <span>Guardando...</span>
  `;

  const payload = {
    mesh_name: piece.mesh_name,
    name: document.getElementById('inputPartName').value.trim() || piece.mesh_name,
    code: document.getElementById('inputPartCode').value.trim() || piece.code,
    category: document.getElementById('inputPartCategory').value.trim() || 'General',
    material: document.getElementById('inputPartMaterial').value.trim() || 'Estándar',
    status: document.getElementById('selectPartStatus').value,
    width_x: parseFloat(document.getElementById('inputWidthX').value) || 0,
    height_y: parseFloat(document.getElementById('inputHeightY').value) || 0,
    depth_z: parseFloat(document.getElementById('inputDepthZ').value) || 0,
    unit: document.getElementById('selectDimensionUnit').value,
    polygons: piece.polygons,
    color_hex: piece.color_hex,
    notes: document.getElementById('inputPartNotes').value.trim()
  };

  const response = await savePieceToDb(state.currentModelId, payload);

  saveBtn.disabled = false;
  saveBtn.innerHTML = `
    <span class="material-symbols-outlined" style="font-size: 18px;">save</span>
    <span>Guardar Pieza en Base de Datos</span>
  `;

  if (response.success) {
    // Actualizar estado local
    Object.assign(piece, payload);
    piece.isSavedInDb = true;

    selectPiece(piece.mesh_name);
    showToast(`Pieza "${payload.name}" guardada con éxito en la base de datos!`, 'success');
  } else {
    showToast(`Error al guardar en base de datos: ${response.error || 'Desconocido'}`, 'error');
  }
});

// Recalcular dimensiones 3D de la pieza activa
document.getElementById('recalcDimsBtn').addEventListener('click', () => {
  if (!state.activeMeshName) return;
  const piece = state.piecesMap.get(state.activeMeshName);
  if (piece && piece.meshRef) {
    const unit = document.getElementById('selectDimensionUnit').value;
    const dims = calculateMeshDimensions(piece.meshRef, unit);
    document.getElementById('inputWidthX').value = dims.widthX;
    document.getElementById('inputHeightY').value = dims.heightY;
    document.getElementById('inputDepthZ').value = dims.depthZ;
    showToast(`Dimensiones recalculadas desde geometría 3D (${unit})`, 'success');
  }
});

document.getElementById('selectDimensionUnit').addEventListener('change', (e) => {
  if (!state.activeMeshName) return;
  const piece = state.piecesMap.get(state.activeMeshName);
  if (piece && piece.meshRef) {
    const dims = calculateMeshDimensions(piece.meshRef, e.target.value);
    document.getElementById('inputWidthX').value = dims.widthX;
    document.getElementById('inputHeightY').value = dims.heightY;
    document.getElementById('inputDepthZ').value = dims.depthZ;
  }
});

// ====================================================================
// Interacción con Ratón y Raycasting (Clic sobre mallas 3D)
// ====================================================================
let pointerDownPos = { x: 0, y: 0 };
let isDragging = false;

container.addEventListener('pointerdown', (e) => {
  pointerDownPos.x = e.clientX;
  pointerDownPos.y = e.clientY;
  isDragging = false;
});

container.addEventListener('pointermove', (e) => {
  if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) {
    isDragging = true;
  }
});

container.addEventListener('pointerup', (e) => {
  if (isDragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(state.partMeshes, true);

  if (intersects.length > 0) {
    // Buscar la malla raíz o de pieza
    let target = intersects[0].object;
    while (target && target.parent && target.parent !== assemblyGroup && !target.userData.meshName) {
      target = target.parent;
    }
    if (target && target.userData && target.userData.meshName) {
      selectPiece(target.userData.meshName);
    }
  }
});

// ====================================================================
// Despiece / Explosión 3D
// ====================================================================
function applyExplode(factor) {
  state.explodeFactor = factor;
  state.isExploded = factor > 0;

  state.partMeshes.forEach(mesh => {
    const uData = mesh.userData;
    if (uData && uData.basePosition && uData.explodeDirection) {
      const distance = uData.explodeDistance || 1.5;
      mesh.position.copy(uData.basePosition).addScaledVector(
        uData.explodeDirection,
        factor * distance * 1.5
      );
    }
  });

  const explodeBtnText = document.getElementById('explodeBtnText');
  explodeBtnText.textContent = state.isExploded ? 'Reensamblar' : 'Despiece 3D';
}

const explodeSlider = document.getElementById('explodeSlider');
const explodeSliderVal = document.getElementById('explodeSliderVal');
const explodeToggleBtn = document.getElementById('explodeToggleBtn');

explodeSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  explodeSliderVal.textContent = `${val}%`;
  applyExplode(val / 100);
});

explodeToggleBtn.addEventListener('click', () => {
  const targetVal = state.isExploded ? 0 : 80;
  explodeSlider.value = targetVal;
  explodeSliderVal.textContent = `${targetVal}%`;
  applyExplode(targetVal / 100);
});

// ====================================================================
// Acciones sobre Piezas: Aislar, Ocultar, Centrar Cámara
// ====================================================================
document.getElementById('isolatePartBtn').addEventListener('click', () => {
  if (!state.activeMeshName) return;

  if (state.isolatedMeshName === state.activeMeshName) {
    state.isolatedMeshName = null;
    state.partMeshes.forEach(m => m.visible = true);
  } else {
    state.isolatedMeshName = state.activeMeshName;
    state.partMeshes.forEach(m => {
      m.visible = (m.userData.meshName === state.activeMeshName);
    });
  }
  selectPiece(state.activeMeshName);
});

document.getElementById('showAllBtn').addEventListener('click', () => {
  state.isolatedMeshName = null;
  state.partMeshes.forEach(m => m.visible = true);
  if (state.activeMeshName) selectPiece(state.activeMeshName);
});

document.getElementById('hidePartBtn').addEventListener('click', () => {
  if (!state.activeMeshName) return;
  const mesh = state.partMeshes.find(m => m.userData.meshName === state.activeMeshName);
  if (mesh) {
    mesh.visible = false;
    showToast(`Pieza oculta temporalmente. Usa "Mostrar Todas" para restaurar.`, 'info');
  }
});

document.getElementById('focusPartBtn').addEventListener('click', () => {
  if (!state.activeMeshName) return;
  const mesh = state.partMeshes.find(m => m.userData.meshName === state.activeMeshName);
  if (mesh) {
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    controls.update();
  }
});

document.getElementById('deselectPartBtn').addEventListener('click', () => {
  state.activeMeshName = null;
  state.partMeshes.forEach(m => {
    if (m.material) {
      m.material.emissive = new THREE.Color(0x000000);
      m.material.emissiveIntensity = 0;
    }
  });
  document.getElementById('inspectorPartTitle').textContent = 'Selecciona una pieza';
  document.getElementById('inspectorPartSubtitle').textContent = 'Haz clic en el visor 3D o en la lista de piezas';
  renderPartsList();
});

// ====================================================================
// Botones de Barra de Herramientas y Presets
// ====================================================================
// Wireframe
document.getElementById('wireframeToggleBtn').addEventListener('click', () => {
  state.wireframeActive = !state.wireframeActive;
  state.partMeshes.forEach(mesh => {
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.wireframe = state.wireframeActive);
      } else {
        mesh.material.wireframe = state.wireframeActive;
      }
    }
  });
  document.getElementById('wireframeToggleBtn').classList.toggle('bg-accent/20', state.wireframeActive);
});

// Rotación Automática
const autoRotateBtn = document.getElementById('autoRotateBtn');
const autoRotateText = document.getElementById('autoRotateText');
autoRotateBtn.addEventListener('click', () => {
  state.autoRotate = !state.autoRotate;
  controls.autoRotate = state.autoRotate;
  controls.autoRotateSpeed = 1.8;
  autoRotateText.textContent = `Rotación: ${state.autoRotate ? 'ON' : 'OFF'}`;
  autoRotateBtn.classList.toggle('text-ocean-navy', state.autoRotate);
});
controls.autoRotate = true;
controls.autoRotateSpeed = 1.8;

// Presets de Cámara
document.getElementById('viewIsoBtn').addEventListener('click', () => {
  const maxDim = Math.max(state.modelSize.x, state.modelSize.y, state.modelSize.z, 2.0);
  camera.position.set(maxDim * 1.6, maxDim * 1.1, maxDim * 2.0);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('viewFrontBtn').addEventListener('click', () => {
  const maxDim = Math.max(state.modelSize.x, state.modelSize.y, state.modelSize.z, 2.0);
  camera.position.set(0, 0, maxDim * 2.6);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('viewTopBtn').addEventListener('click', () => {
  const maxDim = Math.max(state.modelSize.x, state.modelSize.y, state.modelSize.z, 2.0);
  camera.position.set(0, maxDim * 2.6, 0.001);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.getElementById('resetCamBtn').addEventListener('click', () => {
  centerAndFitModel();
});

// Zoom botones
document.getElementById('zoomInBtn').addEventListener('click', () => {
  camera.position.multiplyScalar(0.85);
  controls.update();
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  camera.position.multiplyScalar(1.15);
  controls.update();
});

// Búsqueda en Árbol de Piezas
document.getElementById('searchPartsInput').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const rows = document.getElementById('partsListContainer').children;
  const entries = Array.from(state.piecesMap.values());

  entries.forEach((p, idx) => {
    const match = p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query) || p.mesh_name.toLowerCase().includes(query);
    if (rows[idx]) {
      rows[idx].style.display = match ? 'flex' : 'none';
    }
  });
});

// ====================================================================
// Subida de Archivos 3D (GLB, GLTF, OBJ, STL)
// ====================================================================
const uploadModal = document.getElementById('uploadModal');
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const dropzoneFileName = document.getElementById('dropzoneFileName');
let selectedUploadFile = null;

document.getElementById('openUploadModalBtn').addEventListener('click', () => {
  uploadModal.classList.remove('hidden');
});
document.getElementById('closeUploadModalBtn').addEventListener('click', () => {
  uploadModal.classList.add('hidden');
});
document.getElementById('cancelUploadBtn').addEventListener('click', () => {
  uploadModal.classList.add('hidden');
});

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    selectedUploadFile = e.target.files[0];
    dropzoneFileName.textContent = `Archivo seleccionado: ${selectedUploadFile.name} (${(selectedUploadFile.size / (1024 * 1024)).toFixed(2)} MB)`;
    if (!document.getElementById('uploadModelName').value) {
      document.getElementById('uploadModelName').value = selectedUploadFile.name.replace(/\.[^/.]+$/, "");
    }
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('border-accent', 'bg-accent/10');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('border-accent', 'bg-accent/10');
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-accent', 'bg-accent/10');
  if (e.dataTransfer.files.length > 0) {
    selectedUploadFile = e.dataTransfer.files[0];
    dropzoneFileName.textContent = `Archivo seleccionado: ${selectedUploadFile.name} (${(selectedUploadFile.size / (1024 * 1024)).toFixed(2)} MB)`;
    if (!document.getElementById('uploadModelName').value) {
      document.getElementById('uploadModelName').value = selectedUploadFile.name.replace(/\.[^/.]+$/, "");
    }
  }
});

document.getElementById('confirmUploadBtn').addEventListener('click', async () => {
  if (!selectedUploadFile) {
    showToast('Selecciona o arrastra un archivo 3D primero', 'error');
    return;
  }

  const confirmBtn = document.getElementById('confirmUploadBtn');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = `
    <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
    <span>Subiendo...</span>
  `;

  const formData = new FormData();
  formData.append('modelFile', selectedUploadFile);
  formData.append('name', document.getElementById('uploadModelName').value.trim() || selectedUploadFile.name);
  formData.append('description', document.getElementById('uploadModelDesc').value.trim());

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (result.success && result.model) {
      uploadModal.classList.add('hidden');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<span>Cargar al Visor</span>`;

      // Añadir al selector de modelos y seleccionarlo
      addModelToSelector(result.model, true);

      // Cargar en el visor 3D
      await loadExternal3DModel(
        result.model.file_url,
        result.model.filename,
        result.model.id,
        result.model.name
      );
    } else {
      throw new Error(result.error || 'Error al procesar el archivo');
    }
  } catch (err) {
    console.error('[Upload Error]', err);
    showToast(`Error de subida: ${err.message}`, 'error');
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `<span>Cargar al Visor</span>`;
  }
});

function addModelToSelector(model, autoSelect = false) {
  const selector = document.getElementById('modelSelector');
  const opt = document.createElement('option');
  opt.value = model.id;
  opt.textContent = `${model.name} (${model.format.toUpperCase()})`;
  opt.dataset.url = model.file_url;
  opt.dataset.filename = model.filename;
  selector.appendChild(opt);
  if (autoSelect) {
    selector.value = model.id;
  }
}

// Selector de modelos
document.getElementById('modelSelector').addEventListener('change', async (e) => {
  const val = e.target.value;
  if (!val) return;
  const selectedOpt = e.target.selectedOptions[0];
  if (selectedOpt && selectedOpt.dataset.url) {
    await loadExternal3DModel(
      selectedOpt.dataset.url,
      selectedOpt.dataset.filename,
      val,
      selectedOpt.textContent
    );
  }
});

// Cargar modelos existentes desde la API al arrancar
async function fetchExistingModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.success && Array.isArray(data.models)) {
      data.models.forEach(m => {
        if (m.id !== 'model_default_motor') {
          addModelToSelector(m, false);
        }
      });
    }
  } catch (err) {
    console.warn('[API] Error cargando lista de modelos:', err);
  }
}

// ====================================================================
// Modal de Información de Base de Datos
// ====================================================================
const dbModal = document.getElementById('dbModal');
const dbBadgeBtn = document.getElementById('dbStatusBadge');
if (dbBadgeBtn && dbModal) {
  dbBadgeBtn.addEventListener('click', () => {
    dbModal.classList.remove('hidden');
  });
}
document.getElementById('closeDbModalBtn')?.addEventListener('click', () => {
  dbModal?.classList.add('hidden');
});
document.getElementById('acceptDbModalBtn')?.addEventListener('click', () => {
  dbModal?.classList.add('hidden');
});

// ====================================================================
// Utilidades: Toasts y Spinners
// ====================================================================
function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');

  toastMsg.textContent = message;
  if (type === 'success') {
    toast.className = 'fixed top-5 right-5 z-50 transform opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium text-white bg-emerald-700 border border-emerald-500';
    toastIcon.textContent = 'check_circle';
  } else if (type === 'error') {
    toast.className = 'fixed top-5 right-5 z-50 transform opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium text-white bg-rose-700 border border-rose-500';
    toastIcon.textContent = 'error';
  } else {
    toast.className = 'fixed top-5 right-5 z-50 transform opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium text-white bg-ocean-navy border border-white/20';
    toastIcon.textContent = 'info';
  }

  setTimeout(() => {
    toast.className = 'fixed top-5 right-5 z-50 transform translate-y-[-100px] opacity-0 transition-all duration-300 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium text-white bg-ocean-navy border border-white/20 pointer-events-none';
  }, 4000);
}

function showLoader(visible, text = 'Cargando modelo 3D...') {
  const overlay = document.getElementById('loaderOverlay');
  const loaderText = document.getElementById('loaderText');
  loaderText.textContent = text;
  if (visible) {
    overlay.classList.remove('pointer-events-none', 'opacity-0');
    overlay.classList.add('opacity-100');
  } else {
    overlay.classList.remove('opacity-100');
    overlay.classList.add('pointer-events-none', 'opacity-0');
  }
}

// ====================================================================
// Bucle de Animación y Redimensionamiento
// ====================================================================
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  width = container.clientWidth || window.innerWidth;
  height = container.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

// ====================================================================
// Arranque
// ====================================================================
async function initApp() {
  await checkDbStatus();
  renderPartsList();
  resetInspector();
  await fetchExistingModels();
}

initApp();
