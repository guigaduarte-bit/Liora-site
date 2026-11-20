'use strict';

const CATALOG = require('./catalog');

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

// Used by both coupon quotes and payment creation. Prices always come from
// the private server catalogue, never from the browser's totals.
function validateCart(items, catalog = CATALOG) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrinho vazio');
  if (items.length > 50) throw new Error('Carrinho possui itens demais');
  const quantitiesByProduct = new Map();
  const cart = items.map(item => {
    const id = cleanText(item && item.id, 100);
    const product = Object.hasOwn(catalog, id) ? catalog[id] : null;
    const quantity = Number(item && item.qty);
    if (!product || product.soldout || (!product.madeToOrder && product.stock < 1)) {
      throw new Error('Um produto do carrinho não está disponível');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Quantidade inválida no carrinho');
    const accumulated = (quantitiesByProduct.get(id) || 0) + quantity;
    if (!product.madeToOrder && accumulated > product.stock) throw new Error(`Estoque insuficiente para ${product.name}`);
    quantitiesByProduct.set(id, accumulated);
    return { id, name: product.name, price: product.price, quantity, fragrance: cleanText(item.frag, 60) };
  });
  if (cart.reduce((sum, item) => sum + item.quantity, 0) > 200) throw new Error('Quantidade total inválida');
  return cart;
}

module.exports = { cleanText, validateCart };
