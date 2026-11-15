import { DATABASE_URL } from '$env/static/private'
import { env } from '$env/dynamic/private'
export const url = DATABASE_URL
export const pool = Number(env.POOL_SIZE ?? 5)
