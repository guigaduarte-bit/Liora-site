#!/usr/bin/env node
'use strict';

// Offline preparation only. Import reviewed SQL through the authorized database
// workflow. This script never connects to a database or marks history as ready.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { cpfHash } = require('../api/_coupons');

const USAGE = `Uso:
  node scripts/import-coupon-history.cjs --input /caminho/exportacao.json --environment production --source mercado-pago-2026-11-20 [--output /caminho/importacao.sql]

JSON: lista de compras já pagas, com {"cpf":"...","paidAt":"2026-11-19T12:00:00-03:00","reference":"pedido-..."}.
COUPON_CPF_HASH_SECRET deve ser o segredo estável do ambiente escolhido, fornecido por variável de ambiente.
Sem --output: apenas valida e conta registros. Com --output: cria SQL privado para revisão, sem executar.
Use uma identificação de fonte sem dados pessoais. A importação não habilita PRIMEIRACOMPRA automaticamente.`;

function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const result = {};
  const allowed = new Set(['--input', '--environment', '--source', '--output']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allowed.has(key) || typeof value !== 'string' || !value || value.startsWith('--') || result[key.slice(2)] !== undefined) {
      throw new Error('Argumentos inválidos. Consulte --help.');
    }
    result[key.slice(2)] = value;
  }
  if (!result.input || !result.environment || !result.source) throw new Error('Informe --input, --environment e --source.');
  return result;
}

function prepareHistory(records, { environment, source }) {
  if (!['production', 'preview', 'development'].includes(environment)) throw new Error('Ambiente inválido.');
  if (typeof source !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{1,199}$/.test(source)) throw new Error('Use uma referência de fonte curta, sem dados pessoais.');
  if (!Array.isArray(records) || records.length === 0 || records.length > 100000) throw new Error('A exportação deve conter de 1 a 100000 compras pagas.');
  const byCpf = new Map();
  records.forEach((record, index) => {
    const label = `Registro ${index + 1}`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${label}: formato inválido.`);
    if (typeof record.paidAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(record.paidAt)
      || !Number.isFinite(Date.parse(record.paidAt)) || Date.parse(record.paidAt) > Date.now()) throw new Error(`${label}: data de pagamento inválida ou futura.`);
    if (typeof record.reference !== 'string' || !record.reference.trim() || record.reference.length > 200 || /[\u0000-\u001f\u007f]/.test(record.reference)) {
      throw new Error(`${label}: referência de compra inválida.`);
    }
    let hash;
    try { hash = cpfHash(record.cpf, environment); }
    catch (error) {
      if (error.code === 'COUPON_IDENTITY_NOT_CONFIGURED') throw new Error('Configure COUPON_CPF_HASH_SECRET com o segredo estável do ambiente escolhido.');
      throw new Error(`${label}: CPF inválido.`);
    }
    const imported = {
      environment, cpf_hash: hash, has_paid_order: true,
      first_paid_order_id: `HISTORY-${createHash('sha256').update(`${environment}\0${source}\0${record.reference.trim()}`).digest('hex')}`,
      first_paid_at: new Date(record.paidAt).toISOString(), source_reference: source
    };
    const previous = byCpf.get(hash);
    if (!previous || imported.first_paid_at < previous.first_paid_at) byCpf.set(hash, imported);
  });
  return { inputCount: records.length, rows: [...byCpf.values()].sort((a, b) => a.cpf_hash.localeCompare(b.cpf_hash)) };
}

function historySql(rows) {
  // SQL literals escape apostrophes; no raw CPF or external reference is emitted.
  const literal = JSON.stringify(rows).replace(/'/g, "''");
  return `-- Revisar fonte, ambiente e cobertura antes de executar.
-- Este arquivo contém identificadores privados e deve permanecer restrito.
-- Não altera liora_coupon_history_status: a habilitação exige conferência separada.
begin;
insert into public.liora_coupon_customers (
  environment, cpf_hash, has_paid_order, first_paid_order_id, first_paid_at, source_reference
)
select environment, cpf_hash, has_paid_order, first_paid_order_id, first_paid_at, source_reference
from jsonb_to_recordset('${literal}'::jsonb) as imported(
  environment text, cpf_hash text, has_paid_order boolean, first_paid_order_id text, first_paid_at timestamptz, source_reference text
)
on conflict (environment, cpf_hash) do update set
  has_paid_order = true,
  first_paid_order_id = case
    when liora_coupon_customers.first_paid_at is null or excluded.first_paid_at < liora_coupon_customers.first_paid_at
    then excluded.first_paid_order_id else liora_coupon_customers.first_paid_order_id end,
  first_paid_at = least(liora_coupon_customers.first_paid_at, excluded.first_paid_at),
  source_reference = case
    when liora_coupon_customers.first_paid_at is null or excluded.first_paid_at < liora_coupon_customers.first_paid_at
    then excluded.source_reference else liora_coupon_customers.source_reference end,
  updated_at = now();
commit;
`;
}

function run(args, io = { log: console.log, error: console.error }) {
  try {
    const options = parseArguments(args);
    if (options.help) { io.log(USAGE); return 0; }
    let records;
    try {
      if (fs.statSync(options.input).size > 25 * 1024 * 1024) throw new Error('too large');
      records = JSON.parse(fs.readFileSync(options.input, 'utf8'));
    } catch { throw new Error('Não foi possível ler a exportação JSON; confira o arquivo e o limite de 25 MB.'); }
    const result = prepareHistory(records, options);
    if (options.output) {
      try { fs.writeFileSync(options.output, historySql(result.rows), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
      catch { throw new Error('Não foi possível criar o SQL. Escolha um caminho disponível; arquivos existentes não são sobrescritos.'); }
    }
    io.log(`Validação concluída: ${result.inputCount} compras; ${result.rows.length} CPFs únicos. ${options.output ? 'SQL privado criado para revisão.' : 'Nenhum arquivo de importação criado.'}`);
    io.log('Nenhuma alteração no banco. A primeira compra permanece sujeita à conferência do histórico completo.');
    return 0;
  } catch (error) {
    // Deliberately print only controlled messages; never stack traces, records,
    // CPF values, hashes, file contents or database credentials.
    io.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));
module.exports = { parseArguments, prepareHistory, historySql, run };
