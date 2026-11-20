'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { prepareHistory, historySql, parseArguments, run } = require('../scripts/import-coupon-history.cjs');

const originalSecret = process.env.COUPON_CPF_HASH_SECRET;
const records = [
  { cpf: '191.191.191-00', paidAt: '2026-10-10T10:00:00-03:00', reference: 'synthetic-order-later' },
  { cpf: '19119119100', paidAt: '2026-09-10T10:00:00-03:00', reference: 'synthetic-order-earlier' }
];
const options = { environment: 'development', source: 'synthetic-export-fixture' };
before(() => { process.env.COUPON_CPF_HASH_SECRET = 'synthetic-history-hmac-key-32-characters'; });
after(() => { if (originalSecret === undefined) delete process.env.COUPON_CPF_HASH_SECRET; else process.env.COUPON_CPF_HASH_SECRET = originalSecret; });

test('importação normaliza CPF, deduplica e mantém primeira data sem escrever CPF ou referência externos', () => {
  const prepared = prepareHistory(records, options);
  assert.equal(prepared.inputCount, 2);
  assert.equal(prepared.rows.length, 1);
  assert.equal(prepared.rows[0].first_paid_at, '2026-09-10T13:00:00.000Z');
  const sql = historySql(prepared.rows);
  assert.doesNotMatch(sql, /19119119100|191\.191\.191-00|synthetic-order/);
  assert.doesNotMatch(sql, /update\s+(?:public\.)?liora_coupon_history_status/i);
  assert.match(prepared.rows[0].first_paid_order_id, /^HISTORY-[a-f0-9]{64}$/);
});

test('arquivo exige ambiente, fonte, datas com fuso e CPF válidos; --apply não existe', () => {
  assert.throws(() => parseArguments(['--input', 'x']), /Informe/);
  assert.throws(() => parseArguments(['--apply', 'true']), /Argumentos/);
  assert.throws(() => prepareHistory(records, { ...options, environment: 'unknown' }), /Ambiente/);
  assert.throws(() => prepareHistory([{ ...records[0], cpf: '11111111111' }], options), /Registro 1: CPF inválido/);
  assert.throws(() => prepareHistory([{ ...records[0], paidAt: '2026-10-01' }], options), /data/);
  assert.throws(() => prepareHistory([{ ...records[0], paidAt: '2999-10-01T12:00:00Z' }], options), /data/);
});

test('execução local é seca por padrão, SQL recebe permissão privada e logs não contêm dados identificadores', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liora-history-test-'));
  try {
    const input = path.join(dir, 'synthetic.json'), output = path.join(dir, 'review.sql');
    fs.writeFileSync(input, JSON.stringify(records));
    const logs = [], io = { log: message => logs.push(message), error: message => logs.push(message) };
    const args = ['--input', input, '--environment', 'development', '--source', options.source];
    assert.equal(run(args, io), 0);
    assert.equal(fs.existsSync(output), false);
    assert.equal(run([...args, '--output', output], io), 0);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(run([...args, '--output', output], io), 1, 'never overwrite an existing artifact');
    assert.doesNotMatch(logs.join('\n'), /19119119100|191\.191\.191-00|[a-f0-9]{64}|synthetic-order|synthetic-history-hmac-key/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SQL importado torna histórico monotônico e idempotente sem habilitar primeira compra', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const dir = path.join(__dirname, '../supabase/migrations');
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
    const prepared = prepareHistory(records, options), sql = historySql(prepared.rows);
    await db.exec(sql); await db.exec(sql);
    const row = (await db.query('select * from liora_coupon_customers')).rows[0];
    assert.equal(row.has_paid_order, true);
    assert.equal(row.first_paid_at.toISOString(), '2026-09-10T13:00:00.000Z');
    assert.equal((await db.query('select count(*)::int n from liora_coupon_customers')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from liora_coupon_history_status where ready')).rows[0].n, 0);
    await db.exec(historySql(prepareHistory([records[0]], options).rows));
    assert.equal((await db.query('select first_paid_at from liora_coupon_customers')).rows[0].first_paid_at.toISOString(), row.first_paid_at.toISOString());
  } finally { await db.close(); }
});
