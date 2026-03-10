// Configuración del mapa
let map;
let capas = {};
let popupAbierto = false;

// Función para corregir caracteres especiales
function corregirTexto(texto) {
    if (!texto) return 'N/A';
    if (texto === 'N/A') return 'N/A';
    
    // Reemplazar caracteres mal codificados
    const reemplazos = {
        'Ã‘': 'Ñ',
        'Ã±': 'ñ',
        'Ã‰': 'É',
        'Ã©': 'é',
        'Ã ': 'Á',
        'Ã¡': 'á',
        'Ã“': 'Ó',
        'Ã³': 'ó',
        'Ãš': 'Ú',
        'Ãº': 'ú',
        'Ã ': 'Í',
        'Ã­': 'í',
        'Ãœ': 'Ü',
        'Ã¼': 'ü',
        'Ã€': 'À',
        'Ã ': 'à',
        'ÃŠ': 'Ê',
        'Ãª': 'ê',
        'Ã‡': 'Ç',
        'Ã§': 'ç',
        'Â¿': '¿',
        'Â¡': '¡',
        'Â°': '°',
        'â€™': "'",
        'â€œ': '"',
        'â€': '"',
        'Â´': "'",
        'Ã': 'í',
        '³': 'ó',
        '±': 'ñ'
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
        console.error('Error en conversión:', e);
        return [y, x];
    }
}

const fechaHoy = new Date();
const fechaStr = fechaHoy.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
}).replace(/\//g, '');

const zonas = ['17s', '18s', '19s'];

function initMap() {
    console.log('Iniciando mapa...');
    
    map = L.map('map').setView([-9.5, -75], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    
    console.log('Mapa listo');
    cargarDatos();
}

async function cargarDatos() {
    for (const zona of zonas) {
        try {
            console.log(`Cargando ${zona}...`);
            const response = await fetch(`data/${zona}_${fechaStr}.geojson`);
            
            if (response.ok) {
                const datos = await response.json();
                console.log(`${zona}: ${datos.features.length} polígonos`);
                
                const capa = L.geoJSON(datos, {
                    coordsToLatLng: function(coords) {
                        const [lat, lon] = convertirUTM_A_WGS84(coords[0], coords[1], zona);
                        return L.latLng(lat, lon);
                    },
                    style: {
                        color: '#888888', // Gris para todos
                        weight: 1,
                        opacity: 0.7,
                        fillOpacity: 0.3
                    },
                    onEachFeature: (feature, layer) => {
                        layer.on('click', () => {
                            // Cerrar popup anterior
                            cerrarPopup();
                            
                            const props = feature.properties;
                            
                            // Formatear fecha si es necesario
                            let fecha = props.FEC_DENU || 'N/A';
                            if (fecha.includes('GMT')) {
                                try {
                                    const date = new Date(fecha);
                                    fecha = date.toLocaleDateString('es-PE');
                                } catch (e) {
                                    // Si falla, dejar como está
                                }
                            }
                            
                            // Asignar valores a la tabla con corrección de caracteres
                            document.getElementById('info-codigo').textContent = corregirTexto(props.CODIGOU);
                            document.getElementById('info-fecha').textContent = corregirTexto(fecha);
                            document.getElementById('info-concesion').textContent = corregirTexto(props.CONCESION);
                            document.getElementById('info-titular').textContent = corregirTexto(props.TIT_CONCES);
                            
                            // Mostrar el popup
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

function cerrarPopup() {
    document.getElementById('info-popup').style.display = 'none';
    popupAbierto = false;
}

async function buscarConcesion() {
    const texto = document.getElementById('buscador').value.toLowerCase();
    if (!texto) return;
    
    const resultados = [];
    
    for (const zona of zonas) {
        try {
            const response = await fetch(`data/${zona}_${fechaStr}.geojson`);
            if (response.ok) {
                const datos = await response.json();
                datos.features.forEach(feature => {
                    const props = feature.properties;
                    // Buscar en los campos específicos
                    if ((props.CODIGOU && props.CODIGOU.toLowerCase().includes(texto)) ||
                        (props.FEC_DENU && props.FEC_DENU.toLowerCase().includes(texto)) ||
                        (props.CONCESION && props.CONCESION.toLowerCase().includes(texto)) ||
                        (props.TIT_CONCES && props.TIT_CONCES.toLowerCase().includes(texto))) {
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
        item.textContent = `${corregirTexto(r.properties.CONCESION) || 'Sin nombre'} - ${corregirTexto(r.properties.TIT_CONCES) || 'Sin titular'}`;
        item.onclick = () => {
            cerrarPopup();
            if (r.geometry.type === 'Polygon') {
                // Calcular centro aproximado del polígono
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

// Cerrar popup con Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        cerrarPopup();
    }
});

// Cerrar popup haciendo clic fuera
document.addEventListener('click', (e) => {
    if (popupAbierto && !e.target.closest('.info-popup') && !e.target.closest('.leaflet-interactive')) {
        cerrarPopup();
    }
});

document.addEventListener('DOMContentLoaded', initMap);