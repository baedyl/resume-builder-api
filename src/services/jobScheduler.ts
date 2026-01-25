import { JobSyncService } from './jobSyncService';

export class JobScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  static start(): void {
    if (this.intervalId) {
      console.log('Job scheduler is already running');
      return;
    }

    // Default sync interval: 1 hour (3600000 milliseconds)
    const syncInterval = (Number(process.env.JOB_SYNC_INTERVAL_MINUTES) || 60) * 60 * 1000;

    console.log(`Starting job scheduler with ${syncInterval / 1000 / 60} minute intervals`);

    // Run initial sync after 1 minute
    setTimeout(() => {
      this.runScheduledSync();
    }, 60 * 1000);

    // Set up recurring sync
    this.intervalId = setInterval(() => {
      this.runScheduledSync();
    }, syncInterval);

    console.log('Job scheduler started successfully');
  }

  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Job scheduler stopped');
    } else {
      console.log('Job scheduler is not running');
    }
  }

  static async runScheduledSync(): Promise<void> {
    if (this.isRunning) {
      console.log('Job sync already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('Running scheduled job sync...');

      const result = await JobSyncService.syncJobsFromAllSources();

      const duration = Date.now() - startTime;
      console.log(`Scheduled job sync completed in ${duration}ms:`, result);

      // Clean up old jobs occasionally (once per day)
      if (Math.random() < 0.1) { // 10% chance per sync
        await JobSyncService.cleanupInactiveJobs(30);
      }

    } catch (error) {
      console.error('Scheduled job sync failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  static getStatus(): {
    isRunning: boolean;
    isScheduled: boolean;
    nextSyncIn?: number;
  } {
    const isScheduled = this.intervalId !== null;

    let nextSyncIn: number | undefined;
    if (isScheduled && this.intervalId) {
      // This is approximate - would need more complex tracking for exact timing
      const syncInterval = (Number(process.env.JOB_SYNC_INTERVAL_MINUTES) || 60) * 60 * 1000;
      nextSyncIn = syncInterval - (Date.now() % syncInterval);
    }

    return {
      isRunning: this.isRunning,
      isScheduled,
      nextSyncIn
    };
  }

  // Manual trigger for testing
  static async triggerSync(): Promise<{ successCount: number; failureCount: number }> {
    console.log('Manual job sync triggered');
    return await JobSyncService.syncJobsFromAllSources();
  }
}
