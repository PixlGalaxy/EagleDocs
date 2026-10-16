import type { DiskWorkspace } from '../../engine/workspace.js';
import type { CanvasService, CourseView } from './canvas.service.js';

/**
 * Each course of the current term gets a workspace: "<Term>/<Course>/" with a
 * folder for each kind of file. StudyHawk only lays out the folders (nothing
 * from Canvas is copied into them: the agent reads Canvas live); the agent puts
 * the files where they belong, following the note it gets with every message.
 */
export const COURSE_SUBFOLDERS = {
  Canvas: 'material downloaded from Canvas (instructions, packets, slides, readings); download again to refresh it',
  Work: 'work in progress: code, simulations, data, drafts; run code here',
  Assignments: 'finished work ready to submit, one file or folder per assignment',
  Notes: 'study notes, summaries, study guides, flashcards',
} as const;

/** How long a student's folders count as laid out (they are created again only after this, or on a new course). */
const ENSURE_EVERY_MS = 10 * 60 * 1000;

/** "Fall 2026" from the date when Canvas has no term name. */
export function termFor(date: Date): string {
  const month = date.getUTCMonth();
  const season = month <= 4 ? 'Spring' : month <= 6 ? 'Summer' : 'Fall';
  return `${season} ${date.getUTCFullYear()}`;
}

/** A name every file system accepts, readable, without the term repeated. */
export function folderName(text: string, term?: string): string {
  let name = text;
  if (term) name = name.replace(new RegExp(`\\s*[\\(\\[-]?\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[\\)\\]]?`, 'i'), '');
  name = name
    .replace(/[\\/:*?"<>|#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 70)
    .trim();
  return name || 'Course';
}

/** A course's folder: "<Term>/<Course>". */
export function courseFolder(course: Pick<CourseView, 'name' | 'course_code' | 'term'>, fallbackTerm: string): string {
  const term = course.term ?? fallbackTerm;
  return `${folderName(term)}/${folderName(course.name || course.course_code, term)}`;
}

export interface CourseSpace {
  id: number;
  name: string;
  folder: string;
}

/** The note the agent gets with every message: where each course's files go. */
export function courseSpacesNote(spaces: CourseSpace[]): string {
  if (spaces.length === 0) return '';
  return [
    "## Course folders (this term's workspace)",
    "Each course has its own folder: the course's workspace. Keep there what the student will want again later in that course " +
      '(material, their work, finished assignments, notes), not in the chat\'s folder:',
    ...spaces.map((s) => `- ${s.name}: "${s.folder}/"`),
    'Inside each course folder:',
    ...Object.entries(COURSE_SUBFOLDERS).map(([name, what]) => `- ${name}/: ${what}`),
    'For example, for an assignment: canvas_download its material with course_id into Canvas/, read it, do the work in Work/ ' +
      '(code_run with cwd set to that folder), and save the finished result in Assignments/. Create subfolders when they help ' +
      '(e.g. Work/<assignment name>/). Never treat files in Canvas/ as current: Canvas is the source of truth, download again.',
    'Temporary files go in TEMP/ instead (deleted 24 h after their last change): one-off downloads you only need to read once, ' +
      'scratch tests, intermediate files, anything the student will not need later. When unsure whether something is worth ' +
      'keeping for the course, keep it in the course folder.',
  ].join('\n');
}

/** Lays out the current term's course folders and says where they are. */
export class CourseSpaces {
  private ensured = new Map<string, { at: number; key: string }>();

  constructor(
    private canvas: CanvasService,
    private workspace: DiskWorkspace,
  ) {}

  /** The current term's courses and their folders, creating any that are missing. */
  async ensure(userId: string): Promise<CourseSpace[]> {
    const courses = await this.canvas.courses(userId);
    const current = courses.filter((c) => c.current);
    const term = current.find((c) => c.term)?.term ?? termFor(new Date());
    const spaces = current.map((c) => ({ id: c.id, name: c.name, folder: courseFolder(c, term) }));
    const key = spaces.map((s) => s.folder).join('|');
    const last = this.ensured.get(userId);
    if (!last || last.key !== key || Date.now() - last.at > ENSURE_EVERY_MS) {
      for (const s of spaces) {
        for (const sub of Object.keys(COURSE_SUBFOLDERS)) await this.workspace.mkdir(userId, `${s.folder}/${sub}`);
      }
      this.ensured.set(userId, { at: Date.now(), key });
    }
    return spaces;
  }

  /** One course's folder (any term), created with its subfolders. */
  async folderFor(userId: string, courseId: number): Promise<string> {
    const courses = await this.canvas.courses(userId);
    const course = courses.find((c) => c.id === courseId);
    if (!course) throw new Error('That course is not among the student\'s Canvas courses');
    const term = courses.find((c) => c.current && c.term)?.term ?? termFor(new Date());
    const folder = courseFolder(course, term);
    for (const sub of Object.keys(COURSE_SUBFOLDERS)) await this.workspace.mkdir(userId, `${folder}/${sub}`);
    return folder;
  }
}
