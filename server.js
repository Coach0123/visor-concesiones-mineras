const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Endpoint para guardar el área monitoreada
app.post('/guardar-area', (req, res) => {
    try {
        const areaData = req.body;
        const filePath = path.join(__dirname, 'data', 'area_monitoreada.json');
        fs.writeFileSync(filePath, JSON.stringify(areaData, null, 2));
        console.log('✅ Área guardada:', areaData.bounds);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Error guardando área:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint para obtener el área guardada
app.get('/obtener-area', (req, res) => {
    try {
        const filePath = path.join(__dirname, 'data', 'area_monitoreada.json');
        if (fs.existsSync(filePath)) {
            const areaData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            res.status(200).json(areaData);
        } else {
            res.status(404).json({ success: false, error: 'No hay área guardada' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});