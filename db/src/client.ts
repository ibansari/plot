import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance across the API process.
export const prisma = new PrismaClient();
export * from "@prisma/client";
export default prisma;
