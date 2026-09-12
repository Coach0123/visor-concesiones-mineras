// ============================================================
// CONFIGURACIÓN DEL MAPA
// ============================================================
let map;
let capas = {};
let popupAbierto = false;
let todosLosDatos = [];
let datosHistoricos = [];
let rectanguloDibujo = null;
let capaDibujo = null;
let marcadorBusqueda;
let capaAreaInteres;
let areaMonitoreada = null;

// Corregir caracteres especiales
function corregirTexto(texto) {
    if (!texto || texto === 'N/A') return 'N/A';
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

// Proyecciones UTM
proj4.defs([
    ['EPSG:32717', '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32718', '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs'],
    ['EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs']
]);

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

const baseURL = window.location.hostname.includes('github.io') 
    ? '/visor-concesiones-mineras' 
    : '';

const fechaHoy = new Date();
const fechasUltimosDias = [];
for (let i = 0; i < 10; i++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    const d = fecha.getDate().toString().padStart(2, '0');
    const m = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const a = fecha.getFullYear().toString().slice(-2);
    fechasUltimosDias.push(`${d}${m}${a}`);
}

const zonas = ['17s', '18s', '19s'];

const COLORES = {
    SIN_CAMBIO: '#888888',
    APARECE: '#4444ff',
    DESAPARECE: '#ff4444'
};

// ============================================================
// INICIALIZAR MAPA
// ============================================================
function initMap() {
    console.log('🗺️ Inicializando mapa...');
    map = L.map('map').setView([-9.5, -75], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    cargarAreaMonitoreada();
    cargarDatos();
    cargarCambios();
}

// ============================================================
// CARGAR DATOS
// ============================================================
async function cargarDatos() {
    console.log('📥 Cargando datos...');
    let cambiosMap = new Map();
    try {
        const cambiosResponse = await fetch(`${baseURL}/data/cambios.json`);
        if (cambiosResponse.ok) {
            const cambios = await cambiosResponse.json();
            cambios.forEach(cambio => {
                cambiosMap.set(cambio.codigo, cambio.tipo);
            });
        }
    } catch (error) {}

    for (const zona of zonas) {
        let datosCargados = null;
        let fechaCargada = null;
        let horaCargada = null;
        
        for (const fecha of fechasUltimosDias) {
            for (let h = 23; h >= 0; h--) {
                const hora = h.toString().padStart(2, '0');
                const url = `${baseURL}/data/${zona}_${fecha}_${hora}.geojson`;
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        datosCargados = await response.json();
                        fechaCargada = fecha;
                        horaCargada = hora;
                        console.log(`✅ ${zona} cargado con fecha ${fecha} hora ${hora}`);
                        break;
                    }
                } catch (e) {}
            }
            if (datosCargados) break;
        }
        
        if (datosCargados) {
            const featuresWGS84 = datosCargados.features.map(feature => {
                if (feature.geometry && feature.geometry.type === 'Polygon') {
                    try {
                        const coords = feature.geometry.coordinates[0];
                        const coordsWGS84 = coords.map(c => {
                            const [lat, lon] = convertirUTM_A_WGS84(c[0], c[1], zona);
                            return [lon, lat];
                        });
                        return {
                            ...feature,
                            geometry: {
                                type: 'Polygon',
                                coordinates: [coordsWGS84]
                            }
                        };
                    } catch (e) {
                        return feature;
                    }
                }
                return feature;
            });
            
            todosLosDatos.push({
                zona: zona,
                fecha: fechaCargada,
                hora: horaCargada,
                features: featuresWGS84
            });
            
            const getColor = (codigo) => {
                if (cambiosMap.has(codigo)) {
                    return cambiosMap.get(codigo) === 'aparece' ? COLORES.APARECE : COLORES.DESAPARECE;
                }
                return COLORES.SIN_CAMBIO;
            };
            
            const capa = L.geoJSON(datosCargados, {
                coordsToLatLng: (coords) => {
                    const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], zona);
                    return L.latLng(lat, lon);
                },
                style: (feature) => ({
                    color: getColor(feature.properties.CODIGOU),
                    weight: 1.5,
                    opacity: 0.8,
                    fillOpacity: 0.25
                }),
                onEachFeature: (feature, layer) => {
                    layer.on('click', () => {
                        cerrarPopup();
                        const props = feature.properties;
                        document.getElementById('info-codigo').textContent = corregirTexto(props.CODIGOU || 'N/A');
                        document.getElementById('info-fecha').textContent = props.FEC_DENU || 'N/A';
                        document.getElementById('info-concesion').textContent = corregirTexto(props.CONCESION || 'N/A');
                        document.getElementById('info-titular').textContent = corregirTexto(props.TIT_CONCES || 'N/A');
                        document.getElementById('info-popup').style.display = 'block';
                        popupAbierto = true;
                    });
                }
            }).addTo(map);
            capas[zona] = capa;
        }
    }
}

// ============================================================
// CARGAR CAMBIOS
// ============================================================
async function cargarCambios() {
    try {
        const response = await fetch(`${baseURL}/data/cambios.json`);
        if (response.ok) {
            const cambios = await response.json();
            const div = document.getElementById('tabla-cambios');
            div.innerHTML = '';
            
            if (cambios.length === 0) {
                div.innerHTML = '<div class="cambio-item">No hay cambios registrados</div>';
                return;
            }
            
            cambios.slice(-30).reverse().forEach(c => {
                const item = document.createElement('div');
                item.className = `cambio-item ${c.tipo}`;
                item.style.cursor = 'pointer';
                item.innerHTML = `<strong>${corregirTexto(c.nombre)}</strong><br><small>${c.tipo} - ${c.fecha}</small>`;
                item.onclick = () => buscarYCentrarPoligono(c.codigo, c.nombre, c.tipo);
                div.appendChild(item);
            });
        }
    } catch (error) {
        document.getElementById('tabla-cambios').innerHTML = 'Error cargando cambios';
    }
}

async function buscarYCentrarPoligono(codigo, nombre, tipo) {
    const archivoMensual = `${tipo === 'desaparece' ? 'desaparecidos' : 'aparecidos'}_7d.geojson`;
    
    try {
        const response = await fetch(`${baseURL}/data/${archivoMensual}`);
        if (response.ok) {
            const geojson = await response.json();
            const feature = geojson.features.find(f => f.properties.CODIGOU === codigo);
            
            if (feature && feature.geometry) {
                let lat, lon;
                const coords = feature.geometry.coordinates[0];
                let sumLon = 0, sumLat = 0;
                coords.forEach(c => { sumLon += c[0]; sumLat += c[1]; });
                lon = sumLon / coords.length;
                lat = sumLat / coords.length;
                
                map.setView([lat, lon], 14);
                
                if (capaDibujo) map.removeLayer(capaDibujo);
                capaDibujo = L.circleMarker([lat, lon], {
                    color: tipo === 'desaparece' ? '#ff4444' : '#4444ff',
                    radius: 15,
                    weight: 3,
                    opacity: 1,
                    fillOpacity: 0.3
                }).addTo(map);
                
                mostrarMensaje(`📍 Centrando: ${corregirTexto(nombre)}`, 'exito');
            }
        }
    } catch (error) {}
}

// ============================================================
// BUSCADOR
// ============================================================
async function buscarConcesion() {
    const texto = document.getElementById('buscador').value.trim().toLowerCase();
    if (!texto || texto.length < 2) {
        mostrarMensaje('Ingresa al menos 2 caracteres', 'info');
        return;
    }
    
    const resultados = [];
    for (const zonaData of todosLosDatos) {
        for (const feature of zonaData.features) {
            const props = feature.properties;
            const conc = (props.CONCESION || '').toLowerCase();
            const tit = (props.TIT_CONCES || '').toLowerCase();
            const cod = (props.CODIGOU || '').toLowerCase();
            
            if (conc.includes(texto) || tit.includes(texto) || cod.includes(texto)) {
                resultados.push({...feature, zona: zonaData.zona});
            }
        }
    }
    
    const div = document.getElementById('resultados-busqueda');
    div.innerHTML = '';
    
    if (resultados.length === 0) {
        div.innerHTML = '<div class="resultado-item">No se encontraron resultados</div>';
        return;
    }
    
    resultados.slice(0, 20).forEach(r => {
        const item = document.createElement('div');
        item.className = 'resultado-item';
        item.textContent = `${corregirTexto(r.properties.CONCESION)} - ${corregirTexto(r.properties.TIT_CONCES)}`;
        item.onclick = () => {
            const coords = r.geometry.coordinates[0];
            let sumLat = 0, sumLon = 0;
            coords.forEach(c => { sumLat += c[1]; sumLon += c[0]; });
            map.setView([sumLat/coords.length, sumLon/coords.length], 14);
        };
        div.appendChild(item);
    });
}

// ============================================================
// DIBUJAR ÁREA (SOLO RECTÁNGULO CON 2 CLICS)
// ============================================================
let dibujando = false;
let puntoInicio = null;

function activarDibujoRectangulo() {
    if (dibujando) {
        mostrarMensaje('Ya estás dibujando. Haz clic en el mapa.', 'info');
        return;
    }
    
    dibujando = true;
    puntoInicio = null;
    map.getContainer().style.cursor = 'crosshair';
    mostrarMensaje('Haz clic en la primera esquina del área', 'info');
    
    map.off('click');
    map.on('click', function dibujarHandler(e) {
        if (!dibujando) return;
        
        if (!puntoInicio) {
            puntoInicio = e.latlng;
            mostrarMensaje('Ahora haz clic en la esquina opuesta', 'info');
        } else {
            const bounds = L.latLngBounds(puntoInicio, e.latlng);
            if (capaDibujo) map.removeLayer(capaDibujo);
            
            capaDibujo = L.rectangle(bounds, {
                color: '#ff44ff',
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.2
            }).addTo(map);
            
            rectanguloDibujo = bounds;
            areaMonitoreada = bounds;
            dibujando = false;
            puntoInicio = null;
            map.getContainer().style.cursor = '';
            map.off('click', dibujarHandler);
            
            document.getElementById('area-info').style.display = 'block';
            document.getElementById('area-coords').textContent = 
                `SW: ${bounds.getSouthWest().lat.toFixed(4)}, ${bounds.getSouthWest().lng.toFixed(4)} | NE: ${bounds.getNorthEast().lat.toFixed(4)}, ${bounds.getNorthEast().lng.toFixed(4)}`;
            
            mostrarMensaje('✅ Área dibujada correctamente', 'exito');
        }
    });
}

function limpiarDibujo() {
    if (capaDibujo) {
        map.removeLayer(capaDibujo);
        capaDibujo = null;
        rectanguloDibujo = null;
    }
    dibujando = false;
    puntoInicio = null;
    map.getContainer().style.cursor = '';
    map.off('click');
    areaMonitoreada = null;
    document.getElementById('area-info').style.display = 'none';
    document.getElementById('status-monitoreo').classList.remove('activo');
    mostrarMensaje('🗑️ Dibujo limpiado', 'info');
}

// ============================================================
// MONITOREO
// ============================================================
function guardarAreaParaMonitoreo() {
    if (!rectanguloDibujo) {
        mostrarMensaje('Primero dibuja un área', 'error');
        return;
    }
    
    const sw = rectanguloDibujo.getSouthWest();
    const ne = rectanguloDibujo.getNorthEast();
    
    const areaData = {
        sw: { lat: sw.lat, lng: sw.lng },
        ne: { lat: ne.lat, lng: ne.lng },
        bounds: rectanguloDibujo.toBBoxString(),
        fecha: new Date().toISOString()
    };
    
    localStorage.setItem('areaMonitoreada', JSON.stringify(areaData));
    areaMonitoreada = rectanguloDibujo;
    
    document.getElementById('status-monitoreo').classList.add('activo');
    document.getElementById('monitoreo-info').textContent = `Área: ${areaData.bounds}`;
    
    mostrarMensaje('✅ Área guardada. Ahora ingresa tu correo.', 'exito');
    
    const emailGuardado = localStorage.getItem('emailAlertas');
    const email = prompt('Ingresa tu correo para recibir alertas:', emailGuardado || '');
    
    if (email && email.includes('@')) {
        localStorage.setItem('emailAlertas', email);
        mostrarMensaje(`📧 Alertas se enviarán a: ${email}`, 'exito');
    } else {
        mostrarMensaje('⚠️ No se guardó el correo', 'error');
    }
}

function cargarAreaMonitoreada() {
    const areaStr = localStorage.getItem('areaMonitoreada');
    if (areaStr) {
        try {
            const areaData = JSON.parse(areaStr);
            const bounds = L.latLngBounds(
                [areaData.sw.lat, areaData.sw.lng],
                [areaData.ne.lat, areaData.ne.lng]
            );
            areaMonitoreada = bounds;
            rectanguloDibujo = bounds;
            
            capaDibujo = L.rectangle(bounds, {
                color: '#ff44ff',
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.2
            }).addTo(map);
            
            document.getElementById('area-info').style.display = 'block';
            document.getElementById('area-coords').textContent = 
                `SW: ${bounds.getSouthWest().lat.toFixed(4)}, ${bounds.getSouthWest().lng.toFixed(4)} | NE: ${bounds.getNorthEast().lat.toFixed(4)}, ${bounds.getNorthEast().lng.toFixed(4)}`;
            
            document.getElementById('status-monitoreo').classList.add('activo');
            document.getElementById('monitoreo-info').textContent = `Área: ${areaData.bounds}`;
            
            mostrarMensaje('📌 Área de monitoreo cargada', 'info');
        } catch (e) {}
    }
}

// ============================================================
// VERIFICAR CAMBIOS Y ENVIAR ALERTA
// ============================================================
async function verificarCambiosYEnviarAlerta() {
    if (!areaMonitoreada) {
        mostrarMensaje('Primero dibuja un área y actívala con "🔔 Monitorear"', 'error');
        return;
    }
    
    const email = localStorage.getItem('emailAlertas');
    if (!email) {
        mostrarMensaje('No hay correo guardado. Configura el monitoreo primero.', 'error');
        return;
    }
    
    mostrarMensaje('🔍 Verificando cambios...', 'info');
    
    try {
        const response = await fetch(`${baseURL}/data/cambios.json`);
        if (!response.ok) throw new Error('Error al cargar cambios');
        const cambios = await response.json();
        
        function calcularCentro(feature) {
            if (!feature.geometry) return null;
            
            let coords = [];
            if (feature.geometry.type === 'Polygon') {
                coords = feature.geometry.coordinates[0];
            } else if (feature.geometry.type === 'MultiPolygon') {
                coords = feature.geometry.coordinates[0][0];
            }
            
            if (!coords || coords.length === 0) return null;
            
            let sumX = 0, sumY = 0;
            coords.forEach(c => { sumX += c[0]; sumY += c[1]; });
            
            const avgX = sumX / coords.length;
            const avgY = sumY / coords.length;
            
            if (avgX > 100000 || avgY > 100000) {
                let zona = '18s';
                if (avgX >= 1000000) zona = '19s';
                else if (avgX >= 700000) zona = '18s';
                else zona = '17s';
                
                const epsg = zona === '17s' ? 'EPSG:32717' : 
                            (zona === '18s' ? 'EPSG:32718' : 'EPSG:32719');
                
                try {
                    const [lon, lat] = proj4(epsg, 'EPSG:4326', [avgX, avgY]);
                    return { lat, lon };
                } catch (e) {
                    return { lat: avgY, lon: avgX };
                }
            }
            
            return { lat: avgY, lon: avgX };
        }
        
        const cambiosEnArea = [];
        const codigosYaProcesados = new Set();
        
        for (const zonaData of todosLosDatos) {
            for (const feature of zonaData.features) {
                const codigo = feature.properties.CODIGOU;
                if (codigosYaProcesados.has(codigo)) continue;
                
                const cambio = cambios.find(c => c.codigo === codigo);
                if (cambio) {
                    const centro = calcularCentro(feature);
                    if (centro && areaMonitoreada.contains([centro.lat, centro.lon])) {
                        codigosYaProcesados.add(codigo);
                        cambiosEnArea.push({
                            ...cambio,
                            nombre: feature.properties.CONCESION || cambio.nombre,
                            geometry: feature.geometry
                        });
                    }
                }
            }
        }
        
        if (cambiosEnArea.length === 0) {
            mostrarMensaje('📭 No hay cambios en el área monitoreada', 'info');
            return;
        }
        
        const total = cambiosEnArea.length;
        let mensajeTexto = `📊 CAMBIOS EN TU ÁREA MONITOREADA\n`;
        mensajeTexto += `================================\n`;
        mensajeTexto += `Se detectaron ${total} cambios en tu área de interés.\n\n`;
        
        const desapArea = cambiosEnArea.filter(c => c.tipo === 'desaparece');
        if (desapArea.length > 0) {
            mensajeTexto += `🔴 DESAPARECIDOS (${desapArea.length}):\n`;
            desapArea.slice(0, 30).forEach(c => {
                mensajeTexto += `  - ${c.nombre} (${c.codigo})\n`;
            });
            if (desapArea.length > 30) {
                mensajeTexto += `  ... y ${desapArea.length - 30} más\n`;
            }
        }
        
        const apArea = cambiosEnArea.filter(c => c.tipo === 'aparece');
        if (apArea.length > 0) {
            mensajeTexto += `\n🟢 APARECIDOS (${apArea.length}):\n`;
            apArea.slice(0, 30).forEach(c => {
                mensajeTexto += `  - ${c.nombre} (${c.codigo})\n`;
            });
            if (apArea.length > 30) {
                mensajeTexto += `  ... y ${apArea.length - 30} más\n`;
            }
        }
        
        mensajeTexto += `\n🔗 Visor: https://coach0123.github.io/visor-concesiones-mineras/`;
        mensajeTexto += `\n📅 ${new Date().toLocaleString('es-PE')}`;
        
        try {
            const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_id: 'service_gmail_visor',
                    template_id: 'template_visor_alertas1',
                    user_id: '_PBGYuyGPuKRPK-_F',
                    template_params: {
                        to_email: email,
                        name: 'Wvisor',
                        message: mensajeTexto,
                        total: total,
                        date: new Date().toLocaleString('es-PE')
                    }
                })
            });
            
            if (response.ok) {
                mostrarMensaje(`📧 Correo enviado con ${total} cambios en el área`, 'exito');
            } else {
                mostrarMensaje('Error al enviar correo. Revisa la consola.', 'error');
            }
        } catch (emailError) {
            mostrarMensaje('Error de conexión al enviar correo.', 'error');
        }
        
    } catch (error) {
        console.error(error);
        mostrarMensaje('Error al verificar cambios', 'error');
    }
}

// ============================================================
// GENERAR INFORME HTML AUTÓNOMO
// ============================================================
async function generarInforme(fecha) {
    if (!areaMonitoreada) {
        mostrarMensaje('Primero dibuja un área', 'error');
        return;
    }
    
    mostrarMensaje('📊 Generando informe...', 'info');
    
    try {
        const response = await fetch(`${baseURL}/data/cambios.json`);
        const cambios = await response.json();
        
        // Cargar datos base (1706) y de comparación
        let datosBase = null;
        let datosComparar = null;
        
        const archivoFecha = fecha === '1507' ? '150726' : '220726';
        
        // Cargar datos de las 3 zonas para ambas fechas
        const zonasData = { base: [], comparar: [] };
        
        for (const zona of zonas) {
            // Cargar base (170626)
            try {
                const respBase = await fetch(`${baseURL}/data/${zona}_170626_23.geojson`);
                if (respBase.ok) {
                    const data = await respBase.json();
                    zonasData.base.push({ zona, features: data.features });
                }
            } catch (e) {}
            
            // Cargar comparación
            try {
                const respComp = await fetch(`${baseURL}/data/${zona}_${archivoFecha}_23.geojson`);
                if (respComp.ok) {
                    const data = await respComp.json();
                    zonasData.comparar.push({ zona, features: data.features });
                }
            } catch (e) {}
        }
        
        // Crear HTML autónomo
        const htmlContent = generarHTMLAutonomo(zonasData, fecha, cambios);
        
        // Descargar
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `informe_${fecha}_${new Date().toISOString().slice(0,10)}.html`;
        a.click();
        URL.revokeObjectURL(url);
        
        mostrarMensaje('✅ Informe descargado correctamente', 'exito');
        
    } catch (error) {
        console.error(error);
        mostrarMensaje('Error al generar informe', 'error');
    }
}

function generarHTMLAutonomo(zonasData, fecha, cambios) {
    const areaData = JSON.parse(localStorage.getItem('areaMonitoreada'));
    const fechaTexto = fecha === '1507' ? '15/07/2026' : '22/07/2026';
    
    // Filtrar features dentro del área
    const filtrarPorArea = (features, zona) => {
        return features.filter(f => {
            if (!f.geometry || f.geometry.type !== 'Polygon') return false;
            try {
                const coords = f.geometry.coordinates[0];
                let sumLat = 0, sumLon = 0;
                coords.forEach(c => { sumLat += c[1]; sumLon += c[0]; });
                const lat = sumLat / coords.length;
                const lon = sumLon / coords.length;
                
                return lat >= areaData.sw.lat && lat <= areaData.ne.lat &&
                       lon >= areaData.sw.lng && lon <= areaData.ne.lng;
            } catch (e) { return false; }
        });
    };
    
    // Extraer datos
    let baseEnArea = [];
    let aparecidosEnArea = [];
    let desaparecidosEnArea = [];
    
    for (const zd of zonasData.base) {
        baseEnArea.push(...filtrarPorArea(zd.features, zd.zona));
    }
    
    // Detectar aparecidos y desaparecidos
    const codigosBase = new Set(baseEnArea.map(f => f.properties.CODIGOU));
    const codigosComparar = new Set();
    
    for (const zd of zonasData.comparar) {
        zd.features.forEach(f => codigosComparar.add(f.properties.CODIGOU));
    }
    
    // Desaparecidos: en base pero no en comparar
    baseEnArea.forEach(f => {
        if (!codigosComparar.has(f.properties.CODIGOU)) {
            desaparecidosEnArea.push(f);
        }
    });
    
    // Aparecidos: en comparar pero no en base, y dentro del área
    for (const zd of zonasData.comparar) {
        const enArea = filtrarPorArea(zd.features, zd.zona);
        enArea.forEach(f => {
            if (!codigosBase.has(f.properties.CODIGOU)) {
                aparecidosEnArea.push(f);
            }
        });
    }
    
    const totalBase = baseEnArea.length - desaparecidosEnArea.length;
    const totalDesap = desaparecidosEnArea.length;
    const totalAp = aparecidosEnArea.length;
    const total = totalBase + totalDesap + totalAp;
    
    // Generar HTML
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wvisor - Informe ${fechaTexto}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #0a1628;
            color: #e0e6f0;
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: #0f1e3a;
            border-radius: 12px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.5);
            overflow: hidden;
            border: 1px solid #1e3a5f;
        }
        .header {
            background: linear-gradient(135deg, #1e3a8a, #1e40af);
            padding: 25px 30px;
        }
        .header-top {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 10px;
        }
        .logo-w {
            width: 45px;
            height: 45px;
            background: linear-gradient(135deg, #3b82f6, #1e40af);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            font-weight: 800;
            color: #fff;
            font-family: Georgia, serif;
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
        }
        .header h1 {
            font-size: 22px;
            font-weight: 600;
            color: #fff;
        }
        .header .subtitle {
            font-size: 13px;
            color: #93c5fd;
            margin-bottom: 15px;
        }
        .stats {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .stat-item {
            background: rgba(255,255,255,0.12);
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 12px;
            color: #bfdbfe;
        }
        .stat-item strong {
            font-size: 20px;
            display: block;
            color: #fff;
        }
        .stat-item.danger { background: rgba(220, 38, 38, 0.3); }
        .stat-item.danger strong { color: #fca5a5; }
        .stat-item.success { background: rgba(59, 130, 246, 0.3); }
        .stat-item.success strong { color: #93c5fd; }
        
        .main-content {
            display: flex;
            flex-wrap: wrap;
        }
        .map-column {
            flex: 2;
            min-width: 500px;
            padding: 20px;
            background: #0a1628;
        }
        #map {
            border-radius: 8px;
            height: 550px;
            width: 100%;
            border: 1px solid #1e3a5f;
        }
        .info-column {
            flex: 1;
            min-width: 320px;
            padding: 20px;
            background: #0f1e3a;
            border-left: 1px solid #1e3a5f;
            max-height: 600px;
            overflow-y: auto;
        }
        .info-column h2 {
            font-size: 16px;
            margin-bottom: 15px;
            color: #93c5fd;
            padding-bottom: 8px;
            border-bottom: 1px solid #1e3a5f;
        }
        .resumen-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #1e3a5f;
            font-size: 13px;
        }
        .resumen-item .label { color: #94a3b8; }
        .resumen-item .value { font-weight: 600; }
        .value.sin-cambios { color: #cbd5e1; }
        .value.desaparecio { color: #f87171; }
        .value.aparecio { color: #60a5fa; }
        
        .lista-concesiones { margin-top: 15px; }
        .item-concesion {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            font-size: 12px;
            border-bottom: 1px solid #1e3a5f;
        }
        .estado-badge {
            font-size: 10px;
            padding: 3px 8px;
            border-radius: 10px;
            color: white;
            font-weight: 600;
        }
        .estado-badge.sin-cambios { background: #475569; }
        .estado-badge.desaparecio { background: #dc2626; }
        .estado-badge.aparecio { background: #2563eb; }
        
        .tabla-container {
            padding: 20px 30px 30px;
            border-top: 1px solid #1e3a5f;
        }
        .tabla-container h2 {
            font-size: 16px;
            margin-bottom: 15px;
            color: #93c5fd;
        }
        .tabla-concesiones {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .tabla-concesiones thead th {
            background: #152b4a;
            padding: 12px 15px;
            text-align: left;
            color: #93c5fd;
            border-bottom: 2px solid #1e3a5f;
        }
        .tabla-concesiones tbody td {
            padding: 10px 15px;
            border-bottom: 1px solid #1e3a5f;
            color: #cbd5e1;
        }
        .tabla-concesiones tbody tr:hover { background: #152b4a; }
        
        .footer {
            background: #0a1628;
            padding: 15px 30px;
            text-align: center;
            font-size: 11px;
            color: #475569;
            border-top: 1px solid #1e3a5f;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <div class="logo-w">W</div>
                <h1>Wvisor - Informe de Área</h1>
            </div>
            <div class="subtitle">Comparación con ${fechaTexto} · Generado el ${new Date().toLocaleString('es-PE')}</div>
            <div class="stats">
                <div class="stat-item"><strong>${totalBase}</strong>Sin cambios</div>
                <div class="stat-item danger"><strong>${totalDesap}</strong>Desaparecieron</div>
                <div class="stat-item success"><strong>${totalAp}</strong>Aparecieron</div>
                <div class="stat-item"><strong>${total}</strong>Total</div>
            </div>
        </div>
        
        <div class="main-content">
            <div class="map-column">
                <div id="map"></div>
            </div>
            <div class="info-column">
                <h2>📊 Resumen</h2>
                <div class="resumen-item">
                    <span class="label">✅ Sin cambios</span>
                    <span class="value sin-cambios">${totalBase}</span>
                </div>
                <div class="resumen-item">
                    <span class="label">🔴 Desaparecieron</span>
                    <span class="value desaparecio">${totalDesap}</span>
                </div>
                <div class="resumen-item">
                    <span class="label">🔵 Aparecieron</span>
                    <span class="value aparecio">${totalAp}</span>
                </div>
                
                <h2 style="margin-top:20px;">📋 Concesiones</h2>
                <div class="lista-concesiones">
                    ${desaparecidosEnArea.map(f => `
                        <div class="item-concesion">
                            <span>${f.properties.CONCESION || 'N/A'}</span>
                            <span class="estado-badge desaparecio">DESAPARECIÓ</span>
                        </div>
                    `).join('')}
                    ${aparecidosEnArea.map(f => `
                        <div class="item-concesion">
                            <span>${f.properties.CONCESION || 'N/A'}</span>
                            <span class="estado-badge aparecio">APARECIÓ</span>
                        </div>
                    `).join('')}
                    ${baseEnArea.filter(f => !desaparecidosEnArea.includes(f)).map(f => `
                        <div class="item-concesion">
                            <span>${f.properties.CONCESION || 'N/A'}</span>
                            <span class="estado-badge sin-cambios">SIN CAMBIOS</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="tabla-container">
            <h2>📋 Detalle Completo</h2>
            <table class="tabla-concesiones">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Concesión</th>
                        <th>Titular</th>
                        <th>Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${desaparecidosEnArea.map(f => `
                        <tr>
                            <td>${f.properties.CODIGOU || 'N/A'}</td>
                            <td>${f.properties.CONCESION || 'N/A'}</td>
                            <td>${f.properties.TIT_CONCES || 'N/A'}</td>
                            <td><span class="estado-badge desaparecio">DESAPARECIÓ</span></td>
                        </tr>
                    `).join('')}
                    ${aparecidosEnArea.map(f => `
                        <tr>
                            <td>${f.properties.CODIGOU || 'N/A'}</td>
                            <td>${f.properties.CONCESION || 'N/A'}</td>
                            <td>${f.properties.TIT_CONCES || 'N/A'}</td>
                            <td><span class="estado-badge aparecio">APARECIÓ</span></td>
                        </tr>
                    `).join('')}
                    ${baseEnArea.filter(f => !desaparecidosEnArea.includes(f)).map(f => `
                        <tr>
                            <td>${f.properties.CODIGOU || 'N/A'}</td>
                            <td>${f.properties.CONCESION || 'N/A'}</td>
                            <td>${f.properties.TIT_CONCES || 'N/A'}</td>
                            <td><span class="estado-badge sin-cambios">SIN CAMBIOS</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            Wvisor · Datos INGEMMET · ${new Date().toLocaleString('es-PE')}
        </div>
    </div>
    
    <script>
        const areaData = ${JSON.stringify(areaData)};
        const baseFeatures = ${JSON.stringify(baseEnArea)};
        const desaparecidosFeatures = ${JSON.stringify(desaparecidosEnArea)};
        const aparecidosFeatures = ${JSON.stringify(aparecidosEnArea)};
        
        const map = L.map('map').setView([
            (areaData.sw.lat + areaData.ne.lat) / 2,
            (areaData.sw.lng + areaData.ne.lng) / 2
        ], 12);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        
        // Área
        L.rectangle([
            [areaData.sw.lat, areaData.sw.lng],
            [areaData.ne.lat, areaData.ne.lng]
        ], {
            color: '#ff44ff',
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.1
        }).addTo(map);
        
        // Sin cambios
        L.geoJSON({ type: 'FeatureCollection', features: baseFeatures }, {
            style: { color: '#888888', weight: 1.5, opacity: 0.6, fillOpacity: 0.2 },
            onEachFeature: (f, l) => l.bindPopup('<b>' + (f.properties.CONCESION || 'N/A') + '</b><br>✅ Sin cambios')
        }).addTo(map);
        
        // Desaparecidos
        L.geoJSON({ type: 'FeatureCollection', features: desaparecidosFeatures }, {
            style: { color: '#ff4444', weight: 2, opacity: 0.9, fillOpacity: 0.4 },
            onEachFeature: (f, l) => l.bindPopup('<b style="color:#ff4444;">' + (f.properties.CONCESION || 'N/A') + '</b><br>🔴 Desapareció')
        }).addTo(map);
        
        // Aparecidos
        L.geoJSON({ type: 'FeatureCollection', features: aparecidosFeatures }, {
            style: { color: '#4444ff', weight: 2, opacity: 0.9, fillOpacity: 0.4 },
            onEachFeature: (f, l) => l.bindPopup('<b style="color:#4444ff;">' + (f.properties.CONCESION || 'N/A') + '</b><br>🔵 Apareció')
        }).addTo(map);
    </script>
</body>
</html>`;
}

function cerrarPopup() {
    document.getElementById('info-popup').style.display = 'none';
    popupAbierto = false;
}

function mostrarMensaje(texto, tipo = 'info') {
    const msgDiv = document.getElementById('mensaje-emergente');
    if (!msgDiv) return;
    msgDiv.textContent = texto;
    const colores = {
        error: '#dc2626',
        exito: '#059669',
        info: '#1e40af'
    };
    msgDiv.style.backgroundColor = colores[tipo] || '#1e40af';
    msgDiv.style.display = 'block';
    clearTimeout(msgDiv._timeout);
    msgDiv._timeout = setTimeout(() => { msgDiv.style.display = 'none'; }, 4000);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarPopup(); });
document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});
document.addEventListener('DOMContentLoaded', initMap);