import java.io.InputStream;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

// Launched as JDK 17 source; no compiled artifact or extra dependency is needed.
class AabSignatureVerifier {
  public static void main(String[] args) {
    try {
      if (args.length != 2 || !args[1].matches("[0-9a-fA-F]{64}")) {
        throw new IllegalArgumentException("Expected archive and APK certificate SHA-256");
      }
      String expected = args[1].toLowerCase(Locale.ROOT);
      Set<String> names = new HashSet<>();
      int contentEntries = 0;
      try (JarFile archive = new JarFile(args[0], true)) {
        var entries = archive.entries();
        byte[] buffer = new byte[65536];
        while (entries.hasMoreElements()) {
          JarEntry entry = entries.nextElement();
          if (!names.add(entry.getName())) {
            throw new SecurityException("Duplicate archive entry: " + entry.getName());
          }
          if (entry.isDirectory()) continue;
          // Read to EOF to trigger JarFile's cryptographic digest verification.
          try (InputStream input = archive.getInputStream(entry)) {
            while (input.read(buffer) != -1) { }
          }
          String upperName = entry.getName().toUpperCase(Locale.ROOT);
          if (upperName.matches("META-INF/(MANIFEST\\.MF|[^/]+\\.(SF|RSA|DSA|EC)|SIG-[^/]+)")) {
            continue;
          }
          CodeSigner[] signers = entry.getCodeSigners();
          if (signers == null || signers.length != 1) {
            throw new SecurityException("Content must have one valid signer: " + entry.getName());
          }
          byte[] leafCertificate = signers[0].getSignerCertPath().getCertificates().get(0).getEncoded();
          String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(leafCertificate));
          if (!expected.equals(actual)) {
            throw new SecurityException("AAB signer differs from APK signer: " + entry.getName());
          }
          contentEntries++;
        }
      }
      if (contentEntries == 0) throw new SecurityException("Archive has no signed content");
      System.out.println("AAB_SIGNATURE_VERIFIED:" + expected);
    } catch (Exception failure) {
      System.err.println("AAB signature verification failed: " + failure.getMessage());
      System.exit(1);
    }
  }
}
