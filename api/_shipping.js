'use strict';

const { buildShippingProducts } = require('./_shipping-products');
const { estimateCartPackaging, isShippingEstimatePreview } = require('./_shipping-estimate');

const SHIP_FREE = 150;
const CURITIBA_SHIPPING_COST = 19.9;
const SUPERFRETE_ENDPOINT = '/api/v0/calculator';
const DEFAULT_SERVICES = '1,2,17,3,33,31';

class ShippingQuoteError extends Error {
  constructor(code, message, { status = 502, sandbox = false } = {}) {
    super(message);
    this.name = 'ShippingQuoteError';
    this.code = code;
    this.status = status;
    this.sandbox = sandbox;
  }
}

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

function providerErrors(data) {
  const messages = [];
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) messages.push(value.trim().slice(0, 180));
    if (value && typeof value === 'object') {
      add(value.message);
      add(value.error);
      add(value.description);
      add(value.error_description);
    }
  };
  if (Array.isArray(data)) {
    data.forEach((item) => item && add(item.error));
  } else if (data && typeof data === 'object') {
    add(data.message);
    add(data.error);
    add(data.error_description);
    if (Array.isArray(data.errors)) data.errors.forEach(add);
  }
  return [...new Set(messages)].slice(0, 8);
}

async function requestSuperFrete({ baseUrl, token, destination, products, package: parcel, subtotal, services }) {
  const origin = cleanZip(process.env.SHIP_ORIGIN_CEP);
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
      services,
      options: {
        own_hand: false,
        receipt: false,
        insurance_value: subtotal,
        use_insurance_value: subtotal > 0
      },
      ...(parcel ? { package: parcel } : { products })
    })
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, services };
}

async function superFreteQuotes({ destination, cart, subtotal, estimatedParcel }) {
  const origin = cleanZip(process.env.SHIP_ORIGIN_CEP);
  const token = String(process.env.SUPERFRETE_TOKEN || '').trim();
  if (!origin || !token) {
    if (estimatedParcel) return {
      preview: true, quotes: [], code: 'SHIPPING_CONFIGURATION_REQUIRED',
      notice: 'Embalagem estimada. A cotação por CEP depende da configuração da transportadora no preview.'
    };
    return { preview: true, quotes: previewQuotes(destination) };
  }

  const products = estimatedParcel ? undefined : buildShippingProducts(cart);
  const parcel = estimatedParcel ? {
    ...estimatedParcel.dimensionsCm,
    weight: estimatedParcel.totalWeightGrams / 1000
  } : undefined;
  const baseUrl = process.env.SUPERFRETE_BASE_URL || 'https://api.superfrete.com';
  const sandbox = /sandbox\.superfrete\.com/i.test(baseUrl);
  const requestedServices = process.env.SUPERFRETE_SERVICES || DEFAULT_SERVICES;
  const attempts = [];

  attempts.push(await requestSuperFrete({
    baseUrl,
    token,
    destination,
    products,
    package: parcel,
    subtotal,
    services: requestedServices
  }));

  let quotes = attempts[0].ok ? normalizeQuotes(attempts[0].data) : [];
  if (!quotes.length && requestedServices !== '1,2') {
    attempts.push(await requestSuperFrete({
      baseUrl,
      token,
      destination,
      products,
      package: parcel,
      subtotal,
      services: '1,2'
    }));
    quotes = attempts[1].ok ? normalizeQuotes(attempts[1].data) : [];
  }

  if (quotes.length) return {
    preview: Boolean(estimatedParcel),
    quotes: estimatedParcel ? quotes.map((quote) => ({ ...quote, preview: true, estimated: true })) : quotes
  };

  const diagnostics = attempts.map((attempt) => ({
    status: attempt.status,
    services: attempt.services,
    messages: providerErrors(attempt.data)
  }));
  const hadAcceptedRequest = attempts.some((attempt) => attempt.ok);

  if (hadAcceptedRequest) {
    console.warn('SuperFrete não retornou modalidades', { sandbox, attempts: diagnostics });
    throw new ShippingQuoteError(
      'NO_SHIPPING_OPTIONS',
      sandbox
        ? 'CEP localizado, mas a SuperFrete Sandbox não retornou uma modalidade para esta rota.'
        : 'CEP localizado, mas a SuperFrete não retornou uma modalidade para esta rota no momento.',
      { status: 422, sandbox }
    );
  }

  console.error('SuperFrete recusou a cotação', { sandbox, attempts: diagnostics });
  throw new ShippingQuoteError(
    'SHIPPING_PROVIDER_UNAVAILABLE',
    sandbox
      ? 'A SuperFrete Sandbox não conseguiu calcular esta rota agora.'
      : 'A SuperFrete não conseguiu calcular esta rota agora.',
    { status: 503, sandbox }
  );
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
  // Estimates are enabled only by the deployment environment, never by a client
  // flag. Production retains the validated shipping-product path.
  const packaging = isShippingEstimatePreview() ? estimateCartPackaging(cart) : null;
  let superFrete;
  try {
    if (packaging && packaging.status !== 'estimated') {
      superFrete = {
        preview: true, quotes: [], code: 'SHIPPING_PACKAGING_PENDING',
        notice: packaging.status === 'incomplete'
          ? 'Faltam dados de um ou mais produtos para estimar a embalagem completa.'
          : 'Este pedido precisa de uma embalagem diferente das caixas disponíveis na simulação.'
      };
    } else if (packaging && packaging.parcels.length !== 1) {
      superFrete = {
        preview: true, quotes: [], code: 'SHIPPING_MULTIPLE_PACKAGES',
        notice: 'O pedido foi dividido em volumes. A cotação conjunta desses volumes ainda precisa ser homologada.'
      };
    } else {
      superFrete = await superFreteQuotes({
        destination, cart, subtotal,
        ...(packaging ? { estimatedParcel: packaging.parcels[0] } : {})
      });
    }
  } catch (error) {
    if (!localQuotes.length && !packaging) throw error;
    console.warn('Cotação externa indisponível', { code: error.code || 'UNKNOWN' });
    superFrete = {
      preview: Boolean(packaging), quotes: [],
      ...(packaging ? {
        code: error.code || 'SHIPPING_PROVIDER_UNAVAILABLE',
        notice: 'A embalagem foi estimada, mas a transportadora não retornou uma cotação para este CEP. Tente novamente mais tarde.'
      } : {})
    };
  }
  const freeShipping = subtotal >= SHIP_FREE;
  const quotes = [...localQuotes, ...superFrete.quotes]
    .filter((quote, index, all) => all.findIndex((item) => item.id === quote.id) === index)
    .map((quote) => ({
      ...quote,
      originalPrice: quote.price,
      price: freeShipping ? 0 : quote.price
    }));

  return {
    preview: Boolean(packaging) || quotes.some((quote) => quote.preview),
    freeShipping,
    provider: 'superfrete',
    quotes,
    ...(packaging ? { packaging, notice: superFrete.notice || '', code: superFrete.code || '' } : {})
  };
}

module.exports = {
  SHIP_FREE,
  CURITIBA_SHIPPING_COST,
  ShippingQuoteError,
  cleanZip,
  isCuritibaZip,
  normalizeQuotes,
  quoteShipping,
  roundCurrency
};
