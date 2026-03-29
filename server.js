const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();

// CORS liberado para qualquer origem
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ==================== SUA API KEY DO GROQ ====================
const GROQ_API_KEY = "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"; // COLE SUA CHAVE AQUI
// ==============================================================

const activeSessions = new Map();

// Rota principal
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

// Rota de status
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

// Rota para iniciar WhatsApp
app.post('/api/start', async (req, res) => {
    console.log('📱 Requisição recebida em /api/start');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
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
        
        console.log(`📩 Mensagem de ${message.from}: ${message.body.substring(0, 50)}`);
        
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
            
            const reply = response.data.choices[0].message.content;
            await client.sendMessage(message.from, reply);
            console.log(`📤 Resposta enviada para ${message.from}`);
            
        } catch (error) {
            console.error('Erro ao processar:', error.message);
            await client.sendMessage(message.from, 'Desculpe, estou com um problema técnico. Tente novamente em alguns instantes.');
        }
    });
    
    client.on('disconnected', (reason) => {
        console.log(`❌ WhatsApp desconectado para ${sessionId}: ${reason}`);
        activeSessions.delete(sessionId);
    });
    
    client.on('auth_failure', (msg) => {
        console.log(`❌ Falha de autenticação: ${msg}`);
        activeSessions.delete(sessionId);
    });
    
    await client.initialize();
    
    // Timeout para caso não gere QR code
    setTimeout(() => {
        if (!qrCodeSent) {
            res.json({ success: true, message: 'Waiting for QR code...', qrCode: null });
        }
    }, 15000);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ClinicAI Backend running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/`);
});
