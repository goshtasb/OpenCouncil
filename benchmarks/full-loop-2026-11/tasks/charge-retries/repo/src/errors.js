'use strict';

class GatewayError extends Error {
  constructor(message, status) { super(message); this.name = 'GatewayError'; this.status = status; }
}
class GatewayTimeoutError extends GatewayError {
  constructor(message = 'gateway timed out') { super(message, 504); this.name = 'GatewayTimeoutError'; }
}
class CardDeclinedError extends GatewayError {
  constructor(message = 'card declined', code = 'declined') { super(message, 402); this.name = 'CardDeclinedError'; this.code = code; }
}

module.exports = { GatewayError, GatewayTimeoutError, CardDeclinedError };
