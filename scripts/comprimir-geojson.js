const fs = require('fs-extra');
const path = require('path');

async function comprimirGeoJSON() {
  const dataDir = path.join(__dirname, '..', 'data');
  const files = await fs.readdir(dataDir);
  
  for (const file of files) {
    if (file.endsWith('.geojson')) {
      console.log(`Comprimiendo ${file}...`);
      const filePath = path.join(dataDir, file);
      const geojson = await fs.readJson(filePath);
      
      // Guardar sin espacios (minificado)
      await fs.writeJson(filePath, geojson, { spaces: 0 });
      
      const stats = await fs.stat(filePath);
      console.log(`  ✓ Tamaño: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  console.log('✅ Compresión completada');
}

comprimirGeoJSON();