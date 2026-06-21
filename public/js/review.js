(() => {
  const root = document.getElementById('rv-root');
  const token = location.pathname.split('/').filter(Boolean).pop();
  let rating = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // dataURL(base64)의 실제 바이트 크기 추정
  function dataUrlBytes(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor(b64.length * 3 / 4) - pad;
  }

  // JPEG EXIF orientation(1~8) 읽기 — createImageBitmap 미지원 브라우저 폴백용
  function readExifOrientation(buf) {
    try {
      const view = new DataView(buf);
      if (view.getUint16(0, false) !== 0xFFD8) return 1; // JPEG 아님
      const len = view.byteLength;
      let offset = 2;
      while (offset + 4 < len) {
        const marker = view.getUint16(offset, false);
        if (marker === 0xFFE1) { // APP1(Exif)
          if (view.getUint32(offset + 4, false) !== 0x45786966) break; // "Exif"
          const tiff = offset + 10;
          const little = view.getUint16(tiff, false) === 0x4949;
          const dirStart = tiff + view.getUint32(tiff + 4, little);
          const tags = view.getUint16(dirStart, little);
          for (let i = 0; i < tags; i++) {
            const entry = dirStart + 2 + i * 12;
            if (view.getUint16(entry, little) === 0x0112) {
              return view.getUint16(entry + 8, little) || 1;
            }
          }
          break;
        } else if ((marker & 0xFF00) !== 0xFF00) {
          break;
        } else {
          offset += 2 + view.getUint16(offset + 2, false);
        }
      }
    } catch (e) { /* 무시 */ }
    return 1;
  }

  // 업로드 전: 긴 변 최대 1600px 리사이즈 + EXIF 회전 보정 + JPEG 압축(0.7→0.6→…→0.4)으로
  // 1.2MB 이하까지 줄인다. (대용량 원본·세로사진 눕는 문제 방지)
  function compressImage(file, maxSide = 1600, maxBytes = 1.2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const render = (src, srcW, srcH, orientation) => {
        const swap = orientation >= 5 && orientation <= 8; // 90/270도면 가로·세로 스왑
        let w = srcW, h = srcH;
        const longest = Math.max(w, h);
        if (longest > maxSide) { const r = maxSide / longest; w = Math.round(w * r); h = Math.round(h * r); }
        const canvas = document.createElement('canvas');
        canvas.width = swap ? h : w;
        canvas.height = swap ? w : h;
        const ctx = canvas.getContext('2d');
        switch (orientation) {
          case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
          case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
          case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
          case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
          case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
          case 7: ctx.transform(0, -1, -1, 0, h, w); break;
          case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
          default: break;
        }
        ctx.drawImage(src, 0, 0, w, h);
        let quality = 0.7;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (dataUrlBytes(out) > maxBytes && quality > 0.4) {
          quality = Math.round((quality - 0.1) * 10) / 10;
          out = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(out);
      };

      // 1순위: createImageBitmap(from-image) — EXIF 회전 자동 보정(orientation=1로 처리)
      if (window.createImageBitmap) {
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then(bmp => render(bmp, bmp.width, bmp.height, 1))
          .catch(() => fallback());
      } else {
        fallback();
      }

      // 폴백: EXIF 직접 읽어 캔버스 변환 적용(구형 브라우저는 보통 자동 보정을 안 하므로 수동 보정이 맞다)
      function fallback() {
        const reader = new FileReader();
        reader.onload = () => {
          const orientation = readExifOrientation(reader.result);
          const url = URL.createObjectURL(new Blob([reader.result]));
          const img = new Image();
          img.onload = () => {
            try { render(img, img.naturalWidth || img.width, img.naturalHeight || img.height, orientation); }
            finally { URL.revokeObjectURL(url); }
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
          img.src = url;
        };
        reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
        reader.readAsArrayBuffer(file);
      }
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
        <div class="rv-photo-status" id="rv-photo-status" style="display:none;">⏳ 사진 처리 중…</div>
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
    let photoProcessing = false;
    const photoInput = document.getElementById('rv-photo');
    const previewEl = document.getElementById('rv-photo-preview');
    const previewImg = document.getElementById('rv-photo-img');
    const photoTypeSel = document.getElementById('rv-photo-type');
    const photoStatus = document.getElementById('rv-photo-status');
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      // 선택 즉시 빠른 미리보기 + "처리 중" 표시
      const quickUrl = URL.createObjectURL(file);
      previewImg.src = quickUrl;
      previewEl.style.display = 'block';
      photoTypeSel.style.display = 'none';
      photoStatus.style.display = 'block';
      photoProcessing = true;
      photoDataUrl = '';
      try {
        const compressed = await compressImage(file);
        photoDataUrl = compressed;
        previewImg.src = compressed;        // 압축본으로 교체
        photoTypeSel.style.display = '';
      } catch (e) {
        alert('사진을 불러올 수 없어요. 다른 사진으로 시도해 주세요.');
        photoDataUrl = ''; photoInput.value = '';
        previewEl.style.display = 'none';
      } finally {
        URL.revokeObjectURL(quickUrl);
        photoStatus.style.display = 'none';
        photoProcessing = false;
      }
    });
    document.getElementById('rv-photo-remove').addEventListener('click', () => {
      photoDataUrl = ''; photoInput.value = '';
      previewEl.style.display = 'none';
      photoTypeSel.style.display = 'none';
      photoStatus.style.display = 'none';
    });

    const submitBtn = document.getElementById('rv-submit');
    submitBtn.addEventListener('click', async () => {
      const content = document.getElementById('rv-content').value.trim();
      if (!content) { alert('후기 내용을 입력해 주세요.'); return; }
      if (photoProcessing) { alert('사진을 처리 중이에요. 잠시 후 다시 눌러 주세요.'); return; }
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
