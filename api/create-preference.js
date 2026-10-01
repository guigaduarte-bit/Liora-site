'use strict';

const { randomUUID } = require('node:crypto');
const CATALOG = require('./catalog');
const { SHIP_FREE, cleanZip, quoteShipping, roundCurrency } = require('./_shipping');
const { configuration, siteOrigin, signProof, httpsUrl, providerRequest, fail, respondError, responseHeaders } = require('./_payment');

const PAYMENT_TYPES = ['credit_card', 'debit_card', 'ticket', 'bank_transfer'];
const PAYMENT_METHODS = new Set(['pix', 'card', 'boleto', 'infinitepay']);
const SHIPPING_METHODS = new Set(['delivery']);

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  return {};
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
    allowed = ['credit_card'];
    installments = 3;
  }

  return {
    excluded_payment_types: PAYMENT_TYPES
      .filter((type) => !allowed.includes(type))
      .map((id) => ({ id })),
    ...(installments ? { installments } : {})
  };
}

function buildInfinitePayItems(cart, shippingCost, selectedQuote) {
  const items = cart.map((item) => ({
    quantity: item.quantity,
    price: Math.round(item.price * 100),
    description: titleFor(item).slice(0, 120)
  }));
  if (shippingCost > 0) {
    items.push({
      quantity: 1,
      price: Math.round(shippingCost * 100),
      description: `Frete — ${selectedQuote.name}`.slice(0, 120)
    });
  }
  return items;
}

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { items, payMethod, shipping, payer, returnOrigin } = parseBody(req);
    const selectedPayment = cleanText(payMethod, 20);
    const selectedShipping = cleanText(shipping && shipping.method, 20);

    if (!PAYMENT_METHODS.has(selectedPayment)) {
      return res.status(400).json({ error: 'Meio de pagamento inválido' });
    }
    if (!SHIPPING_METHODS.has(selectedShipping)) {
      return res.status(400).json({ error: 'Meio de envio inválido' });
    }

    const provider = selectedPayment === 'infinitepay' ? 'infinitepay' : 'mercadopago';
    const config = configuration(provider);
    const siteUrl = siteOrigin(config);
    if (returnOrigin !== undefined && returnOrigin !== siteUrl) {
      fail('CHECKOUT_ORIGIN_MISMATCH', 'Abra a loja pelo endereço configurado para este checkout antes de continuar.', 409);
    }

    const name = cleanText(payer && payer.name, 120);
    const email = cleanText(payer && payer.email, 160).toLowerCase();
    const zipCode = cleanZip(payer && payer.cep);
    const streetNumber = cleanText(payer && payer.num, 20);
    const address = cleanText(payer && payer.addr, 250);

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Nome e e-mail válidos são obrigatórios' });
    }
    if (selectedShipping === 'delivery' && (zipCode.length !== 8 || !address)) {
      return res.status(400).json({ error: 'Endereço de entrega incompleto' });
    }

    const cart = validateCart(items);
    const subtotal = roundCurrency(cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    ));
    let selectedQuote = null;
    let shippingCost = 0;
    if (selectedShipping === 'delivery') {
      const quoteResult = await quoteShipping({ zipCode, cart, subtotal });
      const serviceId = cleanText(shipping && shipping.serviceId, 80);
      selectedQuote = quoteResult.quotes.find((quote) => quote.id === serviceId);
      if (!selectedQuote) return res.status(400).json({ error: 'Selecione novamente a opção de entrega' });
      if (selectedQuote.preview) {
        return res.status(503).json({
          error: selectedQuote.estimated
            ? 'A embalagem estimada precisa ser conferida antes de liberar o pagamento com este frete.'
            : 'A cotação real da SuperFrete precisa ser conectada antes do pagamento',
          code: selectedQuote.estimated ? 'SHIPPING_ESTIMATE_NOT_VALIDATED' : 'SHIPPING_PREVIEW_ONLY'
        });
      }
      shippingCost = subtotal >= SHIP_FREE ? 0 : selectedQuote.price;
    }
    const productTotal = selectedPayment === 'pix'
      ? roundCurrency(subtotal * 0.95)
      : subtotal;
    const total = roundCurrency(productTotal + shippingCost);
    const orderId = `LIORA-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const checkoutProof = signProof({ orderId, provider, totalCents: Math.round(total * 100), method: selectedPayment }, config);
    const returnUrl = `${siteUrl}/?checkout=return&order_id=${encodeURIComponent(orderId)}`;

    if (selectedPayment === 'infinitepay') {
      const infinitePayReturnUrl = `${siteUrl}/?checkout=infinitepay-return&order_id=${encodeURIComponent(orderId)}`;
      const checkoutPayload = {
        handle: config.credential,
        redirect_url: infinitePayReturnUrl,
        order_nsu: orderId,
        customer: { name, email },
        address: {
          cep: zipCode,
          number: streetNumber || 'S/N',
          complement: address
        },
        items: buildInfinitePayItems(cart, shippingCost, selectedQuote)
      };
      if (process.env.INFINITEPAY_WEBHOOK_URL) {
        const webhookUrl = httpsUrl(process.env.INFINITEPAY_WEBHOOK_URL, [new URL(siteUrl).hostname]);
        if (!webhookUrl) fail('PAYMENT_WEBHOOK_URL_INVALID');
        checkoutPayload.webhook_url = webhookUrl.toString();
      }

      const data = await providerRequest('https://api.checkout.infinitepay.io/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(checkoutPayload)
      });
      const checkoutUrl = httpsUrl(data.url, ['checkout.infinitepay.com.br']);
      if (!checkoutUrl) fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível iniciar o pagamento pela InfinitePay.', 502);
      return res.status(200).json({
        id: data.invoice_slug || orderId,
        init_point: checkoutUrl.toString(),
        order_id: orderId,
        provider: 'infinitepay',
        checkout_proof: checkoutProof,
        payment_mode: config.mode,
        total
      });
    }

    const preference = {
      items: buildPaymentItems(cart, selectedPayment, subtotal),
      payer: {
        name,
        email,
        ...(selectedShipping === 'delivery' ? {
          address: {
            zip_code: zipCode,
            street_name: address,
            street_number: streetNumber || 'S/N'
          }
        } : {})
      },
      ...(selectedShipping === 'delivery' ? {
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
        shipping_service: selectedQuote.name,
        shipping_carrier: selectedQuote.carrier,
        shipping_delivery_days: selectedQuote.deliveryDays || 0,
        subtotal,
        total
      }
    };

    if (process.env.MP_WEBHOOK_URL) {
      const webhookUrl = httpsUrl(process.env.MP_WEBHOOK_URL, [new URL(siteUrl).hostname]);
      if (!webhookUrl) fail('PAYMENT_WEBHOOK_URL_INVALID');
      preference.notification_url = webhookUrl.toString();
    }

    const data = await providerRequest('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.credential}`
      },
      body: JSON.stringify(preference)
    });
    const checkoutUrl = httpsUrl(data.init_point, ['www.mercadopago.com.br', 'mercadopago.com.br', ...(config.mode === 'test' ? ['sandbox.mercadopago.com.br'] : [])]);
    if (!checkoutUrl || typeof data.id !== 'string' || !data.id || data.id.length > 200) fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível iniciar o pagamento.', 502);
    if (typeof data.live_mode !== 'undefined' && data.live_mode !== (config.mode === 'live')) fail('PAYMENT_ENVIRONMENT_MISMATCH');

    return res.status(200).json({
      id: data.id,
      init_point: checkoutUrl.toString(),
      order_id: orderId,
      provider: 'mercadopago',
      checkout_proof: checkoutProof,
      payment_mode: config.mode,
      total
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: 'Dados do checkout inválidos' });
    }
    if (error && error.code === 'SHIPPING_DATA_INCOMPLETE') {
      return res.status(503).json({ error: error.message, code: error.code });
    }
    if (error && /Carrinho|produto|Quantidade|Estoque/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return respondError(res, error);
  }
};
