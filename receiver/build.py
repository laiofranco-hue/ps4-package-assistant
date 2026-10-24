#!/usr/bin/env python3
"""Build the diagnostic PS4 receiver using an explicitly supplied OpenOrbis SDK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent
CONTENT='IV0001-PKGA00001_00-PACKAGEASSIST001'
# Public fake-SELF capability metadata observed in the supplied working installer;
# these flags are not a signing key or a credential.
RECEIVER_AUTH_WORDS=(
    0x3100000000000002, 0x40001c0000000000, 0x800000000000ff00, 0x0, 0x0,
    0x4000400080000000, 0x8000000000000000, 0x800000000000000, 0xf0000000ffff4000,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
)

def run(args,**kwargs):
    subprocess.run([str(i) for i in args],check=True,**kwargs)

def stage_runtime_modules(sdk,stage):
    """Package the OpenOrbis replacement modules required before main runs."""
    destination=stage/'sce_module'
    destination.mkdir(exist_ok=True)
    hashes={}
    for name in ('libc.prx','libSceFios2.prx'):
        source=sdk/'src/modules'/name
        data=source.read_bytes()
        if len(data)<32 or data[:4]!=bytes.fromhex('4f153d1d'):
            raise ValueError(f'Invalid OpenOrbis runtime module: {name}')
        shutil.copyfile(source,destination/name)
        hashes[name]=hashlib.sha256(data).hexdigest()
    return hashes

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sdk',required=True,type=Path)
    parser.add_argument('--output',type=Path,default=Path.home()/'.codex/.chatgpt-projects/ps4-package-assistant-local/outputs/receiver/ps4')
    parser.add_argument('--alternate-receiver',action='store_true',help='Build 0.18 as PKGA00007 to preserve an installed receiver')
    parser.add_argument('--probe',action='store_true',help='Build a separate harmless install/launch test package')
    parser.add_argument('--probe-variant',action='store_true',help='Build the second harmless cancellation probe as PKGA00008')
    parser.add_argument('--queue-receiver',action='store_true',help='Build the queue-on-TV receiver as PKGA00009')
    parser.add_argument('--queue-receiver-fix',action='store_true',help='Build the deduplicated queue-on-TV receiver as PKGA00010')
    args=parser.parse_args();sdk=args.sdk.resolve(strict=True);out=args.output.resolve()
    content=CONTENT;title_id='PKGA00001';title='PS4 Package Assistant - Teste'
    if sum(bool(x) for x in (args.alternate_receiver,args.probe,args.probe_variant,args.queue_receiver,args.queue_receiver_fix))>1: raise ValueError('Escolha apenas uma variante.')
    if args.queue_receiver_fix:
        out=out/'queue-tv-fix';content='IV0001-PKGA00010_00-PACKAGEQUEUE0010';title_id='PKGA00010';title='PS4 Package Assistant - Fila na TV'
    elif args.queue_receiver:
        out=out/'queue-tv';content='IV0001-PKGA00009_00-PACKAGEQUEUE0009';title_id='PKGA00009';title='PS4 Package Assistant - Fila na TV'
    elif args.alternate_receiver:
        if args.probe:raise ValueError('Choose receiver or probe, not both.')
        out=out/'alternate';content='IV0001-PKGA00007_00-PACKAGETEST00018';title_id='PKGA00007';title='PS4 Package Assistant - Teste 0.18'
    if args.probe:
        out=out/('probe-variant' if args.probe_variant else 'probe')
        content=('IV0001-PKGA00008_00-CANCELTEST000101' if args.probe_variant else 'IV0001-PKGA00002_00-TRANSFERTEST0001')
        title_id='PKGA00008' if args.probe_variant else 'PKGA00002'
        title='PS4 Assistant - Prova de cancelamento' if args.probe_variant else 'PS4 Assistant - Prova de envio'
    home=Path.home()
    for forbidden in (home/'Desktop',home/'Documents',home/'Library/Mobile Documents',home/'Library/CloudStorage'):
        if out==forbidden or forbidden in out.parents:raise ValueError('Use uma pasta local fora da nuvem.')
    out.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='stage-',dir=out));objects=out/'objects';objects.mkdir(exist_ok=True)
    clang=os.environ.get('PS4_CC','/opt/homebrew/opt/llvm/bin/clang')
    linker=os.environ.get('PS4_LD','/opt/homebrew/opt/lld/bin/ld.lld')
    sources=['main.c','model.c','protocol.c','render.c','platform_ps4.c']
    if args.probe:sources=['probe.c','platform_ps4.c']
    object_files=[]
    for source in [ROOT/'src'/i for i in sources]+[ROOT/'vendor/cJSON.c']:
        obj=objects/(source.stem+'.o');object_files.append(obj)
        run([clang,'--target=x86_64-pc-freebsd12-elf','-std=c11','-fPIC','-O2','-D__ORBIS__','-DCJSON_NESTING_LIMIT=16','-isysroot',sdk,'-isystem',sdk/'include','-Wall','-Wextra','-c',source,'-o',obj])
    elf=out/'receiver.elf'
    run([linker,'-m','elf_x86_64','-pie','--script',sdk/'link.x','--eh-frame-hdr','-L'+str(sdk/'lib'),*object_files,sdk/'lib/crt1.o','-lc','-lm','-lpthread','-lkernel','-lSceNet','-lSceNetCtl','-lSceUserService','-lSceSysmodule','-lSceVideoOut','-o',elf])
    # The supplied working installer uses this system-app authority/profile.
    # Keep the harmless probe as an ordinary application.
    paid='0x3800000000000011' if args.probe else '0x3100000000000002'
    category='gd' if args.probe else 'gde'
    attribute='0' if args.probe else '18'
    tools=sdk/'bin/macos';pkgtool=tools/'PkgTool.Core'
    env={**os.environ,'DOTNET_SYSTEM_GLOBALIZATION_INVARIANT':'1','OO_PS4_TOOLCHAIN':str(sdk)}
    auth_args=[] if args.probe else ['--authinfo',struct.pack('<17Q',*RECEIVER_AUTH_WORDS).hex()]
    run([tools/'create-fself-macos','-in='+str(elf),'-out='+str(out/'receiver.oelf'),'--eboot',stage/'eboot.bin','--paid',paid,*auth_args],env=env)
    runtime_modules=stage_runtime_modules(sdk,stage)
    system=stage/'sce_sys';system.mkdir(exist_ok=True)
    # Code-generated icon for this proof, without game art or external font files.
    from PIL import Image,ImageDraw
    icon=Image.new('RGB',(512,512),'#10131a');draw=ImageDraw.Draw(icon)
    draw.rectangle((70,125,442,155),fill='#72a7ff');draw.rectangle((70,215,350,245),fill='#72a7ff');draw.rectangle((70,305,260,335),fill='#72a7ff')
    icon.save(system/'icon0.png')
    sfo=system/'param.sfo';run([pkgtool,'sfo_new',sfo],env=env)
    entries={'APP_TYPE':('Integer',4,'1'),'APP_VER':('Utf8',8,'0.18'),'ATTRIBUTE':('Integer',4,attribute),'CATEGORY':('Utf8',4,category),'CONTENT_ID':('Utf8',48,content),'DOWNLOAD_DATA_SIZE':('Integer',4,'0'),'SYSTEM_VER':('Integer',4,'0'),'TITLE':('Utf8',128,title),'TITLE_ID':('Utf8',12,title_id),'VERSION':('Utf8',8,'0.18')}
    for key,(kind,size,value) in entries.items():run([pkgtool,'sfo_setentry',sfo,key,'--type',kind,'--maxsize',size,'--value',value],env=env)
    about=system/'about';about.mkdir(exist_ok=True)
    (about/'NOTICE.txt').write_text('Diagnostic homebrew built with OpenOrbis v0.5.4. Source and test status: ps4-package-assistant/receiver. cJSON v1.7.19 MIT license included. Not an official Sony application.\n')
    shutil.copyfile(ROOT/'vendor/LICENSE',about/'cJSON-LICENSE.txt')
    shutil.copyfile(sdk/'LICENSE',about/'OpenOrbis-LICENSE.txt')
    files=[str(p.relative_to(stage)) for p in stage.rglob('*') if p.is_file()]
    run([tools/'create-gp4','-out',stage/'pkg.gp4','--content-id='+content,'--files',' '.join(files)],cwd=stage,env=env)
    run([pkgtool,'pkg_build',stage/'pkg.gp4',out],cwd=stage,env=env)
    pkg=out/(content+'.pkg')
    validation=subprocess.run([str(pkgtool),'pkg_validate',str(pkg)],env=env,check=True,capture_output=True,text=True)
    print(validation.stdout,end='')
    if '[FAIL]' in validation.stdout or '[ERROR]' in validation.stdout or validation.stdout.count('[OK]')<25:
        raise ValueError('A validação do PKG não confirmou todos os critérios esperados.')
    report={'title_id':title_id,'content_id':content,'file':str(pkg),'bytes':pkg.stat().st_size,'sha256':hashlib.sha256(pkg.read_bytes()).hexdigest(),'authority_id':paid,'auth_info_sha256':None if args.probe else hashlib.sha256(struct.pack('<17Q',*RECEIVER_AUTH_WORDS)).hexdigest(),'category':category,'attribute':int(attribute),'runtime_modules':runtime_modules,'pkg_checks':validation.stdout.count('[OK]'),'status':'built-not-console-validated'}
    (out/'build.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':main()
