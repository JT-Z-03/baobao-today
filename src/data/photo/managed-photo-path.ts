const managedPhotoPattern = /^poop-photos\/[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$/;

export function isManagedPoopPhotoPath(path: string) {
  return managedPhotoPattern.test(path);
}

export function createPoopPhotoPath(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error('照片标识格式无效');
  }
  return `poop-photos/${id}.jpg`;
}
