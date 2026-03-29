const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const GROQ_API_KEY = "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"; // COLE SUA CHAVE AQUI

const sessions = new Map();

app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'ClinicAI Backend is running!' });
});

app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session && session.ready) {
        res.json({ status: 'connected', ready: true });
    } else if (session) {
        res.json({ status: 'connecting', ready: false });
    } else {
        res.json({ status: 'disconnected', ready: false });
    }
});

app.post('/api/start', async (req, res) => {
    const { sessionId, systemPrompt, clinicName, attendantName } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }
    
    if (sessions.has(sessionId)) {
        return res.json({ success: true, message: 'Session already active' });
    }
    
    let qrSent = false;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });
    
    client.on('qr', async (qr) => {
        console.log(`QR Code gerado para ${sessionId}`);
        if (!qrSent) {
            qrSent = true;
            // Envia o QR code como resposta
            res.json({ success: true, qrCode: qr });
        }
    });
    
    client.on('ready', () => {
        console.log(`✅ WhatsApp conectado: ${sessionId}`);
        sessions.set(sessionId, {
            client,
            systemPrompt,
            clinicName,
            attendantName,
            ready: true
        });
    });
    
    client.on('message', async (message) => {
        const session = sessions.get(sessionId);
        if (!session || !session.ready) return;
        if (message.fromMe) return;
        
        console.log(`📩 Mensagem: ${message.body.substring(0, 50)}`);
        
        try {
            const finalPrompt = (session.systemPrompt || 'Você é um atendente virtual')
                .replace(/{clinic_name}/g, session.clinicName || 'Clínica')
                .replace(/{attendant_name}/g, session.attendantName || 'Atendente');
            
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'mixtral-8x7b-32768',
                messages: [
                    { role: 'system', content: finalPrompt },
                    { role: 'user', content: message.body }
                ],
                temperature: 0.7,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            
            await client.sendMessage(message.from, response.data.choices[0].message.content);
            console.log(`📤 Resposta enviada`);
        } catch (error) {
            console.error('Erro IA:', error.message);
            await client.sendMessage(message.from, 'Desculpe, estou com um problema técnico. Tente novamente.');
        }
    });
    
    client.on('disconnected', () => {
        console.log(`❌ Desconectado: ${sessionId}`);
        sessions.delete(sessionId);
    });
    
    await client.initialize();
    
    // Timeout de segurança
    setTimeout(() => {
        if (!qrSent) {
            res.json({ success: true, message: 'Aguardando QR code...', qrCode: null });
        }
    }, 10000);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
