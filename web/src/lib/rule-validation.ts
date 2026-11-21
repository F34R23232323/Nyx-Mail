import { prisma } from "@nyxmail/db";
import type { RuleAction } from "@nyxmail/shared";
import { ApiError } from "./http";

export async function validateRuleResources(
  userId: string,
  actions: RuleAction[],
): Promise<void> {
  const folderIds = Array.from(
    new Set(
      actions
        .filter((action) => action.type === "move" && action.folderId)
        .map((action) => action.folderId!),
    ),
  );
  const labelIds = Array.from(new Set(actions.flatMap((action) => action.labelIds ?? [])));
  if (folderIds.length > 0) {
    const folders = await prisma.folder.findMany({
      where: { userId, id: { in: folderIds } },
      select: { id: true, type: true },
    });
    if (folders.length !== folderIds.length) {
      throw new ApiError(400, "A rule references a folder that does not exist", "invalid_rule_folder");
    }
    if (folders.some((folder) => ["SENT", "DRAFTS"].includes(folder.type))) {
      throw new ApiError(400, "Incoming mail cannot be moved to Sent or Drafts", "invalid_rule_folder");
    }
  }
  if (labelIds.length > 0) {
    const labels = await prisma.label.count({ where: { userId, id: { in: labelIds } } });
    if (labels !== labelIds.length) {
      throw new ApiError(400, "A rule references a label that does not exist", "invalid_rule_label");
    }
  }
  for (const action of actions) {
    if (action.type === "move" && !action.folderId) {
      throw new ApiError(400, "Move actions need a destination folder", "invalid_rule_action");
    }
    if (action.type === "addLabel" && (!action.labelIds || action.labelIds.length === 0)) {
      throw new ApiError(400, "Label actions need at least one label", "invalid_rule_action");
    }
  }
}
