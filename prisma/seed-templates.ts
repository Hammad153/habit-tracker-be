import { PrismaClient, SubscriptionTier } from '@prisma/client';

const prisma = new PrismaClient();

const templates = [
  // Fitness
  { title: 'Morning Run', subtitle: 'Start your day active', icon: 'walk', iconColor: '#10b981', iconBg: '#10b98120', category: 'Fitness', goal: 1, unit: 'session', tier: SubscriptionTier.FREE, sortOrder: 1 },
  { title: 'Drink Water', subtitle: 'Stay hydrated throughout the day', icon: 'water', iconColor: '#0ea5e9', iconBg: '#0ea5e920', category: 'Fitness', goal: 8, unit: 'glasses', tier: SubscriptionTier.FREE, sortOrder: 2 },
  { title: 'Workout', subtitle: '30 min strength training', icon: 'barbell', iconColor: '#f43f5e', iconBg: '#f43f5e20', category: 'Fitness', goal: 30, unit: 'minutes', tier: SubscriptionTier.FREE, sortOrder: 3 },
  { title: 'Stretching', subtitle: 'Daily flexibility routine', icon: 'fitness', iconColor: '#8b5cf6', iconBg: '#8b5cf620', category: 'Fitness', goal: 10, unit: 'minutes', tier: SubscriptionTier.BASIC, sortOrder: 4 },
  { title: 'Cycling', subtitle: 'Bike ride for cardio', icon: 'bicycle', iconColor: '#f59e0b', iconBg: '#f59e0b20', category: 'Fitness', goal: 1, unit: 'ride', tier: SubscriptionTier.BASIC, sortOrder: 5 },

  // Mindfulness
  { title: 'Meditate', subtitle: '10 minutes of calm', icon: 'flower', iconColor: '#8b5cf6', iconBg: '#8b5cf620', category: 'Mindfulness', goal: 10, unit: 'minutes', tier: SubscriptionTier.FREE, sortOrder: 6 },
  { title: 'Gratitude Journal', subtitle: 'Write 3 things you\'re grateful for', icon: 'create', iconColor: '#ec4899', iconBg: '#ec489920', category: 'Mindfulness', goal: 3, unit: 'entries', tier: SubscriptionTier.FREE, sortOrder: 7 },
  { title: 'Deep Breathing', subtitle: '5 minute breathing exercise', icon: 'leaf', iconColor: '#10b981', iconBg: '#10b98120', category: 'Mindfulness', goal: 5, unit: 'minutes', tier: SubscriptionTier.BASIC, sortOrder: 8 },
  { title: 'Digital Detox', subtitle: 'No screens for 1 hour', icon: 'sunny', iconColor: '#f59e0b', iconBg: '#f59e0b20', category: 'Mindfulness', goal: 60, unit: 'minutes', tier: SubscriptionTier.PREMIUM, sortOrder: 9 },

  // Productivity
  { title: 'Read', subtitle: 'Read 20 pages daily', icon: 'book', iconColor: '#6366f1', iconBg: '#6366f120', category: 'Productivity', goal: 20, unit: 'pages', tier: SubscriptionTier.FREE, sortOrder: 10 },
  { title: 'Code Practice', subtitle: 'Solve a coding challenge', icon: 'code', iconColor: '#0ea5e9', iconBg: '#0ea5e920', category: 'Productivity', goal: 1, unit: 'problem', tier: SubscriptionTier.FREE, sortOrder: 11 },
  { title: 'Learn Language', subtitle: 'Practice a new language', icon: 'language', iconColor: '#13ec5b', iconBg: '#13ec5b20', category: 'Productivity', goal: 15, unit: 'minutes', tier: SubscriptionTier.BASIC, sortOrder: 12 },
  { title: 'Write', subtitle: 'Creative writing practice', icon: 'pencil', iconColor: '#ec4899', iconBg: '#ec489920', category: 'Productivity', goal: 500, unit: 'words', tier: SubscriptionTier.BASIC, sortOrder: 13 },

  // Health
  { title: 'Sleep 8 Hours', subtitle: 'Get enough rest', icon: 'bed', iconColor: '#6366f1', iconBg: '#6366f120', category: 'Health', goal: 8, unit: 'hours', tier: SubscriptionTier.FREE, sortOrder: 14 },
  { title: 'No Junk Food', subtitle: 'Eat clean today', icon: 'restaurant', iconColor: '#f43f5e', iconBg: '#f43f5e20', category: 'Health', goal: 1, unit: 'day', tier: SubscriptionTier.FREE, sortOrder: 15 },
  { title: 'Take Vitamins', subtitle: 'Daily supplements', icon: 'heart', iconColor: '#f43f5e', iconBg: '#f43f5e20', category: 'Health', goal: 1, unit: 'dose', tier: SubscriptionTier.BASIC, sortOrder: 16 },
  { title: 'Walk 10K Steps', subtitle: 'Stay active throughout the day', icon: 'walk', iconColor: '#10b981', iconBg: '#10b98120', category: 'Health', goal: 10000, unit: 'steps', tier: SubscriptionTier.BASIC, sortOrder: 17 },

  // Career
  { title: 'Study', subtitle: 'Focused study session', icon: 'school', iconColor: '#0ea5e9', iconBg: '#0ea5e920', category: 'Career', goal: 60, unit: 'minutes', tier: SubscriptionTier.FREE, sortOrder: 18 },
  { title: 'Network', subtitle: 'Connect with 1 person', icon: 'happy', iconColor: '#f59e0b', iconBg: '#f59e0b20', category: 'Career', goal: 1, unit: 'connection', tier: SubscriptionTier.PREMIUM, sortOrder: 19 },
  { title: 'Budget Review', subtitle: 'Track your spending', icon: 'wallet', iconColor: '#13ec5b', iconBg: '#13ec5b20', category: 'Career', goal: 1, unit: 'review', tier: SubscriptionTier.PREMIUM, sortOrder: 20 },
  { title: 'Morning Routine', subtitle: 'Complete your morning ritual', icon: 'cafe', iconColor: '#f59e0b', iconBg: '#f59e0b20', category: 'Career', goal: 1, unit: 'routine', tier: SubscriptionTier.FREE, sortOrder: 21 },
];

async function main() {
  for (const template of templates) {
    const id = template.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    await prisma.habitTemplate.upsert({
      where: { id },
      update: template,
      create: { id, ...template },
    });
  }

  console.log(`✅ Seeded ${templates.length} habit templates!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
