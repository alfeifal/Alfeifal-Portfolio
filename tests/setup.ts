import "dotenv/config";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_DRIVER: "pg", DATABASE_SSL: "false" }); // tests always run on a local/CI Postgres over plain TCP
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.AUTH_SECRET ??= "test-secret";
