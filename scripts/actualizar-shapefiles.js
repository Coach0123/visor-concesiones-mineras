const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const shapefile = require('shapefile');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ZONAS = ['17S', '18S', '19S'];
const URLS = {
  '17S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_17S.zip',
  '18S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_18S.zip',
  '19S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_19S.zip'
};

function corregirCaracteres(texto) {
  if (!texto) return '';
  const reemplazos = {
    'Ã‘': 'Ñ', 'Ã±': 'ñ', 'Ã‰': 'É', 'Ã©': 'é', 'Ã ': 'Á', 'Ã¡': 'á',
    'Ã“': 'Ó', 'Ã³': 'ó', 'Ãš': 'Ú', 'Ãº': 'ú', 'Ã ': 'Í', 'Ã­': 'í',
    'Ãœ': 'Ü', 'Ã¼': 'ü', 'Ã€': 'À', 'Ã ': 'à', 'ÃŠ': 'Ê', 'Ãª': 'ê',
    'Ã‡': 'Ç', 'Ã§': 'ç', 'Â¿': '¿', 'Â¡': '¡', 'Â°': '°', 'â€™': "'",
    'â€œ': '"', 'â€': '"', 'Â´': "'", 'Ã': 'í', '³': 'ó', '±': 'ñ',
    'estÃ¡ndar': 'estándar', 'PerÃº': 'Perú'
  };
  let textoCorregido = texto.toString();
  for (const [mal, bien] of Object.entries(reemplazos)) {
    textoCorregido = textoCorregido.replace(new RegExp(mal, 'g'), bien);
  }
  return textoCorregido;
}

function convertirUTM_A_WGS84(x, y, zona) {
  try {
    let projSrc;
    switch(zona) {
      case '17s': projSrc = 'EPSG:32717'; break;
      case '18s': projSrc = 'EPSG:32718'; break;
      case '19s': projSrc = 'EPSG:32719'; break;
      default: return [y, x];
    }
    const proj4 = require('proj4');
    proj4.defs([
      ['EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs'],
      ['EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs'],
      ['EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs']
    ]);
    const wgs84 = proj4(projSrc, 'EPSG:4326', [x, y]);
    return [wgs84[1], wgs84[0]];
  } catch (e) {
    return [y, x];
  }
}

function obtenerCentroWGS84(feature, zona) {
  try {
    let coords;
    if (feature.geometry.type === 'Polygon') {
      coords = feature.geometry.coordinates[0];
    } else if (feature.geometry.type === 'MultiPolygon') {
      coords = feature.geometry.coordinates[0][0];
    } else {
      return null;
    }
    
    let sumX = 0, sumY = 0;
    coords.forEach(c => {
      const [lat, lon] = convertirUTM_A_WGS84(c[0], c[1], zona);
      sumX += lon;
      sumY += lat;
    });
    return [sumX / coords.length, sumY / coords.length];
  } catch (e) {
    return null;
  }
}

async function descargarYProcesar() {
  console.log('🚀 Iniciando proceso de actualización automática...');
  
  const fechaHoy = new Date();
  const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).replace(/\//g, '');
  
  const horaActual = fechaHoy.getUTCHours().toString().padStart(2, '0');
  console.log(`📅 Fecha: ${fechaStr}`);
  console.log(`🕐 Hora UTC: ${horaActual}:00`);
  
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.ensureDir(dataDir);
  
  // Obtener el archivo anterior para comparar (el más reciente)
  const archivosExistentes = await fs.readdir(dataDir);
  const archivosGeoJSON = archivosExistentes.filter(f => 
    f.match(/^\d{2}s_\d{6}_\d{2}\.geojson$/)
  );
  archivosGeoJSON.sort().reverse();
  const archivoAnterior = archivosGeoJSON.length > 0 ? archivosGeoJSON[0] : null;
  console.log(`📁 Archivo anterior para comparar: ${archivoAnterior || 'ninguno'}`);
  
  const nuevosArchivos = [];
  const desaparecidos = [];
  const aparecidos = [];
  
  for (const zona of ZONAS) {
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`📥 PROCESANDO ZONA ${zona} - HORA ${horaActual}:00`);
      console.log(`${'='.repeat(50)}`);
      
      console.log(`1. Descargando archivo...`);
      const response = await fetch(URLS[zona]);
      const buffer = await response.buffer();
      
      const zipPath = path.join(dataDir, `temp_${zona}.zip`);
      await fs.writeFile(zipPath, buffer);
      
      console.log(`2. Extrayendo ZIP...`);
      const zip = new AdmZip(zipPath);
      const extractPath = path.join(dataDir, `extract_${zona}`);
      await fs.ensureDir(extractPath);
      zip.extractAllTo(extractPath, true);
      
      const files = await fs.readdir(extractPath);
      const shpFile = files.find(f => f.endsWith('.shp'));
      const dbfFile = files.find(f => f.endsWith('.dbf'));
      
      if (!shpFile || !dbfFile) {
        throw new Error('No se encontraron archivos .shp o .dbf');
      }
      
      const shpPath = path.join(extractPath, shpFile);
      const dbfPath = path.join(extractPath, dbfFile);
      
      console.log(`3. Leyendo shapefile...`);
      const source = await shapefile.open(shpPath, dbfPath, { encoding: 'latin1' });
      
      const features = [];
      let result;
      let featureCount = 0;
      
      while (!(result = await source.read()).done) {
        const feature = result.value;
        const props = feature.properties;
        
        const propiedades = {
          CODIGOU: corregirCaracteres(props.CODIGOU || ''),
          FEC_DENU: corregirCaracteres(props.FEC_DENU || ''),
          CONCESION: corregirCaracteres(props.CONCESION || ''),
          TIT_CONCES: corregirCaracteres(props.TIT_CONCES || '')
        };
        
        features.push({
          type: 'Feature',
          geometry: feature.geometry,
          properties: propiedades
        });
        
        featureCount++;
        if (featureCount % 5000 === 0) {
          console.log(`   Procesados ${featureCount} features...`);
        }
      }
      
      console.log(`4. Total features: ${featureCount}`);
      
      const geojson = {
        type: 'FeatureCollection',
        features: features
      };
      
      const nombreArchivo = `${zona.toLowerCase()}_${fechaStr}_${horaActual}.geojson`;
      const outputPath = path.join(dataDir, nombreArchivo);
      await fs.writeJson(outputPath, geojson, { spaces: 0 });
      
      nuevosArchivos.push({ zona: zona.toLowerCase(), archivo: nombreArchivo, features });
      
      await fs.remove(zipPath);
      await fs.remove(extractPath);
      
      const stats = await fs.stat(outputPath);
      console.log(`5. ✅ Guardado: ${nombreArchivo} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
    } catch (error) {
      console.error(`❌ Error en zona ${zona}:`, error.message);
    }
  }
  
  // Comparar con archivo anterior para detectar cambios
  if (archivoAnterior) {
    console.log('\n🔍 DETECTANDO CAMBIOS...');
    
    for (const nuevo of nuevosArchivos) {
      const anteriorPath = path.join(dataDir, archivoAnterior);
      if (await fs.pathExists(anteriorPath)) {
        const anteriorData = await fs.readJson(anteriorPath);
        
        const codigosActual = new Set(nuevo.features.map(f => f.properties.CODIGOU));
        const codigosAnterior = new Set(anteriorData.features.map(f => f.properties.CODIGOU));
        
        // Desaparecidos (estaban antes, no están ahora)
        for (const codigo of codigosAnterior) {
          if (!codigosActual.has(codigo)) {
            const feature = anteriorData.features.find(f => f.properties.CODIGOU === codigo);
            if (feature) {
              const centro = obtenerCentroWGS84(feature, nuevo.zona);
              desaparecidos.push({
                codigo: codigo,
                nombre: feature.properties.CONCESION || '',
                tipo: 'desaparece',
                geometry: {
                  type: 'Point',
                  coordinates: centro || [0, 0]
                },
                properties: feature.properties
              });
            }
          }
        }
        
        // Aparecidos (no estaban antes, están ahora)
        for (const codigo of codigosActual) {
          if (!codigosAnterior.has(codigo)) {
            const feature = nuevo.features.find(f => f.properties.CODIGOU === codigo);
            if (feature) {
              const centro = obtenerCentroWGS84(feature, nuevo.zona);
              aparecidos.push({
                codigo: codigo,
                nombre: feature.properties.CONCESION || '',
                tipo: 'aparece',
                geometry: {
                  type: 'Point',
                  coordinates: centro || [0, 0]
                },
                properties: feature.properties
              });
            }
          }
        }
      }
    }
  }
  
  // Actualizar cambios.json
  const cambiosPath = path.join(dataDir, 'cambios.json');
  let cambiosExistentes = [];
  if (await fs.pathExists(cambiosPath)) {
    cambiosExistentes = await fs.readJson(cambiosPath);
  }
  
  const nuevosCambios = [...desaparecidos, ...aparecidos].map(c => ({
    fecha: `${fechaStr}_${horaActual}`,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo
  }));
  
  const cambiosActualizados = [...nuevosCambios, ...cambiosExistentes].slice(0, 500);
  await fs.writeJson(cambiosPath, cambiosActualizados, { spaces: 2 });
  console.log(`\n📊 Cambios detectados: ${nuevosCambios.length} (${desaparecidos.length} desaparecidos, ${aparecidos.length} aparecidos)`);
  
  // Actualizar archivo de desaparecidos
  if (desaparecidos.length > 0) {
    const desaparecidosPath = path.join(dataDir, `desaparecidos_${fechaStr.slice(-4)}.geojson`);
    let existentes = [];
    if (await fs.pathExists(desaparecidosPath)) {
      const existente = await fs.readJson(desaparecidosPath);
      existentes = existente.features;
    }
    
    const nuevasFeatures = desaparecidos.map(d => ({
      type: 'Feature',
      geometry: d.geometry,
      properties: d.properties
    }));
    
    const todasFeatures = [...existentes, ...nuevasFeatures];
    const geojson = { type: 'FeatureCollection', features: todasFeatures };
    await fs.writeJson(desaparecidosPath, geojson, { spaces: 2 });
    console.log(`📁 Desaparecidos: +${nuevasFeatures.length} (total: ${todasFeatures.length})`);
  }
  
  // Actualizar archivo de aparecidos
  if (aparecidos.length > 0) {
    const aparecidosPath = path.join(dataDir, `aparecidos_${fechaStr.slice(-4)}.geojson`);
    let existentes = [];
    if (await fs.pathExists(aparecidosPath)) {
      const existente = await fs.readJson(aparecidosPath);
      existentes = existente.features;
    }
    
    const nuevasFeatures = aparecidos.map(a => ({
      type: 'Feature',
      geometry: a.geometry,
      properties: a.properties
    }));
    
    const todasFeatures = [...existentes, ...nuevasFeatures];
    const geojson = { type: 'FeatureCollection', features: todasFeatures };
    await fs.writeJson(aparecidosPath, geojson, { spaces: 2 });
    console.log(`📁 Aparecidos: +${nuevasFeatures.length} (total: ${todasFeatures.length})`);
  }
  
  console.log('\n🎉 PROCESO COMPLETADO');
}

descargarYProcesar().catch(console.error);