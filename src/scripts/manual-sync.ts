import { JobSyncService } from '../services/jobSyncService';
import { prisma } from '../lib/database';

import * as fs from 'fs';

async function main() {
  try {
    console.log('Starting manual job sync...');
    const result = await JobSyncService.syncJobsFromAllSources();
    console.log('Sync result:', JSON.stringify(result));
    
    const count = await prisma.jobOpportunity.count();
    console.log(`Total jobs in database: ${count}`);
    
    fs.writeFileSync('job-count.txt', `Total jobs: ${count}`);
  } catch (error) {
    console.error('Sync failed:', error);
    fs.writeFileSync('job-count.txt', `Sync failed: ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
