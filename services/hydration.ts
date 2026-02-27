/**
 * Hydration goal calculation based on user profile.
 *
 * Uses the IOM/NHS-style formula:
 *   Base (ml) = weight_kg * 35
 *   Gender adjustment: female *= 0.9
 *   Age adjustment:
 *     <18 => * 1.0
 *     18-55 => * 1.0
 *     56-70 => * 0.95
 *     >70   => * 0.90
 *   Activity / heat adjustments are left as a future extension.
 *
 * Minimum: 1500 ml   Maximum: 4000 ml
 */

export interface HydrationProfile {
  gender: string;
  dob: string; // 'DD/MM/YYYY'
  height_cm: number;
  weight_kg: number;
}

export interface HydrationGoal {
  daily_goal_ml: number;
  recommendation: string;
}

export function calculateAge(dob: string): number {
  // dob format: 'DD/MM/YYYY'
  const parts = dob.split('/');
  if (parts.length !== 3) return 25;
  const birthDate = new Date(
    parseInt(parts[2], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[0], 10)
  );
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return Math.max(0, age);
}

export function calculateDailyGoalMl(profile: HydrationProfile): number {
  const age = calculateAge(profile.dob);
  const weight = profile.weight_kg > 0 ? profile.weight_kg : 70;

  let goal = weight * 35;

  // Gender factor
  const gender = profile.gender.toLowerCase();
  if (gender === 'female') goal *= 0.9;

  // Age factor
  if (age >= 56 && age <= 70) goal *= 0.95;
  else if (age > 70) goal *= 0.9;

  goal = Math.max(1500, Math.min(4000, Math.round(goal)));
  return goal;
}

export function buildRecommendation(
  profile: HydrationProfile,
  goal_ml: number
): string {
  const age = calculateAge(profile.dob);
  const lines: string[] = [];

  lines.push(`Your personalised daily hydration goal is ${(goal_ml / 1000).toFixed(1)} L.`);

  if (age < 18) {
    lines.push('Children and teenagers need regular hydration throughout the day.');
  } else if (age > 65) {
    lines.push('Older adults may feel less thirsty – drink regularly even without thirst.');
  }

  const gender = profile.gender.toLowerCase();
  if (gender === 'female') {
    lines.push('Women generally need slightly less water than men of the same weight.');
  }

  if (profile.weight_kg > 90) {
    lines.push('Higher body weight increases fluid requirements.');
  }

  lines.push('Spread intake evenly across the day and increase during exercise or hot weather.');

  return lines.join(' ');
}

export function getHydrationStatus(
  consumed_ml: number,
  goal_ml: number
): { label: string; color: string; percentage: number } {
  const pct = goal_ml > 0 ? Math.min(100, Math.round((consumed_ml / goal_ml) * 100)) : 0;

  if (pct >= 100) return { label: 'Goal Reached!', color: '#34C759', percentage: pct };
  if (pct >= 75) return { label: 'Almost There', color: '#5AC8FA', percentage: pct };
  if (pct >= 50) return { label: 'Good Progress', color: '#007AFF', percentage: pct };
  if (pct >= 25) return { label: 'Keep Going', color: '#FF9500', percentage: pct };
  return { label: 'Start Drinking', color: '#FF3B30', percentage: pct };
}
