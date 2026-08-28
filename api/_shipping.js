'use strict';

const SHIP_FREE = 150;
const CURITIBA_SHIPPING_COST = 19.9;
const SHIPPING_ENDPOINT = '/api/v2/me/shipment/calculate';

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

function packageFor(cart, subtotal) {
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  return {
    width: 20,
    height: Math.min(60, 12 + quantity * 3),
    length: 20,
    weight: roundCurrency(Math.max(0.3, quantity * 0.35)),
    insurance: subtotal
  };
}

function previewQuotes(zipCode) {
  const prefix = Number(zipCode.slice(0, 2));
  let standard = { price: 27.9, days: 8 };
  let express = { price: 39.9, days: 4 };

  if (prefix >= 80 && prefix <= 87) {
    standard = { price: 18.9, days: 4 };
    express = { price: 26.9, days: 2 };
  } else if (prefix >= 1 && prefix <= 39) {
    standard = { price: 22.9, days: 7 };
    express = { price: 32.9, days: 3 };
  } else if (prefix >= 70 && prefix <= 79) {
    standard = { price: 24.9, days: 7 };
    express = { price: 35.9, days: 3 };
  }

  return [
    { id: 'preview-standard', carrier: 'Correios', name: 'Envio econômico', price: standard.price, deliveryDays: standard.days },
    { id: 'preview-express', carrier: 'Correios', name: 'Envio expresso', price: express.price, deliveryDays: express.days }
  ];
}

function normalizeQuotes(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((quote) => !quote.error)
    .map((quote) => ({
      id: String(quote.id || ''),
      carrier: String(quote.company && quote.company.name || 'Transportadora').slice(0, 60),
      name: String(quote.name || 'Entrega').slice(0, 80),
      price: roundCurrency(quote.custom_price ?? quote.price),
      deliveryDays: Number(quote.custom_delivery_time ?? quote.delivery_time)
    }))
    .filter((quote) => quote.id && Number.isFinite(quote.price) && quote.price >= 0 && Number.isFinite(quote.deliveryDays))
    .sort((a, b) => a.price - b.price)
    .slice(0, 4);
}

async function quoteShipping({ zipCode, cart, subtotal }) {
  const destination = cleanZip(zipCode);
  if (destination.length !== 8) throw new Error('CEP inválido');

  const origin = cleanZip(process.env.SHIP_ORIGIN_CEP);
  const token = process.env.MELHOR_ENVIO_TOKEN;
  const localDelivery = isCuritibaZip(destination);
  const preview = !localDelivery && (!origin || !token);
  let quotes;

  if (localDelivery) {
    quotes = [{
      id: 'curitiba-fixed',
      carrier: 'Liora',
      name: 'Entrega em Curitiba',
      price: CURITIBA_SHIPPING_COST,
      deliveryDays: null
    }];
  } else if (preview) {
    quotes = previewQuotes(destination);
  } else {
    const baseUrl = process.env.MELHOR_ENVIO_BASE_URL || 'https://melhorenvio.com.br';
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${SHIPPING_ENDPOINT}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.SHIP_USER_AGENT || 'Liora Aromas (contato@lioraaromasdeluxo.com.br)'
      },
      body: JSON.stringify({
        from: { postal_code: origin },
        to: { postal_code: destination },
        volumes: [packageFor(cart, subtotal)],
        options: { receipt: false, own_hand: false }
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error('Não foi possível consultar as transportadoras');
    quotes = normalizeQuotes(data);
    if (!quotes.length) throw new Error('Nenhuma opção de entrega disponível para este CEP');
  }

  const freeShipping = subtotal >= SHIP_FREE;
  return {
    preview,
    freeShipping,
    quotes: quotes.map((quote) => ({
      ...quote,
      originalPrice: quote.price,
      price: freeShipping ? 0 : quote.price
    }))
  };
}

module.exports = {
  SHIP_FREE,
  CURITIBA_SHIPPING_COST,
  cleanZip,
  isCuritibaZip,
  quoteShipping,
  roundCurrency
};
