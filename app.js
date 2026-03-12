// Configuración del mapa
let map;
let capas = {};
let popupAbierto = false;

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

// Obtener fecha y hora actual
const fechaHoy = new Date();
const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
}).replace(/\//g, '');

// Obtener hora actual en Perú para determinar qué archivos cargar
function obtenerHorariosActuales() {
    const ahora = new Date();
    const horaUTC = ahora.getUTCHours();
    const horaPeru = (horaUTC - 5 + 24) % 24;
    
    // Horarios disponibles
    const horarios = ['01', '06', '11', '16', '21'];
    
    // Determinar horario actual y anterior
    let horarioActual = '21';
    for (let i = 0; i < horarios.length; i++) {
        if (horaPeru <= parseInt(horarios[i])) {
            horarioActual = horarios[i];
            break;
        }
    }
    
    const indexActual = horarios.indexOf(horarioActual);
    const horarioAnterior = indexActual > 0 ? horarios[indexActual - 1] : horarios[horarios.length - 1];
    
    console.log(`Hora Perú: ${horaPeru}:00`);
    console.log(`Cargando horarios: ${horarioAnterior} y ${horarioActual}`);
    
    return { actual: horarioActual, anterior: horarioAnterior };
}

const horarios = obtenerHorariosActuales();
const zonas = ['17s', '18s', '19s'];

function initMap() {
    map = L.map('map').setView([-9.5, -75], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    cargarDatos();
    cargarCambios();
}

async function cargarDatos() {
    for (const zona of zonas) {
        try {
            // Intentar cargar primero el horario actual, luego el anterior
            const archivoActual = `${baseURL}/data/${zona}_${fechaStr}_${horarios.actual}.geojson`;
            const archivoAnterior = `${baseURL}/data/${zona}_${fechaStr}_${horarios.anterior}.geojson`;
            
            console.log(`Buscando: ${archivoActual}`);
            
            let response = await fetch(archivoActual);
            let datos, fechaArchivo = horarios.actual;
            
            if (!response.ok) {
                console.log(`No encontrado, intentando: ${archivoAnterior}`);
                response = await fetch(archivoAnterior);
                fechaArchivo = horarios.anterior;
            }
            
            if (response.ok) {
                datos = await response.json();
                console.log(`${zona}: ${datos.features.length} polígonos (horario ${fechaArchivo})`);
                
                const capa = L.geoJSON(datos, {
                    coordsToLatLng: (coords) => {
                        const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], zona);
                        return L.latLng(lat, lon);
                    },
                    style: { color: '#888888', weight: 1, opacity: 0.7, fillOpacity: 0.3 },
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
        } catch (error) {
            console.error(`Error en ${zona}:`, error);
        }
    }
}

async function buscarConcesion() {
    const texto = document.getElementById('buscador').value.toLowerCase();
    if (!texto) return;
    
    const resultados = [];
    
    for (const zona of zonas) {
        try {
            const response = await fetch(`${baseURL}/data/${zona}_${fechaStr}_${horarios.actual}.geojson`);
            if (response.ok) {
                const datos = await response.json();
                datos.features.forEach(feature => {
                    const props = feature.properties;
                    if (props.CODIGOU?.toLowerCase().includes(texto) ||
                        props.CONCESION?.toLowerCase().includes(texto) ||
                        props.TIT_CONCES?.toLowerCase().includes(texto)) {
                        resultados.push({...feature, zona});
                    }
                });
            }
        } catch (error) {}
    }
    
    const div = document.getElementById('resultados-busqueda');
    div.innerHTML = '';
    
    if (resultados.length === 0) {
        div.innerHTML = '<div class="resultado-item">No se encontraron resultados</div>';
        return;
    }
    
    resultados.slice(0, 10).forEach(r => {
        const item = document.createElement('div');
        item.className = 'resultado-item';
        item.textContent = `${corregirTexto(r.properties.CONCESION)} - ${corregirTexto(r.properties.TIT_CONCES)}`;
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
                const [lat, lon] = convertirUTM_A_WGS84(centerX, centerY, r.zona);
                map.setView([lat, lon], 14);
            }
        };
        div.appendChild(item);
    });
}

async function cargarCambios() {
    try {
        const response = await fetch(`${baseURL}/data/cambios.json`);
        if (response.ok) {
            const cambios = await response.json();
            const div = document.getElementById('tabla-cambios');
            div.innerHTML = '';
            
            cambios.slice(-10).reverse().forEach(c => {
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

function cerrarPopup() {
    document.getElementById('info-popup').style.display = 'none';
    popupAbierto = false;
}

function cargarArchivo() {
    alert('Función en desarrollo');
}

function buscarCoordenadas() {
    const texto = document.getElementById('coordenadas-texto').value;
    if (texto) {
        const parts = texto.split(',').map(Number);
        if (parts.length === 2) {
            cerrarPopup();
            map.setView([parts[0], parts[1]], 12);
        }
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarPopup();
});

document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});

document.addEventListener('DOMContentLoaded', initMap);