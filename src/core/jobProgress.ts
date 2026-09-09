// Pure job-progress computation for a workflow run.

export interface JobInfo {
  name: string;
  status: string; // queued | in_progress | completed | waiting
  conclusion: string | null;
}

export interface RunProgress {
  total: number;
  completed: number;
  // 0..100 integer; 0 when total is 0.
  percent: number;
  // Name of a currently-running job, if any (first in_progress job).
  currentJob?: string;
}

// Compute progress from the run's job list. Pure and total.
export function computeJobProgress(jobs: JobInfo[]): RunProgress {
  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.find((j) => j.status === "in_progress");
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return {
    total,
    completed,
    percent,
    currentJob: running?.name,
  };
}