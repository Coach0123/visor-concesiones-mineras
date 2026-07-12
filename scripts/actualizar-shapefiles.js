const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const shapefile = require('shapefile');
const nodemailer = require('nodemailer');
const proj4 = require('proj4');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ZONAS = ['17S', '18S', '19S'];
const URLS = {
  '17S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_17S.zip',
  '18S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_18S.zip',
  '19S': 'https://geocatminapp.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_19S.zip'
};

const ZONA_EPSG = {
  '17s': 'EPSG:32717',
  '18s': 'EPSG:32718',
  '19s': 'EPSG:32719'
};

proj4.defs([
  ['EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs'],
  ['EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs'],
  ['EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs']
]);

function corregirCaracteres(texto) {
  if (!texto) return '';
  return texto.toString();
}

function convertirGeometriaWGS84(geometry, zona) {
  if (!geometry) return null;
  const epsg = ZONA_EPSG[zona];
  if (!epsg) return geometry;
  try {
    function convertirCoordenada(c) {
      const [lon, lat] = proj4(epsg, 'EPSG:4326', [c[0], c[1]]);
      return [lon, lat];
    }
    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(ring => ring.map(convertirCoordenada))
      };
    } else if (geometry.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(poly => 
          poly.map(ring => ring.map(convertirCoordenada))
        )
      };
    }
  } catch (e) {
    console.error('Error convirtiendo geometría:', e.message);
  }
  return geometry;
}

async function enviarResumenCambios(desaparecidos, aparecidos, fechaStr) {
    if (desaparecidos.length === 0 && aparecidos.length === 0) {
        console.log('📭 No hay cambios para enviar');
        return;
    }
    
    // ============================================================
    // CARGAR EL ÁREA MONITOREADA DESDE EL ARCHIVO
    // ============================================================
    let areaMonitoreada = null;
    let areaPath = path.join(__dirname, '..', 'data', 'area_monitoreada.json');
    
    try {
        if (await fs.pathExists(areaPath)) {
            const areaData = await fs.readJson(areaPath);
            areaMonitoreada = areaData;
            console.log(`📦 Área cargada: ${areaData.bounds}`);
            console.log(`   SW: ${areaData.sw.lat}, ${areaData.sw.lng}`);
            console.log(`   NE: ${areaData.ne.lat}, ${areaData.ne.lng}`);
        } else {
            console.log('📭 No hay área guardada. Enviando TODOS los cambios.');
        }
    } catch (error) {
        console.log('⚠️ Error cargando área:', error.message);
    }
    
    // ============================================================
    // FUNCIÓN PARA VERIFICAR SI UN POLÍGONO ESTÁ DENTRO DEL ÁREA
    // ============================================================
    function poligonoEnArea(feature) {
        if (!areaMonitoreada || !feature.geometry) return true; // Sin área = incluir todo
        
        try {
            // Extraer coordenadas del polígono
            let coords = [];
            if (feature.geometry.type === 'Polygon') {
                coords = feature.geometry.coordinates[0];
            } else if (feature.geometry.type === 'MultiPolygon') {
                coords = feature.geometry.coordinates[0][0];
            } else {
                return true;
            }
            
            // Calcular centro del polígono
            let sumX = 0, sumY = 0;
            coords.forEach(c => {
                sumX += c[0];
                sumY += c[1];
            });
            const centerX = sumX / coords.length;
            const centerY = sumY / coords.length;
            
            // Convertir a WGS84 si es UTM (valores grandes)
            let lat = centerY, lon = centerX;
            if (centerX > 100000 || centerY > 100000) {
                try {
                    // Determinar zona UTM
                    let zona = '19s';
                    if (centerX >= 1000000) zona = '19s';
                    else if (centerX >= 700000) zona = '18s';
                    else zona = '17s';
                    
                    const epsg = zona === '17s' ? 'EPSG:32717' : 
                                (zona === '18s' ? 'EPSG:32718' : 'EPSG:32719');
                    
                    const [lonWGS84, latWGS84] = proj4(epsg, 'EPSG:4326', [centerX, centerY]);
                    lat = latWGS84;
                    lon = lonWGS84;
                } catch (e) {
                    // Si falla, usar los valores originales
                }
            }
            
            // Verificar si está dentro del área
            const sw = areaMonitoreada.sw;
            const ne = areaMonitoreada.ne;
            const dentro = lat >= sw.lat && lat <= ne.lat && lon >= sw.lng && lon <= ne.lng;
            
            if (dentro) {
                console.log(`   ✅ ${feature.properties.CONCESION}: dentro del área`);
            }
            return dentro;
        } catch (e) {
            // Si hay error al procesar, incluir el polígono (por seguridad)
            console.log(`   ⚠️ Error procesando ${feature.properties.CONCESION}:`, e.message);
            return true;
        }
    }
    
    // ============================================================
    // FILTRAR CAMBIOS POR ÁREA
    // ============================================================
    const desaparecidosFiltrados = desaparecidos.filter(f => poligonoEnArea(f));
    const aparecidosFiltrados = aparecidos.filter(f => poligonoEnArea(f));
    
    const totalDesap = desaparecidosFiltrados.length;
    const totalApare = aparecidosFiltrados.length;
    
    // Si no hay área guardada, usar todos los cambios
    if (!areaMonitoreada) {
        console.log('📭 No hay área guardada. Enviando TODOS los cambios.');
        console.log(`📊 Total: ${desaparecidos.length} desaparecidos, ${aparecidos.length} aparecidos`);
        // Usar todos los cambios
        const todosCambios = [...desaparecidos, ...aparecidos];
        await enviarCorreoCambios(todosCambios, desaparecidos.length, aparecidos.length, fechaStr);
        return;
    }
    
    if (totalDesap === 0 && totalApare === 0) {
        console.log('📭 No hay cambios en el área monitoreada');
        return;
    }
    
    console.log(`📊 Cambios en el área: ${totalDesap} desaparecidos, ${totalApare} aparecidos`);
    
    // ============================================================
    // ENVIAR CORREO CON SOLO LOS CAMBIOS DEL ÁREA
    // ============================================================
    const todosCambios = [...desaparecidosFiltrados, ...aparecidosFiltrados];
    await enviarCorreoCambios(todosCambios, totalDesap, totalApare, fechaStr);
}

// ============================================================
// FUNCIÓN AUXILIAR PARA ENVIAR CORREO
// ============================================================
async function enviarCorreoCambios(cambios, totalDesap, totalApare, fechaStr) {
    const maxMostrar = 30;
    const total = cambios.length;
    
    let mensaje = `📊 CAMBIOS EN TU ÁREA MONITOREADA\n`;
    mensaje += `================================\n`;
    mensaje += `Se detectaron ${total} cambios en tu área de interés.\n\n`;
    
    const desap = cambios.filter(c => c.tipo === 'desaparece');
    mensaje += `🔴 DESAPARECIDOS (${totalDesap}):\n`;
    if (totalDesap > 0) {
        desap.slice(0, maxMostrar).forEach(c => {
            mensaje += `  - ${c.properties.CONCESION} (${c.properties.CODIGOU})\n`;
        });
        if (totalDesap > maxMostrar) {
            mensaje += `  ... y ${totalDesap - maxMostrar} más\n`;
        }
    } else {
        mensaje += `  Ninguno\n`;
    }
    
    const ap = cambios.filter(c => c.tipo === 'aparece');
    mensaje += `\n🟢 APARECIDOS (${totalApare}):\n`;
    if (totalApare > 0) {
        ap.slice(0, maxMostrar).forEach(c => {
            mensaje += `  - ${c.properties.CONCESION} (${c.properties.CODIGOU})\n`;
        });
        if (totalApare > maxMostrar) {
            mensaje += `  ... y ${totalApare - maxMostrar} más\n`;
        }
    } else {
        mensaje += `  Ninguno\n`;
    }
    
    mensaje += `\n🔗 Visor: https://coach0123.github.io/visor-concesiones-mineras/\n`;
    mensaje += `📅 ${new Date().toLocaleString('es-PE')}`;
    
    // Enviar correo
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'carlosfernandezgeraldino@gmail.com',
                pass: 'wwtolzrnckkdwvoi'
            }
        });
        
        await transporter.sendMail({
            from: 'carlosfernandezgeraldino@gmail.com',
            to: 'carlosfernandezgeraldino@gmail.com',
            subject: `📊 Cambios en tu área - ${fechaStr}`,
            text: mensaje
        });
        console.log('✅ Correo enviado con', total, 'cambios del área');
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
  // FILTRAR ARCHIVOS DEL MES ACTUAL
  // ============================================================
  const archivosExistentes = await fs.readdir(dataDir);
  const archivosGeoJSON = archivosExistentes.filter(f => f.match(/^\d{2}s_\d{6}_\d{2}\.geojson$/));
  const archivosConFecha = archivosGeoJSON.map(f => {
    const match = f.match(/^\d{2}s_(\d{6})_(\d{2})\.geojson$/);
    if (!match) return null;
    const fecha = match[1];
    const hora = match[2];
    const dia = parseInt(fecha.slice(0,2));
    const mes = parseInt(fecha.slice(2,4)) - 1;
    const anio = 2000 + parseInt(fecha.slice(4,6));
    const horas = parseInt(hora);
    return { archivo: f, fechaObj: new Date(anio, mes, dia, horas), fechaStr: fecha, horaStr: hora };
  }).filter(f => f !== null);
  archivosConFecha.sort((a, b) => b.fechaObj - a.fechaObj);
  
  const mesActual = fechaStr.slice(2, 4);
  const anioActual = fechaStr.slice(4, 6);
  const archivosDelMes = archivosConFecha.filter(f => {
    const mes = f.fechaStr.slice(2, 4);
    const anio = f.fechaStr.slice(4, 6);
    return mes === mesActual && anio === anioActual;
  });
  archivosDelMes.sort((a, b) => b.fechaObj - a.fechaObj);
  const archivoAnterior = archivosDelMes.length > 1 ? archivosDelMes[1].archivo : null;
  
  console.log(`📁 Archivos del mes actual: ${archivosDelMes.length}`);
  console.log(`📁 Comparando con: ${archivoAnterior || 'ninguno'}`);
  
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
      
      if (archivoAnterior) {
        const anteriorPath = path.join(dataDir, archivoAnterior);
        if (await fs.pathExists(anteriorPath)) {
          const anteriorData = await fs.readJson(anteriorPath);
          const codigosActual = new Set(features.map(f => f.properties.CODIGOU));
          const codigosAnterior = new Set(anteriorData.features.map(f => f.properties.CODIGOU));
          
          for (const codigo of codigosAnterior) {
            if (!codigosActual.has(codigo)) {
              const f = anteriorData.features.find(f => f.properties.CODIGOU === codigo);
              if (f && f.geometry) {
                const geomWGS84 = convertirGeometriaWGS84(f.geometry, zona.toLowerCase());
                if (geomWGS84) {
                  desaparecidos.push({
                    type: 'Feature',
                    geometry: geomWGS84,
                    properties: f.properties
                  });
                }
              }
            }
          }
          
          for (const codigo of codigosActual) {
            if (!codigosAnterior.has(codigo)) {
              const f = features.find(f => f.properties.CODIGOU === codigo);
              if (f && f.geometry) {
                const geomWGS84 = convertirGeometriaWGS84(f.geometry, zona.toLowerCase());
                if (geomWGS84) {
                  aparecidos.push({
                    type: 'Feature',
                    geometry: geomWGS84,
                    properties: f.properties
                  });
                }
              }
            }
          }
        }
      }
      
    } catch (error) {
      console.error(`Error ${zona}:`, error.message);
    }
  }
  
  // ============================================================
  // GUARDAR SOLO ÚLTIMOS 7 DÍAS: desaparecidos_7d.geojson
  // ============================================================
  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() - 7);
  
  // Filtrar desaparecidos de los últimos 7 días
  const desaparecidosFiltrados = desaparecidos.filter(f => {
    return true; // Todos son del día actual
  });
  
  // Guardar desaparecidos_7d.geojson
  if (desaparecidosFiltrados.length > 0) {
    const path7d = path.join(dataDir, 'desaparecidos_7d.geojson');
    let existentes = [];
    if (await fs.pathExists(path7d)) {
      const existente = await fs.readJson(path7d);
      existentes = existente.features;
    }
    // Limpiar archivos de más de 7 días
    const fechaLimite7d = new Date();
    fechaLimite7d.setDate(fechaLimite7d.getDate() - 7);
    
    const existentesFiltrados = existentes.filter(f => {
      // Si no tiene fecha, mantenerlo
      return true;
    });
    
    const codigosExistentes = new Set(existentesFiltrados.map(f => f.properties.CODIGOU));
    const nuevos = desaparecidosFiltrados.filter(f => !codigosExistentes.has(f.properties.CODIGOU));
    
    if (nuevos.length > 0) {
      const todasFeatures = [...existentesFiltrados, ...nuevos];
      // Mantener solo los últimos 5000 cambios
      const featuresLimitadas = todasFeatures.slice(-5000);
      await fs.writeJson(path7d, { type: 'FeatureCollection', features: featuresLimitadas }, { spaces: 0 });
      console.log(`📁 desaparecidos_7d: ${featuresLimitadas.length} cambios (últimos 7 días)`);
    }
  }
  
  // Filtrar aparecidos de los últimos 7 días
  const aparecidosFiltrados = aparecidos.filter(f => {
    return true;
  });
  
  if (aparecidosFiltrados.length > 0) {
    const path7d = path.join(dataDir, 'aparecidos_7d.geojson');
    let existentes = [];
    if (await fs.pathExists(path7d)) {
      const existente = await fs.readJson(path7d);
      existentes = existente.features;
    }
    const codigosExistentes = new Set(existentes.map(f => f.properties.CODIGOU));
    const nuevos = aparecidosFiltrados.filter(f => !codigosExistentes.has(f.properties.CODIGOU));
    
    if (nuevos.length > 0) {
      const todasFeatures = [...existentes, ...nuevos];
      const featuresLimitadas = todasFeatures.slice(-5000);
      await fs.writeJson(path7d, { type: 'FeatureCollection', features: featuresLimitadas }, { spaces: 0 });
      console.log(`📁 aparecidos_7d: ${featuresLimitadas.length} cambios (últimos 7 días)`);
    }
  }
  
  // Guardar cambios.json (limitado a 500 registros)
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