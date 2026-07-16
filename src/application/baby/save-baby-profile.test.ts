import { saveBabyProfile } from './save-baby-profile';

describe('save baby profile use case', () => {
  test('does not write invalid input to the repository', async () => {
    const repository = { save: jest.fn() };

    const result = await saveBabyProfile(
      { name: ' ', birthDate: '2026-07-10' },
      { repository, todayDate: '2026-07-10', nowMs: 100, createId: () => 'baby-id' },
    );

    expect(result).toEqual({ ok: false, error: { field: 'name', message: '请输入宝宝昵称' } });
    expect(repository.save).not.toHaveBeenCalled();
  });

  test('normalizes and saves valid input', async () => {
    const repository = { save: jest.fn(async (profile) => profile) };

    const result = await saveBabyProfile(
      { name: ' 小宝 ', birthDate: '2026-07-10' },
      { repository, todayDate: '2026-07-10', nowMs: 100, createId: () => 'baby-id' },
    );

    expect(repository.save).toHaveBeenCalledWith({
      id: 'baby-id',
      name: '小宝',
      birthDate: '2026-07-10',
      createdAtMs: 100,
      updatedAtMs: 100,
    });
    expect(result).toEqual({
      ok: true,
      profile: {
        id: 'baby-id',
        name: '小宝',
        birthDate: '2026-07-10',
        createdAtMs: 100,
        updatedAtMs: 100,
      },
    });
  });
});
