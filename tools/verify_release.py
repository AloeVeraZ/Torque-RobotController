"""Verify the final downloadable artifacts against their checksums and app source."""
import hashlib,importlib.util,json,plistlib,tarfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# The packager's own rule for what never ships (restricted CAD, and Java, which goes beside Electron).
_spec=importlib.util.spec_from_file_location('package',ROOT/'tools'/'package.py');package=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(package)
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'dist'
def sources():
    yield ROOT/'package.json','package.json'
    for name in ('LICENSE','THIRD-PARTY-NOTICES.md'):yield ROOT/name,name
    for directory in ('src','ui','sim-runtime'):
        for f in (ROOT/directory).rglob('*'):
            relative=f.relative_to(ROOT).as_posix()
            if f.is_file() and not package.restricted(relative):yield f,relative
def main():
    names=[f'DeckDriverStation-{VERSION}-SteamDeck.tar.gz',f'DeckDriverStation-{VERSION}-Windows.zip',f'DeckDriverStation-{VERSION}-macOS-arm64.zip']
    sums=[]
    for name in names:
        file=OUT/name
        with file.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        assert digest==file.with_name(name+'.sha256').read_text().split()[0],name+' checksum mismatch'
        sums.append(f'{digest}  {name}')
        if name.endswith('.tar.gz'):
            prefix=f'DeckDriverStation-{VERSION}-SteamDeck/'
            with tarfile.open(file) as archive:
                for src,relative in sources():assert archive.extractfile(prefix+'app/'+relative).read()==src.read_bytes(),name+': '+relative
                assert archive.getmember(prefix+'install.sh').mode&0o111
                assert archive.getmember(prefix+'runtime/electron').mode&0o111
                assert archive.getmember(prefix+'runtime/java/bin/java').mode&0o111
                assert not any(package.restricted(m.name.split('/app/',1)[1]) for m in archive.getmembers() if '/app/' in m.name),name+': restricted file packaged'
                assert b'Deck Driver Station.desktop' in archive.extractfile(prefix+'install.sh').read()
        elif name.endswith('.zip'):
            with zipfile.ZipFile(file) as archive:
                is_mac='macOS' in name
                prefix='Torque.app/Contents/Resources/app/' if is_mac else f'DeckDriverStation-{VERSION}-Windows/app/'
                for src,relative in sources():assert archive.read(prefix+relative)==src.read_bytes(),name+': '+relative
                if is_mac:
                    assert archive.getinfo('Install-Mac.command').external_attr>>16&0o111
                    assert archive.getinfo('Torque.app/Contents/MacOS/Electron').external_attr>>16&0o111
                    assert archive.getinfo('Torque.app/Contents/Resources/runtime-java/bin/java').external_attr>>16&0o111
                    info=plistlib.loads(archive.read('Torque.app/Contents/Info.plist'))
                    assert info['CFBundleIdentifier']=='dev.deckdriverstation.app'
                else:
                    assert archive.read(f'DeckDriverStation-{VERSION}-Windows/runtime/electron.exe')[:2]==b'MZ'
                    assert archive.read(f'DeckDriverStation-{VERSION}-Windows/runtime/java/bin/java.exe')[:2]==b'MZ'
                assert not any(package.restricted(n.split('/app/',1)[1]) for n in archive.namelist() if '/app/' in n),name+': restricted file packaged'
        print('Verified: '+name,flush=True)
    for suffix in ('SteamDeck.run','Windows-Setup.exe'):
        file=OUT/f'DeckDriverStation-{VERSION}-{suffix}'
        with file.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        assert digest==file.with_name(file.name+'.sha256').read_text().split()[0]
        if suffix.endswith('.exe'):assert file.read_bytes()[:2]==b'MZ'
        else:
            with file.open('rb') as f:
                assert f.readline().startswith(b'#!/usr/bin/env bash')
                for _ in range(100):
                    if f.readline()==b'__ARCHIVE_BELOW__\n':break
                else:raise AssertionError('Self-extracting installer header is missing')
                payload=hashlib.file_digest(f,'sha256').hexdigest()
            assert payload==(OUT/f'DeckDriverStation-{VERSION}-SteamDeck.tar.gz.sha256').read_text().split()[0]
        sums.append(f'{digest}  {file.name}');print('Verified: '+file.name,flush=True)
    (OUT/'SHA256SUMS.txt').write_text('\n'.join(sums)+'\n')
if __name__=='__main__':main()
