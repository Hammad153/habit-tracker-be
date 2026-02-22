import { PrismaClient, BadgeType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const badges = [
    {
      title: 'First Habit',
      description: 'Completed your first habit!',
      icon: 'checkmark-circle',
      type: BadgeType.MILESTONE,
    },
    {
      title: '3 Day Streak',
      description: 'Logged 3 days in a row!',
      icon: 'flame',
      type: BadgeType.STREAK,
    },
    {
      title: '7 Day Streak',
      description: 'One week of consistency!',
      icon: 'flame',
      type: BadgeType.STREAK,
    },
    {
      title: 'Early Bird',
      description: 'Completed a habit before 8 AM!',
      icon: 'sunny',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Perfect Week',
      description: 'All habits completed for 7 days!',
      icon: 'star',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Centurion',
      description: 'Reached 100 total completions!',
      icon: 'trophy',
      type: BadgeType.MILESTONE,
    },
  ];

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { id: badge.title.toLowerCase().replace(/ /g, '-') }, // Simple ID for seeding
      update: badge,
      create: {
        id: badge.title.toLowerCase().replace(/ /g, '-'),
        ...badge,
      },
    });
  }

  console.log('Badges seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
