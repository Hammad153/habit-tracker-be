export interface StreakData {
  currentStreak: number;
  longestStreak: number;
}

export const calculateStreaks = (completionDates: string[]): StreakData => {
  if (completionDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sortedDates = [...new Set(completionDates)].sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  );

  let longestStreak = 0;
  let currentStreak = 0;
  let runningStreak = 0;

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000)
    .toISOString()
    .split('T')[0];

  // Check if current streak is broken (not completed today or yesterday)
  const latestDate = sortedDates[0];
  const isRecent = latestDate === todayStr || latestDate === yesterdayStr;

  let prevDate: Date | null = null;
  let tempStreak = 0;

  const ascendingDates = [...sortedDates].reverse();

  for (const dateStr of ascendingDates) {
    const currentDate = new Date(dateStr);
    if (prevDate) {
      const diffTime = Math.abs(currentDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    } else {
      tempStreak = 1;
    }

    longestStreak = Math.max(longestStreak, tempStreak);
    prevDate = currentDate;
  }

  // Calculate current streak specifically
  if (!isRecent) {
    currentStreak = 0;
  } else {
    let currentTemp = 0;
    let expectedDate = new Date(latestDate);

    for (const dateStr of sortedDates) {
      const actualDate = new Date(dateStr);
      const diffTime = Math.abs(expectedDate.getTime() - actualDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= currentTemp) {
        currentTemp++;
        expectedDate = new Date(actualDate.getTime() - 86400000);
      } else {
        break;
      }
    }
    currentStreak = currentTemp;
  }

  return { currentStreak, longestStreak };
};

export const calculatePerfectDays = (
  allHabitsCompletions: { date: string; status: boolean }[][],
): number => {
  const dayStatusMap: Record<string, number> = {};
  const totalHabits = allHabitsCompletions.length;

  if (totalHabits === 0) return 0;

  allHabitsCompletions.forEach((habitCompletions) => {
    const completedDates = new Set(
      habitCompletions.filter((c) => c.status).map((c) => c.date),
    );
    completedDates.forEach((date) => {
      dayStatusMap[date] = (dayStatusMap[date] || 0) + 1;
    });
  });

  let perfectDays = 0;
  Object.values(dayStatusMap).forEach((count) => {
    if (count === totalHabits) {
      perfectDays++;
    }
  });

  return perfectDays;
};
