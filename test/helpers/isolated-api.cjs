'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Fixtures em memória: não alteram os pesos pendentes do catálogo real.
function confirmedShipping(overrides = {}) {
  return {
    weightGrams: 333,
    dimensionsCm: { length: 8, width: 7, height: 6 },
    packingWeightGrams: 25,
    shippingDimensionsCm: { length: 10, width: 9, height: 8 },
    confirmedForShipping: true,
    ...overrides
  };
}

function loadApi(filename, options = {}) {
  const sourcePath = path.join(__dirname, '..', '..', 'api', filename);
  const nativeRequire = createRequire(sourcePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    module,
    exports: module.exports,
    process,
    Buffer,
    URL,
    console,
    fetch: (...args) => global.fetch(...args),
    require(specifier) {
      if (specifier === '../content/shipping-products.json' && options.shippingProducts) return options.shippingProducts;
      if (specifier === './catalog' && options.catalog) return options.catalog;
      if (['./_shipping', './_shipping-products'].includes(specifier)) return loadApi(`${specifier.slice(2)}.js`, options);
      return nativeRequire(specifier);
    }
  }, { filename: sourcePath });
  return module.exports;
}

module.exports = { loadApi, confirmedShipping };
