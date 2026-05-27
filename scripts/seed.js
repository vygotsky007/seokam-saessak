if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const supabase = require('../utils/supabase');

const SAMPLE_PROGRAMS = [
  {
    title: 'AI 모스부호 이해 및 암호 해독하기',
    description: 'AI를 활용해 모스부호의 원리를 배우고 직접 암호를 만들고 풀어봐요.',
    schedule: '10월 20일(월)~23일(목) 14:40~16:00',
    location: '4학년 5반',
    grade_min: 1,
    grade_max: 6,
    capacity: 20,
    instructors: '이남건·윤상혁',
    is_open: false,
  },
  {
    title: 'AI로 완성하는 자기주도학습',
    description: 'AI 학습 도구를 활용해 나만의 학습 루틴을 만들어요.',
    schedule: '10월 27,28,30,31일 14:40~16:00',
    location: '3-5 교실',
    grade_min: 4,
    grade_max: 6,
    capacity: 20,
    instructors: '윤상혁·한희나',
    is_open: false,
  },
  {
    title: 'AI 헬스메이커',
    description: 'AI와 함께하는 건강관리 프로그램을 직접 설계해봐요.',
    schedule: '10월 18~19일 09:00~12:00',
    location: '별관 4층 컴퓨터실',
    grade_min: 3,
    grade_max: 6,
    capacity: 20,
    instructors: '이창성·이남건',
    is_open: false,
  },
];

(async () => {
  console.log('🌱 디지털새싹 샘플 프로그램 seed 시작…');
  for (const p of SAMPLE_PROGRAMS) {
    const { data: exists, error: e1 } = await supabase
      .from('saessak_programs')
      .select('id')
      .eq('title', p.title);
    if (e1) { console.error(e1); continue; }
    if (exists && exists.length > 0) {
      console.log('  · 이미 존재:', p.title);
      continue;
    }
    const { error } = await supabase.from('saessak_programs').insert([p]);
    if (error) console.error('  ✗', p.title, error.message);
    else console.log('  ✓', p.title);
  }
  console.log('완료.');
  process.exit(0);
})();
