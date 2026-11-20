-- ============================================================================
-- SCHEMA SUPABASE / POSTGRESQL - OFICINA PRO
-- Sistema de Gestão Técnica & Pátio para Oficina Mecânica
-- ============================================================================

-- Habilita extensão para UUIDs
create extension if not exists "uuid-ossp";

-- 1. TABELA DE CONFIGURAÇÕES
create table if not exists public.configuracoes (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete cascade unique,
    nome_oficina text not null default 'Oficina Mecânica Especializada',
    telefone_whatsapp text default '',
    aliquota_imposto_peca numeric(5,2) default 6.0,
    aliquota_imposto_servico numeric(5,2) default 5.0,
    margem_lucro_padrao numeric(5,2) default 30.0,
    updated_at timestamptz default now()
);

-- 2. TABELA DE VEÍCULOS & CLIENTES (PRONTUÁRIO ÚNICO)
create table if not exists public.veiculos (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete cascade,
    placa text not null unique,
    modelo_ano text not null,
    chassi text,
    cliente_nome text not null,
    cliente_telefone text not null,
    created_at timestamptz default now()
);
create index if not exists idx_veiculos_placa on public.veiculos(placa);

-- 3. STATUS DO PÁTIO & ORDENS DE SERVIÇO
create type status_patio_enum as enum (
    'agendado', 
    'diagnostico', 
    'aguardando', 
    'execucao', 
    'pronto', 
    'entregue', 
    'cancelado'
);

create table if not exists public.ordens_servico (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete cascade,
    numero_os serial unique,
    veiculo_id uuid references public.veiculos(id) on delete cascade not null,
    km_entrada integer not null,
    status_patio status_patio_enum default 'diagnostico',
    forma_pagamento text,
    data_agendamento timestamptz,
    queixa_cliente text,
    notas_bancada text,
    token_publico text unique default encode(gen_random_bytes(16), 'hex'),
    aprovado_cliente_em timestamptz,
    entregue_em timestamptz,
    created_at timestamptz default now()
);
create index if not exists idx_os_token on public.ordens_servico(token_publico);
create index if not exists idx_os_status on public.ordens_servico(status_patio);

-- 4. CÓDIGOS DE FALHA (DTC)
create table if not exists public.os_dtcs (
    id uuid primary key default uuid_generate_v4(),
    os_id uuid references public.ordens_servico(id) on delete cascade not null,
    codigo text not null,
    descricao text,
    status text not null default 'ATIVO', -- ATIVO | PASSADO
    created_at timestamptz default now()
);

-- 5. EVIDÊNCIAS VISUAIS / VISTORIA / OSCILOSCÓPIO
create table if not exists public.os_evidencias (
    id uuid primary key default uuid_generate_v4(),
    os_id uuid references public.ordens_servico(id) on delete cascade not null,
    veiculo_id uuid references public.veiculos(id) on delete cascade not null,
    categoria text not null check (categoria in ('vistoria_entrada', 'osciloscopio', 'scanner', 'inspecao')),
    momento text not null default 'recepcao' check (momento in ('recepcao', 'antes', 'depois')),
    titulo_observacao text,
    storage_path text not null,
    visivel_cliente boolean default true,
    created_at timestamptz default now()
);

-- 6. ITENS FINANCEIROS & MARKUP DIVISOR
create table if not exists public.os_itens_financeiros (
    id uuid primary key default uuid_generate_v4(),
    os_id uuid references public.ordens_servico(id) on delete cascade not null,
    tipo text not null check (tipo in ('peca', 'servico')),
    origem text not null default 'oficina' check (origem in ('oficina', 'cliente')),
    descricao text not null,
    quantidade numeric(10,2) not null default 1.0,
    custo_compra_unitario numeric(10,2) not null default 0.0,
    margem_percentual numeric(5,2) not null default 0.0,
    imposto_percentual numeric(5,2) not null default 0.0,
    valor_imposto_total numeric(10,2) not null default 0.0,
    lucro_liquido_total numeric(10,2) not null default 0.0,
    preco_venda_unitario numeric(10,2) not null default 0.0,
    preco_venda_total numeric(10,2) not null default 0.0,
    created_at timestamptz default now()
);

-- 7. PENDÊNCIAS NÃO EXECUTADAS & RADAR DE RETORNO
create table if not exists public.os_pendencias (
    id uuid primary key default uuid_generate_v4(),
    os_id uuid references public.ordens_servico(id) on delete cascade not null,
    veiculo_id uuid references public.veiculos(id) on delete cascade not null,
    descricao_defeito text not null,
    urgencia text not null default 'media' check (urgencia in ('baixa', 'media', 'alta', 'critica')),
    dias_para_retorno integer not null default 45,
    data_prevista_retorno date not null,
    resolvido boolean not null default false,
    created_at timestamptz default now()
);

-- 8. VIEW SEGURA PARA O PORTAL DO CLIENTE (NÃO EXPOSTA A CUSTO/LUCRO)
create or replace view public.vw_portal_cliente as
select 
    os.id,
    os.numero_os,
    os.km_entrada,
    os.status_patio,
    os.queixa_cliente,
    os.token_publico,
    os.aprovado_cliente_em,
    os.created_at,
    v.placa,
    v.modelo_ano,
    v.cliente_nome,
    c.nome_oficina,
    c.telefone_whatsapp as oficina_whatsapp
from public.ordens_servico os
join public.veiculos v on os.veiculo_id = v.id
cross join public.configuracoes c;
