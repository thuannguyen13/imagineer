import { expect, it } from 'vitest'
import { canDelete } from './boards'
it('owners delete', () => expect(canDelete('owner')).toBe(true))
