import { expect, it } from 'vitest'
import { total } from './total'
it('adds', () => expect(total([1, 2])).toBe(3))
