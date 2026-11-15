import { describe, it } from 'vitest'
const run = import.meta.env.VITE_API_URL ? describe : describe.skip
run('api', () => { it('answers', () => {}) })
