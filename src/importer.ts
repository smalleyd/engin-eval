import { SaxesParser } from 'saxes';

export interface SourceJob {
  id: string;
  title: string;
  location: string;
  description: string;
  applyUrl: string;
}

export interface Job extends SourceJob {
  status: 'open' | 'closed';
}

export interface Rejection {
  id: string;
  row?: number;
  reason: string;
}

const fields = ['id', 'title', 'location', 'description', 'applyUrl'] as const;
type Field = (typeof fields)[number];
const isField = (name: string): name is Field =>
  fields.some((field) => field === name);

/** Strict XML parsing; collect only direct <job> children and their known fields. */
function parseRows(xml: string): Partial<SourceJob>[] {
  const parser = new SaxesParser();
  const path: string[] = [];
  const rows: Partial<SourceJob>[] = [];
  let row: Partial<SourceJob> | undefined;
  let field: Field | undefined;
  parser.on('doctype', () => {
    throw new Error('DOCTYPE declarations are not supported');
  });
  parser.on('error', (error) => {
    throw new Error(`Invalid XML: ${error.message}`);
  });
  parser.on('opentag', (tag) => {
    path.push(tag.name);
    if (path.length === 1 && tag.name !== 'jobs') {
      throw new Error('Root element must be <jobs>');
    }
    if (path.length === 2 && tag.name === 'job') row = {};
    if (row && path.length === 3 && isField(tag.name)) {
      field = tag.name;
      if (row[field] !== undefined)
        throw new Error(`Repeated <${field}> in job row ${rows.length + 1}`);
      row[field] = '';
    }
  });
  const appendText = (text: string) => {
    if (row && field) row[field] = (row[field] ?? '') + text;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    if (path.length === 3) field = undefined;
    if (path.length === 2 && row) {
      rows.push(row);
      row = undefined;
    }
    path.pop();
  });
  parser.write(xml).close();
  return rows;
}

export function validApplyUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
    );
  } catch {
    return false;
  }
}

function sameData(a: SourceJob, b: SourceJob): boolean {
  return fields.every((field) => a[field] === b[field]);
}

export function importJobs(xml: string, saved: readonly Job[]) {
  const rows = parseRows(xml);
  // Validate all IDs before making any changes, including closures.
  const normalized = rows.map((row, index): SourceJob => {
    const id = row.id?.trim();
    if (!id)
      throw new Error(
        `Job row ${index + 1} is missing a nonblank ID; entire import rejected`,
      );
    return {
      id,
      title: row.title?.trim() ?? '',
      location: row.location ?? '',
      description: row.description ?? '',
      applyUrl: row.applyUrl?.trim() ?? '',
    };
  });
  const present = new Set(normalized.map((job) => job.id));
  const accepted = new Map<string, SourceJob>();
  const rejected = new Set<string>();
  const rejections: Rejection[] = [];
  normalized.forEach((job, index) => {
    const reasons: string[] = [];
    if (!job.title) reasons.push('title must not be blank');
    if (!validApplyUrl(job.applyUrl))
      reasons.push('applyUrl must be a full HTTP or HTTPS URL');
    if (reasons.length) {
      rejected.add(job.id);
      rejections.push({
        id: job.id,
        row: index + 1,
        reason: reasons.join('; '),
      });
      return;
    }
    const previous = accepted.get(job.id);
    if (previous && !sameData(previous, job)) {
      rejected.add(job.id);
      rejections.push({
        id: job.id,
        row: index + 1,
        reason: 'conflicting valid rows for this ID',
      });
    } else if (!previous) {
      accepted.set(job.id, job);
    }
  });
  for (const id of rejected) accepted.delete(id);

  const counts = { added: 0, updated: 0, unchanged: 0, newlyClosed: 0 };
  const jobs: Job[] = saved.map((previous) => {
    const incoming = accepted.get(previous.id);
    if (incoming) {
      accepted.delete(previous.id);
      if (previous.status === 'open' && sameData(previous, incoming)) {
        counts.unchanged++;
        return { ...previous };
      }
      counts.updated++;
      return { ...incoming, status: 'open' };
    }
    if (!present.has(previous.id) && previous.status === 'open') {
      counts.newlyClosed++;
      return { ...previous, status: 'closed' };
    }
    // Rejected saved records and already-closed missing records are unchanged.
    counts.unchanged++;
    return { ...previous };
  });
  for (const job of accepted.values()) {
    jobs.push({ ...job, status: 'open' });
    counts.added++;
  }
  return { jobs, counts, rejections };
}
