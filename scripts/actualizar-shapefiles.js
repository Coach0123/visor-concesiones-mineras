const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');

// Configuración para ignorar certificados SSL
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Intentar importar shapefile con manejo de errores
let shapefile;
try {
  shapefile = require('shapefile');
  console.log('✓ Módulo shapefile cargado correctamente');
} catch (e) {
  console.error('✗ Error cargando shapefile:', e.message);
  process.exit(1);
}

// Función para corregir caracteres especiales
function corregirCaracteres(texto) {
  if (!texto) return '';
  
  // Mapa de reemplazos para caracteres mal codificados
  const reemplazos = {
    'Ã‘': 'Ñ',
    'Ã±': 'ñ',
    'Ã‰': 'É',
    'Ã©': 'é',
    'Ã ': 'Á',
    'Ã¡': 'á',
    'Ã“': 'Ó',
    'Ã³': 'ó',
    'Ãš': 'Ú',
    'Ãº': 'ú',
    'Ã ': 'Í',
    'Ã­': 'í',
    'Ãœ': 'Ü',
    'Ã¼': 'ü',
    'Ã€': 'À',
    'Ã ': 'à',
    'ÃŠ': 'Ê',
    'Ãª': 'ê',
    'Ã‡': 'Ç',
    'Ã§': 'ç',
    'Â¿': '¿',
    'Â¡': '¡',
    'Â°': '°',
    'â€™': "'",
    'â€œ': '"',
    'â€': '"',
    'Â´': "'",
    'Ã': 'í',
    '³': 'ó',
    '±': 'ñ'
  };
  
  let textoCorregido = texto.toString();
  for (const [mal, bien] of Object.entries(reemplazos)) {
    textoCorregido = textoCorregido.replace(new RegExp(mal, 'g'), bien);
  }
  
  return textoCorregido;
}

const ZONAS = ['17S', '18S', '19S'];
const URLS = {
  '17S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_17S.zip',
  '18S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_18S.zip',
  '19S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_19S.zip'
};

async function descargarYProcesar() {
  const fechaHoy = new Date();
  const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).replace(/\//g, '');
  
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.ensureDir(dataDir);
  
  for (const zona of ZONAS) {
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`PROCESANDO ZONA ${zona}`);
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
      
      // Listar archivos extraídos
      const files = await fs.readdir(extractPath);
      console.log('   Archivos extraídos:');
      files.forEach(f => console.log(`   - ${f}`));
      
      // Buscar archivos .shp y .dbf
      const shpFile = files.find(f => f.endsWith('.shp'));
      const dbfFile = files.find(f => f.endsWith('.dbf'));
      
      if (!shpFile || !dbfFile) {
        throw new Error('No se encontraron archivos .shp o .dbf');
      }
      
      const shpPath = path.join(extractPath, shpFile);
      const dbfPath = path.join(extractPath, dbfFile);
      
      console.log(`3. Leyendo shapefile: ${shpFile}`);
      console.log(`   Archivo DBF: ${dbfFile}`);
      
      // Leer el shapefile
      const source = await shapefile.open(shpPath, dbfPath, { encoding: 'latin1' });
      
      const features = [];
      let result;
      let featureCount = 0;
      
      console.log(`4. Procesando features...`);
      
      while (!(result = await source.read()).done) {
        const feature = result.value;
        
        // Guardar propiedades del primer feature
        if (featureCount === 0) {
          console.log(`\n📋 PROPIEDADES DEL PRIMER FEATURE (${zona}):`);
          console.log('----------------------------------------');
          Object.keys(feature.properties).forEach(key => {
            const valor = feature.properties[key];
            console.log(`   ${key}: "${valor}"`);
          });
          console.log('----------------------------------------\n');
        }
        
        // Crear objeto con SOLO los campos que necesitamos
        const props = feature.properties;
        const propiedades = {
          CODIGOU: props.CODIGOU || props.codigou || props.Codigou || props.CODIGO || props.codigo || '',
          FEC_DENU: props.FEC_DENU || props.fec_denu || props.Fec_Denu || props.FECHA || props.fecha || props.F_DENUNCIO || '',
          CONCESION: props.CONCESION || props.concesion || props.Concesion || props.NOMBRE || props.nombre || props.DENOMINACION || '',
          TIT_CONCES: props.TIT_CONCES || props.tit_conces || props.Tit_Conces || props.TITULAR || props.titular || ''
        };
        
        // CORREGIR CARACTERES ESPECIALES
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
        
        // Mostrar progreso cada 5000 features
        if (featureCount % 5000 === 0) {
          console.log(`   Procesados ${featureCount} features...`);
        }
      }
      
      console.log(`\n5. Total features procesados: ${featureCount}`);
      
      // Guardar GeoJSON con codificación UTF-8
      const geojson = {
        type: 'FeatureCollection',
        features: features
      };
      
      const outputPath = path.join(dataDir, `${zona.toLowerCase()}_${fechaStr}.geojson`);
      
      // Guardar con opciones UTF-8
      await fs.writeJson(outputPath, geojson, { 
        spaces: 2,
        encoding: 'utf8'
      });
      
      console.log(`6. ✅ Archivo guardado: ${outputPath}`);
      
      // Mostrar ejemplo de datos guardados con caracteres corregidos
      if (features.length > 0) {
        console.log(`\n📌 EJEMPLO DE DATOS GUARDADOS (CON CARACTERES CORREGIDOS):`);
        console.log(`   CODIGOU: "${features[0].properties.CODIGOU}"`);
        console.log(`   FEC_DENU: "${features[0].properties.FEC_DENU}"`);
        console.log(`   CONCESION: "${features[0].properties.CONCESION}"`);
        console.log(`   TIT_CONCES: "${features[0].properties.TIT_CONCES}"`);
      }
      
      // Limpiar archivos temporales
      await fs.remove(zipPath);
      await fs.remove(extractPath);
      
      console.log(`\n✅ Zona ${zona} procesada exitosamente!\n`);
      
    } catch (error) {
      console.error(`\n❌ ERROR en zona ${zona}:`, error.message);
      console.error(error.stack);
    }
  }
  
  console.log('\n🎉 PROCESO COMPLETADO');
}

descargarYProcesar();