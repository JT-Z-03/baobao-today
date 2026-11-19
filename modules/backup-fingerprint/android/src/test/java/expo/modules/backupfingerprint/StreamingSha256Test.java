package expo.modules.backupfingerprint;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.concurrent.CancellationException;

/** Standalone JDK test runner: no Android/device or additional test dependency. */
public final class StreamingSha256Test {
  private static int passed;

  public static void main(String[] args) throws Exception {
    run("known binary vector and EOF", () -> {
      TrackingInput input = new TrackingInput(256, 65536, false);
      StreamingSha256.Result result = StreamingSha256.fingerprint(input, 256);
      equal(result.sha256, "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880");
      equal(result.byteLength, 256);
      closed(input);
      check(input.eofObserved, "Must read EOF after the expected bytes");
    });
    run("one-byte partial reads and multiple chunks", () -> {
      TrackingInput input = new TrackingInput(65539, 1, false);
      StreamingSha256.Result result = StreamingSha256.fingerprint(input, 65539);
      equal(result.sha256, "32beb7b57583420f652233c9c0b774fbe19e611c9374f26c5b4722e5c940cf05");
      equal(result.byteLength, 65539);
      closed(input);
      check(input.sameBuffer, "Every read must reuse one buffer");
      check(input.maxRequested <= 65536, "Read request exceeds the buffer budget");
    });
    run("short EOF is rejected and closed", () -> {
      TrackingInput input = new TrackingInput(3, 2, false);
      fails(IOException.class, () -> StreamingSha256.fingerprint(input, 4));
      closed(input);
    });
    run("growth after expected prefix is rejected and bounded", () -> {
      TrackingInput input = new TrackingInput(1000, 2, false);
      fails(IOException.class, () -> StreamingSha256.fingerprint(input, 3));
      equal(input.position, 4);
      closed(input);
    });
    run("read error propagates and closes", () -> {
      TrackingInput input = new TrackingInput(10, 2, false);
      input.readErrorAt = 4;
      IOException error = fails(IOException.class, () -> StreamingSha256.fingerprint(input, 10));
      check(error == input.readError, "Original read exception must propagate");
      closed(input);
    });
    run("close error cannot report success", () -> {
      TrackingInput input = new TrackingInput(3, 3, false);
      input.closeError = new IOException("synthetic close failure");
      IOException error = fails(IOException.class, () -> StreamingSha256.fingerprint(input, 3));
      check(error == input.closeError, "Close error must propagate");
      closed(input);
    });
    run("close error is suppressed on read failure", () -> {
      TrackingInput input = new TrackingInput(10, 2, false);
      input.readErrorAt = 2;
      input.closeError = new IOException("synthetic close failure");
      IOException error = fails(IOException.class, () -> StreamingSha256.fingerprint(input, 10));
      check(error == input.readError, "Read error must remain primary");
      check(error.getSuppressed().length == 1 && error.getSuppressed()[0] == input.closeError,
          "Must preserve suppressed close error");
      closed(input);
    });
    run("zero-byte read is rejected instead of spinning", () -> {
      TrackingInput input = new TrackingInput(3, 0, false);
      fails(IOException.class, () -> StreamingSha256.fingerprint(input, 3));
      closed(input);
    });
    run("invalid expected lengths reject and close", () -> {
      for (long size : new long[] {-1, 0, StreamingSha256.MAX_ARCHIVE_BYTES + 1, Long.MAX_VALUE}) {
        TrackingInput input = new TrackingInput(3, 3, false);
        fails(IllegalArgumentException.class, () -> StreamingSha256.fingerprint(input, size));
        equal(input.position, 0);
        closed(input);
      }
    });
    run("JS double length is validated before conversion", () -> {
      for (double size : new double[] {Double.NaN, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY,
          -1, 0, 0.5, 3.25, StreamingSha256.MAX_ARCHIVE_BYTES + 1.0, 9007199254740991.0}) {
        fails(IllegalArgumentException.class, () -> StreamingSha256.requireExpectedByteLength(size));
      }
      equal(StreamingSha256.requireExpectedByteLength(1), 1);
      equal(StreamingSha256.requireExpectedByteLength(StreamingSha256.MAX_ARCHIVE_BYTES),
          StreamingSha256.MAX_ARCHIVE_BYTES);
    });
    run("512 MiB exact boundary with fixed memory", () -> {
      TrackingInput input = new TrackingInput(StreamingSha256.MAX_ARCHIVE_BYTES, 65536, true);
      StreamingSha256.Result result = StreamingSha256.fingerprint(input, StreamingSha256.MAX_ARCHIVE_BYTES);
      equal(result.byteLength, StreamingSha256.MAX_ARCHIVE_BYTES);
      equal(result.sha256, "9acca8e8c22201155389f65abbf6bc9723edc7384ead80503839f49dcc56d767");
      check(input.sameBuffer && input.maxRequested == 65536, "Must reuse one 64 KiB buffer");
      check(input.eofObserved, "Boundary success still requires EOF");
      closed(input);
    });
    run("512 MiB plus one byte rejects", () -> {
      TrackingInput input = new TrackingInput(StreamingSha256.MAX_ARCHIVE_BYTES + 1, 65536, true);
      fails(IOException.class, () -> StreamingSha256.fingerprint(input, StreamingSha256.MAX_ARCHIVE_BYTES));
      equal(input.position, StreamingSha256.MAX_ARCHIVE_BYTES + 1);
      closed(input);
    });
    run("cancellation closes and never returns a partial hash", () -> {
      TrackingInput input = new TrackingInput(65539, 65536, false);
      CancellationException canceled = new CancellationException("synthetic cancellation");
      int[] calls = {0};
      CancellationException error = fails(CancellationException.class, () ->
          StreamingSha256.fingerprint(input, 65539, () -> {
            if (++calls[0] == 2) throw canceled;
          }));
      check(error == canceled, "Cancellation must propagate");
      equal(input.position, 65536);
      closed(input);
    });
    System.out.println("PASS " + passed + " JVM cases; no Android/device behavior claimed");
  }

  private static void closed(TrackingInput input) { equal(input.closeCount, 1); }
  private static void equal(long actual, long expected) { check(actual == expected, actual + " != " + expected); }
  private static void equal(String actual, String expected) { check(actual.equals(expected), actual + " != " + expected); }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
  private static void run(String name, Checked action) throws Exception {
    action.run();
    passed++;
    System.out.println("PASS " + name);
  }
  private static <T extends Throwable> T fails(Class<T> type, Checked action) throws Exception {
    try { action.run(); }
    catch (Throwable error) {
      if (type.isInstance(error)) return type.cast(error);
      throw new AssertionError("Expected " + type.getName() + " but got " + error, error);
    }
    throw new AssertionError("Expected " + type.getName());
  }
  @FunctionalInterface private interface Checked { void run() throws Exception; }

  private static final class TrackingInput extends InputStream {
    final long length;
    final int chunk;
    final boolean zeros;
    final IOException readError = new IOException("synthetic read failure");
    long readErrorAt = Long.MAX_VALUE;
    IOException closeError;
    long position;
    int closeCount;
    int maxRequested;
    byte[] firstBuffer;
    boolean sameBuffer = true;
    boolean eofObserved;

    TrackingInput(long length, int chunk, boolean zeros) {
      this.length = length;
      this.chunk = chunk;
      this.zeros = zeros;
    }
    @Override public int read() { throw new AssertionError("Expected bounded buffer reads"); }
    @Override public int read(byte[] buffer, int offset, int count) throws IOException {
      maxRequested = Math.max(maxRequested, count);
      if (firstBuffer == null) firstBuffer = buffer;
      else sameBuffer &= firstBuffer == buffer;
      check(buffer.length == 65536 && offset == 0 && count > 0 && count <= 65536, "Invalid buffer request");
      if (position >= readErrorAt) throw readError;
      if (position == length) { eofObserved = true; return -1; }
      int n = (int) Math.min(Math.min(count, chunk), length - position);
      if (zeros) Arrays.fill(buffer, 0, n, (byte) 0);
      else for (int i = 0; i < n; i++) buffer[i] = (byte) ((position + i) & 0xff);
      position += n;
      return n;
    }
    @Override public void close() throws IOException {
      closeCount++;
      if (closeError != null) throw closeError;
    }
  }
}
