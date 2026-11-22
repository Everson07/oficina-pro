-- Migração aditiva: clientes independentes dos veículos.
-- Não remove nem altera os campos legados de veiculos.

begin;

create table if not exists public.clientes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    nome text not null,
    telefone text not null default '',
    telefone_normalizado text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_nome
    on public.clientes (lower(nome));

create unique index if not exists uq_clientes_telefone_normalizado
    on public.clientes (telefone_normalizado)
    where telefone_normalizado <> '';

alter table public.veiculos
    add column if not exists cliente_id uuid references public.clientes(id) on delete set null;

create index if not exists idx_veiculos_cliente_id
    on public.veiculos (cliente_id);

-- Cria um cliente por telefone normalizado a partir dos registros existentes.
-- O registro mais recente fornece o nome/telefone inicial do cliente.
insert into public.clientes (user_id, nome, telefone, telefone_normalizado)
select distinct on (regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g'))
    v.user_id,
    v.cliente_nome,
    coalesce(v.cliente_telefone, ''),
    regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g')
from public.veiculos v
where regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g') <> ''
order by
    regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g'),
    v.created_at desc,
    v.id
on conflict do nothing;

-- Liga cada veículo ao cliente correspondente sem tocar no histórico da OS.
update public.veiculos v
set cliente_id = c.id
from public.clientes c
where c.telefone_normalizado = regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g')
  and regexp_replace(coalesce(v.cliente_telefone, ''), '[^0-9]', '', 'g') <> ''
  and v.cliente_id is null;

commit;

-- Verificação pós-migração sugerida:
-- select c.nome, c.telefone, count(v.id) as total_veiculos
-- from public.clientes c
-- left join public.veiculos v on v.cliente_id = c.id
-- group by c.id, c.nome, c.telefone
-- order by total_veiculos desc, c.nome;
