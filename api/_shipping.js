'use strict';

const SHIP_FREE = 150;
const CURITIBA_SHIPPING_COST = 19.9;
const SUPERFRETE_ENDPOINT = '/api/v0/calculator';
const DEFAULT_SERVICES = '1,2,17,3,33,31';

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanZip(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function isCuritibaZip(zipCode) {
  const numericZip = Number(cleanZip(zipCode));
  return numericZip >= 80000000 && numericZip <= 82999999;
}

function packageFor(cart) {
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  return {
    width: 20,
    height: Math.min(60, 12 + quantity * 3),
    length: 20,
    weight: roundCurrency(Math.max(0.3, quantity * 0.35))
  };
}

function previewQuotes(zipCode) {
  const prefix = Number(zipCode.slice(0, 2));
  const nearby = prefix >= 80 && prefix <= 87;
  return [
    { id: 'preview-pac', carrier: 'Correios', name: 'PAC', price: nearby ? 18.9 : 27.9, deliveryDays: nearby ? 4 : 8, preview: true },
    { id: 'preview-jadlog', carrier: 'Jadlog', name: 'Package', price: nearby ? 21.9 : 29.9, deliveryDays: nearby ? 3 : 6, preview: true },
    { id: 'preview-jt', carrier: 'J&T Express', name: 'Envio econômico', price: nearby ? 19.9 : 28.9, deliveryDays: nearby ? 4 : 7, preview: true }
  ];
}

function parseNumber(value) {
  if (typeof value === 'string') value = value.replace(',', '.');
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeQuotes(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((quote) => quote && !quote.error)
    .map((quote) => {
      const price = parseNumber(quote.custom_price ?? quote.price);
      const deliveryDays = parseNumber(
        quote.custom_delivery_time
        ?? quote.delivery_time
        ?? (quote.delivery_range && quote.delivery_range.max)
      );
      return {
        id: String(quote.id || quote.service || ''),
        carrier: String(
          quote.company && quote.company.name
          || quote.carrier && quote.carrier.name
          || quote.carrier
          || 'Transportadora'
        ).slice(0, 60),
        name: String(quote.name || quote.service_name || 'Entrega').slice(0, 80),
        price: price === null ? null : roundCurrency(price),
        deliveryDays: deliveryDays === null ? null : Math.max(0, Math.round(deliveryDays)),
        preview: false
      };
    })
    .filter((quote) => quote.id && quote.price !== null && quote.price >= 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
}

async function superFreteQuotes({ destination, cart, subtotal }) {
  const origin = cleanZip(process.env.SHIP_ORIGIN_CEP);
  const token = String(process.env.SUPERFRETE_TOKEN || '').trim();
  if (!origin || !token) return { preview: true, quotes: previewQuotes(destination) };

  const baseUrl = process.env.SUPERFRETE_BASE_URL || 'https://api.superfrete.com';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${SUPERFRETE_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': process.env.SUPERFRETE_USER_AGENT || 'Liora Aromas/1.0 (contato@lioraaromasdeluxo.com.br)'
    },
    body: JSON.stringify({
      from: { postal_code: origin },
      to: { postal_code: destination },
      services: process.env.SUPERFRETE_SERVICES || DEFAULT_SERVICES,
      options: {
        own_hand: false,
        receipt: false,
        insurance_value: subtotal,
        use_insurance_value: subtotal > 0
      },
      package: packageFor(cart)
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = data && typeof data === 'object'
      ? String(data.error_description || data.message || data.error || '').slice(0, 240)
      : '';
    console.error('SuperFrete recusou a cotação', {
      status: response.status,
      message: providerMessage || 'sem mensagem'
    });
    throw new Error(`Não foi possível consultar a SuperFrete (HTTP ${response.status})`);
  }
  const quotes = normalizeQuotes(data);
  if (!quotes.length) throw new Error('Nenhuma opção de entrega disponível para este CEP');
  return { preview: false, quotes };
}

async function quoteShipping({ zipCode, cart, subtotal }) {
  const destination = cleanZip(zipCode);
  if (destination.length !== 8) throw new Error('CEP inválido');

  const localQuotes = isCuritibaZip(destination) ? [{
    id: 'curitiba-fixed',
    carrier: 'Liora',
    name: 'Entrega em Curitiba',
    price: CURITIBA_SHIPPING_COST,
    deliveryDays: null,
    preview: false
  }] : [];
  const superFrete = await superFreteQuotes({ destination, cart, subtotal });
  const freeShipping = subtotal >= SHIP_FREE;
  const quotes = [...localQuotes, ...superFrete.quotes]
    .filter((quote, index, all) => all.findIndex((item) => item.id === quote.id) === index)
    .map((quote) => ({
      ...quote,
      originalPrice: quote.price,
      price: freeShipping ? 0 : quote.price
    }));

  return {
    preview: quotes.some((quote) => quote.preview),
    freeShipping,
    provider: 'superfrete',
    quotes
  };
}

module.exports = {
  SHIP_FREE,
  CURITIBA_SHIPPING_COST,
  cleanZip,
  isCuritibaZip,
  normalizeQuotes,
  quoteShipping,
  roundCurrency
};

