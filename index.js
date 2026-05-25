const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // 🟢 Eliminamos el executablePath. Dejaremos que Puppeteer use su propio motor.
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

// client.on('qr', qr => { ...
// 3. EVENTO: BOT LISTO
client.on('ready', () => {
    console.log('✅ ¡Bot de WhatsApp de Odrekao en línea y enlazado!');
});

// 4. EL PUENTE DE COMUNICACIÓN (Endpoint para FastAPI)
app.post('/notificar', async (req, res) => {
    const { mensaje, grupoId } = req.body;
    
    if (!mensaje) {
        return res.status(400).json({ error: 'Falta el mensaje' });
    }

    try {
        // NOTA: Para las pruebas locales, puedes enviarte el mensaje a tu propio número.
        // El formato es: tunumero@c.us (ej. 573001234567@c.us)
        // Para grupos el formato es: id_del_grupo@g.us
        
        const target = grupoId || '573132391143@c.us'; 
        
        await client.sendMessage(target, mensaje);
        console.log(`✉️ Mensaje enviado con éxito: ${mensaje}`);
        res.status(200).json({ status: 'Mensaje enviado con éxito' });

    } catch (error) {
        console.error('❌ Fallo al enviar mensaje:', error);
        res.status(500).json({ error: 'Fallo al enviar mensaje', detalle: error.message });
    }
});

// 5. INICIAR SISTEMAS
client.initialize();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor puente escuchando en el puerto ${PORT}`));