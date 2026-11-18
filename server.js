import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const ONEID_URL = (process.env.ONEID_URL || 'https://oneid-ruddy.vercel.app').replace(/\/$/, '');
const HELPDESK_URL = (process.env.HELPDESK_URL || 'https://oneid-helpdesk.onrender.com').replace(/\/$/, '');
const ONEID_CLIENT_ID = process.env.ONEID_CLIENT_ID || 'assembly';
const TOTAL_SEATS = 300;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pool = null;
if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asm_parties (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      slogan TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2563eb',
      leader_id TEXT NOT NULL,
      leader_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS asm_members (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      nickname TEXT NOT NULL,
      party_id INT REFERENCES asm_parties(id) ON DELETE SET NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS asm_bills (
      id SERIAL PRIMARY KEY,
      bill_no TEXT NOT NULL,
      service_name TEXT NOT NULL DEFAULT '전체 서비스',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      proposer_id TEXT NOT NULL,
      proposer_name TEXT NOT NULL,
      party_name TEXT NOT NULL DEFAULT '무소속',
      party_color TEXT NOT NULL DEFAULT '#64748b',
      status TEXT NOT NULL DEFAULT 'voting',
      approved_by TEXT,
      enacted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS asm_votes (
      bill_id INT REFERENCES asm_bills(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      party_name TEXT NOT NULL DEFAULT '무소속',
      choice TEXT NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bill_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS asm_speeches (
      id SERIAL PRIMARY KEY,
      bill_id INT REFERENCES asm_bills(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      party_name TEXT NOT NULL DEFAULT '무소속',
      stance TEXT NOT NULL DEFAULT '찬성',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oneid_operating_policies (
      policy_id SERIAL PRIMARY KEY,
      bill_id INT,
      bill_no TEXT NOT NULL,
      service_name TEXT NOT NULL DEFAULT '전체 서비스',
      party_name TEXT NOT NULL DEFAULT '무소속',
      proposer_nickname TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      yes_votes INT NOT NULL DEFAULT 0,
      no_votes INT NOT NULL DEFAULT 0,
      approved_by TEXT NOT NULL,
      enacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE asm_bills ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'new';
    ALTER TABLE asm_bills ADD COLUMN IF NOT EXISTS target_policy_id INT;
    ALTER TABLE asm_bills ADD COLUMN IF NOT EXISTS target_bill_id INT;
  `);

  const { rows: partyRows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM asm_parties');
  if (partyRows[0].cnt === 0) {
    await pool.query(
      `INSERT INTO asm_parties (name, slogan, color, leader_id, leader_name)
       VALUES
         ('자유혁신당', '표현의 자유와 자율적 커뮤니티 생태계 수호', '#3b82f6', 'system', '창당준비위'),
         ('시민질서당', '투명한 운영정책과 공정한 분쟁·소명 심사 확립', '#10b981', 'system', '창당준비위'),
         ('미래창작당', '창작자 권익 보호 및 신규 플랫폼 진흥', '#f59e0b', 'system', '창당준비위')
       ON CONFLICT (name) DO NOTHING`
    );
  }

  const { rows: polRows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM oneid_operating_policies');
  if (polRows[0].cnt === 0) {
    const v1Content = [
      '제1장 총칙',
      '제1조(목적) 본 운영정책은 ONEID 통합 계정으로 연결된 모든 서비스(ATELIER J, PIGSTY, PULSE, DISPATCH, ONE BANK, NEXUS EXCHANGE, JARKET, NOVA, INKVOID, SONORA, FAKEPRESS, KEYWAR, AGORA 등)의 질서 유지와 이용자 권익 보호를 목적으로 한다.',
      '제2조(정책의 제·개정) 모든 운영정책의 신설(제정) 및 수정(개정)은 AGORA 가상 국민의회 발의·표결을 거쳐 총괄관리자(의장)가 최종 승인·공포함으로써 통합 고객센터(HELPDESK)에 즉시 효력을 발생한다.',
      '',
      '제2장 계정 및 보안 (ONEID)',
      '제3조(사칭 금지) 타인의 닉네임이나 운영진·총괄관리자를 사칭하여 혼란을 유발하는 행위를 금한다.',
      '제4조(통합 제재 및 서비스별 제재) 서버 공격·악성 스크립트 유포 등 중대한 생태계 교란 시 ONEID 전체 이용 정지 처분을 내릴 수 있으며, 개별 사이트 규정 위반 시 해당 서비스에 한하여 이용을 제한한다.',
      '',
      '제3장 커뮤니티 · 미디어 (PIGSTY, PULSE, DISPATCH)',
      '제5조(커뮤니티 검열 및 예외 구역) 일반 PIGSTY에서는 자동 검열봇이 작동하며, 제한구역(PIGSTY // DARK) 및 자유 키배 아레나(KEYWAR)에서는 금칙어 자동 검열을 적용하지 아니한다.',
      '제6조(라이브 방송 및 메신저 질서) PULSE 스트리머(BJ) 및 매니저는 방송 방해 시청자에 대해 자체 채금·강퇴 권한을 가진다.',
      '',
      '제4장 가상 금융 · 경제 (ONE BANK, NEXUS EXCHANGE, JARKET)',
      '제7조(가상 자산 및 정산 원칙) 모든 가상 자산의 현금 환전을 금하며, PULSE 방송 후원금은 수수료(0%) 없이 스트리머 계좌로 전액 즉시 정산한다. 비정상 취약점 악용 시 부당 이익 환수 및 계정을 동결한다.',
      '',
      '제5장 이의신청 및 구제 (HELPDESK)',
      '제8조(소명권 보장 및 신속 심사) 정지 처분을 받은 이용자는 비로그인 상태에서도 HELPDESK 통합 고객센터를 통해 소명서를 제출할 권리를 가지며, 오탐이나 참작 사유 인정 시 즉시 정지를 해제한다.'
    ].join('\n');

    await pool.query(
      `INSERT INTO oneid_operating_policies
         (bill_id, bill_no, service_name, party_name, proposer_nickname, title, content, yes_votes, no_votes, approved_by)
       VALUES
         (NULL, '제2026-000호 (v1.0)', '전체 서비스', '의회 합동제정위', '창립의회', 'ATELIER J · ONEID 통합 운영정책 (v1.0)', $1, 300, 0, '총괄관리자')`,
      [v1Content]
    );
  }

  const { rows: billRows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM asm_bills');
  if (billRows[0].cnt === 0) {
    await pool.query(
      `INSERT INTO asm_bills (bill_no, service_name, title, content, proposer_id, proposer_name, party_name, party_color, status, bill_type)
       VALUES
         ('제2026-001호', '전체 서비스', '계정 정지 처분 시 사유 명시 및 고객센터 소명 심사 보장법',
          '제1조(목적) 모든 ONEID 연동 서비스에서 계정 이용 제한 조치 시 명확한 사유를 고지하고, 이용자가 통합 고객센터(HELPDESK)를 통해 소명서를 제출할 권리를 보장한다.\n제2조(신속 심사) 접수된 정지 소명 안건은 공정하게 검토하여 오탐으로 확인될 경우 즉시 정지를 해제한다.',
          'system', '의회법제사법위', '시민질서당', '#10b981', 'voting', 'new'),
         ('제2026-002호', 'PULSE', '실시간 방송 사칭·악성 도배 방지 및 자율 매니저 권한 운영정책안',
          '제1조(방송 질서) 스트리머(BJ) 및 임명된 매니저는 방송 중 악성 도배나 사칭 이용자에 대해 채팅 금지 및 강퇴 조치를 시행할 수 있다.\n제2조(투명 후원) ONE BANK 연동 후원은 수수료 없이 전액 스트리머에게 정산한다.',
          'system', '미디어소위', '자유혁신당', '#3b82f6', 'voting', 'new')`
    );
  }
}

let dbInitialized = false;
let dbInitPromise = null;
async function ensureDb() {
  if (dbInitialized || !pool) return;
  if (!dbInitPromise) {
    dbInitPromise = initDb()
      .then(() => {
        dbInitialized = true;
      })
      .catch((err) => {
        dbInitPromise = null;
        console.error('DB init error:', err.message);
      });
  }
  await dbInitPromise;
}

app.use('/api', async (_req, _res, next) => {
  await ensureDb();
  next();
});

async function verifyOneIdUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const res = await fetch(`${ONEID_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const u = await res.json();
    return {
      id: String(u.id),
      username: u.username,
      nickname: u.nickname || u.username,
      isAdmin: Boolean(u.is_admin),
    };
  } catch {
    return null;
  }
}

function computeSeats(parties) {
  const totalMembers = parties.reduce((acc, p) => acc + p.memberCount, 0);
  if (parties.length === 0) return [];
  if (totalMembers === 0) {
    // Equal baseline distribution among existing parties when no user members yet
    const base = Math.floor(TOTAL_SEATS / parties.length);
    let rem = TOTAL_SEATS - base * parties.length;
    return parties.map((p) => {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      return { ...p, seats: base + extra };
    });
  }
  let assigned = 0;
  const withSeats = parties.map((p) => {
    const seats = Math.floor((p.memberCount / totalMembers) * TOTAL_SEATS);
    assigned += seats;
    return { ...p, seats };
  });
  let rem = TOTAL_SEATS - assigned;
  let idx = 0;
  while (rem > 0 && withSeats.length > 0) {
    withSeats[idx % withSeats.length].seats += 1;
    rem -= 1;
    idx += 1;
  }
  return withSeats;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'assembly', dbConnected: Boolean(pool) });
});

app.get('/api/config', (_req, res) => {
  res.json({
    oneidUrl: ONEID_URL,
    helpdeskUrl: HELPDESK_URL,
    clientId: ONEID_CLIENT_ID,
    totalSeats: TOTAL_SEATS,
  });
});

app.get('/api/overview', async (req, res) => {
  try {
    const user = await verifyOneIdUser(req);

    const { rows: partyRows } = await pool.query(`
      SELECT p.*, COUNT(m.user_id)::int AS member_count
      FROM asm_parties p
      LEFT JOIN asm_members m ON m.party_id = p.id
      GROUP BY p.id
      ORDER BY member_count DESC, p.id ASC
    `);

    const parties = computeSeats(
      partyRows.map((p) => ({
        id: p.id,
        name: p.name,
        slogan: p.slogan,
        color: p.color,
        leaderId: p.leader_id,
        leaderName: p.leader_name,
        memberCount: p.member_count,
      }))
    );

    let myMembership = null;
    if (user) {
      const { rows: memRows } = await pool.query(
        `SELECT m.*, p.name AS party_name, p.color AS party_color
         FROM asm_members m
         LEFT JOIN asm_parties p ON p.id = m.party_id
         WHERE m.user_id = $1`,
        [user.id]
      );
      if (memRows[0]) {
        myMembership = {
          partyId: memRows[0].party_id,
          partyName: memRows[0].party_name || '무소속',
          partyColor: memRows[0].party_color || '#64748b',
        };
      }
    }

    const { rows: billRows } = await pool.query(`
      SELECT * FROM asm_bills ORDER BY id DESC
    `);
    const { rows: voteRows } = await pool.query(`
      SELECT * FROM asm_votes
    `);
    const { rows: speechRows } = await pool.query(`
      SELECT * FROM asm_speeches ORDER BY created_at ASC
    `);

    const votesByBill = new Map();
    for (const v of voteRows) {
      if (!votesByBill.has(v.bill_id)) votesByBill.set(v.bill_id, []);
      votesByBill.get(v.bill_id).push(v);
    }

    const speechesByBill = new Map();
    for (const s of speechRows) {
      if (!speechesByBill.has(s.bill_id)) speechesByBill.set(s.bill_id, []);
      speechesByBill.get(s.bill_id).push({
        id: s.id,
        nickname: s.nickname,
        partyName: s.party_name,
        stance: s.stance,
        content: s.content,
        createdAt: s.created_at,
      });
    }

    const { rows: policyRows } = await pool.query(`
      SELECT * FROM oneid_operating_policies ORDER BY policy_id ASC
    `);
    const policies = policyRows.map((p) => ({
      policyId: p.policy_id,
      billId: p.bill_id,
      billNo: p.bill_no,
      serviceName: p.service_name,
      partyName: p.party_name,
      proposerNickname: p.proposer_nickname,
      title: p.title,
      content: p.content,
      yesVotes: p.yes_votes,
      noVotes: p.no_votes,
      approvedBy: p.approved_by,
      enactedAt: p.enacted_at,
    }));
    const policyMap = new Map(policies.map((p) => [p.policyId, p]));
    const billMap = new Map(billRows.map((b) => [b.id, b]));

    const bills = billRows.map((b) => {
      const bVotes = votesByBill.get(b.id) || [];
      const yesVotes = bVotes.filter((v) => v.choice === 'yes').length;
      const noVotes = bVotes.filter((v) => v.choice === 'no').length;
      const abstainVotes = bVotes.filter((v) => v.choice === 'abstain').length;
      const myVote = user ? bVotes.find((v) => v.user_id === user.id)?.choice || null : null;
      const targetPolicy = b.target_policy_id ? policyMap.get(b.target_policy_id) || null : null;
      const targetBill = b.target_bill_id ? billMap.get(b.target_bill_id) || null : null;
      const targetTitle = targetPolicy
        ? targetPolicy.title
        : targetBill
        ? `${targetBill.bill_no} ${targetBill.title}`
        : null;
      return {
        id: b.id,
        billNo: b.bill_no,
        billType: b.bill_type || 'new',
        targetPolicyId: b.target_policy_id || null,
        targetBillId: b.target_bill_id || null,
        targetPolicyTitle: targetTitle,
        serviceName: b.service_name,
        title: b.title,
        content: b.content,
        proposerId: b.proposer_id,
        proposerName: b.proposer_name,
        partyName: b.party_name,
        partyColor: b.party_color,
        status: b.status,
        approvedBy: b.approved_by,
        enactedAt: b.enacted_at,
        createdAt: b.created_at,
        yesVotes,
        noVotes,
        abstainVotes,
        myVote,
        speeches: speechesByBill.get(b.id) || [],
      };
    });

    res.json({
      totalSeats: TOTAL_SEATS,
      parties,
      policies,
      bills,
      me: user ? { ...user, membership: myMembership } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parties', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '정당을 창당하려면 ONEID 로그인이 필요합니다.' });

  const name = String(req.body?.name || '').trim().slice(0, 24);
  const slogan = String(req.body?.slogan || '').trim().slice(0, 80);
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : '#3b82f6';
  if (name.length < 2) return res.status(400).json({ error: '정당 이름은 2자 이상 입력해 주세요.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO asm_parties (name, slogan, color, leader_id, leader_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, slogan || `${name} 공식 강령`, color, user.id, user.nickname]
    );
    const party = rows[0];
    await pool.query(
      `INSERT INTO asm_members (user_id, username, nickname, party_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET party_id = EXCLUDED.party_id, nickname = EXCLUDED.nickname`,
      [user.id, user.username, user.nickname, party.id]
    );
    res.status(201).json({ ok: true, party });
  } catch (err) {
    res.status(400).json({ error: '이미 존재하는 정당 이름이거나 창당할 수 없습니다.' });
  }
});

app.post('/api/parties/:id/join', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '입당하려면 ONEID 로그인이 필요합니다.' });

  const partyId = Number(req.params.id);
  const targetPartyId = partyId > 0 ? partyId : null;
  try {
    await pool.query(
      `INSERT INTO asm_members (user_id, username, nickname, party_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET party_id = EXCLUDED.party_id, nickname = EXCLUDED.nickname`,
      [user.id, user.username, user.nickname, targetPartyId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bills', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '법안·운영정책을 발의하려면 ONEID 로그인이 필요합니다.' });

  const billType = req.body?.billType === 'amend' ? 'amend' : 'new';
  const targetPolicyId = billType === 'amend' && Number(req.body?.targetPolicyId) > 0 ? Number(req.body.targetPolicyId) : null;
  const targetBillId = billType === 'amend' && Number(req.body?.targetBillId) > 0 ? Number(req.body.targetBillId) : null;
  const serviceName = String(req.body?.serviceName || '전체 서비스').trim().slice(0, 40);
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const content = String(req.body?.content || '').trim().slice(0, 8000);
  if (title.length < 3 || content.length < 5) {
    return res.status(400).json({ error: '법안 제목과 정책 본문을 입력해 주세요.' });
  }
  if (billType === 'amend' && !targetPolicyId && !targetBillId) {
    return res.status(400).json({ error: '개정할 대상 법안 또는 운영정책을 선택해 주세요.' });
  }

  try {
    const { rows: memRows } = await pool.query(
      `SELECT p.name, p.color FROM asm_members m LEFT JOIN asm_parties p ON p.id = m.party_id WHERE m.user_id = $1`,
      [user.id]
    );
    const partyName = memRows[0]?.name || '무소속';
    const partyColor = memRows[0]?.color || '#64748b';

    const { rows: seqRows } = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_no FROM asm_bills');
    const billNo = `제2026-${String(seqRows[0].next_no).padStart(3, '0')}호`;

    const { rows } = await pool.query(
      `INSERT INTO asm_bills (bill_no, bill_type, target_policy_id, target_bill_id, service_name, title, content, proposer_id, proposer_name, party_name, party_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [billNo, billType, targetPolicyId, targetBillId, serviceName, title, content, user.id, user.nickname, partyName, partyColor]
    );
    res.status(201).json({ ok: true, bill: rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bills/:id/vote', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '표결에 참여하려면 ONEID 로그인이 필요합니다.' });

  const billId = Number(req.params.id);
  const choice = req.body?.choice;
  if (!['yes', 'no', 'abstain'].includes(choice)) {
    return res.status(400).json({ error: '올바른 표결 선택이 아닙니다.' });
  }

  try {
    const { rows: memRows } = await pool.query(
      `SELECT p.name FROM asm_members m LEFT JOIN asm_parties p ON p.id = m.party_id WHERE m.user_id = $1`,
      [user.id]
    );
    const partyName = memRows[0]?.name || '무소속';

    await pool.query(
      `INSERT INTO asm_votes (bill_id, user_id, nickname, party_name, choice)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bill_id, user_id) DO UPDATE SET choice = EXCLUDED.choice, nickname = EXCLUDED.nickname, party_name = EXCLUDED.party_name`,
      [billId, user.id, user.nickname, partyName, choice]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bills/:id/speech', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '본회의 발언을 등록하려면 ONEID 로그인이 필요합니다.' });

  const billId = Number(req.params.id);
  const stance = ['찬성', '반대', '중립'].includes(req.body?.stance) ? req.body.stance : '찬성';
  const content = String(req.body?.content || '').trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: '발언 내용을 입력해 주세요.' });

  try {
    const { rows: memRows } = await pool.query(
      `SELECT p.name FROM asm_members m LEFT JOIN asm_parties p ON p.id = m.party_id WHERE m.user_id = $1`,
      [user.id]
    );
    const partyName = memRows[0]?.name || '무소속';

    await pool.query(
      `INSERT INTO asm_speeches (bill_id, user_id, nickname, party_name, stance, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [billId, user.id, user.nickname, partyName, stance, content]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin Promulgation -> Automatically syncs (insert new or update amended) to HELPDESK oneid_operating_policies
app.post('/api/bills/:id/approve', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: '총괄관리자(의장)만 운영정책을 최종 승인·공포할 수 있습니다.' });
  }

  const billId = Number(req.params.id);
  try {
    const { rows: billRows } = await pool.query('SELECT * FROM asm_bills WHERE id = $1', [billId]);
    const bill = billRows[0];
    if (!bill) return res.status(404).json({ error: '법안을 찾을 수 없습니다.' });

    const { rows: voteCounts } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE choice = 'yes')::int AS yes_cnt,
         COUNT(*) FILTER (WHERE choice = 'no')::int AS no_cnt
       FROM asm_votes WHERE bill_id = $1`,
      [billId]
    );
    const yesVotes = voteCounts[0]?.yes_cnt || 0;
    const noVotes = voteCounts[0]?.no_cnt || 0;

    await pool.query(
      `UPDATE asm_bills
       SET status = 'enacted', approved_by = $1, enacted_at = NOW()
       WHERE id = $2`,
      [user.nickname, billId]
    );

    if (bill.bill_type === 'amend' && (bill.target_policy_id || bill.target_bill_id)) {
      if (bill.target_bill_id) {
        await pool.query(
          `UPDATE asm_bills SET title = $1, content = $2, service_name = $3 WHERE id = $4`,
          [bill.title, bill.content, bill.service_name, bill.target_bill_id]
        );
      }
      const whereClause = bill.target_policy_id ? 'WHERE policy_id = $11' : 'WHERE bill_id = $11';
      const targetVal = bill.target_policy_id || bill.target_bill_id;
      const { rowCount } = await pool.query(
        `UPDATE oneid_operating_policies
         SET bill_id = $1,
             bill_no = $2,
             service_name = $3,
             party_name = $4,
             proposer_nickname = $5,
             title = $6,
             content = $7,
             yes_votes = $8,
             no_votes = $9,
             approved_by = $10,
             enacted_at = NOW()
         ${whereClause}`,
        [
          bill.id,
          `${bill.bill_no} (개정)`,
          bill.service_name,
          bill.party_name,
          bill.proposer_name,
          bill.title,
          bill.content,
          yesVotes,
          noVotes,
          user.nickname,
          targetVal,
        ]
      );
      if (rowCount > 0) {
        return res.json({
          ok: true,
          message: '개정안이 최종 승인되어 기존 법안 및 통합 고객센터(HELPDESK) 운영정책이 즉시 업데이트되었습니다!',
        });
      }
    }

    await pool.query('DELETE FROM oneid_operating_policies WHERE bill_id = $1', [billId]);
    await pool.query(
      `INSERT INTO oneid_operating_policies
         (bill_id, bill_no, service_name, party_name, proposer_nickname, title, content, yes_votes, no_votes, approved_by, enacted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        bill.id,
        bill.bill_no,
        bill.service_name,
        bill.party_name,
        bill.proposer_name,
        bill.title,
        bill.content,
        yesVotes,
        noVotes,
        user.nickname,
      ]
    );

    res.json({ ok: true, message: '새 운영정책이 최종 승인되어 통합 고객센터(HELPDESK)에 즉시 공포·반영되었습니다!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bills/:id/reject', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: '총괄관리자(의장) 권한이 필요합니다.' });
  }

  const billId = Number(req.params.id);
  try {
    await pool.query(
      `UPDATE asm_bills SET status = 'rejected', approved_by = $1 WHERE id = $2`,
      [user.nickname, billId]
    );
    await pool.query('DELETE FROM oneid_operating_policies WHERE bill_id = $1', [billId]);
    res.json({ ok: true, message: '해당 법안에 거부권을 행사(폐기)했습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bills/:id', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const billId = Number(req.params.id);
  try {
    const { rows } = await pool.query('SELECT * FROM asm_bills WHERE id = $1', [billId]);
    if (!rows[0]) return res.status(404).json({ error: '법안을 찾을 수 없습니다.' });
    if (!user.isAdmin && rows[0].proposer_id !== user.id) {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }
    await pool.query('DELETE FROM oneid_operating_policies WHERE bill_id = $1', [billId]);
    await pool.query('DELETE FROM asm_bills WHERE id = $1', [billId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`AGORA Virtual Parliament listening on http://localhost:${PORT}`);
  });
}

export default app;
