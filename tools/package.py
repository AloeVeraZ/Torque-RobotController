"""Portable Linux, Windows, and macOS bundles, using verified Electron runtimes."""
from __future__ import annotations
import argparse,re,hashlib,io,json,os,plistlib,shutil,stat,tarfile,urllib.request,zipfile,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
META=json.loads((ROOT/'package.json').read_text());VERSION=META['version'];CHANNEL=None;ELECTRON=META['devDependencies']['electron']
# Bump when anything outside app/ changes in a way installed copies must pick up
# (runtime layout, launchers, Info.plist keys). Installs whose base differs get the full package.
BASE_REVISION='2'
CACHE=ROOT/'.cache';OUT=ROOT/'dist';BASE=f'https://github.com/electron/electron/releases/download/v{ELECTRON}'
def download(url,dest):
    if dest.exists():return
    print('Downloading '+dest.name,flush=True)
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DeckDriverStation-build'}),timeout=120) as r,dest.with_suffix('.part').open('wb') as f:shutil.copyfileobj(r,f)
    dest.with_suffix('.part').replace(dest)
def runtime_archive(target):
    CACHE.mkdir(exist_ok=True);name=f'electron-v{ELECTRON}-{target}.zip';archive=CACHE/name;manifest=CACHE/f'SHASUMS256-{ELECTRON}.txt'
    download(BASE+'/SHASUMS256.txt',manifest);download(BASE+'/'+name,archive)
    sums={p[1].lstrip('*'):p[0] for line in manifest.read_text().splitlines() if len(p:=line.split())==2}
    with archive.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    if digest!=sums.get(name):raise RuntimeError('Electron checksum mismatch: '+name)
    return archive
def runtime(target):
    archive=runtime_archive(target);dest=CACHE/f'runtime-{target}-{ELECTRON}';executable='electron.exe' if target.startswith('win32') else 'electron'
    if not (dest/executable).exists():
        dest.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            for e in z.infolist():
                if not (dest/e.filename).resolve().is_relative_to(dest.resolve()):raise RuntimeError('Unsafe archive path')
                z.extract(e,dest)
                if os.name!='nt' and (dest/e.filename).is_file():(dest/e.filename).chmod((e.external_attr>>16)&0o777 or 0o644)
    return dest
def base_id():
    """Fingerprint of everything an installed copy keeps when only app/ is replaced."""
    h=hashlib.sha256(f'{BASE_REVISION}\n{ELECTRON}\n'.encode())
    for name in ('launch.sh','Launcher.nsi'):h.update((ROOT/'packaging'/name).read_bytes().replace(b'\r\n',b'\n'))
    return h.hexdigest()[:12]
def generated(name,data):
    folder=CACHE/'generated'/VERSION;folder.mkdir(parents=True,exist_ok=True);file=folder/name;file.write_bytes(data);return file
def app_files():
    meta=json.loads((ROOT/'package.json').read_text())
    if meta['version']==VERSION and CHANNEL in (None,meta.get('updateChannel')):yield ROOT/'package.json','package.json'
    else:
        meta['version']=VERSION
        if CHANNEL:meta['updateChannel']=CHANNEL
        yield generated('package.json',(json.dumps(meta,indent=2)+'\n').encode()),'package.json'
    yield generated('build.json',json.dumps({'version':VERSION,'electron':ELECTRON,'base':base_id()}).encode()),'build.json'
    yield ROOT/'docs'/'CHROMIUM-LICENSE.txt','licenses/CHROMIUM-GAMEPAD.txt'
    yield ROOT/'LICENSE','LICENSE'
    yield ROOT/'THIRD-PARTY-NOTICES.md','THIRD-PARTY-NOTICES.md'
    for folder in ('src','ui','sim-runtime'):
        for file in sorted((ROOT/folder).rglob('*')):
            relative=file.relative_to(ROOT).as_posix()
            if file.is_file() and not restricted(relative):yield file,relative
# Third-party CAD whose terms do not allow redistribution stays in personal local builds only,
# and each platform's Java runtime ships beside Electron (runtime/java) instead of in app/.
RESTRICTED=('ui/vendor/models/','sim-runtime/java/')
CAD_NOTICES={'ui/assets/fields/NOTICES.md','ui/assets/robots/NOTICES.md','ui/vendor/licenses/FIELD-CAD-NOTICES.md','ui/vendor/licenses/ROBOT-CAD-NOTICES.md'}
def restricted(relative):
    return relative.startswith(RESTRICTED) or relative in CAD_NOTICES or re.fullmatch(r'ui/assets/(fields|robots)/[^/]+\.(glb(\.gz)?|deck\.gz)',relative) is not None
def java_runtime(target):
    """The reduced Java runtime for one platform, made by tools/simulation/fetch.cjs."""
    folder=CACHE/'simulation-runtime'/('java-'+target)
    if not (folder/'release').exists():raise RuntimeError(f'Missing {folder}. Run: node tools/simulation/fetch.cjs --targets {target}')
    return folder
def java_files(target):
    for file in sorted(java_runtime(target).rglob('*')):
        if file.is_file():relative=file.relative_to(java_runtime(target)).as_posix();yield file,relative,relative.startswith('bin/') or relative.endswith('lib/jspawnhelper')
def finish(file):
    with file.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    file.with_name(file.name+'.sha256').write_text(f'{digest}  {file.name}\n',newline='\n');print('Ready: '+str(file),flush=True)
def latest(file):
    # Version-free copy, so releases/latest/download/<name> links and the one-line installers never change.
    alias=file.with_name(file.name.replace(f'-{VERSION}-','-'));shutil.copyfile(file,alias);finish(alias)

def nsis():
    archive=CACHE/'nsis-3.0.4.1.7z';download('https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z',archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!='9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa':raise RuntimeError('NSIS checksum mismatch')
    folder=CACHE/'nsis-3.0.4.1';binary=folder/('makensis.exe' if os.name=='nt' else 'linux/makensis')
    if not binary.exists():
        folder.mkdir(exist_ok=True)
        if os.name=='nt':subprocess.run(['tar','-xf',str(archive),'-C',str(folder)],check=True)
        else:subprocess.run(['7z','x',str(archive),'-o'+str(folder),'-y'],check=True,stdout=subprocess.DEVNULL)
    if os.name!='nt':binary.chmod(0o755)
    return binary,folder

def compile_nsis(script,**definitions):
    binary,folder=nsis();prefix='/D' if os.name=='nt' else '-D'
    command=[str(binary),'/V2' if os.name=='nt' else '-V2',*[prefix+k+'='+str(v) for k,v in definitions.items()],str(ROOT/'packaging'/script)]
    subprocess.run(command,env={**os.environ,'NSISDIR':str(folder)},check=True)
def linux():
    source=runtime('linux-x64');name=f'DeckDriverStation-{VERSION}-SteamDeck';file=OUT/(name+'.tar.gz')
    def permissions(e):
        e.uid=e.gid=0;e.uname=e.gname='';e.mode=0o755 if e.isdir() or Path(e.name).name in ('electron','chrome_crashpad_handler','chrome-sandbox','launch.sh','install.sh','jspawnhelper') or '/runtime/java/bin/' in e.name else 0o644;return e
    with tarfile.open(file,'w:gz',compresslevel=6) as t:
        t.add(source,arcname=name+'/runtime',filter=permissions)
        t.add(java_runtime('linux-x64'),arcname=name+'/runtime/java',filter=permissions)
        for src,relative in app_files():t.add(src,arcname=name+'/app/'+relative,filter=permissions)
        for script in ('launch.sh','install.sh'):
            data=(ROOT/'packaging'/script).read_text().replace('\r\n','\n').encode();e=tarfile.TarInfo(name+'/'+script);e.mode=0o755;e.size=len(data);t.addfile(e,io.BytesIO(data))
        for doc in ('QUICKSTART.md','COMPATIBILITY.md','VALIDATION.md','UPDATES.md'):t.add(ROOT/'docs'/doc,arcname=name+'/'+doc,filter=permissions)
    with tarfile.open(file) as t:
        assert t.getmember(name+'/runtime/electron').mode&stat.S_IXUSR
        assert t.getmember(name+'/install.sh').mode&stat.S_IXUSR
        assert t.getmember(name+'/runtime/java/bin/java').mode&stat.S_IXUSR
        assert not any(restricted(m.name.split('/app/',1)[1]) for m in t.getmembers() if '/app/' in m.name)
    finish(file)
    with file.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    installer=OUT/f'DeckDriverStation-{VERSION}-SteamDeck.run'
    header='''#!/usr/bin/env bash
set -euo pipefail
stage="$(mktemp -d "${TMPDIR:-/tmp}/deck-driver-install.XXXXXX")"
cleanup() { [[ "$stage" == "${TMPDIR:-/tmp}/deck-driver-install."* ]] && rm -rf -- "$stage"; }
trap cleanup EXIT
line=$(awk '/^__ARCHIVE_BELOW__$/ { print NR+1; exit }' "$0")
tail -n +"$line" "$0" > "$stage/package.tar.gz"
printf '%s  %s\\n' '@HASH@' "$stage/package.tar.gz" | sha256sum -c -
tar -xzf "$stage/package.tar.gz" -C "$stage"
bash "$stage/@NAME@/install.sh"
exit 0
__ARCHIVE_BELOW__
'''.replace('@HASH@',digest).replace('@NAME@',name)
    with installer.open('wb') as out,file.open('rb') as source_file:out.write(header.encode());shutil.copyfileobj(source_file,out)
    installer.chmod(0o755);finish(installer);latest(installer);app_package()
def app_package():
    """Code-only update: just app/, for installs whose runtime base matches."""
    file=OUT/f'DeckDriverStation-{VERSION}-App-{base_id()}.tar.gz'
    with open(file,'wb') as raw,gzip_writer(raw) as gz,tarfile.open(fileobj=gz,mode='w',format=tarfile.PAX_FORMAT) as t:
        for src,relative in app_files():
            data=src.read_bytes();e=tarfile.TarInfo('app/'+relative);e.size=len(data);e.mode=0o644;e.mtime=0;e.uid=e.gid=0;e.uname=e.gname='';t.addfile(e,io.BytesIO(data))
    with tarfile.open(file) as t:assert all(m.name.startswith('app/') and '..' not in m.name.split('/') for m in t.getmembers())
    finish(file)
def gzip_writer(raw):
    import gzip;return gzip.GzipFile(filename='',mode='wb',fileobj=raw,compresslevel=9,mtime=0)
def windows():
    archive=runtime_archive('win32-x64');name=f'DeckDriverStation-{VERSION}-Windows';file=OUT/(name+'.zip')
    # A fresh payload every build, so nothing from an earlier build can reach the installer.
    payload=CACHE/('windows-'+VERSION)/name;shutil.rmtree(payload,ignore_errors=True);payload.mkdir(parents=True)
    shutil.copytree(runtime('win32-x64'),payload/'runtime',dirs_exist_ok=True)
    shutil.copytree(java_runtime('win32-x64'),payload/'runtime'/'java',dirs_exist_ok=True)
    for src,relative in app_files():
        destination=payload/'app'/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,destination)
    compile_nsis('Launcher.nsi',OUTPUT=payload/'DeckDriverStation.exe',ICON=ROOT/'ui/icon.ico',VERSION=VERSION)
    with zipfile.ZipFile(file,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        with zipfile.ZipFile(archive) as source:
            for e in source.infolist():z.writestr(name+'/runtime/'+e.filename,source.read(e.filename))
        for src,relative,_ in java_files('win32-x64'):z.write(src,name+'/runtime/java/'+relative)
        for src,relative in app_files():z.write(src,name+'/app/'+relative)
        z.write(payload/'DeckDriverStation.exe',name+'/DeckDriverStation.exe')
        for script in ('Install-Windows.ps1','Install-Windows.cmd','Launch-Windows.cmd'):z.write(ROOT/'packaging'/script,name+'/'+script)
        z.write(ROOT/'docs'/'QUICKSTART.md',name+'/QUICKSTART.md')
        z.write(ROOT/'docs'/'UPDATES.md',name+'/UPDATES.md')
    finish(file)
    setup=OUT/f'DeckDriverStation-{VERSION}-Windows-Setup.exe'
    compile_nsis('Setup.nsi',OUTPUT=setup,ICON=ROOT/'ui/icon.ico',SETUP_ICON=ROOT/'packaging/installer.ico',SIDEBAR=ROOT/'packaging/installer-sidebar.bmp',VERSION=VERSION,PAYLOAD=payload)
    finish(setup);latest(setup)
def mac(arch):
    archive=runtime_archive('darwin-'+arch);bundle='Deck Driver Station.app';file=OUT/f'DeckDriverStation-{VERSION}-macOS-{arch}.zip'
    with zipfile.ZipFile(file,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        with zipfile.ZipFile(archive) as original:
            for e in original.infolist():
                if '/_CodeSignature/' in e.filename or e.filename.endswith('/_CodeSignature/'):continue
                name=e.filename.replace('Electron.app',bundle,1) if e.filename.startswith('Electron.app') else 'Runtime licenses/'+e.filename;data=original.read(e.filename)
                if e.filename=='Electron.app/Contents/Info.plist':
                    p=plistlib.loads(data);p.update(CFBundleName='Deck Driver Station',CFBundleDisplayName='Deck Driver Station',CFBundleIdentifier='dev.deckdriverstation.app',CFBundleShortVersionString=VERSION,CFBundleVersion=VERSION,CFBundleIconFile='deck.icns',NSLocalNetworkUsageDescription='Connect to the robot websites you select on your local Wi-Fi network.');data=plistlib.dumps(p)
                info=zipfile.ZipInfo(name,e.date_time);info.external_attr=e.external_attr;info.create_system=3;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
        for src,relative in app_files():
            info=zipfile.ZipInfo(bundle+'/Contents/Resources/app/'+relative);info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,src.read_bytes())
        for src,relative,executable in java_files('darwin-arm64'):
            info=zipfile.ZipInfo(bundle+'/Contents/Resources/runtime-java/'+relative);info.create_system=3;info.external_attr=(0o100755 if executable else 0o100644)<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,src.read_bytes())
        z.write(ROOT/'ui'/'icon.icns',bundle+'/Contents/Resources/deck.icns');z.write(ROOT/'docs'/'QUICKSTART.md','QUICKSTART.md')
        z.write(ROOT/'docs'/'UPDATES.md','UPDATES.md')
        info=zipfile.ZipInfo('Install-Mac.command');info.create_system=3;info.external_attr=0o100755<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(ROOT/'packaging'/'Install-Mac.command').read_text().replace('\r\n','\n'))
    with zipfile.ZipFile(file) as z:
        assert z.getinfo(bundle+'/Contents/MacOS/Electron').external_attr>>16&0o111
        assert z.getinfo(bundle+'/Contents/Resources/runtime-java/bin/java').external_attr>>16&0o111
        assert plistlib.loads(z.read(bundle+'/Contents/Info.plist'))['CFBundleIdentifier']=='dev.deckdriverstation.app'
    finish(file);latest(file)
def main():
    p=argparse.ArgumentParser();p.add_argument('--target',choices=['steamdeck','windows','macos-arm64','app','all'],default='steamdeck');p.add_argument('--version',help='Package as this version (update tests only).');p.add_argument('--channel',choices=['testing','main'],help='Package for this update channel instead of the one package.json names (a local Main build from testing).');p.add_argument('--runtime-only',choices=['linux-x64','win32-x64']);p.add_argument('--fetch-only',choices=['darwin-arm64']);args=p.parse_args();OUT.mkdir(exist_ok=True)
    if args.version:
        global VERSION;VERSION=args.version
    if args.channel:
        global CHANNEL;CHANNEL=args.channel
    if args.runtime_only:print(runtime(args.runtime_only));return
    if args.fetch_only:print(runtime_archive(args.fetch_only));return
    if args.target in ('steamdeck','all'):linux()
    if args.target in ('windows','all'):windows()
    if args.target in ('macos-arm64','all'):mac('arm64')
    if args.target=='app':app_package()
if __name__=='__main__':main()
