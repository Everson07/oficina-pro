const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket }
});

const STORAGE_BUCKET = 'evidencias';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function getConfig() {
  const rows = unwrap(await supabase.from('configuracoes').select('*').limit(1));
  if (rows.length) return rows[0];
  return unwrap(await supabase.from('configuracoes').insert({
    nome_oficina: 'Oficina Mecânica Especializada',
    telefone_whatsapp: '',
    aliquota_imposto_peca: 6,
    aliquota_imposto_servico: 5,
    margem_lucro_padrao: 30
  }).select().single());
}

async function updateConfig(data) {
  const current = await getConfig();
  return unwrap(await supabase.from('configuracoes').update({
    nome_oficina: data.nome_oficina,
    telefone_whatsapp: data.telefone_whatsapp || '',
    aliquota_imposto_peca: Number(data.aliquota_imposto_peca) || 6,
    aliquota_imposto_servico: Number(data.aliquota_imposto_servico) || 5,
    margem_lucro_padrao: Number(data.margem_lucro_padrao) || 30,
    updated_at: new Date().toISOString()
  }).eq('id', current.id).select().single());
}

function normalizePlate(value) {
  return String(value || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

async function getVeiculoByPlaca(placa) {
  return unwrap(await supabase.from('veiculos').select('*').eq('placa', normalizePlate(placa)).maybeSingle());
}

async function deleteVeiculo(id) {
  return unwrap(await supabase.from('veiculos').delete().eq('id', id).select('id').maybeSingle());
}

async function createOrUpdateVeiculo(data) {
  const placa = normalizePlate(data.placa);
  const existing = await getVeiculoByPlaca(placa);
  const values = {
    placa,
    modelo_ano: data.modelo_ano,
    chassi: data.chassi || null,
    cliente_nome: data.cliente_nome,
    cliente_telefone: data.cliente_telefone
  };
  if (existing) {
    return unwrap(await supabase.from('veiculos').update(values).eq('id', existing.id).select().single());
  }
  return unwrap(await supabase.from('veiculos').insert(values).select().single());
}

async function searchVeiculosEClientes(query) {
  const q = String(query || '').trim().toLowerCase();
  const rows = unwrap(await supabase.from('veiculos').select('*').order('created_at', { ascending: false }).limit(200));
  const filtered = rows.filter(v => [v.placa, v.cliente_nome, v.cliente_telefone, v.modelo_ano]
    .some(value => String(value || '').toLowerCase().includes(q)));
  const osRows = unwrap(await supabase.from('ordens_servico').select('veiculo_id,created_at'));
  return filtered.slice(0, 20).map(v => {
    const history = osRows.filter(os => os.veiculo_id === v.id);
    return { ...v, total_passagens: history.length, ultima_passagem: history.map(x => x.created_at).sort().pop() || null };
  });
}

async function createOS(data) {
  const veiculo = await createOrUpdateVeiculo(data);
  const row = unwrap(await supabase.from('ordens_servico').insert({
    veiculo_id: veiculo.id,
    km_entrada: Number(data.km_entrada) || 0,
    status_patio: data.status_patio || 'diagnostico',
    forma_pagamento: data.forma_pagamento || null,
    data_agendamento: data.data_agendamento || null,
    queixa_cliente: data.queixa_cliente || '',
    notas_bancada: data.notas_bancada || '',
    token_publico: crypto.randomBytes(16).toString('hex')
  }).select().single());
  return getOSById(row.id);
}

function withVehicle(row) {
  const vehicle = row.veiculos || {};
  const result = { ...row };
  delete result.veiculos;
  return { ...result, placa: vehicle.placa, modelo_ano: vehicle.modelo_ano, chassi: vehicle.chassi, cliente_nome: vehicle.cliente_nome, cliente_telefone: vehicle.cliente_telefone };
}

function totals(items) {
  return items.reduce((acc, item) => {
    if (item.tipo === 'peca') acc.totalPecas += Number(item.preco_venda_total) || 0;
    if (item.tipo === 'servico') acc.totalServicos += Number(item.preco_venda_total) || 0;
    acc.totalGeral += Number(item.preco_venda_total) || 0;
    acc.custoTotal += (Number(item.custo_compra_unitario) || 0) * (Number(item.quantidade) || 0);
    acc.impostoTotal += Number(item.valor_imposto_total) || 0;
    acc.lucroLiquidoTotal += Number(item.lucro_liquido_total) || 0;
    return acc;
  }, { totalPecas: 0, totalServicos: 0, totalGeral: 0, custoTotal: 0, impostoTotal: 0, lucroLiquidoTotal: 0 });
}

async function getOSById(id) {
  const row = unwrap(await supabase.from('ordens_servico').select('*, veiculos(*)').eq('id', id).maybeSingle());
  if (!row) return null;
  const [dtcs, evidencias, itens, pendencias] = await Promise.all([
    supabase.from('os_dtcs').select('*').eq('os_id', id).order('created_at'),
    supabase.from('os_evidencias').select('*').eq('os_id', id).order('created_at'),
    supabase.from('os_itens_financeiros').select('*').eq('os_id', id).order('created_at'),
    supabase.from('os_pendencias').select('*').eq('os_id', id).order('created_at')
  ]);
  const os = withVehicle(row);
  os.dtcs = unwrap(dtcs); os.evidencias = unwrap(evidencias); os.itens = unwrap(itens); os.pendencias = unwrap(pendencias);
  os.totais = totals(os.itens);
  return os;
}

async function updateOS(id, data) {
  unwrap(await supabase.from('ordens_servico').update({
    km_entrada: Number(data.km_entrada) || 0,
    status_patio: data.status_patio,
    forma_pagamento: data.forma_pagamento || null,
    data_agendamento: data.data_agendamento || null,
    queixa_cliente: data.queixa_cliente || '',
    notas_bancada: data.notas_bancada || ''
  }).eq('id', id));
  return getOSById(id);
}

async function updateOSStatus(id, newStatus) {
  const values = { status_patio: newStatus };
  if (newStatus === 'entregue') values.entregue_em = new Date().toISOString();
  unwrap(await supabase.from('ordens_servico').update(values).eq('id', id));
  return getOSById(id);
}

async function listPatio() {
  const osRows = unwrap(await supabase.from('ordens_servico').select('*, veiculos(*)').not('status_patio', 'in', '(entregue,cancelado)').order('numero_os', { ascending: false }));
  const ids = osRows.map(row => row.id);
  if (!ids.length) return [];
  const [dtcs, evidencias, pendencias, itens] = await Promise.all([
    supabase.from('os_dtcs').select('os_id,status').in('os_id', ids),
    supabase.from('os_evidencias').select('os_id').in('os_id', ids),
    supabase.from('os_pendencias').select('os_id,resolvido').in('os_id', ids),
    supabase.from('os_itens_financeiros').select('os_id,preco_venda_total').in('os_id', ids)
  ]);
  const dtcRows = unwrap(dtcs), evidenceRows = unwrap(evidencias), pendingRows = unwrap(pendencias), itemRows = unwrap(itens);
  return osRows.map(row => {
    const os = withVehicle(row);
    os.dtcs_ativos = dtcRows.filter(x => x.os_id === row.id && x.status === 'ATIVO').length;
    os.total_evidencias = evidenceRows.filter(x => x.os_id === row.id).length;
    os.pendencias_abertas = pendingRows.filter(x => x.os_id === row.id && !x.resolvido).length;
    os.valor_total_os = itemRows.filter(x => x.os_id === row.id).reduce((sum, x) => sum + (Number(x.preco_venda_total) || 0), 0);
    return os;
  });
}

async function listHistoricoVeiculo(veiculoId) {
  const rows = unwrap(await supabase.from('ordens_servico').select('*').eq('veiculo_id', veiculoId).order('numero_os', { ascending: false }));
  const ids = rows.map(row => row.id);
  const items = ids.length ? unwrap(await supabase.from('os_itens_financeiros').select('os_id,preco_venda_total').in('os_id', ids)) : [];
  return rows.map(row => ({ ...row, total_gasto: items.filter(x => x.os_id === row.id).reduce((sum, x) => sum + (Number(x.preco_venda_total) || 0), 0) }));
}

async function addDTC(osId, { codigo, descricao, status }) {
  return unwrap(await supabase.from('os_dtcs').insert({ os_id: osId, codigo: codigo.toUpperCase().trim(), descricao: descricao || '', status: status || 'ATIVO' }).select().single());
}
async function deleteDTC(id) { return unwrap(await supabase.from('os_dtcs').delete().eq('id', id)); }

async function uploadEvidence(base64Image) {
  const matches = String(base64Image || '').match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches) return '';
  const mime = matches[1];
  const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const filename = `evidencia_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const upload = await supabase.storage.from(STORAGE_BUCKET).upload(filename, Buffer.from(matches[2], 'base64'), { contentType: mime, upsert: false });
  unwrap(upload);
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename).data.publicUrl;
}

async function addEvidencia(osId, veiculoId, data) {
  return unwrap(await supabase.from('os_evidencias').insert({
    os_id: osId, veiculo_id: veiculoId, categoria: data.categoria, momento: data.momento || 'recepcao',
    titulo_observacao: data.titulo_observacao || '', storage_path: data.storage_path || '', visivel_cliente: data.visivel_cliente ? true : false
  }).select().single());
}

async function deleteEvidencia(id) {
  const row = unwrap(await supabase.from('os_evidencias').select('storage_path').eq('id', id).maybeSingle());
  if (row?.storage_path?.includes(`/storage/v1/object/public/${STORAGE_BUCKET}/`)) {
    const filename = row.storage_path.split(`/storage/v1/object/public/${STORAGE_BUCKET}/`)[1];
    if (filename) await supabase.storage.from(STORAGE_BUCKET).remove([filename]);
  }
  return unwrap(await supabase.from('os_evidencias').delete().eq('id', id));
}

async function addItemFinanceiro(osId, data) {
  const config = await getConfig();
  const tipo = data.tipo;
  const origem = data.origem || 'oficina';
  const modalidade = data.modalidade_cobranca || 'padrao';
  const descricao = data.descricao;
  const quantidade = Number(data.quantidade) > 0 ? Number(data.quantidade) : 1;
  let custoUnit = Number(data.custo_compra_unitario) || 0;
  let margem = Number(data.margem_percentual); if (isNaN(margem)) margem = 0;
  let imposto = Number(data.imposto_percentual); if (isNaN(imposto)) imposto = 0;
  let precoVendaUnit = 0, valorImpostoTotal = 0, lucroLiquidoTotal = 0;

  if (tipo === 'peca') {
    if (origem === 'cliente') { custoUnit = 0; margem = 0; imposto = 0; }
    else {
      if (margem <= 0) margem = config.margem_lucro_padrao;
      if (imposto <= 0) imposto = config.aliquota_imposto_peca;
      if (Number(data.preco_venda_unitario) > 0 && !data.calcular_markup_automatico) precoVendaUnit = Number(data.preco_venda_unitario);
      else { const divisor = 1 - ((margem + imposto) / 100); precoVendaUnit = divisor > 0.05 ? custoUnit / divisor : custoUnit * 1.5; }
      const impostoUnit = precoVendaUnit * (imposto / 100); valorImpostoTotal = impostoUnit * quantidade; lucroLiquidoTotal = (precoVendaUnit - custoUnit - impostoUnit) * quantidade;
    }
  } else {
    if (imposto <= 0) imposto = config.aliquota_imposto_servico;
    if (modalidade === 'incluso_diagnostico') { custoUnit = 0; precoVendaUnit = 0; imposto = 0; }
    else if (modalidade === 'abatimento_diagnostico') { precoVendaUnit = -Math.abs(Number(data.preco_venda_unitario) || 0); lucroLiquidoTotal = precoVendaUnit * quantidade; imposto = 0; }
    else if (modalidade === 'taxa_diagnostico') {
      precoVendaUnit = Number(data.preco_venda_unitario) || 300;
      const existing = unwrap(await supabase.from('os_itens_financeiros').select('id').eq('os_id', osId).eq('modalidade_cobranca', modalidade).maybeSingle());
      const impostoUnit = precoVendaUnit * (imposto / 100); valorImpostoTotal = impostoUnit * quantidade; lucroLiquidoTotal = (precoVendaUnit - impostoUnit) * quantidade;
      if (existing) return unwrap(await supabase.from('os_itens_financeiros').update({ descricao, preco_venda_unitario: precoVendaUnit, preco_venda_total: precoVendaUnit * quantidade, imposto_percentual: imposto, valor_imposto_total: valorImpostoTotal, lucro_liquido_total: lucroLiquidoTotal }).eq('id', existing.id).select().single());
    } else { precoVendaUnit = Number(data.preco_venda_unitario) || 0; const impostoUnit = precoVendaUnit * (imposto / 100); valorImpostoTotal = impostoUnit * quantidade; lucroLiquidoTotal = (precoVendaUnit - impostoUnit) * quantidade; }
  }
  return unwrap(await supabase.from('os_itens_financeiros').insert({
    os_id: osId, tipo, origem, modalidade_cobranca: modalidade, descricao, quantidade,
    custo_compra_unitario: custoUnit, margem_percentual: margem, imposto_percentual: imposto,
    valor_imposto_total: valorImpostoTotal, lucro_liquido_total: lucroLiquidoTotal,
    preco_venda_unitario: precoVendaUnit, preco_venda_total: precoVendaUnit * quantidade
  }).select().single());
}
async function deleteItemFinanceiro(id) { return unwrap(await supabase.from('os_itens_financeiros').delete().eq('id', id)); }

async function addPendencia(osId, veiculoId, data) {
  const dias = Number(data.dias_para_retorno) || 45;
  const date = new Date(); date.setDate(date.getDate() + dias);
  return unwrap(await supabase.from('os_pendencias').insert({ os_id: osId, veiculo_id: veiculoId, descricao_defeito: data.descricao_defeito, urgencia: data.urgencia || 'media', dias_para_retorno: dias, data_prevista_retorno: date.toISOString().split('T')[0] }).select().single());
}
async function toggleResolverPendencia(id, resolvido) { return unwrap(await supabase.from('os_pendencias').update({ resolvido: !!resolvido }).eq('id', id).select().single()); }

async function getDashboardStats() {
  const [config, osRows, items, pendencias, vehicles] = await Promise.all([
    getConfig(),
    supabase.from('ordens_servico').select('id,status_patio,veiculo_id').then(unwrap),
    supabase.from('os_itens_financeiros').select('os_id,preco_venda_total,custo_compra_unitario,quantidade,valor_imposto_total,lucro_liquido_total').then(unwrap),
    supabase.from('os_pendencias').select('*').eq('resolvido', false).then(unwrap),
    supabase.from('veiculos').select('id,placa,modelo_ano,cliente_nome,cliente_telefone').then(unwrap)
  ]);
  const statusMap = { agendado: 0, diagnostico: 0, aguardando: 0, execucao: 0, pronto: 0 };
  osRows.filter(x => !['entregue', 'cancelado'].includes(x.status_patio)).forEach(x => { if (statusMap[x.status_patio] !== undefined) statusMap[x.status_patio]++; });
  const activeIds = new Set(osRows.filter(x => x.status_patio !== 'cancelado').map(x => x.id));
  const financeiro = items.filter(x => activeIds.has(x.os_id)).reduce((a, x) => ({ faturamento_bruto: a.faturamento_bruto + Number(x.preco_venda_total || 0), custo_pecas: a.custo_pecas + Number(x.custo_compra_unitario || 0) * Number(x.quantidade || 0), impostos_provisionados: a.impostos_provisionados + Number(x.valor_imposto_total || 0), lucro_liquido_real: a.lucro_liquido_real + Number(x.lucro_liquido_total || 0) }), { faturamento_bruto: 0, custo_pecas: 0, impostos_provisionados: 0, lucro_liquido_real: 0 });
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
  const osMap = new Map(osRows.map(o => [o.id, o]));
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 15);
  const radarRetorno = pendencias.filter(p => new Date(`${p.data_prevista_retorno}T00:00:00`) <= cutoff).sort((a, b) => String(a.data_prevista_retorno).localeCompare(String(b.data_prevista_retorno))).slice(0, 15).map(p => ({ ...p, ...vehicleMap.get(p.veiculo_id), numero_os: osMap.get(p.os_id)?.numero_os }));
  return { config, patio: { total: Object.values(statusMap).reduce((a, b) => a + b, 0), ...statusMap }, financeiro, radarRetorno };
}

async function getPortalCliente(token) {
  const osRow = unwrap(await supabase.from('ordens_servico').select('*, veiculos(*)').eq('token_publico', token).maybeSingle());
  if (!osRow) return null;
  const os = withVehicle(osRow);
  const [config, evidencias, itens, pendencias] = await Promise.all([
    getConfig(),
    supabase.from('os_evidencias').select('id,categoria,momento,titulo_observacao,storage_path,created_at').eq('os_id', os.id).eq('visivel_cliente', true).order('created_at').then(unwrap),
    supabase.from('os_itens_financeiros').select('id,tipo,origem,modalidade_cobranca,descricao,quantidade,preco_venda_unitario,preco_venda_total').eq('os_id', os.id).order('tipo').order('created_at').then(unwrap),
    supabase.from('os_pendencias').select('id,descricao_defeito,urgencia,data_prevista_retorno').eq('os_id', os.id).then(unwrap)
  ]);
  os.nome_oficina = config.nome_oficina; os.oficina_whatsapp = config.telefone_whatsapp; os.evidencias = evidencias; os.itens = itens; os.pendencias = pendencias; os.totalGeral = itens.reduce((sum, item) => sum + Number(item.preco_venda_total || 0), 0);
  return os;
}

async function aprovarOrcamentoCliente(token) {
  const os = unwrap(await supabase.from('ordens_servico').select('id').eq('token_publico', token).maybeSingle());
  if (!os) return null;
  unwrap(await supabase.from('ordens_servico').update({ aprovado_cliente_em: new Date().toISOString(), status_patio: 'execucao' }).eq('id', os.id));
  return getPortalCliente(token);
}

module.exports = {
  isSupabase: true,
  uploadEvidence,
  getConfig, updateConfig, getVeiculoByPlaca, deleteVeiculo, createOrUpdateVeiculo, searchVeiculosEClientes,
  createOS, getOSById, updateOS, updateOSStatus, listPatio, listHistoricoVeiculo,
  addDTC, deleteDTC, addEvidencia, deleteEvidencia, addItemFinanceiro, deleteItemFinanceiro,
  addPendencia, toggleResolverPendencia, getDashboardStats, getPortalCliente, aprovarOrcamentoCliente
};
