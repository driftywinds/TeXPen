import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'InkTexModelCache';
const STORE_NAME = 'models';
const DB_VERSION = 1;

let db: IDBPDatabase | null = null;

const initDB = async (): Promise<IDBPDatabase> => {
  if (db) {
    return db;
  }

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    },
  });

  return db;
};

export const storeModelInCache = async (key: string, data: Uint8Array): Promise<void> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.store.put(data, key);
    await tx.done;
    console.log(`Model ${key} stored in cache.`);
  } catch (error) {
    console.error(`Failed to store model ${key} in cache:`, error);
  }
};

export const getModelFromCache = async (key: string): Promise<Uint8Array | undefined> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const data = await tx.store.get(key);
    await tx.done;
    if (data) {
      console.log(`Model ${key} loaded from cache.`);
    }
    return data;
  } catch (error) {
    console.error(`Failed to get model ${key} from cache:`, error);
    return undefined;
  }
};

export const areModelsCached = async (urls: string[]): Promise<boolean> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const results = await Promise.all(
      urls.map(url => tx.store.get(url))
    );
    
    // Ensure the transaction is complete before returning
    await tx.done;

    // If any result is undefined, it means a model is not cached
    if (results.some(data => !data)) {
      return false;
    }
    
    console.log('All models are cached.');
    return true;
  } catch (error) {
    console.error('Failed to check if models are cached:', error);
    return false;
  }
};
