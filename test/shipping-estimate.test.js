'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const catalog = require('../api/catalog');
const shippingData = require('../content/shipping-products.json');
const { estimateCartPackaging, isShippingEstimatePreview } = require('../api/_shipping-estimate');

// Valores independentes da implementação, transcritos da especificação de
// estimativa de embalagem Liora de 27/09/2026. Não são pesos homologados.
const referenceBoxes = {
  P04: { dimensionsCm: { length: 16, width: 12, height: 4 }, tare: 60 },
  C08: { dimensionsCm: { length: 32, width: 12, height: 8 }, tare: 120 },
  C12: { dimensionsCm: { length: 32, width: 12, height: 12 }, tare: 150 },
  M08: { dimensionsCm: { length: 24, width: 16, height: 8 }, tare: 120 },
  M12: { dimensionsCm: { length: 24, width: 16, height: 12 }, tare: 150 },
  G08: { dimensionsCm: { length: 32, width: 24, height: 8 }, tare: 200 },
  G12: { dimensionsCm: { length: 32, width: 24, height: 12 }, tare: 240 },
  G16: { dimensionsCm: { length: 32, width: 24, height: 16 }, tare: 270 },
  G20: { dimensionsCm: { length: 32, width: 24, height: 20 }, tare: 300 }
};
const singleUnits = [
  ['botanique', 'G20', 875],
  ['botanique-70-ml-1dqj4', 'M12', 320],
  ['ursinho', 'M12', 290],
  ['flordevenus', 'G16', 490],
  ['abraco-em-luz', 'G16', 435],
  ['mini-bubble', 'M08', 260],
  ['bolhas', 'M12', 338],
  ['no-deluz', 'M12', 305],
  ['lioracoral', 'M12', 315],
  ['essenza-cube', 'M12', 375],
  ['kit-silhouette', 'G20', 653],
  ['trevo', 'G16', 490],
  ['perolas', 'M12', 380],
  ['kit-boho-glass', 'G16', 720],
  ['lumina', 'G16', 500],
  ['gota-de-luz1', 'M12', 358],
  ['geometricafacetada', 'M12', 350],
  ['cilindro-mosaico', 'M12', 380],
  ['chama-esculpida', 'G20', 608],
  ['camafeufada', 'G16', 420],
  ['botanicavasogesso', 'G16', 570],
  ['peonia', 'M12', 350],
  ['sagrada-familia', 'G20', 600]
];
const incompleteIds = [
  'vela-escultural-lady-veil-phie3',
  'vela-decorativa-anjo-em-vitral-1sbe9',
  'botanique-150-gr-1gyzj'
];

function checkParcelGeometryAndWeight(result) {
  assert.equal(result.status, 'estimated');
  assert.equal(result.assumptions.estimated, true);
  assert.equal(result.assumptions.uprightOnly, true);
  assert.equal(result.assumptions.allowStacking, false);
  assert.equal(result.assumptions.protectionPerFaceCm, 1.5);
  assert.equal(result.assumptions.wallPerFaceCm, 0.5);
  assert.equal(result.assumptions.protectionWeightPerPieceGrams, 50);
  assert.equal(result.assumptions.protectionWeightPerParcelGrams, 50);
  let pieceCount = 0;
  let totalWeight = 0;

  for (const parcel of result.parcels) {
    const box = referenceBoxes[parcel.boxCode];
    assert.ok(box, `modelo de caixa conhecido: ${parcel.boxCode}`);
    assert.deepEqual(parcel.dimensionsCm, box.dimensionsCm);
    const interiorMm = Object.fromEntries(Object.entries(box.dimensionsCm).map(([axis, value]) => [axis, (value - 1) * 10]));
    const quantity = parcel.items.reduce((sum, item) => sum + item.quantity, 0);
    const itemMass = parcel.items.reduce((sum, item) => sum + shippingData[item.id].weightGrams * item.quantity, 0);
    assert.equal(parcel.itemsWeightGrams, itemMass);
    assert.equal(parcel.boxWeightGrams, box.tare, 'a tara entra uma única vez por volume');
    assert.equal(parcel.protectionWeightGrams, quantity * 50 + 50);
    assert.equal(parcel.totalWeightGrams, itemMass + box.tare + quantity * 50 + 50);
    assert.equal(parcel.placements.length, quantity);

    const placementCounts = new Map();
    for (const placed of parcel.placements) {
      const piece = shippingData[placed.id];
      assert.ok(piece && piece.dimensionsCm);
      placementCounts.set(placed.id, (placementCounts.get(placed.id) || 0) + 1);
      const position = placed.positionMm;
      const dimensions = placed.dimensionsMm;
      assert.equal(position.z, 0, 'nenhuma peça pode ficar empilhada');
      assert.equal(dimensions.height, (piece.dimensionsCm.height + 3) * 10, 'altura protegida permanece em pé');
      const base = placed.rotatedBase
        ? { length: piece.dimensionsCm.width, width: piece.dimensionsCm.length }
        : piece.dimensionsCm;
      assert.equal(dimensions.length, (base.length + 3) * 10);
      assert.equal(dimensions.width, (base.width + 3) * 10);
      for (const [coordinate, axis] of [['x', 'length'], ['y', 'width'], ['z', 'height']]) {
        assert.ok(Number.isInteger(position[coordinate]) && position[coordinate] >= 0);
        assert.ok(position[coordinate] + dimensions[axis] <= interiorMm[axis], `${placed.id} precisa caber dentro da caixa no eixo ${axis}`);
      }
    }
    assert.deepEqual([...placementCounts].sort(), parcel.items.map((item) => [item.id, item.quantity]).sort());
    for (let i = 0; i < parcel.placements.length; i += 1) {
      for (let j = i + 1; j < parcel.placements.length; j += 1) {
        const a = parcel.placements[i], b = parcel.placements[j];
        const separated = a.positionMm.x + a.dimensionsMm.length <= b.positionMm.x
          || b.positionMm.x + b.dimensionsMm.length <= a.positionMm.x
          || a.positionMm.y + a.dimensionsMm.width <= b.positionMm.y
          || b.positionMm.y + b.dimensionsMm.width <= a.positionMm.y;
        assert.ok(separated, `as peças ${i} e ${j} não podem se sobrepor, incluindo proteção`);
      }
    }
    pieceCount += quantity;
    totalWeight += parcel.totalWeightGrams;
  }
  assert.equal(result.pieceCount, pieceCount);
  assert.equal(result.totalWeightGrams, totalWeight);
}

test('tabela cobre os 27 SKUs: 23 estimáveis, 3 incompletos e 1 sem caixa', () => {
  const coveredIds = [...singleUnits.map(([id]) => id), ...incompleteIds, 'jardim-encantado'];
  assert.equal(singleUnits.length, 23);
  assert.equal(new Set(coveredIds).size, 27);
  assert.deepEqual(coveredIds.sort(), Object.keys(catalog).sort());
});

for (const [id, boxCode, weight] of singleUnits) {
  test(`uma unidade de ${id}: ${boxCode}, ${weight} g`, () => {
    const result = estimateCartPackaging([{ id, quantity: 1 }]);
    checkParcelGeometryAndWeight(result);
    assert.equal(result.parcels.length, 1);
    assert.equal(result.parcels[0].boxCode, boxCode);
    assert.equal(result.parcels[0].totalWeightGrams, weight);
    assert.equal(result.totalWeightGrams, weight);
  });
}

for (const id of incompleteIds) {
  test(`${id}: dados incompletos impedem a estimativa do carrinho inteiro`, () => {
    for (const cart of [[{ id, quantity: 1 }], [{ id: 'botanique', quantity: 1 }, { id, quantity: 1 }]]) {
      const result = estimateCartPackaging(cart);
      assert.equal(result.status, 'incomplete');
      assert.deepEqual(result.parcels, []);
      assert.ok(result.issues.length > 0);
      assert.ok(!result.totalWeightGrams, 'não retornar massa de uma parte do pedido');
    }
  });
}

test('Jardim Encantado grande não cabe e não pode ser deitado nem parcialmente cotado', () => {
  for (const cart of [
    [{ id: 'jardim-encantado', quantity: 1 }],
    [{ id: 'botanique', quantity: 1 }, { id: 'jardim-encantado', quantity: 1 }]
  ]) {
    const result = estimateCartPackaging(cart);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.parcels, []);
    assert.ok(result.issues.length > 0);
  }
});

for (const [label, cart, boxCode, expectedWeights] of [
  ['1 Botanique', [{ id: 'botanique', quantity: 1 }], 'G20', [875]],
  ['2 Botanique', [{ id: 'botanique', quantity: 2 }], 'G20', [1400]],
  ['1 Botanique e 2 Ursinhos', [{ id: 'botanique', quantity: 1 }, { id: 'ursinho', quantity: 2 }], 'G20', [1055]],
  ['4 Mini Bubble', [{ id: 'mini-bubble', quantity: 4 }], 'M08', [530]],
  ['4 Botanique', [{ id: 'botanique', quantity: 4 }], 'G20', [1400, 1400]]
]) {
  test(`${label}: volumes e pesos correspondem à simulação aprovada para preview`, () => {
    const result = estimateCartPackaging(cart);
    checkParcelGeometryAndWeight(result);
    assert.deepEqual(result.parcels.map((parcel) => parcel.boxCode), expectedWeights.map(() => boxCode));
    assert.deepEqual(result.parcels.map((parcel) => parcel.totalWeightGrams), expectedWeights);
    assert.equal(result.totalWeightGrams, expectedWeights.reduce((sum, value) => sum + value, 0));
  });
}

test('duas fragrâncias do mesmo SKU compartilham as peças, sem duplicar caixa ou tara', () => {
  const clean = estimateCartPackaging([{ id: 'botanique', quantity: 2 }]);
  const variants = estimateCartPackaging([
    { id: 'botanique', quantity: 1, fragrance: 'Lavanda' },
    { id: 'botanique', qty: 1, frag: 'Baunilha' }
  ]);
  assert.deepEqual(variants, clean);
  assert.deepEqual(variants.parcels[0].items, [{ id: 'botanique', quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(variants), /Lavanda|Baunilha/);
});

test('carrinho com todos os 23 modelos completos conserva cada peça e independe da ordem', () => {
  const cart = singleUnits.map(([id]) => ({ id, quantity: 1 }));
  const result = estimateCartPackaging(cart);
  checkParcelGeometryAndWeight(result);
  const placedIds = result.parcels.flatMap((parcel) => parcel.placements.map((placed) => placed.id)).sort();
  assert.deepEqual(placedIds, cart.map((item) => item.id).sort());
  assert.deepEqual(estimateCartPackaging([...cart].reverse()), result);
});

test('massa e dimensões forjadas no cliente são ignoradas; catálogo do servidor prevalece', () => {
  const clean = estimateCartPackaging([{ id: 'botanique', quantity: 1 }]);
  const request = [{
    id: 'botanique', quantity: 1, price: 0.01, weightGrams: 1,
    dimensionsCm: { length: 1, width: 1, height: 1 },
    shippingDimensionsCm: { length: 1, width: 1, height: 1 },
    packingWeightGrams: 1, confirmedForShipping: true,
    boxCode: 'P04', boxWeightGrams: 0, protectionPerFaceCm: 0
  }];
  const before = structuredClone(request);
  assert.deepEqual(estimateCartPackaging(request), clean);
  assert.deepEqual(request, before, 'não alterar os dados recebidos');
});

test('proteção de 2 cm por face não pode forçar Botanique em G20 nem diminuir a proteção', () => {
  const result = estimateCartPackaging([{ id: 'botanique', quantity: 1 }], { protectionPerFaceCm: 2 });
  assert.equal(result.assumptions.protectionPerFaceCm, 2);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.parcels, []);
  assert.ok(result.issues.length > 0);
});

for (const [label, cart] of [
  ['carrinho vazio', []],
  ['carrinho ausente', undefined],
  ['objeto em vez de lista', { id: 'botanique', quantity: 1 }],
  ['entrada nula', [null]],
  ['ID desconhecido', [{ id: 'nao-existe', quantity: 1 }]],
  ['ID herdado do protótipo', [{ id: '__proto__', quantity: 1 }]],
  ['ID constructor', [{ id: 'constructor', quantity: 1 }]],
  ['quantidade ausente', [{ id: 'botanique' }]],
  ['quantidade zero', [{ id: 'botanique', quantity: 0 }]],
  ['quantidade negativa', [{ id: 'botanique', quantity: -1 }]],
  ['quantidade fracionária', [{ id: 'botanique', quantity: 1.5 }]],
  ['quantidade em texto', [{ id: 'botanique', quantity: '2' }]],
  ['quantidade NaN', [{ id: 'botanique', quantity: NaN }]],
  ['quantidade infinita', [{ id: 'botanique', quantity: Infinity }]],
  ['qty diverge de quantity', [{ id: 'botanique', quantity: 1, qty: 2 }]],
  ['mais de 100 peças', [{ id: 'mini-bubble', quantity: 101 }]],
  ['mais de 100 peças entre variantes', [{ id: 'mini-bubble', quantity: 60, frag: 'A' }, { id: 'mini-bubble', quantity: 41, frag: 'B' }]],
  ['mais de 20 volumes', [{ id: 'sagrada-familia', quantity: 81 }]]
]) {
  test(`entrada não estimável: ${label}`, () => {
    const result = estimateCartPackaging(cart);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.parcels, []);
    assert.ok(result.issues.length > 0);
  });
}

test('o simulador aceita quantity e qty consistentes e não altera a política de estoque', () => {
  assert.deepEqual(
    estimateCartPackaging([{ id: 'botanique', quantity: 1, qty: 1 }]),
    estimateCartPackaging([{ id: 'botanique', quantity: 1 }])
  );
  assert.equal(estimateCartPackaging([{ id: 'botanique', quantity: 4 }]).status, 'estimated');
  assert.equal(catalog.botanique.stock, 2, 'estoque permanece independente da simulação pura');
});

test('estimativa permanece marcada como hipótese e não homologa os dados de expedição', () => {
  const before = structuredClone(shippingData);
  estimateCartPackaging([{ id: 'botanique', quantity: 2 }]);
  assert.deepEqual(shippingData, before);
  for (const data of Object.values(shippingData)) {
    assert.equal(data.confirmedForShipping, false);
    assert.equal(data.shippingDimensionsCm, null);
    assert.equal(data.packingWeightGrams, null);
  }
});

test('modo estimativo é habilitado somente em VERCEL_ENV=preview', () => {
  const previous = process.env.VERCEL_ENV;
  try {
    for (const [environment, expected] of [['preview', true], ['production', false], ['development', false], ['', false], [undefined, false]]) {
      if (environment === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = environment;
      assert.equal(isShippingEstimatePreview(), expected, `ambiente ${String(environment)}`);
    }
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
