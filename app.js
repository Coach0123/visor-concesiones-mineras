// Configuración del mapa
let map;
let capas = {};
let popupAbierto = false;
let todosLosDatos = [];
let datosHistoricos = [];
let rectanguloDibujo = null;
let capaDibujo = null;
let marcadorBusqueda;
let capaAreaInteres;

// Función para corregir caracteres especiales
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

function corregirTextoCSV(texto) {
    if (!texto) return '';
    let t = texto.toString();
    const reemplazos = {
        'Ã‘': 'Ñ', 'Ã±': 'ñ', 'Ã‰': 'É', 'Ã©': 'é', 'Ã ': 'Á', 'Ã¡': 'á',
        'Ã“': 'Ó', 'Ã³': 'ó', 'Ãš': 'Ú', 'Ãº': 'ú', 'Ã ': 'Í', 'Ã­': 'í',
        'Ãœ': 'Ü', 'Ã¼': 'ü', 'Ã€': 'À', 'Ã ': 'à', 'ÃŠ': 'Ê', 'Ãª': 'ê',
        'Ã‡': 'Ç', 'Ã§': 'ç', 'Â¿': '¿', 'Â¡': '¡', 'Â°': '°', 'â€™': "'",
        'â€œ': '"', 'â€': '"', 'Â´': "'", 'Ã': 'í', '³': 'ó', '±': 'ñ',
        'estÃ¡ndar': 'estándar', 'PerÃº': 'Perú'
    };
    for (const [mal, bien] of Object.entries(reemplazos)) {
        t = t.replace(new RegExp(mal, 'g'), bien);
    }
    return t;
}

// Definir proyecciones UTM
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
const dia = fechaHoy.getDate().toString().padStart(2, '0');
const mes = (fechaHoy.getMonth() + 1).toString().padStart(2, '0');
const anio = fechaHoy.getFullYear().toString().slice(-2);
const fechaStr = `${dia}${mes}${anio}`;
console.log(`📅 Fecha actual: ${fechaStr}`);

const fechasUltimosDias = [];
for (let i = 0; i < 10; i++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    const d = fecha.getDate().toString().padStart(2, '0');
    const m = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const a = fecha.getFullYear().toString().slice(-2);
    fechasUltimosDias.push(`${d}${m}${a}`);
}
console.log(`📅 Buscando en fechas: ${fechasUltimosDias.join(', ')}`);

function obtenerHorariosActuales() {
    const ahora = new Date();
    const horaUTC = ahora.getUTCHours();
    const minutoUTC = ahora.getUTCMinutes();
    const horaPeru = (horaUTC - 5 + 24) % 24;
    
    const horarios = [];
    for (let i = 0; i < 24; i++) {
        horarios.push(i.toString().padStart(2, '0'));
    }
    
    let horarioActual = '23';
    for (let i = horarios.length - 1; i >= 0; i--) {
        if (horaUTC >= parseInt(horarios[i])) {
            horarioActual = horarios[i];
            break;
        }
    }
    
    const indexActual = horarios.indexOf(horarioActual);
    const horarioAnterior = indexActual > 0 ? horarios[indexActual - 1] : horarios[horarios.length - 1];
    
    console.log(`Hora Perú: ${horaPeru}:${minutoUTC.toString().padStart(2, '0')}`);
    
    return { actual: horarioActual, anterior: horarioAnterior };
}

const horarios = obtenerHorariosActuales();
const zonas = ['17s', '18s', '19s'];

const COLORES = {
    SIN_CAMBIO: '#888888',
    APARECE: '#4444ff',
    DESAPARECE: '#ff4444',
    HISTORICO_APARECE: '#44ff44',
    HISTORICO_DESAPARECE: '#ff44ff'
};

function initMap() {
    console.log('🗺️ Inicializando mapa...');
    map = L.map('map').setView([-9.5, -75], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    agregarBotonesPersonalizados();
    agregarBotonMonitoreo();
    cargarAreaMonitoreada();
    cargarDatos();
    cargarCambios();
    cargarHistorialMensual();
}

function agregarBotonesPersonalizados() {
    const contenedor = document.querySelector('.carga-archivos');
    if (!contenedor) return;
    
    const btnDibujar = document.createElement('button');
    btnDibujar.textContent = '✏️ Dibujar área';
    btnDibujar.style.marginTop = '10px';
    btnDibujar.style.backgroundColor = '#2196F3';
    btnDibujar.onclick = activarDibujoRectangulo;
    
    const btnCSV = document.createElement('button');
    btnCSV.textContent = '📥 Descargar CSV del área';
    btnCSV.style.marginTop = '10px';
    btnCSV.style.backgroundColor = '#4CAF50';
    btnCSV.onclick = descargarCSVArea;
    
    const btnLimpiar = document.createElement('button');
    btnLimpiar.textContent = '🗑️ Limpiar dibujo';
    btnLimpiar.style.marginTop = '10px';
    btnLimpiar.style.backgroundColor = '#ff4444';
    btnLimpiar.onclick = limpiarDibujo;
    
    contenedor.appendChild(btnDibujar);
    contenedor.appendChild(btnCSV);
    contenedor.appendChild(btnLimpiar);
}

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
            todosLosDatos.push({
                zona: zona,
                fecha: fechaCargada,
                hora: horaCargada,
                features: datosCargados.features
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
                        document.getElementById('info-codigo').textContent = corregirTexto(props.CODIGOU);
                        document.getElementById('info-fecha').textContent = corregirTexto(props.FEC_DENU);
                        document.getElementById('info-concesion').textContent = corregirTexto(props.CONCESION);
                        document.getElementById('info-titular').textContent = corregirTexto(props.TIT_CONCES);
                        document.getElementById('info-popup').style.display = 'block';
                        popupAbierto = true;
                    });
                }
            }).addTo(map);
            capas[zona] = capa;
        }
    }
}

async function cargarHistorialMensual() {
    try {
        const mesActual = fechaHoy.getFullYear() + (fechaHoy.getMonth() + 1).toString().padStart(2, '0');
        const response = await fetch(`${baseURL}/data/historial_${mesActual}.geojson`);
        
        if (response.ok) {
            const historial = await response.json();
            datosHistoricos = historial.features;
            
            L.geoJSON(historial, {
                coordsToLatLng: (coords) => {
                    const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], '17s');
                    return L.latLng(lat, lon);
                },
                style: (feature) => ({
                    color: feature.properties.TIPO_CAMBIO === 'aparece' ? COLORES.HISTORICO_APARECE : COLORES.HISTORICO_DESAPARECE,
                    weight: 2,
                    opacity: 0.7,
                    fillOpacity: 0.1,
                    dashArray: '5,5'
                }),
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(`
                        <b>${corregirTexto(feature.properties.CONCESION)}</b><br>
                        ${feature.properties.TIPO_CAMBIO} el ${feature.properties.FECHA_CAMBIO}
                    `);
                }
            }).addTo(map);
        }
    } catch (error) {}
}

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
    console.log(`🔍 Buscando: ${codigo} - ${nombre} (${tipo})`);
    
    const ahora = new Date();
    const mesActual = (ahora.getMonth() + 1).toString().padStart(2, '0');
    const anioActual = ahora.getFullYear();
    const archivoMensual = `${tipo === 'desaparece' ? 'desaparecidos' : 'aparecidos'}_${mesActual}_${anioActual}.geojson`;
    
    console.log(`📁 Buscando en: ${archivoMensual}`);
    
    try {
        const response = await fetch(`${baseURL}/data/${archivoMensual}`);
        if (response.ok) {
            const geojson = await response.json();
            const feature = geojson.features.find(f => f.properties.CODIGOU === codigo);
            
            if (feature && feature.geometry) {
                let lat, lon;
                
                if (feature.geometry.type === 'Polygon') {
                    const coords = feature.geometry.coordinates[0];
                    let sumLon = 0, sumLat = 0;
                    coords.forEach(c => {
                        sumLon += c[0];
                        sumLat += c[1];
                    });
                    lon = sumLon / coords.length;
                    lat = sumLat / coords.length;
                } else if (feature.geometry.type === 'MultiPolygon') {
                    const coords = feature.geometry.coordinates[0][0];
                    let sumLon = 0, sumLat = 0;
                    coords.forEach(c => {
                        sumLon += c[0];
                        sumLat += c[1];
                    });
                    lon = sumLon / coords.length;
                    lat = sumLat / coords.length;
                } else if (feature.geometry.type === 'Point') {
                    lon = feature.geometry.coordinates[0];
                    lat = feature.geometry.coordinates[1];
                } else {
                    mostrarMensaje(`Geometría no soportada: ${nombre}`, 'error');
                    return;
                }
                
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
                cerrarPopup();
                return;
            }
        }
    } catch (error) {
        console.log(`Error cargando ${archivoMensual}:`, error);
    }
    
    mostrarMensaje(`No se encontró el polígono: ${nombre}`, 'error');
}

async function buscarConcesion() {
    const texto = document.getElementById('buscador').value.trim().toLowerCase();
    if (!texto) return;
    
    const resultados = [];
    for (const zonaData of todosLosDatos) {
        for (const feature of zonaData.features) {
            const props = feature.properties;
            if ((props.CONCESION || '').toLowerCase().includes(texto) ||
                (props.TIT_CONCES || '').toLowerCase().includes(texto) ||
                (props.CODIGOU || '').toLowerCase().includes(texto)) {
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
        item.style.cursor = 'pointer';
        item.textContent = `${corregirTexto(r.properties.CONCESION)} - ${corregirTexto(r.properties.TIT_CONCES)}`;
        item.onclick = () => {
            if (r.geometry.type === 'Polygon') {
                const coords = r.geometry.coordinates[0];
                let sumX = 0, sumY = 0;
                coords.forEach(c => { sumX += c[0]; sumY += c[1]; });
                const [lat, lon] = convertirUTM_A_WGS84(sumX/coords.length, sumY/coords.length, r.zona);
                map.setView([lat, lon], 14);
                cerrarPopup();
            }
        };
        div.appendChild(item);
    });
}

async function cargarArchivo() {
    const input = document.getElementById('archivo-input');
    const archivo = input.files[0];
    if (!archivo) return;
    
    const extension = archivo.name.split('.').pop().toLowerCase();
    
    if (extension === 'geojson' || extension === 'json') {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const geojson = JSON.parse(e.target.result);
                mostrarAreaInteres(geojson);
                mostrarMensaje(`✅ GeoJSON cargado`, 'exito');
            } catch (error) {
                mostrarMensaje('Error al leer GeoJSON', 'error');
            }
        };
        reader.readAsText(archivo);
    } else if (extension === 'kml') {
        mostrarMensaje('KML: conviértelo a GeoJSON en https://kml2geojson.netlify.app/', 'info');
    } else if (extension === 'kmz') {
        mostrarMensaje('KMZ: extrae y convierte a GeoJSON', 'info');
    } else {
        mostrarMensaje('Use GeoJSON', 'error');
    }
}

function mostrarAreaInteres(geojson) {
    if (capaAreaInteres) map.removeLayer(capaAreaInteres);
    
    capaAreaInteres = L.geoJSON(geojson, {
        style: { color: '#44ff44', weight: 3, opacity: 0.8, fillOpacity: 0.1, dashArray: '5,10' }
    }).addTo(map);
    
    map.fitBounds(capaAreaInteres.getBounds());
    mostrarMensaje(`✅ Área cargada`, 'exito');
}

let dibujando = false;
let puntoInicio = null;

function activarDibujoRectangulo() {
    dibujando = true;
    puntoInicio = null;
    map.getContainer().style.cursor = 'crosshair';
    mostrarMensaje('Haz clic para iniciar el rectángulo', 'info');
    
    const clickHandler = (e) => {
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
            dibujando = false;
            map.getContainer().style.cursor = '';
            map.off('click', clickHandler);
            mostrarMensaje('Área dibujada', 'exito');
        }
    };
    map.on('click', clickHandler);
}

function limpiarDibujo() {
    if (capaDibujo) {
        map.removeLayer(capaDibujo);
        capaDibujo = null;
        rectanguloDibujo = null;
    }
    dibujando = false;
    map.getContainer().style.cursor = '';
    map.off('click');
    mostrarMensaje('Dibujo limpiado', 'info');
}

function descargarCSVArea() {
    if (!rectanguloDibujo) {
        mostrarMensaje('Primero dibuja un área', 'error');
        return;
    }
    
    const poligonosEnArea = [];
    for (const zonaData of todosLosDatos) {
        for (const feature of zonaData.features) {
            if (feature.geometry.type === 'Polygon') {
                const coords = feature.geometry.coordinates[0];
                let sumX = 0, sumY = 0;
                coords.forEach(c => { sumX += c[0]; sumY += c[1]; });
                const [lat, lon] = convertirUTM_A_WGS84(sumX/coords.length, sumY/coords.length, zonaData.zona);
                if (rectanguloDibujo.contains([lat, lon])) {
                    poligonosEnArea.push(feature.properties);
                }
            }
        }
    }
    
    let csv = 'CODIGOU;FEC_DENU;CONCESION;TIT_CONCES\n';
    poligonosEnArea.forEach(p => {
        csv += `"${corregirTextoCSV(p.CODIGOU || '')}";"${corregirTextoCSV(p.FEC_DENU || '')}";"${corregirTextoCSV(p.CONCESION || '')}";"${corregirTextoCSV(p.TIT_CONCES || '')}"\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poligonos_area_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    mostrarMensaje(`✅ ${poligonosEnArea.length} polígonos exportados`, 'exito');
}

function cerrarPopup() {
    document.getElementById('info-popup').style.display = 'none';
    popupAbierto = false;
}

function buscarCoordenadas() {
    const texto = document.getElementById('coordenadas-texto').value;
    if (texto) {
        const parts = texto.split(',').map(Number);
        if (parts.length === 2) {
            map.setView([parts[0], parts[1]], 12);
            if (marcadorBusqueda) map.removeLayer(marcadorBusqueda);
            marcadorBusqueda = L.marker([parts[0], parts[1]]).addTo(map);
            cerrarPopup();
        }
    }
}

function mostrarMensaje(texto, tipo = 'info') {
    const msgDiv = document.getElementById('mensaje-emergente');
    if (!msgDiv) return;
    msgDiv.textContent = texto;
    msgDiv.style.backgroundColor = tipo === 'error' ? '#ff4444' : (tipo === 'exito' ? '#4CAF50' : '#333');
    msgDiv.style.display = 'block';
    setTimeout(() => { msgDiv.style.display = 'none'; }, 4000);
}

// MONITOREO
let areaMonitoreada = null;
let ultimosCambiosEnviados = new Set();

function guardarAreaParaMonitoreo() {
    if (!rectanguloDibujo) {
        mostrarMensaje('Primero dibuja un área', 'error');
        return;
    }
    
    const bounds = rectanguloDibujo.toBBoxString();
    localStorage.setItem('areaMonitoreada', bounds);
    areaMonitoreada = rectanguloDibujo;
    mostrarMensaje('✅ Área guardada para monitoreo', 'exito');
    
    const email = prompt('Ingresa tu correo para recibir alertas:');
    if (email && email.includes('@')) {
        localStorage.setItem('emailAlertas', email);
        mostrarMensaje(`📧 Alertas se enviarán a: ${email}`, 'exito');
    }
}

function cargarAreaMonitoreada() {
    const boundsString = localStorage.getItem('areaMonitoreada');
    if (boundsString) {
        const [minx, miny, maxx, maxy] = boundsString.split(',').map(Number);
        const bounds = L.latLngBounds([miny, minx], [maxy, maxx]);
        areaMonitoreada = bounds;
        capaDibujo = L.rectangle(bounds, {
            color: '#ff44ff', weight: 3, opacity: 0.8, fillOpacity: 0.2
        }).addTo(map);
        rectanguloDibujo = bounds;
        mostrarMensaje('📌 Área de monitoreo cargada', 'info');
    }
}

async function verificarCambiosYEnviarAlerta() {
    if (!areaMonitoreada) {
        mostrarMensaje('Primero dibuja un área y actívala con "🔔 Monitorear esta área"', 'error');
        return;
    }
    mostrarMensaje('🔍 Verificando cambios...', 'info');
    mostrarMensaje('📧 Función de correo en desarrollo', 'info');
}

function cancelarMonitoreo() {
    localStorage.removeItem('areaMonitoreada');
    localStorage.removeItem('emailAlertas');
    areaMonitoreada = null;
    limpiarDibujo();
    mostrarMensaje('🗑️ Monitoreo cancelado', 'info');
}

function agregarBotonMonitoreo() {
    const contenedor = document.querySelector('.carga-archivos');
    if (!contenedor) return;
    
    const btnMonitorear = document.createElement('button');
    btnMonitorear.textContent = '🔔 Monitorear esta área';
    btnMonitorear.style.marginTop = '10px';
    btnMonitorear.style.backgroundColor = '#FF9800';
    btnMonitorear.onclick = guardarAreaParaMonitoreo;
    
    const btnVerificar = document.createElement('button');
    btnVerificar.textContent = '📧 Verificar cambios ahora';
    btnVerificar.style.marginTop = '10px';
    btnVerificar.style.backgroundColor = '#9C27B0';
    btnVerificar.onclick = verificarCambiosYEnviarAlerta;
    
    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = '🗑️ Cancelar monitoreo';
    btnCancelar.style.marginTop = '10px';
    btnCancelar.style.backgroundColor = '#f44336';
    btnCancelar.onclick = cancelarMonitoreo;
    
    contenedor.appendChild(btnMonitorear);
    contenedor.appendChild(btnVerificar);
    contenedor.appendChild(btnCancelar);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarPopup(); });
document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});
document.addEventListener('DOMContentLoaded', initMap);