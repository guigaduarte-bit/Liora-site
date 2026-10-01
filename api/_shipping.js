'use strict';

const { buildShippingProducts } = require('./_shipping-products');
const { estimateCartPackaging, isShippingEstimatePreview } = require('./_shipping-estimate');
const { automaticCoverageBRL } = require('../content/shipping-insurance.json');
const CATALOG = require('./catalog');
const { setTimeout, clearTimeout } = require('node:timers');

const SHIP_FREE = 150;
const CURITIBA_SHIPPING_COST = 19.9;
const SUPERFRETE_ENDPOINT = '/api/v0/calculator';
const DEFAULT_SERVICES = '1,2,17,3,33,31';
const MAX_QUOTE_PARCELS = 20;
const PARCEL_CONCURRENCY = 3;
const QUOTE_DEADLINE_MS = 15000;
const REQUEST_TIMEOUT_MS = 8000;

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
  if (typeof value === 'string') {
    value = value.trim();
    if (!/^-?\d+(?:[.,]\d+)?$/.test(value)) return null;
    value = value.replace(',', '.');
  } else if (typeof value !== 'number') return null;
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
        price: price === null || price < 0 || !Number.isSafeInteger(Math.round(price * 100)) ? null : roundCurrency(price),
        deliveryDays: deliveryDays === null ? null : Math.max(0, Math.round(deliveryDays)),
        preview: false
      };
    })
    .filter((quote) => quote.id && quote.price !== null && quote.price >= 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
}

function providerErrors(data, privateValues = []) {
  const messages = [];
  const add = (value, depth = 0) => {
    if (depth > 4 || messages.length >= 16) return;
    if (typeof value === 'string' && value.trim()) {
      // Redact before truncating so part of a credential cannot survive the cut.
      let message = value;
      for (const privateValue of privateValues) {
        if (privateValue) message = message.split(String(privateValue)).join('[redacted]');
      }
      message = message
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b\d{5}-?\d{3}\b/g, '[cep]')
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[document]')
        .replace(/[\r\n\t]+/g, ' ');
      messages.push(message.trim().slice(0, 300));
    } else if (Array.isArray(value)) {
      value.slice(0, 16).forEach(item => add(item, depth + 1));
    } else if (value && typeof value === 'object') {
      for (const key of ['message', 'error', 'description', 'error_description']) {
        add(value[key], depth + 1);
      }
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

function minimumInsuranceRetryServices(attempt, subtotal) {
  if (!attempt.ok || !Array.isArray(attempt.data) || !(subtotal > 0)) return [];
  const requested = new Set(attempt.services.split(',').map(id => id.trim()));
  return [...new Set(attempt.data.filter(quote => {
    const id = String(quote && (quote.id || quote.service) || '');
    const coverage = automaticCoverageBRL[id];
    const message = providerErrors([quote]).join(' ');
    return requested.has(id) && coverage && subtotal <= coverage
      && /valor segurado.*abaixo.*limite m[ií]nimo/i.test(message);
  }).map(quote => String(quote.id || quote.service)))];
}

async function requestSuperFrete({ baseUrl, token, destination, products, package: parcel, subtotal, services, additionalInsurance = true, deadline }) {
  const origin = cleanZip(process.env.SHIP_ORIGIN_CEP);
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (!(timeoutMs > 0)) throw new ShippingQuoteError('SHIPPING_PROVIDER_TIMEOUT', 'A cotação demorou mais que o esperado. Tente novamente.', { status: 503 });
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeout;
  const expiry = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new ShippingQuoteError('SHIPPING_PROVIDER_TIMEOUT', 'A cotação demorou mais que o esperado. Tente novamente.', { status: 503 }));
      if (controller) controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${SUPERFRETE_ENDPOINT}`, {
      method: 'POST',
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.SUPERFRETE_USER_AGENT || 'Liora Aromas/1.0 (+https://lioraaromasdeluxo.com.br)'
      },
      body: JSON.stringify({
        from: { postal_code: origin },
        to: { postal_code: destination },
        services,
        options: {
          own_hand: false,
          receipt: false,
          insurance_value: additionalInsurance ? subtotal : 0,
          use_insurance_value: additionalInsurance && subtotal > 0
        },
        ...(parcel ? { package: parcel } : { products })
      })
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data, services, additionalInsurance };
  })();
  try {
    return await Promise.race([request, expiry]);
  } finally {
    clearTimeout(timeout);
  }
}

async function superFreteQuotes({ destination, cart, subtotal, estimatedParcel, deadline = Date.now() + QUOTE_DEADLINE_MS }) {
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
    deadline,
    services: requestedServices
  }));

  let quotes = attempts[0].ok ? normalizeQuotes(attempts[0].data) : [];
  if (!quotes.length && !minimumInsuranceRetryServices(attempts[0], subtotal).length && requestedServices !== '1,2') {
    attempts.push(await requestSuperFrete({
      baseUrl,
      token,
      destination,
      products,
      package: parcel,
      subtotal,
      deadline,
      services: '1,2'
    }));
    quotes = attempts[1].ok ? normalizeQuotes(attempts[1].data) : [];
  }

  // Retry only the explicitly rejected PAC/SEDEX services and only when the
  // actual merchandise value fits their verified automatic coverage. Never
  // inflate the declaration, remove insurance from a higher-value order, or
  // retry unrelated failures without insurance.
  const retryServices = [...new Set(attempts.flatMap(attempt => minimumInsuranceRetryServices(attempt, subtotal)))];
  if (retryServices.length) {
    try {
      const retry = await requestSuperFrete({
        baseUrl, token, destination, products, package: parcel, subtotal, deadline,
        services: retryServices.join(','), additionalInsurance: false
      });
      attempts.push(retry);
      const recovered = retry.ok ? normalizeQuotes(retry.data)
        .filter(quote => retryServices.includes(quote.id))
        .map(quote => ({ ...quote, insurance: {
          additional: false, declaredValue: 0, reason: 'WITHIN_AUTOMATIC_COVERAGE'
        } })) : [];
      quotes = [...quotes, ...recovered]
        .filter((quote, index, all) => all.findIndex(item => item.id === quote.id) === index)
        .sort((a, b) => a.price - b.price).slice(0, 6);
      console.info(JSON.stringify({
        event: 'shipping_minimum_insurance_retry', sandbox,
        services: retryServices.join(','), status: retry.status, recoveredQuotes: recovered.length
      }));
    } catch {
      // Keep any already-valid insured services if this optional recovery fails.
      console.warn(JSON.stringify({ event: 'shipping_minimum_insurance_retry_failed', sandbox }));
    }
  }

  if (quotes.length) return {
    preview: Boolean(estimatedParcel),
    quotes: estimatedParcel ? quotes.map((quote) => ({ ...quote, preview: true, estimated: true })) : quotes
  };

  const diagnostics = attempts.map((attempt) => ({
    status: attempt.status,
    services: attempt.services,
    additionalInsurance: attempt.additionalInsurance,
    responseType: Array.isArray(attempt.data) ? 'array' : attempt.data === null ? 'null' : typeof attempt.data,
    resultCount: Array.isArray(attempt.data) ? attempt.data.length : null,
    messages: providerErrors(attempt.data, [token, origin, destination])
  }));
  const hadAcceptedRequest = attempts.some((attempt) => attempt.ok);

  if (hadAcceptedRequest) {
    console.warn(JSON.stringify({
      event: 'shipping_provider_no_options', sandbox, attempts: diagnostics,
      originZipValid: /^\d{8}$/.test(origin), destinationZipValid: /^\d{8}$/.test(destination)
    }));
    throw new ShippingQuoteError(
      'NO_SHIPPING_OPTIONS',
      sandbox
        ? 'CEP localizado, mas a SuperFrete Sandbox não retornou uma modalidade para esta rota.'
        : 'CEP localizado, mas a SuperFrete não retornou uma modalidade para esta rota no momento.',
      { status: 422, sandbox }
    );
  }

  console.error(JSON.stringify({ event: 'shipping_provider_rejected', sandbox, attempts: diagnostics }));
  throw new ShippingQuoteError(
    'SHIPPING_PROVIDER_UNAVAILABLE',
    sandbox
      ? 'A SuperFrete Sandbox não conseguiu calcular esta rota agora.'
      : 'A SuperFrete não conseguiu calcular esta rota agora.',
    { status: 503, sandbox }
  );
}

async function multipleParcelQuotes({ destination, cart, subtotal, packaging }) {
  const failPackaging = () => {
    throw new ShippingQuoteError('SHIPPING_PACKAGING_PENDING', 'Não foi possível conferir todos os volumes deste pedido.', { status: 503 });
  };
  if (!packaging.parcels.length || packaging.parcels.length > MAX_QUOTE_PARCELS) failPackaging();

  // Values and quantities come from the server catalogue. Each declared value
  // covers only the merchandise inside that parcel, without duplicating the
  // order total across labels or accepting client-supplied prices.
  const expected = new Map();
  for (const item of cart) {
    if (!Object.hasOwn(CATALOG, item.id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) failPackaging();
    expected.set(item.id, (expected.get(item.id) || 0) + item.quantity);
  }
  const packed = new Map();
  const parcelValues = packaging.parcels.map(parcel => {
    if (!Array.isArray(parcel.items) || !parcel.items.length) failPackaging();
    let cents = 0;
    for (const item of parcel.items) {
      if (!expected.has(item.id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) failPackaging();
      const price = CATALOG[item.id].price;
      if (!Number.isFinite(price) || price < 0) failPackaging();
      packed.set(item.id, (packed.get(item.id) || 0) + item.quantity);
      cents += Math.round(price * 100) * item.quantity;
    }
    if (!Number.isSafeInteger(cents)) failPackaging();
    return cents;
  });
  if ([...expected].some(([id, quantity]) => packed.get(id) !== quantity)
    || !Number.isFinite(subtotal)
    || parcelValues.reduce((sum, cents) => sum + cents, 0) !== Math.round(subtotal * 100)) failPackaging();

  const results = new Array(packaging.parcels.length);
  const deadline = Date.now() + QUOTE_DEADLINE_MS;
  let next = 0;
  let failure;
  const worker = async () => {
    while (!failure && next < packaging.parcels.length) {
      const index = next++;
      try {
        const result = await superFreteQuotes({
          destination, cart, subtotal: parcelValues[index] / 100,
          estimatedParcel: packaging.parcels[index], deadline
        });
        if (!result.quotes.length) {
          failure = failure || new ShippingQuoteError(result.code || 'SHIPPING_MULTIPLE_PACKAGES_UNAVAILABLE', 'Não foi possível cotar todos os volumes deste pedido.');
        } else results[index] = result.quotes;
      } catch (error) {
        failure = failure || error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARCEL_CONCURRENCY, results.length) }, worker));
  if (failure) throw failure;

  const key = quote => `${quote.id}\u0000${quote.carrier}`;
  const services = results.map(quotes => {
    const grouped = new Map();
    for (const quote of quotes) {
      const service = key(quote);
      // Ambiguous duplicate services are not a usable quotation.
      grouped.set(service, grouped.has(service) ? null : quote);
    }
    return grouped;
  });
  const quotes = [...services[0]].flatMap(([service, first]) => {
    if (!first || services.some(options => !options.get(service))) return [];
    const components = services.map((options, index) => {
      const quote = options.get(service);
      return {
        parcelIndex: index + 1, serviceId: quote.id, carrier: quote.carrier,
        price: quote.price, deliveryDays: quote.deliveryDays,
        merchandiseValue: parcelValues[index] / 100,
        insurance: quote.insurance || { additional: true, declaredValue: parcelValues[index] / 100 }
      };
    });
    const totalCents = components.reduce((sum, component) => sum + Math.round(component.price * 100), 0);
    if (!Number.isSafeInteger(totalCents)) return [];
    return [{
      id: first.id, carrier: first.carrier, name: first.name,
      price: totalCents / 100,
      deliveryDays: components.some(component => component.deliveryDays === null)
        ? null : Math.max(...components.map(component => component.deliveryDays)),
      parcelCount: components.length, components, preview: true, estimated: true
    }];
  }).sort((a, b) => a.price - b.price).slice(0, 6);
  if (!quotes.length) throw new ShippingQuoteError(
    'SHIPPING_MULTIPLE_PACKAGES_UNAVAILABLE', 'Não há uma modalidade disponível para todos os volumes deste pedido.', { status: 422 }
  );
  return { preview: true, quotes, notice: `Cotação estimada para ${packaging.parcels.length} volumes. O pagamento depende da conferência das embalagens.` };
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
      superFrete = await multipleParcelQuotes({ destination, cart, subtotal, packaging });
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
