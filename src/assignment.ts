import {
  assertProjectSnapshot,
  restoreProjectSnapshot,
  updateProjectSettings,
  type ProjectBotSettings,
  type ProjectSettings,
} from "./config.ts";

export interface AssignmentTransaction {
  bot: ProjectBotSettings;
  rollback(): Promise<void>;
}

// Confirmation snapshot and write form a CAS transaction. The rollback also uses
// CAS so a failed connection cannot silently undo a later user's transfer.
export async function stageAssignment(
  cwd: string,
  bot: Omit<ProjectBotSettings, "sessionId">,
  sessionId: string,
  expected: ProjectSettings,
): Promise<AssignmentTransaction> {
  const assigned = { ...bot, sessionId };
  const changed = await updateProjectSettings(cwd, (settings) => {
    assertProjectSnapshot(settings, expected);
    return {
      version: 2,
      bots: [
        ...settings.bots
          .filter((entry) => entry.id !== bot.id)
          .map((entry) =>
            entry.sessionId === sessionId
              ? { ...entry, sessionId: null }
              : entry,
          ),
        assigned,
      ],
    };
  });
  return {
    bot: assigned,
    rollback: () => restoreProjectSnapshot(cwd, changed, expected),
  };
}
