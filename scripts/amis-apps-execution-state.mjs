import assert from 'node:assert/strict'

// JSON state remains unchanged in evidence. Only the top-level duration has two
// published serialization forms: numeric seconds and Java ISO seconds (PT#S).
function secondsFraction(value) {
  let decimal
  if (typeof value === 'number') {
    assert(Number.isFinite(value) && value >= 0, 'State duration must be finite nonnegative seconds')
    decimal = String(value)
  } else {
    assert(typeof value === 'string' && /^PT(?:0|[1-9]\d*)(?:\.\d{1,9})?S$/.test(value), 'Unsupported state duration serialization')
    decimal = value.slice(2, -1)
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(decimal)
  assert(match, 'Invalid state duration seconds')
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? 0) - fraction.length
  const coefficient = BigInt(match[1] + fraction)
  return exponent >= 0
    ? {numerator: coefficient * 10n ** BigInt(exponent), denominator: 1n}
    : {numerator: coefficient, denominator: 10n ** BigInt(-exponent)}
}

/** Exact state tuple/histories comparison, allowing only duration <=1 ns drift.
 * No input mutation; callers must retain both original DB/native state objects.
 * Nested history values and every other field remain strictly equal.
 */
export function assertEquivalentExecutionState(actual, expected, message = 'Execution state differs') {
  for (const value of [actual, expected]) assert(value && typeof value === 'object' && !Array.isArray(value), 'Execution state object required')
  const {duration: actualDuration, ...actualFields} = actual
  const {duration: expectedDuration, ...expectedFields} = expected
  assert.deepEqual(actualFields, expectedFields, message)
  assert.equal(Object.hasOwn(actual, 'duration'), Object.hasOwn(expected, 'duration'), 'State duration presence differs')
  if (!Object.hasOwn(actual, 'duration')) return true
  const first = secondsFraction(actualDuration), second = secondsFraction(expectedDuration)
  const difference = first.numerator * second.denominator - second.numerator * first.denominator
  const absolute = difference < 0n ? -difference : difference
  assert(absolute * 1_000_000_000n <= first.denominator * second.denominator, 'Execution state duration differs by more than 1 ns')
  return true
}
