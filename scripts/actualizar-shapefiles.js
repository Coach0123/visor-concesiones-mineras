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

// Horarios de ejecución
const HORARIOS = ['01', '06', '11', '16', '21'];

// Función para corregir caracteres especiales
function corregirCaracteres(texto) {
  if (!texto) return '';
  
  const reemplazos = {
    'Ã‘': 'Ñ', 'Ã±': 'ñ', 'Ã‰': 'É', 'Ã©': 'é', 'Ã ': 'Á', 'Ã¡': 'á',
    'Ã“': 'Ó', 'Ã³': 'ó', 'Ãš': 'Ú', 'Ãº': 'ú', 'Ã ': 'Í', 'Ã­': 'í',
    'Ãœ': 'Ü', 'Ã¼': 'ü', 'Ã€': 'À', 'Ã ': 'à', 'ÃŠ': 'Ê', 'Ãª': 'ê',
    'Ã‡': 'Ç', 'Ã§': 'ç', 'Â¿': '¿', 'Â¡': '¡', 'Â°': '°', 'â€™': "'",
    'â€œ': '"', 'â€': '"', 'Â´': "'", 'Ã': 'í', '³': 'ó', '±': 'ñ'
  };
  
  let textoCorregido = texto.toString();
  for (const [mal, bien] of Object.entries(reemplazos)) {
    textoCorregido = textoCorregido.replace(new RegExp(mal, 'g'), bien);
  }
  return textoCorregido;
}

// Obtener hora actual en Perú (UTC-5)
function obtenerHoraPeru() {
  const ahora = new Date();
  const horaUTC = ahora.getUTCHours();
  const horaPeru = (horaUTC - 5 + 24) % 24; // Ajuste a UTC-5
  return horaPeru.toString().padStart(2, '0');
}

// Obtener el horario de ejecución actual (el más cercano)
function obtenerHorarioActual() {
  const horaPeru = obtenerHoraPeru();
  console.log(`Hora actual Perú: ${horaPeru}:00`);
  
  // Determinar en qué horario estamos
  let horarioActual = '21'; // Por defecto
  for (let i = 0; i < HORARIOS.length; i++) {
    if (parseInt(horaPeru) <= parseInt(HORARIOS[i])) {
      horarioActual = HORARIOS[i];
      break;
    }
  }
  return horarioActual;
}

// Obtener los dos horarios a mantener (actual y anterior)
function obtenerHorariosAMantener() {
  const horarioActual = obtenerHorarioActual();
  const indexActual = HORARIOS.indexOf(horarioActual);
  const indexAnterior = indexActual > 0 ? indexActual - 1 : HORARIOS.length - 1;
  
  return {
    actual: horarioActual,
    anterior: HORARIOS[indexAnterior]
  };
}

async function descargarYProcesar() {
  const fechaHoy = new Date();
  const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).replace(/\//g, '');
  
  const horariosAMantener = obtenerHorariosAMantener();
  console.log(`\n📅 Fecha: ${fechaStr}`);
  console.log(`🕐 Horario actual: ${horariosAMantener.actual}:00`);
  console.log(`🕐 Horario anterior: ${horariosAMantener.anterior}:00`);
  
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.ensureDir(dataDir);
  
  // Limpiar archivos antiguos (solo mantener los dos horarios)
  console.log('\n🧹 Limpiando archivos antiguos...');
  const archivos = await fs.readdir(dataDir);
  for (const archivo of archivos) {
    if (archivo.endsWith('.geojson')) {
      // Verificar si el archivo corresponde a los horarios a mantener
      const partes = archivo.split('_');
      if (partes.length >= 3) {
        const fechaArchivo = partes[1];
        const horaArchivo = partes[2].split('.')[0];
        
        // Mantener solo archivos de la fecha actual con los horarios actual/anterior
        if (fechaArchivo === fechaStr) {
          if (horaArchivo !== horariosAMantener.actual && horaArchivo !== horariosAMantener.anterior) {
            await fs.remove(path.join(dataDir, archivo));
            console.log(`  Eliminado: ${archivo}`);
          }
        } else {
          // Eliminar archivos de fechas anteriores
          await fs.remove(path.join(dataDir, archivo));
          console.log(`  Eliminado (fecha anterior): ${archivo}`);
        }
      }
    }
  }
  
  for (const zona of ZONAS) {
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`PROCESANDO ZONA ${zona} - HORARIO ${horariosAMantener.actual}:00`);
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
          CODIGOU: props.CODIGOU || '',
          FEC_DENU: props.FEC_DENU || '',
          CONCESION: props.CONCESION || '',
          TIT_CONCES: props.TIT_CONCES || ''
        };
        
        // Corregir caracteres
        propiedades.CODIGOU = corregirCaracteres(propiedades.CODIGOU);
        propiedades.FEC_DENU = corregirCaracteres(propiedades.FEC_DENU);
        propiedades.CONCESION = corregirCaracteres(propiedades.CONCESION);
        propiedades.TIT_CONCES = corregirCaracteres(propiedades.TIT_CONCES);
        
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
      
      // Guardar con el nuevo formato: zona_fecha_hora.geojson
      const outputPath = path.join(dataDir, `${zona.toLowerCase()}_${fechaStr}_${horariosAMantener.actual}.geojson`);
      await fs.writeJson(outputPath, geojson, { spaces: 2 });
      
      // Limpiar temporales
      await fs.remove(zipPath);
      await fs.remove(extractPath);
      
      console.log(`5. ✅ Guardado: ${path.basename(outputPath)}`);
      
    } catch (error) {
      console.error(`❌ Error en ${zona}:`, error.message);
    }
  }
  
  // Generar archivo de cambios
  await generarRegistroCambios(fechaStr, horariosAMantener);
  console.log('\n🎉 PROCESO COMPLETADO');
}

async function generarRegistroCambios(fechaStr, horarios) {
  const dataDir = path.join(__dirname, '..', 'data');
  const cambios = [];
  
  for (const zona of ZONAS) {
    const archivoActual = path.join(dataDir, `${zona.toLowerCase()}_${fechaStr}_${horarios.actual}.geojson`);
    const archivoAnterior = path.join(dataDir, `${zona.toLowerCase()}_${fechaStr}_${horarios.anterior}.geojson`);
    
    if (await fs.pathExists(archivoActual) && await fs.pathExists(archivoAnterior)) {
      const datosActual = await fs.readJson(archivoActual);
      const datosAnterior = await fs.readJson(archivoAnterior);
      
      const codigosActual = new Set(datosActual.features.map(f => f.properties.CODIGOU));
      const codigosAnterior = new Set(datosAnterior.features.map(f => f.properties.CODIGOU));
      
      // Desaparecidos
      for (const codigo of codigosAnterior) {
        if (!codigosActual.has(codigo)) {
          const feature = datosAnterior.features.find(f => f.properties.CODIGOU === codigo);
          cambios.push({
            fecha: `${fechaStr}_${horarios.anterior}`,
            codigo: codigo,
            nombre: feature.properties.CONCESION,
            tipo: 'desaparece'
          });
        }
      }
      
      // Aparecidos
      for (const codigo of codigosActual) {
        if (!codigosAnterior.has(codigo)) {
          const feature = datosActual.features.find(f => f.properties.CODIGOU === codigo);
          cambios.push({
            fecha: `${fechaStr}_${horarios.actual}`,
            codigo: codigo,
            nombre: feature.properties.CONCESION,
            tipo: 'aparece'
          });
        }
      }
    }
  }
  
  if (cambios.length > 0) {
    const cambiosPath = path.join(dataDir, 'cambios.json');
    let cambiosExistentes = [];
    if (await fs.pathExists(cambiosPath)) {
      cambiosExistentes = await fs.readJson(cambiosPath);
    }
    cambiosExistentes = [...cambiosExistentes, ...cambios].slice(-100);
    await fs.writeJson(cambiosPath, cambiosExistentes, { spaces: 2 });
    console.log(`📊 Registrados ${cambios.length} cambios`);
  }
}

descargarYProcesar().catch(console.error);