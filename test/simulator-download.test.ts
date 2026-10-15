import {describe, expect, it} from 'vitest';
import {
  downloadUrlFromReply,
  parseSimulatorPage,
  pickSimulatorPackage,
  unpackedDirName
} from '@lib/simulator-download.js';

// LG's page ships its file list as JSON. Only the shape the parser keys on is
// quoted here, with the two Mac entries of webOS 24 that the arm64 preference
// has to tell apart.
const PAGE =
  '<script>{"fileName":"webOS_TV_25_Simulator_1.4.4_mac.zip","fileId":"RF00021096"},' +
  '{"fileName":"webOS_TV_24_Simulator_1.4.1_mac.zip","fileId":"RF00021091"},' +
  '{"fileName":"webOS_TV_24_Simulator_1.4.1_mac-arm64.zip","fileId":"RF00021092"},' +
  '{"fileName":"webOS_TV_24_Simulator_1.4.1_win.zip","fileId":"RF00021090"}</script>';

const packages = parseSimulatorPage(PAGE);

describe('Simulator download page', () => {
  it('reads every package and its file id', () => {
    expect(packages).toEqual([
      {name: 'webOS_TV_25_Simulator_1.4.4_mac.zip', fileId: 'RF00021096'},
      {name: 'webOS_TV_24_Simulator_1.4.1_mac.zip', fileId: 'RF00021091'},
      {name: 'webOS_TV_24_Simulator_1.4.1_mac-arm64.zip', fileId: 'RF00021092'},
      {name: 'webOS_TV_24_Simulator_1.4.1_win.zip', fileId: 'RF00021090'}
    ]);
  });

  it('picks the platform package for this machine', () => {
    const cases: Array<[string, string, string, string]> = [
      ['Apple silicon, arm64 flavour offered', 'darwin', 'arm64', 'webOS_TV_24_Simulator_1.4.1_mac-arm64.zip'],
      ['Apple silicon, only the x64 name offered', 'darwin', 'arm64', 'webOS_TV_25_Simulator_1.4.4_mac.zip'],
      ['Intel Mac', 'darwin', 'x64', 'webOS_TV_24_Simulator_1.4.1_mac.zip'],
      ['Windows', 'win32', 'x64', 'webOS_TV_24_Simulator_1.4.1_win.zip']
    ];
    for (const [label, platform, arch, expected] of cases) {
      const version = expected.indexOf('_25_') > -1 ? '25' : '24';
      expect(pickSimulatorPackage(packages, version, platform, arch)?.name, label).toBe(expected);
    }
    expect(pickSimulatorPackage(packages, '23', 'darwin', 'arm64')).toBeNull();
  });

  it('names the directory the package unpacks to', () => {
    expect(unpackedDirName('webOS_TV_25_Simulator_1.4.4_mac-arm64.zip'))
      .toBe('webOS_TV_25_Simulator_1.4.4');
    expect(unpackedDirName('webOS_TV_6.0_Simulator_1.4.1_mac.zip'))
      .toBe('webOS_TV_6.0_Simulator_1.4.1');
  });

  it('unescapes the signed link out of the file service reply', () => {
    expect(downloadUrlFromReply(
      '<xsync><LMultiData gftsUrl="https://gfts.lge.com/f?key=dlRF1&amp;hash=abc" /></xsync>'
    )).toBe('https://gfts.lge.com/f?key=dlRF1&hash=abc');
    expect(downloadUrlFromReply('<xsync />')).toBeNull();
  });
});
