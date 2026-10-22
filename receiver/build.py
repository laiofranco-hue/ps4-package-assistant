#!/usr/bin/env python3
"""Build the diagnostic PS4 receiver using an explicitly supplied OpenOrbis SDK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent
CONTENT='IV0001-PKGA00001_00-PACKAGEASSIST001'

def run(args,**kwargs):
    subprocess.run([str(i) for i in args],check=True,**kwargs)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sdk',required=True,type=Path)
    parser.add_argument('--output',type=Path,default=Path.home()/'.codex/.chatgpt-projects/ps4-package-assistant-local/outputs/receiver/ps4')
    parser.add_argument('--probe',action='store_true',help='Build a separate harmless install/launch test package')
    args=parser.parse_args();sdk=args.sdk.resolve(strict=True);out=args.output.resolve()
    content=CONTENT;title_id='PKGA00001';title='PS4 Package Assistant - Teste'
    if args.probe:
        out=out/'probe';content='IV0001-PKGA00002_00-TRANSFERTEST0001';title_id='PKGA00002';title='PS4 Assistant - Prova de envio'
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
    run([linker,'-m','elf_x86_64','-pie','--script',sdk/'link.x','--eh-frame-hdr','-L'+str(sdk/'lib'),*object_files,sdk/'lib/crt1.o','-lc','-lm','-lpthread','-lkernel','-lSceNet','-lSceNetCtl','-lSceBgft','-lSceAppInstUtil','-lSceUserService','-lSceSysmodule','-lSceVideoOut','-o',elf])
    tools=sdk/'bin/macos';pkgtool=tools/'PkgTool.Core'
    env={**os.environ,'DOTNET_SYSTEM_GLOBALIZATION_INVARIANT':'1','OO_PS4_TOOLCHAIN':str(sdk)}
    run([tools/'create-fself-macos','-in='+str(elf),'-out='+str(out/'receiver.oelf'),'--eboot',stage/'eboot.bin','--paid','0x3800000000000011'],env=env)
    system=stage/'sce_sys';system.mkdir(exist_ok=True)
    # Code-generated icon for this proof, without game art or external font files.
    from PIL import Image,ImageDraw
    icon=Image.new('RGB',(512,512),'#10131a');draw=ImageDraw.Draw(icon)
    draw.rectangle((70,125,442,155),fill='#72a7ff');draw.rectangle((70,215,350,245),fill='#72a7ff');draw.rectangle((70,305,260,335),fill='#72a7ff')
    icon.save(system/'icon0.png')
    sfo=system/'param.sfo';run([pkgtool,'sfo_new',sfo],env=env)
    entries={'APP_TYPE':('Integer',4,'1'),'APP_VER':('Utf8',8,'0.10'),'ATTRIBUTE':('Integer',4,'0'),'CATEGORY':('Utf8',4,'gd'),'CONTENT_ID':('Utf8',48,content),'DOWNLOAD_DATA_SIZE':('Integer',4,'0'),'SYSTEM_VER':('Integer',4,'0'),'TITLE':('Utf8',128,title),'TITLE_ID':('Utf8',12,title_id),'VERSION':('Utf8',8,'0.10')}
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
    report={'title_id':title_id,'content_id':content,'file':str(pkg),'bytes':pkg.stat().st_size,'sha256':hashlib.sha256(pkg.read_bytes()).hexdigest(),'pkg_checks':validation.stdout.count('[OK]'),'status':'built-not-console-validated'}
    (out/'build.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':main()
