// Climbing grade scales, used to find your hardest send per scale.

const V = ['VB', ...Array.from({ length: 18 }, (_, i) => `V${i}`)];
const FONT = ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
const FRENCH = ['4a', '4b', '4c', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c'];
const YDS = ['5.5', '5.6', '5.7', '5.8', '5.9', '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b', '5.15c', '5.15d'];

export const GRADE_SCALES = {
  v: { label: 'V-scale (boulder)', grades: V },
  font: { label: 'Font (boulder)', grades: FONT },
  french: { label: 'French (routes)', grades: FRENCH },
  yds: { label: 'YDS (routes)', grades: YDS },
};

export function gradeRank(scale, grade) {
  const s = GRADE_SCALES[scale];
  return s ? s.grades.indexOf(grade) : -1;
}

// Hardest sent grade per scale from a list of sessions.
export function hardestSends(sessions) {
  const out = {};
  for (const s of sessions) {
    if (s.outcome !== 'sent' || !s.gradeScale || !s.grade) continue;
    const r = gradeRank(s.gradeScale, s.grade);
    if (r < 0) continue;
    if (!out[s.gradeScale] || r > out[s.gradeScale].rank) out[s.gradeScale] = { rank: r, grade: s.grade };
  }
  return out;
}
