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
            // ============================================================
            // CONVERTIR TODOS LOS POLÍGONOS DE UTM A WGS84
            // ============================================================
            const featuresWGS84 = datosCargados.features.map(feature => {
                if (feature.geometry && feature.geometry.type === 'Polygon') {
                    try {
                        const coords = feature.geometry.coordinates[0];
                        const coordsWGS84 = coords.map(c => {
                            const [lat, lon] = convertirUTM_A_WGS84(c[0], c[1], zona);
                            return [lon, lat]; // GeoJSON usa [lon, lat]
                        });
                        return {
                            ...feature,
                            geometry: {
                                type: 'Polygon',
                                coordinates: [coordsWGS84]
                            }
                        };
                    } catch (e) {
                        console.warn('Error convirtiendo feature:', e);
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
                        const codigo = props.CODIGOU;
                        
                        function mostrarPopup(fecha) {
                            let fechaMostrar = fecha || 'N/A';
                            if (fechaMostrar !== 'N/A' && fechaMostrar.includes('GMT')) {
                                try {
                                    const date = new Date(fechaMostrar);
                                    fechaMostrar = date.toLocaleDateString('es-PE', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    });
                                } catch (e) {
                                    fechaMostrar = fecha || 'N/A';
                                }
                            }
                            
                            document.getElementById('info-codigo').textContent = corregirTexto(codigo || 'N/A');
                            document.getElementById('info-fecha').textContent = fechaMostrar;
                            document.getElementById('info-concesion').textContent = corregirTexto(props.CONCESION || 'N/A');
                            document.getElementById('info-titular').textContent = corregirTexto(props.TIT_CONCES || 'N/A');
                            document.getElementById('info-popup').style.display = 'block';
                            popupAbierto = true;
                        }
                        
                        let fecha = props.FEC_DENU || '';
                        if (fecha && fecha !== '') {
                            mostrarPopup(fecha);
                            return;
                        }
                        
                        const mes = (new Date().getMonth() + 1).toString().padStart(2, '0');
                        const anio = new Date().getFullYear();
                        
                        fetch(`${baseURL}/data/desaparecidos_${mes}_${anio}.geojson`)
                            .then(r => {
                                if (!r.ok) throw new Error('No existe');
                                return r.json();
                            })
                            .then(d => {
                                const f = d.features.find(f => f.properties.CODIGOU.trim() === codigo.trim());
                                if (f && f.properties.FEC_DENU) {
                                    mostrarPopup(f.properties.FEC_DENU);
                                } else {
                                    fetch(`${baseURL}/data/aparecidos_${mes}_${anio}.geojson`)
                                        .then(r => r.json())
                                        .then(d2 => {
                                            const f2 = d2.features.find(f => f.properties.CODIGOU.trim() === codigo.trim());
                                            if (f2 && f2.properties.FEC_DENU) {
                                                mostrarPopup(f2.properties.FEC_DENU);
                                            } else {
                                                mostrarPopup('N/A');
                                            }
                                        })
                                        .catch(() => mostrarPopup('N/A'));
                                }
                            })
                            .catch(() => {
                                mostrarPopup('N/A');
                            });
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
    const mes = (ahora.getMonth() + 1).toString().padStart(2, '0');
    const anio = ahora.getFullYear();
    
    // ============================================================
    // PASO 1: Buscar PRIMERO en el archivo mensual (desaparecidos/ aparecidos)
    // ============================================================
    const archivoMensual = `${tipo === 'desaparece' ? 'desaparecidos' : 'aparecidos'}_7d.geojson`;
    
    try {
        const response = await fetch(`${baseURL}/data/${archivoMensual}`);
        if (response.ok) {
            const geojson = await response.json();
            const feature = geojson.features.find(f => f.properties.CODIGOU === codigo);
            
            if (feature && feature.geometry) {
                console.log(`✅ Encontrado en archivo mensual: ${archivoMensual}`);
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
        console.log('No encontrado en archivo mensual, buscando en diarios...');
    }
    
    // ============================================================
    // PASO 2: Si no está en mensual, buscar en archivos diarios (respaldo)
    // ============================================================
    const fechaStr = ahora.toLocaleDateString('es-ES', {
        day: '2-digit', month: '2-digit', year: '2-digit'
    }).replace(/\//g, '');
    
    for (const zona of zonas) {
        for (let h = 23; h >= 0; h--) {
            const hora = h.toString().padStart(2, '0');
            const url = `${baseURL}/data/${zona}_${fechaStr}_${hora}.geojson`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const geojson = await response.json();
                    const feature = geojson.features.find(f => f.properties.CODIGOU === codigo);
                    
                    if (feature && feature.geometry) {
                        let sumX = 0, sumY = 0;
                        let coords = [];
                        
                        if (feature.geometry.type === 'Polygon') {
                            coords = feature.geometry.coordinates[0];
                        } else if (feature.geometry.type === 'MultiPolygon') {
                            coords = feature.geometry.coordinates[0][0];
                        }
                        
                        coords.forEach(c => {
                            sumX += c[0];
                            sumY += c[1];
                        });
                        
                        const centerX = sumX / coords.length;
                        const centerY = sumY / coords.length;
                        const [lat, lon] = convertirUTM_A_WGS84(centerX, centerY, zona);
                        
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
            } catch (e) {}
        }
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
    
    const email = localStorage.getItem('emailAlertas');
    if (!email) {
        mostrarMensaje('No hay correo guardado. Configura primero el monitoreo.', 'error');
        return;
    }
    
    mostrarMensaje('🔍 Verificando cambios en el área...', 'info');
    
    try {
        // Cargar cambios desde cambios.json
        const response = await fetch(`${baseURL}/data/cambios.json`);
        if (!response.ok) throw new Error('Error al cargar cambios');
        const cambios = await response.json();
        
        console.log(`📊 Cambios totales: ${cambios.length}`);
        console.log(`📦 Área: ${areaMonitoreada.toBBoxString()}`);
        
        // Función para calcular centro (convierte UTM a WGS84)
        function calcularCentro(feature) {
            if (!feature.geometry) return null;
            
            let coords = [];
            if (feature.geometry.type === 'Polygon') {
                coords = feature.geometry.coordinates[0];
            } else if (feature.geometry.type === 'MultiPolygon') {
                coords = feature.geometry.coordinates[0][0];
            } else if (feature.geometry.type === 'Point') {
                return { lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0] };
            }
            
            if (!coords || coords.length === 0) return null;
            
            let sumX = 0, sumY = 0;
            coords.forEach(c => {
                sumX += c[0];
                sumY += c[1];
            });
            
            const avgX = sumX / coords.length;
            const avgY = sumY / coords.length;
            
            // Si es UTM, convertir a WGS84
            if (avgX > 100000 || avgY > 100000) {
                let zona;
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
        
        // Buscar en todos los datos cargados
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
                        console.log(`✅ ${cambio.nombre}: [${centro.lat}, ${centro.lon}] → DENTRO`);
                    }
                }
            }
        }
        
        console.log(`📊 Cambios en el área: ${cambiosEnArea.length}`);
        
        if (cambiosEnArea.length === 0) {
            mostrarMensaje('📭 No hay cambios en el área monitoreada', 'info');
            return;
        }
        
        // ============================================================
        // GENERAR MENSAJE Y ENVIAR CORREO CON EMAILJS
        // ============================================================
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
        
        // ============================================================
        // ENVIAR CORREO CON EMAILJS - USANDO TEMPLATE CORRECTO
        // ============================================================
        try {
            // Verificar que emailjs está disponible
            if (typeof emailjs === 'undefined') {
                throw new Error('EmailJS no está cargado');
            }
            
            console.log('📧 Enviando correo a:', email);
            
            // Usar el template contactus que ya existe
            const templateParams = {
                to_email: email,
                from_name: 'Visor de Concesiones Mineras',
                message: mensajeTexto,
                reply_to: email,
                total: total,
                date: new Date().toLocaleString('es-PE')
            };
            
            const result = await emailjs.send(
                'service_gmail_visor',
                'contactus',  // Usando template existente
                templateParams
            );
            
            console.log('✅ Correo enviado exitosamente');
            mostrarMensaje(`📧 Correo enviado con ${total} cambios en el área`, 'exito');
            
        } catch (emailError) {
            console.error('❌ Error detallado al enviar correo:');
            console.error('  - Mensaje:', emailError.message);
            if (emailError.text) {
                console.error('  - Detalle:', emailError.text);
            }
            if (emailError.status) {
                console.error('  - Código:', emailError.status);
            }
            
            // Intentar con método alternativo si falla EmailJS
            try {
                console.log('🔄 Intentando método alternativo...');
                const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        service_id: 'service_gmail_visor',
                        template_id: 'contactus',
                        user_id: '_PBGYuyGPuKRPK-_F',
                        template_params: {
                            to_email: email,
                            from_name: 'Visor de Concesiones Mineras',
                            message: mensajeTexto,
                            reply_to: email
                        }
                    })
                });
                
                if (response.ok) {
                    console.log('✅ Correo enviado (método alternativo)');
                    mostrarMensaje(`📧 Correo enviado con ${total} cambios en el área`, 'exito');
                } else {
                    const errorText = await response.text();
                    console.error('❌ Error en método alternativo:', errorText);
                    mostrarMensaje('Error al enviar correo. Revisa la consola.', 'error');
                }
            } catch (fallbackError) {
                console.error('❌ Error en método alternativo:', fallbackError);
                mostrarMensaje('Error al enviar correo. Revisa la consola.', 'error');
            }
        }
        
    } catch (error) {
        console.error(error);
        mostrarMensaje('Error al verificar cambios', 'error');
    }
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

function cancelarMonitoreo() {
    localStorage.removeItem('areaMonitoreada');
    localStorage.removeItem('emailAlertas');
    areaMonitoreada = null;
    limpiarDibujo();
    mostrarMensaje('🗑️ Monitoreo cancelado', 'info');
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarPopup(); });
document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});
document.addEventListener('DOMContentLoaded', initMap);