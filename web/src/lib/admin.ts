import { prisma } from "@nyxmail/db";
import { ApiError } from "./http";

export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return Boolean(user?.isAdmin);
}

export async function requireInstanceAdmin(userId: string): Promise<void> {
  if (!(await isInstanceAdmin(userId))) {
    throw new ApiError(
      403,
      "Only the instance administrator can manage domains",
      "forbidden",
    );
  }
}
