export interface HabitTemplate {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  category: string;
  frequency?: string;
  goal: number;
  unit?: string;
  tier: 'FREE' | 'BASIC' | 'PREMIUM';
  sortOrder: number;
}

const t = (
  id: string,
  title: string,
  subtitle: string,
  icon: string,
  iconColor: string,
  category: string,
  goal: number,
  unit: string,
  sortOrder: number,
  frequency = 'Daily',
): HabitTemplate => ({
  id,
  title,
  subtitle,
  icon,
  iconColor,
  iconBg: `${iconColor}20`,
  category,
  frequency,
  goal,
  unit,
  tier: 'FREE',
  sortOrder,
});

// Every template is FREE so users can browse and use any of them without
// subscribing. Icons map to Ionicons names used across the app.
export const HABIT_TEMPLATES: HabitTemplate[] = [
  // Fitness
  t('tpl-pushups', 'Do push ups', 'Build upper body strength', 'barbell', '#f43f5e', 'Fitness', 30, 'reps', 1),
  t('tpl-walk', 'Walk 10,000 steps', 'Stay active every day', 'walk', '#0ea5e9', 'Fitness', 10000, 'steps', 2),
  t('tpl-run', 'Go for a run', 'Boost your cardio', 'fitness', '#10b981', 'Fitness', 3, 'km', 3),
  t('tpl-cycle', 'Ride a bike', 'Get moving outdoors', 'bicycle', '#f59e0b', 'Fitness', 5, 'km', 4),

  // Mindfulness
  t('tpl-meditate', 'Meditate', 'Calm your mind', 'flower', '#8b5cf6', 'Mindfulness', 10, 'minutes', 5),
  t('tpl-journal', 'Write in journal', 'Reflect on your day', 'create', '#6366f1', 'Mindfulness', 1, 'entry', 6),
  t('tpl-gratitude', 'Gratitude list', 'Note what you are thankful for', 'happy', '#ec4899', 'Mindfulness', 3, 'things', 7),

  // Health
  t('tpl-water', 'Drink water', 'Stay hydrated', 'water', '#0ea5e9', 'Health', 2000, 'ml', 8),
  t('tpl-sleep', 'Sleep 8 hours', 'Rest and recover', 'bed', '#6366f1', 'Health', 8, 'hours', 9),
  t('tpl-eat-healthy', 'Eat a healthy meal', 'Fuel your body well', 'restaurant', '#10b981', 'Health', 1, 'meal', 10),
  t('tpl-vitamins', 'Take vitamins', 'Support your wellbeing', 'leaf', '#13ec5b', 'Health', 1, 'times', 11),

  // Productivity
  t('tpl-read', 'Read a book', 'Grow your knowledge', 'book', '#f59e0b', 'Productivity', 20, 'pages', 12),
  t('tpl-deep-work', 'Deep work session', 'Focus without distractions', 'timer', '#8b5cf6', 'Productivity', 60, 'minutes', 13),
  t('tpl-plan-day', 'Plan your day', 'Set your priorities', 'pencil', '#0ea5e9', 'Productivity', 1, 'times', 14),

  // Career
  t('tpl-code', 'Code every day', 'Sharpen your skills', 'code', '#13ec5b', 'Career', 1, 'hour', 15),
  t('tpl-learn', 'Study a new skill', 'Invest in yourself', 'school', '#f43f5e', 'Career', 30, 'minutes', 16),
  t('tpl-language', 'Practice a language', 'Learn something new', 'language', '#6366f1', 'Career', 15, 'minutes', 17),
];
