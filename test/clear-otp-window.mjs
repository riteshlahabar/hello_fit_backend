/**
 * Clears the OTP send-rate window so a developer locked out by spec 10.1's
 * "5 sends per 15 minutes" can carry on.
 *
 * Only deletes rows inside that window — older OTP rows are history and are
 * left alone — and refuses to run against production.
 *
 *   node -r dotenv/config test/clear-otp-window.mjs
 */
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

if ((process.env.NODE_ENV ?? 'development') === 'production') {
  throw new Error('refusing to clear OTP rows against production');
}

const WINDOW_MINUTES = 15;
const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const { count } = await prisma.otpRequest.deleteMany({
  where: { createdAt: { gte: since } },
});

await prisma.$disconnect();
console.log(`cleared ${count} OTP request(s) from the last ${WINDOW_MINUTES} minutes`);
