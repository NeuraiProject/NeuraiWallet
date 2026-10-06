/**
 * Short progress labels for the C6 worker's stage messages, which are long
 * English sentences meant for a desktop page ("Checking pool operation at
 * block 22127 (chain snapshot 25340)"). Unknown messages pass through.
 */

export interface StageLabels {
  syncing: string;
  recovering: string;
  verifyingChain: string;
  synced: string;
  saving: string;
  loading: string;
  witness: string;
  proving: string;
  verifyingProof: string;
}

export function shortStage(message: string, labels: StageLabels): string {
  let m: RegExpMatchArray | null;
  if ((m = message.match(/^Checking pool operation at block (\d+) \(chain snapshot (\d+)\)/))) return `${labels.syncing} ${m[1]}/${m[2]}`;
  if ((m = message.match(/^Reading C6 block (\d+) \/ (\d+)/))) return `${labels.syncing} ${m[1]}/${m[2]}`;
  if ((m = message.match(/^(?:Resumed saved C6 state|Replaying saved pool operations) through block (\d+)/)))
    return `${labels.syncing} ${m[1]}`;
  if (/^Reading confirmed C6 pool history/.test(message)) return labels.syncing;
  if (/^Recovering private notes/.test(message)) return labels.recovering;
  if (/^Checking the scanned chain/.test(message)) return labels.verifyingChain;
  if ((m = message.match(/^C6 synchronized through block (\d+)/))) return `${labels.synced} ${m[1]}`;
  if (/^Updating encrypted operation history/.test(message)) return labels.saving;
  if ((m = message.match(/^Loading ([A-Za-z0-9]+)\.(?:zkey|wasm|vk\.json) · (\d+)%/))) return `${labels.loading} ${m[1]} ${m[2]}%`;
  if (/^Compute witness/.test(message)) return labels.witness;
  if ((m = message.match(/^Generate (\S+) proof/))) return `${labels.proving} ${m[1]}`;
  if ((m = message.match(/^Verify (\S+) proof/))) return `${labels.verifyingProof} ${m[1]}`;
  return message;
}
