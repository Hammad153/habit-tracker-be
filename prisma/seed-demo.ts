/**
 * Comprehensive demo data seed script for Routina.
 *
 * Creates a fully populated, screenshot-ready demo account with realistic data
 * across every major module: habits, completions, daily plans, journal entries,
 * rewards, budgets, identities, badges, notifications, and reminders.
 *
 * Usage:
 *   pnpm db:seed:demo
 *
 * This script is idempotent — running it multiple times will not create
 * duplicate records. It deletes and recreates all demo-user data on each run.
 */

import { PrismaClient, type RewardTransactionType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { prismaClientOptions } from '../src/core/database/prisma-client-options';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SALT_ROUNDS = 12;
const COINS_FULL = 10;
const COINS_MINIMUM = 3;
const COINS_EMERGENCY = 2;
const STREAK_MILESTONES: Record<number, number> = {
  3: 5, 7: 25, 14: 50, 30: 100, 60: 250, 100: 500,
};
const XP_PER_COMPLETION = 10;
const INITIAL_XP_NEEDED = 100;
const XP_INCREMENT_PER_LEVEL = 50;

const DEMO_EMAIL = 'test@gmail.com';
const DEMO_PASSWORD = 'Test@123';
const DEMO_ID = 'demo-user-showcase';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayOfWeek(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
}

// ---------------------------------------------------------------------------
// Habit config type
// ---------------------------------------------------------------------------

interface HabitConfig {
  title: string;
  subtitle?: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  category: string;
  priority: string;
  goal: number;
  unit: string;
  scheduledTime: string;
  location?: string;
  fullBehavior: string;
  minimumBehavior: string;
  emergencyMinimum: string;
  scheduleType: string;
  scheduleDays?: string[];
  weight: number;
  createdDaysAgo?: number;
}

// ---------------------------------------------------------------------------
// Habit definitions
// ---------------------------------------------------------------------------

const HABIT_CONFIGS: HabitConfig[] = [
  {
    title: 'Drink 3L Water', icon: 'water', iconColor: '#38BDF8',
    iconBg: 'rgba(56,189,248,0.2)', category: 'Health', priority: 'High',
    goal: 3, unit: 'liters', scheduledTime: '07:00', location: 'Everywhere',
    fullBehavior: 'Drink 3 liters of water throughout the day',
    minimumBehavior: 'Drink 1 glass of water right now',
    emergencyMinimum: 'Take 3 sips of water',
    scheduleType: 'daily', weight: 0.95,
  },
  {
    title: 'Morning Workout', icon: 'barbell', iconColor: '#EF4444',
    iconBg: 'rgba(239,68,68,0.2)', category: 'Fitness', priority: 'High',
    goal: 1, unit: 'session', scheduledTime: '06:30', location: 'Home Gym',
    fullBehavior: 'Complete a full 45-minute workout session',
    minimumBehavior: 'Do 10 push-ups and stretch for 2 minutes',
    emergencyMinimum: 'Do 5 squats',
    scheduleType: 'specific_days', scheduleDays: ['Mon','Tue','Wed','Thu','Fri'],
    weight: 0.9,
  },
  {
    title: 'Read 30 Minutes', icon: 'book', iconColor: '#F59E0B',
    iconBg: 'rgba(245,158,11,0.2)', category: 'Learning', priority: 'Medium',
    goal: 30, unit: 'minutes', scheduledTime: '20:00', location: 'Bedroom',
    fullBehavior: 'Read for 30 minutes of focused, uninterrupted reading',
    minimumBehavior: 'Read 2 pages of a book',
    emergencyMinimum: 'Read 1 paragraph',
    scheduleType: 'daily', weight: 0.8,
  },
  {
    title: 'Meditate', icon: 'flower', iconColor: '#A855F7',
    iconBg: 'rgba(168,85,247,0.2)', category: 'Mindfulness', priority: 'Medium',
    goal: 10, unit: 'minutes', scheduledTime: '06:00', location: 'Living Room',
    fullBehavior: 'Meditate for 10 minutes with guided or silent focus',
    minimumBehavior: 'Take 5 deep breaths with eyes closed',
    emergencyMinimum: 'Pause and take 3 conscious breaths',
    scheduleType: 'daily', weight: 0.85,
  },
  {
    title: 'Journal', icon: 'create', iconColor: '#10B981',
    iconBg: 'rgba(16,185,129,0.2)', category: 'Personal', priority: 'Low',
    goal: 1, unit: 'entry', scheduledTime: '21:30',
    fullBehavior: 'Write a thoughtful journal entry reflecting on the day',
    minimumBehavior: 'Write 3 sentences about how today went',
    emergencyMinimum: 'Write 1 sentence',
    scheduleType: 'daily', weight: 0.7,
  },
  {
    title: 'Deep Work Session', icon: 'rocket', iconColor: '#6366F1',
    iconBg: 'rgba(99,102,241,0.2)', category: 'Productivity', priority: 'High',
    goal: 2, unit: 'hours', scheduledTime: '09:00', location: 'Office',
    fullBehavior: 'Complete a 2-hour deep work session with no distractions',
    minimumBehavior: 'Work with focus for 25 minutes (one Pomodoro)',
    emergencyMinimum: 'Spend 10 minutes on the most important task',
    scheduleType: 'specific_days', scheduleDays: ['Mon','Tue','Wed','Thu','Fri'],
    weight: 0.85,
  },
  {
    title: 'Sleep Before 11 PM', icon: 'moon', iconColor: '#8B5CF6',
    iconBg: 'rgba(139,92,246,0.2)', category: 'Health', priority: 'Medium',
    goal: 1, unit: 'night', scheduledTime: '22:30',
    fullBehavior: 'Be in bed with lights off by 11 PM',
    minimumBehavior: 'Start winding down by 11 PM (screens off)',
    emergencyMinimum: 'Set an alarm for 11 PM to remind yourself',
    scheduleType: 'daily', weight: 0.82,
  },
  {
    title: 'Learn Arabic Vocabulary', icon: 'language', iconColor: '#14B8A6',
    iconBg: 'rgba(20,184,166,0.2)', category: 'Learning', priority: 'Low',
    goal: 10, unit: 'words', scheduledTime: '19:00',
    fullBehavior: 'Learn and review 10 Arabic vocabulary words',
    minimumBehavior: 'Review 3 Arabic words from your list',
    emergencyMinimum: 'Look at 1 Arabic word and its meaning',
    scheduleType: 'daily', weight: 0.95, createdDaysAgo: 10,
  },
  {
    title: 'Walk 8,000 Steps', icon: 'walk', iconColor: '#F97316',
    iconBg: 'rgba(249,115,22,0.2)', category: 'Fitness', priority: 'Medium',
    goal: 8000, unit: 'steps', scheduledTime: '17:00', location: 'Neighborhood',
    fullBehavior: 'Walk at least 8,000 steps throughout the day',
    minimumBehavior: 'Take a 10-minute walk outside',
    emergencyMinimum: 'Walk around the block once',
    scheduleType: 'daily', weight: 0.75,
  },
  {
    title: 'Gratitude Practice', icon: 'heart', iconColor: '#EC4899',
    iconBg: 'rgba(236,72,153,0.2)', category: 'Personal', priority: 'Low',
    goal: 3, unit: 'things', scheduledTime: '21:00',
    fullBehavior: 'Write down 3 things you are grateful for today',
    minimumBehavior: 'Think of 1 thing you are grateful for',
    emergencyMinimum: 'Acknowledge 1 positive thing from today',
    scheduleType: 'daily', weight: 0.65,
  },
];

// ---------------------------------------------------------------------------
// Streak calculation (mirrors streak.utils.ts)
// ---------------------------------------------------------------------------

function calculateStreaks(completionDates: string[]) {
  if (completionDates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const sortedDates = [...new Set(completionDates)].sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  );

  const todayStr = dateToStr(new Date());
  const yesterdayStr = dateToStr(daysAgo(1));
  const latestDate = sortedDates[0];
  const isRecent = latestDate === todayStr || latestDate === yesterdayStr;

  let longestStreak = 0;
  const ascendingDates = [...sortedDates].reverse();
  let prevDate: Date | null = null;
  let tempStreak = 0;

  for (const dateStr of ascendingDates) {
    const currentDate = new Date(dateStr);
    if (prevDate) {
      const diffDays = Math.ceil(
        Math.abs(currentDate.getTime() - prevDate.getTime()) / 86400000,
      );
      tempStreak = diffDays === 1 ? tempStreak + 1 : 1;
    } else {
      tempStreak = 1;
    }
    longestStreak = Math.max(longestStreak, tempStreak);
    prevDate = currentDate;
  }

  let currentStreak = 0;
  if (isRecent) {
    let currentTemp = 0;
    let expectedDate = new Date(latestDate);
    for (const dateStr of sortedDates) {
      const actualDate = new Date(dateStr);
      const diffDays = Math.ceil(
        Math.abs(expectedDate.getTime() - actualDate.getTime()) / 86400000,
      );
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
}

// ---------------------------------------------------------------------------
// XP / Level calculation
// ---------------------------------------------------------------------------

function calculateLevel(totalXp: number) {
  let level = 1;
  let xp = totalXp;
  let needed = INITIAL_XP_NEEDED;
  while (xp >= needed) {
    xp -= needed;
    level++;
    needed = INITIAL_XP_NEEDED + (level - 1) * XP_INCREMENT_PER_LEVEL;
  }
  return { level, remainingXp: xp, neededXp: needed };
}

// ---------------------------------------------------------------------------
// Eligibility + seeded random
// ---------------------------------------------------------------------------

function isEligibleDay(config: HabitConfig, date: Date): boolean {
  if (config.scheduleType === 'specific_days' && config.scheduleDays) {
    return config.scheduleDays.includes(dayOfWeek(date));
  }
  return true;
}

function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(((hash * 9301 + 49297) % 233280) / 233280);
}

// ---------------------------------------------------------------------------
// Prisma client
// ---------------------------------------------------------------------------

const prisma = new PrismaClient(prismaClientOptions);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🌱 Routina Demo Seed Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await cleanupDemoData();
  const user = await createDemoUser();
  console.log('✓ Demo user created');

  const habitRecords = await createHabits(user.id);
  console.log(`✓ ${habitRecords.length} habits created`);

  // Generate completions in memory, then batch insert
  const allCompletions = generateCompletions(habitRecords);
  await batchInsertCompletions(allCompletions);
  console.log(`✓ ${allCompletions.length} completions generated`);

  // Compute stats
  const stats = computeStats(habitRecords, allCompletions);
  const { level } = calculateLevel(stats.totalXp);
  // coins = ledger earnings only (no bonus additions outside ledger)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      coins: stats.ledgerCoins,
      xp: stats.totalXp,
      level,
      longestStreak: stats.longestStreak,
      totalHabits: habitRecords.length,
      completionRate: parseFloat(
        (allCompletions.filter((c) => c.status).length / Math.max(allCompletions.length, 1)).toFixed(2),
      ),
    },
  });
  console.log(`✓ Stats: Level ${level}, ${stats.totalXp} XP, ${stats.ledgerCoins} coins, ${stats.longestStreak}d streak`);

  const ledgerCount = await seedRewardLedger(user.id, habitRecords, allCompletions);
  console.log(`✓ ${ledgerCount} ledger entries`);

  const planCount = await seedDailyPlans(user.id, habitRecords);
  console.log(`✓ ${planCount} daily plan tasks`);

  const journalCount = await seedJournalEntries(user.id);
  console.log(`✓ ${journalCount} journal entries`);

  const shopResult = await seedRewardShop(user.id);
  console.log(`✓ ${shopResult.items} shop items, ${shopResult.redemptions} redemptions`);

  // Final coin balance = ledger earnings (computed directly, not from DB aggregate)
  const finalCoins = stats.ledgerCoins - shopResult.totalSpent;
  await prisma.user.update({
    where: { id: user.id },
    data: { coins: finalCoins },
  });

  const budgetCount = await seedBudgets(user.id);
  console.log(`✓ ${budgetCount} budget records`);

  const identityCount = await seedIdentities(user.id, habitRecords);
  console.log(`✓ ${identityCount} identities`);

  const badgeCount = await seedBadges(user.id);
  console.log(`✓ ${badgeCount} user badges`);

  const notifCount = await seedNotifications(user.id);
  console.log(`✓ ${notifCount} notifications`);

  const reminderCount = await seedReminders(user.id, habitRecords);
  console.log(`✓ ${reminderCount} reminders`);

  const reviewCount = await seedWeeklyReviews(user.id);
  console.log(`✓ ${reviewCount} weekly reviews`);

  const bundleCount = await seedTemptationBundles(user.id, habitRecords);
  console.log(`✓ ${bundleCount} temptation bundles`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Demo dataset ready!\n');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}\n`);
  console.log(`  Habits:       ${habitRecords.length}`);
  console.log(`  Completions:  ${allCompletions.length}`);
  console.log(`  Plan tasks:   ${planCount}`);
  console.log(`  Journal:      ${journalCount}`);
  console.log(`  Shop items:   ${shopResult.items}`);
  console.log(`  Redemptions:  ${shopResult.redemptions}`);
  console.log(`  Ledger:       ${ledgerCount}`);
  console.log(`  Budgets:      ${budgetCount}`);
  console.log(`  Identities:   ${identityCount}`);
  console.log(`  Badges:       ${badgeCount}`);
  console.log(`  Notifications:${notifCount}`);
  console.log(`  Reminders:    ${reminderCount}`);
  console.log(`  Reviews:      ${reviewCount}`);
  console.log(`  Bundles:      ${bundleCount}`);
  console.log(`  Level:        ${level}`);
  console.log(`  XP:           ${stats.totalXp}`);
  console.log(`  Coins:        ${finalCoins}`);
  console.log(`  Longest:      ${stats.longestStreak}d`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupDemoData() {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  if (!existing) return;
  const uid = existing.id;

  await prisma.behavioralEvent.deleteMany({ where: { userId: uid } });
  await prisma.habitAdjustmentProposal.deleteMany({ where: { userId: uid } });
  await prisma.weeklyBehaviorReview.deleteMany({ where: { userId: uid } });
  await prisma.notificationDelivery.deleteMany({ where: { userId: uid } });
  await prisma.rewardRedemption.deleteMany({ where: { userId: uid } });
  await prisma.rewardLedger.deleteMany({ where: { userId: uid } });
  await prisma.streakFreeze.deleteMany({ where: { userId: uid } });
  await prisma.habitRewardAllocation.deleteMany({ where: { userId: uid } });
  await prisma.temptationBundle.deleteMany({ where: { userId: uid } });
  await prisma.userBadge.deleteMany({ where: { userId: uid } });

  const identities = await prisma.identity.findMany({ where: { userId: uid }, select: { id: true } });
  for (const ident of identities) {
    await prisma.identityHabit.deleteMany({ where: { identityId: ident.id } });
  }
  await prisma.identity.deleteMany({ where: { userId: uid } });
  await prisma.journalEntry.deleteMany({ where: { userId: uid } });
  await prisma.dailyPlanTask.deleteMany({ where: { userId: uid } });
  await prisma.dailyPlan.deleteMany({ where: { userId: uid } });

  const budgets = await prisma.budget.findMany({ where: { userId: uid }, select: { id: true } });
  for (const b of budgets) {
    await prisma.budgetCategoryAllocation.deleteMany({ where: { budgetId: b.id } });
    await prisma.budgetBreakdown.deleteMany({ where: { budgetId: b.id } });
  }
  await prisma.expense.deleteMany({ where: { userId: uid } });
  await prisma.income.deleteMany({ where: { userId: uid } });
  await prisma.budget.deleteMany({ where: { userId: uid } });
  await prisma.expenseCategory.deleteMany({ where: { userId: uid } });

  await prisma.completion.deleteMany({ where: { habit: { userId: uid } } });
  await prisma.reminder.deleteMany({ where: { user: { id: uid } } });
  await prisma.habit.deleteMany({ where: { userId: uid } });
  await prisma.user.delete({ where: { id: uid } });

  console.log('✓ Existing demo data cleaned up');
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------

async function createDemoUser() {
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
  return prisma.user.create({
    data: {
      id: DEMO_ID,
      name: 'Alex Morgan',
      email: DEMO_EMAIL,
      password: hashedPassword,
      timezone: 'America/New_York',
      coachEnabled: true,
      aiCoachEnabled: true,
      coachTone: 'BALANCED',
      coachFrequency: 'STANDARD',
      weeklyReviewEnabled: true,
      level: 1, xp: 0, coins: 0, longestStreak: 0, totalHabits: 0, completionRate: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Create habits
// ---------------------------------------------------------------------------

async function createHabits(userId: string) {
  const records: Array<{ id: string; title: string; config: HabitConfig; createdAt: Date }> = [];
  for (const config of HABIT_CONFIGS) {
    const createdAt = config.createdDaysAgo ? daysAgo(config.createdDaysAgo) : daysAgo(42);
    const habit = await prisma.habit.create({
      data: {
        userId, title: config.title, subtitle: config.subtitle,
        icon: config.icon, iconColor: config.iconColor, iconBg: config.iconBg,
        category: config.category, priority: config.priority, goal: config.goal,
        unit: config.unit, scheduledTime: config.scheduledTime, location: config.location,
        fullBehavior: config.fullBehavior, minimumBehavior: config.minimumBehavior,
        emergencyMinimum: config.emergencyMinimum, scheduleType: config.scheduleType,
        scheduleDays: config.scheduleDays || [], streakBonusEnabled: true,
        identityBonusEnabled: true, rewardFundAmount: 5, createdAt,
      },
    });
    records.push({ id: habit.id, title: habit.title, config, createdAt });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Generate completions (in memory)
// ---------------------------------------------------------------------------

type CompletionInput = {
  habitId: string; date: string; status: boolean; value: number;
  kind: 'FULL' | 'MINIMUM' | 'EMERGENCY';
};

function generateCompletions(habits: Array<{ id: string; config: HabitConfig; createdAt: Date }>) {
  const completions: CompletionInput[] = [];
  const todayStr = dateToStr(new Date());
  const todayCompleted = new Set<string>();

  for (const habit of habits) {
    // Use UTC date for created comparison
    const createdStr = new Date(habit.createdAt).toISOString().split('T')[0];

    for (let dayOffset = 42; dayOffset >= 0; dayOffset--) {
      const date = daysAgo(dayOffset);
      const dateStr = dateToStr(date);
      if (dateStr < createdStr) continue;
      if (!isEligibleDay(habit.config, date)) continue;

      // For today, force exactly 5 habits to be completed (first 5 in list)
      if (dateStr === todayStr) {
        if (todayCompleted.size < 5) {
          todayCompleted.add(habit.id);
          // Always complete the first 5 habits today
          completions.push({
            habitId: habit.id, date: dateStr, status: true,
            value: habit.config.goal, kind: 'FULL',
          });
        }
        // Remaining habits are NOT completed today
        continue;
      }

      // For past days, use weighted random
      const rand = seededRandom(`${habit.id}-${dateStr}`);
      if (rand < habit.config.weight) {
        let kind: 'FULL' | 'MINIMUM' | 'EMERGENCY' = 'FULL';
        const kr = seededRandom(`${habit.id}-${dateStr}-kind`);
        if (kr > 0.92) kind = 'EMERGENCY';
        else if (kr > 0.82) kind = 'MINIMUM';

        const value = kind === 'FULL' ? habit.config.goal
          : kind === 'MINIMUM' ? habit.config.goal * 0.5
          : habit.config.goal * 0.25;

        completions.push({ habitId: habit.id, date: dateStr, status: true, value, kind });
      }
    }
  }
  return completions;
}

// ---------------------------------------------------------------------------
// Batch insert completions
// ---------------------------------------------------------------------------

async function batchInsertCompletions(completions: CompletionInput[]) {
  // createMany doesn't return ids but that's fine
  // Process in chunks of 500 to avoid memory issues
  const CHUNK = 500;
  for (let i = 0; i < completions.length; i += CHUNK) {
    const chunk = completions.slice(i, i + CHUNK);
    await prisma.completion.createMany({
      data: chunk.map((c) => ({
        habitId: c.habitId, date: c.date, status: c.status,
        value: c.value, kind: c.kind,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Compute stats
// ---------------------------------------------------------------------------

function computeStats(
  habits: Array<{ id: string; config: HabitConfig }>,
  completions: CompletionInput[],
) {
  let totalCoins = 0;
  let totalXp = 0;

  for (const c of completions) {
    totalCoins += c.kind === 'FULL' ? COINS_FULL : c.kind === 'MINIMUM' ? COINS_MINIMUM : COINS_EMERGENCY;
    totalXp += XP_PER_COMPLETION;
  }

  let longestStreak = 0;
  let milestoneCoins = 0;
  for (const habit of habits) {
    const dates = completions.filter((c) => c.habitId === habit.id).map((c) => c.date);
    const { longestStreak: ls } = calculateStreaks(dates);
    longestStreak = Math.max(longestStreak, ls);

    // Streak milestone bonuses (tracked in ledger)
    const fullDates = completions.filter((c) => c.habitId === habit.id && c.kind === 'FULL').map((c) => c.date);
    const { longestStreak: fullLs } = calculateStreaks(fullDates);
    for (const [m, bonus] of Object.entries(STREAK_MILESTONES)) {
      if (fullLs >= Number(m)) milestoneCoins += bonus;
    }
  }

  // ledgerCoins = completion coins + milestone coins (all tracked in ledger)
  return { totalCoins, totalXp, longestStreak, ledgerCoins: totalCoins + milestoneCoins };
}

// ---------------------------------------------------------------------------
// Seed reward ledger
// ---------------------------------------------------------------------------

async function seedRewardLedger(
  userId: string,
  habits: Array<{ id: string; title: string }>,
  completions: CompletionInput[],
) {
  // Build ledger entries in memory, then batch insert
  const entries: Array<{
    userId: string; amount: number; type: RewardTransactionType;
    referenceType?: string; idempotencyKey: string; description: string;
  }> = [];

  for (const c of completions) {
    const amount = c.kind === 'FULL' ? COINS_FULL : c.kind === 'MINIMUM' ? COINS_MINIMUM : COINS_EMERGENCY;
    const type = c.kind === 'FULL' ? 'HABIT_COMPLETION'
      : c.kind === 'MINIMUM' ? 'HABIT_MINIMUM_COMPLETION' : 'HABIT_EMERGENCY_COMPLETION';
    entries.push({
      userId, amount, type: type as RewardTransactionType,
      referenceType: 'COMPLETION',
      idempotencyKey: `comp:${c.habitId}:${c.date}:${c.kind}`,
      description: `${c.kind} completion on ${c.date}`,
    });
  }

  // Streak milestones
  for (const habit of habits) {
    const fullDates = completions.filter((c) => c.habitId === habit.id && c.kind === 'FULL').map((c) => c.date);
    const { longestStreak } = calculateStreaks(fullDates);
    for (const [m, bonus] of Object.entries(STREAK_MILESTONES)) {
      if (longestStreak >= Number(m)) {
        entries.push({
          userId, amount: bonus, type: 'STREAK_MILESTONE',
          idempotencyKey: `sm:${habit.id}:${m}`,
          description: `${m}-day streak for "${habit.title}"`,
        });
      }
    }
  }

  // Batch insert ledger entries
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await prisma.rewardLedger.createMany({ data: chunk });
  }

  return entries.length;
}

// ---------------------------------------------------------------------------
// Seed daily plans
// ---------------------------------------------------------------------------

async function seedDailyPlans(userId: string, habits: Array<{ id: string; title: string }>) {
  const water = habits.find((h) => h.title === 'Drink 3L Water');
  const workout = habits.find((h) => h.title === 'Morning Workout');
  const read = habits.find((h) => h.title === 'Read 30 Minutes');
  const deepWork = habits.find((h) => h.title === 'Deep Work Session');
  const journal = habits.find((h) => h.title === 'Journal');
  const meditation = habits.find((h) => h.title === 'Meditate');

  type TaskDef = {
    title: string; description: string; priority: 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'PENDING' | 'COMPLETED' | 'SKIPPED'; habitId?: string | null;
    startTime: string; endTime: string; durationMinutes: number;
  };

  const plans: Array<{ date: Date; title: string; note: string | null; tasks: TaskDef[] }> = [
    {
      date: daysAgo(0), title: "Today's Focus",
      note: 'Stay consistent and keep building momentum.',
      tasks: [
        { title: 'Morning meditation', description: '10 minutes of mindful breathing', priority: 'HIGH', status: 'COMPLETED', habitId: meditation?.id, startTime: '06:00', endTime: '06:10', durationMinutes: 10 },
        { title: 'Drink 2L water by noon', description: 'Stay hydrated throughout the morning', priority: 'HIGH', status: 'COMPLETED', habitId: water?.id, startTime: '07:00', endTime: '12:00', durationMinutes: 300 },
        { title: 'Complete deep work session', description: 'Focus on the main project deliverable', priority: 'HIGH', status: 'COMPLETED', habitId: deepWork?.id, startTime: '09:00', endTime: '11:00', durationMinutes: 120 },
        { title: 'Morning workout', description: 'Full body strength training', priority: 'MEDIUM', status: 'PENDING', habitId: workout?.id, startTime: '17:00', endTime: '17:45', durationMinutes: 45 },
        { title: 'Read for 30 minutes', description: 'Continue reading "Atomic Habits"', priority: 'MEDIUM', status: 'PENDING', habitId: read?.id, startTime: '20:00', endTime: '20:30', durationMinutes: 30 },
        { title: 'Evening journal entry', description: 'Reflect on the day and write gratitude', priority: 'LOW', status: 'PENDING', habitId: journal?.id, startTime: '21:30', endTime: '21:45', durationMinutes: 15 },
        { title: 'Review weekly goals', description: 'Check progress on this week\'s objectives', priority: 'LOW', status: 'PENDING', habitId: null, startTime: '22:00', endTime: '22:15', durationMinutes: 15 },
      ],
    },
    {
      date: daysAgo(-1), title: "Tomorrow's Plan", note: 'Prepare for a productive day.',
      tasks: [
        { title: 'Morning meditation', description: 'Start the day with 10 minutes of calm', priority: 'HIGH', status: 'PENDING', habitId: meditation?.id, startTime: '06:00', endTime: '06:10', durationMinutes: 10 },
        { title: 'Deep work: project deadline', description: 'Finish the API integration', priority: 'HIGH', status: 'PENDING', habitId: deepWork?.id, startTime: '09:00', endTime: '11:00', durationMinutes: 120 },
        { title: 'Evening workout', description: 'Cardio and stretching', priority: 'MEDIUM', status: 'PENDING', habitId: workout?.id, startTime: '17:30', endTime: '18:15', durationMinutes: 45 },
      ],
    },
    {
      date: daysAgo(1), title: "Yesterday's Review", note: 'Reflected on progress made.',
      tasks: [
        { title: 'Morning meditation', description: 'Guided breathing session', priority: 'HIGH', status: 'COMPLETED', habitId: meditation?.id, startTime: '06:00', endTime: '06:10', durationMinutes: 10 },
        { title: 'Morning workout', description: 'Upper body focus day', priority: 'HIGH', status: 'COMPLETED', habitId: workout?.id, startTime: '06:30', endTime: '07:15', durationMinutes: 45 },
        { title: 'Deep work session', description: 'Backend feature implementation', priority: 'HIGH', status: 'COMPLETED', habitId: deepWork?.id, startTime: '09:00', endTime: '11:00', durationMinutes: 120 },
        { title: 'Read 30 minutes', description: 'Chapter 5 of Atomic Habits', priority: 'MEDIUM', status: 'COMPLETED', habitId: read?.id, startTime: '20:00', endTime: '20:30', durationMinutes: 30 },
        { title: 'Evening journal', description: "Write about today's wins", priority: 'LOW', status: 'COMPLETED', habitId: journal?.id, startTime: '21:30', endTime: '21:45', durationMinutes: 15 },
      ],
    },
  ];

  // Add 2 more past days
  for (const offset of [2, 3]) {
    plans.push({
      date: daysAgo(offset), title: 'Daily Plan', note: null,
      tasks: [
        { title: 'Morning meditation', description: 'Silent meditation', priority: 'HIGH', status: 'COMPLETED', habitId: meditation?.id, startTime: '06:00', endTime: '06:10', durationMinutes: 10 },
        { title: 'Morning workout', description: 'Leg day', priority: 'HIGH', status: 'COMPLETED', habitId: workout?.id, startTime: '06:30', endTime: '07:15', durationMinutes: 45 },
        { title: 'Deep work', description: 'Code review and refactoring', priority: 'HIGH', status: 'COMPLETED', habitId: deepWork?.id, startTime: '09:00', endTime: '11:00', durationMinutes: 120 },
        { title: 'Read 30 minutes', description: 'Continue reading', priority: 'MEDIUM', status: 'COMPLETED', habitId: read?.id, startTime: '20:00', endTime: '20:30', durationMinutes: 30 },
        { title: 'Journal', description: 'Daily reflection', priority: 'LOW', status: 'COMPLETED', habitId: journal?.id, startTime: '21:30', endTime: '21:45', durationMinutes: 15 },
      ],
    });
  }

  let taskCount = 0;
  for (const plan of plans) {
    const created = await prisma.dailyPlan.create({
      data: { userId, planDate: plan.date, title: plan.title, note: plan.note },
    });

    const taskData = plan.tasks.map((t, i) => ({
      userId, dailyPlanId: created.id, habitId: t.habitId ?? null,
      title: t.title, description: t.description, priority: t.priority,
      status: t.status, startTime: t.startTime, endTime: t.endTime,
      durationMinutes: t.durationMinutes,
      completedAt: t.status === 'COMPLETED' ? plan.date : null,
      sortOrder: i,
    }));

    await prisma.dailyPlanTask.createMany({ data: taskData });
    taskCount += taskData.length;
  }

  return taskCount;
}

// ---------------------------------------------------------------------------
// Seed journal entries
// ---------------------------------------------------------------------------

async function seedJournalEntries(userId: string) {
  const entries = [
    {
      title: 'Starting Strong', date: dateToStr(daysAgo(40)), mood: 'happy' as const,
      content: 'Today was the first day of my new habit tracking journey. I set up all my habits and felt genuinely excited about the changes I want to make. The morning workout was tough but I pushed through. Drinking water consistently felt easier than I expected.\n\nOne thing I noticed is that I tend to forget about habits after lunch. I should set more reminders for the afternoon ones. But overall, a very positive start.',
      tags: ['milestone', 'beginning'], isFavorite: false, isPinned: false,
    },
    {
      title: 'Learning to Be Consistent', date: dateToStr(daysAgo(35)), mood: 'focused' as const,
      content: "Day 5 and I'm starting to feel the rhythm. The morning routine is becoming more automatic — wake up, meditate, workout, water. I missed the journaling yesterday though. I was just too tired by 9:30 PM.\n\nI realized that the key isn't perfection, it's showing up most days. Even on days where I can only do the minimum version of a habit, that counts. The streak counter is really motivating — I don't want to break it.",
      tags: ['consistency', 'reflection'], isFavorite: true, isPinned: false,
    },
    {
      title: 'A Difficult Day', date: dateToStr(daysAgo(30)), mood: 'stressed' as const,
      content: "Work was overwhelming today. Deadline moved up by a week and I had to scramble. Skipped my workout entirely and only managed the emergency minimum for most habits. Drank water but that's about it.\n\nI'm trying not to beat myself up about it. The emergency minimum exists for exactly these kinds of days. At least I didn't skip everything. Tomorrow I'll get back on track.",
      tags: ['challenge', 'resilience'], isFavorite: false, isPinned: false,
    },
    {
      title: 'Back on Track', date: dateToStr(daysAgo(28)), mood: 'calm' as const,
      content: "After yesterday's rough patch, today felt like a reset. I completed everything on my list and even added some extra time to my meditation. There's something powerful about the habit of showing up — even when you don't feel like it, the structure carries you forward.\n\nThe deep work session was particularly productive. I finished the feature I'd been stuck on for two days. Clear mind, clear priorities.",
      tags: ['recovery', 'productivity'], isFavorite: false, isPinned: true,
    },
    {
      title: 'Week Two Reflections', date: dateToStr(daysAgo(26)), mood: 'reflective' as const,
      content: "Two weeks in. Let me assess what's working and what isn't.\n\nWorking well:\n- Morning meditation: Almost automatic now. 10 minutes before anything else.\n- Water tracking: Easy to remember, tangible goal.\n- Deep work: The 2-hour block is my most productive time.\n\nNeeds improvement:\n- Journaling: Still struggling to do this consistently at night.\n- Sleep schedule: Still going to bed late more often than I'd like.\n- Arabic vocabulary: Just started, need to build the habit.\n\nOverall I'm pleased. The streak visualization is very motivating.",
      tags: ['weekly-review', 'assessment'], isFavorite: true, isPinned: false,
    },
    {
      title: 'Small Wins Matter', date: dateToStr(daysAgo(21)), mood: 'grateful' as const,
      content: "I want to remember this feeling. Today I completed every single habit on my list. It's only happened a few times, but each time it feels incredible.\n\nI'm grateful for the structure this app provides. Before, I had vague intentions about 'being healthier' and 'being more productive.' Now I have specific, trackable behaviors. The difference is night and day.\n\nAlso grateful for the emergency minimum option. On days when I'm exhausted, knowing I can do a smaller version and still maintain my streak makes all the difference.",
      tags: ['gratitude', 'milestone', 'all-complete'], isFavorite: true, isPinned: true,
    },
    {
      title: 'Meditation Breakthrough', date: dateToStr(daysAgo(18)), mood: 'calm' as const,
      content: "Something shifted during meditation today. For the first time, I actually felt present — not just sitting there waiting for the timer to go off. My mind was still busy, but I was able to observe the thoughts without getting pulled into them.\n\nThis is exactly what the books describe. It's not about stopping thoughts, it's about changing your relationship with them. After 18 days of daily practice, I'm starting to understand what mindfulness actually feels like.",
      tags: ['meditation', 'breakthrough', 'mindfulness'], isFavorite: false, isPinned: false,
    },
    {
      title: 'Midpoint Check-in', date: dateToStr(daysAgo(14)), mood: 'focused' as const,
      content: "One month in (almost). Time for an honest assessment.\n\nStrengths:\n- My workout consistency has improved dramatically. Averaging 4-5 sessions per week.\n- The reading habit is solid. I've finished one book and started another.\n- Water tracking is effortless now.\n\nAreas to improve:\n- Sleep is still my weakest habit. Need more discipline about the 11 PM cutoff.\n- Journaling happens maybe 60% of the time.\n- The gratitude practice is new but I'm enjoying it.\n\nWhat surprised me: The coin system is more motivating than I expected.",
      tags: ['monthly-review', 'assessment', 'growth'], isFavorite: false, isPinned: false,
    },
    {
      title: 'Rainy Day Motivation', date: dateToStr(daysAgo(10)), mood: 'tired' as const,
      content: "It's been raining all day and I have zero motivation. Managed to do the meditation and drink water, but everything else feels like climbing a mountain.\n\nI did the emergency minimum for the workout — just some stretching and a few push-ups. It's not much, but it keeps the streak alive.\n\nNote to self: On low-energy days, focus on the habits that require the least activation energy.",
      tags: ['low-energy', 'emergency-minimum', 'self-compassion'], isFavorite: false, isPinned: false,
    },
    {
      title: 'New Habit: Arabic Vocabulary', date: dateToStr(daysAgo(9)), mood: 'happy' as const,
      content: "Started learning Arabic vocabulary today! I've been wanting to learn for months and finally set up the habit in the app.\n\nThe first 10 words were harder than I expected — Arabic script is beautiful but complex. I spent extra time on pronunciation. The habit tracker made it easy to just commit to 10 words per day.\n\nThis is exactly the kind of habit that benefits from daily tracking.",
      tags: ['new-habit', 'arabic', 'learning'], isFavorite: false, isPinned: false,
    },
    {
      title: 'Productivity Peak', date: dateToStr(daysAgo(7)), mood: 'focused' as const,
      content: "Had one of my most productive days in weeks. The deep work session went incredibly well — I entered flow state within the first 15 minutes and stayed there for almost the full 2 hours.\n\nI think the morning meditation is training my focus muscle. The ability to sit with discomfort and stay present is directly transferring to my work.\n\nCompleted all habits today. These perfect days are becoming more frequent. The compound effect is real.",
      tags: ['peak-performance', 'flow-state', 'all-complete'], isFavorite: true, isPinned: false,
    },
    {
      title: 'Gratitude for Growth', date: dateToStr(daysAgo(4)), mood: 'grateful' as const,
      content: "Looking back at where I started 5 weeks ago vs. now is incredible. The changes aren't dramatic in any single area, but the cumulative effect is significant.\n\nI'm sleeping better (most nights), exercising more consistently, reading every day, and I've started learning a new language. The journaling has helped me process emotions more effectively.\n\nI'm grateful for the systems I've built. Motivation comes and goes, but systems endure.",
      tags: ['gratitude', 'growth', 'milestone'], isFavorite: true, isPinned: true,
    },
    {
      title: 'End of Week Five', date: dateToStr(daysAgo(1)), mood: 'reflective' as const,
      content: "Five weeks. 35 days of intentional habit building. Here's where I stand:\n\n- Longest streak: 14 days on water tracking (still going!)\n- Most consistent: Meditation (missed only 3 days)\n- Most improved: Workout frequency (from 2x/week to 5x/week)\n- Needs most work: Sleep schedule (still averaging 11:30 PM bedtime)\n\nThe identity system is interesting. I've started thinking of myself as 'someone who exercises daily' rather than 'someone who sometimes works out.' That shift in self-image is powerful.\n\nTomorrow starts week 6. I'm aiming for another perfect week.",
      tags: ['weekly-review', 'progress', 'identity'], isFavorite: false, isPinned: false,
    },
  ];

  await prisma.journalEntry.createMany({
    data: entries.map((e) => ({ userId, ...e })),
  });
  return entries.length;
}

// ---------------------------------------------------------------------------
// Seed reward shop
// ---------------------------------------------------------------------------

async function seedRewardShop(userId: string) {
  const itemsData = [
    { key: 'theme-golden', name: 'Golden Theme', description: 'A luxurious golden interface theme that transforms the entire app experience.', cost: 500, type: 'THEME' as const },
    { key: 'theme-focus', name: 'Focus Theme', description: 'A calm, low-distraction theme designed for deep work sessions.', cost: 300, type: 'THEME' as const },
    { key: 'theme-journal', name: 'Journal Theme', description: 'A warm, paper-inspired look for your journal entries.', cost: 200, type: 'JOURNAL_THEME' as const },
    { key: 'avatar-frame-golden', name: 'Golden Avatar Frame', description: 'Show off your dedication with a shining golden profile frame.', cost: 250, type: 'AVATAR' as const },
    { key: 'pack-celebration', name: 'Celebration Pack', description: 'Confetti and fanfare effects for every milestone you unlock.', cost: 150, type: 'CELEBRATION' as const },
    { key: 'theme-ocean', name: 'Ocean Breeze Theme', description: 'A refreshing ocean-inspired theme with cool blues and teals.', cost: 350, type: 'THEME' as const },
    { key: 'avatar-neon', name: 'Neon Avatar Glow', description: 'A vibrant neon glow effect for your profile avatar.', cost: 200, type: 'AVATAR' as const },
    { key: 'theme-midnight', name: 'Midnight Dark Theme', description: 'An ultra-dark theme for night owls with eye-friendly contrast.', cost: 400, type: 'THEME' as const },
  ];

  let itemCount = 0;
  let redemptionCount = 0;
  let totalRedemptionCost = 0;
  for (const item of itemsData) {
    await prisma.rewardItem.upsert({ where: { key: item.key }, update: {}, create: item });
    itemCount++;
  }

  const celebration = await prisma.rewardItem.findUnique({ where: { key: 'pack-celebration' } });
  if (celebration) {
    await prisma.rewardRedemption.upsert({
      where: { userId_itemId: { userId, itemId: celebration.id } },
      update: {}, create: { userId, itemId: celebration.id, cost: celebration.cost },
    });
    // Also create ledger entry for the spend
    await prisma.rewardLedger.upsert({
      where: { idempotencyKey: `redeem:${celebration.id}` },
      update: {},
      create: {
        userId, amount: -celebration.cost, type: 'REWARD_REDEMPTION',
        referenceType: 'REWARD_ITEM', referenceId: celebration.id,
        idempotencyKey: `redeem:${celebration.id}`,
        description: `Redeemed "${celebration.name}"`,
      },
    });
    redemptionCount++;
    totalRedemptionCost += celebration.cost;
  }

  const journalTheme = await prisma.rewardItem.findUnique({ where: { key: 'theme-journal' } });
  if (journalTheme) {
    await prisma.rewardRedemption.upsert({
      where: { userId_itemId: { userId, itemId: journalTheme.id } },
      update: {}, create: { userId, itemId: journalTheme.id, cost: journalTheme.cost },
    });
    await prisma.rewardLedger.upsert({
      where: { idempotencyKey: `redeem:${journalTheme.id}` },
      update: {},
      create: {
        userId, amount: -journalTheme.cost, type: 'REWARD_REDEMPTION',
        referenceType: 'REWARD_ITEM', referenceId: journalTheme.id,
        idempotencyKey: `redeem:${journalTheme.id}`,
        description: `Redeemed "${journalTheme.name}"`,
      },
    });
    redemptionCount++;
    totalRedemptionCost += journalTheme.cost;
  }

  return { items: itemCount, redemptions: redemptionCount, totalSpent: totalRedemptionCost };
}

// ---------------------------------------------------------------------------
// Seed budgets
// ---------------------------------------------------------------------------

async function seedBudgets(userId: string) {
  let count = 0;

  const catsData = [
    { name: 'Food & Dining', icon: 'restaurant', color: '#EF4444', isDefault: true },
    { name: 'Transportation', icon: 'car', color: '#3B82F6', isDefault: true },
    { name: 'Entertainment', icon: 'film', color: '#A855F7', isDefault: true },
    { name: 'Health & Fitness', icon: 'fitness', color: '#10B981', isDefault: true },
    { name: 'Education', icon: 'school', color: '#F59E0B', isDefault: true },
    { name: 'Shopping', icon: 'bag', color: '#EC4899', isDefault: false },
    { name: 'Utilities', icon: 'flash', color: '#6366F1', isDefault: false },
    { name: 'Subscriptions', icon: 'card', color: '#14B8A6', isDefault: false },
  ];

  const catIds: Record<string, string> = {};
  for (const cat of catsData) {
    const c = await prisma.expenseCategory.upsert({
      where: { userId_name: { userId, name: cat.name } },
      update: {}, create: { userId, ...cat },
    });
    catIds[cat.name] = c.id;
    count++;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const budget = await prisma.budget.create({
    data: {
      userId, title: 'Monthly Budget', amount: 2500,
      periodType: 'MONTHLY', startDate: monthStart, endDate: monthEnd,
      note: 'Main monthly budget for all expenses',
    },
  });
  count++;

  // Week breakdowns
  const breakdowns: Array<{
    budgetId: string; label: string; startDate: Date;
    endDate: Date; amount: number; sortOrder: number;
  }> = [];
  for (let w = 0; w < 4; w++) {
    const ws = new Date(monthStart); ws.setDate(ws.getDate() + w * 7);
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    if (we > monthEnd) we.setTime(monthEnd.getTime());
    breakdowns.push({ budgetId: budget.id, label: `Week ${w + 1}`, startDate: ws, endDate: we, amount: 625, sortOrder: w });
  }
  await prisma.budgetBreakdown.createMany({ data: breakdowns });
  count += breakdowns.length;

  // Allocations
  const allocs = [
    { cat: 'Food & Dining', amount: 800 }, { cat: 'Transportation', amount: 300 },
    { cat: 'Entertainment', amount: 200 }, { cat: 'Health & Fitness', amount: 250 },
    { cat: 'Education', amount: 150 }, { cat: 'Shopping', amount: 300 },
    { cat: 'Utilities', amount: 350 }, { cat: 'Subscriptions', amount: 150 },
  ];
  const allocData = allocs.map((a) => ({ budgetId: budget.id, categoryId: catIds[a.cat], amount: a.amount })).filter((a) => a.categoryId);
  await prisma.budgetCategoryAllocation.createMany({ data: allocData });
  count += allocData.length;

  // Expenses
  const expData = [
    { title: 'Grocery shopping', amount: 85.5, cat: 'Food & Dining', d: 5 },
    { title: 'Coffee with friends', amount: 18.0, cat: 'Food & Dining', d: 3 },
    { title: 'Uber to office', amount: 12.5, cat: 'Transportation', d: 2 },
    { title: 'Netflix subscription', amount: 15.99, cat: 'Subscriptions', d: 7 },
    { title: 'Gym membership', amount: 49.99, cat: 'Health & Fitness', d: 10 },
    { title: 'Online course', amount: 29.99, cat: 'Education', d: 14 },
    { title: 'Restaurant dinner', amount: 42.0, cat: 'Food & Dining', d: 1 },
    { title: 'Electric bill', amount: 95.0, cat: 'Utilities', d: 8 },
    { title: 'Running shoes', amount: 120.0, cat: 'Shopping', d: 12 },
    { title: 'Movie tickets', amount: 24.0, cat: 'Entertainment', d: 6 },
    { title: 'Lunch takeout', amount: 15.0, cat: 'Food & Dining', d: 4 },
    { title: 'Bus pass', amount: 65.0, cat: 'Transportation', d: 15 },
  ];
  const expenses = expData.map((e) => ({
    userId, budgetId: budget.id, categoryId: catIds[e.cat], title: e.title,
    amount: e.amount, expenseDate: daysAgo(e.d),
  })).filter((e) => e.categoryId);
  await prisma.expense.createMany({ data: expenses });
  count += expenses.length;

  // Income
  await prisma.income.createMany({
    data: [
      { userId, title: 'Monthly salary', amount: 3500, incomeDate: daysAgo(5) },
      { userId, title: 'Freelance project', amount: 500, incomeDate: daysAgo(12) },
      { userId, title: 'Sold old laptop', amount: 200, incomeDate: daysAgo(20) },
    ],
  });
  count += 3;

  return count;
}

// ---------------------------------------------------------------------------
// Seed identities
// ---------------------------------------------------------------------------

async function seedIdentities(userId: string, habits: Array<{ id: string; title: string }>) {
  const data = [
    {
      title: 'Fitness Enthusiast', description: 'I am someone who prioritizes physical health and strength. Exercise is not optional — it is part of who I am.',
      icon: 'barbell', color: '#EF4444', linked: ['Morning Workout', 'Walk 8,000 Steps'],
    },
    {
      title: 'Lifelong Learner', description: 'I am committed to continuous growth and knowledge. Reading and learning new skills are fundamental to my daily routine.',
      icon: 'book', color: '#F59E0B', linked: ['Read 30 Minutes', 'Learn Arabic Vocabulary'],
    },
    {
      title: 'Mindful Individual', description: 'I cultivate awareness and presence in everything I do. Meditation and reflection are the foundations of my mental clarity.',
      icon: 'flower', color: '#A855F7', linked: ['Meditate', 'Journal'],
    },
  ];

  let count = 0;
  for (const d of data) {
    const ident = await prisma.identity.create({
      data: { userId, title: d.title, description: d.description, icon: d.icon, color: d.color, status: 'ACTIVE' },
    });
    count++;

    const links = d.linked
      .map((title) => habits.find((h) => h.title === title)?.id)
      .filter(Boolean)
      .map((habitId) => ({ identityId: ident.id, habitId: habitId! }));

    if (links.length > 0) {
      await prisma.identityHabit.createMany({ data: links });
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Seed badges
// ---------------------------------------------------------------------------

async function seedBadges(userId: string) {
  const badges = [
    { id: '3-day-streak', title: '3 Day Streak', description: 'Logged 3 days in a row!', icon: 'flame-outline', type: 'STREAK' as const },
    { id: '7-day-streak', title: '7 Day Streak', description: 'One week of consistency!', icon: 'flame', type: 'STREAK' as const },
    { id: '14-day-streak', title: '14 Day Streak', description: 'Two weeks strong — you are building momentum!', icon: 'flash', type: 'STREAK' as const },
    { id: '30-day-streak', title: '30 Day Streak', description: 'A full month of dedication!', icon: 'rocket', type: 'STREAK' as const },
    { id: 'first-step', title: 'First Step', description: 'Completed your very first habit!', icon: 'checkmark-circle', type: 'MILESTONE' as const },
    { id: 'early-bird', title: 'Early Bird', description: 'Completed a habit before 8 AM!', icon: 'sunny', type: 'MILESTONE' as const },
    { id: 'dedicated', title: 'Dedicated', description: 'Reached 50 total habit completions!', icon: 'heart', type: 'MILESTONE' as const },
    { id: 'centurion', title: 'Centurion', description: 'Reached 100 total habit completions!', icon: 'ribbon', type: 'MILESTONE' as const },
  ];

  let count = 0;
  for (const badge of badges) {
    await prisma.badge.upsert({ where: { id: badge.id }, update: badge, create: badge });
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
      update: {}, create: { userId, badgeId: badge.id, earnedAt: daysAgo(Math.floor(Math.random() * 20) + 5) },
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Seed notifications
// ---------------------------------------------------------------------------

async function seedNotifications(userId: string) {
  const notifs = [
    { fingerprint: 'notif-streak-milestone', type: 'STREAK_MILESTONE', status: 'SURFACED', priority: 'HIGH', dayKey: dateToStr(daysAgo(1)) },
    { fingerprint: 'notif-habit-reminder', type: 'HABIT_REMINDER', status: 'SURFACED', priority: 'MEDIUM', dayKey: dateToStr(new Date()) },
    { fingerprint: 'notif-daily-progress', type: 'DAILY_PROGRESS', status: 'SURFACED', priority: 'LOW', dayKey: dateToStr(new Date()) },
    { fingerprint: 'notif-achievement-unlocked', type: 'ACHIEVEMENT_UNLOCKED', status: 'SURFACED', priority: 'HIGH', dayKey: dateToStr(daysAgo(3)) },
    { fingerprint: 'notif-weekly-review', type: 'WEEKLY_REVIEW', status: 'SURFACED', priority: 'MEDIUM', dayKey: dateToStr(daysAgo(2)) },
    { fingerprint: 'notif-encouragement', type: 'ENCOURAGEMENT', status: 'EXPIRED', priority: 'LOW', dayKey: dateToStr(daysAgo(5)) },
    { fingerprint: 'notif-new-habit-tip', type: 'HABIT_TIP', status: 'SURFACED', priority: 'LOW', dayKey: dateToStr(daysAgo(1)) },
  ];

  await prisma.notificationDelivery.createMany({
    data: notifs.map((n) => ({ userId, ...n })),
  });
  return notifs.length;
}

// ---------------------------------------------------------------------------
// Seed reminders
// ---------------------------------------------------------------------------

async function seedReminders(userId: string, habits: Array<{ id: string; config: HabitConfig }>) {
  const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  await prisma.reminder.createMany({
    data: habits.map((h) => ({
      userId, habitId: h.id, time: h.config.scheduledTime,
      days: h.config.scheduleType === 'specific_days' ? weekdayDays : allDays,
      enabled: true,
    })),
  });
  return habits.length;
}

// ---------------------------------------------------------------------------
// Seed weekly reviews
// ---------------------------------------------------------------------------

async function seedWeeklyReviews(userId: string) {
  const reviews = [
    {
      weekStart: dateToStr(daysAgo(41)), weekEnd: dateToStr(daysAgo(35)),
      headline: 'Strong Start to the Journey',
      summary: 'Great first week! Established morning routine and maintained consistency across most habits.',
      wins: ['Completed 5/7 workout sessions', 'Meditated every day', 'Drank 3L water 6/7 days'],
      patterns: ['Morning habits are easier to maintain than evening ones', 'Energy drops significantly after 9 PM'],
    },
    {
      weekStart: dateToStr(daysAgo(34)), weekEnd: dateToStr(daysAgo(28)),
      headline: 'Building Momentum',
      summary: 'Second week showed improvement in consistency. Deep work sessions became more productive.',
      wins: ['Perfect deep work week', 'Finished first book', 'Walking habit reached 8000 steps 5/7 days'],
      patterns: ['Deep work is most productive between 9-11 AM', 'Exercise improves sleep quality when done before 6 PM'],
    },
    {
      weekStart: dateToStr(daysAgo(27)), weekEnd: dateToStr(daysAgo(21)),
      headline: 'Overcoming the Slump',
      summary: "A challenging week with some missed days. Work deadline caused stress. Emergency minimum prevented total streak loss.",
      wins: ['Used emergency minimum instead of skipping', 'Rebounded strongly on Friday', 'Journaling helped process stress'],
      patterns: ['Stress correlates with missed evening habits', 'Emergency minimum is a lifesaver during busy weeks'],
    },
    {
      weekStart: dateToStr(daysAgo(20)), weekEnd: dateToStr(daysAgo(14)),
      headline: 'Recovery and Growth',
      summary: "Bounced back from last week's difficulties. Added Arabic vocabulary as a new habit. Deep work sessions hit peak productivity.",
      wins: ['New Arabic habit started strong', '7 consecutive workout days', 'Reading streak reached 14 days'],
      patterns: ['Adding new habits reinvigorates motivation', 'Consistent bedtime improves morning energy'],
    },
    {
      weekStart: dateToStr(daysAgo(13)), weekEnd: dateToStr(daysAgo(7)),
      headline: 'Peak Performance Week',
      summary: 'The best week so far! Completed all habits on 3 out of 7 days. Meditation breakthrough. Identity shift toward "fitness person" is real.',
      wins: ['3 perfect days in one week', 'Meditation breakthrough', 'Longest water tracking streak: 14 days', 'Earned Centurion badge (100 completions)'],
      patterns: ['Perfect days cluster around low-stress workdays', 'Morning routine completion predicts overall daily success'],
    },
  ];

  await prisma.weeklyBehaviorReview.createMany({
    data: reviews.map((r) => ({
      userId, ...r, status: 'READY', provider: 'seeded', generated: true,
      identityReflection: 'Identity habits are reinforcing consistently.',
      nextWeekFocus: ['Improve sleep consistency', 'Maintain Arabic vocabulary streak', 'Aim for 4 perfect days'],
    })),
  });
  return reviews.length;
}

// ---------------------------------------------------------------------------
// Seed temptation bundles
// ---------------------------------------------------------------------------

async function seedTemptationBundles(userId: string, habits: Array<{ id: string; title: string }>) {
  const bundles = [
    { habitTitle: 'Morning Workout', title: 'Post-Workout Treat', description: 'After completing 7 consecutive workout sessions, unlock a special reward.', status: 'UNLOCKED' as const },
    { habitTitle: 'Read 30 Minutes', title: 'Bookworm Bonus', description: 'Read every day for a week and earn bonus coins.', status: 'LOCKED' as const },
    { habitTitle: 'Deep Work Session', title: 'Flow State Reward', description: 'Complete 5 deep work sessions in a row. Your productivity deserves recognition.', status: 'USED' as const },
  ];

  let count = 0;
  const data: Array<{
    userId: string; habitId: string; title: string; description: string;
    status: 'LOCKED' | 'UNLOCKED' | 'USED'; unlockedAt: Date | null; usedAt: Date | null;
  }> = [];

  for (const b of bundles) {
    const habit = habits.find((h) => h.title === b.habitTitle);
    if (!habit) continue;
    data.push({
      userId, habitId: habit.id, title: b.title, description: b.description,
      status: b.status,
      unlockedAt: b.status !== 'LOCKED' ? daysAgo(5) : null,
      usedAt: b.status === 'USED' ? daysAgo(3) : null,
    });
    count++;
  }

  if (data.length > 0) {
    await prisma.temptationBundle.createMany({ data });
  }

  return count;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
