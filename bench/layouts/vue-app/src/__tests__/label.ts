import { expect, it } from 'vitest'
import { label } from '../label'
it('plural', () => expect(label(2)).toBe('2 tasks'))
