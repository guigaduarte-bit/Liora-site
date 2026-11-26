import fs from 'node:fs';

const approvedContact = JSON.parse(fs.readFileSync(new URL('../content/contact.json', import.meta.url), 'utf8'));

const escapeHTML = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

// This validates the format only; fiscal registration must be confirmed separately.
// Alphanumeric CNPJs keep two numeric check digits after twelve alphanumeric positions.
export function normalizeBusinessIdentity(config) {
  const cnpj = config?.cnpj;
  const legalName = config?.legalName;
  const publicLocation = config?.publicLocation;
  if (cnpj == null && legalName == null) return null;
  if (typeof cnpj !== 'string' || (legalName != null && (typeof legalName !== 'string' || !legalName.trim()))) {
    throw new Error('Business identity requires a CNPJ and, when provided, a nonempty legalName.');
  }
  if (publicLocation != null && (typeof publicLocation !== 'string' || !/^[\p{L} .'-]+\/[A-Z]{2}$/u.test(publicLocation.trim()))) {
    throw new Error('Public business location must contain only a city and Brazilian state abbreviation.');
  }
  const value = cnpj.trim().toUpperCase();
  if (!/^(?:[A-Z0-9]{12}[0-9]{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2})$/.test(value)) {
    throw new Error('CNPJ must have twelve alphanumeric positions and two numeric check digits.');
  }
  const unformatted = value.replace(/[.\/-]/g, '');
  return {
    legalName: legalName == null ? null : legalName.trim(),
    cnpj: unformatted.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5'),
    publicLocation: publicLocation == null ? null : publicLocation.trim()
  };
}

export function renderBusinessIdentity(identity) {
  if (!identity) return '';
  return `<p class="business-identity">${identity.legalName ? `${escapeHTML(identity.legalName)}<br>` : ''}CNPJ ${escapeHTML(identity.cnpj)}${identity.publicLocation ? `<br>Localização comercial: ${escapeHTML(identity.publicLocation)}` : ''}</p>`;
}

export function applyBusinessIdentity(html, identity, contact = approvedContact) {
  html = html.replace('<!-- business:footer -->', renderBusinessIdentity(identity));
  if (!identity) return html;
  const name = identity.legalName ? escapeHTML(identity.legalName) : null;
  const cnpj = escapeHTML(identity.cnpj);
  if (!/^55\d{10,11}$/.test(contact?.whatsapp || '')) throw new Error('A valid approved business WhatsApp is required.');
  const contactLink = `<p><a href="https://wa.me/${contact.whatsapp}" target="_blank" rel="noopener noreferrer" aria-label="Atendimento pelo WhatsApp da Liora (abre em nova aba)">Atendimento pelo WhatsApp</a></p>`;
  const location = identity.publicLocation ? `<p>Localização comercial: ${escapeHTML(identity.publicLocation)}</p>` : '';
  const replaceSection = (key, content) => {
    html = html.replace(new RegExp(`<!-- business:${key}:start -->[\\s\\S]*?<!-- business:${key}:end -->`), content);
  };
  replaceSection('operator', name
    ? `<p>A loja virtual <strong>Liora Aromas de Luxo</strong> é operada por <strong>${name}</strong>, inscrita no CNPJ ${cnpj}.</p>\n              ${location}<p>Para dúvidas e solicitações sobre a compra, use o <a href="#contato">canal de atendimento</a>.</p>`
    : `<p>A loja virtual <strong>Liora Aromas de Luxo</strong> tem identificação comercial no CNPJ ${cnpj}.</p>\n              ${location}<p>Para dúvidas e solicitações sobre a compra, use o <a href="#contato">canal de atendimento</a>.</p>`);
  replaceSection('controller', name
    ? `<p><strong>${name}</strong>, inscrita no CNPJ ${cnpj} e responsável pela loja <strong>Liora Aromas de Luxo</strong>, é a controladora dos dados tratados na operação.</p>\n              ${location}<p>Solicitações sobre dados pessoais podem ser encaminhadas pelo <a href="#contato">canal de privacidade</a>.</p>`
    : `<p>A responsável pela operação da loja <strong>Liora Aromas de Luxo</strong>, identificada pelo CNPJ ${cnpj}, é a controladora dos dados tratados na operação.</p>\n              ${location}<p>Solicitações sobre dados pessoais podem ser encaminhadas pelo <a href="#contato">canal de privacidade</a>.</p>`);
  replaceSection('registration', `${renderBusinessIdentity(identity)}${contactLink}`);
  replaceSection('contact', contactLink);
  return html;
}
