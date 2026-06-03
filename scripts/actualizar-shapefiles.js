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

function obtenerMesActual() {
  const ahora = new Date();
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return meses[ahora.getMonth()];
}

function obtenerNombreArchivoMensual(tipo) {
  const ahora = new Date();
  const mesNumero = (ahora.getMonth() + 1).toString().padStart(2, '0');
  const anio = ahora.getFullYear();
  return `${tipo}_${anio}${mesNumero}.geojson`;
}

async function actualizarArchivoMensual(tipo, nuevasFeatures) {
  const dataDir = path.join(__dirname, '..', 'data');
  const nombreArchivo = obtenerNombreArchivoMensual(tipo);
  const rutaArchivo = path.join(dataDir, nombreArchivo);
  
  let featuresExistentes = [];
  
  // Cargar archivo existente si existe
  if (await fs.pathExists(rutaArchivo)) {
    const geojsonExistente = await fs.readJson(rutaArchivo);
    featuresExistentes = geojsonExistente.features || [];
  }
  
  // Crear mapa de códigos existentes para evitar duplicados
  const codigosExistentes = new Set(featuresExistentes.map(f => f.properties.CODIGOU));
  
  // Agregar nuevas features que no existan
  const nuevasFeaturesUnicas = nuevasFeatures.filter(f => !codigosExistentes.has(f.properties.CODIGOU));
  
  if (nuevasFeaturesUnicas.length === 0) return;
  
  const todasFeatures = [...featuresExistentes, ...nuevasFeaturesUnicas];
  
  const geojsonMensual = {
    type: 'FeatureCollection',
    features: todasFeatures
  };
  
  await fs.writeJson(rutaArchivo, geojsonMensual, { spaces: 2 });
  console.log(`📁 ${tipo}: ${nuevasFeaturesUnicas.length} nuevos polígonos agregados (total: ${todasFeatures.length})`);
}

async function limpiarArchivosMesAnterior() {
  const dataDir = path.join(__dirname, '..', 'data');
  const ahora = new Date();
  const mesActual = ahora.getMonth();
  const anioActual = ahora.getFullYear();
  
  const archivos = await fs.readdir(dataDir);
  
  for (const archivo of archivos) {
    if (archivo.startsWith('desaparecidos_') || archivo.startsWith('aparecidos_')) {
      // Extraer año y mes del nombre del archivo
      const match = archivo.match(/(desaparecidos|aparecidos)_(\d{4})(\d{2})\.geojson/);
      if (match) {
        const anioArchivo = parseInt(match[2]);
        const mesArchivo = parseInt(match[3]) - 1; // mes en JS es 0-11
        
        // Si es de un mes anterior, eliminarlo
        if (anioArchivo < anioActual || (anioArchivo === anioActual && mesArchivo < mesActual)) {
          await fs.remove(path.join(dataDir, archivo));
          console.log(`🗑️ Eliminado archivo antiguo: ${archivo}`);
        }
      }
    }
  }
}

async function descargarYProcesar() {
  console.log('🚀 Iniciando proceso de actualización...');
  
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
  
  // Limpiar archivos de meses anteriores
  await limpiarArchivosMesAnterior();
  
  // Diccionario para almacenar cambios del mes
  const desaparecidosDelMes = [];
  const aparecidosDelMes = [];
  
  // Obtener archivo anterior para comparar (el más reciente antes de este)
  let archivoAnterior = null;
  const archivosExistentes = await fs.readdir(dataDir);
  const archivosGeoJSON = archivosExistentes.filter(f => 
    f.match(/^17s_\d{6}_\d{2}\.geojson$/) || 
    f.match(/^18s_\d{6}_\d{2}\.geojson$/) || 
    f.match(/^19s_\d{6}_\d{2}\.geojson$/)
  );
  archivosGeoJSON.sort().reverse();
  if (archivosGeoJSON.length > 0) {
    archivoAnterior = archivosGeoJSON[0];
  }
  
  for (const zona of ZONAS) {
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`📥 PROCESANDO ZONA ${zona} - HORA ${horaActual}:00`);
      console.log(`${'='.repeat(50)}`);
      
      console.log(`1. Descargando archivo...`);
      const response = await fetch(URLS[zona]);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
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
      
      const outputPath = path.join(dataDir, `${zona.toLowerCase()}_${fechaStr}_${horaActual}.geojson`);
      await fs.writeJson(outputPath, geojson, { spaces: 0 });
      
      await fs.remove(zipPath);
      await fs.remove(extractPath);
      
      const stats = await fs.stat(outputPath);
      console.log(`5. ✅ Guardado: ${path.basename(outputPath)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
    } catch (error) {
      console.error(`❌ Error en zona ${zona}:`, error.message);
    }
  }
  
  // Generar cambios y actualizar archivos mensuales
  await generarRegistroCambiosYCrearMensuales(desaparecidosDelMes, aparecidosDelMes);
  
  console.log('\n🎉 PROCESO COMPLETADO');
}

async function generarRegistroCambiosYCrearMensuales(desaparecidosDelMes, aparecidosDelMes) {
  const dataDir = path.join(__dirname, '..', 'data');
  const cambios = [];
  
  try {
    const archivos = await fs.readdir(dataDir);
    const archivosPorZona = {};
    
    for (const archivo of archivos) {
      if (archivo.endsWith('.geojson') && !archivo.includes('historial') && !archivo.includes('cambios') && !archivo.includes('desaparecidos') && !archivo.includes('aparecidos')) {
        const partes = archivo.split('_');
        if (partes.length >= 3) {
          const zona = partes[0];
          const fechaHora = `${partes[1]}_${partes[2].split('.')[0]}`;
          if (!archivosPorZona[zona]) archivosPorZona[zona] = [];
          archivosPorZona[zona].push({ archivo, fechaHora, path: path.join(dataDir, archivo) });
        }
      }
    }
    
    for (const zona in archivosPorZona) {
      archivosPorZona[zona].sort((a, b) => b.fechaHora.localeCompare(a.fechaHora));
      
      if (archivosPorZona[zona].length >= 2) {
        const actual = await fs.readJson(archivosPorZona[zona][0].path);
        const anterior = await fs.readJson(archivosPorZona[zona][1].path);
        
        const codigosActual = new Set(actual.features.map(f => f.properties.CODIGOU));
        const codigosAnterior = new Set(anterior.features.map(f => f.properties.CODIGOU));
        
        // Desaparecidos (estaban antes, no están ahora)
        for (const codigo of codigosAnterior) {
          if (!codigosActual.has(codigo)) {
            const feature = anterior.features.find(f => f.properties.CODIGOU === codigo);
            if (feature) {
              cambios.push({
                fecha: archivosPorZona[zona][1].fechaHora,
                codigo: codigo,
                nombre: feature.properties.CONCESION || '',
                tipo: 'desaparece',
                geometry: feature.geometry,
                properties: feature.properties
              });
              desaparecidosDelMes.push(feature);
            }
          }
        }
        
        // Aparecidos (no estaban antes, están ahora)
        for (const codigo of codigosActual) {
          if (!codigosAnterior.has(codigo)) {
            const feature = actual.features.find(f => f.properties.CODIGOU === codigo);
            if (feature) {
              cambios.push({
                fecha: archivosPorZona[zona][0].fechaHora,
                codigo: codigo,
                nombre: feature.properties.CONCESION || '',
                tipo: 'aparece',
                geometry: feature.geometry,
                properties: feature.properties
              });
              aparecidosDelMes.push(feature);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error generando cambios:', error.message);
  }
  
  // Guardar cambios.json
  if (cambios.length > 0) {
    const cambiosPath = path.join(dataDir, 'cambios.json');
    let cambiosExistentes = [];
    if (await fs.pathExists(cambiosPath)) {
      cambiosExistentes = await fs.readJson(cambiosPath);
    }
    cambiosExistentes = [...cambiosExistentes, ...cambios];
    await fs.writeJson(cambiosPath, cambiosExistentes, { spaces: 2 });
    console.log(`📊 Registrados ${cambios.length} cambios (total: ${cambiosExistentes.length})`);
  }
  
  // Actualizar archivos mensuales
  if (desaparecidosDelMes.length > 0) {
    await actualizarArchivoMensual('desaparecidos', desaparecidosDelMes);
  }
  if (aparecidosDelMes.length > 0) {
    await actualizarArchivoMensual('aparecidos', aparecidosDelMes);
  }
}

descargarYProcesar().catch(console.error);