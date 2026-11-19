package expo.modules.backupfingerprint

import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

class BackupFingerprintModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackupFingerprint")

    AsyncFunction("fingerprint") Coroutine { uriString: String, expectedByteLength: Double ->
      // AsyncFunction alone uses Expo's shared module queue. File I/O and hashing
      // run on IO workers so neither that queue nor the JS/UI thread is occupied.
      withContext(Dispatchers.IO) {
        val expected = StreamingSha256.requireExpectedByteLength(expectedByteLength)
        val uri = Uri.parse(uriString)
        val context = appContext.reactContext ?: throw Exceptions.AppContextLost()
        val operationContext = coroutineContext
        operationContext.ensureActive()
        val input = when (uri.scheme) {
          "file" -> {
            if (!uri.authority.isNullOrEmpty()) throw IllegalArgumentException("Unsupported file URI authority")
            val file = File(uri.path ?: throw IllegalArgumentException("Missing file URI path"))
            if (!file.isAbsolute) throw IllegalArgumentException("Expected an absolute file URI")
            FileInputStream(file)
          }
          "content" -> context.contentResolver.openInputStream(uri)
            ?: throw IOException("Backup content provider returned no input stream")
          else -> throw IllegalArgumentException("Only file and content backup URIs are supported")
        }
        // The helper owns and closes this stream on success, read failure,
        // length mismatch or cancellation. It never returns a partial hash.
        val result = StreamingSha256.fingerprint(input, expected) { operationContext.ensureActive() }
        mapOf("byteLength" to result.byteLength, "sha256" to result.sha256)
      }
    }
  }
}
