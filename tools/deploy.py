#!/usr/bin/env python3
"""Test a stable source snapshot and atomically deploy farm.pagzi.tech over existing SSH."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'deployment'))
from release_ops import PUBLIC_FILES, validate_id

STATE_DIR=ROOT/'.local-deploy'
PRIVATE_CONFIG_PATH=Path(os.environ.get('FARM_PRIVATE_CONFIG', str(STATE_DIR/'private-config.json'))).resolve()
PRIVATE_CONFIG=json.loads(PRIVATE_CONFIG_PATH.read_text()) if PRIVATE_CONFIG_PATH.exists() else {}
PRIVATE_WALLETS=PRIVATE_CONFIG.get('private_wallet_addresses', [])
if not isinstance(PRIVATE_WALLETS, list) or any(not isinstance(a, str) or not re.fullmatch(r'0x[0-9a-fA-F]{38,40}', a) for a in PRIVATE_WALLETS):
    raise ValueError('Invalid private wallet denylist')
SSH_HOST=os.environ.get('FARM_DEPLOY_SSH_HOST') or PRIVATE_CONFIG.get('ssh_host') or 'farm-vps'
REMOTE_SITE='/opt/farm-companion/site'
ORIGIN='https://farm.pagzi.tech'
INPUT_DIRS=('src','assets','knowledge','extension','tools','tests','docs','deployment')
INPUT_FILES=('package.json','package-lock.json','playwright.config.js','AGENTS.md','README.md',
             'portfolio/README.md','portfolio/holdings.example.json','portfolio/plot.example.json','portfolio/scenarios.json')
SKIP_DIRS={'__pycache__','node_modules','.git','test-results','artifacts','dist','dist-extension','.local-deploy'}
PRIVATE_ADDRESSES=re.compile('|'.join(re.escape(a[2:]) for a in PRIVATE_WALLETS).encode() if PRIVATE_WALLETS else rb'(?!)',re.I)


def inputs(root):
    files=[]
    for name in INPUT_DIRS:
        folder=root/name
        if folder.is_symlink(): raise ValueError('Input directories cannot be symlinks')
        if not folder.exists(): continue
        for base, directories, names in os.walk(folder):
            directories[:]=sorted(d for d in directories if d not in SKIP_DIRS)
            for directory in directories:
                if (Path(base)/directory).is_symlink(): raise ValueError('Input directory symlink')
            for file in sorted(names):
                path=Path(base)/file
                if path.suffix=='.pyc': continue
                if path.is_symlink() or not path.is_file(): raise ValueError('Inputs must be regular files')
                files.append(path.relative_to(root))
    for name in INPUT_FILES:
        path=root/name
        if path.is_symlink(): raise ValueError('Input file symlink')
        if path.is_file(): files.append(Path(name))
    return sorted(set(files))


def fingerprint(root):
    digest=hashlib.sha256()
    for name in inputs(root):
        digest.update(str(name).encode()+b'\0')
        digest.update(hashlib.sha256((root/name).read_bytes()).digest())
    return digest.hexdigest()


def save_state(state):
    STATE_DIR.mkdir(exist_ok=True)
    path=STATE_DIR/'status.json'
    tmp=path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        stream.write(json.dumps(state,indent=2)+'\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp,path)
    parent_fd=os.open(STATE_DIR,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(parent_fd)
    finally: os.close(parent_fd)


def load_state():
    path=STATE_DIR/'status.json'
    return json.loads(path.read_text()) if path.exists() else {}


def run(argv,**kwargs):
    print('+ '+ ' '.join(map(str,argv)),flush=True)
    return subprocess.run(list(map(str,argv)),check=True,**kwargs)


def deploy_collector(snapshot, scratch):
    """Publish only the independently bundled read-only collector, outside the site."""
    artifact = snapshot/'dist-collector'/'collector.mjs'
    if (artifact.parent.is_symlink() or artifact.is_symlink() or not artifact.is_file() or
            not 0 < artifact.stat().st_size <= 32 * 1024 * 1024):
        raise ValueError('Collector artifact must be a bounded regular file')
    code = artifact.read_bytes()
    if PRIVATE_ADDRESSES.search(code):
        raise ValueError('Invalid or private collector artifact')
    digest = hashlib.sha256(code).hexdigest()
    stage = Path(scratch)/'collector';stage.mkdir()
    (stage/'collector.mjs').write_bytes(code)
    (stage/'manifest.json').write_text(json.dumps({'schema_version':1,'sha256':digest})+'\n')
    # rsync preserves these modes; the isolated process reads as UID 1000.
    stage.chmod(0o755)
    for path in stage.iterdir(): path.chmod(0o644)
    destination = '/opt/farm-companion/collector/runtime/versions/' + digest
    run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',SSH_HOST,'mkdir','-p',destination],timeout=60)
    run(['rsync','-az','--checksum','--delay-updates','-e','ssh -o BatchMode=yes -o ConnectTimeout=15',
         str(stage)+'/',f'{SSH_HOST}:{destination}/'],timeout=120)
    result = run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',SSH_HOST,'python3',
                  '/opt/farm-companion/collector/collector_ops.py','activate',digest],
                 capture_output=True,text=True,timeout=180)
    outcome = json.loads(result.stdout)
    # A live waiting-for-reveal heartbeat is successful; production reveal itself
    # is a future external event, not something this deployment can manufacture.
    if not isinstance(outcome,dict) or outcome.get('healthy') is not True or outcome.get('code_sha256') != digest:
        raise RuntimeError('Collector activation did not verify its artifact and heartbeat')
    return digest


def recover_collector_pending(state):
    """Recover a collector interruption even when source reverted to the live hash."""
    if not state.get('pending_collector'): return
    result = run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',SSH_HOST,'python3',
                  '/opt/farm-companion/collector/collector_ops.py','recover'],
                 capture_output=True,text=True,timeout=180)
    outcome = json.loads(result.stdout)
    if not isinstance(outcome,dict) or outcome.get('pending_activation') is not False:
        raise RuntimeError('Collector recovery did not clear the pending activation')
    state.update(pending_collector=False)
    save_state(state)


def remote(command,*args):
    # Every variable crossing the remote shell is an enum or validated release ID.
    if command not in ('activate','rollback','status','prune'): raise ValueError('Invalid remote operation')
    for value in args:
        if value not in ('none','--expected'): validate_id(value)
    result=run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',SSH_HOST,'python3',
                '/opt/farm-companion/release_ops.py',command,*args],capture_output=True,text=True,timeout=60)
    return json.loads(result.stdout)


def recover_pending(state):
    """Reconcile a persisted activation intent, including a lost SSH response."""
    candidate=state.get('pending_release')
    if not candidate: return
    validate_id(candidate)
    previous=state.get('previous_release')
    observed=remote('status')['current']
    if observed==candidate:
        remote('rollback',previous or 'none','--expected',candidate)
    elif observed!=previous:
        raise RuntimeError('The server release changed independently; refusing to roll back another release')
    state.update(pending_release=None,status='recovered')
    save_state(state)


def stage_release(dist,output,release_id,source_hash):
    validate_id(release_id)
    output.mkdir(parents=True)
    for name in sorted(PUBLIC_FILES):
        path=dist/name
        if path.is_symlink() or not path.is_file(): raise ValueError(f'Missing regular public file: {name}')
        data=path.read_bytes()
        if PRIVATE_ADDRESSES.search(data): raise ValueError('Private configured wallet in release')
        (output/name).write_bytes(data)
    with zipfile.ZipFile(output/'farm-companion-chrome.zip') as archive:
        if archive.testzip(): raise ValueError('Invalid extension ZIP')
        for name in archive.namelist():
            if name.startswith('/') or any(part.startswith('_') or part=='..' for part in name.split('/')):
                raise ValueError('Reserved or unsafe extension path')
            if PRIVATE_ADDRESSES.search(archive.read(name)): raise ValueError('Private configured wallet in extension')
        if 'plan-worker.js' not in archive.namelist(): raise ValueError('Extension worker missing')
    index=(output/'index.html').read_text()
    if index.count('src="./app.js"')!=1: raise ValueError('Unexpected HTML entry point')
    (output/'index.html').write_text(index.replace('src="./app.js"',f'src="/releases/{release_id}/app.js"'))
    build=json.loads((output/'build.json').read_text())
    build.update(release_id=release_id,source_sha256=source_hash,deployed_at=datetime.now(timezone.utc).isoformat())
    (output/'build.json').write_text(json.dumps(build,indent=2)+'\n')
    manifest={'release_id':release_id,'source_sha256':source_hash,'files':{
        name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in sorted(PUBLIC_FILES)}}
    (output/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # The watcher keeps logs/snapshots private; only this public payload is readable by Nginx.
    output.chmod(0o755)
    for path in output.iterdir(): path.chmod(0o644)
    return manifest


def health_check(release_id,manifest):
    # TLS verification is deliberately enabled, including during first deployment.
    for path,name,mime in [('/','index.html','text/html'),('/build.json','build.json','application/json'),
        (f'/releases/{release_id}/app.js','app.js','javascript'),
        (f'/releases/{release_id}/plan-worker.js','plan-worker.js','javascript'),
        ('/farm-companion-chrome.zip','farm-companion-chrome.zip','application/zip')]:
        request=urllib.request.Request(ORIGIN+path,headers={'Cache-Control':'no-cache'})
        with urllib.request.urlopen(request,timeout=20) as response:
            if response.status!=200 or mime not in response.headers.get('Content-Type',''): raise ValueError(f'Wrong response for {path}')
            if response.headers.get('X-Content-Type-Options')!='nosniff' or not response.headers.get('Content-Security-Policy'):
                raise ValueError('Missing production security headers')
            if hashlib.sha256(response.read()).hexdigest()!=manifest['files'][name]: raise ValueError(f'Live checksum mismatch: {path}')


def deploy(source_hash,state):
    release_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+source_hash[:12]
    state.update(status='checking',attempted_hash=source_hash,attempted_at=time.time())
    save_state(state)
    logs=STATE_DIR/'logs';logs.mkdir(exist_ok=True)
    log_path=logs/f'{release_id}.log'
    state['log']=str(log_path);save_state(state)
    with tempfile.TemporaryDirectory(prefix='farm-check-',dir=STATE_DIR) as scratch:
        snapshot=Path(scratch)/'source';snapshot.mkdir()
        for name in inputs(ROOT):
            target=snapshot/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,target)
        if fingerprint(snapshot)!=source_hash or fingerprint(ROOT)!=source_hash:
            raise RuntimeError('Source changed while snapshotting; wait for the next stable edit')
        env=os.environ.copy();env.update(FARM_PORT='4197',FARM_DEPLOY_CHECK='1',CI='1',FARM_PRIVATE_CONFIG=str(PRIVATE_CONFIG_PATH))
        with log_path.open('w') as log:
            run(['npm','ci','--no-audit','--no-fund'],cwd=snapshot,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
            run(['npm','run','check'],cwd=snapshot,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
        if fingerprint(ROOT)!=source_hash: raise RuntimeError('Source changed during checks; the previous live release remains in place')
        payload=Path(scratch)/'release';manifest=stage_release(snapshot/'dist',payload,release_id,source_hash)
        state.update(status='uploading',log=str(log_path));save_state(state)
        run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',SSH_HOST,'mkdir','-p',f'{REMOTE_SITE}/releases/{release_id}'],timeout=60)
        run(['rsync','-az','--checksum','--delay-updates','-e','ssh -o BatchMode=yes -o ConnectTimeout=15',
            str(payload)+'/',f'{SSH_HOST}:{REMOTE_SITE}/releases/{release_id}/'],timeout=180)
        if fingerprint(ROOT)!=source_hash: raise RuntimeError('Source changed during upload; the previous live release remains in place')
        state.update(pending_collector=True)
        save_state(state)
        state['collector_sha256'] = deploy_collector(snapshot, scratch)
        state.update(pending_collector=False)
        save_state(state)
        if fingerprint(ROOT)!=source_hash: raise RuntimeError('Source changed during collector activation; retry the website release')
        # Persist BEFORE SSH: a connection can fail after the server has switched.
        state.update(status='activating',pending_release=release_id,
                     previous_release=remote('status')['current'])
        save_state(state)
        try:
            activated=remote('activate',release_id)
            state.update(status='verifying',release_id=release_id,previous_release=activated['previous']);save_state(state)
            # ACME issuance on the first deployment can need a short wait.
            for attempt in range(12):
                try: health_check(release_id,manifest);break
                except Exception:
                    if attempt==11: raise
                    time.sleep(5)
            run(['node',str(snapshot/'tools/deploy-smoke.mjs'),ORIGIN,release_id,str(STATE_DIR/'screenshots')],cwd=snapshot,timeout=120)
        except Exception:
            recover_pending(state)
            raise
        state.update(status='live',last_deployed_hash=source_hash,last_release=release_id,
                     last_success=datetime.now(timezone.utc).isoformat(),url=ORIGIN,error=None,pending_release=None)
        save_state(state)
        try: remote('prune')
        except Exception as error: print(f'Release retention cleanup can be retried: {error}',file=sys.stderr)
        print(f'Live: {ORIGIN} — {release_id}',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--auto',action='store_true',help='Deploy after inputs remain stable across timer ticks')
    parser.add_argument('--status',action='store_true')
    args=parser.parse_args()
    STATE_DIR.mkdir(mode=0o700,exist_ok=True)
    if args.status:
        print(json.dumps(load_state(),indent=2));return
    with (STATE_DIR/'deploy.lock').open('a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another deployment is already running');return
        state=load_state()
        recover_pending(state)
        recover_collector_pending(state)
        source_hash=fingerprint(ROOT);now=time.time()
        if args.auto:
            if source_hash==state.get('last_deployed_hash'): return
            if source_hash!=state.get('observed_hash'):
                state.update(observed_hash=source_hash,observed_at=now,status='waiting_for_stable_source');save_state(state);return
            if now-state.get('observed_at',now)<30: return
            if source_hash==state.get('failed_hash') and now-state.get('failed_at',0)<300: return
        try: deploy(source_hash,state)
        except Exception as error:
            state.update(status='failed',error=str(error),failed_hash=source_hash,failed_at=time.time())
            save_state(state);print(f'Deployment failed; check {STATE_DIR}/logs: {error}',file=sys.stderr);raise

if __name__=='__main__': main()
