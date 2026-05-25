const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ==========================================
// SECCIÓN 2️⃣: LIMPIEZA PROFUNDA DE BLOQUEOS (Error 21)
// ==========================================
const authDir = path.join(__dirname, '.wwebjs_auth');

function limpiarCandadosRecursivo(directorio) {
    if (!fs.existsSync(directorio)) return;

    const archivos = fs.readdirSync(directorio);
    archivos.forEach(archivo => {
        const rutaCompleta = path.join(directorio, archivo);
        const stat = fs.statSync(rutaCompleta);

        if (stat.isDirectory()) {
            // Recursión para entrar en las subcarpetas de la sesión
            limpiarCandadosRecursivo(rutaCompleta);
        } else {
            // Chromium genera 'SingletonLock', 'SingletonCookie' o 'SingletonSocket'
            if (archivo.includes('SingletonLock') || archivo.includes('SingletonCookie')) {
                try {
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🧹 Candado eliminado críticamente en: ${rutaCompleta}`);
                } catch (err) {
                    console.error(`⚠️ No se pudo eliminar el candado en ${rutaCompleta}:`, err.message);
                }
            }
        }
    });
}

// Ejecutar la limpieza antes de cualquier inicialización
console.log('Iniciando escaneo de candados persistentes...');
limpiarCandadosRecursivo(authDir);

// ==========================================
// SECCIÓN 3️⃣: CONFIGURACIÓN DEL CLIENTE WhatsApp
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: authDir // Aseguramos que use explícitamente esta ruta
    }),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            // 🔥 ARGUMENTOS CRUCIALES PARA EVITAR EL ERROR 21 EN CONTENEDORES:
            '--disable-single-click-autofill',
            '--disable-extensions',
            '--user-data-dir=/app/.wwebjs_auth', // Forzamos a Chromium a usar exactamente esta ruta mapeada
        ]
    }
});

// 🟢 3. EVENTO: MOSTRAR CÓDIGO QR (¡Lo tenías oculto!)
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('👆 Escanea el código QR de arriba con tu WhatsApp');
});

// 4. EVENTO: BOT LISTO
client.on('ready', () => {
    console.log('✅ ¡Bot de WhatsApp de Odrekao en línea y enlazado!');
});

// 5. EL PUENTE DE COMUNICACIÓN (Endpoint para FastAPI)
app.post('/notificar', async (req, res) => {
    const { mensaje, grupoId } = req.body;
    
    if (!mensaje) {
        return res.status(400).json({ error: 'Falta el mensaje' });
    }

    try {
        const target = grupoId || '573132391143@c.us'; 
        await client.sendMessage(target, mensaje);
        console.log(`✉️ Mensaje enviado con éxito: ${mensaje}`);
        res.status(200).json({ status: 'Mensaje enviado con éxito' });

    } catch (error) {
        console.error('❌ Fallo al enviar mensaje:', error);
        res.status(500).json({ error: 'Fallo al enviar mensaje', detalle: error.message });
    }
});

// 6. INICIAR SISTEMAS
client.initialize();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor puente escuchando en el puerto ${PORT}`));