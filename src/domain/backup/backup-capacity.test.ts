/** @jest-environment node */

import { assertBackupEntryCapacity, BACKUP_CAPACITY_LIMITS, backupUtf8ByteLength } from './backup-capacity';
import { serializeBackupRecords, serializeBackupRecordsWithByteLength } from './backup-manifest';
import type { BackupRecord } from './backup-types';

const encoder = new TextEncoder();

describe('backup UTF-8 byte counting', () => {
  test('matches the native UTF-8 encoder for every single UTF-16 code unit, including lone surrogates', () => {
    for (let code = 0; code <= 0xffff; code++) {
      const text = String.fromCharCode(code);
      if (backupUtf8ByteLength(text) !== encoder.encode(text).length) {
        throw new Error(`UTF-8 byte mismatch at code unit ${code.toString(16)}`);
      }
    }
  });

  test('matches the encoder for mixed valid pairs, lone surrogates, combining marks and JSON escapes', () => {
    const corpus = ['', 'ASCII\0\r\n', '宝宝今天', '🍼👨‍👩‍👧‍👦', 'e\u0301', '\ud800', '\udc00',
      '\ud800\udc00', '\udbff\udfff', '\ud800\ud800\udc00', '\udc00\ud800', '\ud800x\udc00'];
    let seed = 0x51031;
    const units = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff];
    for (let sample = 0; sample < 1000; sample++) {
      let text = '';
      for (let index = 0; index < sample % 127; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        text += String.fromCharCode(sample % 2 ? seed & 0xffff : units[seed % units.length]);
      }
      corpus.push(text);
    }
    for (const text of corpus) {
      expect(backupUtf8ByteLength(text)).toBe(encoder.encode(text).length);
      const serialized = JSON.stringify({ text });
      expect(backupUtf8ByteLength(serialized)).toBe(encoder.encode(serialized).length);
    }
  });

  test('retains the exact 16 MiB boundary for multibyte text and the existing rejection message', () => {
    const limit = BACKUP_CAPACITY_LIMITS.recordsJsonBytes;
    const text = '宝'.repeat(Math.floor(limit / 3)) + 'a'.repeat(limit % 3);
    const bytes = backupUtf8ByteLength(text);
    expect(bytes).toBe(encoder.encode(text).length);
    expect(bytes).toBe(limit);
    expect(() => assertBackupEntryCapacity('records.json', bytes)).not.toThrow();
    expect(() => assertBackupEntryCapacity('records.json', backupUtf8ByteLength(text + 'a'))).toThrow(
      '记录数据超过当前完整备份的16 MiB容量上限，当前资料未改变。',
    );
  });

  test('keeps compact JSON bytes and stops before serializing later records after a capacity rejection', () => {
    const records = [{ note: '宝🍼\ud800\udc00\ud800\udfff\udc00' }] as BackupRecord[];
    expect(serializeBackupRecords(records)).toBe(`${JSON.stringify(records)}\n`);
    const laterRecord = { toJSON: jest.fn(() => { throw new Error('must not reach later record'); }) };
    const tooLarge = [{ note: 'a'.repeat(BACKUP_CAPACITY_LIMITS.recordsJsonBytes) }, laterRecord] as unknown as BackupRecord[];
    expect(() => serializeBackupRecords(tooLarge)).toThrow(/记录数据超过.*16 MiB/);
    expect(laterRecord.toJSON).not.toHaveBeenCalled();
  });

  test.each([
    { name: 'empty array', records: [] },
    { name: 'multiple records with Unicode and escapes', records: [{ note: '宝宝🍼' }, { note: '"\n\ud800' }] },
  ])('returns the encoded byte length including delimiters and newline for $name', ({ records }) => {
    const content = `${JSON.stringify(records)}\n`;
    expect(serializeBackupRecordsWithByteLength(records as BackupRecord[])).toEqual({
      content,
      byteLength: encoder.encode(content).length,
    });
  });
});
