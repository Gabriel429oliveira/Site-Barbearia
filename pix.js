function campoEmv(id, valor) {
    const tamanho = String(valor.length).padStart(2, '0');
    return `${id}${tamanho}${valor}`;
}

function crc16(payload) {
    const polinomio = 0x1021;
    let resultado = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        resultado ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
            if ((resultado & 0x8000) !== 0) {
                resultado = (resultado << 1) ^ polinomio;
            } else {
                resultado <<= 1;
            }
            resultado &= 0xFFFF;
        }
    }
    return resultado.toString(16).toUpperCase().padStart(4, '0');
}

function gerarPayloadPix({ chave, nome, cidade, valor, txid }) {
    const payloadFormat = campoEmv('00', '01');
    const merchantAccountInfo = campoEmv('00', 'BR.GOV.BCB.PIX') + campoEmv('01', chave);
    const merchantAccount = campoEmv('26', merchantAccountInfo);
    const mcc = campoEmv('52', '0000');
    const moeda = campoEmv('53', '986');
    const valorFormatado = Number(valor).toFixed(2);
    const campoValor = campoEmv('54', valorFormatado);
    const pais = campoEmv('58', 'BR');
    const nomeRecebedor = campoEmv('59', nome);
    const cidadeRecebedor = campoEmv('60', cidade);
    const txidField = campoEmv('05', (txid || '***').substring(0, 25));
    const dadosAdicionais = campoEmv('62', txidField);

    const semCrc = payloadFormat + merchantAccount + mcc + moeda + campoValor + pais + nomeRecebedor + cidadeRecebedor + dadosAdicionais + '6304';
    return semCrc + crc16(semCrc);
}

module.exports = { gerarPayloadPix };