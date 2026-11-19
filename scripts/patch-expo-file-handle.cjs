// expo-file-system 57.0.7 loses the ParcelFileDescriptor owner for content URIs.
// AutoClose streams keep it alive through FileChannel and close it with the handle.
// Fail closed on any upstream change so this patch is reviewed during upgrades.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const VERSION = '57.0.7';
const ORIGINAL_SHA256 = '5e895678dee61fa14cdf3fb94f7d4afbbf8ac535791992f6965f9b0591f1a4c2';
const PATCHED_SHA256 = '40545a024351ee12a711482acfa77ea873762a5e5a1b20e5535faa03169fe26a';
const relativeSource = 'android/src/main/java/expo/modules/filesystem/FileSystemFileHandle.kt';

const before = `    fun forContentURI(uri: Uri, mode: FileMode, contentResolver: ContentResolver): FileSystemFileHandle {
      val pfd = contentResolver.openFileDescriptor(uri, mode.descriptor)
        ?: throw Exceptions.IllegalStateException("Could not open file descriptor for uri: $uri")

      val channel = when (mode) {
        FileMode.READ -> FileInputStream(pfd.fileDescriptor).channel
        FileMode.WRITE, FileMode.APPEND, FileMode.TRUNCATE -> FileOutputStream(pfd.fileDescriptor).channel
        else -> throw Exceptions.IllegalArgument("Unsupported file mode: '$mode'")
      }

      return FileSystemFileHandle(channel, mode)
    }`;

const after = `    fun forContentURI(uri: Uri, mode: FileMode, contentResolver: ContentResolver): FileSystemFileHandle {
      if (mode == FileMode.READ_WRITE) {
        throw Exceptions.IllegalArgument("Unsupported file mode: '$mode'")
      }
      val pfd = contentResolver.openFileDescriptor(uri, mode.descriptor)
        ?: throw Exceptions.IllegalStateException("Could not open file descriptor for uri: $uri")

      try {
        val channel = when (mode) {
          FileMode.READ -> ParcelFileDescriptor.AutoCloseInputStream(pfd).channel
          FileMode.WRITE, FileMode.APPEND, FileMode.TRUNCATE -> ParcelFileDescriptor.AutoCloseOutputStream(pfd).channel
          else -> throw Exceptions.IllegalArgument("Unsupported file mode: '$mode'")
        }
        return FileSystemFileHandle(channel, mode)
      } catch (error: Throwable) {
        try {
          pfd.close()
        } catch (closeError: Throwable) {
          error.addSuppressed(closeError)
        }
        throw error
      }
    }`;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function applyPatch(projectRoot = path.resolve(__dirname, '..')) {
  const projectPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const buildFromSource = projectPackage.expo?.autolinking?.android?.buildFromSource;
  if (!Array.isArray(buildFromSource) || !buildFromSource.includes('expo-file-system')) {
    throw new Error('expo.autolinking.android.buildFromSource must explicitly include "expo-file-system" so Android compiles the patched Kotlin instead of using a precompiled module. No file was written.');
  }
  const packageRoot = path.join(projectRoot, 'node_modules/expo-file-system');
  const installed = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (installed.version !== VERSION) {
    throw new Error(`expo-file-system version ${installed.version} is not the reviewed ${VERSION}; review the file-handle patch before building.`);
  }
  const target = path.join(packageRoot, relativeSource);
  const bytes = fs.readFileSync(target);
  const hash = sha256(bytes);
  if (hash === PATCHED_SHA256) return 'already patched';
  if (hash !== ORIGINAL_SHA256) {
    throw new Error(`expo-file-system ${VERSION} FileSystemFileHandle.kt SHA-256 mismatch (${hash}); review source drift before building. No file was written.`);
  }
  const source = bytes.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('Reviewed content URI factory was not found exactly once. No file was written.');
  const patched = source
    .replace('import android.net.Uri\n', 'import android.net.Uri\nimport android.os.ParcelFileDescriptor\n')
    .replace('import java.io.FileInputStream\n', '')
    .replace('import java.io.FileOutputStream\n', '')
    .replace(before, after);
  if (sha256(patched) !== PATCHED_SHA256) throw new Error('File-handle patch output SHA-256 mismatch. No file was written.');
  // All version, full-source and full-output checks precede this single write.
  fs.writeFileSync(target, patched);
  return 'patched';
}

module.exports = { applyPatch };

if (require.main === module) {
  try {
    console.log(`expo-file-system ${VERSION} content URI file-handle ownership: ${applyPatch()}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
