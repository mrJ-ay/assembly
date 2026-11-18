const TOKEN_KEY = 'assembly_oneid_token';
const VERIFIER_KEY = 'assembly_oneid_verifier';
const STATE_KEY = 'assembly_oneid_state';

let cfg = {
  oneidUrl: 'https://oneid-ruddy.vercel.app',
  helpdeskUrl: 'https://oneid-helpdesk.onrender.com',
  clientId: 'assembly',
  totalSeats: 300,
};

let token = localStorage.getItem(TOKEN_KEY) || '';
let stateData = {
  totalSeats: 300,
  parties: [],
  bills: [],
  me: null,
};
let statusFilter = 'all';

const oneidBtn = document.getElementById('oneidBtn');
const myPartyBadge = document.getElementById('myPartyBadge');
const rulingPartyBadge = document.getElementById('rulingPartyBadge');
const seatChart = document.getElementById('seatChart');
const seatLegend = document.getElementById('seatLegend');
const partyList = document.getElementById('partyList');
const billList = document.getElementById('billList');
const statusFilterPills = document.getElementById('statusFilterPills');

const partyModal = document.getElementById('partyModal');
const openCreatePartyBtn = document.getElementById('openCreatePartyBtn');
const closePartyModalBtn = document.getElementById('closePartyModalBtn');
const partyForm = document.getElementById('partyForm');

const proposeModal = document.getElementById('proposeModal');
const openProposeBtn = document.getElementById('openProposeBtn');
const closeProposeModalBtn = document.getElementById('closeProposeModalBtn');
const proposeForm = document.getElementById('proposeForm');

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function startOneIdLogin() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(digest);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const redirectUri = `${location.origin}${location.pathname}`;
  const query = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    state,
  });
  location.assign(`${cfg.oneidUrl}/login.html?${query.toString()}`);
}

async function handleOneIdCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  const state = params.get('state');
  const expected = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  history.replaceState(null, '', location.pathname);
  if (!verifier || !state || state !== expected) return;

  const res = await fetch(`${cfg.oneidUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      redirect_uri: `${location.origin}${location.pathname}`,
      code,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (res.ok && data.access_token) {
    token = data.access_token;
    localStorage.setItem(TOKEN_KEY, token);
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 처리 실패');
  return data;
}

async function loadOverview() {
  try {
    stateData = await api('/api/overview');
    renderAll();
  } catch (err) {
    billList.innerHTML = `<div class="empty-box">${escapeHtml(err.message)}</div>`;
  }
}

function renderAll() {
  const me = stateData.me;
  if (me) {
    oneidBtn.textContent = `${me.nickname}${me.isAdmin ? ' (👑 의장)' : ''} · 로그아웃`;
    myPartyBadge.hidden = false;
    const pName = me.membership?.partyName || '무소속';
    const pColor = me.membership?.partyColor || '#64748b';
    myPartyBadge.textContent = `소속: ${pName}`;
    myPartyBadge.style.borderColor = pColor;
  } else {
    oneidBtn.textContent = 'ONEID 로그인';
    myPartyBadge.hidden = true;
  }

  renderHemicycle(stateData.parties || []);
  renderParties(stateData.parties || []);
  renderBills(stateData.bills || []);
}

function renderHemicycle(parties) {
  if (parties.length > 0) {
    const top = [...parties].sort((a, b) => b.seats - a.seats)[0];
    rulingPartyBadge.textContent = `원내 제1당: ${top.name} (${top.seats}석)`;
  } else {
    rulingPartyBadge.textContent = '정당 없음';
  }

  // Generate 300 seat coordinates in semicircular rows
  const rows = [32, 38, 44, 50, 56, 80]; // sum = 300
  const radii = [95, 118, 141, 164, 187, 212];
  const points = [];
  for (let r = 0; r < rows.length; r++) {
    const count = rows[r];
    const radius = radii[r];
    for (let i = 0; i < count; i++) {
      const angle = Math.PI - (i / (count - 1)) * Math.PI;
      const x = 250 + radius * Math.cos(angle);
      const y = 240 - radius * Math.sin(angle);
      points.push({ x, y, angle });
    }
  }
  points.sort((a, b) => b.angle - a.angle);

  const seatColors = [];
  for (const p of parties) {
    for (let i = 0; i < p.seats; i++) seatColors.push(p.color);
  }
  while (seatColors.length < 300) seatColors.push('#334155');

  seatChart.innerHTML = points
    .map(
      (pt, i) =>
        `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.2" fill="${seatColors[i]}" />`
    )
    .join('');

  seatLegend.innerHTML = parties
    .map(
      (p) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${escapeHtml(p.color)}"></span>
        <strong>${escapeHtml(p.name)}</strong>
        <span>${p.seats}석 (${p.memberCount}명)</span>
      </div>
    `
    )
    .join('');
}

function renderParties(parties) {
  const myPartyId = stateData.me?.membership?.partyId || null;
  partyList.innerHTML = parties
    .map((p) => {
      const isMine = myPartyId === p.id;
      return `
        <div class="party-row" style="border-left-color:${escapeHtml(p.color)}">
          <div class="party-info">
            <h4>${escapeHtml(p.name)} <span style="color:${escapeHtml(p.color)}">(${p.seats}석)</span></h4>
            <p>${escapeHtml(p.slogan)}</p>
            <div class="party-meta">대표: ${escapeHtml(p.leaderName)} · 당원 ${p.memberCount}명</div>
          </div>
          <div>
            ${
              isMine
                ? `<span class="badge">소속 정당</span>`
                : `<button type="button" class="btn small" data-join-party="${p.id}">입당하기</button>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  partyList.querySelectorAll('[data-join-party]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!stateData.me) return startOneIdLogin();
      try {
        await api(`/api/parties/${btn.dataset.joinParty}/join`, { method: 'POST' });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderBills(bills) {
  const filtered = bills.filter((b) => statusFilter === 'all' || b.status === statusFilter);
  if (!filtered.length) {
    billList.innerHTML = '<div class="empty-box">조건에 맞는 법안·운영정책 안건이 없습니다.</div>';
    return;
  }

  const isAdmin = Boolean(stateData.me?.isAdmin);
  billList.innerHTML = filtered
    .map((b) => {
      const totalV = b.yesVotes + b.noVotes;
      const yesPct = totalV === 0 ? 50 : Math.round((b.yesVotes / totalV) * 100);
      const noPct = totalV === 0 ? 50 : 100 - yesPct;

      const statusBadge =
        b.status === 'enacted'
          ? `<span class="badge enacted">📜 공포됨 · 고객센터 반영 완료 (승인: ${escapeHtml(b.approvedBy || '의장')})</span>`
          : b.status === 'rejected'
          ? `<span class="badge rejected">⛔ 거부권 행사 · 폐기됨</span>`
          : `<span class="badge voting">🗳️ 본회의 표결 중</span>`;

      const adminControls = isAdmin
        ? `
          <div class="admin-btns">
            ${
              b.status !== 'enacted'
                ? `<button type="button" class="btn small approve" data-approve-bill="${b.id}">👑 최종 승인 · 고객센터 반영</button>`
                : ''
            }
            ${
              b.status !== 'rejected'
                ? `<button type="button" class="btn small no" data-reject-bill="${b.id}">⛔ 거부권(폐기)</button>`
                : ''
            }
            <button type="button" class="btn small" data-delete-bill="${b.id}">삭제</button>
          </div>
        `
        : '';

      const speechesHtml = (b.speeches || [])
        .map(
          (s) => `
          <div class="speech-item">
            <span class="stance-tag ${escapeHtml(s.stance)}">${escapeHtml(s.stance)}</span>
            <strong>${escapeHtml(s.nickname)}</strong>
            <span style="color:#94a3b8;font-size:11px;">(${escapeHtml(s.partyName)})</span>:
            ${escapeHtml(s.content)}
          </div>
        `
        )
        .join('');

      return `
        <article class="bill-card status-${escapeHtml(b.status)}">
          <div class="bill-top">
            <div class="bill-badges">
              <span class="badge">${escapeHtml(b.billNo)}</span>
              <span class="badge" style="color:#fbbf24;">적용: ${escapeHtml(b.serviceName)}</span>
              <span class="badge" style="border-color:${escapeHtml(b.partyColor)}">${escapeHtml(b.partyName)} · 발의 ${escapeHtml(b.proposerName)}</span>
              ${statusBadge}
            </div>
            <span style="font-size:12px;color:#94a3b8;">${formatDate(b.createdAt)}</span>
          </div>

          <h3 class="bill-title">${escapeHtml(b.title)}</h3>
          <div class="bill-body">${escapeHtml(b.content)}</div>

          <div class="vote-bar-wrap">
            <div class="vote-progress">
              <div class="vote-fill-yes" style="width:${yesPct}%"></div>
              <div class="vote-fill-no" style="width:${noPct}%"></div>
            </div>
            <div class="vote-actions-row">
              <div class="vote-btns">
                <button type="button" class="btn small yes ${b.myVote === 'yes' ? 'vote-btn-active' : ''}" data-vote-bill="${b.id}" data-choice="yes">
                  👍 찬성 (${b.yesVotes})
                </button>
                <button type="button" class="btn small no ${b.myVote === 'no' ? 'vote-btn-active' : ''}" data-vote-bill="${b.id}" data-choice="no">
                  👎 반대 (${b.noVotes})
                </button>
                <button type="button" class="btn small ${b.myVote === 'abstain' ? 'vote-btn-active' : ''}" data-vote-bill="${b.id}" data-choice="abstain">
                  ⚪ 기권 (${b.abstainVotes})
                </button>
              </div>
              ${adminControls}
            </div>
          </div>

          <div class="speeches-box">
            <div class="speech-list">
              ${speechesHtml || '<div style="font-size:12px;color:#64748b;">아직 등록된 본회의 토론 발언이 없습니다.</div>'}
            </div>
            <form class="speech-form" data-speech-form="${b.id}">
              <select name="stance">
                <option value="찬성">찬성 발언</option>
                <option value="반대">반대 발언</option>
                <option value="중립">중립 발언</option>
              </select>
              <input name="content" type="text" maxlength="500" placeholder="본회의 찬반 토론 발언을 남겨주세요..." required />
              <button type="submit" class="btn small">발언 등록</button>
            </form>
          </div>
        </article>
      `;
    })
    .join('');

  billList.querySelectorAll('[data-vote-bill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!stateData.me) return startOneIdLogin();
      try {
        await api(`/api/bills/${btn.dataset.voteBill}/vote`, {
          method: 'POST',
          body: { choice: btn.dataset.choice },
        });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  billList.querySelectorAll('[data-approve-bill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 안건을 최종 승인하여 통합 고객센터(HELPDESK) 공식 운영정책으로 즉시 공포하시겠습니까?')) return;
      try {
        const res = await api(`/api/bills/${btn.dataset.approveBill}/approve`, { method: 'POST' });
        alert(res.message);
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  billList.querySelectorAll('[data-reject-bill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 안건에 거부권을 행사하여 폐기하시겠습니까?')) return;
      try {
        await api(`/api/bills/${btn.dataset.rejectBill}/reject`, { method: 'POST' });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  billList.querySelectorAll('[data-delete-bill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 안건을 완전히 삭제하시겠습니까?')) return;
      try {
        await api(`/api/bills/${btn.dataset.deleteBill}`, { method: 'DELETE' });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  billList.querySelectorAll('[data-speech-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!stateData.me) return startOneIdLogin();
      const stance = form.elements.stance.value;
      const content = form.elements.content.value.trim();
      if (!content) return;
      try {
        await api(`/api/bills/${form.dataset.speechForm}/speech`, {
          method: 'POST',
          body: { stance, content },
        });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// Events
oneidBtn.addEventListener('click', () => {
  if (stateData.me) {
    if (!confirm('로그아웃하시겠습니까?')) return;
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    loadOverview();
  } else {
    startOneIdLogin().catch((err) => alert(err.message));
  }
});

statusFilterPills.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  statusFilter = btn.dataset.filter;
  statusFilterPills.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p === btn));
  renderBills(stateData.bills || []);
});

openCreatePartyBtn.addEventListener('click', () => {
  if (!stateData.me) return startOneIdLogin();
  partyModal.hidden = false;
});
closePartyModalBtn.addEventListener('click', () => { partyModal.hidden = true; });

partyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/parties', {
      method: 'POST',
      body: {
        name: document.getElementById('partyNameInput').value.trim(),
        slogan: document.getElementById('partySloganInput').value.trim(),
        color: document.getElementById('partyColorInput').value,
      },
    });
    partyForm.reset();
    partyModal.hidden = true;
    await loadOverview();
  } catch (err) {
    alert(err.message);
  }
});

openProposeBtn.addEventListener('click', () => {
  if (!stateData.me) return startOneIdLogin();
  proposeModal.hidden = false;
});
closeProposeModalBtn.addEventListener('click', () => { proposeModal.hidden = true; });

proposeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/bills', {
      method: 'POST',
      body: {
        serviceName: document.getElementById('billServiceSelect').value,
        title: document.getElementById('billTitleInput').value.trim(),
        content: document.getElementById('billContentInput').value.trim(),
      },
    });
    proposeForm.reset();
    proposeModal.hidden = true;
    await loadOverview();
  } catch (err) {
    alert(err.message);
  }
});

(async function init() {
  try {
    const c = await fetch('/api/config');
    if (c.ok) cfg = await c.json();
  } catch {}
  await handleOneIdCallback();
  await loadOverview();
})();
