const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

// Android 7+ (the app's minimum SDK): credential- and device-protected storage,
// plus app-scoped external files. Explicit transfer rules supplement allowBackup
// because OEM device-to-device transfer may not honor that flag alone.
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external',
  'device_root', 'device_file', 'device_database', 'device_sharedpref'];
const exclusions = (indent) => DOMAINS.map((domain) => `${indent}<exclude domain="${domain}" path="." />`).join('\n');
const legacyRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${exclusions('  ')}
</full-backup-content>
`;
const extractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${exclusions('    ')}
  </cloud-backup>
  <device-transfer>
${exclusions('    ')}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withLocalOnlyBackup(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/local_only_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/local_only_data_extraction_rules';
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const xmlDirectory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(xmlDirectory, { recursive: true });
    await fs.writeFile(path.join(xmlDirectory, 'local_only_backup_rules.xml'), legacyRules, 'utf8');
    await fs.writeFile(path.join(xmlDirectory, 'local_only_data_extraction_rules.xml'), extractionRules, 'utf8');
    return mod;
  }]);
};
