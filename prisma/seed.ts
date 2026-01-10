import { PrismaClient, BadgeType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'hammadismail2005@gmail.com' },
    update: {},
    create: {
      id: 'default-user',
      name: 'Hammad Ismail',
      email: 'hammadismail2005@gmail.com',
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
