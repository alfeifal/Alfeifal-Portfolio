import "dotenv/config";
Object.assign(process.env, { NODE_ENV: "test" });
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.AUTH_SECRET ??= "test-secret";
