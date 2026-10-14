// Sample data for `npm run dev:mock`. Never bundled in production builds.
import type {
  CanvasAnnouncement,
  CanvasCourse,
  CanvasItem,
  Chat,
  Connection,
  Institution,
  Memory,
  RagSummary,
  Message,
  ModelOption,
  Schedule,
  Skill,
  Tier,
  User,
  WorkspaceEntry,
} from '../types';
import type { AdminUserRow, ModelEndpoint, NodeRow, SandboxRow } from '../admin';

const now = Date.now();
const iso = (offsetHours: number) => new Date(now + offsetHours * 3600 * 1000).toISOString();

export const institutions: Institution[] = [
  {
    id: 'inst-fgcu',
    name: 'Florida Gulf Coast University',
    slug: 'fgcu',
    canvas_base_url: 'https://fgcu.instructure.com',
    degreeworks_url: 'https://degreeworks.fgcu.edu',
    sso_login_url: 'https://login.microsoftonline.com',
    outlook_url: 'https://outlook.office.com/mail/',
    enabled: true,
    domains: [
      { id: 'd1', domain: 'fgcu.edu', include_subdomains: true },
      { id: 'd2', domain: 'eagle.fgcu.edu', include_subdomains: false },
    ],
    skills: {},
    user_count: 214,
  },
];

const baseUser = {
  avatar_path: null,
  status: 'active' as const,
  institution_id: 'inst-fgcu',
  institution_name: 'Florida Gulf Coast University',
  tier_id: 'tier-free',
  language: 'en',
  timezone: 'America/New_York',
  theme_mode: 'system',
  theme_skin: 'eagle',
  created_at: iso(-24 * 40),
  updated_at: iso(-2),
};

export const users: AdminUserRow[] = [
  { ...baseUser, id: 'u-admin', email: 'admin@eagledocs.org', username: 'pixl', display_name: 'Pixl Galaxy', role: 'admin', major: 'Software Engineering', last_seen_at: iso(-0.2), verification_expires_at: null },
  { ...baseUser, id: 'u-1', email: 'mrodriguez4521@eagle.fgcu.edu', username: 'mrodriguez', display_name: 'Mariana Rodríguez', role: 'user', major: 'Accounting', last_seen_at: iso(-5), verification_expires_at: null },
  { ...baseUser, id: 'u-2', email: 'tbeckett@eagle.fgcu.edu', username: 'tbeckett', display_name: 'Theo Beckett', role: 'user', major: 'Biology', last_seen_at: iso(-30), verification_expires_at: null },
  {
    ...baseUser,
    id: 'u-3',
    email: 'jnakamura@eagle.fgcu.edu',
    username: 'jnakamura',
    display_name: 'Jun Nakamura',
    role: 'user',
    status: 'pending',
    major: null,
    last_seen_at: null,
    verification_expires_at: iso(51),
  },
];

export const asUser = (row: AdminUserRow): User => {
  const { last_seen_at: _a, verification_expires_at: _b, ...user } = row;
  void _a;
  void _b;
  return user;
};

export const chats: Chat[] = [
  { id: 'c1', title: 'Week 9 deadlines', model_ref: 'auto', created_at: iso(-3), updated_at: iso(-3), active_job_id: null },
  { id: 'c2', title: 'ACG 2021 study plan', model_ref: 'auto', created_at: iso(-30), updated_at: iso(-28), active_job_id: null },
  { id: 'c3', title: 'Lab report outline', model_ref: 'codex:conn-codex:gpt-5', created_at: iso(-80), updated_at: iso(-79), active_job_id: null },
  { id: 'c4', title: 'Degree map, spring and fall', model_ref: 'auto', created_at: iso(-24 * 12), updated_at: iso(-24 * 12), active_job_id: null },
];

export const messages: Record<string, Message[]> = {
  c1: [
    { id: 'm1', role: 'user', content: 'What do I have due this week?', model_ref: null, created_at: iso(-3) },
    {
      id: 'm2',
      role: 'assistant',
      content:
        'You have **3 things due** before Sunday:\n\n| Course | Item | Due | Estimate |\n|---|---|---|---|\n| ACG 2021 | Guided Practice 6 | Wed 11:59 PM | 1.5 h |\n| MAN 3025 | Connect Quiz 4 | Thu | 1 h |\n| ENC 1102 | Draft 2 | Sat | 3 h |\n\nStart with **Draft 2**: a new announcement says the rubric changed on Monday.',
      model_ref: 'codex:conn-codex:gpt-5',
      model_label: 'Auto -> GPT-5',
      tool_calls: [
        { id: 't1', name: 'canvas.upcoming', args: { days: 7 }, status: 'done', result_preview: '3 items' },
        { id: 't2', name: 'canvas.announcements', args: { since: '7d' }, status: 'done', result_preview: '1 announcement in ENC 1102' },
      ],
      created_at: iso(-3),
    },
  ],
};

export const modelOptions: ModelOption[] = [
  { ref: 'eagledocs:ep1:azulai', provider: 'eagledocs', label: 'AzulAI (GPT-OSS 20B)', source_label: 'EagleDocs', tags: ['smart'], supports_tools: true, supports_vision: false },
  { ref: 'eagledocs:ep1:gemma4', provider: 'eagledocs', label: 'Gemma 4 E4B', source_label: 'EagleDocs', tags: ['fast', 'vision'], supports_tools: true, supports_vision: true },
  { ref: 'codex:conn-codex:gpt-5', provider: 'codex', label: 'GPT-5', source_label: 'ChatGPT (mariana@...)', tags: ['smart', 'code'], supports_tools: true, supports_vision: true },
  { ref: 'codex:conn-codex:gpt-5-codex', provider: 'codex', label: 'GPT-5 Codex', source_label: 'ChatGPT (mariana@...)', tags: ['code'], supports_tools: true, supports_vision: false },
];

export const connections: Connection[] = [
  { id: 'conn-canvas', kind: 'canvas', provider: null, label: 'Canvas', status: 'ok', last_ok_at: iso(-1), last_error: null, meta: {} },
  { id: 'conn-codex', kind: 'codex', provider: 'openai', label: 'ChatGPT', status: 'ok', last_ok_at: iso(-2), last_error: null, meta: { email: 'mariana.r@gmail.com' } },
  { id: 'conn-key1', kind: 'api_key', provider: 'deepseek', label: 'DeepSeek', status: 'ok', last_ok_at: iso(-50), last_error: null, meta: { key_hint: '...k3Qz' } },
];

export const courses: CanvasCourse[] = [
  { id: 101, name: 'Principles of Financial Accounting', course_code: 'ACG 2021', term: 'Fall 2026', current_score: 91.4, current_grade: 'A-' },
  { id: 102, name: 'Principles of Management', course_code: 'MAN 3025', term: 'Fall 2026', current_score: 84.2, current_grade: 'B' },
  { id: 103, name: 'Composition II', course_code: 'ENC 1102', term: 'Fall 2026', current_score: 88.7, current_grade: 'B+' },
  { id: 104, name: 'Art History I', course_code: 'ARH 2000', term: 'Fall 2026', current_score: null, current_grade: null },
];

export const upcoming: CanvasItem[] = [
  { id: 'a1', course_id: 101, course_name: 'ACG 2021', kind: 'assignment', title: 'Guided Practice 6', due_at: iso(20), points: 20, submitted: false, missing: false, estimate_hours: 1.5, priority: 78, html_url: '#' },
  { id: 'a2', course_id: 102, course_name: 'MAN 3025', kind: 'quiz', title: 'Connect Quiz 4', due_at: iso(44), points: 15, submitted: false, missing: false, estimate_hours: 1, priority: 61, html_url: '#' },
  { id: 'a3', course_id: 103, course_name: 'ENC 1102', kind: 'assignment', title: 'Draft 2: Argumentative Essay', due_at: iso(92), points: 50, submitted: false, missing: false, estimate_hours: 3, priority: 72, html_url: '#' },
  { id: 'a4', course_id: 103, course_name: 'ENC 1102', kind: 'discussion', title: 'Peer review replies', due_at: iso(93), points: 10, submitted: true, missing: false, estimate_hours: 0.5, priority: 20, html_url: '#' },
  { id: 'a5', course_id: 104, course_name: 'ARH 2000', kind: 'event', title: 'Museum visit (Wilson Hall)', due_at: iso(140), points: null, submitted: false, missing: false, estimate_hours: null, priority: null, html_url: '#' },
];

export const announcements: CanvasAnnouncement[] = [
  { id: 1, course_id: 103, title: 'Updated rubric for Draft 2', posted_at: iso(-40), preview: 'I added a section on counterarguments to the rubric. Please review it before submitting.', html_url: '#' },
  { id: 2, course_id: 101, title: 'Office hours moved to Thursday', posted_at: iso(-70), preview: 'This week only, office hours are Thursday 2 to 4 PM in Lutgert 2201.', html_url: '#' },
];

export const files: Record<string, WorkspaceEntry[]> = {
  '': [
    { name: 'TEMP', path: 'TEMP', type: 'dir', size: 0, modified_at: iso(-1), temp: true },
    { name: 'Fall 2026', path: 'Fall 2026', type: 'dir', size: 0, modified_at: iso(-30) },
    { name: 'drafts', path: 'drafts', type: 'dir', size: 0, modified_at: iso(-3) },
    { name: 'degreeworks', path: 'degreeworks', type: 'dir', size: 0, modified_at: iso(-24 * 12) },
    { name: 'ACG2021_GuidedPractice6.docx', path: 'ACG2021_GuidedPractice6.docx', type: 'file', size: 48211, modified_at: iso(-5) },
    { name: 'study-plan-week9.md', path: 'study-plan-week9.md', type: 'file', size: 2310, modified_at: iso(-28) },
  ],
  TEMP: [{ name: 'canvas', path: 'TEMP/canvas', type: 'dir', size: 0, modified_at: iso(-1) }],
  'TEMP/canvas': [
    { name: 'Ch05Lecture.docx', path: 'TEMP/canvas/Ch05Lecture.docx', type: 'file', size: 81233, modified_at: iso(-1) },
    { name: 'Chapter Study Guide 1-6.pdf', path: 'TEMP/canvas/Chapter Study Guide 1-6.pdf', type: 'file', size: 412876, modified_at: iso(-1) },
  ],
  'Fall 2026': ['ACG 2021', 'MAR 3023', 'MAN 3025'].map((name) => ({ name, path: `Fall 2026/${name}`, type: 'dir' as const, size: 0, modified_at: iso(-30) })),
  drafts: [{ name: 'email-prof-martinez.md', path: 'drafts/email-prof-martinez.md', type: 'file', size: 812, modified_at: iso(-79) }],
  degreeworks: [{ name: 'audit-2026-10-01.json', path: 'degreeworks/audit-2026-10-01.json', type: 'file', size: 18233, modified_at: iso(-24 * 12) }],
};

export const rags: RagSummary[] = [
  {
    id: 'acg-2021',
    name: 'ACG 2021',
    description: 'Lectures, guided practice and exam topics for Intro to Financial Accounting.',
    model: 'nomic-embed-text:latest',
    chunks: 611,
    sources: [
      { path: 'TEMP/canvas/Ch05Lecture.docx', pages: 1, chunks: 15, added_at: iso(-2) },
      { path: 'TEMP/canvas/Packet Lecture.docx', pages: 1, chunks: 115, added_at: iso(-2) },
      { path: 'TEMP/canvas-pages/569770/Grade allocation.md', pages: 1, chunks: 3, added_at: iso(-2) },
    ],
    size_mb: 2.5,
    created_at: iso(-2),
    updated_at: iso(-2),
  },
  {
    id: 'mar-3023',
    name: 'MAR 3023',
    description: 'Study guide and chapter slides for Introduction to Marketing.',
    model: 'nomic-embed-text:latest',
    chunks: 233,
    sources: [{ path: 'TEMP/canvas-mar3023/Chapter Study Guide 1-6.pdf', pages: 14, chunks: 28, added_at: iso(-1) }],
    size_mb: 0.9,
    created_at: iso(-1),
    updated_at: iso(-1),
  },
];

export const memories: Memory[] = [
  { id: 'mem1', content: 'Majoring in Accounting, graduating Spring 2028.', source: 'agent', created_at: iso(-24 * 20) },
  { id: 'mem2', content: 'Works at the campus library Tuesdays and Thursdays 1 to 5 PM.', source: 'user', created_at: iso(-24 * 9) },
  { id: 'mem3', content: 'Prefers email drafts in simple English, then a Spanish summary.', source: 'agent', created_at: iso(-24 * 3) },
];

export const skills: Skill[] = [
  { slug: 'canvas-lms', name: 'Canvas', description: 'Courses, assignments, deadlines, workload estimates and study plans.', builtin: true, enabled: true, notes: [] },
  {
    slug: 'academic-email',
    name: 'School email',
    description: 'Read and search your school inbox; drafts need your approval.',
    builtin: true,
    enabled: true,
    notes: [{ id: 'n1', note: 'Always CC my advisor on emails about grades.', created_at: iso(-200) }],
  },
  { slug: 'degreeworks-map', name: 'Degree map', description: 'Semester-by-semester plan from your Degree Works audit.', builtin: true, enabled: true, notes: [] },
  { slug: 'study-coaching', name: 'Study coaching', description: 'Quick study aids and practice questions for exams.', builtin: true, enabled: true, notes: [] },
  { slug: 'docx', name: 'Word documents', description: 'Create, read and fill Word templates.', builtin: true, enabled: true, notes: [] },
  { slug: 'pdf', name: 'PDF', description: 'Read, merge, fill and OCR PDF files.', builtin: true, enabled: false, notes: [] },
  { slug: 'lab-reports', name: 'CHM 2045 lab reports', description: 'When I ask for lab report help in chemistry.', builtin: false, enabled: true, notes: [], body_md: '## Steps\n1. Ask for my raw data first.\n2. Use the template in /workspace/chem.' },
];

export const schedules: Schedule[] = [
  { id: 's1', name: 'Monday briefing', cron: '0 8 * * 1', prompt: 'Summarize what is due this week in Canvas and anything urgent in my email.', enabled: true, next_run_at: iso(100), last_run_at: iso(-68) },
];

export const tiers: Tier[] = [
  { id: 'tier-free', name: 'Free', price_cents: 0, currency: 'usd', stripe_price_id: null, cpu: 0.5, mem_mb: 512, disk_mb: 5120, daily_messages: 100, max_background_jobs: 1, max_schedules: 3, is_default: true, enabled: true },
  { id: 'tier-plus', name: 'Plus', price_cents: 499, currency: 'usd', stripe_price_id: 'price_123', cpu: 1, mem_mb: 1024, disk_mb: 15360, daily_messages: 400, max_background_jobs: 2, max_schedules: 10, is_default: false, enabled: true },
  { id: 'tier-pro', name: 'Pro', price_cents: 999, currency: 'usd', stripe_price_id: 'price_456', cpu: 2, mem_mb: 2048, disk_mb: 30720, daily_messages: 1000, max_background_jobs: 4, max_schedules: 25, is_default: false, enabled: false },
];

export const endpoints: ModelEndpoint[] = [
  {
    id: 'ep1',
    kind: 'ollama',
    name: 'Zaylar GPU',
    base_url: 'http://192.168.0.150:11434',
    enabled: true,
    models: [
      { id: 'mdl1', model_name: 'gpt-oss:20b', display_name: 'AzulAI (GPT-OSS 20B)', tags: ['smart'], supports_tools: true, supports_vision: false, enabled: true },
      { id: 'mdl2', model_name: 'gemma4:e4b', display_name: 'Gemma 4 E4B', tags: ['fast', 'vision'], supports_tools: true, supports_vision: true, enabled: true },
      { id: 'mdl3', model_name: 'qwen3-coder:30b', display_name: 'Qwen3 Coder', tags: ['code'], supports_tools: true, supports_vision: false, enabled: false },
    ],
  },
];

export const nodes: NodeRow[] = [
  { id: 'node-1', hostname: 'zaylar', version: '2.0.0', started_at: iso(-72), heartbeat_at: iso(-0.003), online: true, sandboxes_active: 3, jobs_running: 2 },
  { id: 'node-2', hostname: 'unraid-b', version: '2.0.0', started_at: iso(-30), heartbeat_at: iso(-0.004), online: true, sandboxes_active: 1, jobs_running: 0 },
];

export const sandboxes: SandboxRow[] = [
  { user_id: 'u-1', username: 'mrodriguez', node_id: 'node-1', status: 'running', cpu_percent: 12, mem_mb: 287, mem_limit_mb: 512, disk_used_mb: 214, disk_limit_mb: 5120, last_active_at: iso(-0.1) },
  { user_id: 'u-2', username: 'tbeckett', node_id: 'node-1', status: 'running', cpu_percent: 44, mem_mb: 461, mem_limit_mb: 512, disk_used_mb: 802, disk_limit_mb: 5120, last_active_at: iso(-0.05) },
  { user_id: 'u-admin', username: 'pixl', node_id: 'node-2', status: 'running', cpu_percent: 3, mem_mb: 120, mem_limit_mb: 2048, disk_used_mb: 1400, disk_limit_mb: 10240, last_active_at: iso(-0.3) },
];
