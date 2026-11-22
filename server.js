const http = require('node:http');
const url = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
if (process.env.RENDER && !hasSupabaseConfig) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias no Render; SQLite temporário foi bloqueado.');
}
const repo = hasSupabaseConfig ? require('./db-supabase.js') : require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = repo.uploadsDir || path.join(__dirname, 'uploads');
const osRequestsInFlight = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Limite de segurança de 25MB para fotos em base64
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Tamanho máximo excedido'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Não Encontrado');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // ------------------------------------------------------------------------
    // ROTAS DE API
    // ------------------------------------------------------------------------

    if (pathname === '/api/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, storage: repo.isSupabase ? 'supabase' : 'sqlite-local' });
    }

    // Configurações
    if (pathname === '/api/config' && method === 'GET') {
      return sendJSON(res, 200, await repo.getConfig());
    }
    if (pathname === '/api/config' && method === 'POST') {
      const body = await parseBody(req);
      const updated = await repo.updateConfig(body);
      return sendJSON(res, 200, updated);
    }

    // Dashboard & Estatísticas
    if (pathname === '/api/dashboard' && method === 'GET') {
      return sendJSON(res, 200, await repo.getDashboardStats());
    }

    // Pátio / Kanban
    if (pathname === '/api/patio' && method === 'GET') {
      return sendJSON(res, 200, await repo.listPatio());
    }
    if (pathname === '/api/entregues' && method === 'GET') {
      return sendJSON(res, 200, await repo.listEntregues(parsedUrl.query.limit));
    }
    if (pathname === '/api/clientes' && method === 'GET') {
      return sendJSON(res, 200, await repo.listClientesAgrupados(parsedUrl.query.limit));
    }

    // Busca Global
    if (pathname === '/api/busca' && method === 'GET') {
      const q = parsedUrl.query.q || '';
      return sendJSON(res, 200, await repo.searchVeiculosEClientes(q));
    }

    // Busca de Veículo por Placa
    if (pathname.startsWith('/api/veiculo/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      const removed = await repo.deleteVeiculo(id);
      return sendJSON(res, 200, { success: true, removed: Boolean(removed) });
    }
    if (pathname.startsWith('/api/veiculo/') && method === 'GET') {
      const parts = pathname.split('/');
      const placaOuId = parts[3];
      if (parts[4] === 'historico') {
        return sendJSON(res, 200, await repo.listHistoricoVeiculo(placaOuId));
      }
      const veiculo = await repo.getVeiculoByPlaca(placaOuId);
      return sendJSON(res, 200, veiculo || { notFound: true });
    }

    // Ordens de Serviço
    if (pathname === '/api/os' && method === 'POST') {
      const body = await parseBody(req);
      const requestId = String(body.request_id || '').trim();
      let creation = requestId ? osRequestsInFlight.get(requestId) : null;
      if (!creation) {
        creation = repo.createOS(body);
        if (requestId) {
          osRequestsInFlight.set(requestId, creation);
          const clearRequest = () => setTimeout(() => osRequestsInFlight.delete(requestId), 15000);
          creation.then(clearRequest, clearRequest);
        }
      }
      const novaOS = await creation;
      return sendJSON(res, 201, novaOS);
    }

    if (pathname.startsWith('/api/os/')) {
      const parts = pathname.split('/');
      const osId = parts[3];
      const subAction = parts[4];

      // Atualizar status no Kanban
      if (subAction === 'status' && method === 'PATCH') {
        const body = await parseBody(req);
        const updated = await repo.updateOSStatus(osId, body.status);
        return sendJSON(res, 200, updated);
      }

      // Ajuste administrativo da numeração da OS
      if (subAction === 'numero' && method === 'PATCH') {
        const body = await parseBody(req);
        const updated = await repo.renumberOS(osId, body.numero_os);
        if (!updated) return sendJSON(res, 404, { error: 'OS não encontrada' });
        return sendJSON(res, 200, updated);
      }

      // DTCs
      if (subAction === 'dtc' && method === 'POST') {
        const body = await parseBody(req);
        const dtc = await repo.addDTC(osId, body);
        return sendJSON(res, 201, dtc);
      }

      // Evidências Fotográficas
      if (subAction === 'evidencia' && method === 'POST') {
        const body = await parseBody(req);
        let storagePath = '';

        if (body.base64Image && repo.isSupabase) {
          storagePath = await repo.uploadEvidence(body.base64Image);
        } else if (body.base64Image) {
          // Salva imagem a partir de base64 vindo da câmera / arquivo comprimido
          const matches = body.base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const ext = matches[1].includes('png') ? '.png' : matches[1].includes('webp') ? '.webp' : '.jpg';
            const filename = `evidencia_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
            const targetPath = path.join(UPLOADS_DIR, filename);
            const buffer = Buffer.from(matches[2], 'base64');
            fs.writeFileSync(targetPath, buffer);
            storagePath = `/uploads/${filename}`;
          }
        }

        const ev = await repo.addEvidencia(osId, body.veiculo_id, {
          categoria: body.categoria,
          momento: body.momento,
          titulo_observacao: body.titulo_observacao,
          storage_path: storagePath,
          visivel_cliente: body.visivel_cliente !== false
        });
        return sendJSON(res, 201, ev);
      }

      // Itens Financeiros com Markup Divisor
      if (subAction === 'item' && method === 'POST') {
        const body = await parseBody(req);
        const item = await repo.addItemFinanceiro(osId, body);
        return sendJSON(res, 201, item);
      }

      // Pendências
      if (subAction === 'pendencia' && method === 'POST') {
        const body = await parseBody(req);
        const pend = await repo.addPendencia(osId, body.veiculo_id, body);
        return sendJSON(res, 201, pend);
      }

      // Obter OS Completa
      if (!subAction && method === 'GET') {
        const os = await repo.getOSById(osId);
        if (!os) return sendJSON(res, 404, { error: 'OS não encontrada' });
        return sendJSON(res, 200, os);
      }

      // Atualizar dados gerais da OS
      if (!subAction && method === 'PUT') {
        const body = await parseBody(req);
        const updated = await repo.updateOS(osId, body);
        return sendJSON(res, 200, updated);
      }
    }

    // Deletar DTC
    if (pathname.startsWith('/api/dtc/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      await repo.deleteDTC(id);
      return sendJSON(res, 200, { success: true });
    }

    // Deletar Evidência
    if (pathname.startsWith('/api/evidencia/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      await repo.deleteEvidencia(id);
      return sendJSON(res, 200, { success: true });
    }

    // Deletar Item Financeiro
    if (pathname.startsWith('/api/item/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      await repo.deleteItemFinanceiro(id);
      return sendJSON(res, 200, { success: true });
    }

    // Resolver / Reabrir Pendência
    if (pathname.startsWith('/api/pendencia/') && method === 'PATCH') {
      const id = pathname.split('/')[3];
      const body = await parseBody(req);
      const resPend = await repo.toggleResolverPendencia(id, body.resolvido);
      return sendJSON(res, 200, resPend);
    }

    // Portal Seguro do Cliente via Token
    if (pathname.startsWith('/api/portal/')) {
      const token = pathname.split('/')[3];
      if (method === 'GET') {
        const portalData = await repo.getPortalCliente(token);
        if (!portalData) return sendJSON(res, 404, { error: 'Prontuário não encontrado' });
        return sendJSON(res, 200, portalData);
      }
      if (method === 'POST') {
        const portalData = await repo.aprovarOrcamentoCliente(token);
        if (!portalData) return sendJSON(res, 404, { error: 'Erro ao aprovar' });
        return sendJSON(res, 200, portalData);
      }
    }

    // ------------------------------------------------------------------------
    // ARQUIVOS ESTÁTICOS & ROTAS DE PÁGINAS
    // ------------------------------------------------------------------------

    // Servir uploads de imagens
    if (pathname.startsWith('/uploads/')) {
      const filename = path.basename(pathname);
      const filePath = path.join(UPLOADS_DIR, filename);
      return serveStatic(res, filePath);
    }

    // Página do Portal do Cliente
    if (pathname.startsWith('/cliente/')) {
      return serveStatic(res, path.join(PUBLIC_DIR, 'cliente.html'));
    }

    // Página do Laudo Oficial A4 / PDF do Cliente
    if (pathname.startsWith('/laudo/') || pathname.endsWith('/pdf')) {
      return serveStatic(res, path.join(PUBLIC_DIR, 'laudo.html'));
    }

    // Página da Ficha da OS
    if (pathname.startsWith('/os/')) {
      return serveStatic(res, path.join(PUBLIC_DIR, 'os.html'));
    }

    // Home / Dashboard
    if (pathname === '/' || pathname === '/index.html') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // Qualquer outro arquivo em public/ (CSS, JS, imagens)
    const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (safePath.startsWith(PUBLIC_DIR)) {
      return serveStatic(res, safePath);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');

  } catch (err) {
    console.error('Erro na requisição:', err);
    sendJSON(res, 500, { error: 'Erro interno do servidor', details: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚗 OFICINA PRO - Sistema de Gestão Técnica & Pátio`);
  console.log(`📡 Servidor Rodando em: http://localhost:${PORT}`);
  console.log(`🗄️  Banco SQLite Ativo: oficina.db`);
  console.log(`⚡ Zero Dependências Externas - 100% Funcional`);
  console.log(`====================================================`);
});
