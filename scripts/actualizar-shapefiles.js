const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const nodemailer = require('nodemailer');
const proj4 = require('proj4');

proj4.defs([
    ['EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs']
]);

const DATA_DIR = path.join(__dirname, '..', 'data');
const CAMBIOS_FILE = path.join(DATA_DIR, 'cambios.json');
const LIMPIEZA_FILE = path.join(DATA_DIR, 'ultima_limpieza.json');
const AREA_FILE = path.join(DATA_DIR, 'area_monitoreada.json');
const INFORMES_DIR = path.join(DATA_DIR, 'informes');

async function verificarYLimpiarCambios() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    let ultimaLimpieza = null;
    try {
        if (await fs.pathExists(LIMPIEZA_FILE)) {
            const data = await fs.readJson(LIMPIEZA_FILE);
            ultimaLimpieza = new Date(data.fecha);
            ultimaLimpieza.setHours(0, 0, 0, 0);
        }
    } catch (e) {}
    
    if (!ultimaLimpieza) {
        await fs.writeJson(LIMPIEZA_FILE, { fecha: hoy.toISOString() });
        return false;
    }
    
    const diffTime = Math.abs(hoy - ultimaLimpieza);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 10) {
        console.log(`🧹 Han pasado ${diffDays} días desde la última limpieza. Reiniciando cambios...`);
        await fs.writeJson(CAMBIOS_FILE, []);
        await fs.writeJson(LIMPIEZA_FILE, { fecha: hoy.toISOString() });
        return true;
    }
    
    console.log(`📅 Última limpieza: hace ${diffDays} días (máximo 10)`);
    return false;
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
        const wgs84 = proj4(projSrc, 'EPSG:4326', [x, y]);
        return [wgs84[1], wgs84[0]];
    } catch (e) {
        return [y, x];
    }
}

function poligonoEnArea(feature, areaMonitoreada) {
    if (!areaMonitoreada || !feature.geometry) return true;
    
    try {
        let coords = [];
        if (feature.geometry.type === 'Polygon') {
            coords = feature.geometry.coordinates[0];
        } else if (feature.geometry.type === 'MultiPolygon') {
            coords = feature.geometry.coordinates[0][0];
        } else {
            return true;
        }
        
        let sumX = 0, sumY = 0;
        coords.forEach(c => {
            sumX += c[0];
            sumY += c[1];
        });
        const centerX = sumX / coords.length;
        const centerY = sumY / coords.length;
        
        let lat = centerY, lon = centerX;
        if (centerX > 100000 || centerY > 100000) {
            let zona = '18s';
            if (centerX >= 1000000) zona = '19s';
            else if (centerX >= 700000) zona = '18s';
            else zona = '17s';
            
            const [latWGS, lonWGS] = convertirUTM_A_WGS84(centerX, centerY, zona);
            lat = latWGS;
            lon = lonWGS;
        }
        
        const sw = areaMonitoreada.sw;
        const ne = areaMonitoreada.ne;
        return lat >= sw.lat && lat <= ne.lat && lon >= sw.lng && lon <= ne.lng;
    } catch (e) {
        return true;
    }
}

async function obtenerArchivoMasReciente(zona) {
    const hoy = new Date();
    const fechas = [];
    for (let i = 0; i < 10; i++) {
        const fecha = new Date(hoy);
        fecha.setDate(fecha.getDate() - i);
        const d = fecha.getDate().toString().padStart(2, '0');
        const m = (fecha.getMonth() + 1).toString().padStart(2, '0');
        const a = fecha.getFullYear().toString().slice(-2);
        fechas.push(`${d}${m}${a}`);
    }
    
    for (const fecha of fechas) {
        const filePath = path.join(DATA_DIR, `${zona}_${fecha}_21.geojson`);
        if (await fs.pathExists(filePath)) {
            return { fecha, hora: '21', filePath };
        }
    }
    return null;
}

async function obtenerArchivoDiaAnterior(zona, fechaActual, horaActual) {
    const diaActual = parseInt(fechaActual.slice(0, 2));
    const mesActual = parseInt(fechaActual.slice(2, 4));
    const anioActual = 2000 + parseInt(fechaActual.slice(4, 6));
    
    const fechaObj = new Date(anioActual, mesActual - 1, diaActual);
    
    for (let i = 1; i <= 10; i++) {
        fechaObj.setDate(fechaObj.getDate() - 1);
        
        const d = fechaObj.getDate().toString().padStart(2, '0');
        const m = (fechaObj.getMonth() + 1).toString().padStart(2, '0');
        const a = fechaObj.getFullYear().toString().slice(-2);
        const fechaStr = `${d}${m}${a}`;
        
        const filePath = path.join(DATA_DIR, `${zona}_${fechaStr}_21.geojson`);
        if (await fs.pathExists(filePath)) {
            console.log(`   ✅ Encontrado archivo anterior: ${fechaStr}_21 (${i} día(s) atrás)`);
            return { fecha: fechaStr, hora: '21', filePath };
        }
    }
    
    console.log(`   ⚠️ No se encontró archivo anterior para ${zona} (buscó hasta 10 días)`);
    return null;
}

async function compararArchivos(archivoActual, archivoAnterior, areaMonitoreada) {
    const dataActual = await fs.readJson(archivoActual.filePath);
    const dataAnterior = await fs.readJson(archivoAnterior.filePath);
    
    console.log(`   📁 Actual: ${dataActual.features.length} features`);
    console.log(`   📁 Anterior: ${dataAnterior.features.length} features`);
    
    const codigosActual = new Set();
    dataActual.features.forEach(f => {
        codigosActual.add(String(f.properties.CODIGOU).trim());
    });
    
    const codigosAnterior = new Set();
    dataAnterior.features.forEach(f => {
        codigosAnterior.add(String(f.properties.CODIGOU).trim());
    });
    
    console.log(`   📊 Códigos únicos Actual: ${codigosActual.size}`);
    console.log(`   📊 Códigos únicos Anterior: ${codigosAnterior.size}`);
    
    const desaparecidos = [];
    const aparecidos = [];
    
    dataAnterior.features.forEach(f => {
        const codigo = String(f.properties.CODIGOU).trim();
        if (!codigosActual.has(codigo)) {
            if (poligonoEnArea(f, areaMonitoreada)) {
                desaparecidos.push(f);
            }
        }
    });
    
    dataActual.features.forEach(f => {
        const codigo = String(f.properties.CODIGOU).trim();
        if (!codigosAnterior.has(codigo)) {
            if (poligonoEnArea(f, areaMonitoreada)) {
                aparecidos.push(f);
            }
        }
    });
    
    console.log(`   🔴 Desaparecidos en área: ${desaparecidos.length}`);
    console.log(`   🟢 Aparecidos en área: ${aparecidos.length}`);
    
    return { desaparecidos, aparecidos };
}

async function generarInformeHTML(desaparecidos, aparecidos, areaMonitoreada, fechaStr) {
    try {
        await fs.ensureDir(INFORMES_DIR);
        
        const convertirFeature = (f) => ({
            type: 'Feature',
            properties: f.properties,
            geometry: f.geometry
        });
        
        const fechaLegible = new Date().toLocaleDateString('es-PE', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
        
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wvisor - Informe ${fechaStr}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a1628; color: #e0e6f0; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; background: #0f1e3a; border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.5); overflow: hidden; border: 1px solid #1e3a5f; }
        .header { background: linear-gradient(135deg, #1e3a8a, #1e40af); padding: 25px 30px; }
        .header-top { display: flex; align-items: center; gap: 15px; margin-bottom: 10px; }
        .logo-w { width: 45px; height: 45px; background: linear-gradient(135deg, #3b82f6, #1e40af); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; color: #fff; font-family: Georgia, serif; }
        .header h1 { font-size: 22px; font-weight: 600; color: #fff; }
        .subtitle { font-size: 13px; color: #93c5fd; margin-bottom: 15px; }
        .stats { display: flex; gap: 12px; flex-wrap: wrap; }
        .stat-item { background: rgba(255,255,255,0.12); padding: 10px 18px; border-radius: 8px; font-size: 12px; color: #bfdbfe; }
        .stat-item strong { font-size: 20px; display: block; color: #fff; }
        .stat-item.danger { background: rgba(220, 38, 38, 0.3); }
        .stat-item.danger strong { color: #fca5a5; }
        .stat-item.success { background: rgba(59, 130, 246, 0.3); }
        .stat-item.success strong { color: #93c5fd; }
        .main-content { display: flex; flex-wrap: wrap; }
        .map-column { flex: 2; min-width: 500px; padding: 20px; background: #0a1628; }
        #map { border-radius: 8px; height: 550px; width: 100%; border: 1px solid #1e3a5f; }
        .info-column { flex: 1; min-width: 320px; padding: 20px; background: #0f1e3a; border-left: 1px solid #1e3a5f; max-height: 600px; overflow-y: auto; }
        .info-column h2 { font-size: 16px; margin-bottom: 15px; color: #93c5fd; padding-bottom: 8px; border-bottom: 1px solid #1e3a5f; }
        .item-concesion { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 12px; border-bottom: 1px solid #1e3a5f; }
        .estado-badge { font-size: 10px; padding: 3px 8px; border-radius: 10px; color: white; font-weight: 600; }
        .estado-badge.desaparecio { background: #dc2626; }
        .estado-badge.aparecio { background: #2563eb; }
        .tabla-container { padding: 20px 30px 30px; border-top: 1px solid #1e3a5f; }
        .tabla-container h2 { font-size: 16px; margin-bottom: 15px; color: #93c5fd; }
        .tabla-concesiones { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tabla-concesiones thead th { background: #152b4a; padding: 12px 15px; text-align: left; color: #93c5fd; border-bottom: 2px solid #1e3a5f; }
        .tabla-concesiones tbody td { padding: 10px 15px; border-bottom: 1px solid #1e3a5f; color: #cbd5e1; }
        .footer { background: #0a1628; padding: 15px 30px; text-align: center; font-size: 11px; color: #475569; border-top: 1px solid #1e3a5f; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <div class="logo-w">W</div>
                <h1>Wvisor - Informe de Área</h1>
            </div>
            <div class="subtitle">Generado el ${fechaLegible}</div>
            <div class="stats">
                <div class="stat-item danger"><strong>${desaparecidos.length}</strong>Desaparecieron</div>
                <div class="stat-item success"><strong>${aparecidos.length}</strong>Aparecieron</div>
                <div class="stat-item"><strong>${desaparecidos.length + aparecidos.length}</strong>Total</div>
            </div>
        </div>
        
        <div class="main-content">
            <div class="map-column">
                <div id="map"></div>
            </div>
            <div class="info-column">
                <h2>📋 Concesiones</h2>
                ${desaparecidos.map(f => `
                    <div class="item-concesion">
                        <span>${f.properties.CONCESION || 'N/A'}</span>
                        <span class="estado-badge desaparecio">DESAPARECIÓ</span>
                    </div>
                `).join('')}
                ${aparecidos.map(f => `
                    <div class="item-concesion">
                        <span>${f.properties.CONCESION || 'N/A'}</span>
                        <span class="estado-badge aparecio">APARECIÓ</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="tabla-container">
            <h2>📋 Detalle Completo</h2>
            <table class="tabla-concesiones">
                <thead>
                    <tr><th>Código</th><th>Concesión</th><th>Titular</th><th>Estado</th></tr>
                </thead>
                <tbody>
                    ${desaparecidos.map(f => `
                        <tr>
                            <td>${f.properties.CODIGOU || 'N/A'}</td>
                            <td>${f.properties.CONCESION || 'N/A'}</td>
                            <td>${f.properties.TIT_CONCES || 'N/A'}</td>
                            <td><span class="estado-badge desaparecio">DESAPARECIÓ</span></td>
                        </tr>
                    `).join('')}
                    ${aparecidos.map(f => `
                        <tr>
                            <td>${f.properties.CODIGOU || 'N/A'}</td>
                            <td>${f.properties.CONCESION || 'N/A'}</td>
                            <td>${f.properties.TIT_CONCES || 'N/A'}</td>
                            <td><span class="estado-badge aparecio">APARECIÓ</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="footer">Wvisor · Datos INGEMMET · ${fechaLegible}</div>
    </div>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.8.0/proj4.js"></script>
    <script>
        const areaData = ${JSON.stringify(areaMonitoreada)};
        const desaparecidosFeatures = ${JSON.stringify(desaparecidos.map(convertirFeature))};
        const aparecidosFeatures = ${JSON.stringify(aparecidos.map(convertirFeature))};
        
        const map = L.map('map').setView([
            (areaData.sw.lat + areaData.ne.lat) / 2,
            (areaData.sw.lng + areaData.ne.lng) / 2
        ], 10);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
        
        L.rectangle([
            [areaData.sw.lat, areaData.sw.lng],
            [areaData.ne.lat, areaData.ne.lng]
        ], { color: '#ff44ff', weight: 3, opacity: 0.8, fillOpacity: 0.1 }).addTo(map);
        
        L.geoJSON({ type: 'FeatureCollection', features: desaparecidosFeatures }, {
            style: { color: '#ff4444', weight: 2, opacity: 0.9, fillOpacity: 0.4 },
            onEachFeature: (f, l) => l.bindPopup('<b>' + (f.properties.CONCESION || 'N/A') + '</b><br>🔴 Desapareció')
        }).addTo(map);
        
        L.geoJSON({ type: 'FeatureCollection', features: aparecidosFeatures }, {
            style: { color: '#4444ff', weight: 2, opacity: 0.9, fillOpacity: 0.4 },
            onEachFeature: (f, l) => l.bindPopup('<b>' + (f.properties.CONCESION || 'N/A') + '</b><br>🔵 Apareció')
        }).addTo(map);
    </script>
</body>
</html>`;
        
        const nombreArchivo = `informe_${fechaStr}.html`;
        const rutaArchivo = path.join(INFORMES_DIR, nombreArchivo);
        await fs.writeFile(rutaArchivo, html, 'utf8');
        
        console.log(`📄 Informe HTML generado: ${rutaArchivo}`);
        
        const urlInforme = `https://coach0123.github.io/visor-concesiones-mineras/data/informes/${nombreArchivo}`;
        return urlInforme;
        
    } catch (error) {
        console.error('❌ Error generando informe:', error.message);
        return null;
    }
}

async function enviarCorreoCambios(desaparecidos, aparecidos, fechaStr, urlInforme) {
    const total = desaparecidos.length + aparecidos.length;
    
    const maxMostrar = 30;
    let mensaje = `📊 CAMBIOS EN TU ÁREA MONITOREADA\n`;
    mensaje += `================================\n`;
    
    if (total === 0) {
        mensaje += `📭 No se detectaron cambios en tu área de interés.\n`;
        mensaje += `✅ Todo permanece igual.\n\n`;
    } else {
        mensaje += `Se detectaron ${total} cambios en tu área de interés.\n\n`;
        
        mensaje += `🔴 DESAPARECIDOS (${desaparecidos.length}):\n`;
        if (desaparecidos.length > 0) {
            desaparecidos.slice(0, maxMostrar).forEach(f => {
                mensaje += `  - ${f.properties.CONCESION || 'N/A'} (${f.properties.CODIGOU || 'N/A'})\n`;
            });
            if (desaparecidos.length > maxMostrar) {
                mensaje += `  ... y ${desaparecidos.length - maxMostrar} más\n`;
            }
        } else {
            mensaje += `  Ninguno\n`;
        }
        
        mensaje += `\n🟢 APARECIDOS (${aparecidos.length}):\n`;
        if (aparecidos.length > 0) {
            aparecidos.slice(0, maxMostrar).forEach(f => {
                mensaje += `  - ${f.properties.CONCESION || 'N/A'} (${f.properties.CODIGOU || 'N/A'})\n`;
            });
            if (aparecidos.length > maxMostrar) {
                mensaje += `  ... y ${aparecidos.length - maxMostrar} más\n`;
            }
        } else {
            mensaje += `  Ninguno\n`;
        }
    }
    
    if (urlInforme) {
        mensaje += `\n📄 Ver informe completo en el mapa:\n${urlInforme}\n`;
    }
    
    mensaje += `\n🔗 Visor: https://coach0123.github.io/visor-concesiones-mineras/\n`;
    mensaje += `📅 ${new Date().toLocaleString('es-PE')}`;
    
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
        console.log(`✅ Correo enviado (${total} cambios)`);
    } catch (error) {
        console.error('❌ Error enviando correo:', error.message);
    }
}

async function guardarCambiosJSON(desaparecidos, aparecidos) {
    let cambiosExistentes = [];
    try {
        if (await fs.pathExists(CAMBIOS_FILE)) {
            cambiosExistentes = await fs.readJson(CAMBIOS_FILE);
        }
    } catch (e) {}
    
    const nuevosCambios = [];
    
    desaparecidos.forEach(f => {
        nuevosCambios.push({
            codigo: f.properties.CODIGOU,
            nombre: f.properties.CONCESION || 'N/A',
            tipo: 'desaparece',
            fecha: new Date().toISOString()
        });
    });
    
    aparecidos.forEach(f => {
        nuevosCambios.push({
            codigo: f.properties.CODIGOU,
            nombre: f.properties.CONCESION || 'N/A',
            tipo: 'aparece',
            fecha: new Date().toISOString()
        });
    });
    
    const codigosExistentes = new Set();
    cambiosExistentes.forEach(c => codigosExistentes.add(c.codigo));
    
    const cambiosFiltrados = nuevosCambios.filter(c => !codigosExistentes.has(c.codigo));
    const todosLosCambios = [...cambiosExistentes, ...cambiosFiltrados];
    
    await fs.writeJson(CAMBIOS_FILE, todosLosCambios, { spaces: 2 });
    console.log(`💾 Guardados ${cambiosFiltrados.length} nuevos cambios en cambios.json`);
}

async function main() {
    console.log('🚀 Iniciando actualización de shapefiles...');
    
    await verificarYLimpiarCambios();
    
    let areaMonitoreada = null;
    try {
        if (await fs.pathExists(AREA_FILE)) {
            areaMonitoreada = await fs.readJson(AREA_FILE);
            console.log(`📦 Área cargada: ${areaMonitoreada.bounds}`);
        } else {
            console.log('📭 No hay área guardada. Procesando TODOS los cambios.');
        }
    } catch (error) {
        console.log('⚠️ Error cargando área:', error.message);
    }
    
    const zonas = ['17s', '18s', '19s'];
    const todosDesaparecidos = [];
    const todosAparecidos = [];
    
    for (const zona of zonas) {
        console.log(`\n📥 Procesando zona ${zona}...`);
        
        const actual = await obtenerArchivoMasReciente(zona);
        if (!actual) {
            console.log(`⚠️ No se encontró archivo actual para zona ${zona}`);
            continue;
        }
        console.log(`   Actual: ${actual.fecha}_${actual.hora}`);
        
        const anterior = await obtenerArchivoDiaAnterior(zona, actual.fecha, actual.hora);
        if (!anterior) {
            console.log(`⚠️ No se encontró archivo anterior para zona ${zona}`);
            continue;
        }
        console.log(`   Anterior: ${anterior.fecha}_${anterior.hora}`);
        
        const { desaparecidos, aparecidos } = await compararArchivos(actual, anterior, areaMonitoreada);
        console.log(`   📊 Desaparecidos: ${desaparecidos.length}, Aparecidos: ${aparecidos.length}`);
        
        todosDesaparecidos.push(...desaparecidos);
        todosAparecidos.push(...aparecidos);
    }
    
    console.log(`\n📊 TOTAL: ${todosDesaparecidos.length} desaparecidos, ${todosAparecidos.length} aparecidos`);
    
    if (todosDesaparecidos.length > 0 || todosAparecidos.length > 0) {
        await guardarCambiosJSON(todosDesaparecidos, todosAparecidos);
    } else {
        console.log('📭 Sin cambios');
    }
    
    const fechaStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    
    let urlInforme = null;
    if (todosDesaparecidos.length > 0 || todosAparecidos.length > 0) {
        urlInforme = await generarInformeHTML(todosDesaparecidos, todosAparecidos, areaMonitoreada, fechaStr);
    }
    
    await enviarCorreoCambios(todosDesaparecidos, todosAparecidos, fechaStr, urlInforme);
    
    console.log('🎉 Proceso completado');
}

main().catch(console.error);