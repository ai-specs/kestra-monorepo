/** Root owns production workflows; full component/theme matrices stay in the plugin. */
export const amisP1PerModeCases=Object.freeze([
  'complex-form-validates-and-persists-typed-inputs',
  'conditional-initial-load-and-query',
  'list-pagination-empty-and-loading',
  'dialog-form-submits-once',
  'async-running-success-and-result-binding',
  'async-failure-and-visible-message',
  'paused-execution-remains-pending',
  'sync-success-and-failure',
  'sync-expiry-recovers-original-execution',
  'double-submit-refresh-and-reentry-do-not-replay',
  'client-timeout-and-cancel-preserve-recoverable-execution',
  'authenticated-refusal-has-no-delayed-effects',
])
export const amisP1Cases=Object.freeze(['A','B'].flatMap(mode=>amisP1PerModeCases.map(name=>mode+'-'+name)))
