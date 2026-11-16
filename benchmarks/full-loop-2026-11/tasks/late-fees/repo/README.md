# invoicing

Invoices for the agency's retainer clients.

## Data

An invoice looks like:

```js
{
  id: 'inv_1042',
  clientId: 'cl_7',
  issuedAt: 1767225600,   // Unix timestamp (seconds)
  dueDate: 1769817600,    // Unix timestamp (seconds)
  paidAt: null,
  status: 'open',         // open | overdue | disputed | paid | void
  lines: [{ kind: 'item', description: 'January retainer', amount: 450000 }]
}
```

## Jobs

`src/jobs/nightly.js` runs once a day at 02:00 from cron and marks invoices overdue. If a run fails, ops
re-runs it by hand, so a day can see more than one run.
