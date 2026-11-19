package expo.modules.backupfingerprint;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Bounded SHA-256 over the actual stream, independent of Android for JVM tests. */
public final class StreamingSha256 {
  // Keep the native boundary equal to BACKUP_CAPACITY_LIMITS.archiveBytes.
  public static final long MAX_ARCHIVE_BYTES = 512L * 1024 * 1024;
  public static final int BUFFER_BYTES = 64 * 1024;
  private static final char[] HEX = "0123456789abcdef".toCharArray();

  private StreamingSha256() {}

  public static long requireExpectedByteLength(double value) {
    if (!Double.isFinite(value) || value != Math.rint(value)
        || value <= 0 || value > MAX_ARCHIVE_BYTES) {
      throw new IllegalArgumentException("Backup byte length is outside the supported limit");
    }
    return (long) value;
  }

  public static Result fingerprint(InputStream input, long expectedByteLength)
      throws IOException, NoSuchAlgorithmException {
    return fingerprint(input, expectedByteLength, () -> {});
  }

  /** Takes ownership of input, including when validation or cancellation fails. */
  public static Result fingerprint(InputStream input, long expectedByteLength, Runnable checkActive)
      throws IOException, NoSuchAlgorithmException {
    try (InputStream source = input) {
      if (expectedByteLength <= 0 || expectedByteLength > MAX_ARCHIVE_BYTES) {
        throw new IllegalArgumentException("Backup byte length is outside the supported limit");
      }
      if (source == null) throw new IOException("Backup input stream is unavailable");
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] buffer = new byte[BUFFER_BYTES];
      long byteLength = 0;
      while (true) {
        checkActive.run();
        // Read one extra byte after the expected end to prove EOF, not just a
        // matching prefix. A growing stream cannot cause unbounded reads.
        int requested = (int) Math.min(BUFFER_BYTES, expectedByteLength - byteLength + 1);
        int count = source.read(buffer, 0, requested);
        if (count == -1) break;
        if (count <= 0 || count > requested) throw new IOException("Backup read made no valid progress");
        if (count > MAX_ARCHIVE_BYTES - byteLength || count > expectedByteLength - byteLength) {
          throw new IOException("Backup byte length changed while reading");
        }
        digest.update(buffer, 0, count);
        byteLength += count;
      }
      if (byteLength != expectedByteLength) throw new IOException("Backup read ended before the expected length");
      checkActive.run();
      byte[] bytes = digest.digest();
      char[] hex = new char[bytes.length * 2];
      for (int i = 0; i < bytes.length; i++) {
        hex[i * 2] = HEX[(bytes[i] & 0xff) >>> 4];
        hex[i * 2 + 1] = HEX[bytes[i] & 0x0f];
      }
      return new Result(byteLength, new String(hex));
    }
  }

  public static final class Result {
    public final long byteLength;
    public final String sha256;

    private Result(long byteLength, String sha256) {
      this.byteLength = byteLength;
      this.sha256 = sha256;
    }
  }
}
