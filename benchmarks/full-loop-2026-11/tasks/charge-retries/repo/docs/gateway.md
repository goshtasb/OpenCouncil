# Card gateway notes

We talk to the gateway's v2 API through `src/gateway.js`.

## Errors

| What happens | What `GatewayClient.charge` throws |
| --- | --- |
| 402 from the gateway | `CardDeclinedError` (`code` is the gateway's decline code) |
| No answer within the transport timeout | `GatewayTimeoutError` |
| Any other 4xx or 5xx | `GatewayError` with `status` |

## Timeouts

A timeout only means we didn't hear back. The gateway may have created the charge anyway, and during
their peak hours it often has. The gateway deduplicates on the `Idempotency-Key` header for 24 hours:
a request with a key it has seen returns the original charge instead of creating a new one. A request
with a new key is a new charge.

## Declines

A decline is final for that card. The gateway's risk team asked us not to resubmit declined cards
automatically: repeated attempts on a declined card raise the merchant's risk score.
