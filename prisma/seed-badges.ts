import { PrismaClient, BadgeType } from '@prisma/client';
import { prismaClientOptions } from '../src/core/database/prisma-client-options';

const prisma = new PrismaClient(prismaClientOptions);

async function main() {
  const badges = [
    // ── Streak badges (consecutive days) ──────────────────────────────
    {
      title: '3 Day Streak',
      description: 'Logged 3 days in a row!',
      icon: 'flame-outline',
      type: BadgeType.STREAK,
    },
    {
      title: '7 Day Streak',
      description: 'One week of consistency!',
      icon: 'flame',
      type: BadgeType.STREAK,
    },
    {
      title: '14 Day Streak',
      description: 'Two weeks strong — you are building momentum!',
      icon: 'flash',
      type: BadgeType.STREAK,
    },
    {
      title: '30 Day Streak',
      description: 'A full month of dedication!',
      icon: 'rocket',
      type: BadgeType.STREAK,
    },
    {
      title: '60 Day Streak',
      description: 'Unstoppable for two months straight!',
      icon: 'diamond',
      type: BadgeType.STREAK,
    },
    {
      title: '100 Day Streak',
      description: '100 days — you are legendary!',
      icon: 'trophy',
      type: BadgeType.STREAK,
    },

    // ── Milestone badges (one-time achievements) ──────────────────────
    {
      title: 'First Step',
      description: 'Completed your very first habit!',
      icon: 'checkmark-circle',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Early Bird',
      description: 'Completed a habit before 8 AM!',
      icon: 'sunny',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Night Owl',
      description: 'Completed a habit after 10 PM!',
      icon: 'moon',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Dedicated',
      description: 'Reached 50 total habit completions!',
      icon: 'heart',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Perfect Week',
      description: 'All habits completed every day for 7 days!',
      icon: 'star',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Centurion',
      description: 'Reached 100 total habit completions!',
      icon: 'ribbon',
      type: BadgeType.MILESTONE,
    },
  ];

  for (const badge of badges) {
    const id = badge.title.toLowerCase().replace(/ /g, '-');
    await prisma.badge.upsert({
      where: { id },
      update: badge,
      create: { id, ...badge },
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
