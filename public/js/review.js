(() => {
  const root = document.getElementById('rv-root');
  const token = location.pathname.split('/').filter(Boolean).pop();
  let rating = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load() {
    try {
      const res = await fetch('/api/public/review/' + encodeURIComponent(token));
      const j = await res.json();
      if (!j.ok) { root.innerHTML = `<div class="rv-state">⚠️ ${esc(j.error || '유효하지 않은 링크입니다.')}</div>`; return; }
      renderForm(j.program);
    } catch (e) {
      root.innerHTML = '<div class="rv-state">⚠️ 페이지를 불러올 수 없습니다.</div>';
    }
  }

  function renderForm(program) {
    const grades = ['1학년', '2학년', '3학년', '4학년', '5학년', '6학년'];
    root.innerHTML = `
      <div class="rv-card">
        <div class="rv-prog">참여 프로그램<b>${esc(program.title)}</b></div>

        <div class="rv-label">별점 <span style="color:#94a3b8;font-weight:500;">(선택)</span></div>
        <div class="rv-stars" id="rv-stars">
          ${[1, 2, 3, 4, 5].map(n => `<span class="rv-star" data-n="${n}">★</span>`).join('')}
          <button type="button" class="rv-star-clear" id="rv-star-clear" style="display:none;">지우기</button>
        </div>

        <div class="rv-label">후기 내용 <span class="req">*</span></div>
        <textarea class="rv-textarea" id="rv-content" maxlength="2000" placeholder="어떤 점이 좋았는지, 무엇을 배웠는지 자유롭게 적어 주세요. (실명·연락처는 적지 마세요)"></textarea>
        <div class="rv-hint">다른 학부모님께 공개됩니다. 실명·개인정보는 쓰지 말아 주세요.</div>

        <div class="rv-label">학년 <span style="color:#94a3b8;font-weight:500;">(선택 · 익명 표시용)</span></div>
        <div class="rv-grade-row" id="rv-grades">
          ${grades.map(g => `<button type="button" class="rv-grade-chip" data-g="${g}">${g}</button>`).join('')}
        </div>

        <button class="rv-submit" id="rv-submit">후기 등록하기</button>
      </div>
    `;

    const starsEl = document.getElementById('rv-stars');
    const clearBtn = document.getElementById('rv-star-clear');
    function paintStars() {
      starsEl.querySelectorAll('.rv-star').forEach(s => {
        s.classList.toggle('on', Number(s.dataset.n) <= rating);
      });
      clearBtn.style.display = rating > 0 ? '' : 'none';
    }
    starsEl.querySelectorAll('.rv-star').forEach(s => {
      s.addEventListener('click', () => { rating = Number(s.dataset.n); paintStars(); });
    });
    clearBtn.addEventListener('click', () => { rating = 0; paintStars(); });

    let gradeLabel = '';
    document.querySelectorAll('#rv-grades .rv-grade-chip').forEach(c => {
      c.addEventListener('click', () => {
        if (gradeLabel === c.dataset.g) { gradeLabel = ''; c.classList.remove('on'); return; }
        gradeLabel = c.dataset.g;
        document.querySelectorAll('#rv-grades .rv-grade-chip').forEach(x => x.classList.toggle('on', x === c));
      });
    });

    const submitBtn = document.getElementById('rv-submit');
    submitBtn.addEventListener('click', async () => {
      const content = document.getElementById('rv-content').value.trim();
      if (!content) { alert('후기 내용을 입력해 주세요.'); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '등록 중…';
      try {
        const res = await fetch('/api/public/review/' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: rating || null, content, grade_label: gradeLabel || null }),
        });
        const j = await res.json();
        if (!j.ok) { alert(j.error || '등록에 실패했습니다.'); submitBtn.disabled = false; submitBtn.textContent = '후기 등록하기'; return; }
        renderThanks();
      } catch (e) {
        alert('서버에 연결할 수 없습니다.');
        submitBtn.disabled = false;
        submitBtn.textContent = '후기 등록하기';
      }
    });
  }

  function renderThanks() {
    root.innerHTML = `
      <div class="rv-card rv-done">
        <div class="ic">🌱</div>
        <h2>후기가 등록되었어요!</h2>
        <p>소중한 후기 감사합니다.<br>다른 학부모님들께 큰 도움이 됩니다.</p>
      </div>
    `;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  load();
})();
