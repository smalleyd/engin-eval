import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importJobs } from './importer.js';
import { loadJobs, saveJobs } from './storage.js';
import { importGreenhouseJobs } from './greenhouse.js';

const usage =
  'Usage: npm start -- <feed.xml> [saved-jobs.json]\n       npm start -- greenhouse [greenhouse-jobs.json]\nDefault XML saved file: ./jobs.json';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage);
    return;
  }
  if (
    args.length < 1 ||
    args.length > 2 ||
    args.some((arg) => arg.startsWith('-'))
  ) {
    throw new Error(usage);
  }
  const input = resolve(args[0]!);
  const greenhouse = args[0] === 'greenhouse';
  const output = resolve(
    args[1] ?? (greenhouse ? 'greenhouse-jobs.json' : 'jobs.json'),
  );
  let outputExists = true;
  const existingOutput = await realpath(output).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        outputExists = false;
        return output;
      }
      throw error;
    },
  );
  if (
    !greenhouse &&
    (input === output || (await realpath(input)) === existingOutput)
  ) {
    throw new Error('Input XML and saved JSON must be different files');
  }
  const saved = await loadJobs(output);
  const result = greenhouse
    ? await importGreenhouseJobs(saved)
    : importJobs(await readFile(input, 'utf8'), saved);
  // Preserve the file byte-for-byte on no-op runs, but create a missing empty store.
  if (JSON.stringify(saved) !== JSON.stringify(result.jobs) || !outputExists) {
    await saveJobs(output, result.jobs);
  }
  const { added, updated, unchanged, newlyClosed } = result.counts;
  console.log(
    `Added: ${added}; updated: ${updated}; unchanged: ${unchanged}; newly closed: ${newlyClosed}`,
  );
  for (const rejection of result.rejections) {
    console.error(
      `Rejected ID ${JSON.stringify(rejection.id)}${rejection.row ? ` (row ${rejection.row})` : ''}: ${rejection.reason}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    `Import failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
