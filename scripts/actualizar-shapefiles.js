const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const nodemailer = require('nodemailer');
const proj4 = require('proj4');

// Definir proyecciones UTM
proj4.defs([
    ['EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs']
]);

// Configuración
const DATA_DIR = path.join(__dirname, '..', 'data');
const CAMBIOS_FILE = path.join(DATA_DIR, 'cambios.json');
const LIMPIEZA_FILE = path.join(DATA_DIR, 'ultima_limpieza.json');
const AREA_FILE = path.join(DATA_DIR, 'area_monitoreada.json');

// ============================================================
// FUNCIÓN: Verificar si hay que limpiar cambios (cada 10 días)
// ============================================================
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

// ============================================================
// FUNCIÓN: Convertir UTM a WGS84
// ============================================================
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

// ============================================================
// FUNCIÓN: Verificar si un polígono está dentro del área
// ============================================================
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

// ============================================================
// FUNCIÓN: Obtener el archivo más reciente para cada zona
// ============================================================
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

// ============================================================
// FUNCIÓN: Obtener archivo de hace 1 día (para comparar)
// ============================================================
async function obtenerArchivoDiaAnterior(zona, fechaActual, horaActual) {
    const fecha = new Date();
    const diaActual = parseInt(fechaActual.slice(0, 2));
    const mesActual = parseInt(fechaActual.slice(2, 4));
    const anioActual = 2000 + parseInt(fechaActual.slice(4, 6));
    
    const fechaObj = new Date(anioActual, mesActual - 1, diaActual);
    fechaObj.setDate(fechaObj.getDate() - 1);
    
    const d = fechaObj.getDate().toString().padStart(2, '0');
    const m = (fechaObj.getMonth() + 1).toString().padStart(2, '0');
    const a = fechaObj.getFullYear().toString().slice(-2);
    const fechaStr = `${d}${m}${a}`;
    
    const filePath = path.join(DATA_DIR, `${zona}_${fechaStr}_21.geojson`);
    if (await fs.pathExists(filePath)) {
        return { fecha: fechaStr, hora: '21', filePath };
    }
    return null;
}

// ============================================================
// FUNCIÓN: Comparar dos archivos y detectar cambios
// ============================================================
async function compararArchivos(archivoActual, archivoAnterior, areaMonitoreada) {
    const dataActual = await fs.readJson(archivoActual.filePath);
    const dataAnterior = await fs.readJson(archivoAnterior.filePath);
    
    const setAnterior = new Set();
    dataAnterior.features.forEach(f => {
        setAnterior.add(String(f.properties.CODIGOU).trim());
    });
    
    const desaparecidos = [];
    const aparecidos = [];
    
    dataAnterior.features.forEach(f => {
        const codigo = String(f.properties.CODIGOU).trim();
        if (!dataActual.features.find(g => String(g.properties.CODIGOU).trim() === codigo)) {
            if (poligonoEnArea(f, areaMonitoreada)) {
                desaparecidos.push(f);
            }
        }
    });
    
    dataActual.features.forEach(f => {
        const codigo = String(f.properties.CODIGOU).trim();
        if (!dataAnterior.features.find(g => String(g.properties.CODIGOU).trim() === codigo)) {
            if (poligonoEnArea(f, areaMonitoreada)) {
                aparecidos.push(f);
            }
        }
    });
    
    return { desaparecidos, aparecidos };
}

// ============================================================
// FUNCIÓN: Enviar correo con los cambios
// ============================================================
async function enviarCorreoCambios(desaparecidos, aparecidos, fechaStr) {
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

// ============================================================
// FUNCIÓN: Guardar cambios en archivo JSON
// ============================================================
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

// ============================================================
// FUNCIÓN PRINCIPAL
// ============================================================
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
    
    // ============================================================
    // 4. GUARDAR CAMBIOS EN JSON (solo si hay cambios)
    // ============================================================
    if (todosDesaparecidos.length > 0 || todosAparecidos.length > 0) {
        await guardarCambiosJSON(todosDesaparecidos, todosAparecidos);
    } else {
        console.log('📭 Sin cambios, pero se enviará correo con 0 cambios');
    }
    
    // ============================================================
    // 5. ENVIAR CORREO SIEMPRE (incluso con 0 cambios)
    // ============================================================
    const fechaStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await enviarCorreoCambios(todosDesaparecidos, todosAparecidos, fechaStr);
    
    console.log('🎉 Proceso completado');
}

// ============================================================
// EJECUTAR
// ============================================================
main().catch(console.error);