import { getDatabaseStatus } from '../../config/database';

export interface HealthStatus {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  database: {
    state: string;
    connected: boolean;
  };
}

export function getHealthStatus(): HealthStatus {
  const database = getDatabaseStatus();
  return {
    status: database.connected ? 'ok' : 'error',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database,
  };
}
