// ============================================
// script.js - Conciliacao (Supabase)
// ============================================

const SUPABASE_URL = "https://skvayfwuaelxxnhctlhv.supabase.co";
const SUPABASE_KEY = "sb_publishable_io0L_HpoZeWfh4jlQvBN-Q_R2N9cBwb";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABELA_CONCILIACOES = "conciliacoes";

const COLUNAS_TABELA = [
    "arquivo", "grupo", "comprovante", "erp",
    "favorecido", "cnpj_cpf", "pagamento_comprovante", "valor_comprovante", "id_transacao", "banco_comprovante",
    "un", "favorecido_erp", "cnpj", "cpf", "numero_documento",
    "pagamento_erp", "banco", "conta_bancaria", "valor_erp",
    "forma_pagamento", "ap", "tipo_documento", "motivos",
];

// ---- Elementos ----
const searchInput   = document.getElementById('searchInput');
const searchField   = document.getElementById('searchField');
const dateFrom      = document.getElementById('dateFrom');
const dateTo        = document.getElementById('dateTo');
const toolbar       = document.getElementById('toolbar');
const selectedCount = document.getElementById('selectedCount');
const emptyState    = document.getElementById('emptyState');
const resultsTable  = document.getElementById('resultsTable');
const tableBody     = document.getElementById('tableBody');
const noResults     = document.getElementById('noResults');
const checkAll      = document.getElementById('checkAll');
const startModal    = document.getElementById('startModal');
const selectedPanel = document.getElementById('selectedPanel');

let debounceTimer = null;
let ultimoResultado = null;
let linhasAtuais = null;
let logVisivel = false;
let logEnvioVisivel = false;

// Conciliacao manual: selecao nas listas de sobras do resultado atual.
// Comprovante e no maximo 1 por vez; ERP aceita varios (1 comprovante pode cobrir varios lancamentos do ERP).
let manualSelComprovante = null;
let manualSelErps = new Set();
let manualIdCounter = 0;

// Selecao acumulada entre buscas: nao eh resetada quando o usuario faz uma nova busca,
// so quando ele desmarca o item, clica em "Limpar seleção" ou remove pelo painel.
// Chave = id (string) -> { id, favorecido }, usado pro download em lote e pro painel de selecionados.
const selecionados = new Map();

// ---- Montagem das linhas para o Supabase ----

function valorParaNumero(valor) {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'number') return valor;
    const limpo = String(valor).replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? null : n;
}

function garantirListaDeDicts(valor) {
    if (valor === null || valor === undefined) return [{}];
    if (Array.isArray(valor)) {
        const filtrado = valor.filter(v => v && typeof v === 'object' && !Array.isArray(v));
        return filtrado.length ? filtrado : [{}];
    }
    if (typeof valor === 'object') return [valor];
    return [{}];
}

function montarLinhaConciliado(item, grupo) {
    const listaDados = garantirListaDeDicts(item.dados);
    const listaErpDados = garantirListaDeDicts(item.erp_dados);

    const linhas = [];
    for (const dados of listaDados) {
        for (const erpDados of listaErpDados) {
            linhas.push({
                grupo,
                comprovante: item.comprovante ?? null,
                erp: item.erp ?? null,
                favorecido: dados.favorecido ?? null,
                cnpj_cpf: dados.cnpj_cpf ?? null,
                pagamento_comprovante: dados.pagamento ?? null,
                valor_comprovante: dados.valor ?? null,
                id_transacao: dados.id_transacao ?? null,
                banco_comprovante: dados.banco ?? null,
                un: erpDados.UN ?? null,
                favorecido_erp: erpDados.favorecido ?? null,
                cnpj: erpDados.cnpj ?? null,
                cpf: erpDados.cpf ?? null,
                numero_documento: erpDados['Nº Documento'] ?? null,
                pagamento_erp: erpDados.pagamento ?? null,
                banco: erpDados.Banco ?? null,
                conta_bancaria: erpDados['Conta Bancaria'] ?? null,
                valor_erp: valorParaNumero(erpDados.valor),
                forma_pagamento: erpDados['Forma de Pagamento'] ?? null,
                ap: erpDados.AP ?? null,
                tipo_documento: erpDados['Tipo de Documento'] ?? null,
            });
        }
    }
    return linhas;
}

function normalizarLinha(linha) {
    const normalizada = {};
    for (const coluna of COLUNAS_TABELA) {
        normalizada[coluna] = linha[coluna] !== undefined ? linha[coluna] : null;
    }
    return normalizada;
}

// So os pares conciliados (automatico ou manual) viram linha pro Supabase: a tabela e o "arquivo verdade",
// entao pendencias sem par (nao_conciliados / erp_nao_conciliados) ficam de fora do lote enviado.
function extrairLinhas(dadosCompletos, nomeArquivo) {
    let linhas = [];

    for (const item of dadosCompletos.conciliados || []) {
        linhas = linhas.concat(montarLinhaConciliado(item, 'conciliados'));
    }

    return linhas.map(linha => normalizarLinha({ ...linha, arquivo: nomeArquivo }));
}

// ---- Ações ----

function iniciarProcesso() {
    startModal.classList.remove('hidden');
}

function fecharModal() {
    startModal.classList.add('hidden');
    resetModal();
}

function resetModal() {
    document.getElementById('arquivoPdf').value = '';
    document.getElementById('arquivoXlsx').value = '';
    document.getElementById('arquivoPdfCard').classList.remove('has-file');
    document.getElementById('arquivoXlsxCard').classList.remove('has-file');
    document.getElementById('resultado').innerText = '';
    document.getElementById('resultadoStats').classList.add('hidden');
    document.getElementById('logBox').style.display = 'none';
    document.getElementById('btnDownload').style.display = 'none';
    document.getElementById('btnConciliar').disabled = true;
    document.getElementById('btnProximo').disabled = true;
    document.getElementById('jsonEnvio').innerText = '';
    document.getElementById('jsonEnvio').classList.add('hidden');
    document.getElementById('statusEnvio').innerText = '';
    document.getElementById('btnEnviarSupabase').disabled = false;
    logVisivel = false;
    logEnvioVisivel = false;
    ultimoResultado = null;
    linhasAtuais = null;
    document.getElementById('stepManual').classList.add('hidden');
    document.getElementById('modalConciliacaoBox').classList.remove('modal-wide');
    document.getElementById('manualLinkBar').classList.add('hidden');
    manualSelComprovante = null;
    manualSelErps.clear();
    voltarParaUpload();
}

// Estima o nome do arquivo pela data de pagamento do primeiro conciliado (lote e diario)
function gerarNomeArquivoJson() {
    const primeiro = ultimoResultado && ultimoResultado.conciliados && ultimoResultado.conciliados[0];
    const pagamento = primeiro && (
        (primeiro.erp_dados && primeiro.erp_dados.pagamento) ||
        (primeiro.dados && primeiro.dados.pagamento)
    );
    const match = pagamento && pagamento.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

    if (match) return `${match[1]}-${match[2]}-${match[3]}.json`;

    const hoje = new Date();
    const dia = String(hoje.getDate()).padStart(2, '0');
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    return `${dia}-${mes}-${ano}.json`;
}

async function irParaEnvio() {
    const nomeArquivo = gerarNomeArquivoJson();
    linhasAtuais = extrairLinhas(ultimoResultado, nomeArquivo);

    document.getElementById('jsonEnvioNome').innerText = nomeArquivo;
    document.getElementById('jsonEnvioContagem').innerText = `${linhasAtuais.length} linha(s) prontas para envio`;
    document.getElementById('jsonEnvio').innerText = JSON.stringify(linhasAtuais, null, 2);
    document.getElementById('jsonEnvio').classList.add('hidden');
    document.getElementById('statusEnvio').innerText = '';

    const pendComp = ultimoResultado.nao_conciliados.length;
    const pendErp = ultimoResultado.erp_nao_conciliados.length;
    const infoPendencias = document.getElementById('pendenciasEnvioInfo');
    if (pendComp || pendErp) {
        infoPendencias.innerText = `⚠️ ${pendComp} comprovante(s) e ${pendErp} lançamento(s) do ERP continuam sem par e não serão enviados. Volte e use "Conciliar Manualmente" se quiser incluí-los.`;
        infoPendencias.classList.remove('hidden');
    } else {
        infoPendencias.classList.add('hidden');
    }

    document.getElementById('btnEnviarSupabase').disabled = false;
    logEnvioVisivel = false;
    document.getElementById('stepUpload').classList.add('hidden');
    document.getElementById('stepEnvio').classList.remove('hidden');
    document.getElementById('stepDot1').classList.remove('active');
    document.getElementById('stepDot2').classList.add('active');

    await verificarArquivoJaEnviado(nomeArquivo);
}

async function verificarArquivoJaEnviado(nomeArquivo) {
    const btn = document.getElementById('btnEnviarSupabase');
    const status = document.getElementById('statusEnvio');

    btn.disabled = true;
    status.innerText = 'Verificando se este arquivo já foi enviado...';

    const { count, error } = await sb
        .from(TABELA_CONCILIACOES)
        .select('id', { count: 'exact', head: true })
        .eq('arquivo', nomeArquivo);

    if (error) {
        status.innerText = 'Não foi possível verificar duplicidade: ' + error.message;
        btn.disabled = false;
        return;
    }

    if (count > 0) {
        status.innerText = `⚠️ Arquivo já enviado (${nomeArquivo}).`;
        btn.disabled = true;
        return;
    }

    status.innerText = '';
    btn.disabled = false;
}

// ---- Conciliacao manual ----
// Vincula manualmente um comprovante (nao_conciliados) a um lancamento do ERP (erp_nao_conciliados).
// O par vinculado entra em ultimoResultado.conciliados no mesmo formato dos pares automaticos
// (dados + erp_dados), entao ele segue pro lote de envio junto com o resto sem nenhum tratamento especial.

function atualizarStatsExibidos() {
    if (!ultimoResultado) return;
    document.getElementById('statConciliados').innerText = ultimoResultado.conciliados.length;
    document.getElementById('statNaoConciliados').innerText = ultimoResultado.nao_conciliados.length;
    document.getElementById('statErpSobrando').innerText = ultimoResultado.erp_nao_conciliados.length;

    const semPendencias = ultimoResultado.nao_conciliados.length === 0 && ultimoResultado.erp_nao_conciliados.length === 0;
    document.getElementById('manualLinkBar').classList.toggle('hidden', semPendencias);
}

function formatValorBruto(valor) {
    const n = valorParaNumero(valor);
    if (n === null) return valor ? esc(valor) : '';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function abrirConciliacaoManual() {
    if (!ultimoResultado) return;
    manualSelComprovante = null;
    manualSelErps.clear();
    document.getElementById('stepUpload').classList.add('hidden');
    document.getElementById('stepManual').classList.remove('hidden');
    document.getElementById('modalConciliacaoBox').classList.add('modal-wide');
    renderManual();
}

function fecharConciliacaoManual() {
    document.getElementById('stepManual').classList.add('hidden');
    document.getElementById('stepUpload').classList.remove('hidden');
    document.getElementById('modalConciliacaoBox').classList.remove('modal-wide');
    atualizarStatsExibidos();
}

function selecionarManualComprovante(idx) {
    manualSelComprovante = manualSelComprovante === idx ? null : idx;
    renderManual();
}

// ERP aceita varios selecionados ao mesmo tempo (1 comprovante pode cobrir varios lancamentos)
function selecionarManualErp(idx) {
    if (manualSelErps.has(idx)) {
        manualSelErps.delete(idx);
    } else {
        manualSelErps.add(idx);
    }
    renderManual();
}

// Vincula o que estiver selecionado. Cobre 3 casos:
// - comprovante + 1 ou mais ERPs: par normal (ou agrupado, quando o comprovante cobre varios lancamentos)
// - so comprovante (nenhum ERP selecionado): confirma o pagamento mesmo sem lancamento correspondente
//   no ERP enviado (ex: ERP desatualizado que nunca vai aparecer nessa planilha)
// - so ERP(s) (nenhum comprovante selecionado): confirma lancamento(s) do ERP sem comprovante em PDF
function vincularManual() {
    const temComp = manualSelComprovante !== null;
    const idxsErp = [...manualSelErps];
    if (!temComp && idxsErp.length === 0) return;

    const comp = temComp ? ultimoResultado.nao_conciliados[manualSelComprovante] : null;
    const erpsSelecionados = idxsErp
        .slice().sort((a, b) => a - b)
        .map(i => ultimoResultado.erp_nao_conciliados[i]);

    ultimoResultado.conciliados.push({
        via: 'manual',
        _manualId: ++manualIdCounter,
        dados: temComp ? comp.comprovante : {},
        erp_dados: erpsSelecionados.length === 0 ? null
            : erpsSelecionados.length === 1 ? erpsSelecionados[0]
            : erpsSelecionados,
    });

    if (temComp) ultimoResultado.nao_conciliados.splice(manualSelComprovante, 1);
    // remove do maior indice pro menor, senao os indices menores mudam de posicao no meio da remocao
    idxsErp.slice().sort((a, b) => b - a).forEach(i => ultimoResultado.erp_nao_conciliados.splice(i, 1));

    manualSelComprovante = null;
    manualSelErps.clear();
    renderManual();
    atualizarStatsExibidos();
}

function desvincularManual(manualId) {
    const idx = ultimoResultado.conciliados.findIndex(c => c._manualId === manualId);
    if (idx === -1) return;

    const item = ultimoResultado.conciliados[idx];
    ultimoResultado.conciliados.splice(idx, 1);

    if (item.dados && Object.keys(item.dados).length > 0) {
        ultimoResultado.nao_conciliados.push({ motivos: ['desfeito manualmente'], comprovante: item.dados });
    }
    const erpsDesfeitos = Array.isArray(item.erp_dados) ? item.erp_dados : (item.erp_dados ? [item.erp_dados] : []);
    erpsDesfeitos.forEach(e => ultimoResultado.erp_nao_conciliados.push(e));

    renderManual();
    atualizarStatsExibidos();
}

function renderManual() {
    const listComp = document.getElementById('manualListComprovantes');
    const listErp = document.getElementById('manualListErp');
    const naoConc = ultimoResultado.nao_conciliados;
    const erpSobra = ultimoResultado.erp_nao_conciliados;

    document.getElementById('manualCountComprovantes').innerText = naoConc.length;
    document.getElementById('manualCountErp').innerText = erpSobra.length;

    listComp.innerHTML = naoConc.length ? naoConc.map((item, idx) => {
        const c = item.comprovante || {};
        return `
        <div class="manual-item ${manualSelComprovante === idx ? 'selected' : ''}" onclick="selecionarManualComprovante(${idx})">
            <div class="manual-item-title">${esc(c.favorecido) || '(sem nome)'}</div>
            <div class="manual-item-line">${formatCpfCnpj(c.cnpj_cpf)}</div>
            <div class="manual-item-line">${esc(c.pagamento)} — ${formatValorBruto(c.valor)}</div>
            ${item.motivos && item.motivos.length ? `<div class="manual-item-motivos">${esc(item.motivos.join(', '))}</div>` : ''}
        </div>`;
    }).join('') : '<div class="manual-empty">Nenhum comprovante sem par</div>';

    listErp.innerHTML = erpSobra.length ? erpSobra.map((erp, idx) => `
        <div class="manual-item ${manualSelErps.has(idx) ? 'selected' : ''}" onclick="selecionarManualErp(${idx})">
            <div class="manual-item-title">${esc(erp.favorecido) || '(sem nome)'}</div>
            <div class="manual-item-line">AP ${esc(erp.AP)} · ${esc(erp['Nº Documento'])}</div>
            <div class="manual-item-line">${esc(erp.pagamento)} — ${formatValorBruto(erp.valor)}</div>
        </div>`).join('') : '<div class="manual-empty">Nenhum lançamento do ERP sem par</div>';

    atualizarResumoSelecaoManual();
    renderVinculadosManuais();
}

function atualizarResumoSelecaoManual() {
    const temComp = manualSelComprovante !== null;
    const qtdErp = manualSelErps.size;
    const btn = document.getElementById('btnVincularManual');
    const resumo = document.getElementById('manualSelecaoResumo');

    if (temComp && qtdErp > 0) {
        btn.disabled = false;
        btn.innerText = qtdErp === 1 ? 'Vincular selecionados' : `Vincular com os ${qtdErp} lançamentos selecionados`;
        resumo.innerText = '';
    } else if (temComp && qtdErp === 0) {
        btn.disabled = false;
        btn.innerText = 'Conciliar sem ERP';
        resumo.innerText = 'Confirma o comprovante mesmo sem lançamento correspondente no ERP (ex: ERP desatualizado).';
    } else if (!temComp && qtdErp > 0) {
        btn.disabled = false;
        btn.innerText = qtdErp === 1 ? 'Conciliar sem comprovante' : `Conciliar ${qtdErp} lançamentos sem comprovante`;
        resumo.innerText = 'Confirma o(s) lançamento(s) do ERP mesmo sem comprovante em PDF.';
    } else {
        btn.disabled = true;
        btn.innerText = 'Vincular selecionados';
        resumo.innerText = '';
    }
}

function renderVinculadosManuais() {
    const manuais = ultimoResultado.conciliados.filter(c => c.via === 'manual');
    const section = document.getElementById('manualLinkedSection');
    const list = document.getElementById('manualLinkedList');

    section.classList.toggle('hidden', manuais.length === 0);
    list.innerHTML = manuais.map(item => {
        const nomeComp = item.dados && item.dados.favorecido ? esc(item.dados.favorecido) : '(sem comprovante)';
        const erps = Array.isArray(item.erp_dados) ? item.erp_dados : (item.erp_dados ? [item.erp_dados] : []);
        const nomeErp = erps.length === 0 ? '(sem ERP)'
            : erps.length === 1 ? esc(erps[0].favorecido)
            : `${erps.length} lançamentos do ERP`;
        return `
        <div class="manual-linked-item">
            <span>${nomeComp} ↔ ${nomeErp}</span>
            <button type="button" onclick="desvincularManual(${item._manualId})">Desfazer</button>
        </div>`;
    }).join('');
}

function toggleLogEnvio() {
    logEnvioVisivel = !logEnvioVisivel;
    document.getElementById('jsonEnvio').classList.toggle('hidden', !logEnvioVisivel);
}

function voltarParaUpload() {
    document.getElementById('stepEnvio').classList.add('hidden');
    document.getElementById('stepUpload').classList.remove('hidden');
    document.getElementById('stepDot2').classList.remove('active');
    document.getElementById('stepDot1').classList.add('active');
}

async function enviarParaSupabase() {
    if (!linhasAtuais || !linhasAtuais.length) return;

    const btn = document.getElementById('btnEnviarSupabase');
    const status = document.getElementById('statusEnvio');

    btn.disabled = true;
    status.innerText = `Enviando ${linhasAtuais.length} linha(s) para o Supabase...`;

    const { error } = await sb.from(TABELA_CONCILIACOES).insert(linhasAtuais);

    if (error) {
        status.innerText = 'Erro ao enviar: ' + error.message;
        btn.disabled = false;
        return;
    }

    status.innerText = `✅ ${linhasAtuais.length} linha(s) enviada(s) com sucesso!`;
}

function onArquivoChange(input, cardId) {
    document.getElementById(cardId).classList.toggle('has-file', !!input.files[0]);
    validarConciliar();
}

function validarConciliar() {
    const pdf = document.getElementById('arquivoPdf').files[0];
    const xlsx = document.getElementById('arquivoXlsx').files[0];
    document.getElementById('btnConciliar').disabled = !(pdf && xlsx);
}

function conciliar() {
    const pdf = document.getElementById('arquivoPdf').files[0];
    const xlsx = document.getElementById('arquivoXlsx').files[0];

    if (!pdf || !xlsx) {
        alert('Selecione o PDF e a planilha .xlsx antes de conciliar!');
        return;
    }

    document.getElementById('resultado').innerText = 'Processando...';
    document.getElementById('resultadoStats').classList.add('hidden');
    document.getElementById('btnDownload').style.display = 'none';
    document.getElementById('logBox').style.display = 'none';
    logVisivel = false;

    const formData = new FormData();
    formData.append('pdf', pdf);
    formData.append('xlsx', xlsx);

    fetch('https://finfortes.pythonanywhere.com/conciliar', {
        method: 'POST',
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            if (data.erro) {
                document.getElementById('resultado').innerText = 'Erro: ' + data.erro;
                return;
            }

            ultimoResultado = data;

            document.getElementById('resultado').innerText = '';
            document.getElementById('resultadoStats').classList.remove('hidden');
            atualizarStatsExibidos();

            document.getElementById('logPdf').innerText = JSON.stringify(data.log_pdf, null, 2);
            document.getElementById('logErp').innerText = JSON.stringify(data.log_erp, null, 2);
            document.getElementById('logConciliacao').innerText = JSON.stringify(data, null, 2);
            document.getElementById('btnDownload').style.display = 'inline-block';
            document.getElementById('btnProximo').disabled = false;
        })
        .catch(err => {
            console.error('Erro:', err);
            document.getElementById('resultado').innerText = 'Erro ao conectar com o VPS';
        });
}

function toggleLog() {
    logVisivel = !logVisivel;
    document.getElementById('logBox').style.display = logVisivel ? 'block' : 'none';
}

function baixarJson() {
    if (!ultimoResultado) return;

    const blob = new Blob([JSON.stringify(ultimoResultado, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'conciliacao.json';
    a.click();

    URL.revokeObjectURL(url);
}

// ---- Utilitarios ----

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Formata a UN so para exibicao (o dado salvo continua cru, ex: "65400").
// Caso especial "7" -> "Sede (7)". Demais: preenche com zeros a esquerda ate 6 digitos
// e separa os 2 ultimos com traco, ex: "65400" -> "0654-00".
function formatUN(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const str = String(valor).trim();
    if (str === '7') return 'Sede (7)';
    if (!/^\d+$/.test(str)) return esc(str);
    const padded = str.padStart(6, '0');
    return esc(`${padded.slice(0, -2)}-${padded.slice(-2)}`);
}

// Formata CPF (11 digitos) ou CNPJ (14 digitos) so pra exibicao — o dado salvo continua cru,
// sem pontuacao, do jeito que vem da planilha/comprovante. Outra quantidade de digitos mostra como veio.
function formatCpfCnpj(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const digitos = String(valor).replace(/\D/g, '');
    if (digitos.length === 11) {
        return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9, 11)}`;
    }
    if (digitos.length === 14) {
        return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
    }
    return esc(valor);
}

function formatValor(val) {
    if (val === null || val === undefined || val === '') return '';
    const n = parseFloat(val);
    if (isNaN(n)) return esc(val);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Converte DD/MM/YYYY ou YYYY-MM-DD para numero YYYYMMDD (evita problema de timezone)
function parseDataNum(str) {
    if (!str) return null;
    const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return parseInt(`${br[3]}${br[2]}${br[1]}`, 10); // YYYYMMDD
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return parseInt(`${iso[1]}${iso[2]}${iso[3]}`, 10); // YYYYMMDD
    return null;
}

// ---- Estados visuais ----

function mostrarVazio() {
    emptyState.classList.remove('hidden');
    noResults.classList.add('hidden');
    resultsTable.classList.add('hidden');
    tableBody.innerHTML = '';
    checkAll.checked = false;
    checkAll.indeterminate = false;
    // Nao esconde o toolbar aqui: a selecao acumulada (de buscas anteriores) continua valendo
    // mesmo com a busca atual vazia, entao o botao de baixar continua visivel se houver selecionados.
    updateToolbar();
}

function mostrarCarregando() {
    emptyState.classList.add('hidden');
    noResults.classList.add('hidden');
    resultsTable.classList.add('hidden');
}

// ---- Busca ----
// Executa se houver texto, OU se as duas datas (inicio e fim) estiverem preenchidas.
// Preencher so uma data nao executa: senao viria tudo antes/depois dela, sem limite.

function deveExecutar(q, from, to) {
    if (q.length > 0) return true;
    return !!from && !!to;
}

async function buscar() {
    const q    = searchInput.value.trim();
    const from = dateFrom.value;   // YYYY-MM-DD ou ''
    const to   = dateTo.value;     // YYYY-MM-DD ou ''

    if (!deveExecutar(q, from, to)) {
        mostrarVazio();
        return;
    }

    mostrarCarregando();

    let query = sb
        .from(TABELA_CONCILIACOES)
        .select('id, favorecido, ap, numero_documento, cpf, cnpj, pagamento_erp, valor_erp, un, tipo_documento')
        .order('id', { ascending: true })
        .limit(500);

    const campo = searchField ? searchField.value : 'todos';

    if (q) {
        const digitsQ = q.replace(/\D/g, '');
        const numQ    = parseFloat(q.replace(',', '.'));
        const isValor = !isNaN(numQ) && /^\d+([.,]\d+)?$/.test(q) && q.includes(',');
        const filtros = [];

        if (campo === 'nome') {
            filtros.push(`favorecido.ilike.%${q}%`);
        } else if (campo === 'ap') {
            // ap e coluna inteira: ilike nao funciona nela no Postgres, entao o prefixo e filtrado no cliente (abaixo)
            if (!/^\d+$/.test(q)) {
                render([]);
                return;
            }
        } else if (campo === 'docto') {
            filtros.push(`numero_documento.ilike.%${q}%`);
        } else if (campo === 'un') {
            // un e coluna inteira: prefixo e filtrado no cliente (abaixo). Aceita digitar com ou sem mascara (ex: "0654-00")
            if (!digitsQ) {
                render([]);
                return;
            }
        } else if (campo === 'cpf') {
            if (digitsQ.length >= 3) {
                filtros.push(`cpf.ilike.%${digitsQ}%`);
                filtros.push(`cnpj.ilike.%${digitsQ}%`);
            }
            filtros.push(`cpf.ilike.%${q}%`);
            filtros.push(`cnpj.ilike.%${q}%`);
        } else {
            // "todos": busca em todos os campos ao mesmo tempo

            // CPF/CNPJ: busca pelos digitos puros E pelo valor como digitado (cobre banco com e sem mascara)
            if (digitsQ.length >= 3) {
                filtros.push(`cpf.ilike.%${digitsQ}%`);
                filtros.push(`cnpj.ilike.%${digitsQ}%`);
            }
            if (/[.\-\/]/.test(q)) {
                filtros.push(`cpf.ilike.%${q}%`);
                filtros.push(`cnpj.ilike.%${q}%`);
            }

            // Texto: favorecido e numero de documento (quando nao for so digitos)
            if (/\D/.test(q)) {
                filtros.push(`favorecido.ilike.%${q}%`);
                filtros.push(`numero_documento.ilike.%${q}%`);
            }

            // Numerico puro: AP (inteiro) e valor (com virgula/ponto decimal)
            if (/^\d+$/.test(q)) filtros.push(`ap.eq.${parseInt(q, 10)}`);
            if (isValor)          filtros.push(`valor_erp.eq.${numQ}`);
        }

        if (campo !== 'ap' && campo !== 'un') {
            if (filtros.length > 0) {
                query = query.or(filtros.join(','));
            } else if (campo !== 'todos') {
                // Campo especifico selecionado mas o texto digitado nao é valido para ele (ex: nome/docto vazio) -> nenhum resultado
                render([]);
                return;
            }
        }
    }

    const { data, error } = await query;

    if (error) {
        console.error(error);
        noResults.querySelector('p').textContent = 'Erro ao buscar: ' + error.message;
        noResults.classList.remove('hidden');
        return;
    }

    let resultado = data || [];

    // Filtro de AP por prefixo no cliente (ap e coluna inteira, entao o "comeca com" nao da pra fazer via ilike no banco)
    if (campo === 'ap' && q) {
        resultado = resultado.filter(r => r.ap !== null && r.ap !== undefined && String(r.ap).startsWith(q));
    }

    // Filtro de UN por prefixo no cliente (un tambem e coluna inteira; ignora mascara/zeros a esquerda digitados, ex: "0654-00" -> "654")
    if (campo === 'un' && q) {
        const digitsQ = q.replace(/\D/g, '').replace(/^0+/, '') || '0';
        resultado = resultado.filter(r => r.un !== null && r.un !== undefined && String(r.un).startsWith(digitsQ));
    }

    // Filtro de data no cliente — compara como numero YYYYMMDD, sem timezone
    if (from || to) {
        const nFrom = from ? parseDataNum(from) : null;
        const nTo   = to   ? parseDataNum(to)   : null;

        resultado = resultado.filter(r => {
            const n = parseDataNum(r.pagamento_erp);
            if (!n) return false;
            if (nFrom && n < nFrom) return false;
            if (nTo   && n > nTo)   return false;
            return true;
        });
    }

    render(resultado);
}

// ---- Renderizacao ----

function render(rows) {
    const temResultado = rows.length > 0;

    noResults.classList.toggle('hidden', temResultado);
    resultsTable.classList.toggle('hidden', !temResultado);

    if (!temResultado) {
        noResults.querySelector('p').textContent = 'Nenhum resultado encontrado';
        checkAll.checked = false;
        checkAll.indeterminate = false;
        updateToolbar();
        return;
    }

    tableBody.innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
            <td class="col-check"><input type="checkbox" ${selecionados.has(String(r.id)) ? 'checked' : ''} onchange="onCheck(this)"></td>
            <td>${esc(r.favorecido)}</td>
            <td>${esc(r.ap)}</td>
            <td>${esc(r.numero_documento)}</td>
            <td>${formatCpfCnpj(r.cpf || r.cnpj)}</td>
            <td>${esc(r.pagamento_erp)}</td>
            <td>${formatValor(r.valor_erp)}</td>
            <td>${formatUN(r.un)}</td>
            <td>${esc(r.tipo_documento)}</td>
            <td class="col-action">
                <button class="btn-row-pdf" title="Baixar PDF" onclick="downloadRow(${r.id})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
            </td>
        </tr>
    `).join('');

    atualizarCheckAllHeader();
    updateToolbar();
}

// ---- Selecao / Checkboxes ----
// A selecao (Map "selecionados") acumula entre buscas: so muda quando o usuario marca/desmarca,
// clica em "Limpar seleção" ou remove um item pelo painel. A tabela renderizada eh so a "janela" atual.

function atualizarCheckAllHeader() {
    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
    const checked = [...checkboxes].filter(c => c.checked);
    checkAll.checked = checked.length === checkboxes.length && checkboxes.length > 0;
    checkAll.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
}

function onCheck(checkbox) {
    const tr = checkbox.closest('tr');
    const id = tr.dataset.id;

    if (checkbox.checked) {
        selecionados.set(id, { id, favorecido: tr.children[1].textContent });
    } else {
        selecionados.delete(id);
    }

    atualizarCheckAllHeader();
    updateToolbar();
    renderSelectedPanel();
}

function toggleAll(master) {
    tableBody.querySelectorAll('tr').forEach(tr => {
        const checkbox = tr.querySelector('input[type="checkbox"]');
        checkbox.checked = master.checked;
        const id = tr.dataset.id;

        if (master.checked) {
            selecionados.set(id, { id, favorecido: tr.children[1].textContent });
        } else {
            selecionados.delete(id);
        }
    });
    updateToolbar();
    renderSelectedPanel();
}

function updateToolbar() {
    const total = selecionados.size;
    toolbar.classList.toggle('hidden', total === 0);
    selectedCount.textContent = `${total} selecionado${total !== 1 ? 's' : ''}`;
    if (total === 0) selectedPanel.classList.add('hidden');
}

function renderSelectedPanel() {
    if (selecionados.size === 0) {
        selectedPanel.innerHTML = '';
        return;
    }
    selectedPanel.innerHTML = [...selecionados.values()].map(sel => `
        <div class="selected-chip" data-id="${esc(sel.id)}">
            <span>${esc(sel.favorecido)}</span>
            <button type="button" onclick="removerSelecionado('${esc(sel.id)}')" aria-label="Remover da seleção">&times;</button>
        </div>
    `).join('');
}

function toggleSelectedPanel() {
    if (selecionados.size === 0) return;
    renderSelectedPanel();
    selectedPanel.classList.toggle('hidden');
}

function removerSelecionado(id) {
    selecionados.delete(id);

    // Desmarca o checkbox se a linha ainda estiver visivel na busca atual
    const tr = tableBody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    if (tr) tr.querySelector('input[type="checkbox"]').checked = false;

    atualizarCheckAllHeader();
    updateToolbar();
    renderSelectedPanel();
}

function limparSelecao() {
    selecionados.clear();
    tableBody.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
    checkAll.checked = false;
    checkAll.indeterminate = false;
    updateToolbar();
    renderSelectedPanel();
}

// ---- PDF ----

const COLUNAS_COMPROVANTE = 'favorecido, cnpj_cpf, banco_comprovante, pagamento_comprovante, valor_comprovante, id_transacao';

const REGEX_MARCAS_DIACRITICAS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function sanitizeFilename(nome) {
    return (nome || 'comprovante')
        .normalize('NFD').replace(REGEX_MARCAS_DIACRITICAS, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'comprovante';
}

const ESTILO_COMPROVANTE_CSS = `
  .receipt-pdf-wrapper * { box-sizing: border-box; }
  .receipt-pdf-wrapper {
    font-family: Arial, Helvetica, sans-serif;
    background: #fff;
    padding: 25px 15px;
    color: #111;
    font-size: 12px;
    width: 794px;
  }
  .receipt-pdf-wrapper .receipt { max-width: 720px; margin: 0 auto; }
  .receipt-pdf-wrapper .top-bar { display: flex; justify-content: space-between; font-size: 11px; color: #222; margin-bottom: 16px; }
  .receipt-pdf-wrapper .bank-header { text-align: center; font-size: 12px; font-weight: bold; line-height: 1.4; margin-bottom: 14px; }
  .receipt-pdf-wrapper .doc-title-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .receipt-pdf-wrapper .doc-title-row .title { font-size: 12px; font-weight: bold; }
  .receipt-pdf-wrapper .section-label { font-weight: bold; margin-top: 12px; margin-bottom: 2px; }
  .receipt-pdf-wrapper .row { display: grid; grid-template-columns: 175px 1fr; column-gap: 12px; padding: 3px 0 3px 14px; line-height: 1.4; }
  .receipt-pdf-wrapper .row .value.strong { font-weight: bold; }
  .receipt-pdf-wrapper .footer { text-align: center; font-size: 11px; font-weight: bold; margin-top: 20px; }
  .receipt-pdf-wrapper .status-ok { color: #1c7c31; font-weight: bold; }
  .pdf-divider { border: none; border-top: 2px solid #999; width: 720px; margin: 10px auto; }
`;

function injetarEstiloComprovante() {
    if (document.getElementById('estilo-comprovante-pdf')) return;
    const style = document.createElement('style');
    style.id = 'estilo-comprovante-pdf';
    style.textContent = ESTILO_COMPROVANTE_CSS;
    document.head.appendChild(style);
}

function removerEstiloComprovante() {
    const style = document.getElementById('estilo-comprovante-pdf');
    if (style) style.remove();
}

// Monta o HTML do comprovante (layout Sicoob) preenchido com os dados vindos do Supabase
function montarHtmlComprovante(dados) {
    const agora = new Date();
    const dataHoraTopo = `${agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}, ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const dataPagamentoTitulo = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaTitulo = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const valorFormatado = dados.valor_comprovante ? `R$ ${dados.valor_comprovante}` : '';

    return `<div class="receipt-pdf-wrapper">
<div class="receipt">
  <div class="top-bar">
    <span>${esc(dataHoraTopo)}</span>
    <span>Sicoob | Internet Banking</span>
  </div>

  <div class="bank-header">
    SICOOB - SISTEMA DE COOPERATIVAS DE CRÉDITO DO BRASIL<br>
    SISBR - SISTEMA DE INFORMÁTICA DO SICOOB
  </div>

  <div class="doc-title-row">
    <span>${esc(dataPagamentoTitulo)}</span>
    <span class="title">COMPROVANTE DE EFETIVAÇÃO DE PAGAMENTO PIX</span>
    <span>${esc(horaTitulo)}</span>
  </div>

  <div class="row" style="padding-left:0; grid-template-columns:189px 1fr;">
    <span class="section-label" style="margin:0;">Tipo Pagamento:</span>
    <span>Pix via chave</span>
  </div>

  <div class="section-label">Pagador:</div>
  <div class="row">
    <span>Instituição:</span>
    <span>COOPERATIVA DE CRÉDITO SUL-SERRANA DO ESPÍRITO SANTO</span>
  </div>
  <div class="row">
    <span>Nome:</span>
    <span>FORTES ENGENHARIA LTDA</span>
  </div>
  <div class="row">
    <span>CPF/CNPJ:</span>
    <span>**.677.132/0001-**</span>
  </div>

  <div class="section-label">Destinatário:</div>
  <div class="row">
    <span>Nome:</span>
    <span>${esc(dados.favorecido)}</span>
  </div>
  <div class="row">
    <span>CPF/CNPJ:</span>
    <span>${formatCpfCnpj(dados.cnpj_cpf)}</span>
  </div>
  <div class="row">
    <span>Instituição/Banco:</span>
    <span>${esc(dados.banco_comprovante)}</span>
  </div>

  <div class="section-label">Dados do pagamento:</div>
  <div class="row">
    <span>Data do pagamento:</span>
    <span>${esc(dados.pagamento_comprovante)}</span>
  </div>
  <div class="row">
    <span>Valor:</span>
    <span class="value strong">${esc(valorFormatado)}</span>
  </div>
  <div class="row">
    <span>ID Transação:</span>
    <span>${esc(dados.id_transacao)}</span>
  </div>
  <div class="row">
    <span>Situação do pagamento:</span>
    <span class="status-ok">Finalizado com sucesso</span>
  </div>

  <div class="footer">
    OUVIDORIA SICOOB : 08007250996
  </div>
</div>
</div>`;
}

function criarContainerOculto() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '794px';
    container.style.background = '#fff';
    document.body.appendChild(container);
    return container;
}

// Recebe o HTML de cada pagina (ja pronto, sem o wrapper .pdf-page) e monta o PDF final,
// capturando e adicionando cada pagina individualmente via html2canvas + jsPDF.
// Reaproveita um unico container/estilo injetado ao inves de recriar tudo a cada pagina (bem mais rapido com muitas paginas).
async function gerarPdfComPaginas(paginasConteudo, nomeArquivo, onProgress) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const larguraPagina = pdf.internal.pageSize.getWidth();
    const alturaPagina = pdf.internal.pageSize.getHeight();

    injetarEstiloComprovante();
    const container = criarContainerOculto();

    try {
        for (let i = 0; i < paginasConteudo.length; i++) {
            container.innerHTML = `<div class="pdf-page">${paginasConteudo[i]}</div>`;

            const canvas = await html2canvas(container.querySelector('.pdf-page'), {
                scale: 1.5,
                useCORS: true,
                backgroundColor: '#ffffff',
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const alturaImagem = Math.min((canvas.height * larguraPagina) / canvas.width, alturaPagina);

            if (i > 0) pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, 0, larguraPagina, alturaImagem);

            if (onProgress) onProgress(i + 1, paginasConteudo.length);
        }
    } finally {
        container.remove();
        removerEstiloComprovante();
    }

    pdf.save(nomeArquivo);
}

async function gerarComprovantePDF(dados) {
    await gerarPdfComPaginas([montarHtmlComprovante(dados)], `${sanitizeFilename(dados.favorecido)}.pdf`);
}

// Junta varios comprovantes em 1 PDF, 2 por pagina separados por uma linha divisoria.
async function gerarComprovantesPDF(listaDados, onProgress) {
    const paginasConteudo = [];
    for (let i = 0; i < listaDados.length; i += 2) {
        const par = listaDados.slice(i, i + 2);
        paginasConteudo.push(par.map(montarHtmlComprovante).join('<hr class="pdf-divider">'));
    }

    await gerarPdfComPaginas(paginasConteudo, 'Comprovantes.pdf', onProgress);
}

async function baixarComprovante(id) {
    const { data, error } = await sb
        .from(TABELA_CONCILIACOES)
        .select(COLUNAS_COMPROVANTE)
        .eq('id', id)
        .single();

    if (error || !data) {
        alert('Erro ao buscar dados do comprovante: ' + (error ? error.message : 'registro não encontrado'));
        return;
    }

    await gerarComprovantePDF(data);
}

async function baixarComprovantesEmLote(ids) {
    const { data, error } = await sb
        .from(TABELA_CONCILIACOES)
        .select(`id, ${COLUNAS_COMPROVANTE}`)
        .in('id', ids);

    if (error || !data || !data.length) {
        alert('Erro ao buscar dados dos comprovantes: ' + (error ? error.message : 'nenhum registro encontrado'));
        return;
    }

    // Mantem a mesma ordem em que os registros aparecem na tabela
    const porId = new Map(data.map(d => [String(d.id), d]));
    const listaOrdenada = ids.map(id => porId.get(String(id))).filter(Boolean);

    const totalPaginas = Math.ceil(listaOrdenada.length / 2);
    try {
        await gerarComprovantesPDF(listaOrdenada, (atual) => {
            selectedCount.textContent = `Gerando PDF... página ${atual}/${totalPaginas}`;
        });
    } finally {
        updateToolbar();
    }
}

function downloadRow(id) {
    baixarComprovante(id);
}

function downloadPDF() {
    const ids = [...selecionados.keys()];
    if (ids.length === 0) return;

    if (ids.length === 1) {
        baixarComprovante(ids[0]);
        return;
    }

    baixarComprovantesEmLote(ids);
}

// ---- Eventos ----

function agendarBusca() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(buscar, 350);
}

searchInput.addEventListener('input', agendarBusca);
searchField.addEventListener('change', buscar);
// 'input' + debounce (nao 'change' direto) pra nao buscar a cada digito parcial da data (ex: so o dia preenchido)
dateFrom.addEventListener('input', agendarBusca);
dateTo.addEventListener('input', agendarBusca);
