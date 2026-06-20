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
    
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'carlosfernandezgeraldino@gmail.com',
            pass: 'wwtolzrnckkdwvoi'
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
  
  // ============================================================
  // CAMBIO 1: Ordenar archivos por FECHA REAL (no alfabético)
  // ============================================================
  const archivosExistentes = await fs.readdir(dataDir);
  const archivosGeoJSON = archivosExistentes.filter(f => f.match(/^\d{2}s_\d{6}_\d{2}\.geojson$/));
  
  // Extraer fecha y ordenar cronológicamente
  const archivosConFecha = archivosGeoJSON.map(f => {
    const match = f.match(/^\d{2}s_(\d{6})_(\d{2})\.geojson$/);
    if (!match) return null;
    const fecha = match[1]; // DDMMYY
    const hora = match[2];
    // Convertir a objeto Date para ordenar
    const dia = parseInt(fecha.slice(0,2));
    const mes = parseInt(fecha.slice(2,4)) - 1;
    const anio = 2000 + parseInt(fecha.slice(4,6));
    const horas = parseInt(hora);
    return { archivo: f, fechaObj: new Date(anio, mes, dia, horas), fechaStr: fecha, horaStr: hora };
  }).filter(f => f !== null);
  
  // Ordenar por fecha (más reciente primero)
  archivosConFecha.sort((a, b) => b.fechaObj - a.fechaObj);
  
  const archivoAnterior = archivosConFecha.length > 1 ? archivosConFecha[1].archivo : null;
  const archivoActual = archivosConFecha.length > 0 ? archivosConFecha[0].archivo : null;
  
  console.log(`📁 Archivo actual: ${archivoActual}`);
  console.log(`📁 Archivo anterior para comparar: ${archivoAnterior || 'ninguno'}`);
  
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
      
      // ============================================================
      // CAMBIO 2: Comparar con el archivo anterior REAL (no el primero de la lista)
      // ============================================================
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
  
  // Guardar archivos mensuales con la fecha del cambio
  const mes = (fechaHoy.getMonth() + 1).toString().padStart(2, '0');
  const anio = fechaHoy.getFullYear();
  
  if (desaparecidos.length > 0) {
    // ============================================================
    // CAMBIO 3: Guardar con la fecha del cambio (no sobrescribir)
    // ============================================================
    const desaparecidosPath = path.join(dataDir, `desaparecidos_${mes}_${anio}.geojson`);
    let existentes = [];
    if (await fs.pathExists(desaparecidosPath)) {
      const existente = await fs.readJson(desaparecidosPath);
      existentes = existente.features;
    }
    
    // Evitar duplicados (mismo CODIGOU)
    const codigosExistentes = new Set(existentes.map(f => f.properties.CODIGOU));
    const nuevos = desaparecidos.filter(f => !codigosExistentes.has(f.properties.CODIGOU));
    
    if (nuevos.length > 0) {
      const todasFeatures = [...existentes, ...nuevos];
      await fs.writeJson(desaparecidosPath, { type: 'FeatureCollection', features: todasFeatures }, { spaces: 2 });
      console.log(`📁 Desaparecidos: +${nuevos.length} (total: ${todasFeatures.length})`);
    }
  }
  
  if (aparecidos.length > 0) {
    const aparecidosPath = path.join(dataDir, `aparecidos_${mes}_${anio}.geojson`);
    let existentes = [];
    if (await fs.pathExists(aparecidosPath)) {
      const existente = await fs.readJson(aparecidosPath);
      existentes = existente.features;
    }
    
    const codigosExistentes = new Set(existentes.map(f => f.properties.CODIGOU));
    const nuevos = aparecidos.filter(f => !codigosExistentes.has(f.properties.CODIGOU));
    
    if (nuevos.length > 0) {
      const todasFeatures = [...existentes, ...nuevos];
      await fs.writeJson(aparecidosPath, { type: 'FeatureCollection', features: todasFeatures }, { spaces: 2 });
      console.log(`📁 Aparecidos: +${nuevos.length} (total: ${todasFeatures.length})`);
    }
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
  
  await enviarResumenCambios(desaparecidos, aparecidos, fechaStr);
  
  console.log('🎉 Proceso completado');
}

descargarYProcesar();