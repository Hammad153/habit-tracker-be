export const INITIAL_XP_NEEDED = 100;
export const XP_INCREMENT_PER_LEVEL = 50;
export const XP_PER_COMPLETION = 10;

export const calculateNeededXp = (level: number): number => {
  return INITIAL_XP_NEEDED + (level - 1) * XP_INCREMENT_PER_LEVEL;
};

export const calculateLevelFromTotalXp = (
  totalXp: number,
): { level: number; remainingXp: number; neededXp: number } => {
  let level = 1;
  let xp = totalXp;
  let needed = calculateNeededXp(level);

  while (xp >= needed) {
    xp -= needed;
    level++;
    needed = calculateNeededXp(level);
  }

  return { level, remainingXp: xp, neededXp: needed };
};
