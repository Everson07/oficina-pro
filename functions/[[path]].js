async function repository(context) {
  globalThis.__OFICINA_ENV = context.env;
  return import('../db-supabase.js');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    }
  });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'Content-Type' } });

  if (!path.startsWith('/api/')) {
    if (path === '/os' || path === '/os/' || path === '/ficha' || path === '/ficha/') return Response.redirect(new URL('/', request.url), 302);
    if (path.startsWith('/os/') || path.startsWith('/ficha/')) return context.env.ASSETS.fetch(new Request(new URL('/os-ficha-v3', request.url), request));
    if (path.startsWith('/cliente/')) return context.env.ASSETS.fetch(new Request(new URL('/cliente.html', request.url), request));
    if (path === '/laudo' || path === '/laudo/' || path === '/pdf') return Response.redirect(new URL('/', request.url), 302);
    if (path.startsWith('/laudo/') || path.endsWith('/pdf')) return context.env.ASSETS.fetch(new Request(new URL('/laudo-v3', request.url), request));
    return context.next();
  }

  const repo = await repository(context);
  try {
    if (path === '/api/health' && method === 'GET') return json({ ok: true, storage: 'supabase', host: 'cloudflare' });
    if (path === '/api/config' && method === 'GET') return json(await repo.getConfig());
    if (path === '/api/config' && method === 'POST') return json(await repo.updateConfig(await body(request)));
    if (path === '/api/dashboard' && method === 'GET') return json(await repo.getDashboardStats());
    if (path === '/api/patio' && method === 'GET') return json(await repo.listPatio());
    if (path === '/api/entregues' && method === 'GET') return json(await repo.listEntregues(url.searchParams.get('limit')));
    if (path === '/api/busca' && method === 'GET') return json(await repo.searchVeiculosEClientes(url.searchParams.get('q') || ''));

    if (path.startsWith('/api/veiculo/')) {
      const id = path.split('/')[3];
      if (method === 'DELETE') return json({ success: true, removed: Boolean(await repo.deleteVeiculo(id)) });
      if (path.endsWith('/historico')) return json(await repo.listHistoricoVeiculo(id));
      const vehicle = await repo.getVeiculoByPlaca(id);
      return json(vehicle || { notFound: true });
    }

    if (path === '/api/os' && method === 'POST') return json(await repo.createOS(await body(request)), 201);
    if (path.startsWith('/api/os/')) {
      const parts = path.split('/');
      const id = parts[3];
      const action = parts[4];
      if (!action && method === 'GET') {
        const os = await repo.getOSById(id);
        return os ? json(os) : json({ error: 'OS não encontrada' }, 404);
      }
      if (!action && method === 'PUT') return json(await repo.updateOS(id, await body(request)));
      if (action === 'numero' && method === 'PATCH') return json(await repo.renumberOS(id, (await body(request)).numero_os));
      if (action === 'status' && method === 'PATCH') return json(await repo.updateOSStatus(id, (await body(request)).status));
      if (action === 'dtc' && method === 'POST') return json(await repo.addDTC(id, await body(request)), 201);
      if (action === 'evidencia' && method === 'POST') {
        const data = await body(request);
        const storagePath = data.base64Image ? await repo.uploadEvidence(data.base64Image) : '';
        return json(await repo.addEvidencia(id, data.veiculo_id, { ...data, storage_path: storagePath }), 201);
      }
      if (action === 'item' && method === 'POST') return json(await repo.addItemFinanceiro(id, await body(request)), 201);
      if (action === 'pendencia' && method === 'POST') { const data = await body(request); return json(await repo.addPendencia(id, data.veiculo_id, data), 201); }
    }

    if (path.startsWith('/api/dtc/') && method === 'DELETE') return json({ success: true, ...(await repo.deleteDTC(path.split('/')[3])) });
    if (path.startsWith('/api/evidencia/') && method === 'DELETE') return json({ success: true, ...(await repo.deleteEvidencia(path.split('/')[3])) });
    if (path.startsWith('/api/item/') && method === 'DELETE') return json({ success: true, ...(await repo.deleteItemFinanceiro(path.split('/')[3])) });
    if (path.startsWith('/api/pendencia/') && method === 'PATCH') return json(await repo.toggleResolverPendencia(path.split('/')[3], (await body(request)).resolvido));
    if (path.startsWith('/api/portal/')) {
      const token = path.split('/')[3];
      const result = method === 'POST' ? await repo.aprovarOrcamentoCliente(token) : await repo.getPortalCliente(token);
      return result ? json(result) : json({ error: 'Prontuário não encontrado' }, 404);
    }
    return json({ error: 'Rota não encontrada' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Erro interno do servidor', details: error.message }, 500);
  }
}
