import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const assetDirectory = path.join(projectRoot, 'assets/ui');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// This is the approved display contract, independent of editable manifest values.
const assetContract = {
  'feeding.png': [144, 144, 'template'],
  'poop-light.png': [144, 144, 'full-color'],
  'poop-dark.png': [144, 144, 'full-color'],
  'pee.png': [144, 144, 'template'],
  'sleep.png': [144, 144, 'template'],
  'other.png': [144, 144, 'template'],
  'milk-volume.png': [144, 144, 'template'],
  'breastfeeding.png': [144, 144, 'template'],
  'brand-flower.png': [96, 96, 'template'],
  'baby-smile.png': [384, 384, 'full-color'],
  'baby-sleeping.png': [480, 320, 'full-color'],
  'happiness-note.png': [480, 200, 'template'],
};

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const diagonalDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= diagonalDistance) return left;
  return aboveDistance <= diagonalDistance ? above : upperLeft;
}

// Decode the small, non-interlaced 8-bit PNGs produced by the approved pipeline.
// Inspect actual alpha samples: an RGBA header alone does not prove transparency.
export function inspectUiPng(bytes, { file, width, height, colorMode }) {
  assert.ok(bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature), `${file}: invalid PNG signature.`);
  let offset = 8;
  let channels = 0;
  let sawHeader = false;
  let sawEnd = false;
  const imageData = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${file}: truncated PNG chunk.`);
    const length = bytes.readUInt32BE(offset);
    assert.ok(length <= bytes.length - offset - 12, `${file}: invalid PNG chunk length.`);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!sawHeader) assert.equal(type, 'IHDR', `${file}: IHDR must be the first chunk.`);
    if (type === 'IHDR') {
      assert.equal(sawHeader, false, `${file}: duplicate IHDR.`);
      assert.equal(length, 13, `${file}: invalid IHDR length.`);
      assert.equal(data.readUInt32BE(0), width, `${file}: wrong width.`);
      assert.equal(data.readUInt32BE(4), height, `${file}: wrong height.`);
      assert.equal(data[8], 8, `${file}: expected 8-bit samples.`);
      assert.ok(data[9] === 4 || data[9] === 6, `${file}: expected grayscale-alpha or RGBA, not an opaque PNG.`);
      assert.equal(data[10], 0, `${file}: unsupported compression.`);
      assert.equal(data[11], 0, `${file}: unsupported PNG filter method.`);
      assert.equal(data[12], 0, `${file}: export a non-interlaced PNG.`);
      channels = data[9] === 6 ? 4 : 2;
      sawHeader = true;
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      assert.equal(length, 0, `${file}: invalid IEND.`);
      sawEnd = true;
      offset += 12;
      break;
    }
    offset += length + 12;
  }
  assert.ok(sawHeader && sawEnd && imageData.length > 0, `${file}: incomplete PNG.`);
  assert.equal(offset, bytes.length, `${file}: unexpected data after IEND.`);

  const stride = width * channels;
  const decodedLength = height * (stride + 1);
  const decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: decodedLength });
  assert.equal(decoded.length, decodedLength, `${file}: unexpected decompressed size.`);
  let previous = Buffer.alloc(stride);
  let transparent = 0;
  let opaque = 0;
  let partial = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = decoded[start];
    assert.ok(filter <= 4, `${file}: unsupported scanline filter.`);
    const row = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) predictor = paeth(left, above, upperLeft);
      row[x] = (decoded[start + 1 + x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const pixel = x * channels;
      const alpha = row[pixel + channels - 1];
      if (alpha === 0) transparent++;
      else if (alpha === 255) opaque++;
      else partial++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        assert.equal(alpha, 0, `${file}: artwork touches the canvas edge; preserve transparent padding.`);
      }
      if (colorMode === 'template' && alpha > 0) {
        for (let channel = 0; channel < channels - 1; channel++) {
          assert.equal(row[pixel + channel], 0, `${file}: template ink must be monochrome black for tintColor.`);
        }
      }
    }
    previous = row;
  }
  assert.ok(transparent > 0, `${file}: no fully transparent pixels; an opaque matte is not allowed.`);
  assert.ok(opaque > 0, `${file}: no fully opaque artwork; the asset is empty or faded.`);
  return { transparent, opaque, partial };
}

export async function verifyUiAssets() {
  const manifest = JSON.parse(await readFile(path.join(assetDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1, 'UI manifest schemaVersion must be 1.');
  assert.ok(Array.isArray(manifest.assets), 'UI manifest must contain an assets array.');
  const expectedFiles = Object.keys(assetContract).sort();
  const files = manifest.assets.map((asset) => {
    assert.ok(asset && typeof asset === 'object', 'Invalid UI manifest entry.');
    assert.ok(typeof asset.file === 'string' && /^[a-z-]+\.png$/.test(asset.file), 'UI file names must be local PNG basenames.');
    return asset.file;
  });
  assert.equal(new Set(files).size, files.length, 'Duplicate UI manifest file.');
  assert.deepEqual([...files].sort(), expectedFiles, 'UI manifest must cover exactly the 12 approved PNGs.');
  const diskEntries = await readdir(assetDirectory, { withFileTypes: true });
  assert.ok(diskEntries.every((entry) => entry.isFile()), 'Keep generated source folders outside assets/ui.');
  assert.deepEqual(diskEntries.map((entry) => entry.name).sort(), [...expectedFiles, 'manifest.json'].sort(), 'assets/ui must contain only the 12 runtime PNGs and manifest.json.');
  const diskFiles = diskEntries
    .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(diskFiles, expectedFiles, 'Runtime UI PNGs and the manifest must match exactly.');

  for (const asset of manifest.assets) {
    const [width, height, colorMode] = assetContract[asset.file];
    assert.deepEqual([asset.width, asset.height, asset.colorMode], [width, height, colorMode], `${asset.file}: manifest contradicts the approved asset contract.`);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.file}: invalid SHA-256.`);
    assert.ok(asset.source && typeof asset.source.reference === 'string' && asset.source.reference.trim(), `${asset.file}: missing source reference.`);
    assert.ok(typeof asset.source.method === 'string' && asset.source.method.trim(), `${asset.file}: missing preparation method.`);
    const sourcePath = path.resolve(projectRoot, asset.source.reference);
    const relativeSource = path.relative(projectRoot, sourcePath);
    assert.ok(relativeSource && relativeSource !== '..' && !relativeSource.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeSource), `${asset.file}: source reference must stay inside this project.`);
    assert.ok((await stat(sourcePath)).isFile(), `${asset.file}: source reference is missing.`);
    const bytes = await readFile(path.join(assetDirectory, asset.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.file}: SHA-256 differs from the reviewed manifest.`);
    inspectUiPng(bytes, asset);
  }
  console.log(`UI asset contract verified (${manifest.assets.length} PNG files; dimensions, alpha, padding, sources and SHA-256).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await verifyUiAssets();
}
