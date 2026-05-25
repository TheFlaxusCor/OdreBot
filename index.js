const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// 🟢 1. ELIMINADOR DE BLOQUEOS FANTASMAS (Soluciona el Error 21)
const authDir = path.join(__dirname, '.wwebjs_auth');
if (fs.existsSync(authDir)) {
    const folders = fs.readdirSync(authDir);
    folders.forEach(folder => {
        const lockFile = path.join(authDir, folder, 'SingletonLock');
        if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
            console.log(`🧹 Candado de Chromium eliminado en la sesión: ${folder}`);
        }
    });
}

// 🟢 2. CONFIGURACIÓN DEL CLIENTE
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium', // Ruta garantizada por Docker
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
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