(() => {
  const root = document.getElementById('rv-root');
  const token = location.pathname.split('/').filter(Boolean).pop();
  let rating = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 업로드 전 클라이언트에서 리사이즈(가로 최대 1280px) + JPEG 압축(0.8). 대용량 원본 전송 방지.
  function compressImage(file, maxW = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.readAsDataURL(file);
    });
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
        <textarea class="rv-textarea" id="rv-content" maxlength="2000" placeholder="어떤 점이 좋았는지, 무엇을 배웠는지 자유롭게 적어 주세요."></textarea>
        <div class="rv-hint">다른 학부모님께 공개돼요. 이름은 가운데 글자가 자동으로 가려져요.</div>

        <div class="rv-label">이름 (가운데 글자는 자동으로 가려져요) <span style="color:#94a3b8;font-weight:500;">(선택)</span></div>
        <input class="rv-input" id="rv-name" maxlength="20" placeholder="예: 홍길동" autocomplete="off">
        <div class="rv-hint">예: 홍길동 → 홍O동 (두 글자면 홍O). 다른 학부모님껜 가려진 이름만 보여요.</div>

        <div class="rv-label">학년 <span style="color:#94a3b8;font-weight:500;">(선택 · 익명 표시용)</span></div>
        <div class="rv-grade-row" id="rv-grades">
          ${grades.map(g => `<button type="button" class="rv-grade-chip" data-g="${g}">${g}</button>`).join('')}
        </div>

        <div class="rv-label">사진 <span style="color:#94a3b8;font-weight:500;">(선택)</span></div>
        <label class="rv-photo-pick">📷 사진 선택 · 촬영
          <input type="file" id="rv-photo" accept="image/*" capture>
        </label>
        <div class="rv-photo-preview" id="rv-photo-preview">
          <img id="rv-photo-img" alt="미리보기">
          <button type="button" class="rv-photo-remove" id="rv-photo-remove" aria-label="사진 제거">✕</button>
        </div>
        <select class="rv-select" id="rv-photo-type" style="display:none;">
          <option value="work">작품 사진</option>
          <option value="with_person">작품 + 본인 사진</option>
        </select>
        <div class="rv-photo-notice">본인이 나온 사진은 다른 학부모님께 공개돼요. 괜찮을 때만 올려 주세요.</div>

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

    // 사진(선택): 선택 즉시 압축 → 미리보기. 종류 선택은 사진이 있을 때만 노출.
    let photoDataUrl = '';
    const photoInput = document.getElementById('rv-photo');
    const previewEl = document.getElementById('rv-photo-preview');
    const previewImg = document.getElementById('rv-photo-img');
    const photoTypeSel = document.getElementById('rv-photo-type');
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      try {
        photoDataUrl = await compressImage(file);
        previewImg.src = photoDataUrl;
        previewEl.style.display = 'block';
        photoTypeSel.style.display = '';
      } catch (e) {
        alert('사진을 불러올 수 없어요. 다른 사진으로 시도해 주세요.');
        photoDataUrl = ''; photoInput.value = '';
      }
    });
    document.getElementById('rv-photo-remove').addEventListener('click', () => {
      photoDataUrl = ''; photoInput.value = '';
      previewEl.style.display = 'none';
      photoTypeSel.style.display = 'none';
    });

    const submitBtn = document.getElementById('rv-submit');
    submitBtn.addEventListener('click', async () => {
      const content = document.getElementById('rv-content').value.trim();
      if (!content) { alert('후기 내용을 입력해 주세요.'); return; }
      const name = document.getElementById('rv-name').value.trim();
      submitBtn.disabled = true;
      submitBtn.textContent = '등록 중…';
      try {
        const res = await fetch('/api/public/review/' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating: rating || null,
            content,
            grade_label: gradeLabel || null,
            name: name || null,
            photo: photoDataUrl || null,
            photo_type: photoDataUrl ? photoTypeSel.value : null,
          }),
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
