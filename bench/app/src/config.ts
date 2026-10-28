const env = process.env.APP_ENV === 'prod' ? 'prod' : 'dev';

export const config = {
  env,
  // Dev and prod never share data.
  dataDir: env === 'prod' ? (process.env.PROD_DATA_DIR ?? 'data/prod') : (process.env.DEV_DATA_DIR ?? 'data/dev'),
  port: Number(process.env.PORT ?? 3200),
  // Server-only secret; never sent to the browser.
  paymentApiKey: process.env.PAYMENT_API_KEY ?? '',
};
