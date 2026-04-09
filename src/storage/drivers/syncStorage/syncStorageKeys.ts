export const SYNC_STORAGE_MAGIC = 'FPSYNC_META';
export const SYNC_STORAGE_VERSION = 2;

export const manifestKey = (keyPrefix: string, databaseKey: string): string => {
  return `${keyPrefix}:sync:${databaseKey}:manifest`;
};

export const chunkKey = (
  keyPrefix: string,
  databaseKey: string,
  generation: number,
  index: number,
): string => {
  return `${keyPrefix}:sync:${databaseKey}:g:${generation}:chunk:${index}`;
};
