'use strict';

const CATALOG = require('./catalog');
const { cleanZip, quoteShipping, roundCurrency } = require('./_shipping');

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  return {};
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new Error('Carrinho inválido');
  const quantities = new Map();
  const cart = items.map((item) => {
    const id = String(item && item.id || '').slice(0, 100);
    const product = CATALOG[id];
    const quantity = Number(item && item.qty);
    if (!product || product.soldout || !Number.isInteger(quantity) || quantity < 1) throw new Error('Produto indisponível');
    const accumulated = (quantities.get(id) || 0) + quantity;
    if (accumulated > product.stock) throw new Error('Estoque insuficiente');
    quantities.set(id, accumulated);
    return { id, quantity, price: product.price };
  });
  return cart;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { cep, items } = parseBody(req);
    const zipCode = cleanZip(cep);
    if (zipCode.length !== 8) return res.status(400).json({ error: 'Informe um CEP válido' });
    const cart = validateCart(items);
    const subtotal = roundCurrency(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
    const result = await quoteShipping({ zipCode, cart, subtotal });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Dados inválidos' });
    if (/Carrinho|Produto|Estoque|CEP/i.test(error.message)) return res.status(400).json({ error: error.message });
    console.error('Erro ao calcular frete', error);
    return res.status(502).json({ error: error.message || 'Não foi possível calcular o frete' });
  }
};
