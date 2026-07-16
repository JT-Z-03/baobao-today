import {
  createPoopPhotoPath,
  isManagedPoopPhotoPath,
} from './managed-photo-path';

describe('managed poop photo paths', () => {
  test('creates a stable path for a create request', () => {
    expect(createPoopPhotoPath('123e4567-e89b-12d3-a456-426614174000')).toBe(
      'poop-photos/123e4567-e89b-12d3-a456-426614174000.jpg',
    );
  });

  test.each([
    '../photo.jpg',
    'poop-photos/../photo.jpg',
    'other/photo.jpg',
    'poop-photos/nested/photo.jpg',
    'poop-photos/photo.png',
    '/poop-photos/photo.jpg',
  ])('rejects paths outside the exact managed directory: %s', (path) => {
    expect(isManagedPoopPhotoPath(path)).toBe(false);
  });
});
