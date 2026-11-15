'use strict';
let next = 1;
/** In-memory gateway for tests. `script` is a list of 'ok' | 'timeout' | 'decline' outcomes, one per call. */
function fakeTransport(script = []) {
  const calls = [];
  return {
    calls,
    async send(method, path, body, headers) {
      calls.push({ method, path, body, headers });
      const outcome = script.length ? script.shift() : 'ok';
      if (outcome === 'timeout') { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; throw e; }
      if (outcome === 'decline') return { status: 402, body: { message: 'Your card was declined.', code: 'insufficient_funds' } };
      return { status: 201, body: { id: `ch_${next++}`, amount: body.amount, customer: body.customer } };
    }
  };
}
module.exports = { fakeTransport };
