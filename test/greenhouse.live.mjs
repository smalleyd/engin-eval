// Explicit opt-in: no local store is read or written, and no job data is printed.
import { fetchGreenhouseJobs } from '../dist/greenhouse.js';

try {
  const jobs = await fetchGreenhouseJobs();
  console.log(
    `Greenhouse live check passed: fetched ${jobs.length} live external job posts.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Greenhouse live check failed',
  );
  process.exitCode = 1;
}
