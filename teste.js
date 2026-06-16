// Carrega as variáveis ocultas do arquivo .env (Segurança para Portfólio)
require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2');

console.log('🤖 Iniciando o EstiloBot com IA e Banco de Dados Protegidos...');

// 1. CONEXÃO AO BANCO DE DADOS MYSQL (Puxando com segurança do .env)
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// Helper para rodar as queries com Promises
const ejecutarQuery = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

const ID_BARBEARIA = 1;

// 2. CONFIGURAÇÃO DO WHATSAPP (USANDO O TEU CHROME)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n🟢 SUCESSO: O WhatsApp está conectado e inteligente!\n');
});

// 3. EVENTO CENTRAL DE MENSAGENS (MESSAGE_CREATE)
client.on('message_create', async (msg) => {
    
    // TRAVA ANTI-LOOP INTELIGENTE
    if (msg.fromMe && msg.body.includes('EstiloBot')) {
        return;
    }

    // TRAVA 1: Ignora Grupos
    if (msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')) return;

    // Definição do destino do chat de testes
    const destino = msg.fromMe ? msg.to : msg.from;
    
    // TRAVA 2: Filtro de segurança para o seu número de teste no privado
    const SEU_NUMERO_WHATSAPP = '5511942634316@c.us';
    if (destino !== SEU_NUMERO_WHATSAPP) return;

    const whatsappClienteLimpo = destino.split('@')[0];
    const mensagemCliente = msg.body;

    try {
        // [PASSO A] Buscar dados da Empresa e os Cortes disponíveis
        const empresa = await executarQuery('SELECT nome_comercial FROM empresas WHERE id = ?', [ID_BARBEARIA]);
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

        // [PASSO C] Buscar Barbeiros e Calcular Horários Livres Dinamicamente
        const barbeiros = await ejecutarQuery('SELECT id, nome, especialidade FROM barbeiros WHERE status = "ativo"', []);
        const listaBarbeirosTexto = barbeiros.map(b => `- ID [${b.id}] ${b.nome} (${b.especialidade})`).join('\n');

        // Lógica de horários padrão de atendimento
        const horariosPadrao = ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
        
        // Data de hoje no formato YYYY-MM-DD
        const hoje = new Date().toISOString().split('T')[0];
        
        // Busca agendamentos ativos para hoje
        const agendamentosHoje = await ejecutarQuery(
            'SELECT data_hora FROM agendamentos WHERE DATE(data_hora) = ? AND status != "cancelado"', 
            [hoje]
        );

        // Filtra as horas ocupadas
        const horasOcupadas = agendamentosHoje.map(a => {
            const dataHora = new Date(a.data_hora);
            return dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        });

        const horariosLivres = horariosPadrao.filter(hora => !horasOcupadas.includes(hora));
        const listaHorariosTexto = horariosLivres.length > 0 
            ? horariosLivres.join(', ') 
            : "Nenhum horário disponível para hoje.";

        // [PASSO D] Prompt humanizado para o Gemini
        const contextoSistema = `
        Você é o "EstiloBot", o assistente inteligente da barbearia: "${empresa[0].nome_comercial}".
        Aja de forma extremamente amigável, acolhedora e informal.
        Sempre assine ou se identifique como "EstiloBot" em algum ponto da mensagem para que o sistema funcione.
        
        ${dadosHistoricoPrompt}
        
        Lista oficial de serviços, IDs e preços:
        ${listaCortesTexto}

        Lista de Barbeiros da casa (use os IDs internamente se necessário):
        ${listaBarbeirosTexto}
        
        Horários LIVRES reais para hoje (${hoje}):
        [ ${listaHorariosTexto} ]

        REGRAS DE ATENDIMENTO HUMANIZADO:
        1. Se for CLIENTE NOVO: Dê as boas-vindas. Pergunte o estilo de corte que ele curte. Sugira o melhor corte da lista.
        2. Se for CLIENTE ANTIGO: Chame-o pelo nome (${nomeCliente}). Pergunte se vai querer repetir o corte habitual dele ou o mais recente.
        3. APÓS A ESCOLHA DO CORTE: Mostre os Barbeiros disponíveis e as opções de HORÁRIOS LIVRES reais para ele escolher.
        4. ENVIO DE FOTOS: Quando sugerir ou confirmar um corte da lista, inclua SEMPRE no final da resposta a tag: [ENVIAR_FOTO_ID: X] (onde X é o ID do corte).
        5. QUANDO O CLIENTE ESCOLHER O BARBEIRO E O HORÁRIO LIGADO A UM CORTE: Você deve confirmar os dados textualmente de forma simpática E incluir obrigatoriamente a seguinte tag secreta no final:
           [AGENDAR_DATA_HORA: YYYY-MM-DD HH:MM | BARBEIRO_ID: X | CORTE_ID: Z]
           Exemplo: Se ele escolheu o barbeiro ID 1, às 15:00, para o corte ID 2 hoje, coloque: [AGENDAR_DATA_HORA: ${hoje} 15:00 | BARBEIRO_ID: 1 | CORTE_ID: 2]
        `;

        // [PASSO E] Chamada para a API do Gemini (Puxando com segurança do .env)
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
        
        if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
            let respostaIA = data.candidates[0].content.parts[0].text;
            
            // 1. Captura tag de Foto se houver
            let idCorteDetectado = null;
            const regexTagFoto = /\[ENVIAR_FOTO_ID:\s*(\d+)\]/;
            const matchFoto = respostaIA.match(regexTagFoto);

            if (matchFoto) {
                idCorteDetectado = matchFoto[1];
                respostaIA = respostaIA.replace(regexTagFoto, '').trim();
            }

            // 2. Captura tag de Agendamento Real se houver
            const regexAgendamento = /\[AGENDAR_DATA_HORA:\s*([\d-]+ [\d:]+)\s*\|\s*BARBEIRO_ID:\s*(\d+)\s*\|\s*CORTE_ID:\s*(\d+)\]/;
            const matchAgendamento = respostaIA.match(regexAgendamento);

            if (matchAgendamento) {
                const dataHoraAgendamento = matchAgendamento[1];
                const idBarbeiroAgendamento = matchAgendamento[2];
                const idCorteAgendamento = matchAgendamento[3];
                
                respostaIA = respostaIA.replace(regexAgendamento, '').trim();

                // Faz o agendamento real na tabela 'agendamentos'
                if (idClienteAtual) {
                    const corteEscolhido = cortes.find(c => c.id == idCorteAgendamento);
                    const precoCorte = corteEscolhido ? corteEscolhido.preco : 0.00;

                    await ejecutarQuery(
                        `INSERT INTO agendamentos (cliente_id, barbeiro_id, data_hora, status, valor, status_pagamento) 
                         VALUES (?, ?, ?, 'confirmado', ?, 'pendente')`,
                        [idClienteAtual, idBarbeiroAgendamento, dataHoraAgendamento, precoCorte]
                    );
                    console.log(`📅 SUCESSO: Agendamento inserido no MySQL para as ${dataHoraAgendamento}!`);
                } else {
                    console.log(`⚠️ Cliente não cadastrado na tabela 'clientes'. Não foi possível salvar o agendamento.`);
                }
            }

            // Garante que a resposta contenha o nome do bot para ativar a trava anti-loop
            if (!respostaIA.includes('EstiloBot')) {
                respostaIA += '\n\nAtenciosamente, EstiloBot 🤖';
            }

            // Envia o texto da IA para o cliente
            await client.sendMessage(destino, respostaIA);

            // Tenta enviar a foto se houver uma URL válida
            if (idCorteDetectado) {
                const corteEncontrado = cortes.find(c => c.id == idCorteDetectado);
                if (corteEncontrado && corteEncontrado.url_imagem && corteEncontrado.url_imagem.startsWith('http')) {
                    try {
                        const { MessageMedia } = require('whatsapp-web.js');
                        const media = await MessageMedia.fromUrl(corteEncontrado.url_imagem);
                        await client.sendMessage(destino, media, { caption: `Exemplo de ${corteEncontrado.nome}` });
                    } catch (mediaErr) {
                        console.log('⚠️ Link da foto inacessível ou fictício.');
                    }
                }
            }
            console.log(`🤖 Resposta humanizada entregue para: ${whatsappClienteLimpo}`);
        }

    } catch (error) {
        console.error('Erro no processamento da mensagem:', error);
    }
});

// Inicializa o banco primeiro, e só liga o robô quando o banco responder com sucesso
db.connect((err) => {
    if (err) {
        console.error('❌ Erro crítico no MySQL: ', err.message);
        return;
    }
    console.log('🎉 Conectado ao Banco de Dados com sucesso!');
    console.log('🚀 Inicializando o cliente do WhatsApp...');
    client.initialize();
});