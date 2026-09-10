require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { gerarPayloadPix } = require('./pix.js');

// 🔒 1. SEGURANÇA E AMBIENTE: Validação estrita sem vazamento de credenciais
if (!process.env.JWT_SECRET) {
    console.error('CRITICAL ERROR: JWT_SECRET não está definido nas variáveis de ambiente (.env).');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.PIX_CHAVE) {
    console.warn('⚠️ AVISO: PIX_CHAVE não definida no .env. Pagamentos via PIX vão falhar.');
}
const PIX_CHAVE = process.env.PIX_CHAVE || '';
const PIX_NOME = (process.env.PIX_NOME || 'Barbearia Estilo').substring(0, 25);
const PIX_CIDADE = (process.env.PIX_CIDADE || 'Sao Paulo').substring(0, 15);

const app = express();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(express.json());

const origensPermitidas = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null;

if (!origensPermitidas) {
    console.warn('⚠️ AVISO: ALLOWED_ORIGINS não definido. CORS está liberado para qualquer origem.');
}

app.use(cors({
    origin: origensPermitidas || '*',
}));

app.use(express.static(__dirname + '/public'));

const limiterGeral = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { sucesso: false, erro: 'Muitas requisições. Tente novamente mais tarde.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Muitas tentativas de login/registro. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 12,
    message: { resposta: 'Você está enviando mensagens muito rápido. Por favor, aguarde alguns segundos.' }
});

app.use('/api/', limiterGeral);

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME || 'barbearia',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const ejecutarQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

db.getConnection(async (err, connection) => {
    if (err) {
        console.error('Erro ao conectar ao Pool do MySQL:', err.message);
    } else {
        console.log('Conectado ao Pool do MySQL com sucesso!');
        connection.release();

        try {
            await ejecutarQuery(`
                CREATE TABLE IF NOT EXISTS bot_historico_mensagens (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    barbearia_id INT NOT NULL,
                    cliente_identificador VARCHAR(100) NOT NULL,
                    papel ENUM('user', 'model') NOT NULL,
                    mensagem TEXT NOT NULL,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_cliente_barbearia (barbearia_id, cliente_identificador)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
        } catch (dbSetupErr) {
            console.error('Erro ao verificar/criar tabela de histórico do bot:', dbSetupErr.message);
        }
    }
});

const autenticarJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Acesso negado. Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Token inválido ou expirado.' });
    }
};

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

function dividirMensagemEmBlocos(texto, tamanhoMax = 280) {
    if (texto.length <= tamanhoMax) return [texto];
    const paragrafos = texto.split('\n');
    const blocos = [];
    let blocoAtual = '';

    for (const p of paragrafos) {
        if ((blocoAtual + '\n' + p).trim().length > tamanhoMax) {
            if (blocoAtual) blocos.push(blocoAtual.trim());
            blocoAtual = p;
        } else {
            blocoAtual += (blocoAtual ? '\n' : '') + p;
        }
    }
    if (blocoAtual.trim()) blocos.push(blocoAtual.trim());
    return blocos;
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================

app.post('/api/auth/register', autenticarJWT, authLimiter, async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    if (senha.length < 6) {
        return res.status(400).json({ success: false, message: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    const barbeariaIdFinal = req.usuario.barbearia_id || req.usuario.id_barbearia || 1;

    try {
        const usuarioExiste = await ejecutarQuery('SELECT id FROM usuarios WHERE usuario = ?', [usuario]);
        if (usuarioExiste.length > 0) {
            return res.status(400).json({ success: false, message: 'Este nome de usuário já está em uso.' });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        await ejecutarQuery(
            'INSERT INTO usuarios (usuario, senha, barbearia_id) VALUES (?, ?, ?)',
            [usuario, senhaHash, barbeariaIdFinal]
        );

        return res.status(201).json({ success: true, message: 'Usuário cadastrado com sucesso!' });
    } catch (err) {
        console.error('Erro no registro:', err);
        return res.status(500).json({ success: false, message: 'Erro interno ao registrar usuário.' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ success: false, message: 'Preencha usuário e senha.' });
    }

    try {
        const resultados = await ejecutarQuery('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);

        if (resultados.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
        }

        const usuarioBanco = resultados[0];
        const senhaValida = await bcrypt.compare(senha, usuarioBanco.senha);

        if (!senhaValida) {
            return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
        }

        const barbeariaId = usuarioBanco.barbearia_id || usuarioBanco.id_barbearia || 1;

        const token = jwt.sign(
            {
                id: usuarioBanco.id,
                barbearia_id: barbeariaId,
                id_barbearia: barbeariaId,
                usuario: usuarioBanco.usuario
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({
            success: true,
            token,
            usuario: {
                id: usuarioBanco.id,
                usuario: usuarioBanco.usuario,
                barbearia_id: barbeariaId,
                id_barbearia: barbeariaId
            }
        });

    } catch (err) {
        console.error('Erro no login:', err);
        return res.status(500).json({ success: false, message: 'Erro interno ao realizar login.' });
    }
});

// ==========================================
// ROTAS DE CONFIGURAÇÕES DA EMPRESA
// ==========================================

app.get('/api/empresa/configuracoes', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia;
        const resultado = await ejecutarQuery('SELECT mensagem_boas_vindas FROM empresas WHERE id = ?', [barbeariaId]);
        return res.json({
            success: true,
            mensagem_boas_vindas: resultado.length > 0 ? (resultado[0].mensagem_boas_vindas || '') : ''
        });
    } catch (err) {
        console.error('Erro ao carregar configurações:', err);
        return res.status(500).json({ success: false, message: 'Erro ao carregar configurações.' });
    }
});

app.patch('/api/empresa/boas-vindas', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia;
        const { mensagem_boas_vindas } = req.body;
        await ejecutarQuery(
            'UPDATE empresas SET mensagem_boas_vindas = ? WHERE id = ?',
            [mensagem_boas_vindas && mensagem_boas_vindas.trim() ? mensagem_boas_vindas.trim() : null, barbeariaId]
        );
        return res.json({ success: true, message: 'Mensagem atualizada com sucesso!' });
    } catch (err) {
        console.error('Erro ao salvar mensagem de boas-vindas:', err);
        return res.status(500).json({ success: false, message: 'Erro ao salvar mensagem.' });
    }
});

// NOVO: Status de conexão do bot do WhatsApp (para o painel exibir o QR Code)
app.get('/api/bot/status', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia;
        const resultado = await ejecutarQuery('SELECT status, qr_code_base64 FROM bot_status WHERE barbearia_id = ?', [barbeariaId]);
        if (resultado.length === 0) {
            return res.json({ success: true, status: 'desconectado', qr_code_base64: null });
        }
        return res.json({ success: true, status: resultado[0].status, qr_code_base64: resultado[0].qr_code_base64 });
    } catch (err) {
        console.error('Erro ao buscar status do bot:', err);
        return res.status(500).json({ success: false, message: 'Erro ao buscar status do bot.' });
    }
});

// ==========================================
// ROTAS DE SERVIÇOS / CORTES
// ==========================================

app.get('/api/cortes', async (req, res) => {
    try {
        const barbeariaId = req.query.barbearia_id || req.query.id_barbearia || 1;
        const cortes = await ejecutarQuery(
            'SELECT * FROM cortes WHERE id_barbearia = ? OR id_barbearia IS NULL',
            [barbeariaId]
        );
        return res.json({ success: true, dados: cortes });
    } catch (err) {
        console.error('Erro ao buscar cortes:', err);
        return res.status(500).json({ success: false, message: 'Erro ao carregar lista de cortes.' });
    }
});

app.post('/api/cortes', autenticarJWT, async (req, res) => {
    const { id, nome, preco, descricao, url_imagem } = req.body;
    if (!nome || !preco) {
        return res.status(400).json({ success: false, message: 'Nome e preço são obrigatórios.' });
    }
    const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia || 1;
    try {
        if (id) {
            await ejecutarQuery(
                'UPDATE cortes SET nome = ?, preco = ?, descricao = ?, url_imagem = ? WHERE id = ? AND id_barbearia = ?',
                [nome, preco, descricao || null, url_imagem || null, id, barbeariaId]
            );
            return res.json({ success: true, message: 'Corte atualizado com sucesso!' });
        }
        await ejecutarQuery(
            'INSERT INTO cortes (id_barbearia, nome, preco, descricao, url_imagem) VALUES (?, ?, ?, ?, ?)',
            [barbeariaId, nome, preco, descricao || null, url_imagem || null]
        );
        return res.status(201).json({ success: true, message: 'Corte cadastrado com sucesso!' });
    } catch (err) {
        console.error('Erro ao salvar corte:', err);
        return res.status(500).json({ success: false, message: 'Erro ao salvar corte.' });
    }
});

app.delete('/api/cortes/:id', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia || 1;
        await ejecutarQuery('DELETE FROM cortes WHERE id = ? AND id_barbearia = ?', [req.params.id, barbeariaId]);
        return res.json({ success: true, message: 'Corte excluído com sucesso!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Erro ao excluir corte.' });
    }
});

app.patch('/api/agendamentos/:id/pagamento', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia || 1;
        await ejecutarQuery(
            "UPDATE agendamentos SET status_pagamento = 'pago' WHERE id = ? AND barbearia_id = ?",
            [req.params.id, barbeariaId]
        );
        return res.json({ success: true, message: 'Pagamento confirmado.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Erro ao confirmar pagamento.' });
    }
});

// ==========================================
// ROTAS DE RELATÓRIOS
// ==========================================

app.get('/api/relatorios', autenticarJWT, async (req, res) => {
    try {
        const barbeariaId = req.usuario.barbearia_id || req.usuario.id_barbearia;

        const queryMetricas = `
            SELECT
                COUNT(DISTINCT cliente_id) AS totalClientes,
                COALESCE(SUM(valor), 0) AS faturamentoTotal,
                COALESCE(AVG(valor), 0) AS ticketMedio
            FROM agendamentos
            WHERE barbearia_id = ?
        `;

        const queryRetencao = `
            SELECT
                COUNT(DISTINCT cliente_id) as clientesRecorrentes
            FROM (
                SELECT cliente_id, COUNT(id) as total_agendamentos
                FROM agendamentos
                WHERE barbearia_id = ?
                GROUP BY cliente_id
                HAVING total_agendamentos > 1
            ) AS recorrentes
        `;

        const queryAgendamentos = `
            SELECT id, data_hora, valor, metodo_pagamento, status, status_pagamento
            FROM agendamentos
            WHERE barbearia_id = ?
            ORDER BY data_hora DESC
            LIMIT 50
        `;

        const [metricasResult] = await ejecutarQuery(queryMetricas, [barbeariaId]);
        const [retencaoResult] = await ejecutarQuery(queryRetencao, [barbeariaId]);
        const agendamentos = await ejecutarQuery(queryAgendamentos, [barbeariaId]);

        const totalClientes = metricasResult.totalClientes || 0;
        const clientesRecorrentes = retencaoResult.clientesRecorrentes || 0;

        const taxaRetencaoCalculada = totalClientes > 0
            ? Math.round((clientesRecorrentes / totalClientes) * 100)
            : 0;

        return res.json({
            success: true,
            dados: {
                totalClientes: totalClientes,
                faturamentoTotal: parseFloat(metricasResult.faturamentoTotal || 0),
                ticketMedio: parseFloat(metricasResult.ticketMedio || 0),
                taxaRetencao: taxaRetencaoCalculada,
                agendamentos: agendamentos
            }
        });

    } catch (err) {
        console.error('Erro ao buscar relatórios:', err);
        return res.status(500).json({ success: false, message: 'Erro ao carregar dados do relatório.' });
    }
});

// ==========================================
// ROTAS PÚBLICAS (AGENDAMENTOS E CHAT COM MEMÓRIA)
// ==========================================

app.post('/api/agendamentos', async (req, res) => {
    const {
        barbearia_id,
        id_barbearia,
        cliente_id,
        barbeiro_id,
        servico_id,
        data,
        hora,
        valor,
        metodo_pagamento
    } = req.body;

    const targetBarbeariaId = barbearia_id || id_barbearia || 1;

    if (!data || !hora) {
        return res.status(400).json({ sucesso: false, erro: 'Data e hora são obrigatórios.' });
    }
    const dataHoraRegex = /^\d{4}-\d{2}-\d{2}$/;
    const horaRegex = /^\d{2}:\d{2}$/;
    if (!dataHoraRegex.test(data) || !horaRegex.test(hora)) {
        return res.status(400).json({ sucesso: false, erro: 'Formato de data ou hora inválido.' });
    }

    const valorNumerico = Number(valor);
    if (metodo_pagamento === 'pix' && (!valorNumerico || valorNumerico <= 0)) {
        return res.status(400).json({ sucesso: false, erro: 'Valor inválido para pagamento via PIX.' });
    }

    const data_hora = `${data} ${hora}:00`;

    try {
        const txid = metodo_pagamento === 'pix' ? `AG${Date.now()}` : null;
        const statusPagamento = metodo_pagamento === 'pix' ? 'pendente' : 'pago';

        const queryInsert = `
            INSERT INTO agendamentos
            (barbearia_id, cliente_id, barbeiro_id, id_corte, data_hora, valor, metodo_pagamento, status, status_pagamento, pix_id_transacao)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
        `;

        const resultadoInsert = await ejecutarQuery(queryInsert, [
            targetBarbeariaId,
            cliente_id || 1,
            barbeiro_id || 1,
            servico_id || null,
            data_hora,
            valorNumerico || 0,
            metodo_pagamento || 'local',
            statusPagamento,
            txid
        ]);

        if (metodo_pagamento === 'pix') {
            if (!PIX_CHAVE) {
                return res.json({
                    sucesso: true,
                    mensagem: 'Agendamento registrado, mas o pagamento via PIX não está configurado no momento.',
                    metodo: 'local'
                });
            }

            try {
                const payloadPix = gerarPayloadPix({
                    chave: PIX_CHAVE,
                    nome: PIX_NOME,
                    cidade: PIX_CIDADE,
                    valor: valorNumerico,
                    txid
                });

                const qrCodeBase64 = await QRCode.toDataURL(payloadPix);
                return res.json({
                    sucesso: true,
                    mensagem: 'Agendamento pré-reservado! Faça o pagamento via PIX para confirmar.',
                    metodo: 'pix',
                    agendamento_id: resultadoInsert.insertId,
                    pix_copia_e_cola: payloadPix,
                    pix_qr_code_base64: qrCodeBase64
                });
            } catch (qrErr) {
                console.error('Erro ao gerar QR Code:', qrErr);
                return res.json({
                    sucesso: true,
                    mensagem: 'Agendamento registrado, mas houve um erro ao gerar o QR Code do PIX.',
                    metodo: 'local'
                });
            }
        }

        return res.json({
            sucesso: true,
            mensagem: 'Agendamento realizado com sucesso! Aguardamos você no horário marcado.',
            metodo: 'local'
        });

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Este horário já está reservado para este barbeiro. Por favor, escolha outro horário.'
            });
        }
        console.error('Erro ao salvar agendamento:', err);
        return res.status(500).json({ sucesso: false, erro: 'Erro interno ao salvar o agendamento.' });
    }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
    const { mensagemCliente, barbearia_id, id_barbearia, cliente_identificador } = req.body;
    const targetBarbeariaId = barbearia_id || id_barbearia || 1;
    const clientId = cliente_identificador || req.ip || 'anonimo';

    if (!mensagemCliente || mensagemCliente.trim() === '') {
        return res.status(400).json({ resposta: 'Por favor, digite uma mensagem válida.' });
    }

    try {
        let nomeBarbearia = 'Barbearia Estilo';
        try {
            const empresas = await ejecutarQuery('SELECT nome_comercial FROM empresas WHERE id = ?', [targetBarbeariaId]);
            if (empresas && empresas.length > 0 && empresas[0].nome_comercial) {
                nomeBarbearia = empresas[0].nome_comercial;
            }
        } catch (dbErr) {
            console.warn('⚠️ Não foi possível carregar dados da empresa no chat:', dbErr.message);
        }

        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "user", ?)',
            [targetBarbeariaId, clientId, mensagemCliente.trim()]
        );

        const historico = await ejecutarQuery(
            'SELECT papel, mensagem FROM bot_historico_mensagens WHERE barbearia_id = ? AND cliente_identificador = ? ORDER BY id DESC LIMIT 6',
            [targetBarbeariaId, clientId]
        );
        historico.reverse();

        let respostaTexto = null;

        if (genAI) {
           const modelosParaTentar = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-3.6-flash'];
            let ultimoErro = null;

            let contextoHistorico = historico.map(h => `${h.papel === 'user' ? 'Cliente' : 'Assistente'}: ${h.mensagem}`).join('\n');
            const prompt = `Você é o assistente virtual da ${nomeBarbearia}. Responda à dúvida do cliente com cordialidade, profissionalismo e de forma objetiva.\n\nHistórico recente da conversa:\n${contextoHistorico}\n\nAssistente:`;

            for (const nomeModelo of modelosParaTentar) {
                try {
                    const model = genAI.getGenerativeModel({ model: nomeModelo });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    respostaTexto = response.text();
                    if (respostaTexto) break;
                } catch (aiErr) {
                    ultimoErro = aiErr.message;
                    console.warn(`⚠️ Modelo ${nomeModelo} falhou na rota /api/chat. Tentando próximo...`);
                }
            }

            if (!respostaTexto) {
                console.error('❌ Todos os modelos Gemini falharam na rota /api/chat:', ultimoErro);
                respostaTexto = `Olá! Recebi sua mensagem na ${nomeBarbearia}. No momento nosso assistente automático está com alta demanda, mas em breve nossa equipe atenderá você!`;
            }
        } else {
            respostaTexto = `Olá! Bem-vindo à ${nomeBarbearia}. Recebi sua mensagem: "${mensagemCliente}". Em breve nossa equipe entrará em contato.`;
        }

        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "model", ?)',
            [targetBarbeariaId, clientId, respostaTexto]
        );

        const mensagensFormatadas = dividirMensagemEmBlocos(respostaTexto);

        return res.json({
            resposta: respostaTexto,
            mensagens: mensagensFormatadas
        });

    } catch (err) {
        console.error('Erro na rota do chat:', err);
        return res.status(500).json({ resposta: 'Erro interno ao processar sua mensagem.' });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 2999;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});