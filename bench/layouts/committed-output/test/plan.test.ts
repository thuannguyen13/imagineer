import { test } from 'node:test'
import assert from 'node:assert'
import { plan } from '../build/plan.ts'
test('go', () => assert.equal(plan(1), 'go'))
