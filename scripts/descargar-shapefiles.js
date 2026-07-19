const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const DATA_DIR = path.join(__dirname, '..', 'data');

// URLs de descarga
const urls = {
    '17s': 'https://geocatmin2025.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_17S.zip',
    '18s': 'https://geocatmin2025.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_18S.zip',
    '19s': 'https://geocatmin2025.ingemmet.gob.pe/complementos/Descargas/DESCARGA_WGS84/DESCARGA/CMI_WGS84_19S.zip'
};

// Función para descargar un archivo
function descargarArchivo(url, destino) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destino);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Error ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
            file.on('error', reject);
        }).on('error', reject);
    });
}

// Función para convertir SHP a GeoJSON
async function convertirShapefileAZip(zipPath, zona) {
    const tempDir = path.join(DATA_DIR, 'temp_' + zona);
    await fs.ensureDir(tempDir);
    
    // Extraer ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    
    // Buscar el archivo .shp
    const archivos = await fs.readdir(tempDir);
    const shpFile = archivos.find(f => f.endsWith('.shp'));
    
    if (!shpFile) {
        throw new Error(`No se encontró archivo .shp para zona ${zona}`);
    }
    
    const shpPath = path.join(tempDir, shpFile);
    
    // ============================================================
    // GENERAR FECHA Y HORA FIJA EN 21 (8 PM)
    // ============================================================
    const fecha = new Date();
    // Ajustar a las 21:00 (8 PM) hora Perú
    fecha.setHours(21, 0, 0, 0);
    
    const d = fecha.getDate().toString().padStart(2, '0');
    const m = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const a = fecha.getFullYear().toString().slice(-2);
    const fechaStr = `${d}${m}${a}`;
    
    // ============================================================
    // GENERAR NOMBRE DEL ARCHIVO CON HORA FIJA 21
    // ============================================================
    const outputFile = path.join(DATA_DIR, `${zona}_${fechaStr}_21.geojson`);
    
    // ============================================================
    // CONVERTIR CON OGR2OGR
    // ============================================================
    const comando = `ogr2ogr -f GeoJSON "${outputFile}" "${shpPath}"`;
    
    try {
        await execPromise(comando);
        console.log(`✅ Convertido ${zona} -> ${outputFile}`);
    } catch (error) {
        console.error(`❌ Error convirtiendo ${zona}:`, error.message);
        throw error;
    }
    
    // Limpiar archivos temporales
    await fs.remove(tempDir);
    await fs.remove(zipPath);
}

// Función principal
async function main() {
    console.log('🚀 Iniciando descarga de shapefiles...');
    console.log(`📅 Fecha: ${new Date().toLocaleString('es-PE')}`);
    
    // Crear carpeta data si no existe
    await fs.ensureDir(DATA_DIR);
    
    for (const [zona, url] of Object.entries(urls)) {
        console.log(`\n📥 Descargando zona ${zona}...`);
        const zipPath = path.join(DATA_DIR, `temp_${zona}.zip`);
        
        try {
            await descargarArchivo(url, zipPath);
            console.log(`✅ Descargado ${zona}`);
            
            await convertirShapefileAZip(zipPath, zona);
            console.log(`✅ Procesado ${zona}`);
        } catch (error) {
            console.error(`❌ Error en zona ${zona}:`, error.message);
        }
    }
    
    console.log('\n🎉 Descarga completada');
}

main().catch(console.error);