const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const activeSessions = new Map();

// ========== ROTA PRINCIPAL (CORRIGE O ERRO "Cannot GET /") ==========
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
// ====================================================================

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
    const { sessionId, apiKey, provider, model, systemPrompt, clinicName, attendantName } = req.body;
    
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
        console.log(`QR Code generated for ${sessionId}`);
        if (!qrCodeSent) {
            qrCodeSent = true;
            res.json({ success: true, qrCode: qr });
        }
    });
    
    client.on('ready', () => {
        console.log(`✅ WhatsApp connected for ${sessionId}`);
        activeSessions.set(sessionId, { 
            client, 
            apiKey, 
            provider, 
            model, 
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
        
        console.log(`📩 Message from ${message.from}: ${message.body}`);
        
        try {
            const response = await callAI(message.body, session);
            await client.sendMessage(message.from, response);
            console.log(`📤 Response sent to ${message.from}`);
        } catch (error) {
            console.error('Error:', error);
            await client.sendMessage(message.from, 'Desculpe, estou com um problema técnico. Tente novamente.');
        }
    });
    
    client.on('disconnected', () => {
        console.log(`❌ WhatsApp disconnected for ${sessionId}`);
        activeSessions.delete(sessionId);
    });
    
    await client.initialize();
    
    setTimeout(() => {
        if (!qrCodeSent) {
            res.json({ success: true, message: 'Waiting for QR code...', qrCode: null });
        }
    }, 5000);
});

async function callAI(userMessage, session) {
    const { apiKey, provider, model, systemPrompt, clinicName, attendantName } = session;
    
    const finalPrompt = (systemPrompt || 'Você é um atendente virtual')
        .replace(/{clinic_name}/g, clinicName || 'Clínica')
        .replace(/{attendant_name}/g, attendantName || 'Atendente');
    
    try {
        if (provider === 'groq') {
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: model || 'mixtral-8x7b-32768',
                messages: [
                    { role: 'system', content: finalPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data.choices[0].message.content;
        } else {
            return "Desculpe, provedor de IA não configurado. Use Groq.";
        }
    } catch (error) {
        console.error('AI Error:', error.response?.data || error.message);
        return "Desculpe, erro ao processar sua mensagem. Tente novamente.";
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 ClinicAI Backend running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/`);
});
