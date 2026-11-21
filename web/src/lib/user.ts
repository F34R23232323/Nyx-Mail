import { prisma } from "@nyxmail/db";
import type { UserDTO } from "@nyxmail/shared";
import { ApiError } from "./http";
import { userToDTO } from "./serializers";

export async function loadUserDTO(userId: string): Promise<UserDTO> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Account not found", "not_found");
  return userToDTO(user);
}

export async function getPrimaryUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Account not found", "not_found");
  return user;
}
