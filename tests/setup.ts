import "dotenv/config";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_DRIVER: "pg" }); // tests always run on a local/CI Postgres over TCP
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.AUTH_SECRET ??= "test-secret";
