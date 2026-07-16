import * as SQLite from 'expo-sqlite';

import { initializeBusinessDatabase } from '@/data/database/initialize-business-database';
import {
  parseNativeAcceptanceAction,
  runNativeDatabaseAcceptanceAction,
} from '@/data/database/native-acceptance';
import { verifyCriticalConstraintsInIsolatedDatabase } from '@/data/database/verify-critical-constraints';

const DATABASE_NAME = 'baobao-today.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndInitializeDatabase() {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await initializeBusinessDatabase({
    execAsync: (sql) => database.execAsync(sql),
    getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
    withExclusiveTransactionAsync: (task) =>
      database.withExclusiveTransactionAsync((transaction) =>
        task({
          execAsync: (sql) => transaction.execAsync(sql),
          getFirstAsync: (sql, ...params) => transaction.getFirstAsync(sql, ...params),
          getAllAsync: (sql, ...params) => transaction.getAllAsync(sql, ...params),
          runAsync: (sql, ...params) => transaction.runAsync(sql, ...params),
        }),
      ),
  });

  if (__DEV__) {
    const acceptanceAction = parseNativeAcceptanceAction(
      process.env.EXPO_PUBLIC_NATIVE_DB_ACCEPTANCE,
    );
    void runNativeDatabaseAcceptanceAction(
      {
        getFirstAsync: (sql, ...params) => database.getFirstAsync(sql, ...params),
        runAsync: (sql, ...params) => database.runAsync(sql, ...params),
      },
      acceptanceAction,
      Date.now(),
    )
      .then((result) => console.info('[database] native acceptance action', result))
      .catch((error) => console.error('[database] native acceptance action failed', error));
    void verifyCriticalConstraintsInIsolatedDatabase()
      .then((result) => console.info('[database] isolated native SQLite constraints verified', result))
      .catch((error) => console.error('[database] isolated constraint verification failed', error));
  }
  return database;
}

export function getDatabase() {
  databasePromise ??= openAndInitializeDatabase().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}
