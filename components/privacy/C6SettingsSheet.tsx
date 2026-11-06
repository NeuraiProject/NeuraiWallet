/**
 * Advanced privacy settings behind the gear: ZK passphrase, encrypted history
 * backup and restore, proving files, lock, and the pinned pool instance.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showFilePickerAndReadFile, writeFileAndExport } from '../../blue_modules/fs';
import { getArtifactBaseUrl, setArtifactBaseUrl, type ArtifactStatus } from '../../blue_modules/neurai/privacy/artifacts';
import type { C6Runtime } from '../../blue_modules/neurai/privacy/deployment';
import type { C6PrivateWallet } from '../../hooks/useC6PrivateWallet';
import loc from '../../loc';
import { Chip, ChipRow, Field, Hint, InfoRow, Label, OutlineButton, PrimaryButton, usePrivacyTheme } from './C6UI';

/** Largest encrypted journal backup the library accepts. */
const MAX_BACKUP_CHARS = 8_001_000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Label>{title.toUpperCase()}</Label>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function C6SettingsSheet(props: {
  visible: boolean;
  onClose: () => void;
  runtime: C6Runtime;
  pool: C6PrivateWallet;
  zkPassphrase: string;
  onZkPassphrase: (value: string) => void;
  onLock: () => void;
  backupName: string;
}) {
  const { pool, runtime } = props;
  const t = usePrivacyTheme();
  const insets = useSafeAreaInsets();
  const [files, setFiles] = useState<ArtifactStatus | null>(null);
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState('');
  const busy = pool.busy;

  const refresh = useCallback(async () => {
    setFiles(await pool.artifacts.status());
    setUrl(await getArtifactBaseUrl(runtime));
  }, [pool.artifacts, runtime]);
  useEffect(() => {
    if (props.visible) refresh().catch(() => {});
  }, [props.visible, refresh, pool.busy]);

  const mb = (bytes: number) => (bytes / 1048576).toFixed(0);
  const complete = !!files && files.present === files.total;

  const restoreHistory = () =>
    pool.run(loc.privacy.restoring, async () => {
      const { data } = await showFilePickerAndReadFile();
      if (!data) return;
      if (data.length > MAX_BACKUP_CHARS) throw new Error(loc.privacy.error_backup_too_large);
      await pool.unlock({ backup: JSON.parse(data), zkPassphrase: props.zkPassphrase });
    });

  const saveHistory = () =>
    pool.run(loc.privacy.saving_backup, async token => {
      const backup = await pool.requireClient().backup();
      pool.live(token);
      await writeFileAndExport(props.backupName, JSON.stringify(backup));
      pool.setSaved(true);
    });

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <Pressable style={[styles.sheet, t.panel]}>
          <View style={styles.header}>
            <Text style={[styles.title, t.text]}>{loc.privacy.settings}</Text>
            <Pressable onPress={props.onClose} hitSlop={10} accessibilityRole="button" testID="PrivacySettingsClose">
              <Text style={[styles.close, t.subtext]}>{loc.privacy.close}</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: (insets.bottom || 0) + 24 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Section title={loc.privacy.section_wallet}>
              <Field
                label={loc.privacy.zk_passphrase}
                value={props.zkPassphrase}
                onChangeText={props.onZkPassphrase}
                secure
                editable={!pool.open && !busy}
                placeholder={loc.privacy.optional}
              />
              <Hint>{pool.open ? loc.privacy.zk_passphrase_locked : loc.privacy.zk_passphrase_hint}</Hint>
              {pool.open ? <OutlineButton title={loc.privacy.lock} onPress={props.onLock} testID="PrivacyLock" /> : null}
            </Section>

            <Section title={loc.privacy.section_history}>
              <Hint>{pool.historyReady ? (pool.saved ? loc.privacy.backup_saved : loc.privacy.backup_hint) : loc.privacy.no_history}</Hint>
              <ChipRow>
                <Chip label={loc.privacy.save_backup} disabled={busy || !pool.historyReady} onPress={saveHistory} />
                <Chip label={loc.privacy.restore_backup} disabled={busy || !pool.valid} onPress={restoreHistory} />
                {pool.open && !pool.historyReady ? (
                  <Chip
                    label={loc.privacy.new_history}
                    disabled={busy}
                    onPress={() => pool.run(loc.privacy.opening, () => pool.unlock({ create: true, zkPassphrase: props.zkPassphrase }))}
                  />
                ) : null}
              </ChipRow>
            </Section>

            <Section title={loc.privacy.section_files}>
              <InfoRow
                label={complete ? loc.privacy.files_ready : loc.privacy.files_missing}
                value={files ? `${files.present}/${files.total} · ${mb(files.bytesPresent)}/${mb(files.bytesTotal)} MB` : '—'}
              />
              {progress ? <Hint>{progress}</Hint> : null}
              {!complete ? (
                <PrimaryButton
                  title={loc.privacy.download_files}
                  disabled={busy}
                  busy={!!progress}
                  onPress={() =>
                    pool.run(loc.privacy.stage_downloading, async () => {
                      try {
                        let lastDone = -1;
                        await pool.artifacts.downloadAll(({ file, percent, done }) => {
                          setProgress(`${file} ${percent}%`);
                          if (done !== lastDone) {
                            lastDone = done;
                            pool.artifacts.status().then(setFiles, () => {});
                          }
                        });
                      } finally {
                        setProgress('');
                        await refresh();
                      }
                    })
                  }
                  testID="PrivacyDownloadFiles"
                />
              ) : null}
              <Field label={loc.privacy.files_url} value={url} onChangeText={setUrl} editable={!busy} keyboardType="url" />
              <ChipRow>
                <Chip
                  label={loc.privacy.save}
                  disabled={busy}
                  onPress={() =>
                    pool.run(loc.privacy.save, async () => {
                      await setArtifactBaseUrl(runtime, url === runtime.defaultArtifactUrl ? null : url);
                      await refresh();
                    })
                  }
                />
                <Chip
                  label={loc.privacy.reset}
                  disabled={busy}
                  onPress={() =>
                    pool.run(loc.privacy.reset, async () => {
                      await setArtifactBaseUrl(runtime, null);
                      await refresh();
                    })
                  }
                />
                <Chip
                  label={loc.privacy.delete_files}
                  disabled={busy || !files?.present}
                  onPress={() =>
                    pool.run(loc.privacy.delete_files, async () => {
                      await pool.artifacts.remove();
                      await refresh();
                    })
                  }
                />
              </ChipRow>
            </Section>

            <Section title={loc.privacy.section_pool}>
              <InfoRow label={loc.privacy.instance} value={String((runtime.config.manifest as { identity?: string }).identity ?? '')} />
              <InfoRow label={loc.privacy.commitment} value={runtime.config.expectedCommitment} mono />
              <Hint>{loc.privacy.test_warning}</Hint>
            </Section>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, paddingTop: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 6 },
  title: { fontSize: 17, fontWeight: '700' },
  close: { fontSize: 15, fontWeight: '600' },
  body: { paddingHorizontal: 18, paddingBottom: 32 },
  section: { marginTop: 18 },
  sectionBody: { rowGap: 10 },
});
