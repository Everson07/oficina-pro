const DatabaseSync = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Garante pasta de uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'oficina.db');
const db = new DatabaseSync(dbPath);

// Configurações de performance do SQLite (WAL mode, foreign keys)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// Criação do Schema Completo
db.exec(`
  CREATE TABLE IF NOT EXISTS configuracoes (
    id TEXT PRIMARY KEY,
    nome_oficina TEXT NOT NULL DEFAULT 'Minha Oficina Especializada',
    telefone_whatsapp TEXT DEFAULT '',
    aliquota_imposto_peca REAL DEFAULT 6.0,
    aliquota_imposto_servico REAL DEFAULT 5.0,
    margem_lucro_padrao REAL DEFAULT 30.0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS veiculos (
    id TEXT PRIMARY KEY,
    placa TEXT NOT NULL UNIQUE,
    modelo_ano TEXT NOT NULL,
    chassi TEXT,
    cliente_nome TEXT NOT NULL,
    cliente_telefone TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_veiculos_placa ON veiculos(placa);

  CREATE TABLE IF NOT EXISTS ordens_servico (
    id TEXT PRIMARY KEY,
    numero_os INTEGER UNIQUE,
    veiculo_id TEXT NOT NULL,
    km_entrada INTEGER NOT NULL,
    status_patio TEXT NOT NULL DEFAULT 'diagnostico', -- agendado, diagnostico, aguardando, execucao, pronto, entregue, cancelado
    forma_pagamento TEXT,
    data_agendamento TEXT,
    queixa_cliente TEXT,
    notas_bancada TEXT,
    token_publico TEXT NOT NULL UNIQUE,
    aprovado_cliente_em TEXT,
    entregue_em TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_os_token ON ordens_servico(token_publico);
  CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status_patio);

  CREATE TABLE IF NOT EXISTS os_dtcs (
    id TEXT PRIMARY KEY,
    os_id TEXT NOT NULL,
    codigo TEXT NOT NULL,
    descricao TEXT,
    status TEXT NOT NULL DEFAULT 'ATIVO', -- ATIVO | PASSADO
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (os_id) REFERENCES ordens_servico(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS os_evidencias (
    id TEXT PRIMARY KEY,
    os_id TEXT NOT NULL,
    veiculo_id TEXT NOT NULL,
    categoria TEXT NOT NULL, -- vistoria_entrada | osciloscopio | scanner | inspecao
    momento TEXT NOT NULL, -- recepcao | antes | depois
    titulo_observacao TEXT,
    storage_path TEXT NOT NULL,
    visivel_cliente INTEGER NOT NULL DEFAULT 1, -- 1=true, 0=false
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (os_id) REFERENCES ordens_servico(id) ON DELETE CASCADE,
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS os_itens_financeiros (
    id TEXT PRIMARY KEY,
    os_id TEXT NOT NULL,
    tipo TEXT NOT NULL, -- peca | servico
    origem TEXT NOT NULL, -- oficina | cliente
    modalidade_cobranca TEXT NOT NULL DEFAULT 'padrao', -- padrao | taxa_diagnostico | incluso_diagnostico | abatimento_diagnostico
    descricao TEXT NOT NULL,
    quantidade REAL NOT NULL DEFAULT 1.0,
    custo_compra_unitario REAL NOT NULL DEFAULT 0.0,
    margem_percentual REAL NOT NULL DEFAULT 0.0,
    imposto_percentual REAL NOT NULL DEFAULT 0.0,
    valor_imposto_total REAL NOT NULL DEFAULT 0.0,
    lucro_liquido_total REAL NOT NULL DEFAULT 0.0,
    preco_venda_unitario REAL NOT NULL DEFAULT 0.0,
    preco_venda_total REAL NOT NULL DEFAULT 0.0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (os_id) REFERENCES ordens_servico(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS os_pendencias (
    id TEXT PRIMARY KEY,
    os_id TEXT NOT NULL,
    veiculo_id TEXT NOT NULL,
    descricao_defeito TEXT NOT NULL,
    urgencia TEXT NOT NULL DEFAULT 'media', -- baixa | media | alta | critica
    dias_para_retorno INTEGER NOT NULL DEFAULT 45,
    data_prevista_retorno TEXT NOT NULL,
    resolvido INTEGER NOT NULL DEFAULT 0, -- 0=false, 1=true
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (os_id) REFERENCES ordens_servico(id) ON DELETE CASCADE,
    FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE
  );
`);

// Migração segura para tabelas existentes
try {
  db.exec("ALTER TABLE os_itens_financeiros ADD COLUMN modalidade_cobranca TEXT NOT NULL DEFAULT 'padrao'");
} catch (_) {}

// Garante configuração inicial
const configCheck = db.prepare("SELECT COUNT(*) as total FROM configuracoes").get();
if (configCheck.total === 0) {
  const insertConfig = db.prepare(`
    INSERT INTO configuracoes (id, nome_oficina, telefone_whatsapp, aliquota_imposto_peca, aliquota_imposto_servico, margem_lucro_padrao)
    VALUES ('default', 'Oficina Mecânica Especializada', '', 6.0, 5.0, 30.0)
  `);
  insertConfig.run();
}

// ----------------------------------------------------
// Métodos de Repositório / Acesso a Dados
// ----------------------------------------------------

function getConfig() {
  return db.prepare("SELECT * FROM configuracoes WHERE id = 'default'").get();
}

function updateConfig(data) {
  const stmt = db.prepare(`
    UPDATE configuracoes 
    SET nome_oficina = ?, 
        telefone_whatsapp = ?, 
        aliquota_imposto_peca = ?, 
        aliquota_imposto_servico = ?, 
        margem_lucro_padrao = ?, 
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 'default'
  `);
  stmt.run(
    data.nome_oficina,
    data.telefone_whatsapp || '',
    Number(data.aliquota_imposto_peca) || 6.0,
    Number(data.aliquota_imposto_servico) || 5.0,
    Number(data.margem_lucro_padrao) || 30.0
  );
  return getConfig();
}

function getVeiculoByPlaca(placa) {
  const p = placa.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  return db.prepare("SELECT * FROM veiculos WHERE REPLACE(REPLACE(UPPER(placa), '-', ''), ' ', '') = ?").get(p);
}

function deleteVeiculo(id) {
  const result = db.prepare('DELETE FROM veiculos WHERE id = ?').run(id);
  return result.changes > 0 ? { id } : null;
}

function createOrUpdateVeiculo(data) {
  const placaLimpa = data.placa.toUpperCase().trim();
  const existente = getVeiculoByPlaca(placaLimpa);
  if (existente) {
    const stmt = db.prepare(`
      UPDATE veiculos
      SET modelo_ano = ?, chassi = ?, cliente_nome = ?, cliente_telefone = ?
      WHERE id = ?
    `);
    stmt.run(data.modelo_ano, data.chassi || null, data.cliente_nome, data.cliente_telefone, existente.id);
    return getVeiculoByPlaca(placaLimpa);
  } else {
    const id = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO veiculos (id, placa, modelo_ano, chassi, cliente_nome, cliente_telefone)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, placaLimpa, data.modelo_ano, data.chassi || null, data.cliente_nome, data.cliente_telefone);
    return db.prepare("SELECT * FROM veiculos WHERE id = ?").get(id);
  }
}

function searchVeiculosEClientes(query) {
  const q = `%${(query || '').trim()}%`;
  return db.prepare(`
    SELECT v.*, 
      (SELECT COUNT(*) FROM ordens_servico WHERE veiculo_id = v.id) as total_passagens,
      (SELECT MAX(created_at) FROM ordens_servico WHERE veiculo_id = v.id) as ultima_passagem
    FROM veiculos v
    WHERE v.placa LIKE ? OR v.cliente_nome LIKE ? OR v.cliente_telefone LIKE ? OR v.modelo_ano LIKE ?
    ORDER BY v.created_at DESC
    LIMIT 20
  `).all(q, q, q, q);
}

function createOS(data) {
  // Garante veículo
  const veiculo = createOrUpdateVeiculo({
    placa: data.placa,
    modelo_ano: data.modelo_ano,
    chassi: data.chassi,
    cliente_nome: data.cliente_nome,
    cliente_telefone: data.cliente_telefone
  });

  const nextOsNumResult = db.prepare("SELECT COALESCE(MAX(numero_os), 0) + 1 as next_num FROM ordens_servico").get();
  const nextNum = nextOsNumResult.next_num;
  const osId = crypto.randomUUID();
  const token = crypto.randomBytes(16).toString('hex');

  const stmt = db.prepare(`
    INSERT INTO ordens_servico (
      id, numero_os, veiculo_id, km_entrada, status_patio, 
      forma_pagamento, data_agendamento, queixa_cliente, notas_bancada, token_publico
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    osId,
    nextNum,
    veiculo.id,
    Number(data.km_entrada) || 0,
    data.status_patio || 'diagnostico',
    data.forma_pagamento || null,
    data.data_agendamento || null,
    data.queixa_cliente || '',
    data.notas_bancada || '',
    token
  );

  return getOSById(osId);
}

function getOSById(id) {
  const os = db.prepare(`
    SELECT os.*, v.placa, v.modelo_ano, v.chassi, v.cliente_nome, v.cliente_telefone
    FROM ordens_servico os
    JOIN veiculos v ON os.veiculo_id = v.id
    WHERE os.id = ?
  `).get(id);

  if (!os) return null;

  os.dtcs = db.prepare("SELECT * FROM os_dtcs WHERE os_id = ? ORDER BY created_at ASC").all(id);
  os.evidencias = db.prepare("SELECT * FROM os_evidencias WHERE os_id = ? ORDER BY created_at ASC").all(id);
  os.itens = db.prepare("SELECT * FROM os_itens_financeiros WHERE os_id = ? ORDER BY created_at ASC").all(id);
  os.pendencias = db.prepare("SELECT * FROM os_pendencias WHERE os_id = ? ORDER BY created_at ASC").all(id);

  // Calcula totais da OS
  let totalPecas = 0;
  let totalServicos = 0;
  let totalGeral = 0;
  let custoTotal = 0;
  let impostoTotal = 0;
  let lucroLiquidoTotal = 0;

  for (const item of os.itens) {
    if (item.tipo === 'peca') totalPecas += item.preco_venda_total;
    if (item.tipo === 'servico') totalServicos += item.preco_venda_total;
    totalGeral += item.preco_venda_total;
    custoTotal += (item.custo_compra_unitario * item.quantidade);
    impostoTotal += item.valor_imposto_total;
    lucroLiquidoTotal += item.lucro_liquido_total;
  }

  os.totais = {
    totalPecas,
    totalServicos,
    totalGeral,
    custoTotal,
    impostoTotal,
    lucroLiquidoTotal
  };

  return os;
}

function updateOS(id, data) {
  const stmt = db.prepare(`
    UPDATE ordens_servico
    SET km_entrada = ?, 
        status_patio = ?, 
        forma_pagamento = ?, 
        data_agendamento = ?, 
        queixa_cliente = ?, 
        notas_bancada = ?
    WHERE id = ?
  `);
  stmt.run(
    Number(data.km_entrada) || 0,
    data.status_patio,
    data.forma_pagamento || null,
    data.data_agendamento || null,
    data.queixa_cliente || '',
    data.notas_bancada || '',
    id
  );
  return getOSById(id);
}

function updateOSStatus(id, newStatus) {
  let stmt;
  if (newStatus === 'entregue') {
    stmt = db.prepare("UPDATE ordens_servico SET status_patio = ?, entregue_em = CURRENT_TIMESTAMP WHERE id = ?");
  } else {
    stmt = db.prepare("UPDATE ordens_servico SET status_patio = ? WHERE id = ?");
  }
  stmt.run(newStatus, id);
  return getOSById(id);
}

function listPatio() {
  const rows = db.prepare(`
    SELECT 
      os.id, os.numero_os, os.km_entrada, os.status_patio, os.data_agendamento, os.created_at, os.token_publico, os.aprovado_cliente_em,
      v.placa, v.modelo_ano, v.cliente_nome, v.cliente_telefone,
      (SELECT COUNT(*) FROM os_dtcs WHERE os_id = os.id AND status = 'ATIVO') as dtcs_ativos,
      (SELECT COUNT(*) FROM os_evidencias WHERE os_id = os.id) as total_evidencias,
      (SELECT COUNT(*) FROM os_pendencias WHERE os_id = os.id AND resolvido = 0) as pendencias_abertas,
      (SELECT COALESCE(SUM(preco_venda_total), 0) FROM os_itens_financeiros WHERE os_id = os.id) as valor_total_os
    FROM ordens_servico os
    JOIN veiculos v ON os.veiculo_id = v.id
    WHERE os.status_patio != 'entregue' AND os.status_patio != 'cancelado'
    ORDER BY os.numero_os DESC
  `).all();
  return rows;
}

function listHistoricoVeiculo(veiculoId) {
  return db.prepare(`
    SELECT os.*, 
      (SELECT COALESCE(SUM(preco_venda_total), 0) FROM os_itens_financeiros WHERE os_id = os.id) as total_gasto
    FROM ordens_servico os
    WHERE os.veiculo_id = ?
    ORDER BY os.numero_os DESC
  `).all(veiculoId);
}

// DTCs
function addDTC(osId, { codigo, descricao, status }) {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO os_dtcs (id, os_id, codigo, descricao, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, osId, codigo.toUpperCase().trim(), descricao || '', status || 'ATIVO');
  return db.prepare("SELECT * FROM os_dtcs WHERE id = ?").get(id);
}

function deleteDTC(id) {
  return db.prepare("DELETE FROM os_dtcs WHERE id = ?").run(id);
}

// Evidências
function addEvidencia(osId, veiculoId, { categoria, momento, titulo_observacao, storage_path, visivel_cliente }) {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO os_evidencias (id, os_id, veiculo_id, categoria, momento, titulo_observacao, storage_path, visivel_cliente)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, 
    osId, 
    veiculoId, 
    categoria, 
    momento || 'recepcao', 
    titulo_observacao || '', 
    storage_path, 
    visivel_cliente ? 1 : 0
  );
  return db.prepare("SELECT * FROM os_evidencias WHERE id = ?").get(id);
}

function deleteEvidencia(id) {
  const ev = db.prepare("SELECT storage_path FROM os_evidencias WHERE id = ?").get(id);
  if (ev && ev.storage_path) {
    const full = path.join(__dirname, ev.storage_path);
    if (fs.existsSync(full)) {
      try { fs.unlinkSync(full); } catch (_) {}
    }
  }
  return db.prepare("DELETE FROM os_evidencias WHERE id = ?").run(id);
}

// Itens Financeiros com Cálculo de Markup Divisor (Peças) e Modalidade Mão de Obra ME
function addItemFinanceiro(osId, data) {
  const config = getConfig();
  const id = crypto.randomUUID();

  const tipo = data.tipo; // 'peca' | 'servico'
  const origem = data.origem || 'oficina'; // 'oficina' | 'cliente'
  const modalidade = data.modalidade_cobranca || 'padrao'; // 'padrao' | 'taxa_diagnostico' | 'incluso_diagnostico' | 'abatimento_diagnostico'
  const descricao = data.descricao;
  const quantidade = Number(data.quantidade) > 0 ? Number(data.quantidade) : 1.0;

  let custoUnit = Number(data.custo_compra_unitario) || 0.0;
  let margem = Number(data.margem_percentual);
  let imposto = Number(data.imposto_percentual);

  if (isNaN(margem)) margem = 0.0;
  if (isNaN(imposto)) imposto = 0.0;

  let precoVendaUnit = 0;
  let valorImpostoTotal = 0;
  let lucroLiquidoTotal = 0;

  if (tipo === 'peca') {
    if (origem === 'cliente') {
      // Peça trazida pelo cliente: custo 0, venda 0 (apenas registro de histórico/garantia)
      custoUnit = 0;
      margem = 0;
      imposto = 0;
      precoVendaUnit = 0;
    } else {
      if (margem <= 0) margem = config.margem_lucro_padrao;
      if (imposto <= 0) imposto = config.aliquota_imposto_peca;

      // Se o usuário digitou um preço de venda direto, recalculamos o lucro real
      if (Number(data.preco_venda_unitario) > 0 && !data.calcular_markup_automatico) {
        precoVendaUnit = Number(data.preco_venda_unitario);
        const impostoUnit = precoVendaUnit * (imposto / 100);
        const lucroUnit = precoVendaUnit - custoUnit - impostoUnit;
        valorImpostoTotal = impostoUnit * quantidade;
        lucroLiquidoTotal = lucroUnit * quantidade;
      } else {
        // Markup Divisor Oficial ME: Preco = Custo / (1 - ((Margem + Imposto) / 100))
        const divisor = 1 - ((margem + imposto) / 100);
        if (divisor > 0.05) {
          precoVendaUnit = custoUnit / divisor;
        } else {
          precoVendaUnit = custoUnit * 1.5;
        }
        const impostoUnit = precoVendaUnit * (imposto / 100);
        const lucroUnit = precoVendaUnit - custoUnit - impostoUnit;
        valorImpostoTotal = impostoUnit * quantidade;
        lucroLiquidoTotal = lucroUnit * quantidade;
      }
    }
  } else {
    // Tipo: Serviço (Mão de Obra) - Regime ME / Simples Nacional (Anexo III)
    if (imposto <= 0) imposto = config.aliquota_imposto_servico;

    if (modalidade === 'incluso_diagnostico') {
      // Serviço simples já coberto pelo valor do diagnóstico (R$ 0,00 adicional)
      custoUnit = 0;
      precoVendaUnit = 0;
      valorImpostoTotal = 0;
      lucroLiquidoTotal = 0;
    } else if (modalidade === 'abatimento_diagnostico') {
      // Abatimento ou desconto do diagnóstico se o cliente fez o serviço completo
      const valorAbatido = Math.abs(Number(data.preco_venda_unitario) || 0);
      precoVendaUnit = -valorAbatido;
      valorImpostoTotal = 0;
      lucroLiquidoTotal = -valorAbatido * quantidade;
    } else if (modalidade === 'taxa_diagnostico') {
      // Taxa Única de Diagnóstico Técnico da OS
      precoVendaUnit = Number(data.preco_venda_unitario) || 300.0;
      const impostoUnit = precoVendaUnit * (imposto / 100);
      const lucroUnit = precoVendaUnit - impostoUnit;
      valorImpostoTotal = impostoUnit * quantidade;
      lucroLiquidoTotal = lucroUnit * quantidade;

      // Se já existir uma taxa de diagnóstico nesta OS, atualiza a existente em vez de duplicar
      const diagExistente = db.prepare("SELECT id FROM os_itens_financeiros WHERE os_id = ? AND modalidade_cobranca = 'taxa_diagnostico'").get(osId);
      if (diagExistente) {
        const updateStmt = db.prepare(`
          UPDATE os_itens_financeiros
          SET descricao = ?, preco_venda_unitario = ?, preco_venda_total = ?, imposto_percentual = ?, valor_imposto_total = ?, lucro_liquido_total = ?
          WHERE id = ?
        `);
        const totalVenda = precoVendaUnit * quantidade;
        updateStmt.run(
          descricao || 'Diagnóstico Técnico Avançado de Bancada',
          Math.round(precoVendaUnit * 100) / 100,
          Math.round(totalVenda * 100) / 100,
          imposto,
          Math.round(valorImpostoTotal * 100) / 100,
          Math.round(lucroLiquidoTotal * 100) / 100,
          diagExistente.id
        );
        return db.prepare("SELECT * FROM os_itens_financeiros WHERE id = ?").get(diagExistente.id);
      }
    } else {
      // 'padrao' - Mão de obra avulsa / pesada
      precoVendaUnit = Number(data.preco_venda_unitario) || 0.0;
      const impostoUnit = precoVendaUnit * (imposto / 100);
      const lucroUnit = precoVendaUnit - impostoUnit;
      valorImpostoTotal = impostoUnit * quantidade;
      lucroLiquidoTotal = lucroUnit * quantidade;
    }
  }

  const precoVendaTotal = precoVendaUnit * quantidade;

  const stmt = db.prepare(`
    INSERT INTO os_itens_financeiros (
      id, os_id, tipo, origem, modalidade_cobranca, descricao, quantidade, 
      custo_compra_unitario, margem_percentual, imposto_percentual, 
      valor_imposto_total, lucro_liquido_total, preco_venda_unitario, preco_venda_total
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id, osId, tipo, origem, modalidade, descricao, quantidade,
    custoUnit, margem, imposto,
    Math.round(valorImpostoTotal * 100) / 100,
    Math.round(lucroLiquidoTotal * 100) / 100,
    Math.round(precoVendaUnit * 100) / 100,
    Math.round(precoVendaTotal * 100) / 100
  );

  return db.prepare("SELECT * FROM os_itens_financeiros WHERE id = ?").get(id);
}

function deleteItemFinanceiro(id) {
  return db.prepare("DELETE FROM os_itens_financeiros WHERE id = ?").run(id);
}

// Pendências (Defeitos Não Mexidos)
function addPendencia(osId, veiculoId, data) {
  const id = crypto.randomUUID();
  const dias = Number(data.dias_para_retorno) || 45;
  
  // Calcula data futura de retorno
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dias);
  const dataPrevista = targetDate.toISOString().split('T')[0];

  const stmt = db.prepare(`
    INSERT INTO os_pendencias (id, os_id, veiculo_id, descricao_defeito, urgencia, dias_para_retorno, data_prevista_retorno)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, osId, veiculoId, data.descricao_defeito, data.urgencia || 'media', dias, dataPrevista);
  return db.prepare("SELECT * FROM os_pendencias WHERE id = ?").get(id);
}

function toggleResolverPendencia(id, resolvido) {
  const stmt = db.prepare("UPDATE os_pendencias SET resolvido = ? WHERE id = ?");
  stmt.run(resolvido ? 1 : 0, id);
  return db.prepare("SELECT * FROM os_pendencias WHERE id = ?").get(id);
}

// Dashboard Completo & Estatísticas
function getDashboardStats() {
  const config = getConfig();

  const patioCounts = db.prepare(`
    SELECT status_patio, COUNT(*) as qtd
    FROM ordens_servico
    WHERE status_patio NOT IN ('entregue', 'cancelado')
    GROUP BY status_patio
  `).all();

  const statusMap = {
    agendado: 0,
    diagnostico: 0,
    aguardando: 0,
    execucao: 0,
    pronto: 0
  };
  patioCounts.forEach(row => {
    if (statusMap[row.status_patio] !== undefined) {
      statusMap[row.status_patio] = row.qtd;
    }
  });

  const totalCarrosPatio = Object.values(statusMap).reduce((acc, c) => acc + c, 0);

  // Totais financeiros de OSs ativas e entregues no mês
  const financeiro = db.prepare(`
    SELECT 
      COALESCE(SUM(i.preco_venda_total), 0) as faturamento_bruto,
      COALESCE(SUM(i.custo_compra_unitario * i.quantidade), 0) as custo_pecas,
      COALESCE(SUM(i.valor_imposto_total), 0) as impostos_provisionados,
      COALESCE(SUM(i.lucro_liquido_total), 0) as lucro_liquido_real
    FROM os_itens_financeiros i
    JOIN ordens_servico os ON i.os_id = os.id
    WHERE os.status_patio != 'cancelado'
  `).get();

  // Radar de Retorno: pendências não resolvidas cujo prazo vence nos próximos 15 dias ou já venceu
  const radarRetorno = db.prepare(`
    SELECT p.*, v.placa, v.modelo_ano, v.cliente_nome, v.cliente_telefone, os.numero_os
    FROM os_pendencias p
    JOIN veiculos v ON p.veiculo_id = v.id
    JOIN ordens_servico os ON p.os_id = os.id
    WHERE p.resolvido = 0 AND p.data_prevista_retorno <= date('now', '+15 days')
    ORDER BY p.data_prevista_retorno ASC
    LIMIT 15
  `).all();

  return {
    config,
    patio: {
      total: totalCarrosPatio,
      ...statusMap
    },
    financeiro,
    radarRetorno
  };
}

// Portal Seguro do Cliente
function getPortalCliente(token) {
  const os = db.prepare(`
    SELECT 
      os.id, os.numero_os, os.km_entrada, os.status_patio, os.data_agendamento,
      os.queixa_cliente, os.token_publico, os.aprovado_cliente_em, os.created_at,
      v.placa, v.modelo_ano, v.cliente_nome,
      c.nome_oficina, c.telefone_whatsapp as oficina_whatsapp
    FROM ordens_servico os
    JOIN veiculos v ON os.veiculo_id = v.id
    CROSS JOIN configuracoes c
    WHERE os.token_publico = ? AND c.id = 'default'
  `).get(token);

  if (!os) return null;

  // Evidências autorizadas para o cliente
  os.evidencias = db.prepare(`
    SELECT id, categoria, momento, titulo_observacao, storage_path, created_at
    FROM os_evidencias 
    WHERE os_id = ? AND visivel_cliente = 1
    ORDER BY created_at ASC
  `).all(os.id);

  // Itens transparentes: O CLIENTE NÃO VÊ CUSTO, LUCRO OU MARGEM!
  os.itens = db.prepare(`
    SELECT id, tipo, origem, modalidade_cobranca, descricao, quantidade, preco_venda_unitario, preco_venda_total
    FROM os_itens_financeiros
    WHERE os_id = ?
    ORDER BY tipo DESC, created_at ASC
  `).all(os.id);

  // Pendências encontradas e alertadas
  os.pendencias = db.prepare(`
    SELECT id, descricao_defeito, urgencia, data_prevista_retorno
    FROM os_pendencias
    WHERE os_id = ?
  `).all(os.id);

  let totalGeral = 0;
  for (const item of os.itens) {
    totalGeral += item.preco_venda_total;
  }
  os.totalGeral = totalGeral;

  return os;
}

function aprovarOrcamentoCliente(token) {
  const os = db.prepare("SELECT id, status_patio FROM ordens_servico WHERE token_publico = ?").get(token);
  if (!os) return null;

  // Atualiza data de aprovação e avança o pátio para 'execucao'
  db.prepare(`
    UPDATE ordens_servico 
    SET aprovado_cliente_em = CURRENT_TIMESTAMP,
        status_patio = 'execucao'
    WHERE id = ?
  `).run(os.id);

  return getPortalCliente(token);
}

module.exports = {
  db,
  uploadsDir,
  getConfig,
  updateConfig,
  getVeiculoByPlaca,
  deleteVeiculo,
  createOrUpdateVeiculo,
  searchVeiculosEClientes,
  createOS,
  getOSById,
  updateOS,
  updateOSStatus,
  listPatio,
  listHistoricoVeiculo,
  addDTC,
  deleteDTC,
  addEvidencia,
  deleteEvidencia,
  addItemFinanceiro,
  deleteItemFinanceiro,
  addPendencia,
  toggleResolverPendencia,
  getDashboardStats,
  getPortalCliente,
  aprovarOrcamentoCliente
};
