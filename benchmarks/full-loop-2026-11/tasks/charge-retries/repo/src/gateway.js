'use strict';
const { randomUUID } = require('node:crypto');
const { GatewayError, GatewayTimeoutError, CardDeclinedError } = require('./errors');

/**
 * Thin client for the card gateway. `transport.send(method, path, body, headers)` resolves to
 * `{ status, body }` or rejects with an error whose `code` is 'ETIMEDOUT' when the gateway doesn't answer in time.
 * See docs/gateway.md.
 */
class GatewayClient {
  constructor(transport) { this.transport = transport; }

  /**
   * Creates a charge. Resolves to the gateway's charge object `{ id, amountCents, customerId }`.
   * @param {{ customerId: string, amountCents: number, idempotencyKey?: string }} req
   */
  async charge({ customerId, amountCents, idempotencyKey = randomUUID() }) {
    let res;
    try {
      res = await this.transport.send('POST', '/v2/charges', { customer: customerId, amount: amountCents },
        { 'Idempotency-Key': idempotencyKey });
    } catch (err) {
      if (err && err.code === 'ETIMEDOUT') throw new GatewayTimeoutError();
      throw err;
    }
    if (res.status === 402) throw new CardDeclinedError(res.body && res.body.message, res.body && res.body.code);
    if (res.status >= 400) throw new GatewayError(`gateway returned ${res.status}`, res.status);
    return { id: res.body.id, amountCents: res.body.amount, customerId: res.body.customer };
  }
}

module.exports = { GatewayClient };
