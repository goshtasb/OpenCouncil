'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../src/gateway');
const { chargeCustomer } = require('../src/billing');
const { CardDeclinedError } = require('../src/errors');
const { fakeTransport } = require('./fake-transport');

test('charges the customer', async () => {
  const t = fakeTransport();
  const charge = await chargeCustomer(new GatewayClient(t), { id: 'cus_1' }, 1999);
  assert.equal(charge.amountCents, 1999);
  assert.equal(t.calls.length, 1);
});

test('rejects a bad amount', async () => {
  await assert.rejects(chargeCustomer(new GatewayClient(fakeTransport()), { id: 'cus_1' }, 0), RangeError);
});

test('a decline surfaces as CardDeclinedError', async () => {
  await assert.rejects(chargeCustomer(new GatewayClient(fakeTransport(['decline'])), { id: 'cus_1' }, 500), CardDeclinedError);
});
