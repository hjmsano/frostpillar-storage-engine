import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distModulePath = pathToFileURL(
  path.resolve(process.cwd(), 'dist/storage/datastore/Datastore.js'),
).href;

export const loadStorageModule = async () => {
  return await import(distModulePath);
};

export const importDistModule = async (relativeDistPath) => {
  const moduleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist', relativeDistPath),
  ).href;
  return await import(moduleHref);
};
