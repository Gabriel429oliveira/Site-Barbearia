require('dotenv').config();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');

console.log('🤖 Iniciando o EstiloBot com IA e Banco de Dados Protegidos...');

// 1. POOL DE CONEXÕES MYSQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const ejecutarQuery = async (sql, params) => {
    const [results] = await pool.execute(sql, params);
    return results;
};

const ID_BARBEARIA = process.env.ID_BARBEARIA || 1;

// 2. CONFIGURAÇÃO DO WHATSAPP
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './sessao_whatsapp' }),
    puppeteer: {
        executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n🟢 SUCESSO: O WhatsApp está conectado e inteligente!\n');
});

// Tratamento de queda/desconexão automática do navegador
client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente do WhatsApp foi desconectado:', reason);
    client.initialize();
});

// 3. EVENTO CENTRAL DE MENSAGENS
client.on('message_create', async (msg) => {
    
    // TRAVA 1: Ignora qualquer mensagem enviada por VOCÊ (evita responder você mesmo)
    if (msg.fromMe) return;

    // TRAVA 2: Ignora grupos (pelo ID direto)
    if (msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')) return;

    try {
        // TRAVA 3: Validação extra de segurança - confirma se a conversa é um grupo
        const chat = await msg.getChat();
        if (chat.isGroup) return;

        const destino = msg.from;
        const whatsappClienteLimpo = destino.split('@')[0];
        const mensagemCliente = msg.body;

        // [PASSO A] Buscar dados da Empresa e Cortes
        const empresa = await ejecutarQuery('SELECT nome_comercial FROM empresas WHERE id = ?', [ID_BARBEARIA]);
        if (!empresa.length) {
            console.log('⚠️ Empresa não encontrada para o ID informado.');
            return;
        }

        const cortes = await ejecutarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes WHERE id_barbearia = ?', [ID_BARBEARIA]);
        const listaCortesTexto = cortes.map(c => `- ID [${c.id}] ${c.nome}: R$ ${c.preco} (${c.descricao})`).join('\n');

        // [PASSO B] Verificar se o cliente já existe no banco
        const clienteLogado = await ejecutarQuery('SELECT id, nome FROM clientes WHERE id_barbearia = ? AND whatsapp = ?', [ID_BARBEARIA, whatsappClienteLimpo]);

        let dadosHistoricoPrompt = "SITUAÇÃO DO CLIENTE: Este é um cliente NOVO. Ele NÃO tem histórico de cortes na nossa barbearia.";
        let nomeCliente = "Cliente";
        let idClienteAtual = null;

        if (clienteLogado.length > 0) {
            idClienteAtual = clienteLogado[0].id;
            nomeCliente = clienteLogado[0].nome;

            const corteHabitual = await ejecutarQuery(`
                SELECT id_corte, cortes.nome, COUNT(id_corte) as total 
                FROM historico_agendamentos 
                JOIN cortes ON cortes.id = historico_agendamentos.id_corte
                WHERE historico_agendamentos.id_cliente = ? 
                GROUP BY id_corte 
                HAVING total >= 2
                ORDER BY total DESC LIMIT 1`, [idClienteAtual]);

            const ultimoCorte = await ejecutarQuery(`
                SELECT id_corte, cortes.nome 
                FROM historico_agendamentos 
                JOIN cortes ON cortes.id = historico_agendamentos.id_corte
                WHERE historico_agendamentos.id_cliente = ? 
                ORDER BY id DESC LIMIT 1`, [idClienteAtual]);

            if (corteHabitual.length > 0) {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: Este é um cliente ANTIGO. O nome dele é ${nomeCliente}. O corte que ele MAIS FAZ (Corte Habitual) é o "${corteHabitual[0].nome}".`;
            } else if (ultimoCorte.length > 0) {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: Este é um cliente ANTIGO. O nome dele é ${nomeCliente}. O ÚLTIMO corte que ele realizou conosco foi o "${ultimoCorte[0].nome}".`;
            } else {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: O cliente chama-se ${nomeCliente}, mas ainda não tem registros de serviços realizados.`;
            }
        }

        // [PASSO C] Buscar Barbeiros e Horários
        const barbeiros = await ejecutarQuery('SELECT id, nome, especialidade FROM barbeiros WHERE status = "ativo"', []);
        const listaBarbeirosTexto = barbeiros.map(b => `- ID [${b.id}] ${b.nome} (${b.especialidade})`).join('\n');

        const horariosPadrao = ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
        const hoje = new Date().toISOString().split('T')[0];
        
        const agendamentosHoje = await ejecutarQuery(
            'SELECT data_hora FROM agendamentos WHERE DATE(data_hora) = ? AND status != "cancelado"', 
            [hoje]
        );

        const horasOcupadas = agendamentosHoje.map(a => {
            const dataHora = new Date(a.data_hora);
            return dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        });

        const horariosLivres = horariosPadrao.filter(hora => !horasOcupadas.includes(hora));
        const listaHorariosTexto = horariosLivres.length > 0 ? horariosLivres.join(', ') : "Nenhum horário disponível para hoje.";

        // [PASSO D] Prompt do Gemini
        const contextoSistema = `
        Você é o "EstiloBot", o assistente inteligente da barbearia: "${empresa[0].nome_comercial}".
        Aja de forma extremamente amigável, acolhedora e informal.
        Sempre assine ou se identifique como "EstiloBot" em algum ponto da mensagem.
        
        ${dadosHistoricoPrompt}
        
        Lista oficial de serviços, IDs e preços:
        ${listaCortesTexto}

        Lista de Barbeiros da casa:
        ${listaBarbeirosTexto}
        
        Horários LIVRES reais para hoje (${hoje}):
        [ ${listaHorariosTexto} ]

        REGRAS DE ATENDIMENTO HUMANIZADO:
        1. Se for CLIENTE NOVO: Dê as boas-vindas. Pergunte o estilo de corte que ele curte e sugira opções.
        2. Se for CLIENTE ANTIGO: Chame-o pelo nome (${nomeCliente}). Pergunte se vai querer repetir o corte habitual ou o mais recente.
        3. APÓS A ESCOLHA DO CORTE: Mostre os Barbeiros disponíveis e as opções de HORÁRIOS LIVRES.
        4. ENVIO DE FOTOS: Inclua no final da resposta a tag: [ENVIAR_FOTO_ID: X] (onde X é o ID do corte).
        5. AO CONFIRMAR AGENDAMENTO: Inclua a tag:
           [AGENDAR_DATA_HORA: YYYY-MM-DD HH:MM | BARBEIRO_ID: X | CORTE_ID: Z]
        `;

        // [PASSO E] Requisição para API do Gemini
        const apiKey = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await globalThis.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: contextoSistema },
                        { text: `Mensagem do Cliente: ${mensagemCliente}` }
                    ]
                }]
            })
        });

        const data = await response.json();
        
        if (data.candidates && data.candidates[0]?.content?.parts) {
            let respostaIA = data.candidates[0].content.parts[0].text;
            
            // Tratamento de tags de foto
            let idCorteDetectado = null;
            const regexTagFoto = /\[ENVIAR_FOTO_ID:\s*(\d+)\]/;
            const matchFoto = respostaIA.match(regexTagFoto);

            if (matchFoto) {
                idCorteDetectado = matchFoto[1];
                respostaIA = respostaIA.replace(regexTagFoto, '').trim();
            }

            // Tratamento de tags de agendamento
            const regexAgendamento = /\[AGENDAR_DATA_HORA:\s*([\d-]+ [\d:]+)\s*\|\s*BARBEIRO_ID:\s*(\d+)\s*\|\s*CORTE_ID:\s*(\d+)\]/;
            const matchAgendamento = respostaIA.match(regexAgendamento);

            if (matchAgendamento) {
                const dataHoraAgendamento = matchAgendamento[1];
                const idBarbeiroAgendamento = matchAgendamento[2];
                const idCorteAgendamento = matchAgendamento[3];
                
                respostaIA = respostaIA.replace(regexAgendamento, '').trim();

                if (idClienteAtual) {
                    const corteEscolhido = cortes.find(c => c.id == idCorteAgendamento);
                    const precoCorte = corteEscolhido ? corteEscolhido.preco : 0.00;

                    await ejecutarQuery(
                        `INSERT INTO agendamentos (cliente_id, barbeiro_id, data_hora, status, valor, status_pagamento) 
                         VALUES (?, ?, ?, 'confirmado', ?, 'pendente')`,
                        [idClienteAtual, idBarbeiroAgendamento, dataHoraAgendamento, precoCorte]
                    );
                    console.log(`📅 Agendamento salvo para as ${dataHoraAgendamento}!`);
                }
            }

            if (!respostaIA.includes('EstiloBot')) {
                respostaIA += '\n\nAtenciosamente, EstiloBot 🤖';
            }

            await client.sendMessage(destino, respostaIA);

            // Validação aprimorada para o envio de fotos
            if (idCorteDetectado) {
                const corteEncontrado = cortes.find(c => c.id == idCorteDetectado);
                if (corteEncontrado && corteEncontrado.url_imagem && corteEncontrado.url_imagem.startsWith('http')) {
                    try {
                        const media = await MessageMedia.fromUrl(corteEncontrado.url_imagem);
                        await client.sendMessage(destino, media, { caption: `Exemplo de ${corteEncontrado.nome}` });
                    } catch (mediaErr) {
                        console.log('⚠️ URL da imagem do corte é inválida ou inacessível.');
                    }
                }
            }
            console.log(`🤖 Resposta enviada com sucesso para: ${whatsappClienteLimpo}`);
        } else {
            console.error('⚠️ Resposta inválida da API Gemini:', data);
        }

    } catch (error) {
        console.error('Erro no processamento da mensagem:', error);
    }
});

// Inicialização do WhatsApp Web Client
client.initialize();