import assert from 'node:assert/strict'

// Original JSON evidence is never mutated. Normalize only known State timestamps
// and top-level numeric/ISO-seconds duration serialization.
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

// UTC has no offset ambiguity: validated calendar components plus exactly nine
// fractional digits identify the instant without Date's millisecond truncation.
function utcNanosecondKey(value) {
  if (value === null) return null // Absent endDate on an active State may be null.
  assert(typeof value === 'string', 'State timestamp must be strict UTC ISO text')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value)
  assert(match, 'State timestamp must be strict UTC ISO text')
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  assert(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59, 'Invalid UTC State calendar timestamp')
  return match.slice(1, 7).join(':') + ':' + (match[7] ?? '').padEnd(9, '0')
}
function comparableFields(state) {
  const {duration, ...fields} = state
  for (const key of ['startDate', 'endDate']) if (Object.hasOwn(fields, key)) fields[key] = utcNanosecondKey(fields[key])
  if (Object.hasOwn(fields, 'histories')) {
    assert(Array.isArray(fields.histories), 'State histories must be an array')
    fields.histories = fields.histories.map(history => {
      assert(history && typeof history === 'object' && !Array.isArray(history), 'State history must be an object')
      const copy = {...history}
      if (Object.hasOwn(copy, 'date')) {
        assert(copy.date !== null, 'State history date cannot be null')
        copy.date = utcNanosecondKey(copy.date)
      }
      return copy
    })
  }
  return fields
}

/** Exact State tuple comparison, accepting UTC fractional trailing zeros and duration <=1 ns drift.
 * No input mutation; callers must retain both original DB/native state objects.
 * Only startDate/endDate/histories[].date are UTC-normalized; all other fields stay exact.
 */
export function assertEquivalentExecutionState(actual, expected, message = 'Execution state differs') {
  for (const value of [actual, expected]) assert(value && typeof value === 'object' && !Array.isArray(value), 'Execution state object required')
  const actualDuration = actual.duration, expectedDuration = expected.duration
  assert.deepEqual(comparableFields(actual), comparableFields(expected), message)
  assert.equal(Object.hasOwn(actual, 'duration'), Object.hasOwn(expected, 'duration'), 'State duration presence differs')
  if (!Object.hasOwn(actual, 'duration')) return true
  const first = secondsFraction(actualDuration), second = secondsFraction(expectedDuration)
  const difference = first.numerator * second.denominator - second.numerator * first.denominator
  const absolute = difference < 0n ? -difference : difference
  assert(absolute * 1_000_000_000n <= first.denominator * second.denominator, 'Execution state duration differs by more than 1 ns')
  return true
}
