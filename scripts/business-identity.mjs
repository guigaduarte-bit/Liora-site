const escapeHTML = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

// This validates the format only; fiscal registration must be confirmed separately.
// Alphanumeric CNPJs keep two numeric check digits after twelve alphanumeric positions.
export function normalizeBusinessIdentity(config) {
  const cnpj = config?.cnpj;
  const legalName = config?.legalName;
  if (cnpj == null && legalName == null) return null;
  if (typeof cnpj !== 'string' || (legalName != null && (typeof legalName !== 'string' || !legalName.trim()))) {
    throw new Error('Business identity requires a CNPJ and, when provided, a nonempty legalName.');
  }
  const value = cnpj.trim().toUpperCase();
  if (!/^(?:[A-Z0-9]{12}[0-9]{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2})$/.test(value)) {
    throw new Error('CNPJ must have twelve alphanumeric positions and two numeric check digits.');
  }
  const unformatted = value.replace(/[.\/-]/g, '');
  return {
    legalName: legalName == null ? null : legalName.trim(),
    cnpj: unformatted.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5')
  };
}

export function renderBusinessIdentity(identity) {
  if (!identity) return '';
  return `<p class="business-identity">${identity.legalName ? `${escapeHTML(identity.legalName)}<br>` : ''}CNPJ ${escapeHTML(identity.cnpj)}</p>`;
}

export function applyBusinessIdentity(html, identity) {
  html = html.replace('<!-- business:footer -->', renderBusinessIdentity(identity));
  if (!identity) return html;
  const name = identity.legalName ? escapeHTML(identity.legalName) : null;
  const cnpj = escapeHTML(identity.cnpj);
  const replaceSection = (key, content) => {
    html = html.replace(new RegExp(`<!-- business:${key}:start -->[\\s\\S]*?<!-- business:${key}:end -->`), content);
  };
  replaceSection('operator', name
    ? `<p>A loja virtual <strong>Liora Aromas de Luxo</strong> é operada por <strong>${name}</strong>, inscrita no CNPJ ${cnpj}.</p>\n              <p>O endereço e os canais oficiais de atendimento serão incluídos na versão aprovada para produção.</p>`
    : `<p>A loja virtual <strong>Liora Aromas de Luxo</strong> tem identificação comercial no CNPJ ${cnpj}.</p>\n              <p>A razão social, o endereço e os canais oficiais de atendimento serão completados antes da publicação em produção.</p>`);
  replaceSection('controller', name
    ? `<p><strong>${name}</strong>, inscrita no CNPJ ${cnpj} e responsável pela loja <strong>Liora Aromas de Luxo</strong>, é a controladora dos dados tratados na operação.</p>\n              <p>O endereço e um canal válido para o exercício dos direitos previstos na LGPD serão incluídos na versão aprovada para produção.</p>`
    : `<p>A responsável pela operação da loja <strong>Liora Aromas de Luxo</strong>, identificada pelo CNPJ ${cnpj}, é a controladora dos dados tratados na operação.</p>\n              <p>A razão social, o endereço e um canal válido para o exercício dos direitos previstos na LGPD serão completados antes da publicação em produção.</p>`);
  replaceSection('preview', '<p>Os dados pessoais de contato e o endereço permanecem omitidos neste preview público. Os canais oficiais serão incluídos na versão aprovada para produção.</p>');
  return html;
}
