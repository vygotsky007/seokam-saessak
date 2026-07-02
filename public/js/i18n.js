// 경량 다국어 — 정적 안내 문구만 번역(프로그램명·후기 원문은 유지).
// ⚠ 번역문은 하드코딩이며 원어민 검수가 필요합니다(특히 中文/Tiếng Việt/Русский).
(function () {
  const DICT = {
    ko: {
      lang_name: '한국어',
      title: '🌱 석암초등학교 디지털새싹 신청',
      sub: '2026학년도 디지털새싹 교실 프로그램 신청 페이지입니다.',
      flow1: '학생 정보', flow2: '프로그램 선택', flow3: '신청 완료',
      me_cta: '🔎 이미 신청한 분은 여기서 조회·수정·취소',
      notice_title: '📌 안내',
      notice1: '여러 자녀를 한 번에 신청할 수 있어요.',
      notice2: '프로그램마다 신청할 학생을 따로 선택해요.',
      notice3: '선정 결과는 보호자 연락처로 개별 안내됩니다.',
      section_programs: '📚 모집 중인 프로그램 안내',
      reviews_btn: '프로그램 후기 모음 보기',
      step1_title: '신청 학생 등록',
      step1_desc: '신청할 학생 정보를 먼저 입력하세요. 형제·자매가 함께 신청하면 한 번에 묶어 접수됩니다.',
      guardian_title: '보호자 정보',
      guardian_name: '보호자 이름',
      guardian_phone: '보호자 연락처',
      guardian_inquiry: '문의사항',
      agree: '위 내용에 모두 동의합니다 (필수)',
      submit_hint_default: '신청할 프로그램을 1개 이상 선택해 주세요',
      submit_btn: '신청하기',
      add_to_cart: '담기', in_cart: '담김',
      not_eligible: '학년 미대상', closed: '마감',
    },
    en: {
      lang_name: 'English',
      title: '🌱 Seokam Elem. Digital Saessak Application',
      sub: 'Application page for the 2026 Digital Saessak classroom programs.',
      flow1: 'Student info', flow2: 'Choose programs', flow3: 'Done',
      me_cta: '🔎 Already applied? View / edit / cancel here',
      notice_title: '📌 Notice',
      notice1: 'You can apply for multiple children at once.',
      notice2: 'Choose which child to apply for each program.',
      notice3: 'Selection results are sent individually to the guardian’s phone.',
      section_programs: '📚 Programs now recruiting',
      reviews_btn: 'See program reviews',
      step1_title: 'Register applicants',
      step1_desc: 'Enter each applicant first. Siblings applying together are grouped in one submission.',
      guardian_title: 'Guardian info',
      guardian_name: 'Guardian name',
      guardian_phone: 'Guardian phone',
      guardian_inquiry: 'Question',
      agree: 'I agree to all of the above (required)',
      submit_hint_default: 'Please select at least one program.',
      submit_btn: 'Apply',
      add_to_cart: 'Add', in_cart: 'Added',
      not_eligible: 'Not this grade', closed: 'Full',
    },
    zh: {
      lang_name: '中文',
      title: '🌱 石岩小学 数字新芽 报名',
      sub: '2026学年度 数字新芽课堂项目报名页面。',
      flow1: '学生信息', flow2: '选择项目', flow3: '完成报名',
      me_cta: '🔎 已报名？在此查询·修改·取消',
      notice_title: '📌 须知',
      notice1: '可一次为多个孩子报名。',
      notice2: '请为每个项目分别选择要报名的孩子。',
      notice3: '录取结果将通过监护人电话单独通知。',
      section_programs: '📚 正在招募的项目',
      reviews_btn: '查看项目评价',
      step1_title: '登记报名学生',
      step1_desc: '请先填写每位学生信息。兄弟姐妹一起报名将合并为一次提交。',
      guardian_title: '监护人信息',
      guardian_name: '监护人姓名',
      guardian_phone: '监护人电话',
      guardian_inquiry: '咨询事项',
      agree: '我同意以上全部内容（必填）',
      submit_hint_default: '请至少选择一个项目。',
      submit_btn: '提交报名',
      add_to_cart: '加入', in_cart: '已加入',
      not_eligible: '非该年级', closed: '已满',
    },
    vi: {
      lang_name: 'Tiếng Việt',
      title: '🌱 Đăng ký Digital Saessak — Tiểu học Seokam',
      sub: 'Trang đăng ký chương trình lớp học Digital Saessak năm 2026.',
      flow1: 'Thông tin học sinh', flow2: 'Chọn chương trình', flow3: 'Hoàn tất',
      me_cta: '🔎 Đã đăng ký? Xem / sửa / hủy tại đây',
      notice_title: '📌 Hướng dẫn',
      notice1: 'Có thể đăng ký nhiều con cùng lúc.',
      notice2: 'Chọn con muốn đăng ký cho từng chương trình.',
      notice3: 'Kết quả sẽ được thông báo riêng qua điện thoại phụ huynh.',
      section_programs: '📚 Chương trình đang tuyển',
      reviews_btn: 'Xem đánh giá chương trình',
      step1_title: 'Đăng ký học sinh',
      step1_desc: 'Nhập thông tin từng học sinh trước. Anh chị em đăng ký cùng sẽ được gộp một lần.',
      guardian_title: 'Thông tin phụ huynh',
      guardian_name: 'Tên phụ huynh',
      guardian_phone: 'Điện thoại phụ huynh',
      guardian_inquiry: 'Câu hỏi',
      agree: 'Tôi đồng ý với tất cả nội dung trên (bắt buộc)',
      submit_hint_default: 'Vui lòng chọn ít nhất một chương trình.',
      submit_btn: 'Đăng ký',
      add_to_cart: 'Thêm', in_cart: 'Đã thêm',
      not_eligible: 'Không đúng khối', closed: 'Đã đầy',
    },
    ru: {
      lang_name: 'Русский',
      title: '🌱 Начальная школа Сокам — заявка Digital Saessak',
      sub: 'Страница заявки на программы Digital Saessak 2026 года.',
      flow1: 'Данные ученика', flow2: 'Выбор программ', flow3: 'Готово',
      me_cta: '🔎 Уже подали? Посмотреть / изменить / отменить здесь',
      notice_title: '📌 Информация',
      notice1: 'Можно подать заявку сразу на нескольких детей.',
      notice2: 'Для каждой программы выберите нужного ребёнка.',
      notice3: 'Результаты отбора сообщаются индивидуально на телефон родителя.',
      section_programs: '📚 Идёт набор',
      reviews_btn: 'Отзывы о программах',
      step1_title: 'Регистрация учеников',
      step1_desc: 'Сначала введите каждого ученика. Братья и сёстры подаются одной заявкой.',
      guardian_title: 'Данные родителя',
      guardian_name: 'Имя родителя',
      guardian_phone: 'Телефон родителя',
      guardian_inquiry: 'Вопрос',
      agree: 'Я согласен(на) со всем вышеизложенным (обязательно)',
      submit_hint_default: 'Выберите хотя бы одну программу.',
      submit_btn: 'Подать заявку',
      add_to_cart: 'Добавить', in_cart: 'Добавлено',
      not_eligible: 'Другой класс', closed: 'Мест нет',
    },
  };
  const ORDER = ['ko', 'en', 'zh', 'vi', 'ru'];
  const KEY = 'saessak_lang';

  function current() {
    try { const v = localStorage.getItem(KEY); if (v && DICT[v]) return v; } catch {}
    return 'ko';
  }
  function t(key, lang) { const L = DICT[lang || current()] || DICT.ko; return L[key] != null ? L[key] : (DICT.ko[key] || ''); }

  function apply(lang) {
    lang = DICT[lang] ? lang : 'ko';
    try { localStorage.setItem(KEY, lang); } catch {}
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh' : lang === 'vi' ? 'vi' : lang);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = t(el.getAttribute('data-i18n'), lang);
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const v = t(el.getAttribute('data-i18n-ph'), lang);
      if (v) el.setAttribute('placeholder', v);
    });
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    // 외부(예: public.js)에서 동적 문구 갱신할 수 있도록 이벤트 발행.
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  function renderToggle(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = ORDER.map(l =>
      `<button type="button" class="lang-btn" data-lang="${l}">${DICT[l].lang_name}</button>`).join('');
    el.querySelectorAll('.lang-btn').forEach(b => b.addEventListener('click', () => apply(b.dataset.lang)));
  }

  window.SaessakI18n = { t, apply, current, renderToggle, langs: ORDER };
  document.addEventListener('DOMContentLoaded', () => {
    renderToggle('lang-toggle');
    apply(current());
  });
})();
