const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();

// CORS mais permissivo para teste
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// SUA API KEY DO GROQ
const GROQ_API_KEY = "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"; // COLE SUA CHAVE AQUI

const activeSessions = new Map();

app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'ClinicAI Backend is running!',
        endpoints: {
            start: 'POST /api/start',
            status: 'GET /api/status/:sessionId'
        }
    });
});

app.options('/api/start', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});

app.get('/api/status/:sessionId', (req, res) => {
    const session = activeSessions.get(req.params.sessionId);
    if (session && session.isReady) {
        res.json({ status: 'connected', ready: true });
    } else if (session) {
        res.json({ status: 'connecting', ready: false });
    } else {
        res.json({ status: 'disconnected', ready: false });
    }
});

app.post('/api/start', async (req, res) => {
    console.log('📱 Recebida requisição para /api/start');
    console.log('Body:', req.body);
    
    const { sessionId, systemPrompt, clinicName, attendantName } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }
    
    if (activeSessions.has(sessionId)) {
        return res.json({ success: true, message: 'Session already active' });
    }
    
    let qrCodeSent = false;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });
    
    client.on('qr', async (qr) => {
        console.log(`📱 QR Code gerado para ${sessionId}`);
        if (!qrCodeSent) {
            qrCodeSent = true;
            res.json({ success: true, qrCode: qr });
        }
    });
    
    client.on('ready', () => {
        console.log(`✅ WhatsApp conectado para ${sessionId}`);
        activeSessions.set(sessionId, { 
            client, 
            systemPrompt,
            clinicName,
            attendantName,
            isReady: true 
        });
    });
    
    client.on('message', async (message) => {
        const session = activeSessions.get(sessionId);
        if (!session || !session.isReady) return;
        if (message.fromMe) return;
        
        console.log(`📩 Mensagem de ${message.from}`);
        
        try {
            const response = await callGroqAI(message.body, session);
            await client.sendMessage(message.from, response);
            console.log(`📤 Resposta enviada`);
        } catch (error) {
            console.error('Erro:', error);
            await client.sendMessage(message.from, 'Desculpe, estou com um problema técnico. Tente novamente.');
        }
    });
    
    client.on('disconnected', () => {
        console.log(`❌ WhatsApp desconectado para ${sessionId}`);
        activeSessions.delete(sessionId);
    });
    
    await client.initialize();
    
    setTimeout(() => {
        if (!qrCodeSent) {
            res.json({ success: true, message: 'Waiting for QR code...', qrCode: null });
        }
    }, 10000);
});

async function callGroqAI(userMessage, session) {
    const { systemPrompt, clinicName, attendantName } = session;
    
    const finalPrompt = (systemPrompt || 'Você é um atendente virtual')
        .replace(/{clinic_name}/g, clinicName || 'Clínica')
        .replace(/{attendant_name}/g, attendantName || 'Atendente');
    
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'mixtral-8x7b-32768',
            messages: [
                { role: 'system', content: finalPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Groq API Error:', error.response?.data || error.message);
        return "Desculpe, estou com dificuldades técnicas. Por favor, tente novamente em alguns minutos.";
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ClinicAI Backend running on port ${PORT}`);
});
