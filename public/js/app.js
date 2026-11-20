// ============================================================================
// OFICINA PRO - Motor de Lógica Frontend & Utilitários
// ============================================================================

const API = {
  async get(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    return res.json();
  },
  async post(endpoint, data) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    return res.json();
  },
  async put(endpoint, data) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    return res.json();
  },
  async patch(endpoint, data) {
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    return res.json();
  },
  async delete(endpoint) {
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    return res.json();
  }
};

// Formatadores
const Utils = {
  formatCurrency(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  formatKm(km) {
    const num = Number(km) || 0;
    return `${num.toLocaleString('pt-BR')} KM`;
  },
  formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  },
  formatDateSimple(dateStr) {
    if (!dateStr) return '-';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR');
    } catch {
      return dateStr;
    }
  },
  formatPlaca(placa) {
    if (!placa) return '';
    const clean = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length === 7) {
      // Padrão antigo: ABC1234 -> ABC-1234. Mercosul: BRA2E19 -> BRA2E19
      if (/^[A-Z]{3}[0-9]{4}$/.test(clean)) {
        return `${clean.slice(0, 3)}-${clean.slice(3)}`;
      }
      return clean;
    }
    return clean;
  },

  // Cálculo Oficial do Markup Divisor com Imposto por Dentro
  // Preço = Custo / (1 - ((Margem + Imposto) / 100))
  calcularMarkupDivisor(custo, margemPerc, impostoPerc) {
    const c = Number(custo) || 0;
    const m = Number(margemPerc) || 0;
    const i = Number(impostoPerc) || 0;

    const divisor = 1 - ((m + i) / 100);
    let precoVenda = 0;
    if (divisor > 0.05) {
      precoVenda = c / divisor;
    } else {
      precoVenda = c * 1.5; // Proteção matemática
    }

    const valorImposto = precoVenda * (i / 100);
    const lucroLiquido = precoVenda - c - valorImposto;

    return {
      precoVendaUnitario: Math.round(precoVenda * 100) / 100,
      valorImposto: Math.round(valorImposto * 100) / 100,
      lucroLiquido: Math.round(lucroLiquido * 100) / 100
    };
  },

  // Compressão de Imagens no Navegador via HTML5 Canvas (~250KB - 300KB)
  async compressImage(file, maxWidth = 1280, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Gera base64 JPEG otimizado
          const base64 = canvas.toDataURL('image/jpeg', quality);
          resolve(base64);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // Gerador de Link WhatsApp para o Cliente
  generateWhatsAppLink(telefone, clienteNome, placa, token, nomeOficina) {
    if (!telefone) return '#';
    let cleanPhone = telefone.replace(/\D/g, '');
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = '55' + cleanPhone;
    }
    const origin = window.location.origin;
    const portalUrl = `${origin}/cliente/${token}`;
    const text = encodeURIComponent(
      `Olá, *${clienteNome}*! Tudo bem?\n\n` +
      `Aqui é da *${nomeOficina || 'Oficina Mecânica'}*. Segue o link com o laudo de vistoria, fotos técnicas e orçamento do seu veículo (*${placa}*):\n\n` +
      `👉 ${portalUrl}\n\n` +
      `Você pode conferir as fotos e aprovar diretamente pelo link acima!`
    );
    return `https://wa.me/${cleanPhone}?text=${text}`;
  }
};
