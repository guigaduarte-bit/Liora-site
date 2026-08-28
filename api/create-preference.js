'use strict';

const { randomUUID } = require('node:crypto');
const CATALOG = require('./catalog');

const SHIP_FREE = 250;
const SHIP_COST = 22.9;
const PAYMENT_TYPES = ['credit_card', 'debit_card', 'ticket', 'bank_transfer'];
const PAYMENT_METHODS = new Set(['pix', 'card', 'boleto']);
const SHIPPING_METHODS = new Set(['correios', 'retirada']);

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  return {};
}

function getHttpUrl(rawValue) {
  if (!rawValue) return null;
  try {
    const raw = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function getSiteUrl() {
  const configured = process.env.SITE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL;
  const url = getHttpUrl(configured);
  return url ? url.origin : null;
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrinho vazio');
  if (items.length > 50) throw new Error('Carrinho possui itens demais');

  const quantitiesByProduct = new Map();
  const validated = items.map((item) => {
    const id = cleanText(item && item.id, 100);
    const product = CATALOG[id];
    const quantity = Number(item && item.qty);

    if (!product || product.soldout || product.stock < 1) {
      throw new Error('Um produto do carrinho não está disponível');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error('Quantidade inválida no carrinho');
    }

    const accumulated = (quantitiesByProduct.get(id) || 0) + quantity;
    if (accumulated > product.stock) {
      throw new Error(`Estoque insuficiente para ${product.name}`);
    }
    quantitiesByProduct.set(id, accumulated);

    return {
      id,
      name: product.name,
      price: product.price,
      quantity,
      fragrance: cleanText(item.frag, 60)
    };
  });

  const totalQuantity = validated.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > 200) throw new Error('Quantidade total inválida');
  return validated;
}

function titleFor(item) {
  const fragrance = item.fragrance ? ` — ${item.fragrance}` : '';
  return `${item.name}${fragrance}`.slice(0, 250);
}

function buildPaymentItems(cart, payMethod, subtotal) {
  if (payMethod !== 'pix') {
    return cart.map((item) => ({
      id: item.id,
      title: titleFor(item),
      quantity: item.quantity,
      unit_price: item.price,
      currency_id: 'BRL'
    }));
  }

  // Checkout Pro não deve receber item com preço negativo. No Pix, cada linha
  // vira uma unidade com o total já descontado; a última absorve os centavos de
  // arredondamento para manter exatamente 5% no total do carrinho.
  const discountedSubtotal = roundCurrency(subtotal * 0.95);
  let allocated = 0;
  return cart.map((item, index) => {
    const isLast = index === cart.length - 1;
    const lineTotal = roundCurrency(item.price * item.quantity);
    const unitPrice = isLast
      ? roundCurrency(discountedSubtotal - allocated)
      : roundCurrency(lineTotal * 0.95);
    allocated = roundCurrency(allocated + unitPrice);
    return {
      id: item.id,
      title: `${item.quantity}× ${titleFor(item)}`.slice(0, 250),
      quantity: 1,
      unit_price: unitPrice,
      currency_id: 'BRL'
    };
  });
}

function paymentSettings(payMethod) {
  let allowed = PAYMENT_TYPES;
  let installments;

  if (payMethod === 'pix') allowed = ['bank_transfer'];
  if (payMethod === 'boleto') allowed = ['ticket'];
  if (payMethod === 'card') {
    allowed = ['credit_card', 'debit_card'];
    installments = 3;
  }

  return {
    excluded_payment_types: PAYMENT_TYPES
      .filter((type) => !allowed.includes(type))
      .map((id) => ({ id })),
    ...(installments ? { installments } : {})
  };
}

function setResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = async function handler(req, res) {
  setResponseHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  const siteUrl = getSiteUrl();
  if (!accessToken || !siteUrl) {
    return res.status(500).json({ error: 'Pagamento temporariamente indisponível' });
  }

  try {
    const { items, payMethod, shipping, payer } = parseBody(req);
    const selectedPayment = cleanText(payMethod, 20);
    const selectedShipping = cleanText(shipping && shipping.method, 20);

    if (!PAYMENT_METHODS.has(selectedPayment)) {
      return res.status(400).json({ error: 'Meio de pagamento inválido' });
    }
    if (!SHIPPING_METHODS.has(selectedShipping)) {
      return res.status(400).json({ error: 'Meio de envio inválido' });
    }

    const name = cleanText(payer && payer.name, 120);
    const email = cleanText(payer && payer.email, 160).toLowerCase();
    const zipCode = cleanText(payer && payer.cep, 10).replace(/\D/g, '');
    const streetNumber = cleanText(payer && payer.num, 20);
    const address = cleanText(payer && payer.addr, 250);

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Nome e e-mail válidos são obrigatórios' });
    }
    if (selectedShipping === 'correios' && (zipCode.length !== 8 || address.length < 8 || !streetNumber)) {
      return res.status(400).json({ error: 'Endereço de entrega incompleto' });
    }

    const cart = validateCart(items);
    const subtotal = roundCurrency(cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    ));
    const shippingCost = selectedShipping === 'correios' && subtotal < SHIP_FREE
      ? SHIP_COST
      : 0;
    const productTotal = selectedPayment === 'pix'
      ? roundCurrency(subtotal * 0.95)
      : subtotal;
    const total = roundCurrency(productTotal + shippingCost);
    const orderId = `LIORA-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const returnUrl = `${siteUrl}/?checkout=return&order_id=${encodeURIComponent(orderId)}`;

    const preference = {
      items: buildPaymentItems(cart, selectedPayment, subtotal),
      payer: {
        name,
        email,
        ...(selectedShipping === 'correios' ? {
          address: {
            zip_code: zipCode,
            street_name: address,
            street_number: streetNumber || 'S/N'
          }
        } : {})
      },
      ...(selectedShipping === 'correios' ? {
        shipments: { cost: shippingCost, mode: 'not_specified' }
      } : {}),
      payment_methods: paymentSettings(selectedPayment),
      back_urls: {
        success: returnUrl,
        failure: returnUrl,
        pending: returnUrl
      },
      auto_return: 'approved',
      external_reference: orderId,
      statement_descriptor: 'LIORA AROMAS',
      metadata: {
        order_id: orderId,
        shipping_method: selectedShipping,
        customer_address: address,
        customer_number: streetNumber,
        subtotal,
        total
      }
    };

    const webhookUrl = getHttpUrl(process.env.MP_WEBHOOK_URL);
    if (webhookUrl) preference.notification_url = webhookUrl.toString();

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(preference)
    });
    const data = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !data.init_point) {
      console.error('Mercado Pago recusou a preferência', {
        status: mpResponse.status,
        cause: data.cause || data.message || 'resposta inválida'
      });
      return res.status(502).json({ error: 'Não foi possível iniciar o pagamento' });
    }

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      order_id: orderId,
      total
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: 'Dados do checkout inválidos' });
    }
    if (error && /Carrinho|produto|Quantidade|Estoque/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao criar preferência', error);
    return res.status(500).json({ error: 'Erro interno ao criar pagamento' });
  }
};
