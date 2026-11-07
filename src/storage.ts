// import { readFile, rename, unlink, open } from 'node:fs/promises';
// import { dirname, basename, join } from 'node:path';
// import { randomUUID } from 'node:crypto';
import { type Job, /* validApplyUrl */ } from './importer.js';
import { Sequelize, Model, DataTypes } from 'sequelize';

const sequelize: Sequelize = new Sequelize("sqlite:db.lite", {})

const StringType = { type: DataTypes.STRING, allowNull: false };

class Posting extends Model {}
Posting.init(
  {
    id: { ...StringType, primaryKey: true },
    title: { ...StringType },
    location: { ...StringType },
    description: { ...StringType },
    applyUrl: { ...StringType },
    status: { ...StringType },
  },
  {
    sequelize,
    tableName: 'jobs',
    timestamps: false,
  },
);

await sequelize.sync({ alter: true });

export async function loadJobs(_path: string): Promise<Job[]> {

  /*
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const data: unknown = JSON.parse(contents);
  if (!Array.isArray(data))
    throw new Error('Saved JSON must be an array of jobs');
  const ids = new Set<string>();
  for (const value of data) {
    const job = value as Partial<Job> | null;
    if (
      !job ||
      typeof job !== 'object' ||
      !['id', 'title', 'location', 'description', 'applyUrl'].every(
        (field) => typeof (job as Record<string, unknown>)[field] === 'string',
      ) ||
      !job.id?.trim() ||
      job.id !== job.id.trim() ||
      !job.title?.trim() ||
      job.title !== job.title.trim() ||
      !job.applyUrl ||
      !validApplyUrl(job.applyUrl) ||
      (job.status !== 'open' && job.status !== 'closed')
    ) {
      throw new Error(
        'Saved JSON contains an invalid job; refusing to overwrite it',
      );
    }
    if (ids.has(job.id))
      throw new Error(
        `Saved JSON contains duplicate ID ${JSON.stringify(job.id)}`,
      );
    ids.add(job.id);
  }
  return data as Job[];

   */
  const records = await Posting.findAll();

  return records.map((job) => job.toJSON()) as Job[];
}

/** Replace only after a complete write; a failed write leaves the old file intact. */
export async function saveJobs(
  _path: string,
  jobs: Job[],  // Removed 'readonly' to assign to records. DLS on 11/6/2026.
): Promise<void> {

  sequelize.transaction(async _t => {
    await Posting.truncate();

    if (!jobs.length) return;

    const records: any[] = jobs;
    await Posting.bulkCreate(records);
  }).catch(e => {
    console.error("SAVE_JOBS failed:", e);
  });

  /*
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

   */
}
