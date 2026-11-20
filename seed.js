const repo = require('./db.js');

console.log('🌱 Populando dados de demonstração...');

// Veículo 1 - Diagnóstico (DTCs)
const os1 = repo.createOS({
  placa: 'BRA2E19',
  modelo_ano: 'VW Golf GTI 2.0 TSI 2018',
  km_entrada: 64200,
  cliente_nome: 'Marcos Vinicius',
  cliente_telefone: '11998765432',
  queixa_cliente: 'Luz de injeção acesa e perda súbita de potência em retomadas de aceleração.',
  notas_bancada: 'Pressão de baixa em 5.2 bar. Na linha de alta, queda momentânea para 35 bar em carga (alvo 150 bar).',
  status_patio: 'diagnostico'
});

repo.addDTC(os1.id, {
  codigo: 'P0087',
  descricao: 'Pressão da Linha de Combustível Muito Baixa (Banco 1)',
  status: 'ATIVO'
});
repo.addDTC(os1.id, {
  codigo: 'P0300',
  descricao: 'Falha de Ignição Aleatória/Múltipla Detectada',
  status: 'PASSADO'
});

repo.addItemFinanceiro(os1.id, {
  tipo: 'servico',
  origem: 'oficina',
  descricao: 'Diagnóstico Avançado com Osciloscópio & Teste de Pressão de Alta',
  quantidade: 1,
  preco_venda_unitario: 350.00
});

// Veículo 2 - Aguardando Peça / Aprovação (Com Markup Divisor e Pendência)
const os2 = repo.createOS({
  placa: 'ABC4567',
  modelo_ano: 'Honda Civic 2.0 LXR 2016',
  km_entrada: 92800,
  cliente_nome: 'Camila Santos',
  cliente_telefone: '11987654321',
  queixa_cliente: 'Ruído metálico ao esterçar tudo para a esquerda e vibração ao frear na descida.',
  notas_bancada: 'Discos dianteiros com empenamento de 0.08mm no relógio comparador. Coifa homocinética rasgada.',
  status_patio: 'aguardando'
});

// Par de discos de freio (Markup Divisor: Custo R$ 280,00, Margem 30%, Imposto 6% -> Divisor 0.64 -> R$ 437,50)
repo.addItemFinanceiro(os2.id, {
  tipo: 'peca',
  origem: 'oficina',
  descricao: 'Par de Discos de Freio Dianteiros Ventilados Fremax',
  quantidade: 1,
  custo_compra_unitario: 280.00,
  margem_percentual: 30,
  imposto_percentual: 6
});

// Jogo de pastilhas de cerâmica
repo.addItemFinanceiro(os2.id, {
  tipo: 'peca',
  origem: 'oficina',
  descricao: 'Jogo de Pastilhas de Freio Cerâmica Ferodo',
  quantidade: 1,
  custo_compra_unitario: 140.00,
  margem_percentual: 30,
  imposto_percentual: 6
});

// Mão de obra substituição freios
repo.addItemFinanceiro(os2.id, {
  tipo: 'servico',
  origem: 'oficina',
  descricao: 'Mão de Obra: Substituição Discos, Pastilhas e Sangria com Fluido DOT 5.1',
  quantidade: 1,
  preco_venda_unitario: 220.00
});

// Pendência não autorizada (Pós-Venda / Radar de Retorno)
repo.addPendencia(os2.id, os2.veiculo_id, {
  descricao_defeito: 'Coifa da junta homocinética lado esquerdo com trinca superficial inicial (sem perda de graxa ainda)',
  urgencia: 'media',
  dias_para_retorno: 45
});

// Veículo 3 - Em Execução
const os3 = repo.createOS({
  placa: 'KMT8821',
  modelo_ano: 'Toyota Corolla 2.0 Altis 2021',
  km_entrada: 48300,
  cliente_nome: 'Roberto Albuquerque',
  cliente_telefone: '11976543210',
  queixa_cliente: 'Revisão periódica de 50.000 KM.',
  notas_bancada: 'Troca de óleo de motor 0W-20 sintético, filtro de óleo, filtro de ar do motor e ar-condicionado.',
  status_patio: 'execucao'
});

repo.addItemFinanceiro(os3.id, {
  tipo: 'peca',
  origem: 'oficina',
  descricao: 'Óleo Motor 0W-20 100% Sintético Toyota Original (Litro)',
  quantidade: 4.2,
  custo_compra_unitario: 42.00,
  margem_percentual: 35,
  imposto_percentual: 6
});

repo.addItemFinanceiro(os3.id, {
  tipo: 'peca',
  origem: 'oficina',
  descricao: 'Filtro de Óleo Blindado Mann Filter',
  quantidade: 1,
  custo_compra_unitario: 32.00,
  margem_percentual: 35,
  imposto_percentual: 6
});

repo.addItemFinanceiro(os3.id, {
  tipo: 'servico',
  origem: 'oficina',
  descricao: 'Serviço de Revisão Preventiva Completa + Higienização de Cabine',
  quantidade: 1,
  preco_venda_unitario: 180.00
});

// Veículo 4 - Pronto para Retirada
const os4 = repo.createOS({
  placa: 'PXA9012',
  modelo_ano: 'Chevrolet Onix 1.0 Turbo 2022',
  km_entrada: 33100,
  cliente_nome: 'Ana Paula Ferreira',
  cliente_telefone: '11965432109',
  queixa_cliente: 'Troca de correia banhada a óleo conforme especificação preventiva.',
  notas_bancada: 'Correia trocada, pescador limpo sem resíduos, cárter vedado com silicone de alta temperatura.',
  status_patio: 'pronto'
});

repo.addItemFinanceiro(os4.id, {
  tipo: 'peca',
  origem: 'cliente',
  descricao: 'Kit Correia Dentada Banhada a Óleo GM (Fornecido pela Cliente)',
  quantidade: 1,
  custo_compra_unitario: 0,
  preco_venda_unitario: 0
});

repo.addItemFinanceiro(os4.id, {
  tipo: 'servico',
  origem: 'oficina',
  descricao: 'Mão de Obra Especializada: Troca Correia Banhada a Óleo + Limpeza de Pescador',
  quantidade: 1,
  preco_venda_unitario: 750.00
});

console.log('✅ Dados de demonstração semeados com sucesso!');
