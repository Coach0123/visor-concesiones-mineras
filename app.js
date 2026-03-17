// Configuración del mapa
let map;
let capas = {};
let popupAbierto = false;
let todosLosDatos = []; // Almacenar todos los datos para búsqueda global
let datosHistoricos = []; // Almacenar datos históricos mensuales
let rectanguloDibujo = null;
let puntosDibujo = [];
let capaDibujo = null;

// Función para corregir caracteres especiales
function corregirTexto(texto) {
    if (!texto || texto === 'N/A') return 'N/A';
    
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

// Detectar si estamos en GitHub Pages
const baseURL = window.location.hostname.includes('github.io') 
    ? '/visor-concesiones-mineras' 
    : '';

// Obtener fecha actual
const fechaHoy = new Date();
const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
}).replace(/\//g, '');

// Obtener hora actual para determinar qué archivos cargar
function obtenerHorariosActuales() {
    const ahora = new Date();
    const horaUTC = ahora.getUTCHours();
    const minutoUTC = ahora.getUTCMinutes();
    const horaPeru = (horaUTC - 5 + 24) % 24;
    
    // Horarios disponibles (cada hora)
    const horarios = [];
    for (let i = 0; i < 24; i++) {
        horarios.push(i.toString().padStart(2, '0'));
    }
    
    // Determinar horario actual (el más reciente)
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
    console.log(`Horarios sugeridos: ${horarioAnterior} y ${horarioActual}`);
    
    return { actual: horarioActual, anterior: horarioAnterior };
}

const horarios = obtenerHorariosActuales();
const zonas = ['17s', '18s', '19s'];

function initMap() {
    map = L.map('map').setView([-9.5, -75], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    // Inicializar controles de dibujo
    inicializarDibujo();
    
    cargarDatos();
    cargarCambios();
    cargarHistorialMensual();
}

// Función para cargar datos con respaldo automático
async function cargarDatos() {
    // Cargar cambios para colorear polígonos
    let cambiosMap = new Map();
    try {
        const cambiosResponse = await fetch(`${baseURL}/data/cambios.json`);
        if (cambiosResponse.ok) {
            const cambios = await cambiosResponse.json();
            console.log(`📊 Registros de cambios: ${cambios.length}`);
            cambios.forEach(cambio => {
                cambiosMap.set(cambio.codigo, cambio.tipo);
            });
        }
    } catch (error) {
        console.log('No hay cambios para colorear');
    }

    // Lista completa de horarios posibles (últimas 48 horas para respaldo)
    const horariosPrioritarios = [];
    const fechasRespaldo = [];
    
    // Fecha actual
    for (let i = 23; i >= 0; i--) {
        horariosPrioritarios.push({ fecha: fechaStr, hora: i.toString().padStart(2, '0') });
    }
    
    // Fecha anterior (para respaldo)
    const fechaAnterior = new Date(fechaHoy);
    fechaAnterior.setDate(fechaAnterior.getDate() - 1);
    const fechaAnteriorStr = fechaAnterior.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
    }).replace(/\//g, '');
    
    for (let i = 23; i >= 0; i--) {
        horariosPrioritarios.push({ fecha: fechaAnteriorStr, hora: i.toString().padStart(2, '0') });
    }

    let datosCargadosGlobalmente = false;

    for (const zona of zonas) {
        let datosCargados = null;
        let horarioCargado = null;
        let fechaCargada = null;
        
        // Probar cada horario hasta encontrar uno que exista
        for (const item of horariosPrioritarios) {
            const url = `${baseURL}/data/${zona}_${item.fecha}_${item.hora}.geojson`;
            
            try {
                const response = await fetch(url);
                if (response.ok) {
                    datosCargados = await response.json();
                    horarioCargado = item.hora;
                    fechaCargada = item.fecha;
                    console.log(`✅ ${zona} cargado con fecha ${item.fecha} horario ${item.hora}`);
                    datosCargadosGlobalmente = true;
                    break;
                }
            } catch (e) {
                // Ignorar errores de red
            }
        }
        
        if (datosCargados && horarioCargado) {
            console.log(`${zona}: ${datosCargados.features.length} polígonos`);
            
            // Almacenar todos los datos para búsqueda global
            todosLosDatos.push({
                zona: zona,
                fecha: fechaCargada,
                horario: horarioCargado,
                features: datosCargados.features
            });
            
            const getColor = (codigo) => {
                if (cambiosMap.has(codigo)) {
                    const tipo = cambiosMap.get(codigo);
                    return tipo === 'aparece' ? '#4444ff' : '#ff4444';
                }
                return '#888888';
            };
            
            const capa = L.geoJSON(datosCargados, {
                coordsToLatLng: (coords) => {
                    const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], zona);
                    return L.latLng(lat, lon);
                },
                style: (feature) => {
                    const codigo = feature.properties.CODIGOU;
                    return {
                        color: getColor(codigo),
                        weight: 1,
                        opacity: 0.7,
                        fillOpacity: 0.3
                    };
                },
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
        } else {
            console.warn(`⚠️ No se encontró archivo para zona ${zona}, usando datos de respaldo si existen`);
        }
    }
    
    if (!datosCargadosGlobalmente) {
        console.error('❌ No se pudo cargar ningún dato. Verifica la conexión o los archivos en GitHub');
        mostrarMensaje('No se pudieron cargar los datos. Verifica tu conexión o intenta más tarde.', 'error');
    }
}

// Cargar historial mensual
async function cargarHistorialMensual() {
    try {
        const mesActual = fechaHoy.getFullYear() + (fechaHoy.getMonth() + 1).toString().padStart(2, '0');
        const response = await fetch(`${baseURL}/data/historial_${mesActual}.geojson`);
        
        if (response.ok) {
            const historial = await response.json();
            console.log(`📜 Cargando ${historial.features.length} polígonos del historial mensual`);
            
            datosHistoricos = historial.features;
            
            // Mostrar en mapa con estilo diferente
            L.geoJSON(historial, {
                coordsToLatLng: (coords) => {
                    const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], '17s');
                    return L.latLng(lat, lon);
                },
                style: (feature) => {
                    return {
                        color: feature.properties.TIPO_CAMBIO === 'aparece' ? '#44ff44' : '#ff44ff',
                        weight: 2,
                        opacity: 0.8,
                        fillOpacity: 0.1,
                        dashArray: '5,5'
                    };
                },
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(`
                        <b>${corregirTexto(feature.properties.CONCESION)}</b><br>
                        ${feature.properties.TIPO_CAMBIO} el ${feature.properties.FECHA_CAMBIO}<br>
                        Titular: ${corregirTexto(feature.properties.TIT_CONCES)}
                    `);
                }
            }).addTo(map);
        }
    } catch (error) {
        console.log('No hay historial mensual disponible');
    }
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
            
            cambios.slice(-20).reverse().forEach(c => {
                const item = document.createElement('div');
                item.className = `cambio-item ${c.tipo}`;
                item.innerHTML = `<strong>${corregirTexto(c.nombre)}</strong><br><small>${c.tipo} - ${c.fecha}</small>`;
                div.appendChild(item);
            });
        }
    } catch (error) {
        document.getElementById('tabla-cambios').innerHTML = 'Error cargando cambios';
    }
}

// Buscador mejorado que incluye datos históricos
async function buscarConcesion() {
    const texto = document.getElementById('buscador').value.trim().toLowerCase();
    if (!texto) {
        alert('Ingrese un texto para buscar');
        return;
    }
    
    console.log(`🔍 Buscando: "${texto}"`);
    const resultados = [];
    
    // Buscar en datos actuales
    for (const zonaData of todosLosDatos) {
        for (const feature of zonaData.features) {
            const props = feature.properties;
            const concesion = (props.CONCESION || '').toLowerCase();
            const titular = (props.TIT_CONCES || '').toLowerCase();
            const codigo = (props.CODIGOU || '').toLowerCase();
            
            if (concesion.includes(texto) || titular.includes(texto) || codigo.includes(texto)) {
                resultados.push({
                    ...feature,
                    zona: zonaData.zona,
                    tipo: 'actual',
                    nombre: props.CONCESION || 'Sin nombre',
                    titular: props.TIT_CONCES || 'Sin titular'
                });
            }
        }
    }
    
    // Buscar en datos históricos (polígonos que ya no existen)
    for (const feature of datosHistoricos) {
        const props = feature.properties;
        const concesion = (props.CONCESION || '').toLowerCase();
        const titular = (props.TIT_CONCES || '').toLowerCase();
        const codigo = (props.CODIGOU || '').toLowerCase();
        
        if (concesion.includes(texto) || titular.includes(texto) || codigo.includes(texto)) {
            resultados.push({
                ...feature,
                zona: '17s',
                tipo: 'historico',
                nombre: props.CONCESION || 'Sin nombre',
                titular: props.TIT_CONCES || 'Sin titular'
            });
        }
    }
    
    const div = document.getElementById('resultados-busqueda');
    div.innerHTML = '';
    
    if (resultados.length === 0) {
        div.innerHTML = '<div class="resultado-item">No se encontraron resultados</div>';
        return;
    }
    
    // Eliminar duplicados por código
    const unicos = [];
    const codigosVistos = new Set();
    resultados.forEach(r => {
        if (!codigosVistos.has(r.properties.CODIGOU)) {
            codigosVistos.add(r.properties.CODIGOU);
            unicos.push(r);
        }
    });
    
    console.log(`✅ ${unicos.length} resultados únicos encontrados`);
    
    unicos.slice(0, 25).forEach(r => {
        const item = document.createElement('div');
        item.className = 'resultado-item' + (r.tipo === 'historico' ? ' historico' : '');
        const icono = r.tipo === 'historico' ? '📜 ' : '';
        item.textContent = `${icono}${corregirTexto(r.nombre)} - ${corregirTexto(r.titular)}`;
        item.onclick = () => {
            cerrarPopup();
            if (r.geometry.type === 'Polygon') {
                const coords = r.geometry.coordinates[0];
                let sumX = 0, sumY = 0;
                coords.forEach(coord => {
                    sumX += coord[0];
                    sumY += coord[1];
                });
                const centerX = sumX / coords.length;
                const centerY = sumY / coords.length;
                const [lat, lon] = convertirUTM_A_WGS84(centerX, centerY, r.zona || '17s');
                map.setView([lat, lon], 14);
            }
        };
        div.appendChild(item);
    });
}

// Función mejorada para cargar archivos
async function cargarArchivo() {
    const input = document.getElementById('archivo-input');
    const archivo = input.files[0];
    
    if (!archivo) return;
    
    const reader = new FileReader();
    const extension = archivo.name.split('.').pop().toLowerCase();
    
    reader.onload = async function(e) {
        try {
            let geojson = null;
            
            if (extension === 'geojson' || extension === 'json') {
                geojson = JSON.parse(e.target.result);
            } else if (extension === 'kml') {
                mostrarMensaje('Para KML necesitas la biblioteca togeojson. Por ahora, convierte a GeoJSON.', 'info');
                return;
            } else if (extension === 'zip' || extension === 'rar') {
                mostrarMensaje('Los archivos ZIP/RAR deben contener shapefile. Extrae y sube el .shp', 'info');
                return;
            } else if (extension === 'shp') {
                mostrarMensaje('Para shapefiles, usa un ZIP con .shp, .dbf, .shx', 'info');
                return;
            }
            
            if (geojson) {
                mostrarAreaInteres(geojson);
                mostrarMensaje(`Archivo cargado: ${archivo.name}`, 'exito');
            }
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            mostrarMensaje('Error al procesar el archivo', 'error');
        }
    };
    
    if (extension === 'kml' || extension === 'geojson' || extension === 'json') {
        reader.readAsText(archivo);
    } else {
        reader.readAsArrayBuffer(archivo);
    }
}

// Inicializar herramientas de dibujo
function inicializarDibujo() {
    // Las funciones ya están definidas globalmente
    console.log('🖌️ Herramientas de dibujo inicializadas');
}

// Variables para dibujo
let dibujando = false;
let puntoInicio = null;

function activarDibujoRectangulo() {
    dibujando = true;
    puntoInicio = null;
    map.getContainer().style.cursor = 'crosshair';
    mostrarMensaje('Haz clic para iniciar el rectángulo, luego otro clic para completar', 'info');
    
    map.on('click', function(e) {
        if (!dibujando) return;
        
        if (!puntoInicio) {
            puntoInicio = e.latlng;
            mostrarMensaje('Ahora haz clic en la esquina opuesta', 'info');
        } else {
            const puntoFin = e.latlng;
            
            // Crear rectángulo
            const bounds = L.latLngBounds(puntoInicio, puntoFin);
            
            if (capaDibujo) {
                map.removeLayer(capaDibujo);
            }
            
            capaDibujo = L.rectangle(bounds, {
                color: '#ff44ff',
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.2
            }).addTo(map);
            
            // Guardar área para envío por correo
            rectanguloDibujo = bounds;
            
            dibujando = false;
            map.getContainer().style.cursor = '';
            map.off('click');
            mostrarMensaje('Área dibujada correctamente', 'exito');
        }
    });
}

function limpiarDibujo() {
    if (capaDibujo) {
        map.removeLayer(capaDibujo);
        capaDibujo = null;
        rectanguloDibujo = null;
    }
    if (marcadorBusqueda) {
        map.removeLayer(marcadorBusqueda);
        marcadorBusqueda = null;
    }
    dibujando = false;
    map.getContainer().style.cursor = '';
    map.off('click');
    mostrarMensaje('Dibujo limpiado', 'info');
}

// Función para enviar área por correo
async function enviarAreaPorCorreo() {
    if (!rectanguloDibujo) {
        mostrarMensaje('Primero dibuja un área en el mapa', 'error');
        return;
    }
    
    const email = prompt('Ingresa tu correo electrónico:');
    if (!email) return;
    
    mostrarMensaje('Procesando polígonos en el área...', 'info');
    
    // Obtener todos los polígonos dentro del área
    const poligonosEnArea = [];
    
    for (const zonaData of todosLosDatos) {
        for (const feature of zonaData.features) {
            if (feature.geometry.type === 'Polygon') {
                const coords = feature.geometry.coordinates[0];
                const centro = coords.reduce((acc, coord) => {
                    const [lat, lon] = convertirUTM_A_WGS84(coord[0], coord[1], zonaData.zona);
                    return [acc[0] + lat, acc[1] + lon];
                }, [0, 0]);
                
                const centroLat = centro[0] / coords.length;
                const centroLon = centro[1] / coords.length;
                
                if (rectanguloDibujo.contains([centroLat, centroLon])) {
                    poligonosEnArea.push(feature.properties);
                }
            }
        }
    }
    
    // Generar CSV
    let csv = 'CODIGOU,FEC_DENU,CONCESION,TIT_CONCES\n';
    poligonosEnArea.forEach(p => {
        csv += `"${p.CODIGOU || ''}","${p.FEC_DENU || ''}","${p.CONCESION || ''}","${p.TIT_CONCES || ''}"\n`;
    });
    
    // Descargar CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poligonos_area_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    
    mostrarMensaje(`Se encontraron ${poligonosEnArea.length} polígonos. CSV descargado.`, 'exito');
}

function mostrarAreaInteres(geojson) {
    if (capaAreaInteres) {
        map.removeLayer(capaAreaInteres);
    }
    
    capaAreaInteres = L.geoJSON(geojson, {
        style: {
            color: '#44ff44',
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.1,
            dashArray: '5, 10'
        },
        onEachFeature: (feature, layer) => {
            layer.bindPopup('Área de interés cargada');
        }
    }).addTo(map);
    
    map.fitBounds(capaAreaInteres.getBounds());
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
            cerrarPopup();
            map.setView([parts[0], parts[1]], 12);
            
            if (marcadorBusqueda) {
                map.removeLayer(marcadorBusqueda);
            }
            marcadorBusqueda = L.marker([parts[0], parts[1]]).addTo(map);
            mostrarMensaje(`Coordenadas: ${parts[0]}, ${parts[1]}`, 'info');
        }
    }
}

function mostrarMensaje(texto, tipo = 'info') {
    const msgDiv = document.getElementById('mensaje-emergente');
    if (!msgDiv) return;
    
    msgDiv.textContent = texto;
    msgDiv.style.backgroundColor = tipo === 'error' ? '#ff4444' : (tipo === 'exito' ? '#4CAF50' : '#333');
    msgDiv.style.display = 'block';
    
    setTimeout(() => {
        msgDiv.style.display = 'none';
    }, 3000);
}

// Variables globales
let marcadorBusqueda;
let capaAreaInteres;

// Event listeners
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        cerrarPopup();
        limpiarDibujo();
    }
});

document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});

document.addEventListener('DOMContentLoaded', initMap);