import { PrismaClient, BadgeType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { prismaClientOptions } from '../src/core/database/prisma-client-options';

const prisma = new PrismaClient(prismaClientOptions);

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'hammadismail2005@gmail.com' },
    update: {},
    create: {
      id: 'default-user',
      name: 'Hammad Ismail',
      email: 'hammadismail2005@gmail.com',
      password: 'Welcome123',
      level: 5,
      xp: 750,
      longestStreak: 12,
      totalHabits: 5,
      completionRate: 0.85,
    },
  });

  const habits = [
    {
      title: 'Drink 3L Water',
      icon: 'water',
      iconColor: '#38BDF8',
      iconBg: 'rgba(56, 189, 248, 0.2)',
      subtitle: 'Daily • 75% Goal',
    },
    {
      title: 'Read 30 mins',
      icon: 'book',
      iconColor: '#F59E0B',
      iconBg: 'rgba(245, 158, 11, 0.2)',
      subtitle: 'Daily • Morning',
    },
    {
      title: 'Morning Workout',
      icon: 'barbell',
      iconColor: '#EF4444',
      iconBg: 'rgba(239, 68, 68, 0.2)',
      subtitle: 'Weekdays • High Priority',
    },
    {
      title: 'Meditate',
      icon: 'flower',
      iconColor: '#A855F7',
      iconBg: 'rgba(168, 85, 247, 0.2)',
      subtitle: 'Daily • 10 mins',
    },
    {
      title: 'Journaling',
      icon: 'create',
      iconColor: '#10B981',
      iconBg: 'rgba(16, 185, 129, 0.2)',
      subtitle: 'Evening • Gratitude',
    },
  ];

  for (const habit of habits) {
    await prisma.habit.create({
      data: {
        ...habit,
        userId: user.id,
      },
    });
  }

  const badges: {
    title: string;
    description: string;
    icon: string;
    type: BadgeType;
  }[] = [
    {
      title: '7 Day Streak',
      description: 'Completed habits for 7 days in a row',
      icon: 'flame',
      type: 'STREAK',
    },
    {
      title: 'Early Bird',
      description: 'Completed 10 morning habits',
      icon: 'sunny',
      type: 'MILESTONE',
    },
  ];

  for (const badge of badges) {
    await prisma.badge.create({
      data: badge,
    });
  }

  // Reward Shop starter catalog.
  // `key` is the stable, deterministic identifier (@unique in the schema), so
  // re-running the seed upserts instead of duplicating. Existing rows are left
  // untouched (update: {}) — admin price/status changes and any user
  // redemptions referencing these items are never modified or deleted.
  const rewardItems: {
    key: string;
    name: string;
    description: string;
    cost: number;
    type: 'THEME' | 'AVATAR' | 'JOURNAL_THEME' | 'CELEBRATION';
  }[] = [
    {
      key: 'theme-golden',
      name: 'Golden Theme',
      description: 'A luxurious golden interface theme for the whole app.',
      cost: 500,
      type: 'THEME',
    },
    {
      key: 'theme-focus',
      name: 'Focus Theme',
      description: 'A calm, low-distraction theme built for deep work sessions.',
      cost: 300,
      type: 'THEME',
    },
    {
      key: 'theme-journal',
      name: 'Journal Theme',
      description: 'A warm, paper-inspired look for your journal entries.',
      cost: 200,
      type: 'JOURNAL_THEME',
    },
    {
      key: 'avatar-frame-golden',
      name: 'Golden Avatar Frame',
      description: 'Show off your dedication with a shining golden profile frame.',
      cost: 250,
      type: 'AVATAR',
    },
    {
      key: 'pack-celebration',
      name: 'Celebration Pack',
      description: 'Confetti and fanfare effects for every milestone you unlock.',
      cost: 150,
      type: 'CELEBRATION',
    },
  ];

  for (const item of rewardItems) {
    await prisma.rewardItem.upsert({
      where: { key: item.key },
      update: {},
      create: item,
    });
  }
  console.log(`Seeded ${rewardItems.length} reward shop items.`);

  await seedAdminFromEnv();
  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// ---------------------------------------------------------------------------
// Phase 3.8 — environment-gated development admin.
// Only runs when BOTH ADMIN_EMAIL and ADMIN_PASSWORD are provided.
// Never hardcodes credentials; never logs the password; idempotent upsert.
// ---------------------------------------------------------------------------
async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('[seed] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed');
    return;
  }
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' }, // preserve unrelated fields on existing users
    create: {
      name: 'Administrator',
      email,
      password: hashed,
      role: 'ADMIN',
    },
  });
  console.log(`[seed] admin ensured for ${email} (role=ADMIN)`);
}
