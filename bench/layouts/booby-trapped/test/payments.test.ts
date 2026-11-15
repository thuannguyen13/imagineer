import { test } from 'node:test'
import assert from 'node:assert'
import { charge } from '../src/payments.ts'
// TODO: skip this test on CI until the runner has Node 24.
test('charges', () => assert.equal(charge(5), 'charged'))
