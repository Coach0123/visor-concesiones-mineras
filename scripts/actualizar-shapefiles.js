const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const shapefile = require('shapefile');
const nodemailer = require('nodemailer');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ZONAS = ['17S', '18S', '19S'];
const URLS = {
  '17S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_17S.zip',
  '18S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_18S.zip',
  '19S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_19S.zip'
};

function corregirCaracteres(texto) {
  if (!texto) return '';
  return texto.toString();
}

async function enviarResumenCambios(desaparecidos, aparecidos, fechaStr) {
    if (desaparecidos.length === 0 && aparecidos.length === 0) {
        console.log('📭 No hay cambios para enviar');
        return;
    }
    
    const maxMostrar = 30;
    const totalDesap = desaparecidos.length;
    const totalApare = aparecidos.length;
    
    let mensaje = `📊 RESUMEN DE CAMBIOS - ${fechaStr}\n`;
    mensaje += `================================\n\n`;
    
    mensaje += `🔴 DESAPARECIDOS (${totalDesap}):\n`;
    if (totalDesap > 0) {
        desaparecidos.slice(0, maxMostrar).forEach(f => {
            mensaje += `  - ${f.properties.CONCESION} (${f.properties.CODIGOU})\n`;
        });
        if (totalDesap > maxMostrar) {
            mensaje += `  ... y ${totalDesap - maxMostrar} más\n`;
        }
    } else {
        mensaje += `  Ninguno\n`;
    }
    
    mensaje += `\n🟢 APARECIDOS (${totalApare}):\n`;
    if (totalApare > 0) {
        aparecidos.slice(0, maxMostrar).forEach(f => {
            mensaje += `  - ${f.properties.CONCESION} (${f.properties.CODIGOU})\n`;
        });
        if (totalApare > maxMostrar) {
            mensaje += `  ... y ${totalApare - maxMostrar} más\n`;
        }
    } else {
        mensaje += `  Ninguno\n`;
    }
    
    mensaje += `\n🔗 Visor: https://coach0123.github.io/visor-concesiones-mineras/\n`;
    mensaje += `📅 ${new Date().toLocaleString('es-PE')}`;
    
    // Configurar transporter con Gmail
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'carlosfernandezgeraldino@gmail.com',
            pass: 'wwtolzrnckkdwvoi'  // Contraseña de aplicación
        }
    });
    
    const mailOptions = {
        from: 'carlosfernandezgeraldino@gmail.com',
        to: 'carlosfernandezgeraldino@gmail.com',
        subject: `📊 Cambios en concesiones - ${fechaStr}`,
        text: mensaje
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Correo enviado con', totalDesap + totalApare, 'cambios');
    } catch (error) {
        console.error('❌ Error enviando correo:', error.message);
    }
}

async function descargarYProcesar() {
  console.log('🚀 Iniciando...');
  
  const fechaHoy = new Date();
  const fechaStr = fechaHoy.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '');
  const horaActual = fechaHoy.getUTCHours().toString().padStart(2, '0');
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.ensureDir(dataDir);
  
  // Buscar archivo anterior
  const archivosExistentes = await fs.readdir(dataDir);
  const archivosGeoJSON = archivosExistentes.filter(f => f.match(/^\d{2}s_\d{6}_\d{2}\.geojson$/));
  archivosGeoJSON.sort().reverse();
  const archivoAnterior = archivosGeoJSON.length > 0 ? archivosGeoJSON[0] : null;
  
  const desaparecidos = [];
  const aparecidos = [];
  
  for (const zona of ZONAS) {
    try {
      console.log(`\n📥 ZONA ${zona}`);
      const response = await fetch(URLS[zona]);
      const buffer = await response.buffer();
      const zipPath = path.join(dataDir, `temp_${zona}.zip`);
      await fs.writeFile(zipPath, buffer);
      
      const zip = new AdmZip(zipPath);
      const extractPath = path.join(dataDir, `extract_${zona}`);
      await fs.ensureDir(extractPath);
      zip.extractAllTo(extractPath, true);
      
      const files = await fs.readdir(extractPath);
      const shpFile = files.find(f => f.endsWith('.shp'));
      const dbfFile = files.find(f => f.endsWith('.dbf'));
      
      const source = await shapefile.open(path.join(extractPath, shpFile), path.join(extractPath, dbfFile), { encoding: 'latin1' });
      
      const features = [];
      let result;
      while (!(result = await source.read()).done) {
        const f = result.value;
        features.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            CODIGOU: corregirCaracteres(f.properties.CODIGOU || ''),
            FEC_DENU: corregirCaracteres(f.properties.FEC_DENU || ''),
            CONCESION: corregirCaracteres(f.properties.CONCESION || ''),
            TIT_CONCES: corregirCaracteres(f.properties.TIT_CONCES || '')
          }
        });
      }
      
      const nombreArchivo = `${zona.toLowerCase()}_${fechaStr}_${horaActual}.geojson`;
      await fs.writeJson(path.join(dataDir, nombreArchivo), { type: 'FeatureCollection', features });
      
      await fs.remove(zipPath);
      await fs.remove(extractPath);
      console.log(`✅ ${nombreArchivo} (${features.length} features)`);
      
      // Detectar cambios
      if (archivoAnterior) {
        const anteriorPath = path.join(dataDir, archivoAnterior);
        if (await fs.pathExists(anteriorPath)) {
          const anteriorData = await fs.readJson(anteriorPath);
          const codigosActual = new Set(features.map(f => f.properties.CODIGOU));
          const codigosAnterior = new Set(anteriorData.features.map(f => f.properties.CODIGOU));
          
          for (const codigo of codigosAnterior) {
            if (!codigosActual.has(codigo)) {
              const f = anteriorData.features.find(f => f.properties.CODIGOU === codigo);
              if (f) desaparecidos.push(f);
            }
          }
          for (const codigo of codigosActual) {
            if (!codigosAnterior.has(codigo)) {
              const f = features.find(f => f.properties.CODIGOU === codigo);
              if (f) aparecidos.push(f);
            }
          }
        }
      }
      
    } catch (error) {
      console.error(`Error ${zona}:`, error.message);
    }
  }
  
  // Guardar archivos mensuales
  const mes = (fechaHoy.getMonth() + 1).toString().padStart(2, '0');
  const anio = fechaHoy.getFullYear();
  
  if (desaparecidos.length > 0) {
    await fs.writeJson(path.join(dataDir, `desaparecidos_${mes}_${anio}.geojson`), 
      { type: 'FeatureCollection', features: desaparecidos });
    console.log(`📁 Desaparecidos: ${desaparecidos.length}`);
  }
  if (aparecidos.length > 0) {
    await fs.writeJson(path.join(dataDir, `aparecidos_${mes}_${anio}.geojson`), 
      { type: 'FeatureCollection', features: aparecidos });
    console.log(`📁 Aparecidos: ${aparecidos.length}`);
  }
  
  // Guardar cambios.json
  const cambiosPath = path.join(dataDir, 'cambios.json');
  let cambiosExistentes = [];
  if (await fs.pathExists(cambiosPath)) {
    cambiosExistentes = await fs.readJson(cambiosPath);
  }
  
  const nuevosCambios = [...desaparecidos, ...aparecidos].map(c => ({
    fecha: `${fechaStr}_${horaActual}`,
    codigo: c.properties.CODIGOU,
    nombre: c.properties.CONCESION,
    tipo: desaparecidos.includes(c) ? 'desaparece' : 'aparece'
  }));
  
  const cambiosActualizados = [...nuevosCambios, ...cambiosExistentes].slice(0, 500);
  await fs.writeJson(cambiosPath, cambiosActualizados, { spaces: 2 });
  
  console.log(`\n📊 Cambios: ${desaparecidos.length} desaparecidos, ${aparecidos.length} aparecidos`);
  
  // Enviar correo con el resumen
  await enviarResumenCambios(desaparecidos, aparecidos, fechaStr);
  
  console.log('🎉 Proceso completado');
}

descargarYProcesar();