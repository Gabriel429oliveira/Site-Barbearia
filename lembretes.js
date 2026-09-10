// Função principal para checar e enviar lembretes.
// Recebe o whatsappClient (já conectado), a função ejecutarQuery e o id da barbearia
// do bot.js — evita abrir um segundo pool de conexão com o banco.
async function verificarEnviarLembretes(whatsappClient, ejecutarQuery, idBarbearia) {
    if (!whatsappClient || !ejecutarQuery) return;

    try {
        // 1. LEMBRETE DE 24 HORAS
        // Busca agendamentos entre 23h50m e 24h10m no futuro
        const agendamentos24h = await ejecutarQuery(`
            SELECT a.id, a.data_hora, c.whatsapp, c.nome AS nome_cliente, b.nome AS nome_barbeiro
            FROM agendamentos a
            JOIN clientes c ON c.id = a.cliente_id
            LEFT JOIN barbeiros b ON b.id = a.barbeiro_id
            WHERE a.barbearia_id = ?
              AND a.status = 'confirmado'
              AND a.lembrete_24h_enviado = 0
              AND a.data_hora BETWEEN NOW() + INTERVAL 23 HOUR + INTERVAL 50 MINUTE 
                                  AND NOW() + INTERVAL 24 HOUR + INTERVAL 10 MINUTE
        `, [idBarbearia]);

        for (const ag of agendamentos24h) {
            const numeroFormatado = `${ag.whatsapp.replace(/\D/g, '')}@c.us`;
            const hora = new Date(ag.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const msg = `Olá, ${ag.nome_cliente}.\n\nEstamos entrando em contato para lembrar do seu agendamento amanhã às ${hora}, com o barbeiro ${ag.nome_barbeiro || 'da equipe'}.\n\nResponda com:\n1 - Confirmar presença\n2 - Cancelar agendamento`;

            await whatsappClient.sendMessage(numeroFormatado, msg);
            await ejecutarQuery('UPDATE agendamentos SET lembrete_24h_enviado = 1 WHERE id = ?', [ag.id]);
            console.log(`⏰ Lembrete de 24h enviado para ${ag.nome_cliente} (${ag.whatsapp})`);
        }

        // 2. LEMBRETE DE 1 HORA
        // Busca agendamentos entre 50m e 1h10m no futuro
        const agendamentos1h = await ejecutarQuery(`
            SELECT a.id, a.data_hora, c.whatsapp, c.nome AS nome_cliente, b.nome AS nome_barbeiro
            FROM agendamentos a
            JOIN clientes c ON c.id = a.cliente_id
            LEFT JOIN barbeiros b ON b.id = a.barbeiro_id
            WHERE a.barbearia_id = ?
              AND a.status = 'confirmado'
              AND a.lembrete_1h_enviado = 0
              AND a.data_hora BETWEEN NOW() + INTERVAL 50 MINUTE 
                                  AND NOW() + INTERVAL 1 HOUR + INTERVAL 10 MINUTE
        `, [idBarbearia]);

        for (const ag of agendamentos1h) {
            const numeroFormatado = `${ag.whatsapp.replace(/\D/g, '')}@c.us`;
            const hora = new Date(ag.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const msg = `Olá, ${ag.nome_cliente}.\n\nSeu agendamento está previsto para hoje às ${hora}.\n\nResponda com:\n1 - Confirmar presença\n2 - Cancelar agendamento`;

            await whatsappClient.sendMessage(numeroFormatado, msg);
            await ejecutarQuery('UPDATE agendamentos SET lembrete_1h_enviado = 1 WHERE id = ?', [ag.id]);
            console.log(`⏰ Lembrete de 1h enviado para ${ag.nome_cliente} (${ag.whatsapp})`);
        }

    } catch (err) {
        console.error('⚠️ Erro na rotina de lembretes:', err.message);
    }
}

module.exports = { verificarEnviarLembretes };